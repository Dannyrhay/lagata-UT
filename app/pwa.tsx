"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function usePwa() {
  const [isOnline, setIsOnline] = useState(true);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isIosSafari, setIsIosSafari] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const syncEnvironment = setTimeout(() => {
      setIsOnline(navigator.onLine !== false);
      setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      setIsIos(ios);
      setIsIosSafari(ios && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|opios/i.test(navigator.userAgent));
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

  return {
    isOnline,
    isStandalone,
    isIos,
    isIosSafari,
    canInstall: !isStandalone && (Boolean(installPrompt) || isIos),
    showIosHelp,
    updateReady: Boolean(waitingWorker),
    install,
    closeIosHelp,
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
    {pwa.showIosHelp && <IosInstallGuide isSafari={pwa.isIosSafari} onClose={pwa.closeIosHelp} />}
  </>;
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
