const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, dialog } = require("electron");

const smokeRoot = process.env.SKILL_MANAGER_DESKTOP_SMOKE;
const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
const location = fs.realpathSync(
  portableRoot ||
    (app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath()),
);
const dataDirectory = path.resolve(
  process.env.SKILL_MANAGER_DATA_DIR || path.join(location, ".skill-manager"),
);
let runtime;
let window;
let quitting = false;
let exitCode = 0;
let smokePassed = false;
let initializationFailed = false;
function record(stage, details = {}) {
  if (smokeRoot)
    fs.appendFileSync(
      path.join(smokeRoot, "desktop-smoke.jsonl"),
      `${JSON.stringify({ stage, ...details })}\n`,
    );
}

try {
  fs.mkdirSync(path.join(dataDirectory, "desktop-profile"), {
    recursive: true,
  });
  app.setPath("userData", path.join(dataDirectory, "desktop-profile"));
  app.setPath("sessionData", path.join(dataDirectory, "desktop-profile"));
} catch (error) {
  initializationFailed = true;
  app.whenReady().then(() => {
    dialog.showErrorBox(
      "Skill 管理器启动失败",
      `无法写入数据目录：${dataDirectory}\n${error.message}`,
    );
    app.exit(1);
  });
}

if (initializationFailed) {
  // The ready handler above reports the failure and exits.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    if (!runtime) {
      if (exitCode) {
        event.preventDefault();
        app.exit(exitCode);
      }
      return;
    }
    event.preventDefault();
    quitting = true;
    runtime
      .close()
      .then(async () => {
        if (smokePassed) {
          let stopped = false;
          try {
            await fetch(runtime.url);
          } catch {
            stopped = true;
          }
          record(stopped ? "shutdown-ok" : "shutdown-failed");
          if (!stopped) return app.exit(1);
        }
        if (exitCode) app.exit(exitCode);
        else app.quit();
      })
      .catch((error) => {
        record("shutdown-failed", { message: error.message });
        app.exit(1);
      });
  });

  app
    .whenReady()
    .then(async () => {
      const { startDesktopServer } = await import("../build/server/desktop.js");
      runtime = await startDesktopServer(app.getAppPath(), dataDirectory);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
          { label: "文件", submenu: [{ role: "quit", label: "退出" }] },
          {
            label: "编辑",
            submenu: [
              { role: "undo", label: "撤销" },
              { role: "redo", label: "重做" },
              { type: "separator" },
              { role: "cut", label: "剪切" },
              { role: "copy", label: "复制" },
              { role: "paste", label: "粘贴" },
              { role: "selectAll", label: "全选" },
            ],
          },
          {
            label: "窗口",
            submenu: [
              { role: "minimize", label: "最小化" },
              { role: "zoom", label: "缩放" },
            ],
          },
        ]),
      );
      window = new BrowserWindow({
        title: "Skill 管理器",
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 640,
        show: false,
        icon: path.join(__dirname, "icon.png"),
        backgroundColor: "#f6f7f9",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const origin = new URL(runtime.url).origin;
      window.webContents.on("will-navigate", (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.session.setPermissionRequestHandler(
        (_contents, permission, callback) => {
          record("permission", { permission });
          callback(false);
        },
      );
      window.webContents.session.on("will-download", (_event, item) => {
        item.setSaveDialogOptions({
          title: "保存 Skill 分享包",
          defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
        });
      });
      await window.loadURL(runtime.url);
      window.show();
      record("ready", { url: runtime.url, dataDirectory });
      if (smokeRoot) {
        await require("./smoke.cjs").runSmoke(window, smokeRoot);
        smokePassed = true;
        record("checks-ok");
        window.close();
      }
    })
    .catch((error) => {
      exitCode = 1;
      record("failed", { message: error.stack || error.message });
      if (!smokeRoot)
        dialog.showErrorBox("Skill 管理器启动失败", error.message);
      app.quit();
    });
}
