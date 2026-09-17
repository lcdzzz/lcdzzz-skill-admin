import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import request from "supertest";
import { Manager } from "../server/service";
import { Repository, atomicWrite } from "../server/storage";
import { createApp } from "../server/app";

let temporary: string,
  root: string,
  manager: Manager,
  app: ReturnType<typeof createApp>;
beforeEach(async () => {
  temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "skill-manager-test-")),
  );
  root = path.join(temporary, "skills");
  await fs.mkdir(root);
  manager = new Manager(new Repository(path.join(temporary, ".skill-manager")));
  app = createApp(manager);
});
afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});
const get = (url: string) =>
  request(app).get(`/api${url}`).set("Host", "127.0.0.1");
const post = (url: string, body: object) =>
  request(app).post(`/api${url}`).set("Host", "127.0.0.1").send(body);
describe("核心闭环", () => {
  it("首次为空，登记、创建、读取、保存及冲突保护", async () => {
    expect((await get("/skills")).body.data.skills).toEqual([]);
    const directory = await post("/directories", { path: root });
    expect(directory.status).toBe(200);
    const input = {
      targetDirectoryId: directory.body.data.directoryId,
      directoryName: "hello",
      name: "你好",
      description: "描述: 包含 YAML 字符",
      whenToUse: "测试",
      instructions: "执行",
    };
    const created = await post("/skills", input);
    expect(created.status).toBe(200);
    const id = created.body.data.skillId;
    const detail = (await get(`/skills/${id}`)).body.data;
    expect(detail.name).toBe("你好");
    expect(detail.content).toContain("## Instructions");
    const save = () =>
      request(app)
        .put(`/api/skills/${id}`)
        .set("Host", "127.0.0.1")
        .send({ content: "更新", expectedFingerprint: detail.fingerprint });
    expect((await save()).status).toBe(200);
    const conflict = await save();
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("CONFLICT");
    const duplicate = await post("/skills", input);
    expect(duplicate.body.error.code).toBe("SKILL_PATH_EXISTS");
    expect(await fs.readFile(path.join(root, "hello/SKILL.md"), "utf8")).toBe(
      "更新",
    );
  });
  it("异常 YAML 可见且可编辑，缺少字段正常回退", async () => {
    await manager.register(root);
    for (const [name, content] of [
      ["good", "plain markdown"],
      ["bad", "---\nname: [\n---\n"],
    ]) {
      await fs.mkdir(path.join(root, name));
      await fs.writeFile(path.join(root, name, "SKILL.md"), content);
    }
    const data = (await get("/skills")).body.data;
    expect(data.skills).toHaveLength(2);
    expect(data.skills.find((s: any) => s.name === "good").fileStatus).toBe(
      "normal",
    );
    const bad = data.skills.find((s: any) => s.name === "bad");
    expect(bad.fileStatus).toBe("invalid");
    expect((await get(`/skills/${bad.skillId}`)).status).toBe(200);
  });
  it("保存中文简介到 YAML description 并保留正文", async () => {
    const directory = await post("/directories", { path: root });
    const created = await post("/skills", {
      targetDirectoryId: directory.body.data.directoryId,
      directoryName: "english-skill",
      name: "English Skill",
      description: "An English description",
      whenToUse: "When needed",
      instructions: "Follow these instructions",
    });
    const id = created.body.data.skillId;
    const detail = (await get(`/skills/${id}`)).body.data;
    const response = await request(app)
      .put(`/api/skills/${id}`)
      .set("Host", "127.0.0.1")
      .send({
        content: detail.content,
        description: "用于测试和演示的中文简介",
        expectedFingerprint: detail.fingerprint,
      });
    expect(response.status).toBe(200);
    const updated = (await get(`/skills/${id}`)).body.data;
    expect(updated.description).toBe("用于测试和演示的中文简介");
    expect(updated.content).toContain("Follow these instructions");
  });
  it("按目录筛选 Skill", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    for (const [directory, name] of [
      [root, "first-skill"],
      [secondRoot, "second-skill"],
    ]) {
      await fs.mkdir(path.join(directory, name));
      await fs.writeFile(
        path.join(directory, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: test\n---\n`,
      );
    }

    const response = await get(
      `/skills?directoryId=${firstDirectory.directoryId}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.skills.map((skill: any) => skill.name)).toEqual([
      "first-skill",
    ]);
    expect(secondDirectory.directoryId).not.toBe(firstDirectory.directoryId);
  });
  it("把编辑后的内容一次创建到多个目录", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    const content = "---\nname: edited\ndescription: edited\n---\n\ncustom\n";

    const response = await post("/skills", {
      targetDirectoryIds: [
        firstDirectory.directoryId,
        secondDirectory.directoryId,
      ],
      directoryName: "edited-skill",
      content,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.skillIds).toHaveLength(2);
    expect(
      await fs.readFile(path.join(root, "edited-skill/SKILL.md"), "utf8"),
    ).toBe(content);
    expect(
      await fs.readFile(path.join(secondRoot, "edited-skill/SKILL.md"), "utf8"),
    ).toBe(content);
  });
  it("多目录创建冲突时回滚已创建目录并记录操作", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    await fs.mkdir(path.join(secondRoot, "conflict-skill"));

    const response = await post("/skills", {
      targetDirectoryIds: [
        firstDirectory.directoryId,
        secondDirectory.directoryId,
      ],
      directoryName: "conflict-skill",
      content: "edited",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SKILL_PATH_EXISTS");
    await expect(
      fs.stat(path.join(root, "conflict-skill")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await get("/operations")).body.data.operations.map(
        (item: any) => item.status,
      ),
    ).toEqual(["rolled_back", "failed"]);
  });
  it("拒绝重叠目录、越界目录名及根外链接", async () => {
    const d = await manager.register(root);
    expect(
      (await post("/directories", { path: temporary })).body.error.code,
    ).toBe("DIRECTORY_DUPLICATE_OR_OVERLAP");
    await fs.mkdir(path.join(temporary, "outside"));
    await fs.writeFile(path.join(temporary, "outside/SKILL.md"), "secret");
    await fs.symlink(
      path.join(temporary, "outside"),
      path.join(root, "escape"),
    );
    const data = (await get("/skills")).body.data;
    expect(data.skills[0].parseError.code).toBe("PATH_NOT_ALLOWED");
    expect(
      (await get(`/skills/${data.skills[0].skillId}`)).body.error.code,
    ).toBe("PATH_NOT_ALLOWED");
    expect(
      (
        await post("/skills", {
          targetDirectoryId: d.directoryId,
          directoryName: "../escape",
          name: "",
          description: "",
          whenToUse: "",
          instructions: "",
        })
      ).body.error.code,
    ).toBe("VALIDATION_ERROR");
  });
  it("元数据损坏拒写并保留损坏原文", async () => {
    await manager.register(root);
    const file = path.join(temporary, ".skill-manager/state.json");
    await fs.writeFile(file, "{broken");
    expect(
      (await post("/directories", { path: temporary })).body.error.code,
    ).toBe("METADATA_CORRUPTED");
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
  });
  it("移除登记不删除文件，登记在新实例中持久化", async () => {
    const d = await manager.register(root);
    const reopened = new Manager(
      new Repository(path.join(temporary, ".skill-manager")),
    );
    expect(await reopened.directories()).toHaveLength(1);
    await manager.remove(d.directoryId);
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });
  it("拒绝跨站写入和恶意 Host", async () => {
    expect(
      (
        await post("/directories", { path: root }).set(
          "Origin",
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect((await get("/skills").set("Host", "evil.example")).status).toBe(403);
  });
  it("原子替换失败保留既有目标", async () => {
    const target = path.join(temporary, "existing");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "keep"), "original");
    await expect(atomicWrite(target, "replace")).rejects.toThrow();
    expect(await fs.readFile(path.join(target, "keep"), "utf8")).toBe(
      "original",
    );
  });
  it("临时写入失败保持原文件不变", async () => {
    const directory = path.join(temporary, "readonly");
    await fs.mkdir(directory);
    const file = path.join(directory, "SKILL.md");
    await fs.writeFile(file, "original");
    await fs.chmod(directory, 0o500);
    try {
      await expect(atomicWrite(file, "changed")).rejects.toThrow();
      expect(await fs.readFile(file, "utf8")).toBe("original");
    } finally {
      await fs.chmod(directory, 0o700);
    }
  });
});
