"use client";

import { useEffect, useMemo, useState } from "react";

type Player = { id: string; name: string; team: string };
type Match = { id: string; round: number; homeId: string; awayId: string; homeScore: number | null; awayScore: number | null };
type Tournament = { name: string; players: Player[]; matches: Match[] };

const demoPlayers: Player[] = [
  { id: "p1", name: "Marcus", team: "Real Madrid" },
  { id: "p2", name: "Dre", team: "Barcelona" },
  { id: "p3", name: "Jay", team: "Liverpool" },
  { id: "p4", name: "Tobi", team: "Bayern" },
];

function makeFixtures(players: Player[]): Match[] {
  const ids: (string | null)[] = players.map((p) => p.id);
  if (ids.length % 2) ids.push(null);
  for (let i = ids.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(Math.random() * i);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const rounds: Match[] = [];
  let rotation = [...ids];
  for (let round = 1; round < ids.length; round++) {
    for (let i = 0; i < rotation.length / 2; i++) {
      const a = rotation[i];
      const b = rotation[rotation.length - 1 - i];
      if (a && b) {
        const swap = (round + i) % 2 === 0;
        rounds.push({ id: `${round}-${a}-${b}`, round, homeId: swap ? b : a, awayId: swap ? a : b, homeScore: null, awayScore: null });
      }
    }
    rotation = [rotation[0], rotation.at(-1)!, ...rotation.slice(1, -1)];
  }
  return rounds;
}

const initial: Tournament = { name: "Friday Night League", players: demoPlayers, matches: makeFixtures(demoPlayers) };

export default function Home() {
  const [data, setData] = useState<Tournament>(initial);
  const [draft, setDraft] = useState<Pick<Tournament, "name" | "players">>({ name: initial.name, players: initial.players });
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<"matches" | "table">("matches");
  const [round, setRound] = useState(1);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("fc-night-tournament");
    if (saved) { try { setData(JSON.parse(saved)); } catch {} }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem("fc-night-tournament", JSON.stringify(data)); }, [data, ready]);

  const playerById = (id: string) => data.players.find((p) => p.id === id);
  const maxRound = Math.max(1, ...data.matches.map((m) => m.round));
  const completed = data.matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length;
  const progress = data.matches.length ? Math.round((completed / data.matches.length) * 100) : 0;

  const table = useMemo(() => {
    const rows = data.players.map((p) => ({ ...p, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    data.matches.forEach((m) => {
      if (m.homeScore === null || m.awayScore === null) return;
      const h = byId[m.homeId], a = byId[m.awayId];
      if (!h || !a) return;
      h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += 3; }
      else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += 3; }
      else { h.d++; a.d++; h.pts++; a.pts++; }
    });
    rows.forEach((r) => r.gd = r.gf - r.ga);
    return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
  }, [data]);

  function updateScore(id: string, side: "homeScore" | "awayScore", value: string) {
    const score = value === "" ? null : Math.max(0, Math.min(99, Number(value)));
    setData((d) => ({ ...d, matches: d.matches.map((m) => m.id === id ? { ...m, [side]: score } : m) }));
  }

  function openSetup() {
    setDraft({ name: data.name, players: data.players.map((player) => ({ ...player })) });
    setShowSetup(true);
  }

  function regenerate() {
    setData({ name: draft.name.trim() || "Friday Night League", players: draft.players, matches: makeFixtures(draft.players) });
    setRound(1); setShowSetup(false); setTab("matches");
  }

  function addPlayer() {
    setDraft((d) => ({ ...d, players: [...d.players, { id: crypto.randomUUID(), name: `Player ${d.players.length + 1}`, team: "Choose club" }] }));
  }

  function updatePlayer(id: string, field: "name" | "team", value: string) {
    setDraft((d) => ({ ...d, players: d.players.map((p) => p.id === id ? { ...p, [field]: value } : p) }));
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#"><span className="brandMark" aria-hidden="true"><i>L</i><b>UT</b></span><span>LAGATA <em>ULTIMATE TEAM</em></span></a>
        <button className="ghostButton" onClick={openSetup}><span className="settingsGlyph" aria-hidden="true">•••</span><span>Manage tournament</span></button>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow"><span className="liveDot" /> Tournament in progress</p>
          <h1>{data.name}</h1>
          <p className="subline">{data.players.length} players <span>•</span> Round robin <span>•</span> 3 pts per win</p>
        </div>
        <div className="progressCard">
          <div className="progressTop"><span>Tournament progress</span><strong>{progress}%</strong></div>
          <div className="progressTrack"><i style={{ width: `${progress}%` }} /></div>
          <small>{completed} of {data.matches.length} matches played</small>
        </div>
      </section>

      <section className="content">
        <div className="tabs" role="tablist">
          <button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>Matches <b>{data.matches.length - completed}</b></button>
          <button className={tab === "table" ? "active" : ""} onClick={() => setTab("table")}>League table</button>
        </div>

        {tab === "matches" ? <>
          <div className="sectionHead">
            <div><p className="eyebrow">Fixtures</p><h2>Round {round} <span>of {maxRound}</span></h2></div>
            <div className="roundNav"><button aria-label="Previous round" disabled={round === 1} onClick={() => setRound((r) => r - 1)}>←</button><button aria-label="Next round" disabled={round === maxRound} onClick={() => setRound((r) => r + 1)}>→</button></div>
          </div>
          <div className="matchList">
            {data.matches.filter((m) => m.round === round).map((m) => {
              const h = playerById(m.homeId), a = playerById(m.awayId);
              if (!h || !a) return null;
              const played = m.homeScore !== null && m.awayScore !== null;
              return <article className="matchCard" key={m.id}>
                <div className="matchMeta"><span>{played ? "FINAL" : "UP NEXT"}</span><i /><small>Match {data.matches.indexOf(m) + 1}</small></div>
                <div className="matchup">
                  <div className="player home"><div><strong>{h.name}</strong><small>{h.team}</small></div><span className="avatar">{h.name.slice(0, 2).toUpperCase()}</span></div>
                  <div className="scoreBox">
                    <input aria-label={`${h.name} score`} inputMode="numeric" value={m.homeScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "homeScore", e.target.value)} />
                    <b>:</b>
                    <input aria-label={`${a.name} score`} inputMode="numeric" value={m.awayScore ?? ""} placeholder="–" onChange={(e) => updateScore(m.id, "awayScore", e.target.value)} />
                  </div>
                  <div className="player away"><span className="avatar alt">{a.name.slice(0, 2).toUpperCase()}</span><div><strong>{a.name}</strong><small>{a.team}</small></div></div>
                </div>
              </article>;
            })}
          </div>
          <p className="saveNote">✓ Scores save automatically on this device</p>
        </> : <>
          <div className="sectionHead"><div><p className="eyebrow">Standings</p><h2>League table</h2></div><p className="tieNote">Sorted by points, goal difference, then goals scored</p></div>
          <div className="tableWrap"><table><thead><tr><th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>
            {table.map((r, i) => <tr key={r.id}><td><span className={`rank rank${i + 1}`}>{i + 1}</span></td><td><strong>{r.name}</strong><small>{r.team}</small></td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gd > 0 ? "+" : ""}{r.gd}</td><td><b>{r.pts}</b></td></tr>)}
          </tbody></table></div>
        </>}
      </section>

      {showSetup && <div className="modalBack" onMouseDown={(e) => e.target === e.currentTarget && setShowSetup(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
          <div className="sheetHandle" aria-hidden="true" />
          <div className="modalHead"><div><p className="eyebrow">Tournament setup</p><h2 id="setup-title">Players & teams</h2></div><button aria-label="Close" onClick={() => setShowSetup(false)}>×</button></div>
          <label className="nameField">Tournament name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <div className="playerEditor">
            {draft.players.map((p, i) => <div className="playerRow" key={p.id}><span>{i + 1}</span><input aria-label={`Player ${i + 1} name`} value={p.name} onChange={(e) => updatePlayer(p.id, "name", e.target.value)} /><input aria-label={`${p.name} team`} value={p.team} onChange={(e) => updatePlayer(p.id, "team", e.target.value)} /><button aria-label={`Remove ${p.name}`} disabled={draft.players.length <= 2} onClick={() => setDraft((d) => ({ ...d, players: d.players.filter((x) => x.id !== p.id) }))}>×</button></div>)}
          </div>
          <button className="addButton" onClick={addPlayer}>＋ Add player</button>
          <div className="warning">Generating fixtures will clear any existing scores.</div>
          <div className="modalActions"><button className="cancel" onClick={() => setShowSetup(false)}>Cancel</button><button className="primary" disabled={draft.players.some((p) => !p.name.trim())} onClick={regenerate}>Randomise & generate fixtures</button></div>
        </section>
      </div>}
    </main>
  );
}
