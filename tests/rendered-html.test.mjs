import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Lagata application and PWA metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Lagata Ultimate Team — FC Tournament Tracker<\/title>/i);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"\/>/i);
  assert.match(html, /<link rel="apple-touch-icon"[^>]*apple-touch-icon\.png/i);
  assert.match(html, /Tournament in progress/i);
  assert.match(html, /Friday Night League/i);
  assert.doesNotMatch(html, /You&#x27;re offline/i);
});

test("ships a versioned offline shell and complete icon set", async () => {
  const [manifestSource, serviceWorker] = await Promise.all([
    readFile(new URL("../dist/client/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../dist/client/sw.js", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.name, "Lagata Ultimate Team");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  assert.doesNotMatch(serviceWorker, /__PWA_VERSION__|INJECT_PRECACHE/);
  assert.match(serviceWorker, /const PWA_VERSION = "[a-f0-9]{12}"/);
  assert.match(serviceWorker, /SKIP_WAITING/);
  await Promise.all([
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-192-maskable.png",
    "icon-512-maskable.png",
  ].map((name) => access(new URL(`../public/icons/${name}`, import.meta.url))));
});
