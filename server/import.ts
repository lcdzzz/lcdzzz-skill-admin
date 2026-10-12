import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import YAML from "yaml";
import { authorize, Failure, hash } from "./storage.js";

const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = MAX_BYTES + 1024 * 1024;
const MAX_FILES = 1000;

type SkillFile = { path: string; data: Buffer; mode?: number };
export type ImportSkill = {
  directoryName: string;
  name: string;
  description: string;
  files: SkillFile[];
};
export type ImportPackage = { skills: ImportSkill[]; totalBytes: number };

function invalid(message: string): never {
  throw new Failure("IMPORT_INVALID", message);
}
function tooLarge(): never {
  throw new Failure(
    "IMPORT_TOO_LARGE",
    "分享包超过 100 个 Skill、1000 个文件或 100 MB",
  );
}
const caseKey = (value: string) => value.normalize("NFC").toLowerCase();

function checkPart(part: string) {
  if (
    !part ||
    part === "." ||
    part === ".." ||
    /[\\:<>"|?*\x00-\x1f]/.test(part) ||
    /[. ]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
  )
    invalid("分享包含有不安全或不支持的文件路径");
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(data: Buffer) {
  let value = 0xffffffff;
  for (const byte of data)
    value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

/** Validate central and local headers before allocating any expanded file. */
export function readImportPackage(archive: Buffer): ImportPackage {
  if (!Buffer.isBuffer(archive) || archive.length < 22)
    invalid("请选择有效的 Skill ZIP 分享包");
  if (archive.length > MAX_UPLOAD_BYTES) tooLarge();
  let end = archive.length - 22;
  for (; end >= Math.max(0, archive.length - 65557); end--) {
    if (
      archive.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + archive.readUInt16LE(end + 20) === archive.length
    )
      break;
  }
  if (end < Math.max(0, archive.length - 65557)) invalid("ZIP 文件已损坏");
  const count = archive.readUInt16LE(end + 10);
  const start = archive.readUInt32LE(end + 16);
  const size = archive.readUInt32LE(end + 12);
  if (
    archive.readUInt16LE(end + 4) ||
    archive.readUInt16LE(end + 6) ||
    archive.readUInt16LE(end + 8) !== count ||
    start + size !== end ||
    !count
  )
    invalid("不支持该 ZIP 格式，请使用管理器导出的分享包");
  if (count > 2001) tooLarge();

  const entries: {
    name: string;
    offset: number;
    size: number;
    originalSize: number;
    compression: number;
    crc: number;
    mode: number;
  }[] = [];
  const paths = new Map<string, { name: string; directory: boolean }>();
  let cursor = start,
    totalBytes = 0,
    fileCount = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50)
      invalid("ZIP 目录已损坏");
    const flags = archive.readUInt16LE(cursor + 8);
    const compression = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const originalSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const next =
      cursor +
      46 +
      nameLength +
      archive.readUInt16LE(cursor + 30) +
      archive.readUInt16LE(cursor + 32);
    if (
      next > end ||
      archive.readUInt16LE(cursor + 34) ||
      flags & 1 ||
      ![0, 8].includes(compression)
    )
      invalid("不支持加密或该压缩格式的 ZIP");
    const mode = archive.readUInt32LE(cursor + 38) >>> 16;
    const fileType = mode & 0xf000;
    if (fileType && fileType !== 0x8000 && fileType !== 0x4000)
      invalid("分享包不允许包含符号链接或特殊文件");
    let name: string;
    try {
      name = decoder.decode(
        archive.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      invalid("ZIP 文件名不是有效的 UTF-8 文本");
    }
    const directory = name!.endsWith("/");
    const parts = (directory ? name!.slice(0, -1) : name!).split("/");
    parts.forEach(checkPart);
    if (
      !(parts[0] === "skills" && (directory || parts.length >= 3)) &&
      name! !== "README.txt"
    )
      invalid("请选择管理器导出的 Skill 分享包（skills/ 目录结构）");
    if (parts[1]?.startsWith(".")) invalid("分享包的 Skill 目录名不能以点开头");
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join("/");
      const key = caseKey(prefix);
      const isDirectory = depth < parts.length || directory;
      const previous = paths.get(key);
      if (
        previous &&
        (previous.name !== prefix ||
          previous.directory !== isDirectory ||
          (!isDirectory && depth === parts.length))
      )
        invalid("分享包包含重复路径、大小写冲突或文件与目录冲突");
      paths.set(key, { name: prefix, directory: isDirectory });
    }
    if (directory && originalSize !== 0) invalid("ZIP 目录条目包含文件内容");
    if (!directory) {
      if (++fileCount > MAX_FILES + 1) tooLarge();
      totalBytes += originalSize;
      if (
        totalBytes > MAX_UPLOAD_BYTES ||
        (name! !== "README.txt" && originalSize > MAX_BYTES)
      )
        tooLarge();
      const local = archive.readUInt32LE(cursor + 42);
      if (local + 30 > start || archive.readUInt32LE(local) !== 0x04034b50)
        invalid("ZIP 文件头已损坏");
      const localNameLength = archive.readUInt16LE(local + 26);
      const offset =
        local + 30 + localNameLength + archive.readUInt16LE(local + 28);
      if (
        offset + compressedSize > start ||
        archive.readUInt16LE(local + 8) !== compression ||
        archive.readUInt16LE(local + 6) !== flags ||
        !archive
          .subarray(local + 30, local + 30 + localNameLength)
          .equals(archive.subarray(cursor + 46, cursor + 46 + nameLength))
      )
        invalid("ZIP 文件头与目录不一致");
      entries.push({
        name: name!,
        offset,
        size: compressedSize,
        originalSize,
        compression,
        crc: archive.readUInt32LE(cursor + 16),
        mode,
      });
    }
    cursor = next;
  }
  if (cursor !== end) invalid("ZIP 目录长度不一致");
  const skills = new Map<string, ImportSkill>();
  totalBytes = 0;
  for (const entry of entries) {
    const compressed = archive.subarray(
      entry.offset,
      entry.offset + entry.size,
    );
    let data: Buffer;
    try {
      data =
        entry.compression === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.originalSize),
            });
    } catch {
      invalid("ZIP 文件无法解压或解压尺寸不一致");
    }
    if (data!.length !== entry.originalSize || crc32(data!) !== entry.crc)
      invalid("ZIP 文件校验失败，分享包可能已损坏");
    if (entry.name === "README.txt") continue;
    totalBytes += data!.length;
    if (totalBytes > MAX_BYTES) tooLarge();
    const [, directoryName, ...relative] = entry.name.split("/");
    if (!skills.has(directoryName))
      skills.set(directoryName, {
        directoryName,
        name: directoryName,
        description: "",
        files: [],
      });
    skills.get(directoryName)!.files.push({
      path: relative.join("/"),
      data: data!,
      mode: entry.mode & 0o777 || 0o600,
    });
  }
  if (!skills.size) invalid("分享包没有可导入的 Skill");
  if (
    skills.size > 100 ||
    entries.filter((entry) => entry.name !== "README.txt").length > MAX_FILES
  )
    tooLarge();
  for (const skill of skills.values()) {
    const file = skill.files.find((item) => item.path === "SKILL.md");
    if (!file) invalid(`${skill.directoryName} 缺少 SKILL.md`);
    if (file.data.length > 4 * 1024 * 1024)
      invalid(`${skill.directoryName} 的 SKILL.md 超过 4 MB`);
    let content: string;
    try {
      content = decoder.decode(file.data);
    } catch {
      invalid(`${skill.directoryName} 的 SKILL.md 不是有效 UTF-8 文本`);
    }
    if (/^---\r?\n/.test(content!)) {
      const match = content!.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (!match) invalid(`${skill.directoryName} 的 YAML 缺少结束标记`);
      try {
        const metadata = YAML.parse(match[1]);
        if (typeof metadata?.name === "string" && metadata.name)
          skill.name = metadata.name;
        if (typeof metadata?.description === "string")
          skill.description = metadata.description;
      } catch {
        invalid(`${skill.directoryName} 的 YAML 无法解析`);
      }
    }
  }
  return { skills: [...skills.values()], totalBytes };
}

