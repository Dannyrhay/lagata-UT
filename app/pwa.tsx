"use client";

import { useCallback, useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function usePwa() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [isStandalone] = useState(() => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
  const [isIos] = useState(() => typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent));
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeinstallprompt", beforeInstall);

    let updateTimer: ReturnType<typeof setInterval> | undefined;
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaitingWorker(worker);
          });
        });
        updateTimer = setInterval(() => registration.update(), 60 * 60 * 1000);
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      if (updateTimer) clearInterval(updateTimer);
    };
  }, []);

  const install = useCallback(async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    if (isIos) setShowIosHelp(true);
  }, [installPrompt, isIos]);

  const applyUpdate = useCallback(() => {
    if (!waitingWorker) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  return {
    isOnline,
    isStandalone,
    canInstall: !isStandalone && (Boolean(installPrompt) || isIos),
    showIosHelp,
    updateReady: Boolean(waitingWorker),
    install,
    closeIosHelp: () => setShowIosHelp(false),
    applyUpdate,
  };
}

export type PwaState = ReturnType<typeof usePwa>;

export function PwaInstallButton({ pwa }: { pwa: PwaState }) {
  if (!pwa.canInstall) return null;
  return <button className="pwaInstallButton" onClick={pwa.install} aria-label="Install Lagata Ultimate Team"><span aria-hidden="true">↓</span><span>Install app</span></button>;
}

export function PwaExperience({ pwa }: { pwa: PwaState }) {
  return <>
    {!pwa.isOnline && <div className="pwaOfflineBar" role="status"><span aria-hidden="true">●</span><b>You&apos;re offline</b><small>Fixtures and saved scores remain available. Editing resumes when you reconnect.</small></div>}
    {pwa.updateReady && <aside className="pwaUpdateToast" aria-live="polite"><div><b>Lagata update ready</b><small>Refresh to use the latest version.</small></div><button onClick={pwa.applyUpdate}>Update now</button></aside>}
    {pwa.showIosHelp && <div className="modalBack pwaHelpBack"><section className="pwaHelp" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title"><button className="pwaHelpClose" aria-label="Close install instructions" onClick={pwa.closeIosHelp()}>×</button><span className="pwaHelpIcon" aria-hidden="true">L<small>UT</small></span><p>INSTALL ON IPHONE</p><h2 id="pwa-help-title">Put Lagata on your Home Screen</h2><ol><li><span>1</span><div><b>Tap Share</b><small>Use the Share button in Safari&apos;s toolbar.</small></div></li><li><span>2</span><div><b>Choose Add to Home Screen</b><small>Scroll the action list if you do not see it.</small></div></li><li><span>3</span><div><b>Tap Add</b><small>Lagata will open full-screen like an app.</small></div></li></ol><button className="pwaHelpDone" onClick={pwa.closeIosHelp()}>Got it</button></section></div>}
  </>;
}
