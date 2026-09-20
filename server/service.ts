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
  async operations(limit: number) {
    return (await this.repository.operations())
      .slice()
      .reverse()
      .slice(0, limit);
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
      for (const [skillKey, directoryId] of Object.entries(
        state.defaultDirectories || {},
      )) {
        if (directoryId === id) {
          delete state.defaultDirectories![skillKey];
          delete state.syncFingerprints![skillKey];
        }
      }
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
    const scanSkill = async (
      directory: any,
      candidate: string,
      directoryName: string | null,
      isRootSkill: boolean,
    ) => {
      const record: any = {
        skillId: hash(candidate),
        realPath: candidate,
        directoryName,
        isRootSkill,
        name: directoryName || "",
        description: "",
        sourceDirectoryPath: directory.path,
        directoryId: directory.directoryId,
        fileStatus: "normal",
        modifiedAt: null,
      };
      try {
        const real = await authorize(directory.path, candidate);
        if (!(await fs.stat(real)).isDirectory()) return;
        const file = path.join(real, "SKILL.md");
        try {
          await fs.lstat(file);
        } catch (e: any) {
          if (e.code === "ENOENT") return;
          throw e;
        }
        record.skillId = hash(real);
        record.realPath = real;
        const safeFile = await authorize(directory.path, file);
        if (!(await fs.stat(safeFile)).isFile())
          throw Error("SKILL.md 不是普通文件");
        const content = await fs.readFile(safeFile, "utf8");
        record.modifiedAt = (await fs.stat(safeFile)).mtime.toISOString();
        record.fingerprint = hash(content);
        if (/^---\r?\n/.test(content)) {
          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
          if (!match) throw Error("YAML front matter 缺少结束标记");
          const metadata = YAML.parse(match[1]);
          if (metadata && typeof metadata === "object") {
            if (typeof metadata.name === "string" && metadata.name)
              record.name = metadata.name;
            if (typeof metadata.description === "string")
              record.description = metadata.description;
          }
        }
        if (isRootSkill && !record.name)
          throw Error("根 Skill 缺少 front matter name");
      } catch (e: any) {
        record.fileStatus = "invalid";
        record.parseError = {
          code: e.code || "SKILL_INVALID",
          message: e.message,
        };
      }
      if (!skills.some((s) => s.skillId === record.skillId))
        skills.push(record);
    };
    for (const directory of await this.directories()) {
      if (!directory.available) {
        errors.push({ path: directory.path, message: directory.error });
        continue;
      }
      const rootFile = path.join(directory.path, "SKILL.md");
      if ((await fs.lstat(rootFile).catch(() => undefined))?.isFile())
        await scanSkill(directory, directory.path, null, true);
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
        await scanSkill(directory, candidate, entry.name, false);
      }
    }
    return { skills, errors };
  }
  private unifiedKey(skill: any) {
    return skill.name || skill.directoryName || `root:${skill.directoryId}`;
  }
  async unifiedSkills() {
    const scanned = await this.scan();
    const state = await this.repository.read();
    const groups = new Map<string, any>();
    for (const instance of scanned.skills) {
      const key = this.unifiedKey(instance);
      const group = groups.get(key);
      if (group) {
        group.instances.push(instance);
        if (!group.description && instance.description)
          group.description = instance.description;
        if (
          instance.modifiedAt &&
          (!group.modifiedAt || instance.modifiedAt > group.modifiedAt)
        )
          group.modifiedAt = instance.modifiedAt;
        continue;
      }
      groups.set(key, {
        ...instance,
        skillId: hash(key),
        unifiedKey: key,
        instances: [instance],
      });
    }
    return {
      skills: [...groups.values()].map((group) => {
        const defaultDirectoryId = state.defaultDirectories?.[group.unifiedKey];
        const defaultInstance = group.instances.find(
          (instance: any) => instance.directoryId === defaultDirectoryId,
        );
        const primary = defaultInstance || group.instances[0];
        return {
          ...group,
          ...primary,
          skillId: group.skillId,
          unifiedKey: group.unifiedKey,
          instances: group.instances,
          defaultDirectoryId,
          defaultInstance: defaultInstance || null,
        };
      }),
      errors: scanned.errors,
    };
  }
  private async unifiedById(id: string) {
    return (await this.unifiedSkills()).skills.find(
      (skill) => skill.skillId === id,
    );
  }
  async setDefaultDirectory(skillId: string, directoryId: string | null) {
    return this.exclusive(async () => {
      const skill = await this.unifiedById(skillId);
      if (!skill)
        throw new Failure("SKILL_NOT_FOUND", "Skill 不存在，请刷新列表", 404);
      const state = await this.repository.read();
      if (directoryId === null) {
        delete state.defaultDirectories![skill.unifiedKey];
        delete state.syncFingerprints![skill.unifiedKey];
      } else {
        const directory = (await this.directories()).find(
          (item) => item.directoryId === directoryId && item.available,
        );
        if (!directory)
          throw new Failure("DIRECTORY_UNAVAILABLE", "默认目录不可用");
        if (
          !skill.instances.some(
            (instance: any) => instance.directoryId === directoryId,
          )
        )
          throw new Failure(
            "SKILL_NOT_FOUND",
            "默认目录中不存在这个 Skill",
            404,
          );
        state.defaultDirectories![skill.unifiedKey] = directoryId;
        state.syncFingerprints![skill.unifiedKey] = Object.fromEntries(
          skill.instances.map((instance: any) => [
            instance.directoryId,
            instance.fingerprint,
          ]),
        );
      }
      await this.repository.write(state);
      return { defaultDirectoryId: directoryId };
    });
  }
  async locate(id: string) {
    const scanned = await this.scan();
    let record = scanned.skills.find((s) => s.skillId === id);
    if (!record) {
      const unified = (await this.unifiedSkills()).skills.find(
        (skill) => skill.skillId === id,
      );
      record = unified?.defaultInstance || unified?.instances?.[0];
    }
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
    const unified = await this.unifiedById(id);
    const { record, file } = await this.locate(id);
    const content = await fs.readFile(file, "utf8");
    const primary = unified || record;
    const instances = unified?.instances || [record];
    const directories = await this.directories();
    const directoryUsages = await Promise.all(
      directories.map(async (directory) => {
        const instance = instances.find(
          (item: any) => item.directoryId === directory.directoryId,
        );
        const skillPath = path.join(
          directory.path,
          primary.directoryName || "SKILL.md",
          primary.directoryName ? "SKILL.md" : "",
        );
        let status = instance ? "installed" : "missing";
        if (!directory.available) status = "unavailable";
        else if (instance && unified?.defaultDirectoryId) {
          if (instance.directoryId === unified.defaultDirectoryId)
            status = "primary";
          else {
            const replicaContent = await fs.readFile(
              path.join(instance.realPath, "SKILL.md"),
              "utf8",
            );
            status =
              hash(replicaContent) === hash(content) ? "synced" : "conflict";
          }
        }
        return {
          directoryId: directory.directoryId,
          path: directory.path,
          skillPath,
          status,
          instance: instance || null,
        };
      }),
    );
    return {
      ...primary,
      content,
      fingerprint: hash(content),
      instances,
      defaultDirectoryId: unified?.defaultDirectoryId,
      defaultInstance: unified?.defaultInstance || null,
      directoryUsages,
    };
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
        const unified = await this.unifiedById(id);
        const located = await this.locate(id);
        file = located.file;
        const primaryRecord = located.record;
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
        const sync =
          unified?.defaultDirectoryId === primaryRecord.directoryId
            ? await this.syncCopies(unified, primaryRecord, content)
            : [];
        return { fingerprint: hash(content), sync };
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
  async install(id: string, directoryId: string) {
    return this.exclusive(async () => {
      const unified = await this.unifiedById(id);
      if (!unified)
        throw new Failure("SKILL_NOT_FOUND", "Skill 不存在，请刷新列表", 404);
      const source = unified.defaultInstance || unified.instances[0];
      const directories = await this.directories();
      const targetDirectory = directories.find(
        (directory) =>
          directory.directoryId === directoryId && directory.available,
      );
      if (!targetDirectory)
        throw new Failure("DIRECTORY_UNAVAILABLE", "目标目录不可用");
      if (source.directoryId === directoryId)
        throw new Failure(
          "SKILL_PATH_EXISTS",
          "目标目录已经安装这个 Skill",
          409,
        );

      const sourceFile = path.join(source.realPath, "SKILL.md");
      const targetPath = source.directoryName
        ? path.join(targetDirectory.path, source.directoryName)
        : path.join(targetDirectory.path, "SKILL.md");
      const existing = await fs.lstat(targetPath).catch((error: any) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (existing)
        throw new Failure(
          "SKILL_PATH_EXISTS",
          "目标目录已经安装这个 Skill",
          409,
        );

      try {
        if (source.directoryName) {
          await fs.mkdir(targetPath);
          await authorize(targetDirectory.path, targetPath);
          await this.copyDirectoryContents(
            source.realPath,
            source.realPath,
            targetDirectory.path,
            targetPath,
          );
        } else {
          await authorize(targetDirectory.path, targetDirectory.path);
          await this.copyFile(sourceFile, targetPath);
        }
        const state = await this.repository.read();
        state.syncFingerprints![unified.unifiedKey] = {
          ...(state.syncFingerprints![unified.unifiedKey] || {}),
          [directoryId]: source.fingerprint,
        };
        await this.repository.write(state);
        await this.recordOperation({
          operation: "copy",
          skillId: unified.skillId,
          directoryId,
          path: targetPath,
          status: "success",
          message: "一键安装 Skill",
        });
        return { status: "installed", directoryId, targetPath };
      } catch (error: any) {
        if (source.directoryName)
          await fs.rm(targetPath, { recursive: true, force: true });
        await this.recordOperation({
          operation: "copy",
          skillId: unified.skillId,
          directoryId,
          path: targetPath,
          status: "failed",
          errorCode: error.code || "IO_ERROR",
          message: error.message,
        });
        throw error;
      }
    });
  }
  private async syncCopies(unified: any, primary: any, content: string) {
    const state = await this.repository.read();
    const expected: Record<string, string> =
      state.syncFingerprints?.[unified.unifiedKey] || {};
    const fingerprints: Record<string, string> = {
      ...expected,
      [primary.directoryId]: hash(content),
    };
    const results: any[] = [];
    for (const instance of unified.instances) {
      if (instance.skillId === primary.skillId) continue;
      const targetFile = path.join(instance.realPath, "SKILL.md");
      try {
        const current = await fs.readFile(targetFile, "utf8");
        if (
          (expected[instance.directoryId] &&
            hash(current) !== expected[instance.directoryId]) ||
          (!expected[instance.directoryId] && hash(current) !== hash(content))
        ) {
          results.push({
            directoryId: instance.directoryId,
            path: targetFile,
            status: "conflict",
            message: "副本已被外部修改，未覆盖",
          });
          await this.recordOperation({
            operation: "sync",
            skillId: unified.skillId,
            directoryId: instance.directoryId,
            path: targetFile,
            status: "failed",
            errorCode: "CONFLICT",
            message: "副本已被外部修改，未覆盖",
          });
          continue;
        }
        await atomicWrite(targetFile, content);
        fingerprints[instance.directoryId] = hash(content);
        results.push({
          directoryId: instance.directoryId,
          path: targetFile,
          status: "synced",
        });
        await this.recordOperation({
          operation: "sync",
          skillId: unified.skillId,
          directoryId: instance.directoryId,
          path: targetFile,
          status: "success",
        });
      } catch (error: any) {
        results.push({
          directoryId: instance.directoryId,
          path: targetFile,
          status: "failed",
          message: error.message,
        });
        await this.recordOperation({
          operation: "sync",
          skillId: unified.skillId,
          directoryId: instance.directoryId,
          path: targetFile,
          status: "failed",
          errorCode: error.code || "IO_ERROR",
          message: error.message,
        });
      }
    }
    state.syncFingerprints![unified.unifiedKey] = fingerprints;
    await this.repository.write(state);
    return results;
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
  private async copyContext(skillIds: string[], targetDirectoryIds: string[]) {
    const sources = [] as Awaited<ReturnType<Manager["locate"]>>[];
    for (const skillId of [...new Set(skillIds)])
      sources.push(await this.locate(skillId));
    const sourceDirectoryPath = sources[0]?.record.sourceDirectoryPath;
    if (!sourceDirectoryPath)
      throw new Failure("SKILL_NOT_FOUND", "至少选择一个 Skill", 404);
    if (
      sources.some(
        (source) => source.record.sourceDirectoryPath !== sourceDirectoryPath,
      )
    )
      throw new Failure(
        "COPY_SOURCE_MISMATCH",
        "一次只能复制同一来源目录的 Skill",
      );
    const directories = await this.directories();
    const targets = [...new Set(targetDirectoryIds)].map((directoryId) => {
      const directory = directories.find(
        (item) => item.directoryId === directoryId && item.available,
      );
      if (!directory)
        throw new Failure("DIRECTORY_UNAVAILABLE", "目标登记目录不可用");
      return directory;
    });
    return { sources, targets };
  }
  async copyPreview(input: {
    skillIds: string[];
    targetDirectoryIds: string[];
  }) {
    const { sources, targets } = await this.copyContext(
      input.skillIds,
      input.targetDirectoryIds,
    );
    const items = [] as any[];
    for (const source of sources) {
      for (const directory of targets) {
        const target = path.join(directory.path, source.record.directoryName);
        const stat = await fs.lstat(target).catch((error: any) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (stat) await authorize(directory.path, target);
        items.push({
          skillId: hash(this.unifiedKey(source.record)),
          targetDirectoryId: directory.directoryId,
          targetPath: target,
          conflict: Boolean(stat),
        });
      }
    }
    return { items };
  }
  private async copyFile(source: string, target: string) {
    const targetStat = await fs.lstat(target).catch((error: any) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (targetStat?.isSymbolicLink())
      throw new Failure("PATH_NOT_ALLOWED", "目标文件不允许使用符号链接");
    await atomicWrite(target, await fs.readFile(source));
  }
  private async copyDirectoryContents(
    sourceRoot: string,
    source: string,
    targetRoot: string,
    target: string,
  ) {
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Failure("PATH_NOT_ALLOWED", "Skill 内不允许复制符号链接");
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true });
        await authorize(targetRoot, targetPath);
        await this.copyDirectoryContents(
          sourceRoot,
          sourcePath,
          targetRoot,
          targetPath,
        );
      } else if (entry.isFile()) {
        await this.copyFile(sourcePath, targetPath);
      }
    }
  }
  async copy(input: {
    skillIds: string[];
    targetDirectoryIds: string[];
    mode: "skill_md_only" | "full_directory";
    decisions: {
      skillId: string;
      targetDirectoryId: string;
      action: "skip" | "overwrite" | "cancel";
    }[];
  }) {
    return this.exclusive(async () => {
      const { sources, targets } = await this.copyContext(
        input.skillIds,
        input.targetDirectoryIds,
      );
      const decisions = new Map(
        input.decisions.map((item) => [
          `${item.skillId}:${item.targetDirectoryId}`,
          item.action,
        ]),
      );
      const results: any[] = [];
      for (const source of sources) {
        for (const directory of targets) {
          const target = path.join(directory.path, source.record.directoryName);
          const unifiedSkillId = hash(this.unifiedKey(source.record));
          const key = `${unifiedSkillId}:${directory.directoryId}`;
          let status: "success" | "failed" | "skipped" | "cancelled" =
            "success";
          let errorCode: string | undefined;
          let message: string | undefined;
          try {
            const existing = await fs.lstat(target).catch((error: any) => {
              if (error.code === "ENOENT") return undefined;
              throw error;
            });
            const decision = decisions.get(key);
            if (existing) {
              await authorize(directory.path, target);
              if (decision === "skip") {
                status = "skipped";
                message = "目标 Skill 已存在，已跳过";
              } else if (decision === "cancel") {
                status = "cancelled";
                message = "目标 Skill 已存在，已取消";
              } else if (decision !== "overwrite") {
                throw new Failure(
                  "COPY_DECISION_REQUIRED",
                  "目标 Skill 已存在，请选择处理方式",
                );
              }
            }
            if (status === "success") {
              if (!existing) await fs.mkdir(target);
              await authorize(directory.path, target);
              if (!(await fs.stat(target)).isDirectory())
                throw new Failure("SKILL_PATH_EXISTS", "目标 Skill 不是目录");
              if (input.mode === "skill_md_only")
                await this.copyFile(source.file, path.join(target, "SKILL.md"));
              else
                await this.copyDirectoryContents(
                  source.record.realPath,
                  source.record.realPath,
                  directory.path,
                  target,
                );
            }
          } catch (error: any) {
            status = "failed";
            errorCode = error.code || "IO_ERROR";
            message = error.message;
          }
          const result = {
            skillId: unifiedSkillId,
            directoryId: directory.directoryId,
            targetPath: target,
            status,
            ...(message ? { message } : {}),
          };
          results.push(result);
          await this.recordOperation({
            operation: "copy",
            skillId: unifiedSkillId,
            directoryId: directory.directoryId,
            path: target,
            status,
            errorCode,
            message,
          });
        }
      }
      return { results };
    });
  }
  private async syncContext(
    sourceDirectoryId: string,
    targetDirectoryIds: string[],
  ) {
    const directories = await this.directories();
    const sourceDirectory = directories.find(
      (item) => item.directoryId === sourceDirectoryId && item.available,
    );
    if (!sourceDirectory)
      throw new Failure("DIRECTORY_UNAVAILABLE", "源登记目录不可用");
    const targets = [...new Set(targetDirectoryIds)].map((directoryId) => {
      const directory = directories.find(
        (item) => item.directoryId === directoryId && item.available,
      );
      if (!directory)
        throw new Failure("DIRECTORY_UNAVAILABLE", "目标登记目录不可用");
      if (directory.directoryId === sourceDirectory.directoryId)
        throw new Failure("SYNC_SOURCE_TARGET", "源目录不能作为同步目标");
      return directory;
    });
    const sourceSkills = (await this.scan()).skills.filter(
      (skill) => skill.directoryId === sourceDirectory.directoryId,
    );
    const targetSkills = (await this.scan()).skills;
    const match = (source: any, target: any) =>
      source.isRootSkill
        ? target.isRootSkill &&
          source.fileStatus === "normal" &&
          target.fileStatus === "normal" &&
          Boolean(source.name) &&
          source.name === target.name
        : !target.isRootSkill && source.directoryName === target.directoryName;
    return { sourceDirectory, targets, sourceSkills, targetSkills, match };
  }
  async syncPreview(input: {
    sourceDirectoryId: string;
    targetDirectoryIds: string[];
  }) {
    const { sourceSkills, targets, targetSkills, match } =
      await this.syncContext(input.sourceDirectoryId, input.targetDirectoryIds);
    const items: any[] = [];
    for (const source of sourceSkills) {
      for (const directory of targets) {
        const target = targetSkills.find(
          (candidate) =>
            candidate.directoryId === directory.directoryId &&
            match(source, candidate),
        );
        items.push({
          sourceSkillId: hash(this.unifiedKey(source)),
          targetDirectoryId: directory.directoryId,
          skillName: source.name || source.directoryName,
          targetPath: target?.realPath || null,
          match: Boolean(target),
          conflict: Boolean(target),
          ...(target
            ? { targetSkillId: target.skillId }
            : { reason: "TARGET_MISSING" }),
        });
      }
    }
    return { items };
  }
  async sync(input: {
    sourceDirectoryId: string;
    targetDirectoryIds: string[];
    decisions: {
      sourceSkillId: string;
      targetDirectoryId: string;
      action: "skip" | "overwrite" | "cancel";
    }[];
  }) {
    return this.exclusive(async () => {
      const { sourceSkills, targets, targetSkills, match } =
        await this.syncContext(
          input.sourceDirectoryId,
          input.targetDirectoryIds,
        );
      const decisions = new Map(
        input.decisions.map((item) => [
          `${item.sourceSkillId}:${item.targetDirectoryId}`,
          item.action,
        ]),
      );
      const results: any[] = [];
      for (const source of sourceSkills) {
        for (const directory of targets) {
          const targetSkill = targetSkills.find(
            (candidate) =>
              candidate.directoryId === directory.directoryId &&
              match(source, candidate),
          );
          const targetPath = targetSkill?.realPath;
          const unifiedSkillId = hash(this.unifiedKey(source));
          const key = `${unifiedSkillId}:${directory.directoryId}`;
          let status: "success" | "failed" | "skipped" | "cancelled" =
            "skipped";
          let errorCode: string | undefined;
          let message = "目标没有相同 Skill，已跳过";
          try {
            if (targetSkill && targetPath) {
              const action = decisions.get(key);
              if (action === "skip") message = "已按选择跳过";
              else if (action === "cancel") {
                status = "cancelled";
                message = "已按选择取消";
              } else if (action !== "overwrite") {
                throw new Failure(
                  "SYNC_DECISION_REQUIRED",
                  "请先选择覆盖、跳过或取消",
                );
              } else {
                const sourceFile = path.join(source.realPath, "SKILL.md");
                const targetFile = path.join(targetPath, "SKILL.md");
                if (source.isRootSkill) {
                  await this.copyFile(sourceFile, targetFile);
                } else {
                  await this.copyDirectoryContents(
                    source.realPath,
                    source.realPath,
                    directory.path,
                    targetPath,
                  );
                }
                status = "success";
                message = "同步成功";
              }
            }
          } catch (error: any) {
            status = "failed";
            errorCode = error.code || "IO_ERROR";
            message = error.message;
          }
          const result = {
            sourceSkillId: unifiedSkillId,
            directoryId: directory.directoryId,
            targetPath:
              targetPath ||
              path.join(directory.path, source.directoryName || "SKILL.md"),
            status,
            message,
          };
          results.push(result);
          await this.recordOperation({
            operation: "sync",
            skillId: unifiedSkillId,
            directoryId: directory.directoryId,
            path: result.targetPath,
            status,
            errorCode,
            message,
          });
        }
      }
      return { results };
    });
  }
}
