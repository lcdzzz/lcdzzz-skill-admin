import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export class Failure extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};
export async function authorize(root: string, candidate: string) {
  const real = await fs.realpath(candidate);
  if (!inside(root, real))
    throw new Failure("PATH_NOT_ALLOWED", "符号链接或路径超出登记目录");
  return real;
}
export async function atomicWrite(file: string, content: string) {
  const temporary = path.join(
    path.dirname(file),
    `.skill-manager-${randomUUID()}.tmp`,
  );
  try {
    const existing = await fs.stat(file).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    const handle = await fs.open(
      temporary,
      "wx",
      existing ? existing.mode & 0o777 : 0o600,
    );
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
export type State = {
  schemaVersion: 1;
  directories: { path: string; enabled: boolean }[];
  skills: Record<string, unknown>;
};
export type Operation = {
  id: string;
  operation: "create" | "read" | "update" | "delete";
  skillId?: string;
  directoryId?: string;
  path?: string;
  status: "success" | "failed" | "rolled_back";
  errorCode?: string;
  message?: string;
  createdAt: string;
};
export class Repository {
  private operationQueue: Promise<unknown> = Promise.resolve();
  constructor(public directory: string) {}
  async prepare() {
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.realpath(this.directory)) !== this.directory)
      throw new Failure("PATH_NOT_ALLOWED", "元数据目录不允许使用符号链接");
    const file = path.join(this.directory, "state.json");
    const stat = await fs.lstat(file).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat?.isSymbolicLink())
      throw new Failure("PATH_NOT_ALLOWED", "状态文件不允许使用符号链接");
    return file;
  }
  async read(): Promise<State> {
    const file = await this.prepare();
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      const empty: State = { schemaVersion: 1, directories: [], skills: {} };
      await atomicWrite(file, JSON.stringify(empty, null, 2));
      return empty;
    }
    try {
      const value = JSON.parse(raw);
      if (
        value.schemaVersion !== 1 ||
        !Array.isArray(value.directories) ||
        !value.skills ||
        Array.isArray(value.skills) ||
        typeof value.skills !== "object" ||
        value.directories.some(
          (d: any) =>
            typeof d.path !== "string" ||
            !path.isAbsolute(d.path) ||
            typeof d.enabled !== "boolean",
        )
      )
        throw Error();
      return value;
    } catch {
      throw new Failure(
        "METADATA_CORRUPTED",
        `元数据损坏，请检查 ${file}`,
        503,
      );
    }
  }
  async write(state: State) {
    await this.read();
    await atomicWrite(await this.prepare(), JSON.stringify(state, null, 2));
  }
  async operations(): Promise<Operation[]> {
    await this.prepare();
    const file = path.join(this.directory, "operations.json");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      await atomicWrite(file, "[]\n");
      return [];
    }
    try {
      const value = JSON.parse(raw);
      if (!Array.isArray(value)) throw Error();
      return value;
    } catch {
      throw new Failure(
        "METADATA_CORRUPTED",
        `操作记录损坏，请检查 ${file}`,
        503,
      );
    }
  }
  async appendOperation(operation: Omit<Operation, "id" | "createdAt">) {
    const result = this.operationQueue.then(async () => {
      const operations = await this.operations();
      operations.push({
        ...operation,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      });
      await atomicWrite(
        path.join(this.directory, "operations.json"),
        JSON.stringify(operations, null, 2),
      );
    });
    this.operationQueue = result.catch(() => {});
    return result;
  }
}
