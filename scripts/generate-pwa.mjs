import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const clientDir = path.resolve("dist/client");
const serviceWorkerPath = path.join(clientDir, "sw.js");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(absolute));
    else files.push(absolute);
  }
  return files;
}

const files = (await filesBelow(clientDir)).filter((file) => file !== serviceWorkerPath && !file.endsWith(".map"));
const urls = files.map((file) => `/${path.relative(clientDir, file).split(path.sep).join("/")}`);
const fingerprint = createHash("sha256");
for (const file of files) {
  const info = await stat(file);
  fingerprint.update(`${path.relative(clientDir, file)}:${info.size}:${info.mtimeMs}`);
}
const version = fingerprint.digest("hex").slice(0, 12);
const source = await readFile(serviceWorkerPath, "utf8");
const injected = source
  .replace("__PWA_VERSION__", version)
  .replace("/* INJECT_PRECACHE */", urls.map((url) => `,\n  ${JSON.stringify(url)}`).join(""));
await writeFile(serviceWorkerPath, injected);
console.log(`Generated PWA service worker ${version} with ${urls.length} cached assets.`);
