import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { strToU8, zipSync } from "fflate";
import { createApp } from "../server/app";
import { Manager } from "../server/service";
import { Repository } from "../server/storage";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let temporary: string,
  root: string,
  manager: Manager,
  app: ReturnType<typeof createApp>;
beforeEach(async () => {
  temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "skill-import-test-")),
  );
  root = path.join(temporary, "target");
  await fs.mkdir(root);
  manager = new Manager(new Repository(path.join(temporary, ".skill-manager")));
  app = createApp(manager);
});
afterEach(async () => {
  vi.resetAllMocks();
  await fs.rm(temporary, { recursive: true, force: true });
});
const pack = (files: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, content]) => [
          name,
          strToU8(content),
        ]),
      ),
    ),
  );
const preview = (archive: Buffer, directoryId: string) =>
  request(app)
    .post("/api/skills/import/preview")
    .set("Host", "127.0.0.1")
    .query({ directoryId })
    .set("Content-Type", "application/zip")
    .send(archive);
const execute = (
  data: any,
  decisions: { directoryName: string; action: string }[],
) =>
  request(app).post("/api/skills/import").set("Host", "127.0.0.1").send({
    importId: data.importId,
    expectedFingerprint: data.fingerprint,
    decisions,
  });

describe("导入 Skill 分享包", () => {
  it("直接导入当前导出的 ZIP 并保留辅助文件，预览不写入目标", async () => {
    const source = path.join(temporary, "source");
    await fs.mkdir(path.join(source, "sample", "references"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, "sample/SKILL.md"),
      "---\nname: sample\ndescription: 演示\n---\n# Skill\n",
    );
    await fs.writeFile(
      path.join(source, "sample/references/guide.md"),
      "guide",
    );
    await fs.mkdir(path.join(source, "sample/scripts"));
    await fs.writeFile(
      path.join(source, "sample/scripts/run.sh"),
      "#!/bin/sh\nexit 0\n",
    );
    await fs.chmod(path.join(source, "sample/scripts/run.sh"), 0o700);
    await manager.register(source);
    const directory = await manager.register(root);
    const selected = (await manager.unifiedSkills()).skills[0].skillId;
    const exported = await manager.exportPreview([selected]);
    const archive = await manager.exportZip([selected], exported.fingerprint);
    const checked = await preview(archive, directory.directoryId);
    expect(checked.status).toBe(200);
    expect(checked.body.data.items[0]).toMatchObject({
      directoryName: "sample",
      name: "sample",
      conflict: false,
    });
    expect(await fs.readdir(root)).toEqual([]);
    const imported = await execute(checked.body.data, [
      { directoryName: "sample", action: "install" },
    ]);
    expect(imported.status).toBe(200);
    expect(imported.body.data.results[0].status).toBe("success");
    expect(
      await fs.readFile(path.join(root, "sample/references/guide.md"), "utf8"),
    ).toBe("guide");
    if (process.platform !== "win32")
      expect(
        (await fs.stat(path.join(root, "sample/scripts/run.sh"))).mode & 0o777,
      ).toBe(0o700);
    expect((await manager.unifiedSkills()).skills[0].instances).toHaveLength(2);
    expect((await manager.operations(10))[0].operation).toBe("import");
    expect((await execute(checked.body.data, [])).body.error.code).toBe(
      "IMPORT_EXPIRED",
    );
  });

  it.each([false, true])(
    "发布文件失败时恢复原 Skill 或移除未完成的新安装（已有=%s）",
    async (existing) => {
      const directory = await manager.register(root);
      if (existing) {
        await fs.mkdir(path.join(root, "sample"));
        await fs.writeFile(path.join(root, "sample/SKILL.md"), "original");
      }
      const checked = await preview(
        pack({
          "skills/sample/SKILL.md": "shared",
          "skills/sample/extra.txt": "extra",
        }),
        directory.directoryId,
      );
      expect(checked.status).toBe(200);
      const { rename } =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(fs.rename).mockImplementation(async (source, target) => {
        if (
          String(source).includes(".skill-import-") &&
          String(source).endsWith(
            existing ? `${path.sep}next` : path.join("next", "SKILL.md"),
          )
        )
          throw Object.assign(new Error("publish failure"), { code: "EIO" });
        return rename(source, target);
      });
      const imported = await execute(checked.body.data, [
        { directoryName: "sample", action: existing ? "overwrite" : "install" },
      ]);
      expect(imported.body.data.results[0].status).toBe("failed");
      expect(await fs.readdir(root)).toEqual(existing ? ["sample"] : []);
      if (existing)
        expect(
          await fs.readFile(path.join(root, "sample/SKILL.md"), "utf8"),
        ).toBe("original");
    },
  );

  it("同名目标默认可跳过，明确覆盖时保留本地独有文件", async () => {
    const directory = await manager.register(root);
    await fs.mkdir(path.join(root, "sample"));
    await fs.writeFile(path.join(root, "sample/SKILL.md"), "local");
    await fs.writeFile(path.join(root, "sample/local.txt"), "keep me");
    const archive = pack({
      "skills/sample/SKILL.md": "shared",
      "skills/sample/references/new.txt": "new",
    });
    let checked = await preview(archive, directory.directoryId);
    expect(checked.body.data.items[0].conflict).toBe(true);
    expect(
      (
        await execute(checked.body.data, [
          { directoryName: "sample", action: "install" },
        ])
      ).status,
    ).toBe(409);
    const skipped = await execute(checked.body.data, [
      { directoryName: "sample", action: "skip" },
    ]);
    expect(skipped.body.data.results[0].status).toBe("skipped");
    expect(await fs.readFile(path.join(root, "sample/SKILL.md"), "utf8")).toBe(
      "local",
    );
    checked = await preview(archive, directory.directoryId);
    const overwritten = await execute(checked.body.data, [
      { directoryName: "sample", action: "overwrite" },
    ]);
    expect(overwritten.body.data.results[0].status).toBe("success");
    expect(await fs.readFile(path.join(root, "sample/SKILL.md"), "utf8")).toBe(
      "shared",
    );
    expect(await fs.readFile(path.join(root, "sample/local.txt"), "utf8")).toBe(
      "keep me",
    );
    expect(await fs.readdir(root)).toEqual(["sample"]);
  });

  it("预览后目标被外部修改时拦截整次导入", async () => {
    const directory = await manager.register(root);
    await fs.mkdir(path.join(root, "sample"));
    await fs.writeFile(path.join(root, "sample/SKILL.md"), "local");
    const checked = await preview(
      pack({
        "skills/sample/SKILL.md": "shared",
        "skills/new/SKILL.md": "new",
      }),
      directory.directoryId,
    );
    expect(checked.status).toBe(200);
    await fs.writeFile(path.join(root, "sample/SKILL.md"), "changed outside");
    const imported = await execute(checked.body.data, [
      { directoryName: "sample", action: "overwrite" },
      { directoryName: "new", action: "install" },
    ]);
    expect(imported.status).toBe(409);
    expect(imported.body.error.code).toBe("CONFLICT");
    expect(await fs.readdir(root)).toEqual(["sample"]);
    expect(await fs.readFile(path.join(root, "sample/SKILL.md"), "utf8")).toBe(
      "changed outside",
    );
  });

  it.each([
    [
      "越界路径",
      {
        "skills/sample/SKILL.md": "skill",
        "skills/sample/../../escaped.txt": "bad",
      },
    ],
    ["绝对路径", { "/tmp/escaped.txt": "bad" }],
    ["缺少 SKILL.md", { "skills/sample/guide.md": "guide" }],
    [
      "大小写重复路径",
      { "skills/sample/SKILL.md": "one", "skills/sample/skill.md": "two" },
    ],
    ["异常 YAML", { "skills/sample/SKILL.md": "---\nname: [\n---\n" }],
  ])("拒绝%s且不产生文件", async (_name, files) => {
    const directory = await manager.register(root);
    const checked = await preview(pack(files), directory.directoryId);
    expect(checked.status).toBe(400);
    expect(checked.body.error.code).toBe("IMPORT_INVALID");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("拒绝损坏包及伪造超大解压尺寸", async () => {
    const directory = await manager.register(root);
    expect(
      (await preview(Buffer.from("not a zip"), directory.directoryId)).status,
    ).toBe(400);
    const archive = pack({ "skills/sample/SKILL.md": "skill" });
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE(101 * 1024 * 1024, central + 24);
    const oversized = await preview(archive, directory.directoryId);
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.code).toBe("IMPORT_TOO_LARGE");
  });

  it("拒绝 ZIP 符号链接，已有目标符号链接只能跳过", async () => {
    const directory = await manager.register(root);
    const archive = pack({ "skills/sample/SKILL.md": "skill" });
    const linkArchive = Buffer.from(archive);
    const central = linkArchive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    linkArchive.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38);
    expect(
      (await preview(linkArchive, directory.directoryId)).body.error.code,
    ).toBe("IMPORT_INVALID");
    if (process.platform === "win32") return;
    const outside = path.join(temporary, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "SKILL.md"), "keep");
    await fs.symlink(outside, path.join(root, "sample"));
    const checked = await preview(archive, directory.directoryId);
    expect(checked.status).toBe(200);
    expect(checked.body.data.items[0].canOverwrite).toBe(false);
    expect(
      (
        await execute(checked.body.data, [
          { directoryName: "sample", action: "overwrite" },
        ])
      ).status,
    ).toBe(409);
    expect(await fs.readFile(path.join(outside, "SKILL.md"), "utf8")).toBe(
      "keep",
    );
  });
});
