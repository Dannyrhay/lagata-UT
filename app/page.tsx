"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PwaConnect, PwaExperience, PwaInstallButton, PwaStatusCentre, usePwa } from "./pwa";

type Player = { id: string; name: string; team: string };
type MatchStatus = "scheduled" | "live" | "finished" | "postponed";
type Match = { id: string; round: number; homeId: string; awayId: string; homeScore: number | null; awayScore: number | null; homeExtraTime?: number | null; awayExtraTime?: number | null; homePenalties?: number | null; awayPenalties?: number | null; status: MatchStatus };
type Format = "league" | "knockout";
type AuditEntry = { id: string; at: string; label: string; snapshot?: string };
type Tournament = { name: string; format: Format; homeAndAway: boolean; players: Player[]; matches: Match[]; history: AuditEntry[] };
type TournamentRef = { id: string; name: string; updatedAt: string; archived?: boolean };
type SyncStatus = "saved" | "saving" | "offline" | "queued" | "conflict" | "error";
type PendingSync = { tournament: Tournament; baseVersion: string; queuedAt: string };
type SyncConflict = { tournament: Tournament; version: string };

const HISTORY_LIMIT = 40;
const UNDO_HISTORY_LIMIT = 5;

class SyncRequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = "SyncRequestError"; this.status = status; }
}

const demoPlayers: Player[] = [
  { id: "p1", name: "Marcus", team: "Real Madrid" }, { id: "p2", name: "Dre", team: "Barcelona" },
  { id: "p3", name: "Jay", team: "Liverpool" }, { id: "p4", name: "Tobi", team: "Bayern" },
];

function shuffled(ids: string[]) {
  const result = [...ids];
  for (let i = result.length - 1; i > 1; i--) { const j = 1 + Math.floor(Math.random() * i); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function makeFixtures(players: Player[], format: Format, homeAndAway = false): Match[] {
  const ids = shuffled(players.map((p) => p.id));
  if (format === "knockout") return Array.from({ length: ids.length / 2 }, (_, i) => ({ id: crypto.randomUUID(), round: 1, homeId: ids[i * 2], awayId: ids[i * 2 + 1], homeScore: null, awayScore: null, status: "scheduled" }));
  const rotation: (string | null)[] = [...ids]; if (rotation.length % 2) rotation.push(null);
  const matches: Match[] = []; let ring = [...rotation];
  for (let round = 1; round < rotation.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a && b) { const swap = (round + i) % 2 === 0; matches.push({ id: crypto.randomUUID(), round, homeId: swap ? b : a, awayId: swap ? a : b, homeScore: null, awayScore: null, status: "scheduled" }); }
    }
    ring = [ring[0], ring.at(-1)!, ...ring.slice(1, -1)];
  }
  if (!homeAndAway) return matches;
  const firstLegRounds = rotation.length - 1;
  return [...matches, ...matches.map((match) => ({
    ...match,
    id: crypto.randomUUID(),
    round: match.round + firstLegRounds,
    homeId: match.awayId,
    awayId: match.homeId,
  }))];
}

function knockoutWinner(match: Match) {
  if (match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore !== match.awayScore) return match.homeScore > match.awayScore ? match.homeId : match.awayId;
  if (match.homeExtraTime === null || match.homeExtraTime === undefined || match.awayExtraTime === null || match.awayExtraTime === undefined) return null;
  const homeAfterExtraTime = match.homeScore + match.homeExtraTime;
  const awayAfterExtraTime = match.awayScore + match.awayExtraTime;
  if (homeAfterExtraTime !== awayAfterExtraTime) return homeAfterExtraTime > awayAfterExtraTime ? match.homeId : match.awayId;
  if (match.homePenalties === null || match.homePenalties === undefined || match.awayPenalties === null || match.awayPenalties === undefined || match.homePenalties === match.awayPenalties) return null;
  return match.homePenalties > match.awayPenalties ? match.homeId : match.awayId;
}

function confirmedKnockoutWinner(match: Match) {
  return match.status === "finished" ? knockoutWinner(match) : null;
}

function knockoutDecision(match: Match) {
  if (!knockoutWinner(match)) return null;
  if (match.homeScore !== match.awayScore) return "FT";
  const homeAfterExtraTime = match.homeScore! + (match.homeExtraTime || 0);
  const awayAfterExtraTime = match.awayScore! + (match.awayExtraTime || 0);
  return homeAfterExtraTime !== awayAfterExtraTime ? "AET" : "PENS";
}

function knockoutScoreline(match: Match) {
  if (match.homeScore === null || match.awayScore === null) return "Awaiting result";
  const extraTimeReady = match.homeExtraTime !== null && match.homeExtraTime !== undefined && match.awayExtraTime !== null && match.awayExtraTime !== undefined;
  const homeTotal = match.homeScore + (extraTimeReady ? match.homeExtraTime! : 0);
  const awayTotal = match.awayScore + (extraTimeReady ? match.awayExtraTime! : 0);
  if (knockoutDecision(match) === "PENS") return `${homeTotal}–${awayTotal} · ${match.homePenalties}–${match.awayPenalties} pens`;
  return `${homeTotal}–${awayTotal}${knockoutDecision(match) === "AET" ? " AET" : ""}`;
}

function knockoutRoundLabel(roundNumber: number, totalRounds: number) {
  const roundsRemaining = totalRounds - roundNumber;
  if (roundsRemaining === 0) return "Final";
  if (roundsRemaining === 1) return "Semi-finals";
  if (roundsRemaining === 2) return "Quarter-finals";
  return `Round ${roundNumber}`;
}

function advanceKnockout(matches: Match[]) {
  let result = matches.map((match) => ({ ...match }));
  let round = 1;
  while (true) {
    const current = result.filter((match) => match.round === round);
    if (current.length <= 1) break;
    const winners = current.map(confirmedKnockoutWinner);
    if (winners.some((winner) => !winner)) {
      result = result.filter((match) => match.round <= round);
      break;
    }
    const pairCount = winners.length / 2;
    const nextRound = result.filter((match) => match.round === round + 1);
    if (nextRound.length !== pairCount) {
      result = result.filter((match) => match.round <= round);
      for (let i = 0; i < winners.length; i += 2) result.push({ id: crypto.randomUUID(), round: round + 1, homeId: winners[i]!, awayId: winners[i + 1]!, homeScore: null, awayScore: null, homeExtraTime: null, awayExtraTime: null, homePenalties: null, awayPenalties: null, status: "scheduled" });
    } else {
      result = result.map((match) => {
        if (match.round !== round + 1) return match;
        const index = nextRound.findIndex((candidate) => candidate.id === match.id);
        const homeId = winners[index * 2]!, awayId = winners[index * 2 + 1]!;
        return match.homeId === homeId && match.awayId === awayId ? match : { ...match, homeId, awayId, homeScore: null, awayScore: null, homeExtraTime: null, awayExtraTime: null, homePenalties: null, awayPenalties: null, status: "scheduled" };
      });
    }
    round++;
  }
  return result;
}

const initialMatches: Match[] = [
  { id: "demo-r1-m1", round: 1, homeId: "p1", awayId: "p4", homeScore: null, awayScore: null, status: "scheduled" },
  { id: "demo-r1-m2", round: 1, homeId: "p2", awayId: "p3", homeScore: null, awayScore: null, status: "scheduled" },
  { id: "demo-r2-m1", round: 2, homeId: "p1", awayId: "p3", homeScore: null, awayScore: null, status: "scheduled" },
  { id: "demo-r2-m2", round: 2, homeId: "p4", awayId: "p2", homeScore: null, awayScore: null, status: "scheduled" },
  { id: "demo-r3-m1", round: 3, homeId: "p1", awayId: "p2", homeScore: null, awayScore: null, status: "scheduled" },
  { id: "demo-r3-m2", round: 3, homeId: "p3", awayId: "p4", homeScore: null, awayScore: null, status: "scheduled" },
];

const initial: Tournament = { name: "Friday Night League", format: "league", homeAndAway: false, players: demoPlayers, matches: initialMatches, history: [] };
const API_BASE = "https://lagata-live-scores.benernestcass.chatgpt.site";
const statusLabels: Record<MatchStatus, string> = { scheduled: "Scheduled", live: "Live", finished: "Finished", postponed: "Postponed" };

