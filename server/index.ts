import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { Manager } from "./service.js";
import { Repository } from "./storage.js";
const root = process.env.SKILL_MANAGER_ROOT
  ? path.resolve(process.env.SKILL_MANAGER_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = createApp(
  new Manager(new Repository(path.join(root, ".skill-manager"))),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.use((_req, res) => res.sendFile(path.join(root, "dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("PORT 必须是 1–65535 的整数");
app.listen(port, "127.0.0.1", () =>
  console.log(`Skill 管理器：http://127.0.0.1:${port}`),
);
