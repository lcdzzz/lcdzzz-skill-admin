import * as fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync, type Zippable } from "fflate";
import { authorize, Failure, inside } from "./storage.js";

const MAX_FILES = 1000;
const MAX_BYTES = 100 * 1024 * 1024;
const excludedNames = new Set([
  ".git",
  ".skill-manager",
  ".DS_Store",
  "node_modules",
  "Thumbs.db",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
]);

export type ExportSource = {
  name: string;
  directoryName: string | null;
  realPath: string;
  rootPath: string;
};

type ArchiveFile = { path: string; data: Uint8Array; mode: number };

function excluded(name: string) {
  return (
    excludedNames.has(name) ||
    name === ".env" ||
    name.startsWith(".env.") ||
    /\.(pem|key|p12|pfx)$/i.test(name)
  );
}

function safeSegment(name: string) {
  const segment = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "");
  return segment && segment !== "." && segment !== ".." ? segment : "skill";
}

function validEntryName(name: string) {
  if (name === "." || name === ".." || /[\\:\x00-\x1f]/.test(name))
    throw new Failure("PATH_NOT_ALLOWED", "Skill 含有无法安全打包的文件名");
}

export async function prepareExport(sources: ExportSource[]) {
  const files: ArchiveFile[] = [];
  const omitted: { path: string; reason: string }[] = [];
  const usedNames = new Set<string>();
  let totalBytes = 0;

  for (const source of sources) {
    const skillPath = await authorize(source.rootPath, source.realPath);
    if (!(await fs.stat(skillPath)).isDirectory())
      throw new Failure("SKILL_INVALID", "Skill 目录不可用");
    const baseName = safeSegment(source.directoryName || source.name);
    let folderName = baseName;
    for (
      let suffix = 2;
      usedNames.has(folderName.toLocaleLowerCase());
      suffix++
    )
      folderName = `${baseName}-${suffix}`;
    usedNames.add(folderName.toLocaleLowerCase());
    const archiveRoot = `skills/${folderName}`;

    async function visit(current: string, relative: string) {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink())
        throw new Failure("PATH_NOT_ALLOWED", "Skill 内不允许导出符号链接");
      const real = await authorize(source.rootPath, current);
      if (!inside(skillPath, real))
        throw new Failure("PATH_NOT_ALLOWED", "Skill 文件超出自身目录");
      if (stat.isDirectory()) {
        const entries = (await fs.readdir(current)).sort();
        for (const name of entries) {
          validEntryName(name);
          const entryRelative = relative ? `${relative}/${name}` : name;
          const archivePath = `${archiveRoot}/${entryRelative}`;
          if (excluded(name)) {
            omitted.push({ path: archivePath, reason: "私有或生成文件" });
            continue;
          }
          await visit(path.join(current, name), entryRelative);
        }
      } else if (stat.isFile()) {
        if (files.length >= MAX_FILES || totalBytes + stat.size > MAX_BYTES)
          throw new Failure(
            "EXPORT_TOO_LARGE",
            "导出超过 1000 个文件或 100 MB，请减少选择",
          );
        const handle = await fs.open(
          current,
          fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
        );
        let data: Buffer;
        try {
          data = await handle.readFile();
        } finally {
          await handle.close();
        }
        totalBytes += data.byteLength;
        if (totalBytes > MAX_BYTES)
          throw new Failure("EXPORT_TOO_LARGE", "导出超过 100 MB，请减少选择");
        files.push({
          path: `${archiveRoot}/${relative}`,
          data,
          mode: stat.mode & 0o777,
        });
      } else {
        throw new Failure("PATH_NOT_ALLOWED", "Skill 包含无法导出的文件类型");
      }
    }

    if (source.directoryName === null) {
      await visit(path.join(skillPath, "SKILL.md"), "SKILL.md");
    } else {
      await visit(skillPath, "");
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  omitted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fingerprintHash = createHash("sha256");
  for (const file of files) {
    fingerprintHash.update(JSON.stringify([file.path, file.mode]));
    fingerprintHash.update("\0");
    fingerprintHash.update(createHash("sha256").update(file.data).digest());
  }
  const fingerprint = fingerprintHash.digest("hex");
  return {
    files,
    omitted,
    fingerprint,
    totalBytes,
    skillCount: sources.length,
  };
}

export function makeExportZip(
  prepared: Awaited<ReturnType<typeof prepareExport>>,
) {
  const contents: Zippable = Object.create(null);
  contents["README.txt"] = strToU8(
    "Skill 分享包\n\n在管理器中点击“导入分享包”，选择本 ZIP 和目标 Skill 根目录，" +
      "预览后点击“开始导入”。同名 Skill 可选择跳过或覆盖。\n" +
      "管理器请单独从项目发布页获取。旧版管理器可手动复制 skills/ 下的 Skill 文件夹。\n" +
      "安装前请检查 Skill 指令和脚本。\n",
  );
  for (const file of prepared.files)
    contents[file.path] = [
      file.data,
      { os: 3, attrs: ((0x8000 | file.mode) << 16) >>> 0 },
    ];
  return Buffer.from(zipSync(contents, { level: 6 }));
}
