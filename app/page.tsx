"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Player = { id: string; name: string; team: string };
type MatchStatus = "scheduled" | "live" | "finished" | "postponed";
type Match = { id: string; round: number; homeId: string; awayId: string; homeScore: number | null; awayScore: number | null; status: MatchStatus };
type Format = "league" | "knockout";
type AuditEntry = { id: string; at: string; label: string; snapshot: string };
type Tournament = { name: string; format: Format; homeAndAway: boolean; players: Player[]; matches: Match[]; history: AuditEntry[] };
type TournamentRef = { id: string; name: string; updatedAt: string; archived?: boolean };

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

function advanceKnockout(matches: Match[]) {
  const result = [...matches]; const lastRound = Math.max(...result.map((m) => m.round));
  const current = result.filter((m) => m.round === lastRound);
  if (current.length <= 1 || current.some((m) => m.homeScore === null || m.awayScore === null)) return result;
  const winners = current.map((m) => (m.homeScore! > m.awayScore! ? m.homeId : m.awayId));
  for (let i = 0; i < winners.length; i += 2) result.push({ id: crypto.randomUUID(), round: lastRound + 1, homeId: winners[i], awayId: winners[i + 1], homeScore: null, awayScore: null, status: "scheduled" });
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
  const matches = (value.matches || []).map((match) => ({ ...match, status: match.status || (match.homeScore !== null && match.awayScore !== null ? "finished" : "scheduled") }));
  return { name: value.name || "Friday Night League", format: value.format || "league", homeAndAway: Boolean(value.homeAndAway), players: value.players || [], matches, history: Array.isArray(value.history) ? value.history : [] };
}
function snapshotOf(value: Tournament) { const { history: _history, ...snapshot } = value; return JSON.stringify(snapshot); }
function audited(previous: Tournament, next: Tournament, label: string): Tournament { return { ...next, history: [{ id: crypto.randomUUID(), at: new Date().toISOString(), label, snapshot: snapshotOf(previous) }, ...previous.history].slice(0, 40) }; }
function readCatalog(): TournamentRef[] { try { return JSON.parse(localStorage.getItem("lagata-tournament-catalog") || "[]"); } catch { return []; } }

