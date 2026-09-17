import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";
import {
  Repository,
  Failure,
  hash,
  inside,
  authorize,
  atomicWrite,
  type Operation,
} from "./storage.js";

export class Manager {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public repository: Repository) {}
  async operations() {
    return this.repository.operations();
  }
  async recordOperation(operation: Omit<Operation, "id" | "createdAt">) {
    await this.repository.appendOperation(operation);
  }
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  async directories() {
    const state = await this.repository.read();
    return Promise.all(
      state.directories.map(async (d) => {
        try {
          if (
            (await fs.realpath(d.path)) !== d.path ||
            !(await fs.stat(d.path)).isDirectory()
          )
            throw Error("目录已改变");
          await fs.access(d.path, fs.constants.R_OK | fs.constants.X_OK);
          return {
            ...d,
            directoryId: hash(d.path),
            available: true,
            error: undefined,
          };
        } catch {
          return {
            ...d,
            directoryId: hash(d.path),
            available: false,
            error: "目录不存在或不可读取",
          };
        }
      }),
    );
  }
  async register(input: string) {
    return this.exclusive(async () => {
      const expanded =
        input === "~"
          ? os.homedir()
          : input.startsWith("~/")
            ? path.join(os.homedir(), input.slice(2))
            : input;
      let real: string;
      try {
        real = await fs.realpath(path.resolve(expanded));
        if (!(await fs.stat(real)).isDirectory()) throw Error();
        await fs.access(real, fs.constants.R_OK | fs.constants.X_OK);
      } catch {
        throw new Failure("DIRECTORY_UNAVAILABLE", "目标不是可读取的目录");
      }
      const state = await this.repository.read();
      if (
        state.directories.some(
          (d) => inside(d.path, real) || inside(real, d.path),
        )
      )
        throw new Failure(
          "DIRECTORY_DUPLICATE_OR_OVERLAP",
          "目录与现有登记重复或重叠",
        );
      state.directories.push({ path: real, enabled: true });
      await this.repository.write(state);
      return { path: real, directoryId: hash(real), available: true };
    });
  }
  async remove(id: string) {
    return this.exclusive(async () => {
      const state = await this.repository.read();
      const removed = state.directories.find((d) => hash(d.path) === id);
      state.directories = state.directories.filter((d) => hash(d.path) !== id);
      await this.repository.write(state);
      if (removed)
        await this.recordOperation({
          operation: "delete",
          directoryId: id,
          path: removed.path,
          status: "success",
          message: "移除目录登记，未删除磁盘文件",
        });
      return {};
    });
  }
  async scan() {
    const skills: any[] = [],
      errors: any[] = [];
    for (const directory of await this.directories()) {
      if (!directory.available) {
        errors.push({ path: directory.path, message: directory.error });
        continue;
      }
      let entries;
      try {
        entries = await fs.readdir(directory.path, { withFileTypes: true });
      } catch {
        errors.push({ path: directory.path, message: "无法扫描目录" });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const candidate = path.join(directory.path, entry.name);
        let record: any = {
          skillId: hash(candidate),
          realPath: candidate,
          directoryName: entry.name,
          name: entry.name,
          description: "",
          sourceDirectoryPath: directory.path,
          directoryId: directory.directoryId,
          fileStatus: "normal",
          modifiedAt: null,
        };
        try {
          const real = await authorize(directory.path, candidate);
          if (!(await fs.stat(real)).isDirectory()) continue;
          const file = path.join(real, "SKILL.md");
          try {
            await fs.lstat(file);
          } catch (e: any) {
            if (e.code === "ENOENT") continue;
            throw e;
          }
          record = { ...record, skillId: hash(real), realPath: real };
          const safeFile = await authorize(directory.path, file);
          if (!(await fs.stat(safeFile)).isFile())
            throw Error("SKILL.md 不是普通文件");
          const content = await fs.readFile(safeFile, "utf8");
          record.modifiedAt = (await fs.stat(safeFile)).mtime.toISOString();
          record.fingerprint = hash(content);
          if (/^---\r?\n/.test(content)) {
            const match = content.match(
              /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
            );
            if (!match) throw Error("YAML front matter 缺少结束标记");
            const metadata = YAML.parse(match[1]);
            if (metadata && typeof metadata === "object") {
              if (typeof metadata.name === "string" && metadata.name)
                record.name = metadata.name;
              if (typeof metadata.description === "string")
                record.description = metadata.description;
            }
          }
        } catch (e: any) {
          record.fileStatus = "invalid";
          record.parseError = {
            code: e.code || "SKILL_INVALID",
            message: e.message,
          };
        }
        if (!skills.some((s) => s.skillId === record.skillId))
          skills.push(record);
      }
    }
    return { skills, errors };
  }
  async locate(id: string) {
    const record = (await this.scan()).skills.find((s) => s.skillId === id);
    if (!record)
      throw new Failure("SKILL_NOT_FOUND", "Skill 不存在，请刷新列表", 404);
    const directory = (await this.directories()).find(
      (d) => d.path === record.sourceDirectoryPath && d.available,
    );
    if (!directory)
      throw new Failure("DIRECTORY_UNAVAILABLE", "登记目录不可用");
    await authorize(directory.path, record.realPath);
    const file = await authorize(
      directory.path,
      path.join(record.realPath, "SKILL.md"),
    );
    return { record, file };
  }
  async detail(id: string) {
    const { record, file } = await this.locate(id);
    const content = await fs.readFile(file, "utf8");
    return { ...record, content, fingerprint: hash(content) };
  }
  private withDescription(content: string, description: string) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match)
      throw new Failure(
        "SKILL_INVALID",
        "SKILL.md 缺少可编辑的 YAML front matter",
      );
    const metadata = YAML.parse(match[1]);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw new Failure(
        "SKILL_INVALID",
        "SKILL.md 的 YAML front matter 格式无效",
      );
    metadata.description = description;
    return `---\n${YAML.stringify(metadata)}---\n${content.slice(match[0].length)}`;
  }
  async save(
    id: string,
    content: string,
    expected: string,
    force: boolean,
    description?: string,
  ) {
    return this.exclusive(async () => {
      let file = "";
      try {
        ({ file } = await this.locate(id));
        const current = await fs.readFile(file, "utf8");
        if (!force && hash(current) !== expected)
          throw new Failure(
            "CONFLICT",
            "SKILL.md 已被外部修改，草稿已保留",
            409,
          );
        if (description !== undefined)
          content = this.withDescription(content, description);
        await atomicWrite(file, content);
        await this.recordOperation({
          operation: "update",
          skillId: id,
          path: file,
          status: "success",
        });
        return { fingerprint: hash(content) };
      } catch (error: any) {
        await this.recordOperation({
          operation: "update",
          skillId: id,
          path: file || undefined,
          status: "failed",
          errorCode: error.code || "IO_ERROR",
          message: error.message,
        });
        throw error;
      }
    });
  }
  async create(input: {
    targetDirectoryIds: string[];
    directoryName: string;
    content?: string;
    name?: string;
    description?: string;
    whenToUse?: string;
    instructions?: string;
  }) {
    return this.exclusive(async () => {
      const directories = await this.directories();
      const targets = [...new Set(input.targetDirectoryIds)].map(
        (directoryId) => {
          const directory = directories.find(
            (item) => item.directoryId === directoryId && item.available,
          );
          if (!directory)
            throw new Failure("DIRECTORY_UNAVAILABLE", "目标登记目录不可用");
          return {
            directory,
            target: path.join(directory.path, input.directoryName),
          };
        },
      );
      const content =
        input.content ??
        `---\n${YAML.stringify({ name: input.name, description: input.description })}---\n\n## When to use\n\n${input.whenToUse}\n\n## Instructions\n\n${input.instructions}\n`;
      const created: typeof targets = [];
      let failedTarget: (typeof targets)[number] | undefined;
      try {
        for (const target of targets) {
          failedTarget = target;
          await fs.mkdir(target.target);
          created.push(target);
          await authorize(target.directory.path, target.target);
          await atomicWrite(path.join(target.target, "SKILL.md"), content);
        }
      } catch (error: any) {
        for (const target of created) {
          await fs.rm(target.target, { recursive: true, force: true });
          await this.recordOperation({
            operation: "create",
            skillId: hash(target.target),
            directoryId: target.directory.directoryId,
            path: target.target,
            status: "rolled_back",
            message: "多目录创建失败，已回滚",
          });
        }
        const failure =
          error.code === "EEXIST"
            ? new Failure("SKILL_PATH_EXISTS", "目标目录已存在，不能覆盖", 409)
            : error;
        await this.recordOperation({
          operation: "create",
          directoryId: failedTarget?.directory.directoryId,
          path: failedTarget?.target,
          status: "failed",
          errorCode: failure.code || "IO_ERROR",
          message: failure.message,
        });
        throw failure;
      }
      for (const target of created) {
        await this.recordOperation({
          operation: "create",
          skillId: hash(target.target),
          directoryId: target.directory.directoryId,
          path: target.target,
          status: "success",
        });
      }
      return {
        skillId: created[0] && hash(created[0].target),
        skillIds: created.map((target) => hash(target.target)),
      };
    });
  }
}
