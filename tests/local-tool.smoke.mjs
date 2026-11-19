import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  unlink,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = path.join(root, "scripts/local-tool.mjs");
const fixture = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "skill admin launch test ")),
);
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const job = `gui/${process.getuid?.() || 0}/com.lcdzzz.skill-admin.${createHash("sha256").update(root).digest("hex").slice(0, 16)}.${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  SKILL_ADMIN_STATE_DIR: path.join(fixture, "launcher"),
  SKILL_MANAGER_DATA_DIR: path.join(fixture, "data"),
  SKILL_ADMIN_NO_OPEN: "1",
};
const run = (action, extra = {}) =>
  exec(process.execPath, [controller, action], {
    cwd: root,
    env: { ...env, ...extra },
    timeout: 40000,
  });
const health = async () =>
  (await fetch(`http://127.0.0.1:${port}/api/health`)).json();

test(
  "后台生命周期、并发复用、重启和受限 PATH",
  { skip: process.platform !== "darwin" },
  async () => {
    assert.equal(existsSync(controller), true, "后台启动控制器尚未实现");
    try {
      const started = await exec(
        "/bin/bash",
        [path.join(root, "skill-admin.sh")],
        {
          cwd: "/",
          env: {
            ...env,
            PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
            SKILL_ADMIN_NODE: process.execPath,
          },
          timeout: 40000,
        },
      );
      assert.equal(started.stdout, "", "成功启动应保持静默");
      const first = await health();
      assert.equal(first.service, "skill-manager");
      assert.equal(first.root, root);
      assert.ok(first.instance);
      const rejectedStatus = await new Promise((resolve, reject) => {
        http
          .get(
            {
              host: "127.0.0.1",
              port,
              path: "/api/health",
              headers: { Host: "example.com" },
            },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          )
          .on("error", reject);
      });
      assert.equal(rejectedStatus, 403);
      await Promise.all([run("start"), run("start"), run("start")]);
      assert.equal(
        (await health()).instance,
        first.instance,
        "重复点击应复用同一实例",
      );
      assert.match((await run("status")).stdout, /运行中/);
      await run("restart");
      assert.notEqual(
        (await health()).instance,
        first.instance,
        "重启应产生新实例",
      );
      await run("stop");
      await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
      assert.match((await run("status")).stdout, /未运行/);
      await run("stop");
      await Promise.all([run("start"), run("start"), run("start")]);
      assert.equal((await health()).service, "skill-manager");
      // A failed launchd process leaves an exit code behind. Starting again must recover.
      await exec("/bin/launchctl", ["kill", "SIGKILL", job]);
      for (let i = 0; i < 30; i++) {
        try {
          await health();
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await run("start");
      assert.equal(
        (await health()).service,
        "skill-manager",
        "进程异常退出后应能重新启动",
      );
      assert.match(
        await readFile(path.join(fixture, "launcher/service.log"), "utf8"),
        /Skill 管理器/,
      );
    } finally {
      await run("stop");
    }
  },
);

test(
  "同项目的外部服务可打开，但不会被停止或重启",
  { skip: process.platform !== "darwin" },
  async () => {
    const other = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ service: "skill-manager", root, instance: null }),
      );
    });
    await new Promise((resolve) => other.listen(port, "127.0.0.1", resolve));
    try {
      await run("start");
      assert.match((await run("status")).stdout, /外部启动/);
      await assert.rejects(run("restart"), (error) =>
        /其他方式启动/.test(error.stderr),
      );
      await run("stop");
      assert.equal((await health()).service, "skill-manager");
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  },
);

test(
  "项目路径包含中文、空格和引号时可启动；自动查找 Node",
  { skip: process.platform !== "darwin" },
  async () => {
    const project = path.join(fixture, "project 中文 & ' spaces");
    await mkdir(path.join(project, "scripts"), { recursive: true });
    await copyFile(controller, path.join(project, "scripts/local-tool.mjs"));
    await copyFile(
      path.join(root, "skill-admin.sh"),
      path.join(project, "skill-admin.sh"),
    );
    for (const name of [
      "server",
      "node_modules",
      "src",
      "index.html",
      "package.json",
      "tsconfig.json",
    ]) {
      await symlink(path.join(root, name), path.join(project, name));
    }
    const runProject = (action) =>
      exec("/bin/bash", [path.join(project, "skill-admin.sh"), action], {
        cwd: "/",
        env: {
          ...env,
          SKILL_ADMIN_NODE: "",
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          SKILL_ADMIN_STATE_DIR: path.join(project, ".skill-manager/launcher"),
        },
        timeout: 40000,
      });
    try {
      await runProject("start");
      assert.equal((await health()).root, project);
      await runProject("restart");
      assert.equal((await health()).root, project);
      await runProject("stop");
      await unlink(path.join(project, "server"));
      await assert.rejects(
        runProject("start"),
        (error) => /启动失败/.test(error.stderr) && /日志：/.test(error.stderr),
      );
    } finally {
      await runProject("stop");
    }
  },
);

test(
  "拒绝其他服务占用端口，停止不影响其他服务",
  { skip: process.platform !== "darwin" },
  async () => {
    assert.equal(existsSync(controller), true, "后台启动控制器尚未实现");
    const other = http.createServer((_req, res) =>
      res.end("another local tool"),
    );
    await new Promise((resolve) => other.listen(port, "127.0.0.1", resolve));
    try {
      await assert.rejects(run("start"), (error) =>
        /端口.*占用/.test(error.stderr),
      );
      await assert.rejects(run("restart"), (error) =>
        /端口.*占用/.test(error.stderr),
      );
      await run("stop");
      assert.equal(
        await (await fetch(`http://127.0.0.1:${port}/`)).text(),
        "another local tool",
      );
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  },
);
