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
  assert.equal(manifest.lang, "en-GB");
  assert.equal(manifest.dir, "ltr");
  assert.equal(manifest.orientation, "any");
  assert.deepEqual(manifest.launch_handler.client_mode, ["navigate-existing", "auto"]);
  assert.equal(manifest.handle_links, "preferred");
  assert.ok(manifest.screenshots.some((shot) => shot.form_factor === "narrow"));
  assert.ok(manifest.screenshots.some((shot) => shot.form_factor === "wide"));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === "/?view=status"));
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
  await Promise.all(manifest.screenshots.map((shot) => access(new URL(`../public${shot.src}`, import.meta.url))));
});

test("includes the installed-app tournament handoff safeguards", async () => {
  const [page, pwa] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pwa.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /else if \(standalone\).*setNeedsPwaConnection\(true\)/s);
  assert.match(page, /x-edit-token/);
  assert.match(page, /private admin link is invalid or has expired/i);
  assert.match(page, /lagata-cached-tournament-/);
  assert.match(pwa, /Bring your tournament onto this iPhone/);
  assert.match(pwa, /Create a new tournament instead/);
  assert.match(pwa, /element\.inert = true/);
});

test("shows actionable iPhone installation instructions", async () => {
  const pwa = await readFile(new URL("../app/pwa.tsx", import.meta.url), "utf8");
  assert.match(pwa, /if \(isIos\) \{\s*setShowIosHelp\(true\);\s*return;/s);
  assert.match(pwa, /Add Lagata to your Home Screen/);
  assert.match(pwa, /Tap the Share button/);
  assert.match(pwa, /Select Add to Home Screen/);
  assert.match(pwa, /onClick=\{onClose\}/);
  assert.doesNotMatch(pwa, /onClick=\{pwa\.closeIosHelp\(\)\}/);
});

test("protects multi-device score updates and queues offline admin changes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /lagata-pending-sync-/);
  assert.match(page, /x-base-version/);
  assert.match(page, /response\.status === 409/);
  assert.match(page, /Another scorekeeper saved first/);
  assert.match(page, /Use cloud version/);
  assert.match(page, /Keep this device version/);
  assert.match(page, /const isViewer = isSpectator/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /showSyncPill/);
  assert.match(page, /syncPillLeaving/);
});

test("compacts legacy audit snapshots and reports actionable sync failures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const UNDO_HISTORY_LIMIT = 5/);
  assert.match(page, /historyNeedsCompaction/);
  assert.match(page, /compactTournament\(value\)/);
  assert.match(page, /window\.addEventListener\("online", wake\)/);
  assert.match(page, /Changes queued for retry/);
  assert.match(page, /requestError\?\.status === 413/);
});

test("ships an actionable PWA status centre, opt-in alerts and app badges", async () => {
  const [page, pwa, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/pwa.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /PwaStatusCentre/);
  assert.match(page, /Device &amp; app status/);
  assert.match(page, /showMobileMenu && <div className="mobileActionMenu"/);
  assert.match(pwa, /Repair cached data/);
  assert.match(page, /pendingCount: data\.matches\.filter/);
  assert.match(pwa, /Notification\.requestPermission\(\)/);
  assert.match(pwa, /pushManager\.subscribe/);
  assert.match(pwa, /\/api\/push-key/);
  assert.match(pwa, /\/api\/push-subscription/);
  assert.match(pwa, /lagata-notifications-enabled/);
  assert.match(pwa, /setAppBadge/);
  assert.match(pwa, /Match now live/);
  assert.match(pwa, /Final result/);
  assert.match(pwa, /is champion/);
  assert.match(worker, /GET_VERSION/);
  assert.match(worker, /notificationclick/);
  assert.match(worker, /addEventListener\("push"/);
});

test("keeps spectator, conflict and tournament-format reliability boundaries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const isViewer = isSpectator/);
  assert.match(page, /if \(isViewer\) return/);
  assert.match(page, /x-base-version/);
  assert.match(page, /response\.status === 409/);
  assert.match(page, /format === "knockout" \? advanceKnockout/);
  assert.match(page, /format === "league"/);
  assert.match(page, /window\.addEventListener\("pageshow", wake\)/);
  assert.match(page, /window\.addEventListener\("online", wake\)/);
});
