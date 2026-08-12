const PWA_VERSION = "__PWA_VERSION__";
const SHELL_CACHE = `lagata-shell-${PWA_VERSION}`;
const DATA_CACHE = `lagata-data-${PWA_VERSION}`;
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
  /* INJECT_PRECACHE */
];
const TOURNAMENT_API = "https://lagata-live-scores.benernestcass.chatgpt.site";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("lagata-") && ![SHELL_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.ports?.[0]?.postMessage({ version: PWA_VERSION });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    const target = event.notification.data?.url || "/";
    return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target);
  }));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Lagata update", body: "Your tournament has a new update.", tag: "lagata-update", url: "/" };
  try { payload = { ...payload, ...event.data?.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, tag: payload.tag, data: { url: payload.url }, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }));
});

async function networkFirstTournament(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "content-type": "application/json" } });
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put("/", response.clone());
    return response;
  } catch {
    return (await cache.match("/")) || Response.error();
  }
}

async function cachedAsset(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === TOURNAMENT_API && url.pathname === "/api/tournament") {
    event.respondWith(networkFirstTournament(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }
  event.respondWith(cachedAsset(request));
});
