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
  it("操作记录只保留增删改并按时间倒序限制返回", async () => {
    const directory = await post("/directories", { path: root });
    const created = await post("/skills", {
      targetDirectoryId: directory.body.data.directoryId,
      directoryName: "tracked-skill",
      name: "Tracked",
      description: "记录测试",
      whenToUse: "测试",
      instructions: "执行",
    });
    const skillId = created.body.data.skillId;
    const detail = await get(`/skills/${skillId}`);
    await request(app)
      .put(`/api/skills/${skillId}`)
      .set("Host", "127.0.0.1")
      .send({
        content: detail.body.data.content,
        expectedFingerprint: detail.body.data.fingerprint,
      });
    await get("/skills");
    await request(app)
      .delete(`/api/directories/${directory.body.data.directoryId}`)
      .set("Host", "127.0.0.1");

    const all = await get("/operations?limit=10");
    expect(all.status).toBe(200);
    expect(all.body.data.operations.map((item: any) => item.operation)).toEqual(
      ["delete", "update", "create"],
    );
    const recent = await get("/operations?limit=2");
    expect(
      recent.body.data.operations.map((item: any) => item.operation),
    ).toEqual(["delete", "update"]);
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
  it("把不同目录中相同 name 的 Skill 聚合为一个统一 Skill", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    for (const directory of [root, secondRoot]) {
      await fs.mkdir(path.join(directory, "shared-skill"));
      await fs.writeFile(
        path.join(directory, "shared-skill/SKILL.md"),
        "---\nname: shared\ndescription: same\n---\n",
      );
    }

    const all = await get("/skills");
    expect(all.body.data.skills).toHaveLength(1);
    expect(all.body.data.skills[0]).toMatchObject({
      name: "shared",
      instances: expect.arrayContaining([
        expect.objectContaining({ directoryId: firstDirectory.directoryId }),
        expect.objectContaining({ directoryId: secondDirectory.directoryId }),
      ]),
    });

    const filtered = await get(
      `/skills?directoryId=${secondDirectory.directoryId}`,
    );
    expect(filtered.body.data.skills).toHaveLength(1);
  });
  it("设置默认目录后统一保存并同步已存在副本", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    for (const [directory, description] of [
      [root, "old source"],
      [secondRoot, "old copy"],
    ] as const) {
      await fs.mkdir(path.join(directory, "shared-skill"));
      await fs.writeFile(
        path.join(directory, "shared-skill/SKILL.md"),
        `---\nname: shared\ndescription: ${description}\n---\nold\n`,
      );
    }
    const skill = (await get("/skills")).body.data.skills[0];
    const selected = await request(app)
      .put(`/api/skills/${skill.skillId}/default-directory`)
      .set("Host", "127.0.0.1")
      .send({ directoryId: firstDirectory.directoryId });
    expect(selected.status).toBe(200);

    const detail = (await get(`/skills/${skill.skillId}`)).body.data;
    expect(detail.defaultDirectoryId).toBe(firstDirectory.directoryId);
    expect(detail.defaultInstance.directoryId).toBe(firstDirectory.directoryId);
    const updatedContent =
      "---\nname: shared\ndescription: new\n---\nupdated\n";
    const saved = await request(app)
      .put(`/api/skills/${skill.skillId}`)
      .set("Host", "127.0.0.1")
      .send({
        content: updatedContent,
        expectedFingerprint: detail.fingerprint,
      });
    expect(saved.status).toBe(200);
    expect(
      await fs.readFile(path.join(root, "shared-skill/SKILL.md"), "utf8"),
    ).toBe(updatedContent);
    expect(
      await fs.readFile(path.join(secondRoot, "shared-skill/SKILL.md"), "utf8"),
    ).toBe(updatedContent);
    expect((await get(`/skills/${skill.skillId}`)).body.data.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ directoryId: secondDirectory.directoryId }),
      ]),
    );
  });
  it("副本被外部修改时报告冲突，缺失副本不自动创建", async () => {
    const secondRoot = path.join(temporary, "other-skills");
    await fs.mkdir(secondRoot);
    const firstDirectory = await manager.register(root);
    const secondDirectory = await manager.register(secondRoot);
    await fs.mkdir(path.join(root, "shared-skill"));
    await fs.writeFile(
      path.join(root, "shared-skill/SKILL.md"),
      "---\nname: shared\n---\nold\n",
    );
    const skill = (await get("/skills")).body.data.skills[0];
    await request(app)
      .put(`/api/skills/${skill.skillId}/default-directory`)
      .set("Host", "127.0.0.1")
      .send({ directoryId: firstDirectory.directoryId });
    const detail = (await get(`/skills/${skill.skillId}`)).body.data;
    expect(
      detail.directoryUsages.find(
        (item: any) => item.directoryId === secondDirectory.directoryId,
      ).status,
    ).toBe("missing");

    const saved = await request(app)
      .put(`/api/skills/${skill.skillId}`)
      .set("Host", "127.0.0.1")
      .send({
        content: "---\nname: shared\n---\nnew\n",
        expectedFingerprint: detail.fingerprint,
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data.sync).toEqual([]);
    await expect(
      fs.stat(path.join(secondRoot, "shared-skill/SKILL.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    await fs.mkdir(path.join(secondRoot, "shared-skill"));
    await fs.writeFile(
      path.join(secondRoot, "shared-skill/SKILL.md"),
      "---\nname: shared\n---\nexternal\n",
    );
    const nextDetail = (await get(`/skills/${skill.skillId}`)).body.data;
    const conflict = await request(app)
      .put(`/api/skills/${skill.skillId}`)
      .set("Host", "127.0.0.1")
      .send({
        content: "---\nname: shared\n---\nlatest\n",
        expectedFingerprint: nextDetail.fingerprint,
      });
    expect(conflict.body.data.sync[0].status).toBe("conflict");
    expect(
      await fs.readFile(path.join(secondRoot, "shared-skill/SKILL.md"), "utf8"),
    ).toContain("external");
  });
  it("识别登记目录本身的根 Skill，并按 front matter name 匹配", async () => {
    const target = path.join(temporary, "target-root-skill");
    await fs.mkdir(target);
    const sourceDirectory = await manager.register(root);
    const targetDirectory = await manager.register(target);
    await fs.writeFile(
      path.join(root, "SKILL.md"),
      "---\nname: root-helper\ndescription: source\n---\nsource\n",
    );
    await fs.writeFile(
      path.join(target, "SKILL.md"),
      "---\nname: root-helper\ndescription: target\n---\ntarget\n",
    );

    const skills = (await get("/skills")).body.data.skills;
    expect(skills).toHaveLength(1);
    const source = skills.find(
      (item: any) => item.directoryId === sourceDirectory.directoryId,
    );
    expect(source.directoryName).toBeNull();
    expect(source.isRootSkill).toBe(true);
    expect(source.name).toBe("root-helper");
    expect(source.instances).toHaveLength(2);

    const preview = await post("/skills/sync/preview", {
      sourceDirectoryId: sourceDirectory.directoryId,
      targetDirectoryIds: [targetDirectory.directoryId],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.items[0]).toMatchObject({
      match: true,
      conflict: true,
    });
  });
  it("同步同名 Skill 的完整内容但不创建目标缺失项", async () => {
    const target = path.join(temporary, "sync-target");
    await fs.mkdir(target);
    const sourceDirectory = await manager.register(root);
    const targetDirectory = await manager.register(target);
    await fs.mkdir(path.join(root, "shared"), { recursive: true });
    await fs.mkdir(path.join(root, "source-only"), { recursive: true });
    await fs.writeFile(
      path.join(root, "shared/SKILL.md"),
      "---\nname: shared\ndescription: source\n---\nsource\n",
    );
    await fs.writeFile(path.join(root, "shared/helper.txt"), "from source");
    await fs.writeFile(
      path.join(root, "source-only/SKILL.md"),
      "---\nname: source-only\ndescription: only source\n---\n",
    );
    await fs.mkdir(path.join(target, "shared"));
    await fs.writeFile(
      path.join(target, "shared/SKILL.md"),
      "---\nname: shared\ndescription: old\n---\nold\n",
    );
    await fs.writeFile(path.join(target, "shared/local.txt"), "keep target");

    const preview = await post("/skills/sync/preview", {
      sourceDirectoryId: sourceDirectory.directoryId,
      targetDirectoryIds: [targetDirectory.directoryId],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: "shared",
          match: true,
          conflict: true,
        }),
        expect.objectContaining({
          skillName: "source-only",
          match: false,
          reason: "TARGET_MISSING",
        }),
      ]),
    );

    const synced = await post("/skills/sync", {
      sourceDirectoryId: sourceDirectory.directoryId,
      targetDirectoryIds: [targetDirectory.directoryId],
      decisions: [
        {
          sourceSkillId: (
            await get(`/skills?directoryId=${sourceDirectory.directoryId}`)
          ).body.data.skills.find(
            (item: any) => item.directoryName === "shared",
          ).skillId,
          targetDirectoryId: targetDirectory.directoryId,
          action: "overwrite",
        },
      ],
    });
    expect(synced.status).toBe(200);
    expect(synced.body.data.results[0].status).toBe("success");
    expect(
      await fs.readFile(path.join(target, "shared/SKILL.md"), "utf8"),
    ).toContain("description: source");
    expect(
      await fs.readFile(path.join(target, "shared/helper.txt"), "utf8"),
    ).toBe("from source");
    expect(
      await fs.readFile(path.join(target, "shared/local.txt"), "utf8"),
    ).toBe("keep target");
    await expect(
      fs.stat(path.join(target, "source-only")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
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
  it("把一个 Skill 的 SKILL.md 复制到多个已登记目录", async () => {
    const firstTarget = path.join(temporary, "first-target");
    const secondTarget = path.join(temporary, "second-target");
    await fs.mkdir(firstTarget);
    await fs.mkdir(secondTarget);
    const sourceDirectory = await manager.register(root);
    const firstTargetDirectory = await manager.register(firstTarget);
    const secondTargetDirectory = await manager.register(secondTarget);
    await fs.mkdir(path.join(root, "shared-skill"));
    await fs.writeFile(
      path.join(root, "shared-skill/SKILL.md"),
      "---\nname: shared\ndescription: source\n---\n",
    );
    await fs.writeFile(path.join(root, "shared-skill/helper.ts"), "source");
    const sourceSkill = (
      await get("/skills?directoryId=" + sourceDirectory.directoryId)
    ).body.data.skills[0];

    const preview = await post("/skills/copy/preview", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [
        firstTargetDirectory.directoryId,
        secondTargetDirectory.directoryId,
      ],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data.items.map((item: any) => item.conflict)).toEqual([
      false,
      false,
    ]);

    const copied = await post("/skills/copy", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [
        firstTargetDirectory.directoryId,
        secondTargetDirectory.directoryId,
      ],
      mode: "skill_md_only",
      decisions: [],
    });
    expect(copied.status).toBe(200);
    expect(copied.body.data.results.map((item: any) => item.status)).toEqual([
      "success",
      "success",
    ]);
    for (const target of [firstTarget, secondTarget]) {
      expect(
        await fs.readFile(path.join(target, "shared-skill/SKILL.md"), "utf8"),
      ).toContain("description: source");
      await expect(
        fs.stat(path.join(target, "shared-skill/helper.ts")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  });
  it("完整复制可覆盖同名文件而保留目标独有文件", async () => {
    const target = path.join(temporary, "target");
    await fs.mkdir(target);
    const sourceDirectory = await manager.register(root);
    const targetDirectory = await manager.register(target);
    await fs.mkdir(path.join(root, "complete-skill", "assets"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "complete-skill/SKILL.md"),
      "source skill",
    );
    await fs.writeFile(
      path.join(root, "complete-skill/assets/template.txt"),
      "source asset",
    );
    await fs.mkdir(path.join(target, "complete-skill"));
    await fs.writeFile(
      path.join(target, "complete-skill/SKILL.md"),
      "old skill",
    );
    await fs.writeFile(
      path.join(target, "complete-skill/local.txt"),
      "keep me",
    );
    const sourceSkill = (
      await get("/skills?directoryId=" + sourceDirectory.directoryId)
    ).body.data.skills[0];

    const preview = await post("/skills/copy/preview", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [targetDirectory.directoryId],
    });
    expect(preview.body.data.items[0].conflict).toBe(true);

    const copied = await post("/skills/copy", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [targetDirectory.directoryId],
      mode: "full_directory",
      decisions: [
        {
          skillId: sourceSkill.skillId,
          targetDirectoryId: targetDirectory.directoryId,
          action: "overwrite",
        },
      ],
    });
    expect(copied.status).toBe(200);
    expect(copied.body.data.results[0].status).toBe("success");
    expect(
      await fs.readFile(
        path.join(target, "complete-skill/assets/template.txt"),
        "utf8",
      ),
    ).toBe("source asset");
    expect(
      await fs.readFile(path.join(target, "complete-skill/local.txt"), "utf8"),
    ).toBe("keep me");
  });
  it("复制冲突可逐项跳过或取消，单项失败不影响已成功项", async () => {
    const workingTarget = path.join(temporary, "working-target");
    const failingTarget = path.join(temporary, "failing-target");
    await fs.mkdir(workingTarget);
    await fs.mkdir(failingTarget);
    const sourceDirectory = await manager.register(root);
    const workingDirectory = await manager.register(workingTarget);
    const failingDirectory = await manager.register(failingTarget);
    await fs.mkdir(path.join(root, "one-skill"));
    await fs.writeFile(path.join(root, "one-skill/SKILL.md"), "new skill");
    await fs.mkdir(path.join(failingTarget, "one-skill"));
    await fs.mkdir(path.join(failingTarget, "one-skill/SKILL.md"));
    const sourceSkill = (
      await get("/skills?directoryId=" + sourceDirectory.directoryId)
    ).body.data.skills[0];

    const copied = await post("/skills/copy", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [
        workingDirectory.directoryId,
        failingDirectory.directoryId,
      ],
      mode: "skill_md_only",
      decisions: [
        {
          skillId: sourceSkill.skillId,
          targetDirectoryId: failingDirectory.directoryId,
          action: "overwrite",
        },
      ],
    });
    expect(copied.status).toBe(200);
    expect(copied.body.data.results.map((item: any) => item.status)).toEqual([
      "success",
      "failed",
    ]);
    expect(
      await fs.readFile(path.join(workingTarget, "one-skill/SKILL.md"), "utf8"),
    ).toBe("new skill");

    const conflict = await post("/skills/copy", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [workingDirectory.directoryId],
      mode: "skill_md_only",
      decisions: [
        {
          skillId: sourceSkill.skillId,
          targetDirectoryId: workingDirectory.directoryId,
          action: "skip",
        },
      ],
    });
    expect(conflict.body.data.results[0].status).toBe("skipped");
    const cancelled = await post("/skills/copy", {
      skillIds: [sourceSkill.skillId],
      targetDirectoryIds: [workingDirectory.directoryId],
      mode: "skill_md_only",
      decisions: [
        {
          skillId: sourceSkill.skillId,
          targetDirectoryId: workingDirectory.directoryId,
          action: "cancel",
        },
      ],
    });
    expect(cancelled.body.data.results[0].status).toBe("cancelled");
    expect(
      await fs.readFile(path.join(workingTarget, "one-skill/SKILL.md"), "utf8"),
    ).toBe("new skill");
    expect(
      (await get("/operations")).body.data.operations
        .filter((item: any) => item.operation === "copy")
        .map((item: any) => item.status),
    ).toEqual(["cancelled", "skipped", "failed", "success"]);
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
    ).toEqual(["failed", "rolled_back"]);
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
    if (process.platform === "win32") return;
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
