import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8787);
const action = process.argv[2] || "start";
const state = path.resolve(
  process.env.SKILL_ADMIN_STATE_DIR ||
    path.join(root, ".skill-manager/launcher"),
);
const log = path.join(state, "service.log");
const label = `com.lcdzzz.skill-admin.${createHash("sha256").update(root).digest("hex").slice(0, 16)}.${port}`;
const domain = `gui/${process.getuid?.() || 0}`;
const job = `${domain}/${label}`;
const url = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const command = (file, args) => {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 10000 });
  if (result.error) throw result.error;
  return result;
};
const launchctl = (...args) => command("/bin/launchctl", args);
const loaded = () => launchctl("print", job).status === 0;
const xml = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );

async function listening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function probe() {
  if (!(await listening())) return "down";
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const health = await response.json();
    if (
      response.ok &&
      health.service === "skill-manager" &&
      health.root === root
    )
      return "ours";
  } catch {
    /* A listener without our health response belongs to another service. */
  }
  return "other";
}

function conflict() {
  return new Error(
    `端口 ${port} 已被其他服务占用，请停止占用服务或设置 PORT 使用其他端口。`,
  );
}

async function openPage() {
  if (process.env.SKILL_ADMIN_NO_OPEN === "1") return;
  const result = command("/usr/bin/open", [url]);
  if (result.status !== 0)
    throw new Error(`服务已就绪，但页面未能打开：${result.stderr.trim()}`);
}

async function start() {
  const current = await probe();
  if (current === "ours") return openPage();
  if (current === "other") throw conflict();

  const loader = path.join(root, "node_modules/tsx/dist/loader.mjs");
  await stat(loader).catch(() => {
    throw new Error(
      "项目依赖未安装。请先在 iTerm 中进入项目并执行 pnpm install。",
    );
  });
  await mkdir(state, { recursive: true, mode: 0o700 });
  const existing = launchctl("print", job);
  if (
    existing.status === 0 &&
    !/state = running/.test(existing.stdout) &&
    /last exit code = -?\d+|last terminating signal =/.test(existing.stdout)
  ) {
    // Re-register an exited job instead of blocking on launchd's kickstart throttle.
    await stop();
  }
  if (!loaded()) {
    const size = await stat(log)
      .then((s) => s.size)
      .catch(() => 0);
    if (size > 5 * 1024 * 1024) {
      await rename(log, `${log}.previous`).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    const args = [
      process.execPath,
      "--import",
      pathToFileURL(loader).href,
      path.join(root, "server/index.ts"),
    ];
    const environment = {
      HOME: process.env.HOME,
      PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      NODE_ENV: "development",
      PORT: String(port),
      SKILL_MANAGER_ROOT: root,
      SKILL_MANAGER_DATA_DIR: path.resolve(
        process.env.SKILL_MANAGER_DATA_DIR || path.join(root, ".skill-manager"),
      ),
      SKILL_ADMIN_INSTANCE: randomUUID(),
    };
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(environment)
      .map(
        ([key, value]) =>
          `<key>${xml(key)}</key><string>${xml(value)}</string>`,
      )
      .join("")}</dict>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(log)}</string>
<key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>`;
    const temporary = path.join(state, `job-${randomUUID()}.plist`);
    await writeFile(temporary, plist, { mode: 0o600 });
    try {
      const result = launchctl("bootstrap", domain, temporary);
      if (result.status !== 0 && !loaded()) {
        throw new Error(
          `后台服务注册失败：${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    } finally {
      await unlink(temporary);
    }
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await probe();
    if (ready === "ours") return openPage();
    if (ready === "other") throw conflict();
    const details = launchctl("print", job);
    if (
      details.status !== 0 ||
      (!/state = running/.test(details.stdout) &&
        /last exit code = -?\d+|last terminating signal =/.test(details.stdout))
    ) {
      throw new Error("后台服务启动失败，请查看日志。");
    }
    await delay(250);
  }
  throw new Error("启动超时：30 秒内服务未就绪，请查看日志或重启服务。");
}

async function stop() {
  if (!loaded()) return;
  const result = launchctl("bootout", job);
  if (result.status !== 0 && loaded())
    throw new Error(`停止服务失败：${result.stderr.trim()}`);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!(await listening())) return;
    if ((await probe()) !== "ours") return;
    await delay(100);
  }
  throw new Error("后台任务已移除，但服务仍未退出，请查看日志。");
}

async function logs() {
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(log, "", { flag: "a", mode: 0o600 });
  const shellPath = `'${log.replace(/'/g, "'\\''")}'`;
  const script = `on run argv
tell application "iTerm"
  activate
  set logWindow to (create window with default profile)
  tell current session of logWindow
    write text (item 1 of argv)
  end tell
end tell
end run`;
  const result = command("/usr/bin/osascript", [
    "-e",
    script,
    `/usr/bin/tail -n 200 -F ${shellPath}`,
  ]);
  if (result.status !== 0)
    throw new Error(`无法打开 iTerm 日志窗口：${result.stderr.trim()}`);
}

try {
  if (process.platform !== "darwin")
    throw new Error("此后台启动入口仅支持 macOS。");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT 必须是 1–65535 的整数。");
  if (process.argv.length > 3)
    throw new Error("用法：skill-admin.sh [start|stop|restart|status|logs]");
  switch (action) {
    case "start":
      await start();
      break;
    case "stop":
      await stop();
      break;
    case "restart": {
      const current = await probe();
      if (current === "other") throw conflict();
      if (current === "ours" && !loaded())
        throw new Error(
          "服务由其他方式启动，请先在原启动位置停止服务，再用本启动器启动。",
        );
      await stop();
      await start();
      break;
    }
    case "status": {
      const current = await probe();
      console.log(`日志：${log}`);
      console.log(
        current === "ours"
          ? `运行中：${url}${loaded() ? "" : "（外部启动）"}`
          : current === "other"
            ? `端口 ${port} 被其他服务占用`
            : "未运行",
      );
      break;
    }
    case "logs":
      await logs();
      break;
    default:
      throw new Error("用法：skill-admin.sh [start|stop|restart|status|logs]");
  }
} catch (error) {
  console.error(`${error.message}\n日志：${log}`);
  process.exitCode = 1;
}