type ExistingTree = {
  files: SkillFile[];
  directories: { path: string; mode: number }[];
  fingerprint: string;
};
async function readTree(root: string): Promise<ExistingTree> {
  const files: SkillFile[] = [],
    directories: { path: string; mode: number }[] = [];
  let bytes = 0;
  const digest = createHash("sha256");
  async function visit(relative: string) {
    const file = path.join(root, relative);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Failure(
        "PATH_NOT_ALLOWED",
        "目标 Skill 含有符号链接或特殊文件，只能跳过",
      );
    await authorize(root, file);
    digest.update(JSON.stringify([relative, stat.mode, stat.mtimeMs]));
    if (stat.isDirectory()) {
      if (directories.length > 2000) tooLarge();
      directories.push({ path: relative, mode: stat.mode & 0o777 });
      for (const name of (await fs.readdir(file)).sort())
        await visit(relative ? `${relative}/${name}` : name);
    } else {
      if (files.length >= MAX_FILES || bytes + stat.size > MAX_BYTES)
        throw new Failure(
          "IMPORT_TOO_LARGE",
          "本地 Skill 超过 1000 个文件或 100 MB，只能跳过",
        );
      const handle = await fs.open(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
      );
      let data: Buffer;
      try {
        data = await handle.readFile();
      } finally {
        await handle.close();
      }
      bytes += data.length;
      if (bytes > MAX_BYTES) tooLarge();
      digest.update(createHash("sha256").update(data).digest());
      files.push({ path: relative, data, mode: stat.mode & 0o777 });
    }
  }
  await visit("");
  return { files, directories, fingerprint: digest.digest("hex") };
}

