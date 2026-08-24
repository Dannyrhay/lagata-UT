(() => {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost") return;

  const registration = navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  window.__lagataServiceWorkerRegistration = registration;
  registration.catch((error) => {
    console.warn("Lagata service worker registration failed", error);
  });
})();