function normaliseTournament(value: Partial<Tournament>): Tournament {
  const format = value.format || "league";
  const normalisedMatches = (value.matches || []).map((match) => {
    const normalised = { ...match, homeExtraTime: match.homeExtraTime ?? null, awayExtraTime: match.awayExtraTime ?? null, homePenalties: match.homePenalties ?? null, awayPenalties: match.awayPenalties ?? null };
    const hasScore = normalised.homeScore !== null && normalised.awayScore !== null;
    const resolved = format === "knockout" ? Boolean(knockoutWinner(normalised)) : hasScore;
    const status = match.status === "postponed" ? "postponed" : format === "league" ? resolved ? "finished" : hasScore ? "live" : match.status || "scheduled" : match.status === "finished" && resolved ? "finished" : hasScore ? "live" : "scheduled";
    return { ...normalised, status } as Match;
  });
  const matches = format === "knockout" ? advanceKnockout(normalisedMatches) : normalisedMatches;
  return { name: value.name || "Friday Night League", format, homeAndAway: Boolean(value.homeAndAway), players: value.players || [], matches, history: compactHistory(value.history) };
}
function compactHistory(value: unknown): AuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, HISTORY_LIMIT).map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Partial<AuditEntry> : {};
    const compact: AuditEntry = { id: item.id || `history-${index}`, at: item.at || new Date(0).toISOString(), label: item.label || "Tournament updated" };
    if (index < UNDO_HISTORY_LIMIT && typeof item.snapshot === "string") compact.snapshot = item.snapshot;
    return compact;
  });
}
function historyNeedsCompaction(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.length > HISTORY_LIMIT || value.filter((entry) => entry && typeof entry === "object" && typeof (entry as Partial<AuditEntry>).snapshot === "string").length > UNDO_HISTORY_LIMIT;
}
function compactTournament(value: Tournament): Tournament { return { ...value, history: compactHistory(value.history) }; }
function snapshotOf(value: Tournament) { const { history: _history, ...snapshot } = value; return JSON.stringify(snapshot); }
function audited(previous: Tournament, next: Tournament, label: string): Tournament { return compactTournament({ ...next, history: [{ id: crypto.randomUUID(), at: new Date().toISOString(), label, snapshot: snapshotOf(previous) }, ...previous.history] }); }
function readCatalog(): TournamentRef[] { try { return JSON.parse(localStorage.getItem("lagata-tournament-catalog") || "[]"); } catch { return []; } }
function pendingSyncKey(id: string) { return `lagata-pending-sync-${id}`; }
function serverVersionKey(id: string) { return `lagata-server-version-${id}`; }
function readServerVersion(id: string) { return localStorage.getItem(serverVersionKey(id)) || localStorage.getItem(`lagata-server-revision-${id}`) || ""; }
function writeServerVersion(id: string, version: string) { if (version) localStorage.setItem(serverVersionKey(id), version); }
function readPendingSync(id: string): PendingSync | null { try { const value = JSON.parse(localStorage.getItem(pendingSyncKey(id)) || "null"); return value?.tournament ? { tournament: normaliseTournament(value.tournament), baseVersion: value.baseVersion || value.baseUpdatedAt || "", queuedAt: value.queuedAt || new Date().toISOString() } : null; } catch { return null; } }
function writePendingSync(id: string, tournament: Tournament, baseVersion: string) { localStorage.setItem(pendingSyncKey(id), JSON.stringify({ tournament: compactTournament(tournament), baseVersion, queuedAt: new Date().toISOString() } satisfies PendingSync)); }
function clearPendingSync(id: string) { localStorage.removeItem(pendingSyncKey(id)); }
function syncPayload(value: Tournament) { return JSON.stringify(compactTournament(value)); }

function MatchCard({ match, matchNumber, format, players, isViewer: isReadOnly, onScore, onResolution, onStatus }: { match: Match; matchNumber: number; format: Format; players: Player[]; isViewer: boolean; onScore: (id: string, side: "homeScore" | "awayScore", value: string) => void; onResolution: (id: string, field: "homeExtraTime" | "awayExtraTime" | "homePenalties" | "awayPenalties", value: string) => void; onStatus: (id: string, status: MatchStatus) => void }) {
  const home = players.find((player) => player.id === match.homeId);
  const away = players.find((player) => player.id === match.awayId);
  if (!home || !away) return null;
  const fullTimeDraw = format === "knockout" && match.homeScore !== null && match.awayScore !== null && match.homeScore === match.awayScore;
  const extraTimeReady = fullTimeDraw && match.homeExtraTime !== null && match.homeExtraTime !== undefined && match.awayExtraTime !== null && match.awayExtraTime !== undefined;
  const extraTimeDraw = extraTimeReady && match.homeScore! + match.homeExtraTime! === match.awayScore! + match.awayExtraTime!;
  const penaltiesReady = extraTimeDraw && match.homePenalties !== null && match.homePenalties !== undefined && match.awayPenalties !== null && match.awayPenalties !== undefined;
  const winner = format === "knockout" ? knockoutWinner(match) : null;
  const decision = format === "knockout" && match.status === "finished" ? knockoutDecision(match) : null;
  return <article className="matchCard">
    <div className="matchMeta">{isReadOnly ? <span className={`statusBadge ${match.status}`}>{statusLabels[match.status]}</span> : <select className={`statusSelect ${match.status}`} aria-label={`Status for ${home.name} versus ${away.name}`} value={match.status} onChange={(event) => onStatus(match.id, event.target.value as MatchStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} disabled={format === "knockout" && value === "finished" && !winner} key={value}>{label}</option>)}</select>}<i />{decision && <span className="decisionBadge">{decision}</span>}<small>Match {matchNumber}</small></div>
    <div className="matchup"><div className="player home"><div><strong>{home.name}</strong><small>{home.team}</small></div><span className="avatar">{home.name.slice(0, 2).toUpperCase()}</span></div><div className="scoreBox"><input readOnly={isReadOnly} aria-label={`${home.name} full-time score`} inputMode="numeric" value={match.homeScore ?? ""} placeholder="–" onChange={(event) => onScore(match.id, "homeScore", event.target.value)} /><b>:</b><input readOnly={isReadOnly} aria-label={`${away.name} full-time score`} inputMode="numeric" value={match.awayScore ?? ""} placeholder="–" onChange={(event) => onScore(match.id, "awayScore", event.target.value)} /></div><div className="player away"><span className="avatar alt">{away.name.slice(0, 2).toUpperCase()}</span><div><strong>{away.name}</strong><small>{away.team}</small></div></div></div>
    {fullTimeDraw && <div className="knockoutResolution"><div className="resolutionIntro"><span>90&apos;</span><div><b>Level after full time</b><small>Enter extra-time goals to decide the tie.</small></div></div><div className="resolutionStage"><label>Extra time</label><div className="miniScore"><input readOnly={isReadOnly} aria-label={`${home.name} extra-time goals`} inputMode="numeric" value={match.homeExtraTime ?? ""} placeholder="–" onChange={(event) => onResolution(match.id, "homeExtraTime", event.target.value)} /><b>:</b><input readOnly={isReadOnly} aria-label={`${away.name} extra-time goals`} inputMode="numeric" value={match.awayExtraTime ?? ""} placeholder="–" onChange={(event) => onResolution(match.id, "awayExtraTime", event.target.value)} /></div></div>{extraTimeDraw && <div className="resolutionStage penalties"><label>Penalties</label><div className="miniScore"><input readOnly={isReadOnly} aria-label={`${home.name} penalties`} inputMode="numeric" value={match.homePenalties ?? ""} placeholder="–" onChange={(event) => onResolution(match.id, "homePenalties", event.target.value)} /><b>:</b><input readOnly={isReadOnly} aria-label={`${away.name} penalties`} inputMode="numeric" value={match.awayPenalties ?? ""} placeholder="–" onChange={(event) => onResolution(match.id, "awayPenalties", event.target.value)} /></div></div>}{penaltiesReady && match.homePenalties === match.awayPenalties && <p className="resolutionError">Penalties must produce a winner.</p>}</div>}
  </article>;
}

function KnockoutResults({ tournament }: { tournament: Tournament }) {
  const generatedMaxRound = Math.max(1, ...tournament.matches.map((match) => match.round));
  const totalRounds = Math.max(1, Math.log2(tournament.players.length));
  const player = (id: string) => tournament.players.find((candidate) => candidate.id === id);
  return <><div className="sectionHead"><div><p className="eyebrow">Cup results</p><h2>Knockout rounds</h2></div><p className="tieNote">Every tie is decided at full time, after extra time, or on penalties</p></div><div className="knockoutResults">{Array.from({ length: generatedMaxRound }, (_, index) => index + 1).map((roundNumber) => { const isFinal = roundNumber === totalRounds; return <section className="resultRound" key={roundNumber}><div className="resultRoundHead"><span>{knockoutRoundLabel(roundNumber, totalRounds)}</span><small>{tournament.matches.filter((match) => match.round === roundNumber && confirmedKnockoutWinner(match)).length}/{tournament.matches.filter((match) => match.round === roundNumber).length} decided</small></div>{tournament.matches.filter((match) => match.round === roundNumber).map((match) => { const home = player(match.homeId), away = player(match.awayId), winner = confirmedKnockoutWinner(match), decision = knockoutDecision(match); const winnerClass = (playerId: string) => winner === playerId ? isFinal ? "winner champion" : "winner" : ""; return <article className={winner ? "decided" : ""} key={match.id}><div><span className={winnerClass(match.homeId)}><b>{home?.name}</b><small>{home?.team}</small></span><strong>{match.homeScore ?? "–"}</strong></div><div><span className={winnerClass(match.awayId)}><b>{away?.name}</b><small>{away?.team}</small></span><strong>{match.awayScore ?? "–"}</strong></div><footer><span>{winner ? isFinal ? `${player(winner)?.name} is champion` : `${player(winner)?.name} advances` : match.status === "live" ? "Result awaiting confirmation" : "Awaiting a winner"}</span><b>{winner ? `${isFinal ? "CHAMPION · " : ""}${knockoutScoreline(match)}` : decision ? `${decision} · Confirm full time` : "Pending"}</b></footer></article>; })}</section>; })}</div></>;
}

