import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(root, process.argv[2] || "release");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const name of [
  "build",
  "dist",
  "node_modules",
  "package.json",
  "LICENSE",
  "README.md",
]) {
  await cp(path.join(root, "release-runtime", name), path.join(output, name), {
    recursive: true,
  });
}

const packagePath = path.join(output, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
delete packageJson.devDependencies;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

await cp(path.join(root, "scripts/start.sh"), path.join(output, "start.sh"));
await cp(path.join(root, "scripts/start.cmd"), path.join(output, "start.cmd"));
await chmod(path.join(output, "start.sh"), 0o755);
