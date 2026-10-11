import * as fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createApp } from "./app.js";
import { Manager } from "./service.js";
import { Repository } from "./storage.js";

export async function startDesktopServer(
  assetRoot: string,
  dataDirectory: string,
) {
  const index = path.join(assetRoot, "dist/index.html");
  await fs.access(index);
  const repository = new Repository(dataDirectory);
  await repository.read();
  const app = createApp(new Manager(repository));
  app.use(express.static(path.join(assetRoot, "dist")));
  app.use((_req, res) => res.sendFile(index));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("本地服务启动失败");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