function TournamentPitch({ tournament }: { tournament: Tournament }) {
  const generatedMaxRound = Math.max(1, ...tournament.matches.map((match) => match.round));
  const maxRound = tournament.format === "knockout" ? Math.max(1, Math.log2(tournament.players.length)) : generatedMaxRound;
  const player = (id: string) => tournament.players.find((candidate) => candidate.id === id);
  const finalMatch = tournament.format === "knockout" ? tournament.matches.find((match) => match.round === maxRound && tournament.matches.filter((candidate) => candidate.round === maxRound).length === 1) : undefined;
  const championId = finalMatch ? confirmedKnockoutWinner(finalMatch) : null;
  const extendedJourney = tournament.format === "league" && maxRound > 4;
  return <><div className="sectionHead"><div><p className="eyebrow">Tournament map</p><h2>{tournament.format === "league" ? "League journey" : "Road to the cup"}</h2></div><p className="tieNote">Live bracket · updates as results are entered</p></div><div className={`pitchBoard ${tournament.format}${extendedJourney ? " extendedJourney" : ""}`}><div className="pitchDepth" aria-hidden="true"><i /><i /><i /></div><div className="centreCircle" /><div className="pitchFlow">{Array.from({ length: maxRound }, (_, index) => index + 1).map((roundNumber) => { const isFinal = tournament.format === "knockout" && roundNumber === maxRound; return <div className={`pitchRound${isFinal ? " finalRound" : ""}`} key={roundNumber}><h3>{tournament.format === "knockout" ? knockoutRoundLabel(roundNumber, maxRound).toUpperCase() : `ROUND ${roundNumber}`}</h3>{tournament.matches.filter((match) => match.round === roundNumber).map((match) => { const home = player(match.homeId), away = player(match.awayId), winner = tournament.format === "knockout" ? confirmedKnockoutWinner(match) : null; const extraTimeReady = match.homeExtraTime !== null && match.homeExtraTime !== undefined && match.awayExtraTime !== null && match.awayExtraTime !== undefined; const homeScore = match.homeScore === null ? "–" : match.homeScore + (extraTimeReady ? match.homeExtraTime! : 0); const awayScore = match.awayScore === null ? "–" : match.awayScore + (extraTimeReady ? match.awayExtraTime! : 0); const winnerClass = (playerId: string) => winner === playerId ? isFinal ? "winner champion" : "winner" : ""; return <div className={`pitchMatch${winner ? " decided" : ""}`} key={match.id}><span className={winnerClass(match.homeId)}><b>{home?.name}</b><i>{homeScore}</i></span><span className={winnerClass(match.awayId)}><b>{away?.name}</b><i>{awayScore}</i></span>{tournament.format === "knockout" && <small>{isFinal && winner ? "CHAMPION" : winner ? knockoutDecision(match) : match.status === "live" ? "LIVE · UNCONFIRMED" : "UP NEXT"}</small>}</div>; })}</div>; })}{tournament.format === "knockout" && <div className={`cupNode${championId ? " crowned" : ""}`}><span>🏆</span><small>{championId ? "CHAMPION" : "THE CUP"}</small><strong>{championId ? player(championId)?.name : "Awaits a winner"}</strong></div>}</div></div></>;
}

function ChampionCelebration({ champion, onClose }: { champion: Player; onClose: () => void }) {
  return <div className="modalBack championCelebrationBack"><section className="championCelebration" role="dialog" aria-modal="true" aria-labelledby="champion-title"><button className="championClose" aria-label="Close champion celebration" onClick={onClose}>×</button><div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div><p>Lagata Ultimate Team</p><div className="celebrationCup" aria-hidden="true">🏆</div><span>Knockout champion</span><h2 id="champion-title">{champion.name}</h2><strong>{champion.team}</strong><small>One tournament. One winner. The cup is yours.</small><button className="celebrationDone" onClick={onClose}>Lift the cup</button></section></div>;
}

