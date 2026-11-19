import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(root, process.argv[2] || "release");
const runtimeRoot = path.resolve(root, process.argv[3] || "release-runtime");

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
  await cp(path.join(runtimeRoot, name), path.join(output, name), {
    recursive: true,
  });
}

// Production packages run with node directly; pnpm's .bin links may point to
// the CI workspace and must not be shipped in a portable archive.
await rm(path.join(output, "node_modules", ".bin"), {
  recursive: true,
  force: true,
});

async function assertNoSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Release contains a symlink: ${entryPath}`);
    if (entry.isDirectory()) await assertNoSymlinks(entryPath);
  }
}
await assertNoSymlinks(output);

const packagePath = path.join(output, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
delete packageJson.devDependencies;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

await cp(path.join(root, "scripts/start.sh"), path.join(output, "start.sh"));
await cp(path.join(root, "scripts/start.cmd"), path.join(output, "start.cmd"));
await chmod(path.join(output, "start.sh"), 0o755);

if (process.platform === "win32" || process.platform === "darwin") {
  const runtime = path.join(output, "runtime");
  await mkdir(runtime);
  const runtimeName = process.platform === "win32" ? "node.exe" : "node";
  await cp(process.execPath, path.join(runtime, runtimeName));
  const licensePath =
    process.platform === "win32"
      ? path.join(path.dirname(process.execPath), "LICENSE")
      : path.resolve(path.dirname(process.execPath), "..", "LICENSE");
  await cp(licensePath, path.join(runtime, "LICENSE"));
}
