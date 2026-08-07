"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Player = { id: string; name: string; team: string };
type Match = { id: string; round: number; homeId: string; awayId: string; homeScore: number | null; awayScore: number | null };
type Format = "league" | "knockout";
type Tournament = { name: string; format: Format; players: Player[]; matches: Match[] };

const demoPlayers: Player[] = [
  { id: "p1", name: "Marcus", team: "Real Madrid" }, { id: "p2", name: "Dre", team: "Barcelona" },
  { id: "p3", name: "Jay", team: "Liverpool" }, { id: "p4", name: "Tobi", team: "Bayern" },
];

function shuffled(ids: string[]) {
  const result = [...ids];
  for (let i = result.length - 1; i > 1; i--) { const j = 1 + Math.floor(Math.random() * i); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function makeFixtures(players: Player[], format: Format): Match[] {
  const ids = shuffled(players.map((p) => p.id));
  if (format === "knockout") return Array.from({ length: ids.length / 2 }, (_, i) => ({ id: crypto.randomUUID(), round: 1, homeId: ids[i * 2], awayId: ids[i * 2 + 1], homeScore: null, awayScore: null }));
  const rotation: (string | null)[] = [...ids]; if (rotation.length % 2) rotation.push(null);
  const matches: Match[] = []; let ring = [...rotation];
  for (let round = 1; round < rotation.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a && b) { const swap = (round + i) % 2 === 0; matches.push({ id: crypto.randomUUID(), round, homeId: swap ? b : a, awayId: swap ? a : b, homeScore: null, awayScore: null }); }
    }
    ring = [ring[0], ring.at(-1)!, ...ring.slice(1, -1)];
  }
  return matches;
}

function advanceKnockout(matches: Match[]) {
  const result = [...matches]; const lastRound = Math.max(...result.map((m) => m.round));
  const current = result.filter((m) => m.round === lastRound);
  if (current.length <= 1 || current.some((m) => m.homeScore === null || m.awayScore === null)) return result;
  const winners = current.map((m) => (m.homeScore! > m.awayScore! ? m.homeId : m.awayId));
  for (let i = 0; i < winners.length; i += 2) result.push({ id: crypto.randomUUID(), round: lastRound + 1, homeId: winners[i], awayId: winners[i + 1], homeScore: null, awayScore: null });
  return result;
}

const initial: Tournament = { name: "Friday Night League", format: "league", players: demoPlayers, matches: makeFixtures(demoPlayers, "league") };