export default function Home() {
  const pwa = usePwa();
  const [data, setData] = useState<Tournament>(initial);
  const [draft, setDraft] = useState<Pick<Tournament, "name" | "players" | "format" | "homeAndAway">>({ name: initial.name, players: initial.players, format: initial.format, homeAndAway: initial.homeAndAway });
  const [ready, setReady] = useState(false); const [tab, setTab] = useState<"matches" | "table" | "stats" | "pitch">("matches");
  const [round, setRound] = useState(1); const [showSetup, setShowSetup] = useState(false); const [settingsTab, setSettingsTab] = useState<"setup" | "access" | "data" | "history">("setup"); const [showDashboard, setShowDashboard] = useState(false); const [showMobileMenu, setShowMobileMenu] = useState(false); const [compactMode, setCompactMode] = useState(false); const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null); const [catalog, setCatalog] = useState<TournamentRef[]>([]); const importRef = useRef<HTMLInputElement>(null); const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showChampionCelebration, setShowChampionCelebration] = useState(false); const previousFinalState = useRef<string | null>(null); const celebratedFinalResult = useRef(""); const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [needsPwaConnection, setNeedsPwaConnection] = useState(false); const [showPwaStatus, setShowPwaStatus] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light"); const [shareId, setShareId] = useState(""); const [editToken, setEditToken] = useState("");
  const [shareState, setShareState] = useState<"idle" | "saving" | "copied" | "error">("idle"); const [adminCopyState, setAdminCopyState] = useState<"idle" | "copied" | "error">("idle"); const cloudLoaded = useRef(false); const creatingCloud = useRef(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("saved"); const [syncErrorDetail, setSyncErrorDetail] = useState(""); const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null); const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null); const [syncWake, setSyncWake] = useState(0);
  const [showSyncPill, setShowSyncPill] = useState(true); const [syncPillLeaving, setSyncPillLeaving] = useState(false); const syncPillTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverVersion = useRef(""); const lastSyncedPayload = useRef(""); const syncChain = useRef<Promise<void>>(Promise.resolve()); const syncBlocked = useRef(false);

  useEffect(() => {
    setCatalog(readCatalog());
    setCompactMode(localStorage.getItem("lagata-scorekeeper-mode") === "true");
    const chosenTheme = (localStorage.getItem("lagata-theme") as "light" | "dark") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); setTheme(chosenTheme);
    const params = new URLSearchParams(location.search); const tournamentId = params.get("t") || "";
    const adminToken = new URLSearchParams(location.hash.slice(1)).get("admin") || "";
    const storedId = localStorage.getItem("lagata-current-tournament") || "";
    const standalone = matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const lastViewedId = localStorage.getItem("lagata-last-tournament") || "";
    const activeId = tournamentId || storedId || (standalone ? lastViewedId : "");
    if (activeId) {
      const token = adminToken || localStorage.getItem(`lagata-edit-${activeId}`) || "";
      if (adminToken) { localStorage.setItem("lagata-current-tournament", activeId); localStorage.setItem(`lagata-edit-${activeId}`, adminToken); history.replaceState({}, "", `${location.pathname}?t=${activeId}`); }
      localStorage.setItem("lagata-last-tournament", activeId);
      setShareId(activeId); setEditToken(token);
      fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(activeId)}`).then((r) => r.ok ? r.json() : Promise.reject()).then(({ tournament, version, updatedAt }) => { const needsRepair = Boolean(token && historyNeedsCompaction(tournament?.history)); const remote = normaliseTournament(tournament); const pending = token ? readPendingSync(activeId) : null; const selected = pending?.tournament || remote; const remoteVersion = version || updatedAt || ""; setData(selected); serverVersion.current = pending?.baseVersion || remoteVersion; writeServerVersion(activeId, remoteVersion); lastSyncedPayload.current = needsRepair ? JSON.stringify(tournament) : syncPayload(remote); localStorage.setItem(`lagata-cached-tournament-${activeId}`, JSON.stringify(selected)); if (token) rememberTournament(activeId, selected.name); cloudLoaded.current = true; if (pending) setSyncStatus("queued"); else if (needsRepair) { setSyncErrorDetail("Optimising saved history"); setSyncStatus("saving"); } else { setSyncStatus("saved"); setLastSyncedAt(new Date()); } setReady(true); }).catch(() => { const pending = token ? readPendingSync(activeId) : null; const cached = localStorage.getItem(`lagata-cached-tournament-${activeId}`); if (pending) { setData(pending.tournament); serverVersion.current = pending.baseVersion; setSyncStatus("queued"); cloudLoaded.current = true; } else if (cached) try { const restored = normaliseTournament(JSON.parse(cached)); setData(restored); serverVersion.current = readServerVersion(activeId); lastSyncedPayload.current = syncPayload(restored); setSyncStatus(token ? "offline" : "saved"); cloudLoaded.current = true; } catch {} setReady(true); });
    } else if (standalone) { setNeedsPwaConnection(true); setReady(true); }
    else { const saved = localStorage.getItem("fc-night-tournament"); if (saved) try { setData(normaliseTournament(JSON.parse(saved))); } catch {} setReady(true); }
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("lagata-theme", theme); }, [theme]);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(location.search); const view = params.get("view");
    if (view === "tournaments") setShowDashboard(true);
    if (view === "status") setShowPwaStatus(true);
    if (view) { params.delete("view"); const query = params.toString(); history.replaceState({}, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`); }
  }, [ready]);
  useEffect(() => { if (ready && shareId) { localStorage.setItem("lagata-last-tournament", shareId); localStorage.setItem(`lagata-cached-tournament-${shareId}`, JSON.stringify(data)); if (editToken && cloudLoaded.current && !pwa.isOnline) { if (syncPayload(data) !== lastSyncedPayload.current) { writePendingSync(shareId, data, serverVersion.current); setSyncStatus("queued"); } else setSyncStatus("offline"); } else if (editToken && cloudLoaded.current && syncBlocked.current && syncPayload(data) !== lastSyncedPayload.current) writePendingSync(shareId, data, serverVersion.current); } }, [data, ready, shareId, editToken, pwa.isOnline]);
  useEffect(() => { if (pwa.isOnline && syncStatus === "offline" && syncPayload(data) === lastSyncedPayload.current) setSyncStatus("saved"); }, [pwa.isOnline, syncStatus, data]);
  useEffect(() => {
    if (syncPillTimer.current) clearTimeout(syncPillTimer.current);
    setShowSyncPill(true); setSyncPillLeaving(false);
    if (syncStatus === "saved") syncPillTimer.current = setTimeout(() => { setSyncPillLeaving(true); syncPillTimer.current = setTimeout(() => setShowSyncPill(false), 260); }, 1800);
    return () => { if (syncPillTimer.current) clearTimeout(syncPillTimer.current); };
  }, [syncStatus, lastSyncedAt]);
  useEffect(() => { const wake = () => { if (document.visibilityState === "visible") setSyncWake((value) => value + 1); }; document.addEventListener("visibilitychange", wake); window.addEventListener("pageshow", wake); window.addEventListener("online", wake); return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake); window.removeEventListener("online", wake); }; }, []);
  useEffect(() => {
    if (!ready || shareId || creatingCloud.current || !pwa.isOnline || needsPwaConnection) return;
    creatingCloud.current = true;
    setShareState("saving");
    fetch(`${API_BASE}/api/tournament`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournament: compactTournament(data) }) })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((result) => { localStorage.setItem("lagata-current-tournament", result.id); localStorage.setItem(`lagata-edit-${result.id}`, result.editToken); localStorage.removeItem("fc-night-tournament"); rememberTournament(result.id, data.name); setShareId(result.id); setEditToken(result.editToken); serverVersion.current = result.version || result.updatedAt || ""; writeServerVersion(result.id, serverVersion.current); lastSyncedPayload.current = syncPayload(data); cloudLoaded.current = true; setSyncStatus("saved"); setLastSyncedAt(new Date()); setShareState("idle"); })
      .catch(() => { creatingCloud.current = false; setShareState("error"); });
  }, [data, ready, shareId, pwa.isOnline, needsPwaConnection]);
  useEffect(() => {
    if (!shareId || !editToken || !cloudLoaded.current || !pwa.isOnline || syncBlocked.current || syncPayload(data) === lastSyncedPayload.current) return;
    const value = data; setSyncStatus("saving");
    const timer = setTimeout(() => {
      syncChain.current = syncChain.current.then(async () => {
        if (syncBlocked.current || syncPayload(value) === lastSyncedPayload.current) return;
        const latestResponse = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`); if (!latestResponse.ok) throw new SyncRequestError(latestResponse.status, "Could not check the latest cloud copy");
        const latestResult = await latestResponse.json(); const remote = normaliseTournament(latestResult.tournament); const remotePayload = syncPayload(remote); const remoteVersion = latestResult.version || latestResult.updatedAt || "";
        const remoteChanged = Boolean(serverVersion.current && remoteVersion && remoteVersion !== serverVersion.current && remotePayload !== lastSyncedPayload.current);
        if (remoteChanged) { writePendingSync(shareId, value, serverVersion.current); syncBlocked.current = true; setSyncConflict({ tournament: remote, version: remoteVersion }); setSyncStatus("conflict"); return; }
        const response = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`, { method: "PUT", headers: { "content-type": "application/json", "x-edit-token": editToken, "x-base-version": serverVersion.current }, body: JSON.stringify({ tournament: compactTournament(value) }) }); const result = await response.json().catch(() => null); if (response.status === 409 && result?.tournament) { const conflictTournament = normaliseTournament(result.tournament); writePendingSync(shareId, value, serverVersion.current); syncBlocked.current = true; setSyncConflict({ tournament: conflictTournament, version: result.version || result.updatedAt || "" }); setSyncStatus("conflict"); return; } if (!response.ok) throw new SyncRequestError(response.status, result?.error || "Cloud save failed");
        const confirmationResponse = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`); const confirmation = confirmationResponse.ok ? await confirmationResponse.json() : null;
        serverVersion.current = confirmation?.version || result?.version || remoteVersion || serverVersion.current; writeServerVersion(shareId, serverVersion.current); lastSyncedPayload.current = syncPayload(value); clearPendingSync(shareId); rememberTournament(shareId, value.name); setSyncErrorDetail(""); setSyncStatus("saved"); setLastSyncedAt(new Date());
      }).catch((error: unknown) => { writePendingSync(shareId, value, serverVersion.current); const requestError = error instanceof SyncRequestError ? error : null; const retryable = !requestError || requestError.status === 408 || requestError.status === 429 || requestError.status >= 500; setSyncErrorDetail(requestError?.status === 413 ? "Saved history is still too large; keep this device open and retry after the service update" : requestError?.message || "Connection interrupted; changes will retry automatically"); setSyncStatus(retryable ? "queued" : "error"); });
    }, 650);
    return () => clearTimeout(timer);
  }, [data, shareId, editToken, pwa.isOnline, syncWake]);
  useEffect(() => {
    if (!shareId || editToken || !pwa.isOnline) return; const refresh = () => fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`).then((r) => r.json()).then(({ tournament, version, updatedAt }) => { if (!tournament) return; const normalised = normaliseTournament(tournament); serverVersion.current = version || updatedAt || ""; writeServerVersion(shareId, serverVersion.current); lastSyncedPayload.current = syncPayload(normalised); setData(normalised); setLastSyncedAt(new Date()); }).catch(() => {});
    const timer = setInterval(refresh, 5000); return () => clearInterval(timer);
  }, [shareId, editToken, pwa.isOnline]);

  const sharingAvailable = true;
  const isSpectator = Boolean(shareId && !editToken); const isViewer = isSpectator; const playerById = (id: string) => data.players.find((p) => p.id === id);
  const maxRound = Math.max(1, ...data.matches.map((m) => m.round)); const playedMatches = data.matches.filter((m) => m.homeScore !== null && m.awayScore !== null); const completed = playedMatches.filter((m) => m.status === "finished").length;
  const totalRounds = data.format === "knockout" ? Math.max(1, Math.log2(data.players.length)) : maxRound;
  const progress = data.matches.length ? Math.round((completed / data.matches.length) * 100) : 0;
  const tournamentComplete = data.matches.length > 0 && completed === data.matches.length;
  const table = useMemo(() => {
    const rows = data.players.map((player) => ({ ...player, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    data.matches.forEach((match) => {
      if (match.homeScore === null || match.awayScore === null) return;
      const home = byId[match.homeId], away = byId[match.awayId];
      if (!home || !away) return;
      const extraTimeReady = match.homeExtraTime !== null && match.homeExtraTime !== undefined && match.awayExtraTime !== null && match.awayExtraTime !== undefined;
      const homeGoals = match.homeScore + (data.format === "knockout" && extraTimeReady ? match.homeExtraTime! : 0);
      const awayGoals = match.awayScore + (data.format === "knockout" && extraTimeReady ? match.awayExtraTime! : 0);
      if (data.format === "knockout") {
        const winner = confirmedKnockoutWinner(match);
        if (!winner) return;
        home.p++; away.p++; home.gf += homeGoals; home.ga += awayGoals; away.gf += awayGoals; away.ga += homeGoals;
        if (winner === home.id) { home.w++; away.l++; home.pts += 3; } else { away.w++; home.l++; away.pts += 3; }
        return;
      }
      home.p++; away.p++; home.gf += homeGoals; home.ga += awayGoals; away.gf += awayGoals; away.ga += homeGoals;
      if (homeGoals > awayGoals) { home.w++; away.l++; home.pts += 3; } else if (homeGoals < awayGoals) { away.w++; home.l++; away.pts += 3; } else { home.d++; away.d++; home.pts++; away.pts++; }
    });
    rows.forEach((row) => row.gd = row.gf - row.ga);
    return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }, [data]);
  const rankedPlayers = table.filter((row) => row.p > 0); const topScorer = [...rankedPlayers].sort((a, b) => b.gf - a.gf || b.pts - a.pts)[0]; const bestDefence = [...rankedPlayers].sort((a, b) => a.ga - b.ga || b.p - a.p)[0];
  const biggestWin = [...playedMatches].sort((a, b) => Math.abs((b.homeScore || 0) - (b.awayScore || 0)) - Math.abs((a.homeScore || 0) - (a.awayScore || 0)))[0];
  const highestScoring = [...playedMatches].sort((a, b) => ((b.homeScore || 0) + (b.awayScore || 0)) - ((a.homeScore || 0) + (a.awayScore || 0)))[0];
  const finalMatch = data.format === "knockout" ? data.matches.find((match) => match.round === totalRounds && data.matches.filter((candidate) => candidate.round === totalRounds).length === 1) : undefined;
  const championId = finalMatch ? confirmedKnockoutWinner(finalMatch) : null;
  const champion = championId ? playerById(championId) : undefined;
  useEffect(() => {
    if (!ready || !shareId) return;
    const live = data.matches.filter((match) => match.status === "live").map((match) => ({ id: match.id, label: `${playerById(match.homeId)?.name || "Player"} vs ${playerById(match.awayId)?.name || "Player"}` }));
    const finished = data.matches.filter((match) => match.status === "finished").map((match) => ({ id: match.id, label: `${playerById(match.homeId)?.name || "Player"} vs ${playerById(match.awayId)?.name || "Player"}`, score: `${match.homeScore ?? 0}–${match.awayScore ?? 0}` }));
    void pwa.updateTournamentActivity({ tournamentId: shareId, pendingCount: data.matches.filter((match) => match.status !== "finished").length, live, finished, champion: champion ? { id: champion.id, name: champion.name, tournament: data.name } : undefined });
  }, [ready, shareId, data, champion, pwa.updateTournamentActivity]);
  function queueChampionCelebration(match: Match, winnerId: string) {
    const celebrationKey = `${match.id}:${winnerId}`;
    if (celebratedFinalResult.current === celebrationKey) return;
    celebratedFinalResult.current = celebrationKey;
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    celebrationTimer.current = setTimeout(() => setShowChampionCelebration(true), 500);
  }
  useEffect(() => {
    if (!ready) return;
    const currentState = finalMatch ? `${finalMatch.id}:${finalMatch.status}:${championId || ""}` : "none";
    if (previousFinalState.current === null) { previousFinalState.current = currentState; if (championId && finalMatch?.status === "finished") celebratedFinalResult.current = `${finalMatch.id}:${championId}`; return; }
    const previousState = previousFinalState.current;
    previousFinalState.current = currentState;
    if (!finalMatch || finalMatch.status !== "finished") celebratedFinalResult.current = "";
    if (data.format !== "knockout" || !championId || !finalMatch || finalMatch.status !== "finished" || previousState === currentState) return;
    queueChampionCelebration(finalMatch, championId);
    return () => { if (celebrationTimer.current) clearTimeout(celebrationTimer.current); };
  }, [ready, data.format, championId, finalMatch]);
  const leagueOutcome = useMemo(() => {
    if (data.format !== "league" || !data.matches.length || !table.length) return null;
    const leader = table[0];
    const remainingFor = (playerId: string) => data.matches.filter((match) => (match.homeId === playerId || match.awayId === playerId) && (match.homeScore === null || match.awayScore === null)).length;
    const remainingFixtures = data.matches.filter((match) => match.homeScore === null || match.awayScore === null).length;
    const leaderRemaining = remainingFor(leader.id);
    const exactTie = table.slice(1).some((row) => row.pts === leader.pts && row.gd === leader.gd && row.gf === leader.gf);
    if (remainingFixtures === 0) return { status: exactTie ? "tied" as const : "complete" as const, winner: exactTie ? undefined : leader, contenderCount: exactTie ? table.filter((row) => row.pts === leader.pts && row.gd === leader.gd && row.gf === leader.gf).length : 1, remainingFixtures };
    const challengers = table.slice(1).filter((row) => {
      const playerRemaining = remainingFor(row.id);
      const maximumPoints = row.pts + (playerRemaining * 3);
      if (maximumPoints > leader.pts) return true;
      if (maximumPoints < leader.pts) return false;
      if (leaderRemaining > 0 || playerRemaining > 0) return true;
      return row.gd > leader.gd || (row.gd === leader.gd && row.gf >= leader.gf);
    });
    return challengers.length === 0
      ? { status: "clinched" as const, winner: leader, contenderCount: 1, remainingFixtures }
      : { status: "open" as const, winner: undefined, contenderCount: challengers.length + 1, remainingFixtures };
  }, [data.format, data.matches, table]);
  const knockoutBestDefence = (() => {
    if (data.format !== "knockout" || !tournamentComplete) return null;
    const rows = data.players.map((player) => ({ player, played: 0, conceded: 0, cleanSheets: 0, furthestRound: 0 }));
    const byId = Object.fromEntries(rows.map((row) => [row.player.id, row]));
    data.matches.forEach((match) => {
      if (match.status !== "finished" || !knockoutWinner(match) || match.homeScore === null || match.awayScore === null) return;
      const home = byId[match.homeId], away = byId[match.awayId];
      if (!home || !away) return;
      const extraTimeReady = match.homeExtraTime !== null && match.homeExtraTime !== undefined && match.awayExtraTime !== null && match.awayExtraTime !== undefined;
      const homeGoals = match.homeScore + (extraTimeReady ? match.homeExtraTime! : 0);
      const awayGoals = match.awayScore + (extraTimeReady ? match.awayExtraTime! : 0);
      home.played++; away.played++;
      home.conceded += awayGoals; away.conceded += homeGoals;
      if (awayGoals === 0) home.cleanSheets++;
      if (homeGoals === 0) away.cleanSheets++;
      home.furthestRound = Math.max(home.furthestRound, match.round);
      away.furthestRound = Math.max(away.furthestRound, match.round);
    });
    const minimumMatches = data.players.length === 2 ? 1 : 2;
    const eligible = rows.filter((row) => row.played >= minimumMatches).sort((left, right) =>
      (left.conceded / left.played) - (right.conceded / right.played)
      || right.cleanSheets - left.cleanSheets
      || right.furthestRound - left.furthestRound
      || left.conceded - right.conceded
    );
    if (!eligible.length) return null;
    const best = eligible[0], bestRate = best.conceded / best.played;
    const winners = eligible.filter((row) =>
      Math.abs((row.conceded / row.played) - bestRate) < 0.0001
      && row.cleanSheets === best.cleanSheets
      && row.furthestRound === best.furthestRound
      && row.conceded === best.conceded
    );
    return { winners, rate: bestRate, cleanSheets: best.cleanSheets };
  })();
  const awardChampion = data.format === "league" ? leagueOutcome?.winner : champion;
  const championAwardLabel = data.format === "league" && leagueOutcome?.status === "clinched" ? "Title clinched" : "Champion";
  const championAwardTitle = data.format === "league" && leagueOutcome?.status === "tied" ? "Title playoff required" : awardChampion?.name || "Still to be decided";
  const championAwardDetail = data.format !== "league" ? awardChampion?.team || "Complete the tournament to crown a winner" : leagueOutcome?.status === "clinched" ? `${awardChampion?.team} · Uncatchable with ${leagueOutcome.remainingFixtures} fixture${leagueOutcome.remainingFixtures === 1 ? "" : "s"} remaining` : leagueOutcome?.status === "complete" ? awardChampion?.team || "League complete" : leagueOutcome?.status === "tied" ? `${leagueOutcome.contenderCount} players are level on points, goal difference and goals scored` : `${leagueOutcome?.contenderCount || data.players.length} player${(leagueOutcome?.contenderCount || data.players.length) === 1 ? "" : "s"} remain in contention`;
  const bestDefenceTitle = data.format === "league" ? bestDefence?.name || "No results yet" : !tournamentComplete ? "Awarded after the final" : knockoutBestDefence?.winners.map((row) => row.player.name).join(" & ") || "No eligible player";
  const bestDefenceDetail = data.format === "league" ? bestDefence ? `${bestDefence.ga} goals conceded` : "Enter scores to begin" : !tournamentComplete ? "Knockout records are compared when every match is complete" : knockoutBestDefence ? `${knockoutBestDefence.rate.toFixed(2)} conceded per match · ${knockoutBestDefence.cleanSheets} clean sheet${knockoutBestDefence.cleanSheets === 1 ? "" : "s"}${knockoutBestDefence.winners.length > 1 ? " · Shared award" : ""}` : "No player met the minimum match requirement";

  function notify(message: string, tone: "success" | "error" = "success") { if (toastTimer.current) clearTimeout(toastTimer.current); setToast({ message, tone }); toastTimer.current = setTimeout(() => setToast(null), 2400); }
  function rememberTournament(id: string, name: string) { setCatalog((current) => { const next = [{ id, name, updatedAt: new Date().toISOString(), archived: current.find((item) => item.id === id)?.archived }, ...current.filter((item) => item.id !== id)]; localStorage.setItem("lagata-tournament-catalog", JSON.stringify(next)); return next; }); }
  function updateScore(id: string, side: "homeScore" | "awayScore", value: string) { if (isViewer) return; const score = value === "" ? null : Math.max(0, Math.min(99, Number(value))); setData((d) => { const changed = d.matches.map((match) => { if (match.id !== id) return match; const updated: Match = { ...match, [side]: score, homeExtraTime: null, awayExtraTime: null, homePenalties: null, awayPenalties: null }; const hasAnyScore = updated.homeScore !== null || updated.awayScore !== null; const hasBothScores = updated.homeScore !== null && updated.awayScore !== null; const status: MatchStatus = d.format === "knockout" ? hasAnyScore ? "live" : "scheduled" : hasBothScores ? "finished" : hasAnyScore ? "live" : "scheduled"; return { ...updated, status }; }); const next = { ...d, matches: d.format === "knockout" ? advanceKnockout(changed) : changed }; return audited(d, next, "Score updated"); }); }
  function updateKnockoutResolution(id: string, field: "homeExtraTime" | "awayExtraTime" | "homePenalties" | "awayPenalties", value: string) { if (isViewer) return; const score = value === "" ? null : Math.max(0, Math.min(99, Number(value))); setData((d) => { const changed = d.matches.map((match) => { if (match.id !== id) return match; const clearsPenalties = field === "homeExtraTime" || field === "awayExtraTime"; return { ...match, [field]: score, ...(clearsPenalties ? { homePenalties: null, awayPenalties: null } : {}), status: "live" as MatchStatus }; }); return audited(d, { ...d, matches: advanceKnockout(changed) }, field.includes("Penalties") ? "Penalty result updated" : "Extra-time result updated"); }); }
  function updateStatus(id: string, status: MatchStatus) { if (isViewer) return; const match = data.matches.find((candidate) => candidate.id === id); if (data.format === "knockout" && status === "finished" && match && (match.homeScore === null || match.awayScore === null)) { notify("Enter both scores before marking the match as finished", "error"); return; } const winnerId = data.format === "knockout" && match ? knockoutWinner(match) : null; if (data.format === "knockout" && status === "finished" && match && !winnerId) { notify("A knockout match needs a clear winner before it can finish", "error"); return; } if (data.format === "knockout" && match?.round === totalRounds && status !== "finished") { celebratedFinalResult.current = ""; setShowChampionCelebration(false); } setData((d) => { const changed = d.matches.map((candidate) => candidate.id === id ? { ...candidate, status } : candidate); const next = { ...d, matches: d.format === "knockout" ? advanceKnockout(changed) : changed }; return audited(d, next, `Match marked ${statusLabels[status].toLowerCase()}`); }); if (data.format === "knockout" && status === "finished" && match && winnerId && match.round === totalRounds && data.matches.filter((candidate) => candidate.round === totalRounds).length === 1) queueChampionCelebration(match, winnerId); }
  function undoLast() { if (isViewer) return; setData((d) => { const last = d.history[0]; if (!last?.snapshot) return d; try { notify("Latest change undone"); return { ...normaliseTournament(JSON.parse(last.snapshot)), history: d.history.slice(1) }; } catch { notify("Unable to undo that change", "error"); return d; } }); }
  function openSetup(tab: "setup" | "access" | "data" | "history" = "setup") { if (isViewer) return; setDraft({ name: data.name, players: data.players.map((p) => ({ ...p })), format: data.format, homeAndAway: data.homeAndAway }); setSettingsTab(tab); setShowMobileMenu(false); setShowSetup(true); }
  function regenerate() { const next: Tournament = { name: draft.name.trim() || "Friday Night League", format: draft.format, homeAndAway: draft.format === "league" && draft.homeAndAway, players: draft.players, matches: makeFixtures(draft.players, draft.format, draft.homeAndAway), history: data.history }; setData(audited(data, next, "Fixtures regenerated")); setRound(1); setShowSetup(false); setTab("matches"); }
  function addPlayer() { setDraft((d) => ({ ...d, players: [...d.players, { id: crypto.randomUUID(), name: `Player ${d.players.length + 1}`, team: "Choose club" }] })); }
  function updatePlayer(id: string, field: "name" | "team", value: string) { setDraft((d) => ({ ...d, players: d.players.map((p) => p.id === id ? { ...p, [field]: value } : p) })); }
  async function shareTournament() {
    if (shareId) { const url = `${location.origin}${location.pathname}?t=${shareId}`; await navigator.clipboard.writeText(url); setShareState("copied"); notify("Spectator link copied"); setTimeout(() => setShareState("idle"), 1600); return; }
    setShareState("saving"); try { const response = await fetch(`${API_BASE}/api/tournament`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournament: compactTournament(data) }) }); if (!response.ok) throw new Error(); const result = await response.json(); localStorage.setItem("lagata-current-tournament", result.id); localStorage.setItem(`lagata-edit-${result.id}`, result.editToken); setShareId(result.id); setEditToken(result.editToken); serverVersion.current = result.version || result.updatedAt || ""; writeServerVersion(result.id, serverVersion.current); lastSyncedPayload.current = syncPayload(data); setSyncStatus("saved"); setLastSyncedAt(new Date()); cloudLoaded.current = true; history.replaceState({}, "", `${location.pathname}?t=${result.id}`); await navigator.clipboard.writeText(`${location.origin}${location.pathname}?t=${result.id}`); setShareState("copied"); setTimeout(() => setShareState("idle"), 1600); } catch { setShareState("error"); }
  }
  async function copyAdminLink() {
    if (!shareId || !editToken) return;
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?t=${shareId}#admin=${editToken}`); setAdminCopyState("copied"); notify("Private admin link copied"); setTimeout(() => setAdminCopyState("idle"), 1800); } catch { setAdminCopyState("error"); notify("Could not copy the admin link", "error"); }
  }
  function downloadFile(name: string, body: string, type: string) { const url = URL.createObjectURL(new Blob([body], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  function exportCsv() { const rows = [["Round", "Status", "Home", "FT", "Away", "FT", "ET home", "ET away", "Pens home", "Pens away", "Decision"], ...data.matches.map((match) => [String(match.round), statusLabels[match.status], playerById(match.homeId)?.name || "", match.homeScore ?? "", playerById(match.awayId)?.name || "", match.awayScore ?? "", match.homeExtraTime ?? "", match.awayExtraTime ?? "", match.homePenalties ?? "", match.awayPenalties ?? "", data.format === "knockout" ? knockoutDecision(match) || "" : ""])]; downloadFile(`${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-results.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv"); notify("CSV export downloaded"); }
  function exportBackup() { downloadFile(`${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-backup.json`, JSON.stringify(data, null, 2), "application/json"); notify("Tournament backup downloaded"); }
  function restoreBackup(file?: File) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const restored = normaliseTournament(JSON.parse(String(reader.result))); if (restored.players.length < 2 || !restored.matches.length) throw new Error(); setData((d) => audited(d, restored, "Backup restored")); setShowSetup(false); notify("Backup restored successfully"); } catch { notify("That file is not a valid Lagata backup", "error"); } }; reader.readAsText(file); }
  function toggleCompactMode() { setCompactMode((current) => { const next = !current; localStorage.setItem("lagata-scorekeeper-mode", String(next)); notify(next ? "Scorekeeper mode enabled" : "Standard match view restored"); return next; }); }
  function createTournament() { const fresh: Tournament = { ...initial, name: "New Tournament", players: initial.players.map((p) => ({ ...p })), matches: initialMatches.map((m) => ({ ...m })), history: [] }; localStorage.removeItem("lagata-current-tournament"); setData(fresh); setShareId(""); setEditToken(""); serverVersion.current = ""; lastSyncedPayload.current = ""; syncBlocked.current = false; setSyncConflict(null); setSyncStatus("saved"); cloudLoaded.current = false; creatingCloud.current = false; history.replaceState({}, "", location.pathname); setRound(1); setTab("matches"); setShowDashboard(false); }
  async function openTournament(id: string) { const token = localStorage.getItem(`lagata-edit-${id}`) || ""; try { const response = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(id)}`); if (!response.ok) throw new Error(); const result = await response.json(); const needsRepair = Boolean(token && historyNeedsCompaction(result.tournament?.history)); const remote = normaliseTournament(result.tournament); const pending = token ? readPendingSync(id) : null; const selected = pending?.tournament || remote; setData(selected); setShareId(id); setEditToken(token); serverVersion.current = pending?.baseVersion || result.version || result.updatedAt || ""; writeServerVersion(id, result.version || result.updatedAt || ""); lastSyncedPayload.current = needsRepair ? JSON.stringify(result.tournament) : syncPayload(remote); syncBlocked.current = false; setSyncConflict(null); setSyncStatus(pending ? "queued" : needsRepair ? "saving" : "saved"); if (!pending && !needsRepair) setLastSyncedAt(new Date()); cloudLoaded.current = true; localStorage.setItem("lagata-current-tournament", id); history.replaceState({}, "", `${location.pathname}?t=${id}`); setRound(1); setTab("matches"); setShowDashboard(false); } catch { setShareState("error"); } }
  function toggleArchive(id: string) { setCatalog((current) => { const next = current.map((item) => item.id === id ? { ...item, archived: !item.archived } : item); localStorage.setItem("lagata-tournament-catalog", JSON.stringify(next)); return next; }); }
  async function connectPwaTournament(value: string) {
    const raw = value.trim();
    let id = ""; let token = "";
    if (/^[a-z0-9_-]{6,64}$/i.test(raw)) id = raw;
    else try { const url = new URL(raw); id = url.searchParams.get("t") || ""; token = new URLSearchParams(url.hash.slice(1)).get("admin") || ""; } catch { throw new Error("Paste a complete Lagata link or a valid tournament code."); }
    if (!id) throw new Error("This link does not contain a tournament ID.");
    const response = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.status === 404 ? "That tournament could not be found." : "Lagata could not download that tournament. Try again.");
    const result = await response.json();
    if (!result.tournament) throw new Error("That link does not contain a valid Lagata tournament.");
    const normalised = normaliseTournament(result.tournament);
    let connectedVersion = result.version || result.updatedAt || "";
    if (token) { const validation = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json", "x-edit-token": token, "x-base-version": connectedVersion }, body: JSON.stringify({ tournament: compactTournament(normalised) }) }); const validationResult = await validation.json().catch(() => null); if (!validation.ok) throw new Error(validation.status === 409 ? "That tournament changed while it was connecting. Please try again." : validation.status === 413 ? "This tournament needs a storage repair before it can connect." : "That private admin link is invalid or has expired."); connectedVersion = validationResult?.version || connectedVersion; }
    const connectedRounds = normalised.format === "knockout" ? Math.max(1, Math.log2(normalised.players.length)) : Math.max(1, ...normalised.matches.map((match) => match.round));
    const connectedFinal = normalised.format === "knockout" ? normalised.matches.find((match) => match.round === connectedRounds && normalised.matches.filter((candidate) => candidate.round === connectedRounds).length === 1) : undefined;
    const connectedChampion = connectedFinal ? confirmedKnockoutWinner(connectedFinal) : null;
    previousFinalState.current = connectedFinal ? `${connectedFinal.id}:${connectedFinal.status}:${connectedChampion || ""}` : "none"; celebratedFinalResult.current = connectedFinal && connectedChampion ? `${connectedFinal.id}:${connectedChampion}` : ""; setShowChampionCelebration(false);
    localStorage.setItem("lagata-current-tournament", id); localStorage.setItem("lagata-last-tournament", id); localStorage.setItem(`lagata-cached-tournament-${id}`, JSON.stringify(normalised));
    if (token) localStorage.setItem(`lagata-edit-${id}`, token); else localStorage.removeItem(`lagata-edit-${id}`);
    setData(normalised); setShareId(id); setEditToken(token); serverVersion.current = connectedVersion; writeServerVersion(id, serverVersion.current); lastSyncedPayload.current = syncPayload(normalised); syncBlocked.current = false; setSyncConflict(null); setSyncErrorDetail(""); setSyncStatus("saved"); setLastSyncedAt(new Date()); cloudLoaded.current = true; creatingCloud.current = false; setNeedsPwaConnection(false); setRound(1); setTab("matches"); history.replaceState({}, "", `${location.pathname}?t=${id}`);
    if (token) rememberTournament(id, normalised.name);
    notify(token ? "Admin access connected on this device" : "Spectator tournament connected");
  }
  function beginPwaTournament() { localStorage.removeItem("lagata-current-tournament"); localStorage.removeItem("lagata-last-tournament"); setData({ ...initial, players: initial.players.map((player) => ({ ...player })), matches: initialMatches.map((match) => ({ ...match })), history: [] }); setShareId(""); setEditToken(""); serverVersion.current = ""; lastSyncedPayload.current = ""; syncBlocked.current = false; setSyncConflict(null); setSyncStatus("saved"); cloudLoaded.current = false; creatingCloud.current = false; setNeedsPwaConnection(false); setRound(1); setTab("matches"); }
  function resolveSyncConflict(choice: "cloud" | "device") {
    if (!syncConflict || !shareId) return;
    if (choice === "cloud") {
      const remote = syncConflict.tournament; setData(remote); serverVersion.current = syncConflict.version; writeServerVersion(shareId, syncConflict.version); lastSyncedPayload.current = syncPayload(remote); clearPendingSync(shareId); syncBlocked.current = false; setSyncConflict(null); setSyncStatus("saved"); setLastSyncedAt(new Date()); notify("Latest cloud version restored"); return;
    }
    serverVersion.current = syncConflict.version; writeServerVersion(shareId, syncConflict.version); syncBlocked.current = false; setSyncConflict(null); setSyncStatus("saving"); setSyncWake((value) => value + 1); notify("Your device version will replace the cloud copy");
  }
  function retrySync() { if (!shareId || !editToken) return; syncBlocked.current = false; setSyncErrorDetail(""); setSyncStatus(pwa.isOnline ? "saving" : "queued"); setSyncWake((value) => value + 1); }
  async function repairCachedData() {
    if (!shareId) { localStorage.removeItem("fc-night-tournament"); notify("Local app cache refreshed"); return; }
    const pending = editToken ? readPendingSync(shareId) : null;
    localStorage.removeItem(`lagata-cached-tournament-${shareId}`);
    if (pending) { setData(pending.tournament); setSyncStatus("queued"); setSyncWake((value) => value + 1); notify("Cache repaired · unsynced changes preserved"); return; }
    const response = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`);
    if (!response.ok) throw new Error("Cloud copy is unavailable");
    const result = await response.json(); const restored = normaliseTournament(result.tournament); const version = result.version || result.updatedAt || "";
    setData(restored); serverVersion.current = version; writeServerVersion(shareId, version); lastSyncedPayload.current = syncPayload(restored); localStorage.setItem(`lagata-cached-tournament-${shareId}`, JSON.stringify(restored)); setSyncStatus("saved"); setLastSyncedAt(new Date()); notify("Cached data repaired from the cloud");
  }
  const syncLabel = syncStatus === "saving" ? "Syncing changes…" : syncStatus === "offline" ? "Offline · cloud copy unchanged" : syncStatus === "queued" ? "Changes queued for retry" : syncStatus === "conflict" ? "Sync paused · review needed" : syncStatus === "error" ? "Sync needs attention · changes kept" : "All changes saved";
  const syncDetail = syncErrorDetail || (lastSyncedAt ? `Last synced ${lastSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Cloud protection active");

  return <main>
    <PwaInstallButton pwa={pwa} />
    <PwaExperience pwa={pwa} />
    {pwa.isStandalone && !needsPwaConnection && <button className="pwaConnectLauncher" onClick={() => setNeedsPwaConnection(true)}><span aria-hidden="true">↗</span> Switch tournament</button>}
    {needsPwaConnection && <PwaConnect canClose={Boolean(shareId)} isOnline={pwa.isOnline} onClose={() => setNeedsPwaConnection(false)} onConnect={connectPwaTournament} onCreate={beginPwaTournament} />}
    <PwaStatusCentre pwa={pwa} open={showPwaStatus} onClose={() => setShowPwaStatus(false)} tournamentId={shareId} tournamentName={data.name} accessLevel={!shareId ? "Local only" : editToken ? "Administrator" : "Spectator"} syncLabel={syncLabel} syncDetail={syncDetail} onRetrySync={retrySync} onSwitchTournament={() => { setShowPwaStatus(false); setNeedsPwaConnection(true); }} onRepairData={repairCachedData} />
    <header className="topbar"><a className="brand" href="#"><span className="brandMark" aria-hidden="true"><i>L</i><b>UT</b></span><span>LAGATA <em>ULTIMATE TEAM</em></span></a><div className="topActions">{!isViewer && <button className="dashboardButton" onClick={() => setShowDashboard(true)}><span aria-hidden="true">▦</span><span>Tournaments</span></button>}{!isViewer && data.history[0]?.snapshot && <button className="undoButton" onClick={undoLast} title={data.history[0].label}>↶ Undo</button>}<button className="pwaStatusButton" onClick={() => setShowPwaStatus(true)} aria-label="Open device and app status centre"><span className="deviceStatusIcon" aria-hidden="true"><i className={pwa.isOnline ? "online" : "offline"} /></span><span>Device &amp; app status</span></button><button className="iconButton" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "◐" : "☀"}</button>{!isViewer && sharingAvailable && <button className="shareButton" disabled={shareState === "saving"} onClick={shareTournament}><span aria-hidden="true">↗</span>{shareState === "copied" ? "Link copied" : shareState === "saving" ? "Saving…" : shareId ? "Copy link" : "Share live"}</button>}{!isViewer && <button className="ghostButton" onClick={() => openSetup()} aria-label="Manage tournament"><span className="settingsGlyph" aria-hidden="true">•••</span><span>Manage tournament</span></button>}<button className="mobileMore" onClick={() => setShowMobileMenu((open) => !open)} aria-expanded={showMobileMenu} aria-label="Open more actions"><span aria-hidden="true">•••</span><span>More</span></button></div></header>
    {shareId && editToken && showSyncPill && <div className={`syncBar ${syncStatus}${syncPillLeaving ? " leaving" : ""}`} role="status" aria-live="polite"><span aria-hidden="true" /><div><b>{syncLabel}</b><small>{syncDetail}</small></div>{syncStatus === "error" && <button onClick={retrySync}>Retry</button>}{syncStatus === "conflict" && <button onClick={() => setSyncConflict((current) => current ? { ...current } : current)}>Review</button>}</div>}
    {showMobileMenu && <div className="mobileActionMenu"><button onClick={() => { setShowPwaStatus(true); setShowMobileMenu(false); }}><span className="menuDeviceIcon" aria-hidden="true">▣</span>Device &amp; app status</button><button onClick={() => { setTheme(theme === "light" ? "dark" : "light"); setShowMobileMenu(false); }}><span>{theme === "light" ? "◐" : "☀"}</span>{theme === "light" ? "Dark mode" : "Light mode"}</button>{!isViewer && <button onClick={() => { openSetup(); setShowMobileMenu(false); }}><span>⚙</span>Manage tournament</button>}{!isViewer && data.history[0]?.snapshot && <button onClick={() => { undoLast(); setShowMobileMenu(false); }}><span>↶</span>Undo latest change</button>}</div>}
    {isViewer && <div className="viewerBar"><span className="liveDot" tabIndex={0} role="status" aria-label="Live updates active" data-label="Live updates active" /> Live spectator view <b>Scores refresh automatically</b></div>}
    <section className="hero"><div><p className="eyebrow"><span className={`liveDot${tournamentComplete ? " complete" : ""}`} tabIndex={0} role="status" aria-label={tournamentComplete ? "Tournament complete" : "Tournament updates are live"} data-label={tournamentComplete ? "Tournament complete" : "Tournament updates are live"} /> {tournamentComplete ? "Tournament complete" : "Tournament in progress"}</p><h1>{data.name}</h1><p className="subline">{data.players.length} players <span>•</span> {data.format === "league" ? "League phase" : "Knockout cup"} <span>•</span> {data.format === "league" ? `${data.homeAndAway ? "Home & away" : "Single round"} · 3 pts per win` : "One champion"}</p></div>{champion ? <div className="championCard"><span>CHAMPION</span><strong>🏆 {champion.name}</strong><small>{champion.team}</small></div> : <div className="progressCard"><div className="progressTop"><span>Tournament progress</span><strong>{progress}%</strong></div><div className="progressTrack"><i style={{ width: `${progress}%` }} /></div><small>{completed} of {data.matches.length} matches played</small></div>}</section>
    <section className="content"><div className="tabs" role="tablist"><button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>Matches <b>{data.matches.length - completed}</b></button><button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>{data.format === "league" ? "League table" : "Results"}</button><button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Stats</button><button className={tab === "pitch" ? "active" : ""} onClick={() => setTab("pitch")}>Pitch</button></div>
      {tab === "matches" && <><div className="sectionHead"><div><p className="eyebrow">Fixtures</p><h2>{data.format === "knockout" ? knockoutRoundLabel(round, totalRounds) : `Round ${round}`} <span>of {totalRounds}</span></h2></div><div className="roundNav"><button aria-label="Previous round" disabled={round === 1} onClick={() => setRound((value) => value - 1)}>←</button><button aria-label="Next round" disabled={round === maxRound} onClick={() => setRound((value) => value + 1)}>→</button></div></div>{!isViewer && <button className={`scorekeeperToggle${compactMode ? " active" : ""}`} onClick={toggleCompactMode}>{compactMode ? "✓ Compact scorekeeper" : "⚡ Scorekeeper mode"}</button>}<div className={`matchList${compactMode ? " compact" : ""}`}>{data.matches.filter((match) => match.round === round).map((match) => <MatchCard key={match.id} match={match} matchNumber={data.matches.indexOf(match) + 1} format={data.format} players={data.players} isViewer={isViewer} onScore={updateScore} onResolution={updateKnockoutResolution} onStatus={updateStatus} />)}</div><p className="saveNote">{isViewer ? "Live scores refresh every 5 seconds" : shareId ? syncLabel : "✓ Scores save automatically on this device"}</p></>}
      {tab === "table" && (data.format === "knockout" ? <KnockoutResults tournament={data} /> : <><div className="sectionHead"><div><p className="eyebrow">Standings</p><h2>League table</h2></div><p className="tieNote">Points, goal difference, then goals scored</p></div><div className="tableWrap"><table><thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{table.map((row, index) => <tr key={row.id}><td><span className={`rank rank${index + 1}`}>{index + 1}</span></td><td><strong>{row.name}</strong><small>{row.team}</small></td><td>{row.p}</td><td>{row.w}</td><td>{row.d}</td><td>{row.l}</td><td>{row.gf}</td><td>{row.ga}</td><td>{row.gd > 0 ? "+" : ""}{row.gd}</td><td><b>{row.pts}</b></td></tr>)}</tbody></table></div></>)}
      {tab === "stats" && <><div className="sectionHead"><div><p className="eyebrow">Tournament intelligence</p><h2>Stats & awards</h2></div><p className="tieNote">Updates after every completed score</p></div><div className="awardGrid"><article className={`awardCard featured${data.format === "league" && leagueOutcome?.status === "clinched" ? " clinched" : data.format === "league" && leagueOutcome?.status === "tied" ? " tied" : ""}`}><span>🏆 {championAwardLabel}</span><strong>{championAwardTitle}</strong><small>{championAwardDetail}</small></article><article className="awardCard"><span>⚽ Golden boot</span><strong>{topScorer?.name || "No results yet"}</strong><small>{topScorer ? `${topScorer.gf} goals scored` : "Enter scores to begin"}</small></article><article className="awardCard"><span>🛡 Best defence</span><strong>{bestDefenceTitle}</strong><small>{bestDefenceDetail}</small></article><article className="awardCard"><span>📈 Biggest win</span><strong>{biggestWin ? `${playerById(biggestWin.homeId)?.name} ${biggestWin.homeScore}–${biggestWin.awayScore} ${playerById(biggestWin.awayId)?.name}` : "No results yet"}</strong><small>{biggestWin ? `Round ${biggestWin.round}` : "Enter scores to begin"}</small></article></div><div className="statStrip"><div><span>Matches played</span><strong>{playedMatches.length}</strong></div><div><span>Total goals</span><strong>{playedMatches.reduce((sum, m) => sum + (m.homeScore || 0) + (m.awayScore || 0), 0)}</strong></div><div><span>Goals per match</span><strong>{playedMatches.length ? (playedMatches.reduce((sum, m) => sum + (m.homeScore || 0) + (m.awayScore || 0), 0) / playedMatches.length).toFixed(1) : "0.0"}</strong></div><div><span>Highest scoring</span><strong>{highestScoring ? `${(highestScoring.homeScore || 0) + (highestScoring.awayScore || 0)} goals` : "—"}</strong></div></div><div className="playerStats"><h3>Player performance</h3>{table.map((row) => <div className="playerStatRow" key={row.id}><span className="avatar">{row.name.slice(0,2).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.team}</small></div><b>{row.w}W</b><b>{row.gf} GF</b><b>{row.gd > 0 ? "+" : ""}{row.gd} GD</b></div>)}</div></>}
      {tab === "pitch" && <TournamentPitch tournament={data} />}
    </section>
    {syncConflict && <div className="modalBack syncConflictBack"><section className="syncConflictModal" role="alertdialog" aria-modal="true" aria-labelledby="sync-conflict-title"><span className="syncConflictIcon" aria-hidden="true">↔</span><p>SYNC REVIEW</p><h2 id="sync-conflict-title">Another scorekeeper saved first</h2><p>Your changes are safe on this device. Choose which version should become the tournament&apos;s live scoreboard.</p><div className="syncConflictChoices"><button onClick={() => resolveSyncConflict("cloud")}><b>Use cloud version</b><small>Discard this device&apos;s queued changes and load the latest live scores.</small></button><button className="device" onClick={() => resolveSyncConflict("device")}><b>Keep this device version</b><small>Replace the cloud scoreboard with the changes currently shown here.</small></button></div></section></div>}
    {showSetup && <div className="modalBack" onMouseDown={(e) => e.target === e.currentTarget && setShowSetup(false)}><section className="modal settingsModal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><div className="sheetHandle" aria-hidden="true" /><div className="modalHead"><div><p className="eyebrow">Tournament management</p><h2 id="setup-title">{settingsTab === "setup" ? "Setup" : settingsTab === "access" ? "Access" : settingsTab === "data" ? "Data & exports" : "Change history"}</h2></div><button aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div><nav className="settingsTabs" aria-label="Tournament settings sections">{(["setup","access","data","history"] as const).map((item) => <button className={settingsTab === item ? "active" : ""} onClick={() => setSettingsTab(item)} key={item}>{item === "data" ? "Data" : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>{settingsTab === "setup" && <><label className="nameField">Tournament name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><fieldset className="formatPicker"><legend>Format</legend><button className={draft.format === "league" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "league" })}><b>League</b><small>Everyone plays everyone</small></button><button className={draft.format === "knockout" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "knockout" })}><b>Knockout</b><small>Lose and you’re out</small></button></fieldset>{draft.format === "league" && <label className="legOption"><span><b>Home & away fixtures</b><small>Each pair plays twice, swapping the home player</small></span><input type="checkbox" checked={draft.homeAndAway} onChange={(e) => setDraft({ ...draft, homeAndAway: e.target.checked })} /></label>}<div className="playerEditor">{draft.players.map((p, i) => <div className="playerRow" key={p.id}><span>{i + 1}</span><input aria-label={`Player ${i + 1} name`} value={p.name} onChange={(e) => updatePlayer(p.id, "name", e.target.value)} /><input aria-label={`${p.name} team`} value={p.team} onChange={(e) => updatePlayer(p.id, "team", e.target.value)} /><button aria-label={`Remove ${p.name}`} disabled={draft.players.length <= 2} onClick={() => setDraft((d) => ({ ...d, players: d.players.filter((x) => x.id !== p.id) }))}>×</button></div>)}</div><button className="addButton" onClick={addPlayer}>＋ Add player</button><div className="warning">{draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length) ? "Knockout tournaments currently need 2, 4, 8 or 16 players." : "Generating fixtures will clear any existing scores."}</div><div className="modalActions"><button className="cancel" onClick={() => setShowSetup(false)}>Cancel</button><button className="primary" disabled={draft.players.some((p) => !p.name.trim()) || (draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length))} onClick={regenerate}>Randomise & generate fixtures</button></div></>}{settingsTab === "access" && (shareId && editToken ? <div className="adminAccess"><span><b>Admin handover</b><small>Anyone with this private link can update fixtures and scores. Share it only with trusted scorekeepers.</small></span><button onClick={copyAdminLink}>{adminCopyState === "copied" ? "Admin link copied" : adminCopyState === "error" ? "Copy failed" : "Copy admin link"}</button></div> : <div className="settingsEmpty"><span>🔐</span><strong>Admin access is being prepared</strong><p>Once cloud saving is ready, the private handover link will appear here.</p></div>)}{settingsTab === "data" && <section className="dataTools"><div><b>Exports & backup</b><small>Download results, create a printable PDF, or restore a saved tournament.</small></div><div><button onClick={exportCsv}>CSV results</button><button onClick={() => window.print()}>Print / PDF</button><button onClick={exportBackup}>Download backup</button><button onClick={() => importRef.current?.click()}>Restore backup</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(e) => restoreBackup(e.target.files?.[0])} /></div></section>}{settingsTab === "history" && (data.history.length > 0 ? <section className="auditPanel"><div><b>Recent changes</b><button onClick={undoLast}>↶ Undo latest</button></div>{data.history.slice(0,10).map((entry) => <p key={entry.id}><span>{entry.label}</span><time>{new Date(entry.at).toLocaleString([], { month:"short", day:"numeric", hour: "2-digit", minute: "2-digit" })}</time></p>)}</section> : <div className="settingsEmpty"><span>↶</span><strong>No changes recorded yet</strong><p>Score edits, status updates and regenerated fixtures will appear here.</p></div>)}</section></div>}
    {showDashboard && <div className="modalBack dashboardBack" onMouseDown={(e) => e.target === e.currentTarget && setShowDashboard(false)}><section className="modal dashboardModal" role="dialog" aria-modal="true" aria-labelledby="dashboard-title"><div className="modalHead"><div><p className="eyebrow">Tournament centre</p><h2 id="dashboard-title">Your tournaments</h2></div><button aria-label="Close" onClick={() => setShowDashboard(false)}>×</button></div><button className="newTournament" onClick={createTournament}>＋ Create tournament</button><div className="tournamentSections"><h3>Active</h3><div className="tournamentGrid">{catalog.filter((item) => !item.archived).map((item) => <article className={item.id === shareId ? "current" : ""} key={item.id}><span>{item.id === shareId ? "OPEN NOW" : "TOURNAMENT"}</span><strong>{item.name}</strong><small>Updated {new Date(item.updatedAt).toLocaleDateString()}</small><div><button onClick={() => openTournament(item.id)}>Open</button><button onClick={() => toggleArchive(item.id)}>Archive</button></div></article>)}</div>{catalog.some((item) => item.archived) && <><h3>Archived</h3><div className="tournamentGrid archived">{catalog.filter((item) => item.archived).map((item) => <article key={item.id}><span>ARCHIVED</span><strong>{item.name}</strong><div><button onClick={() => openTournament(item.id)}>Open</button><button onClick={() => toggleArchive(item.id)}>Restore</button></div></article>)}</div></>}</div></section></div>}
    {showChampionCelebration && champion && <ChampionCelebration champion={champion} onClose={() => setShowChampionCelebration(false)} />}
    {toast && <div className={`toast${toast.tone === "error" ? " error" : ""}`} role="status" aria-live="polite"><span aria-hidden="true">{toast.tone === "error" ? "!" : "✓"}</span>{toast.message}</div>}
  </main>;
}
