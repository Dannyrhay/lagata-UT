"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type BadgeNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
const PUSH_API = "https://lagata-live-scores.benernestcass.chatgpt.site";
function pushKeyBytes(value: string) { const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, "=").replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer as ArrayBuffer; }
export type TournamentActivity = {
  tournamentId: string;
  pendingCount: number;
  live: { id: string; label: string }[];
  finished: { id: string; label: string; score: string }[];
  champion?: { id: string; name: string; tournament: string };
};

export function usePwa() {
  const [isOnline, setIsOnline] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [appVersion, setAppVersion] = useState("Checking…");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const pushTournamentRef = useRef("");

  useEffect(() => {
    const syncEnvironment = setTimeout(() => {
      setIsOnline(navigator.onLine !== false);
      setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIsIos(ios);
      setIsIosSafari(ios && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|opios/i.test(navigator.userAgent));
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
      setNotificationsEnabled(localStorage.getItem("lagata-notifications-enabled") === "true");
    }, 0);
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
        const worker = registration.active || registration.waiting || registration.installing;
        if (worker) {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            if (!event.data?.version) return;
            const version = String(event.data.version);
            setAppVersion(version.includes("__PWA_VERSION__") ? "development" : version);
          };
          worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
        }
        registration.pushManager?.getSubscription().then((subscription) => setPushSubscribed(Boolean(subscription))).catch(() => {});
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      clearTimeout(syncEnvironment);
      if (updateTimer) clearInterval(updateTimer);
    };
  }, []);

  const install = useCallback(async () => {
    if (isIos) {
      setShowIosHelp(true);
      return;
    }
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
    }
  }, [installPrompt, isIos]);

  const closeIosHelp = useCallback(() => setShowIosHelp(false), []);

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

  const requestNotifications = useCallback(async (tournamentId?: string) => {
    if (!("Notification" in window)) { setNotificationPermission("unsupported"); return false; }
    if (isIos && !isStandalone) { setShowIosHelp(true); return false; }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") { setNotificationsEnabled(false); localStorage.setItem("lagata-notifications-enabled", "false"); return false; }
    try {
      const registration = await navigator.serviceWorker.ready;
      if (tournamentId && registration.pushManager) {
        const keyResponse = await fetch(`${PUSH_API}/api/push-key`); const keyResult = await keyResponse.json();
        if (!keyResponse.ok || !keyResult.publicKey) throw new Error("Push notifications are temporarily unavailable");
        const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKeyBytes(keyResult.publicKey) });
        const saveResponse = await fetch(`${PUSH_API}/api/push-subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournamentId, subscription: subscription.toJSON() }) });
        if (!saveResponse.ok) throw new Error("Could not save notification subscription");
        pushTournamentRef.current = tournamentId;
        setPushSubscribed(true);
      }
      setNotificationError(""); setNotificationsEnabled(true); localStorage.setItem("lagata-notifications-enabled", "true");
      await registration.showNotification("Lagata alerts are on", { body: "Live matches, final scores and champions can now alert this device.", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: "lagata-alerts-enabled" });
      return true;
    } catch (error) { setNotificationError(error instanceof Error ? error.message : "Could not enable alerts"); setNotificationsEnabled(false); localStorage.setItem("lagata-notifications-enabled", "false"); return false; }
  }, [isIos, isStandalone]);

  const disableNotifications = useCallback(async () => {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager?.getSubscription();
      if (subscription) { await fetch(`${PUSH_API}/api/push-subscription`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {}); await subscription.unsubscribe().catch(() => false); }
    }
    setPushSubscribed(false);
    setNotificationError("");
    setNotificationsEnabled(false);
    localStorage.setItem("lagata-notifications-enabled", "false");
  }, []);

  const updateTournamentActivity = useCallback(async (activity: TournamentActivity) => {
    const badgeNavigator = navigator as BadgeNavigator;
    try { if (activity.pendingCount > 0) await badgeNavigator.setAppBadge?.(activity.pendingCount); else await badgeNavigator.clearAppBadge?.(); } catch {}
    if (notificationsEnabled && pushSubscribed && activity.tournamentId && pushTournamentRef.current !== activity.tournamentId && "serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager?.getSubscription();
        if (subscription) {
          const response = await fetch(`${PUSH_API}/api/push-subscription`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournamentId: activity.tournamentId, subscription: subscription.toJSON() }) });
          if (response.ok) pushTournamentRef.current = activity.tournamentId;
        }
      } catch {}
    }
    const key = `lagata-alert-state-${activity.tournamentId}`;
    const next = { live: activity.live.map((item) => item.id), finished: activity.finished.map((item) => item.id), champion: activity.champion?.id || "" };
    let previous: typeof next | null = null;
    try { previous = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    localStorage.setItem(key, JSON.stringify(next));
    if (!previous || !notificationsEnabled || pushSubscribed || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const newlyLive = activity.live.find((item) => !previous!.live.includes(item.id));
    const newlyFinished = activity.finished.find((item) => !previous!.finished.includes(item.id));
    if (activity.champion && activity.champion.id !== previous.champion) await registration.showNotification(`🏆 ${activity.champion.name} is champion`, { body: `${activity.champion.tournament} has a winner.`, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `champion-${activity.tournamentId}` });
    else if (newlyFinished) await registration.showNotification("Final result", { body: `${newlyFinished.label} · ${newlyFinished.score}`, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `finished-${newlyFinished.id}` });
    else if (newlyLive) await registration.showNotification("Match now live", { body: newlyLive.label, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `live-${newlyLive.id}` });
  }, [notificationsEnabled, pushSubscribed]);

  const checkForUpdate = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  }, []);

  const repairCaches = useCallback(async () => {
    if ("caches" in window) await Promise.all((await caches.keys()).filter((key) => key.startsWith("lagata-")).map((key) => caches.delete(key)));
    await checkForUpdate();
  }, [checkForUpdate]);

  return {
    isOnline,
    isStandalone,
    isIos,
    isIosSafari,
    canInstall: !isStandalone && (Boolean(installPrompt) || isIos),
    showIosHelp,
    updateReady: Boolean(waitingWorker),
    appVersion,
    notificationPermission,
    notificationsEnabled,
    pushSubscribed,
    notificationError,
    install,
    closeIosHelp,
    applyUpdate,
    requestNotifications,
    disableNotifications,
    updateTournamentActivity,
    checkForUpdate,
    repairCaches,
  };
}

export type PwaState = ReturnType<typeof usePwa>;

export function PwaInstallButton({ pwa }: { pwa: PwaState }) {
  if (!pwa.canInstall) return null;
  return <button className="pwaInstallButton" onClick={pwa.install} aria-label="Install Lagata Ultimate Team"><span aria-hidden="true">↓</span><span>Install app</span></button>;
}

export function PwaExperience({ pwa }: { pwa: PwaState }) {
  return <>
    {!pwa.isOnline && <div className="pwaOfflineBar" role="status"><span aria-hidden="true">●</span><b>You&apos;re offline</b><small>Admin changes stay queued on this device and sync when you reconnect.</small></div>}
    {pwa.updateReady && <aside className="pwaUpdateToast" aria-live="polite"><div><b>Lagata update ready</b><small>Refresh to use the latest version.</small></div><button onClick={pwa.applyUpdate}>Update now</button></aside>}
    {pwa.showIosHelp && <IosInstallGuide isSafari={pwa.isIosSafari} onClose={pwa.closeIosHelp} />}
  </>;
}

export function PwaStatusCentre({ pwa, open, onClose, tournamentId, tournamentName, accessLevel, syncLabel, syncDetail, onRetrySync, onSwitchTournament, onRepairData }: { pwa: PwaState; open: boolean; onClose: () => void; tournamentId: string; tournamentName: string; accessLevel: "Administrator" | "Spectator" | "Local only"; syncLabel: string; syncDetail: string; onRetrySync: () => void; onSwitchTournament: () => void; onRepairData: () => Promise<void> }) {
  const [repairing, setRepairing] = useState(false);
  if (!open) return null;
  async function repair() { setRepairing(true); try { await pwa.repairCaches(); await onRepairData(); } finally { setRepairing(false); } }
  const installLabel = pwa.isStandalone ? "Installed app" : pwa.canInstall ? "Ready to install" : "Browser mode";
  const notificationLabel = pwa.notificationPermission === "unsupported" ? "Not supported" : pwa.notificationsEnabled ? pwa.pushSubscribed ? "Background alerts enabled" : "Alerts enabled" : pwa.notificationPermission === "denied" ? "Blocked in Settings" : "Alerts off";
  return <div className="modalBack pwaStatusBack" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="pwaStatusCentre" role="dialog" aria-modal="true" aria-labelledby="pwa-status-title">
    <div className="pwaStatusHead"><div><p>APP STATUS CENTRE</p><h2 id="pwa-status-title">Lagata on this device</h2></div><button aria-label="Close app status" onClick={onClose}>×</button></div>
    <div className="pwaStatusGrid">
      <article><span className={pwa.isStandalone ? "ok" : "idle"}>●</span><div><small>INSTALLATION</small><b>{installLabel}</b><em>Version {pwa.appVersion}</em></div></article>
      <article><span className={pwa.isOnline ? "ok" : "warn"}>●</span><div><small>CONNECTION</small><b>{pwa.isOnline ? "Online" : "Offline"}</b><em>{syncDetail}</em></div></article>
      <article><span className="ok">●</span><div><small>TOURNAMENT</small><b>{tournamentName}</b><em>{accessLevel}</em></div></article>
      <article><span className={pwa.notificationsEnabled ? "ok" : "idle"}>●</span><div><small>NOTIFICATIONS</small><b>{notificationLabel}</b><em>Live, finals and champions</em></div></article>
    </div>
    <div className="pwaStatusSummary"><span>Cloud sync</span><b>{syncLabel}</b>{pwa.updateReady && <i>Update ready</i>}</div>
    <div className="pwaStatusActions">
      {!pwa.notificationsEnabled && pwa.notificationPermission !== "denied" && pwa.notificationPermission !== "unsupported" && <button className="primary" onClick={() => pwa.requestNotifications(tournamentId)}>Enable alerts</button>}
      {pwa.notificationsEnabled && <button onClick={pwa.disableNotifications}>Turn alerts off</button>}
      {pwa.canInstall && <button onClick={pwa.install}>Install app</button>}
      {pwa.updateReady ? <button className="primary" onClick={pwa.applyUpdate}>Install update</button> : <button onClick={pwa.checkForUpdate}>Check for update</button>}
      {accessLevel === "Administrator" && <button onClick={onRetrySync}>Retry sync</button>}
      <button onClick={onSwitchTournament}>Switch tournament</button>
      <button disabled={repairing} onClick={repair}>{repairing ? "Repairing…" : "Repair cached data"}</button>
    </div>
    {pwa.notificationError && <p className="pwaStatusError" role="alert">{pwa.notificationError}</p>}
    <p className="pwaStatusFoot">Repair removes downloaded app caches and reloads the cloud copy. Unsynced score changes remain protected on this device.</p>
  </section></div>;
}

function IosInstallGuide({ isSafari, onClose }: { isSafari: boolean; onClose: () => void }) {
  const backRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = backRef.current;
    const siblings = root?.parentElement ? Array.from(root.parentElement.children).filter((element) => element !== root) as HTMLElement[] : [];
    siblings.forEach((element) => { element.inert = true; });
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      siblings.forEach((element) => { element.inert = false; });
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return <div ref={backRef} className="modalBack pwaHelpBack" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="pwaHelp" role="dialog" aria-modal="true" aria-labelledby="pwa-help-title" tabIndex={-1}>
      <button type="button" className="pwaHelpClose" aria-label="Close install instructions" onClick={onClose}>×</button>
      <span className="pwaHelpIcon" aria-hidden="true">L<small>UT</small></span>
      <p>INSTALL ON IPHONE</p>
      <h2 id="pwa-help-title">Add Lagata to your Home Screen</h2>
      {!isSafari && <aside className="pwaSafariNote"><b>Open this page in Safari first</b><small>Tap your browser&apos;s Share button, choose <strong>Open in Safari</strong>, then follow the steps below.</small></aside>}
      <ol>
        <li><span>1</span><div><b>Tap the Share button <i aria-hidden="true">↑</i></b><small>It looks like a square with an upward arrow in Safari&apos;s toolbar.</small></div></li>
        <li><span>2</span><div><b>Select Add to Home Screen</b><small>Scroll down through the share options if it is not immediately visible.</small></div></li>
        <li><span>3</span><div><b>Tap Add</b><small>Confirm in the top-right corner. Lagata will then appear on your Home Screen.</small></div></li>
      </ol>
      <p className="pwaInstallFootnote">After installation, open Lagata from its new Home Screen icon.</p>
      <button type="button" className="pwaHelpDone" onClick={onClose}>I understand</button>
    </section>
  </div>;
}

export function PwaConnect({ canClose, isOnline, onClose, onConnect, onCreate }: { canClose: boolean; isOnline: boolean; onClose: () => void; onConnect: (value: string) => Promise<void>; onCreate: () => void }) {
  const backRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "error">("idle");
  const [message, setMessage] = useState("");
  const looksLikeAdmin = /[#&]admin=/.test(value);

  useEffect(() => {
    const root = backRef.current;
    const siblings = root?.parentElement ? Array.from(root.parentElement.children).filter((element) => element !== root) as HTMLElement[] : [];
    siblings.forEach((element) => { element.inert = true; });
    return () => siblings.forEach((element) => { element.inert = false; });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || !isOnline) return;
    setState("connecting");
    setMessage("");
    try {
      await onConnect(value);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "That tournament could not be connected.");
    }
  }

  async function pasteLink() {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text);
      setState("idle");
      setMessage("");
    } catch {
      setMessage("Press and hold in the field, then choose Paste.");
      setState("error");
    }
  }

  return <div ref={backRef} className="modalBack pwaConnectBack"><section className="pwaConnect" role="dialog" aria-modal="true" aria-labelledby="pwa-connect-title">
    {canClose && <button className="pwaHelpClose" aria-label="Close connection screen" onClick={onClose}>×</button>}
    <span className="pwaHelpIcon" aria-hidden="true">L<small>UT</small></span>
    <p>CONNECT THIS APP</p>
    <h2 id="pwa-connect-title">Bring your tournament onto this iPhone</h2>
    <p className="pwaConnectIntro">Paste the link from your existing tournament. Lagata will download its latest fixtures and remember them in this installed app.</p>
    <form onSubmit={submit}>
      <label htmlFor="pwa-connect-value">Tournament link or spectator code</label>
      <div className="pwaConnectField"><input id="pwa-connect-value" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" value={value} onChange={(event) => { setValue(event.target.value); setState("idle"); setMessage(""); }} placeholder="https://…?t=…" /><button type="button" onClick={pasteLink}>Paste</button></div>
      {value && <div className={`pwaAccessPreview ${looksLikeAdmin ? "admin" : "spectator"}`}><span aria-hidden="true">{looksLikeAdmin ? "◆" : "◉"}</span><div><b>{looksLikeAdmin ? "Admin access detected" : "Spectator access"}</b><small>{looksLikeAdmin ? "This device will be able to update scores." : "This device will receive view-only live scores."}</small></div></div>}
      {state === "error" && <p className="pwaConnectError" role="alert">{message}</p>}
      {!isOnline && <p className="pwaConnectError" role="status">Reconnect to the internet to download a tournament.</p>}
      <button className="pwaConnectPrimary" disabled={!value.trim() || !isOnline || state === "connecting"}>{state === "connecting" ? "Connecting…" : "Connect tournament"}</button>
    </form>
    <div className="pwaConnectHelp"><b>Where is the link?</b><small>On the existing admin device, use <strong>Copy link</strong> for spectators or <strong>Manage tournament → Access → Copy admin link</strong> for scorekeepers.</small></div>
    {!canClose && <button className="pwaCreateInstead" onClick={onCreate}>Create a new tournament instead</button>}
  </section></div>;
}
