// Opt-in acceptance harness for the same window shipped in the portable EXE.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { clipboard, ClipboardItem } = require("electron");

async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
exports.runSmoke = async function (window, root) {
  if (process.env.SKILL_MANAGER_SMOKE_CONTROLLED === "1") {
    await until(
      () =>
        fs.access(path.join(root, "smoke-continue")).then(
          () => true,
          () => false,
        ),
      "controller",
      120000,
    );
  }
  const execute = (code) =>
    window.webContents.executeJavaScript(code).catch((error) => {
      throw new Error(`${error.message} Source: ${code.slice(0, 250)}`);
    });
  const button = async (text) => {
    await until(
      () =>
        execute(
          `[...document.querySelectorAll('button')].some(el => el.textContent.trim().startsWith(${JSON.stringify(text)}) && !el.disabled)`,
        ),
      `button: ${text}`,
    );
    await execute(
      `[...document.querySelectorAll('button')].find(el => el.textContent.trim().startsWith(${JSON.stringify(text)})).click()`,
    );
  };
  await until(
    () =>
      execute("document.querySelector('h1')?.textContent.includes('Skill')"),
    "main UI",
  );
  assert.equal(await execute("typeof window.require"), "undefined");
  const legacy = await execute(
    "fetch('/api/directories').then(r => r.json()).then(r => r.data)",
  );
  assert.equal(legacy.length, 1, "v0.0.6 directory should be retained");

  // Native copy/paste commands must operate on the React input.
  const originalClipboard = await Promise.all(
    (await clipboard.read()).map(
      async (item) =>
        new ClipboardItem(
          Object.fromEntries(
            await Promise.all(
              item.types.map(async (type) => [type, await item.getType(type)]),
            ),
          ),
        ),
    ),
  );
  try {
    await execute(`(() => {
      const input = document.querySelector('[aria-label="搜索 Skill"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '复制 smoke');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus(); input.select();
    })()`);
    window.webContents.copy();
    await until(
      async () => (await clipboard.readText()) === "复制 smoke",
      "copy",
    );
    await execute(
      `(() => {
      const input = document.querySelector('[aria-label="搜索 Skill"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus(); input.select();
    })()`,
    );
    window.focus();
    window.webContents.focus();
    window.webContents.paste();
    await until(
      () =>
        execute(
          "document.querySelector('[aria-label=\"搜索 Skill\"]').value === '复制 smoke'",
        ),
      "paste",
    ).catch(async (error) => {
      throw new Error(
        error.message +
          ": " +
          (await execute(
            "JSON.stringify({value: document.querySelector('[aria-label=\"搜索 Skill\"]').value, active: document.activeElement?.getAttribute('aria-label')})",
          )),
      );
    });
  } finally {
    await clipboard.write(originalClipboard);
  }
  await execute(`(() => {
    const input = document.querySelector('[aria-label="搜索 Skill"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const skills = path.join(root, "新 skills");
  await fs.mkdir(path.join(skills, "desktop-smoke"), { recursive: true });
  const skillFile = path.join(skills, "desktop-smoke/SKILL.md");
  await fs.writeFile(
    skillFile,
    "---\nname: desktop-smoke\ndescription: 桌面测试\n---\n\nOriginal\n",
  );
  await execute(`(() => {
    const input = document.querySelector('[aria-label="Skill 根目录"]');
    input.closest('details').open = true;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(skills)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await button("登记目录");
  await until(
    () =>
      execute(
        "fetch('/api/directories').then(r=>r.json()).then(r=>r.data.length === 2)",
      ),
    "directory registration",
  );
  await until(
    () =>
      execute(
        "[...document.querySelectorAll('a')].some(a => a.textContent.includes('desktop-smoke'))",
      ),
    "skill list",
  );
  await execute(
    "[...document.querySelectorAll('a')].find(a => a.textContent.includes('desktop-smoke')).click()",
  );
  await until(
    () => execute("!!document.querySelector('.w-md-editor-text-input')"),
    "Markdown editor",
  );
  await execute(`(() => {
    const input = document.querySelector('.w-md-editor-text-input');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, input.value + '\\nEdited in desktop\\n');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await button("保存修改");
  await until(
    async () =>
      (await fs.readFile(skillFile, "utf8")).includes("Edited in desktop"),
    "save Skill",
  );

  // Return to the list and use the actual export buttons and Blob download.
  await window.loadURL(new URL("/", window.webContents.getURL()).href);
  await until(
    () => execute("!!document.querySelector('input[type=checkbox]')"),
    "selection",
  );
  await execute("document.querySelector('input[type=checkbox]').click()");
  await button("导出分享包");
  await button("预览文件清单");
  await until(
    () =>
      execute(
        "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '下载 ZIP')",
      ),
    "export preview",
  );
  const target = path.join(root, "skills-share.zip");
  const download = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("ZIP download timed out")),
      20000,
    );
    window.webContents.session.once("will-download", (_event, item) => {
      item.setSavePath(target);
      item.once("done", (_event, state) => {
        clearTimeout(timer);
        state === "completed"
          ? resolve()
          : reject(Error(`ZIP download ${state}`));
      });
    });
  });
  await button("下载 ZIP");
  await download;
  const bytes = await fs.readFile(target);
  assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const { unzipSync, strFromU8 } = require("fflate");
  const entries = unzipSync(bytes);
  assert.equal(
    strFromU8(entries["skills/desktop-smoke/SKILL.md"]),
    await fs.readFile(skillFile, "utf8"),
  );
  assert(!Object.keys(entries).some((name) => name.includes(".skill-manager")));
};