export default function Home() {
  const [data, setData] = useState<Tournament>(initial);
  const [draft, setDraft] = useState<Pick<Tournament, "name" | "players" | "format" | "homeAndAway">>({ name: initial.name, players: initial.players, format: initial.format, homeAndAway: initial.homeAndAway });
  const [ready, setReady] = useState(false); const [tab, setTab] = useState<"matches" | "table" | "stats" | "pitch">("matches");
  const [round, setRound] = useState(1); const [showSetup, setShowSetup] = useState(false); const [showDashboard, setShowDashboard] = useState(false); const [catalog, setCatalog] = useState<TournamentRef[]>([]); const importRef = useRef<HTMLInputElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light"); const [shareId, setShareId] = useState(""); const [editToken, setEditToken] = useState("");
  const [shareState, setShareState] = useState<"idle" | "saving" | "copied" | "error">("idle"); const [adminCopyState, setAdminCopyState] = useState<"idle" | "copied" | "error">("idle"); const cloudLoaded = useRef(false); const creatingCloud = useRef(false);

  useEffect(() => {
    setCatalog(readCatalog());
    const chosenTheme = (localStorage.getItem("lagata-theme") as "light" | "dark") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); setTheme(chosenTheme);
    const params = new URLSearchParams(location.search); const tournamentId = params.get("t") || "";
    const adminToken = new URLSearchParams(location.hash.slice(1)).get("admin") || "";
    const storedId = localStorage.getItem("lagata-current-tournament") || "";
    const activeId = tournamentId || storedId;
    if (activeId) {
      const token = adminToken || localStorage.getItem(`lagata-edit-${activeId}`) || "";
      if (adminToken) { localStorage.setItem("lagata-current-tournament", activeId); localStorage.setItem(`lagata-edit-${activeId}`, adminToken); history.replaceState({}, "", `${location.pathname}?t=${activeId}`); }
      setShareId(activeId); setEditToken(token);
      fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(activeId)}`).then((r) => r.ok ? r.json() : Promise.reject()).then(({ tournament }) => { const normalised = normaliseTournament(tournament); setData(normalised); if (token) rememberTournament(activeId, normalised.name); cloudLoaded.current = true; setReady(true); }).catch(() => { if (!tournamentId) { localStorage.removeItem("lagata-current-tournament"); setShareId(""); setEditToken(""); } setReady(true); });
    } else { const saved = localStorage.getItem("fc-night-tournament"); if (saved) try { setData(normaliseTournament(JSON.parse(saved))); } catch {} setReady(true); }
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("lagata-theme", theme); }, [theme]);
  useEffect(() => {
    if (!ready || shareId || creatingCloud.current) return;
    creatingCloud.current = true;
    setShareState("saving");
    fetch(`${API_BASE}/api/tournament`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournament: data }) })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((result) => { localStorage.setItem("lagata-current-tournament", result.id); localStorage.setItem(`lagata-edit-${result.id}`, result.editToken); localStorage.removeItem("fc-night-tournament"); rememberTournament(result.id, data.name); setShareId(result.id); setEditToken(result.editToken); cloudLoaded.current = true; setShareState("idle"); })
      .catch(() => { creatingCloud.current = false; setShareState("error"); });
  }, [data, ready, shareId]);
  useEffect(() => {
    if (!shareId || !editToken || !cloudLoaded.current) return;
    setShareState("saving"); const timer = setTimeout(() => fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`, { method: "PUT", headers: { "content-type": "application/json", "x-edit-token": editToken }, body: JSON.stringify({ tournament: data }) }).then((r) => { if (!r.ok) throw new Error(); rememberTournament(shareId, data.name); setShareState("idle"); }).catch(() => setShareState("error")), 650);
    return () => clearTimeout(timer);
  }, [data, shareId, editToken]);
  useEffect(() => {
    if (!shareId || editToken) return; const refresh = () => fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(shareId)}`).then((r) => r.json()).then(({ tournament }) => tournament && setData(normaliseTournament(tournament))).catch(() => {});
    const timer = setInterval(refresh, 5000); return () => clearInterval(timer);
  }, [shareId, editToken]);

  const sharingAvailable = true;
  const isViewer = Boolean(shareId && !editToken); const playerById = (id: string) => data.players.find((p) => p.id === id);
  const maxRound = Math.max(1, ...data.matches.map((m) => m.round)); const playedMatches = data.matches.filter((m) => m.homeScore !== null && m.awayScore !== null); const completed = playedMatches.filter((m) => m.status === "finished").length;
  const progress = data.matches.length ? Math.round((completed / data.matches.length) * 100) : 0;
  const table = useMemo(() => {
    const rows = data.players.map((p) => ({ ...p, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })); const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    data.matches.forEach((m) => { if (m.homeScore === null || m.awayScore === null) return; const h = byId[m.homeId], a = byId[m.awayId]; if (!h || !a) return; h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore; if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += 3; } else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; } });
    rows.forEach((r) => r.gd = r.gf - r.ga); return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }, [data]);
  const rankedPlayers = table.filter((row) => row.p > 0); const topScorer = [...rankedPlayers].sort((a, b) => b.gf - a.gf || b.pts - a.pts)[0]; const bestDefence = [...rankedPlayers].sort((a, b) => a.ga - b.ga || b.p - a.p)[0];
  const biggestWin = [...playedMatches].sort((a, b) => Math.abs((b.homeScore || 0) - (b.awayScore || 0)) - Math.abs((a.homeScore || 0) - (a.awayScore || 0)))[0];
  const highestScoring = [...playedMatches].sort((a, b) => ((b.homeScore || 0) + (b.awayScore || 0)) - ((a.homeScore || 0) + (a.awayScore || 0)))[0];
  const finalMatch = data.format === "knockout" ? data.matches.find((m) => m.round === maxRound && data.matches.filter((x) => x.round === maxRound).length === 1) : undefined;
  const champion = finalMatch && finalMatch.homeScore !== null && finalMatch.awayScore !== null ? playerById(finalMatch.homeScore > finalMatch.awayScore ? finalMatch.homeId : finalMatch.awayId) : undefined;
  const awardChampion = data.format === "league" && completed === data.matches.length && data.matches.length ? table[0] : champion;

  function rememberTournament(id: string, name: string) { setCatalog((current) => { const next = [{ id, name, updatedAt: new Date().toISOString(), archived: current.find((item) => item.id === id)?.archived }, ...current.filter((item) => item.id !== id)]; localStorage.setItem("lagata-tournament-catalog", JSON.stringify(next)); return next; }); }
  function updateScore(id: string, side: "homeScore" | "awayScore", value: string) { if (isViewer) return; const score = value === "" ? null : Math.max(0, Math.min(99, Number(value))); setData((d) => { const changed = d.matches.map((m) => { if (m.id !== id) return m; const updated = { ...m, [side]: score }; return { ...updated, status: updated.homeScore !== null && updated.awayScore !== null ? "finished" as MatchStatus : score !== null ? "live" as MatchStatus : m.status }; }); const next = { ...d, matches: d.format === "knockout" ? advanceKnockout(changed) : changed }; return audited(d, next, "Score updated"); }); }
  function updateStatus(id: string, status: MatchStatus) { if (isViewer) return; setData((d) => audited(d, { ...d, matches: d.matches.map((m) => m.id === id ? { ...m, status } : m) }, `Match marked ${statusLabels[status].toLowerCase()}`)); }
  function undoLast() { if (isViewer) return; setData((d) => { const last = d.history[0]; if (!last) return d; try { return { ...normaliseTournament(JSON.parse(last.snapshot)), history: d.history.slice(1) }; } catch { return d; } }); }
  function openSetup() { if (isViewer) return; setDraft({ name: data.name, players: data.players.map((p) => ({ ...p })), format: data.format, homeAndAway: data.homeAndAway }); setShowSetup(true); }
  function regenerate() { const next: Tournament = { name: draft.name.trim() || "Friday Night League", format: draft.format, homeAndAway: draft.format === "league" && draft.homeAndAway, players: draft.players, matches: makeFixtures(draft.players, draft.format, draft.homeAndAway), history: data.history }; setData(audited(data, next, "Fixtures regenerated")); setRound(1); setShowSetup(false); setTab("matches"); }
  function addPlayer() { setDraft((d) => ({ ...d, players: [...d.players, { id: crypto.randomUUID(), name: `Player ${d.players.length + 1}`, team: "Choose club" }] })); }
  function updatePlayer(id: string, field: "name" | "team", value: string) { setDraft((d) => ({ ...d, players: d.players.map((p) => p.id === id ? { ...p, [field]: value } : p) })); }
  async function shareTournament() {
    if (shareId) { const url = `${location.origin}${location.pathname}?t=${shareId}`; await navigator.clipboard.writeText(url); setShareState("copied"); setTimeout(() => setShareState("idle"), 1600); return; }
    setShareState("saving"); try { const response = await fetch(`${API_BASE}/api/tournament`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournament: data }) }); if (!response.ok) throw new Error(); const result = await response.json(); localStorage.setItem("lagata-current-tournament", result.id); localStorage.setItem(`lagata-edit-${result.id}`, result.editToken); setShareId(result.id); setEditToken(result.editToken); cloudLoaded.current = true; history.replaceState({}, "", `${location.pathname}?t=${result.id}`); await navigator.clipboard.writeText(`${location.origin}${location.pathname}?t=${result.id}`); setShareState("copied"); setTimeout(() => setShareState("idle"), 1600); } catch { setShareState("error"); }
  }
  async function copyAdminLink() {
    if (!shareId || !editToken) return;
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}?t=${shareId}#admin=${editToken}`); setAdminCopyState("copied"); setTimeout(() => setAdminCopyState("idle"), 1800); } catch { setAdminCopyState("error"); }
  }
  function downloadFile(name: string, body: string, type: string) { const url = URL.createObjectURL(new Blob([body], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
  function exportCsv() { const rows = [["Round", "Status", "Home", "Home score", "Away score", "Away"], ...data.matches.map((m) => [String(m.round), statusLabels[m.status], playerById(m.homeId)?.name || "", m.homeScore ?? "", m.awayScore ?? "", playerById(m.awayId)?.name || ""])]; downloadFile(`${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-results.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv"); }
  function exportBackup() { downloadFile(`${data.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-backup.json`, JSON.stringify(data, null, 2), "application/json"); }
  function restoreBackup(file?: File) { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const restored = normaliseTournament(JSON.parse(String(reader.result))); if (restored.players.length < 2 || !restored.matches.length) throw new Error(); setData((d) => audited(d, restored, "Backup restored")); setShowSetup(false); } catch { alert("That file is not a valid Lagata tournament backup."); } }; reader.readAsText(file); }
  function createTournament() { const fresh: Tournament = { ...initial, name: "New Tournament", players: initial.players.map((p) => ({ ...p })), matches: initialMatches.map((m) => ({ ...m })), history: [] }; localStorage.removeItem("lagata-current-tournament"); setData(fresh); setShareId(""); setEditToken(""); cloudLoaded.current = false; creatingCloud.current = false; history.replaceState({}, "", location.pathname); setRound(1); setTab("matches"); setShowDashboard(false); }
  async function openTournament(id: string) { const token = localStorage.getItem(`lagata-edit-${id}`) || ""; try { const response = await fetch(`${API_BASE}/api/tournament?id=${encodeURIComponent(id)}`); if (!response.ok) throw new Error(); const result = await response.json(); setData(normaliseTournament(result.tournament)); setShareId(id); setEditToken(token); cloudLoaded.current = true; localStorage.setItem("lagata-current-tournament", id); history.replaceState({}, "", `${location.pathname}?t=${id}`); setRound(1); setTab("matches"); setShowDashboard(false); } catch { setShareState("error"); } }
  function toggleArchive(id: string) { setCatalog((current) => { const next = current.map((item) => item.id === id ? { ...item, archived: !item.archived } : item); localStorage.setItem("lagata-tournament-catalog", JSON.stringify(next)); return next; }); }

  return <main>
    <header className="topbar"><a className="brand" href="#"><span className="brandMark" aria-hidden="true"><i>L</i><b>UT</b></span><span>LAGATA <em>ULTIMATE TEAM</em></span></a><div className="topActions">{!isViewer && <button className="dashboardButton" onClick={() => setShowDashboard(true)}>Tournaments</button>}{!isViewer && data.history.length > 0 && <button className="undoButton" onClick={undoLast} title={data.history[0].label}>↶ Undo</button>}<button className="iconButton" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "◐" : "☀"}</button>{!isViewer && sharingAvailable && <button className="shareButton" disabled={shareState === "saving"} onClick={shareTournament}><span aria-hidden="true">↗</span>{shareState === "copied" ? "Link copied" : shareState === "saving" ? "Saving…" : shareId ? "Copy link" : "Share live"}</button>}{!isViewer && <button className="ghostButton" onClick={openSetup} aria-label="Manage tournament"><span className="settingsGlyph" aria-hidden="true">•••</span><span>Manage tournament</span></button>}</div></header>
    {isViewer && <div className="viewerBar"><span className="liveDot" /> Live spectator view <b>Scores refresh automatically</b></div>}
    <section className="hero"><div><p className="eyebrow"><span className="liveDot" /> {champion ? "Tournament complete" : "Tournament in progress"}</p><h1>{data.name}</h1><p className="subline">{data.players.length} players <span>•</span> {data.format === "league" ? "League phase" : "Knockout cup"} <span>•</span> {data.format === "league" ? `${data.homeAndAway ? "Home & away" : "Single round"} · 3 pts per win` : "One champion"}</p></div>{champion ? <div className="championCard"><span>CHAMPION</span><strong>🏆 {champion.name}</strong><small>{champion.team}</small></div> : <div className="progressCard"><div className="progressTop"><span>Tournament progress</span><strong>{progress}%</strong></div><div className="progressTrack"><i style={{ width: `${progress}%` }} /></div><small>{completed} of {data.matches.length} matches played</small></div>}</section>
    <section className="content"><div className="tabs" role="tablist"><button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>Matches <b>{data.matches.length - completed}</b></button><button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>{data.format === "league" ? "League table" : "Results"}</button><button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Stats & awards</button><button className={tab === "pitch" ? "active" : ""} onClick={() => setTab("pitch")}>Pitch</button></div>
      {tab === "matches" && <><div className="sectionHead"><div><p className="eyebrow">Fixtures</p><h2>{data.format === "knockout" && round === maxRound ? "Final" : `Round ${round}`} <span>of {maxRound}</span></h2></div><div className="roundNav"><button aria-label="Previous round" disabled={round === 1} onClick={() => setRound((r) => r - 1)}>←</button><button aria-label="Next round" disabled={round === maxRound} onClick={() => setRound((r) => r + 1)}>→</button></div></div><div className="matchList">{data.matches.filter((m) => m.round === round).map((m) => { const h = playerById(m.homeId), a = playerById(m.awayId); if (!h || !a) return null; return <article className="matchCard" key={m.id}><div className="matchMeta">{isViewer ? <span className={`statusBadge ${m.status}`}>{statusLabels[m.status]}</span> : <select className={`statusSelect ${m.status}`} aria-label={`Status for ${h.name} versus ${a.name}`} value={m.status} onChange={(e) => updateStatus(m.id, e.target.value as MatchStatus)}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>}<i /><small>Match {data.matches.indexOf(m) + 1}</small></div><div className="matchup"><div className="player home"><div><strong>{h.name}</strong><small>{h.team}</small></div><span className="avatar">{h.name.slice(0, 2).toUpperCase()}</span></div><div className="scoreBox"><input readOnly={isViewer} aria-label={`${h.name} score`} inputMode="numeric" value={m.homeScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "homeScore", e.target.value)} /><b>:</b><input readOnly={isViewer} aria-label={`${a.name} score`} inputMode="numeric" value={m.awayScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "awayScore", e.target.value)} /></div><div className="player away"><span className="avatar alt">{a.name.slice(0, 2).toUpperCase()}</span><div><strong>{a.name}</strong><small>{a.team}</small></div></div></div></article>; })}</div><p className="saveNote">{isViewer ? "Live scores refresh every 5 seconds" : shareId ? (shareState === "error" ? "Cloud save needs retrying" : "✓ Changes sync to every spectator") : "✓ Scores save automatically on this device"}</p></>}
      {tab === "table" && <><div className="sectionHead"><div><p className="eyebrow">Standings</p><h2>{data.format === "league" ? "League table" : "Tournament results"}</h2></div><p className="tieNote">{data.format === "league" ? "Points, goal difference, then goals scored" : "Completed knockout matches"}</p></div><div className="tableWrap"><table><thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{table.map((r, i) => <tr key={r.id}><td><span className={`rank rank${i + 1}`}>{i + 1}</span></td><td><strong>{r.name}</strong><small>{r.team}</small></td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gd > 0 ? "+" : ""}{r.gd}</td><td><b>{r.pts}</b></td></tr>)}</tbody></table></div></>}
      {tab === "stats" && <><div className="sectionHead"><div><p className="eyebrow">Tournament intelligence</p><h2>Stats & awards</h2></div><p className="tieNote">Updates after every completed score</p></div><div className="awardGrid"><article className="awardCard featured"><span>🏆 Champion</span><strong>{awardChampion?.name || "Still to be decided"}</strong><small>{awardChampion?.team || "Complete the tournament to crown a winner"}</small></article><article className="awardCard"><span>⚽ Golden boot</span><strong>{topScorer?.name || "No results yet"}</strong><small>{topScorer ? `${topScorer.gf} goals scored` : "Enter scores to begin"}</small></article><article className="awardCard"><span>🛡 Best defence</span><strong>{bestDefence?.name || "No results yet"}</strong><small>{bestDefence ? `${bestDefence.ga} goals conceded` : "Enter scores to begin"}</small></article><article className="awardCard"><span>📈 Biggest win</span><strong>{biggestWin ? `${playerById(biggestWin.homeId)?.name} ${biggestWin.homeScore}–${biggestWin.awayScore} ${playerById(biggestWin.awayId)?.name}` : "No results yet"}</strong><small>{biggestWin ? `Round ${biggestWin.round}` : "Enter scores to begin"}</small></article></div><div className="statStrip"><div><span>Matches played</span><strong>{playedMatches.length}</strong></div><div><span>Total goals</span><strong>{playedMatches.reduce((sum, m) => sum + (m.homeScore || 0) + (m.awayScore || 0), 0)}</strong></div><div><span>Goals per match</span><strong>{playedMatches.length ? (playedMatches.reduce((sum, m) => sum + (m.homeScore || 0) + (m.awayScore || 0), 0) / playedMatches.length).toFixed(1) : "0.0"}</strong></div><div><span>Highest scoring</span><strong>{highestScoring ? `${(highestScoring.homeScore || 0) + (highestScoring.awayScore || 0)} goals` : "—"}</strong></div></div><div className="playerStats"><h3>Player performance</h3>{table.map((row) => <div className="playerStatRow" key={row.id}><span className="avatar">{row.name.slice(0,2).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.team}</small></div><b>{row.w}W</b><b>{row.gf} GF</b><b>{row.gd > 0 ? "+" : ""}{row.gd} GD</b></div>)}</div></>}
      {tab === "pitch" && <><div className="sectionHead"><div><p className="eyebrow">Tournament map</p><h2>{data.format === "league" ? "League journey" : "Road to the cup"}</h2></div><p className="tieNote">Updates as scores are entered</p></div><div className={`pitchBoard ${data.format}`}><div className="centreCircle" /><div className="pitchFlow">{Array.from({ length: maxRound }, (_, i) => i + 1).map((r) => <div className="pitchRound" key={r}><h3>{data.format === "knockout" && r === maxRound ? "FINAL" : `ROUND ${r}`}</h3>{data.matches.filter((m) => m.round === r).map((m) => { const h = playerById(m.homeId), a = playerById(m.awayId); if (!h || !a) return null; return <div className="pitchMatch" key={m.id}><span><b>{h.name}</b><i>{m.homeScore ?? "–"}</i></span><span><b>{a.name}</b><i>{m.awayScore ?? "–"}</i></span></div>; })}</div>)}{data.format === "knockout" && <div className="cupNode"><span>🏆</span><strong>{champion?.name || "CHAMPION"}</strong></div>}</div></div></>}
    </section>
    {showSetup && <div className="modalBack" onMouseDown={(e) => e.target === e.currentTarget && setShowSetup(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><div className="sheetHandle" aria-hidden="true" /><div className="modalHead"><div><p className="eyebrow">Tournament setup</p><h2 id="setup-title">Players & teams</h2></div><button aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div><label className="nameField">Tournament name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><fieldset className="formatPicker"><legend>Format</legend><button className={draft.format === "league" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "league" })}><b>League</b><small>Everyone plays everyone</small></button><button className={draft.format === "knockout" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "knockout" })}><b>Knockout</b><small>Lose and you’re out</small></button></fieldset>{draft.format === "league" && <label className="legOption"><span><b>Home & away fixtures</b><small>Each pair plays twice, swapping the home player</small></span><input type="checkbox" checked={draft.homeAndAway} onChange={(e) => setDraft({ ...draft, homeAndAway: e.target.checked })} /></label>}<div className="playerEditor">{draft.players.map((p, i) => <div className="playerRow" key={p.id}><span>{i + 1}</span><input aria-label={`Player ${i + 1} name`} value={p.name} onChange={(e) => updatePlayer(p.id, "name", e.target.value)} /><input aria-label={`${p.name} team`} value={p.team} onChange={(e) => updatePlayer(p.id, "team", e.target.value)} /><button aria-label={`Remove ${p.name}`} disabled={draft.players.length <= 2} onClick={() => setDraft((d) => ({ ...d, players: d.players.filter((x) => x.id !== p.id) }))}>×</button></div>)}</div><button className="addButton" onClick={addPlayer}>＋ Add player</button><section className="dataTools"><div><b>Exports & backup</b><small>Download results, print to PDF, or restore a saved tournament.</small></div><div><button onClick={exportCsv}>CSV</button><button onClick={() => window.print()}>Print / PDF</button><button onClick={exportBackup}>Backup</button><button onClick={() => importRef.current?.click()}>Restore</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(e) => restoreBackup(e.target.files?.[0])} /></div></section>{data.history.length > 0 && <section className="auditPanel"><div><b>Recent changes</b><button onClick={undoLast}>↶ Undo latest</button></div>{data.history.slice(0,4).map((entry) => <p key={entry.id}><span>{entry.label}</span><time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>)}</section>}{shareId && editToken && <div className="adminAccess"><span><b>Admin handover</b><small>Anyone with this private link can update fixtures and scores.</small></span><button onClick={copyAdminLink}>{adminCopyState === "copied" ? "Admin link copied" : adminCopyState === "error" ? "Copy failed" : "Copy admin link"}</button></div>}<div className="warning">{draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length) ? "Knockout tournaments currently need 2, 4, 8 or 16 players." : "Generating fixtures will clear any existing scores."}</div><div className="modalActions"><button className="cancel" onClick={() => setShowSetup(false)}>Cancel</button><button className="primary" disabled={draft.players.some((p) => !p.name.trim()) || (draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length))} onClick={regenerate}>Randomise & generate fixtures</button></div></section></div>}
    {showDashboard && <div className="modalBack dashboardBack" onMouseDown={(e) => e.target === e.currentTarget && setShowDashboard(false)}><section className="modal dashboardModal" role="dialog" aria-modal="true" aria-labelledby="dashboard-title"><div className="modalHead"><div><p className="eyebrow">Tournament centre</p><h2 id="dashboard-title">Your tournaments</h2></div><button aria-label="Close" onClick={() => setShowDashboard(false)}>×</button></div><button className="newTournament" onClick={createTournament}>＋ Create tournament</button><div className="tournamentSections"><h3>Active</h3><div className="tournamentGrid">{catalog.filter((item) => !item.archived).map((item) => <article className={item.id === shareId ? "current" : ""} key={item.id}><span>{item.id === shareId ? "OPEN NOW" : "TOURNAMENT"}</span><strong>{item.name}</strong><small>Updated {new Date(item.updatedAt).toLocaleDateString()}</small><div><button onClick={() => openTournament(item.id)}>Open</button><button onClick={() => toggleArchive(item.id)}>Archive</button></div></article>)}</div>{catalog.some((item) => item.archived) && <><h3>Archived</h3><div className="tournamentGrid archived">{catalog.filter((item) => item.archived).map((item) => <article key={item.id}><span>ARCHIVED</span><strong>{item.name}</strong><div><button onClick={() => openTournament(item.id)}>Open</button><button onClick={() => toggleArchive(item.id)}>Restore</button></div></article>)}</div></>}</div></section></div>}
  </main>;
}