export async function inspectImportTarget(root: string, skill: ImportSkill) {
  await authorize(root, root);
  const matches = (await fs.readdir(root)).filter(
    (name) => caseKey(name) === caseKey(skill.directoryName),
  );
  const targetPath = path.join(root, matches[0] || skill.directoryName);
  const stat = await fs.lstat(targetPath).catch((error: any) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const base = {
    directoryName: skill.directoryName,
    name: skill.name,
    description: skill.description,
    targetPath,
    conflict: Boolean(stat),
  };
  if (!stat)
    return {
      ...base,
      canOverwrite: true,
      fingerprint: "missing",
      tree: undefined,
    };
  try {
    if (matches.length > 1 || stat.isSymbolicLink() || !stat.isDirectory())
      throw new Failure(
        "PATH_NOT_ALLOWED",
        "目标路径不是普通目录或存在大小写冲突，只能跳过",
      );
    const tree = await readTree(targetPath);
    const existing = new Map<string, { path: string; directory: boolean }>();
    tree.files.forEach((file) =>
      existing.set(caseKey(file.path), { path: file.path, directory: false }),
    );
    tree.directories.forEach((directory) =>
      existing.set(caseKey(directory.path), {
        path: directory.path,
        directory: true,
      }),
    );
    for (const file of skill.files) {
      const parts = file.path.split("/");
      for (let depth = 1; depth <= parts.length; depth++) {
        const relative = parts.slice(0, depth).join("/");
        const current = existing.get(caseKey(relative));
        if (
          current &&
          (current.path !== relative ||
            current.directory !== depth < parts.length)
        )
          throw new Failure(
            "PATH_NOT_ALLOWED",
            "本地文件和分享包存在路径类型或大小写冲突，只能跳过",
          );
      }
    }
    return { ...base, canOverwrite: true, fingerprint: tree.fingerprint, tree };
  } catch (error: any) {
    return {
      ...base,
      canOverwrite: false,
      message: error.message,
      fingerprint: hash(
        JSON.stringify([stat.mode, stat.mtimeMs, stat.ino, matches]),
      ),
      tree: undefined,
    };
  }
}

export type ImportTarget = Awaited<ReturnType<typeof inspectImportTarget>>;

/** Build a complete next copy first; restore the previous directory on publish failure. */
export async function installImportedSkill(
  root: string,
  skill: ImportSkill,
  target: ImportTarget,
) {
  const transaction = await fs.mkdtemp(path.join(root, ".skill-import-"));
  const next = path.join(transaction, "next"),
    previous = path.join(transaction, "previous");
  let movedPrevious = false,
    reservedNew = false,
    preserveRecovery = false;
  try {
    await fs.chmod(transaction, 0o700);
    await fs.mkdir(next);
    for (const file of target.tree?.files || []) {
      const destination = path.join(next, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.data, { mode: file.mode });
    }
    for (const file of skill.files) {
      const destination = path.join(next, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.data, { mode: file.mode });
    }
    for (const directory of target.tree?.directories || []) {
      await fs.mkdir(path.join(next, directory.path), { recursive: true });
      await fs.chmod(path.join(next, directory.path), directory.mode);
    }
    const current = await inspectImportTarget(root, skill);
    if (
      current.fingerprint !== target.fingerprint ||
      current.targetPath !== target.targetPath
    )
      throw new Failure("CONFLICT", "目标 Skill 已改变，请重新预览");
    if (target.conflict) {
      await fs.rename(target.targetPath, previous);
      movedPrevious = true;
      await fs.rename(next, target.targetPath);
      movedPrevious = false;
    } else {
      await fs.mkdir(target.targetPath);
      reservedNew = true;
      const names = (await fs.readdir(next)).filter(
        (name) => name !== "SKILL.md",
      );
      names.push("SKILL.md");
      for (const name of names)
        await fs.rename(
          path.join(next, name),
          path.join(target.targetPath, name),
        );
      reservedNew = false;
    }
  } catch (error) {
    try {
      if (movedPrevious) await fs.rename(previous, target.targetPath);
      if (reservedNew)
        await fs.rm(target.targetPath, { recursive: true, force: true });
    } catch {
      preserveRecovery = true;
      throw new Failure(
        "IMPORT_ROLLBACK_FAILED",
        `导入恢复失败，请保留恢复目录：${transaction}`,
        500,
      );
    }
    throw error;
  } finally {
    if (!preserveRecovery)
      await fs
        .rm(transaction, { recursive: true, force: true })
        .catch(() => {});
  }
}
