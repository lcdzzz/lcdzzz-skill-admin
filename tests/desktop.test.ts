import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startDesktopServer } from "../server/desktop";

let temporary: string;
const servers: Awaited<ReturnType<typeof startDesktopServer>>[] = [];
beforeEach(async () => {
  temporary = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "skill-desktop-")),
  );
  await fs.mkdir(path.join(temporary, "assets/dist"), { recursive: true });
  await fs.writeFile(
    path.join(temporary, "assets/dist/index.html"),
    "<h1>desktop fixture</h1>",
  );
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  await fs.rm(temporary, { recursive: true, force: true });
});
it("serves embedded assets while persisting outside the resource directory", async () => {
  const assets = path.join(temporary, "assets");
  const data = path.join(temporary, "portable/.skill-manager");
  const skillRoot = path.join(temporary, "skills");
  await fs.mkdir(skillRoot);
  const server = await startDesktopServer(assets, data);
  servers.push(server);
  expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(await (await fetch(server.url)).text()).toContain("desktop fixture");
  expect(
    (
      await fetch(`${server.url}/api/directories`, {
        headers: { Origin: "https://example.com" },
      })
    ).status,
  ).toBe(403);
  const registered = await fetch(`${server.url}/api/directories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: skillRoot }),
  });
  expect(registered.status).toBe(200);
  expect(
    JSON.parse(await fs.readFile(path.join(data, "state.json"), "utf8"))
      .directories,
  ).toHaveLength(1);
  await expect(
    fs.access(path.join(assets, ".skill-manager")),
  ).rejects.toThrow();
  await server.close();
  await expect(fetch(server.url)).rejects.toThrow();
  const restarted = await startDesktopServer(assets, data);
  servers.push(restarted);
  expect(
    (await (await fetch(`${restarted.url}/api/directories`)).json()).data,
  ).toHaveLength(1);
});
it("rejects an incomplete resource bundle before opening a service", async () => {
  await expect(
    startDesktopServer(
      path.join(temporary, "missing"),
      path.join(temporary, "data"),
    ),
  ).rejects.toThrow();
});
