"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { QRCodeSVG } from "qrcode.react";
import { Button, Input } from "./ui/tournament-controls";

export function TournamentAccess({ id, name, isAdmin, online, onJoin, onBrowse, onAdmin }: { id: string; name: string; isAdmin: boolean; online: boolean; onJoin: (value: string) => Promise<void>; onBrowse: () => void; onAdmin: () => void }) {
  const [panel, setPanel] = useState<"join" | "share" | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Never include the administrator fragment in spectator sharing.
  const url = typeof window === "undefined" || !id ? "" : `${window.location.origin}/?t=${encodeURIComponent(id)}`;
  function open(next: "join" | "share") { setError(""); setCopied(false); setPanel(next); }
  async function join(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await onJoin(value); setPanel(null); setValue(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join. Please try again."); } finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setError("Copy is unavailable. Select the link below to copy it manually."); } }
  async function share() { try { await navigator.share({ title: name, text: `Follow ${name} on Lagata`, url }); } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("Sharing is unavailable. Copy the link instead."); } }
  return <section className="tournamentAccess" aria-label="Current tournament and access">
    <div className="tournamentIdentity"><span className="accessKicker">CURRENT TOURNAMENT</span><strong>{name}</strong><span className={`accessBadge ${isAdmin ? "admin" : ""}`}>{!id ? "Local preview" : isAdmin ? "Administrator" : "Spectator · read-only"}</span></div>
    <div className="accessActions"><Button variant="outline" onClick={onBrowse}>My tournaments</Button><Button variant="outline" onClick={() => open("join")}>Join tournament</Button>{id && <Button onClick={() => open("share")}>Share / QR</Button>}{id && isAdmin && <Button variant="outline" onClick={onAdmin}>Invite scorekeeper</Button>}</div>
    <Dialog.Root open={panel !== null} onOpenChange={(next) => { if (!next && !busy) setPanel(null); }}><Dialog.Portal><Dialog.Overlay className="accessOverlay" /><Dialog.Content className="accessDialog" aria-busy={busy}>
      <Dialog.Title>{panel === "join" ? "Join a tournament" : "Bring everyone to the game"}</Dialog.Title>
      <Dialog.Description>{panel === "join" ? "Enter a tournament code or link. Spectator links can be opened directly—no pasting needed." : "Scan this QR code or tap the shared link to follow this tournament. It never grants editing access."}</Dialog.Description>
      {panel === "join" ? <form onSubmit={join}><label htmlFor="tournament-join">Tournament code or link</label><Input id="tournament-join" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 0701b11c7a" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={2048} disabled={busy} /><small>Private admin links grant scorekeeping access. Keep them confidential.</small><Button type="submit" disabled={busy || !online || !value.trim()}>{busy ? "Connecting…" : "Join tournament"}</Button>{!online && <p role="status">Reconnect to join a tournament.</p>}</form> : <><div className="spectatorQR"><QRCodeSVG value={url} size={196} level="M" marginSize={4} title={`Spectator link for ${name}`} /></div><p className="joinCode">Tournament code <strong>{id}</strong></p><label htmlFor="spectator-link">Read-only spectator link</label><Input id="spectator-link" readOnly value={url} onFocus={(event) => event.target.select()} /><div className="accessActions"><Button onClick={copy}>{copied ? "Link copied" : "Copy spectator link"}</Button>{typeof navigator !== "undefined" && typeof navigator.share === "function" && <Button variant="outline" onClick={share}>Share…</Button>}</div><small>Installed-app opening depends on your phone. The link always identifies this tournament.</small></>}
      {error && <p className="accessError" role="alert">{error}</p>}<Dialog.Close className="accessClose" aria-label="Close tournament access" disabled={busy}>×</Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