export default function Home() {
  const [data, setData] = useState<Tournament>(initial);
  const [draft, setDraft] = useState<Pick<Tournament, "name" | "players" | "format">>({ name: initial.name, players: initial.players, format: initial.format });
  const [ready, setReady] = useState(false); const [tab, setTab] = useState<"matches" | "table" | "pitch">("matches");
  const [round, setRound] = useState(1); const [showSetup, setShowSetup] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light"); const [shareId, setShareId] = useState(""); const [editToken, setEditToken] = useState("");
  const [shareState, setShareState] = useState<"idle" | "saving" | "copied" | "error">("idle"); const cloudLoaded = useRef(false);

  useEffect(() => {
    const chosenTheme = (localStorage.getItem("lagata-theme") as "light" | "dark") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); setTheme(chosenTheme);
    const params = new URLSearchParams(location.search); const tournamentId = params.get("t") || "";
    if (tournamentId) {
      setShareId(tournamentId); setEditToken(localStorage.getItem(`lagata-edit-${tournamentId}`) || "");
      fetch(`/api/tournament?id=${encodeURIComponent(tournamentId)}`).then((r) => r.ok ? r.json() : Promise.reject()).then(({ tournament }) => { setData({ ...tournament, format: tournament.format || "league" }); cloudLoaded.current = true; setReady(true); }).catch(() => setReady(true));
    } else { const saved = localStorage.getItem("fc-night-tournament"); if (saved) try { const parsed = JSON.parse(saved); setData({ ...parsed, format: parsed.format || "league" }); } catch {} setReady(true); }
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("lagata-theme", theme); }, [theme]);
  useEffect(() => { if (ready && !shareId) localStorage.setItem("fc-night-tournament", JSON.stringify(data)); }, [data, ready, shareId]);
  useEffect(() => {
    if (!shareId || !editToken || !cloudLoaded.current) return;
    setShareState("saving"); const timer = setTimeout(() => fetch(`/api/tournament?id=${encodeURIComponent(shareId)}`, { method: "PUT", headers: { "content-type": "application/json", "x-edit-token": editToken }, body: JSON.stringify({ tournament: data }) }).then((r) => { if (!r.ok) throw new Error(); setShareState("idle"); }).catch(() => setShareState("error")), 650);
    return () => clearTimeout(timer);
  }, [data, shareId, editToken]);
  useEffect(() => {
    if (!shareId || editToken) return; const refresh = () => fetch(`/api/tournament?id=${encodeURIComponent(shareId)}`).then((r) => r.json()).then(({ tournament }) => tournament && setData(tournament)).catch(() => {});
    const timer = setInterval(refresh, 5000); return () => clearInterval(timer);
  }, [shareId, editToken]);

  const isViewer = Boolean(shareId && !editToken); const playerById = (id: string) => data.players.find((p) => p.id === id);
  const maxRound = Math.max(1, ...data.matches.map((m) => m.round)); const completed = data.matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length;
  const progress = data.matches.length ? Math.round((completed / data.matches.length) * 100) : 0;
  const table = useMemo(() => {
    const rows = data.players.map((p) => ({ ...p, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })); const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    data.matches.forEach((m) => { if (m.homeScore === null || m.awayScore === null) return; const h = byId[m.homeId], a = byId[m.awayId]; if (!h || !a) return; h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore; if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += 3; } else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; } });
    rows.forEach((r) => r.gd = r.gf - r.ga); return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }, [data]);
  const finalMatch = data.format === "knockout" ? data.matches.find((m) => m.round === maxRound && data.matches.filter((x) => x.round === maxRound).length === 1) : undefined;
  const champion = finalMatch && finalMatch.homeScore !== null && finalMatch.awayScore !== null ? playerById(finalMatch.homeScore > finalMatch.awayScore ? finalMatch.homeId : finalMatch.awayId) : undefined;

  function updateScore(id: string, side: "homeScore" | "awayScore", value: string) { if (isViewer) return; const score = value === "" ? null : Math.max(0, Math.min(99, Number(value))); setData((d) => { const changed = d.matches.map((m) => m.id === id ? { ...m, [side]: score } : m); return { ...d, matches: d.format === "knockout" ? advanceKnockout(changed) : changed }; }); }
  function openSetup() { if (isViewer) return; setDraft({ name: data.name, players: data.players.map((p) => ({ ...p })), format: data.format }); setShowSetup(true); }
  function regenerate() { const next = { name: draft.name.trim() || "Friday Night League", format: draft.format, players: draft.players, matches: makeFixtures(draft.players, draft.format) }; setData(next); setRound(1); setShowSetup(false); setTab("matches"); }
  function addPlayer() { setDraft((d) => ({ ...d, players: [...d.players, { id: crypto.randomUUID(), name: `Player ${d.players.length + 1}`, team: "Choose club" }] })); }
  function updatePlayer(id: string, field: "name" | "team", value: string) { setDraft((d) => ({ ...d, players: d.players.map((p) => p.id === id ? { ...p, [field]: value } : p) })); }
  async function shareTournament() {
    if (shareId) { const url = `${location.origin}${location.pathname}?t=${shareId}`; await navigator.clipboard.writeText(url); setShareState("copied"); setTimeout(() => setShareState("idle"), 1600); return; }
    setShareState("saving"); try { const response = await fetch("/api/tournament", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tournament: data }) }); if (!response.ok) throw new Error(); const result = await response.json(); localStorage.setItem(`lagata-edit-${result.id}`, result.editToken); setShareId(result.id); setEditToken(result.editToken); cloudLoaded.current = true; history.replaceState({}, "", `${location.pathname}?t=${result.id}`); await navigator.clipboard.writeText(`${location.origin}${location.pathname}?t=${result.id}`); setShareState("copied"); setTimeout(() => setShareState("idle"), 1600); } catch { setShareState("error"); }
  }

  return <main>
    <header className="topbar"><a className="brand" href="#"><span className="brandMark" aria-hidden="true"><i>L</i><b>UT</b></span><span>LAGATA <em>ULTIMATE TEAM</em></span></a><div className="topActions"><button className="iconButton" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} mode`}>{theme === "light" ? "◐" : "☀"}</button>{!isViewer && <button className="shareButton" onClick={shareTournament}>{shareState === "copied" ? "Link copied" : shareState === "saving" ? "Saving…" : shareId ? "Copy spectator link" : "Share live"}</button>}<button className="ghostButton" onClick={openSetup} disabled={isViewer}><span className="settingsGlyph" aria-hidden="true">•••</span><span>{isViewer ? "View only" : "Manage tournament"}</span></button></div></header>
    {isViewer && <div className="viewerBar"><span className="liveDot" /> Live spectator view <b>Scores refresh automatically</b></div>}
    <section className="hero"><div><p className="eyebrow"><span className="liveDot" /> {champion ? "Tournament complete" : "Tournament in progress"}</p><h1>{data.name}</h1><p className="subline">{data.players.length} players <span>•</span> {data.format === "league" ? "League phase" : "Knockout cup"} <span>•</span> {data.format === "league" ? "3 pts per win" : "One champion"}</p></div>{champion ? <div className="championCard"><span>CHAMPION</span><strong>🏆 {champion.name}</strong><small>{champion.team}</small></div> : <div className="progressCard"><div className="progressTop"><span>Tournament progress</span><strong>{progress}%</strong></div><div className="progressTrack"><i style={{ width: `${progress}%` }} /></div><small>{completed} of {data.matches.length} matches played</small></div>}</section>
    <section className="content"><div className="tabs" role="tablist"><button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>Matches <b>{data.matches.length - completed}</b></button><button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>{data.format === "league" ? "League table" : "Results"}</button><button className={tab === "pitch" ? "active" : ""} onClick={() => setTab("pitch")}>Pitch</button></div>
      {tab === "matches" && <><div className="sectionHead"><div><p className="eyebrow">Fixtures</p><h2>{data.format === "knockout" && round === maxRound ? "Final" : `Round ${round}`} <span>of {maxRound}</span></h2></div><div className="roundNav"><button aria-label="Previous round" disabled={round === 1} onClick={() => setRound((r) => r - 1)}>←</button><button aria-label="Next round" disabled={round === maxRound} onClick={() => setRound((r) => r + 1)}>→</button></div></div><div className="matchList">{data.matches.filter((m) => m.round === round).map((m) => { const h = playerById(m.homeId), a = playerById(m.awayId); if (!h || !a) return null; const played = m.homeScore !== null && m.awayScore !== null; return <article className="matchCard" key={m.id}><div className="matchMeta"><span>{played ? "FINAL" : "UP NEXT"}</span><i /><small>Match {data.matches.indexOf(m) + 1}</small></div><div className="matchup"><div className="player home"><div><strong>{h.name}</strong><small>{h.team}</small></div><span className="avatar">{h.name.slice(0, 2).toUpperCase()}</span></div><div className="scoreBox"><input readOnly={isViewer} aria-label={`${h.name} score`} inputMode="numeric" value={m.homeScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "homeScore", e.target.value)} /><b>:</b><input readOnly={isViewer} aria-label={`${a.name} score`} inputMode="numeric" value={m.awayScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "awayScore", e.target.value)} /></div><div className="player away"><span className="avatar alt">{a.name.slice(0, 2).toUpperCase()}</span><div><strong>{a.name}</strong><small>{a.team}</small></div></div></div></article>; })}</div><p className="saveNote">{isViewer ? "Live scores refresh every 5 seconds" : shareId ? (shareState === "error" ? "Cloud save needs retrying" : "✓ Changes sync to every spectator") : "✓ Scores save automatically on this device"}</p></>}
      {tab === "table" && <><div className="sectionHead"><div><p className="eyebrow">Standings</p><h2>{data.format === "league" ? "League table" : "Tournament results"}</h2></div><p className="tieNote">{data.format === "league" ? "Points, goal difference, then goals scored" : "Completed knockout matches"}</p></div><div className="tableWrap"><table><thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>{table.map((r, i) => <tr key={r.id}><td><span className={`rank rank${i + 1}`}>{i + 1}</span></td><td><strong>{r.name}</strong><small>{r.team}</small></td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gd > 0 ? "+" : ""}{r.gd}</td><td><b>{r.pts}</b></td></tr>)}</tbody></table></div></>}
      {tab === "pitch" && <><div className="sectionHead"><div><p className="eyebrow">Tournament map</p><h2>{data.format === "league" ? "League journey" : "Road to the cup"}</h2></div><p className="tieNote">Updates as scores are entered</p></div><div className={`pitchBoard ${data.format}`}><div className="centreCircle" /><div className="pitchFlow">{Array.from({ length: maxRound }, (_, i) => i + 1).map((r) => <div className="pitchRound" key={r}><h3>{data.format === "knockout" && r === maxRound ? "FINAL" : `ROUND ${r}`}</h3>{data.matches.filter((m) => m.round === r).map((m) => { const h = playerById(m.homeId), a = playerById(m.awayId); if (!h || !a) return null; return <div className="pitchMatch" key={m.id}><span><b>{h.name}</b><i>{m.homeScore ?? "–"}</i></span><span><b>{a.name}</b><i>{m.awayScore ?? "–"}</i></span></div>; })}</div>)}{data.format === "knockout" && <div className="cupNode"><span>🏆</span><strong>{champion?.name || "CHAMPION"}</strong></div>}</div></div></>}
    </section>
    {showSetup && <div className="modalBack" onMouseDown={(e) => e.target === e.currentTarget && setShowSetup(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title"><div className="sheetHandle" aria-hidden="true" /><div className="modalHead"><div><p className="eyebrow">Tournament setup</p><h2 id="setup-title">Players & teams</h2></div><button aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div><label className="nameField">Tournament name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><fieldset className="formatPicker"><legend>Format</legend><button className={draft.format === "league" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "league" })}><b>League</b><small>Everyone plays everyone</small></button><button className={draft.format === "knockout" ? "selected" : ""} onClick={() => setDraft({ ...draft, format: "knockout" })}><b>Knockout</b><small>Lose and you’re out</small></button></fieldset><div className="playerEditor">{draft.players.map((p, i) => <div className="playerRow" key={p.id}><span>{i + 1}</span><input aria-label={`Player ${i + 1} name`} value={p.name} onChange={(e) => updatePlayer(p.id, "name", e.target.value)} /><input aria-label={`${p.name} team`} value={p.team} onChange={(e) => updatePlayer(p.id, "team", e.target.value)} /><button aria-label={`Remove ${p.name}`} disabled={draft.players.length <= 2} onClick={() => setDraft((d) => ({ ...d, players: d.players.filter((x) => x.id !== p.id) }))}>×</button></div>)}</div><button className="addButton" onClick={addPlayer}>＋ Add player</button><div className="warning">{draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length) ? "Knockout tournaments currently need 2, 4, 8 or 16 players." : "Generating fixtures will clear any existing scores."}</div><div className="modalActions"><button className="cancel" onClick={() => setShowSetup(false)}>Cancel</button><button className="primary" disabled={draft.players.some((p) => !p.name.trim()) || (draft.format === "knockout" && ![2,4,8,16].includes(draft.players.length))} onClick={regenerate}>Randomise & generate fixtures</button></div></section></div>}
  </main>;
}
