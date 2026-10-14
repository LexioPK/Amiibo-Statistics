import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadTournamentIndex,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
  pct,
  iconPath,
  portraitPath,
  canonKey,
} from "./lib.js";
import { getSeasonTimeline, getAllTimeRatings, getAllTimeRatingsBeforeTournament } from "./rating-engine.js";

const seasonSelect = document.getElementById("seasonSelect");
const charSelect = document.getElementById("charSelect");
const charDetail = document.getElementById("charDetail");
const statusEl = document.getElementById("status");

// If a character name is provided in the URL (?char=NAME), use it as the fixed character.
const urlChar = new URLSearchParams(window.location.search).get("char") ?? null;

// Hide the character selector when navigating from the gallery (char is fixed by URL)
if (urlChar && charSelect) charSelect.closest("label")?.remove();

populateSeasonSelect(seasonSelect, SEASON_COUNT);
seasonSelect.value = "alltime";

let currentCtx = null;
let currentAgg = null;
let isAllTime = false;
let currentSeasonNum = SEASON_COUNT;
let renderToken = 0;

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadSeason(season) {
  setStatus(`Loading season ${season}…`);
  isAllTime = false;
  currentSeasonNum = season;
  charDetail.innerHTML = "";
  try {
    currentCtx = await loadSeasonRoster(season);
    currentAgg = await loadAndAggregateAllTournaments(season, currentCtx);
    populateCharSelect(currentCtx.roster);
    renderCharDetail();
    setStatus("Loaded.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

async function loadAllTime() {
  setStatus("Loading all seasons…");
  isAllTime = true;
  charDetail.innerHTML = "";
  try {
    currentCtx = await loadAllTimesRoster();
    currentAgg = await loadAllSeasonsData(SEASON_COUNT);
    populateCharSelect(currentCtx.roster);
    renderCharDetail();
    setStatus("Loaded.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── Populate character select ─────────────────────────────────────────────────

function populateCharSelect(roster) {
  if (!charSelect) return;
  const prev = urlChar ?? charSelect.value;
  charSelect.innerHTML = "";
  for (const r of roster) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = `#${r.rank ?? "?"} ${r.name}`;
    charSelect.appendChild(opt);
  }
  if (roster.find((r) => r.name === prev)) charSelect.value = prev;
}

// ── Medal helpers ─────────────────────────────────────────────────────────────

// ── Placement helpers ─────────────────────────────────────────────────────────

const PLACEMENT_BUCKETS = [
  { label: "1st 🥇", max: 1 },
  { label: "2nd 🥈", max: 2 },
  { label: "3rd 🥉", max: 3 },
  { label: "Top 8",  max: 8 },
  { label: "Top 16", max: 16 },
  { label: "Top 24", max: 24 },
  { label: "Top 32", max: 32 },
  { label: "Top 48", max: 48 },
  { label: "Top 64", max: 64 },
  { label: "Top 96", max: 96 },
];

function placementBucket(topN) {
  for (const b of PLACEMENT_BUCKETS) {
    if (topN <= b.max) return b.label;
  }
  return null;
}

/**
 * Derives a character's final placement in one tournament from its processed
 * sections.  Placement is determined by:
 *   1st / 2nd  — Grand Finals result (Set 2 takes priority over Set 1 when
 *                both have a recorded result; Set 1 is used when Set 2 is
 *                absent or has no scored matches).
 *   3rd–Top N  — The losers-bracket section with the lowest topN where the
 *                character appears as the loser (i.e., the round that
 *                eliminated them).
 * Returns the numeric placement (1, 2, or the section's topN), or null when
 * not enough data exists (e.g. round-robin pools without topN values).
 */
function derivePlacement(sections, charName) {
  const isGF   = (s) => /grand\s*final/i.test(s.name);
  const isSet2 = (s) => /set\s*2/i.test(s.name);
  const isSet1 = (s) => /set\s*1/i.test(s.name);

  const gfSections = sections.filter(isGF);
  // Prioritise Set 2 (bracket reset), then Set 1, then any other GF label
  const gfOrdered = [
    ...gfSections.filter(isSet2),
    ...gfSections.filter(isSet1),
    ...gfSections.filter((s) => !isSet1(s) && !isSet2(s)),
  ];

  for (const s of gfOrdered) {
    for (const m of s.matches) {
      if (m.winner === charName) return 1;
      if (m.loser  === charName) return 2;
    }
  }

  // Losers-bracket sections sorted best-placement first (lowest topN first)
  const losersSecs = sections
    .filter((s) => /^losers/i.test(s.name) && s.topN != null)
    .sort((a, b) => a.topN - b.topN);

  for (const s of losersSecs) {
    for (const m of s.matches) {
      if (m.loser === charName) return s.topN;
    }
  }

  return null;
}

function buildPlacementsCard(tournamentResults, charName) {
  const counts = new Map();
  let totalTournaments = 0;

  for (const { result } of tournamentResults) {
    // Count participation: character appeared in at least one match
    const participated = result.matches.some(
      (m) => m.winner === charName || m.loser === charName,
    );
    if (participated) totalTournaments++;

    const placement = derivePlacement(result.sections, charName);
    if (placement == null) continue;
    const bucket = placementBucket(placement);
    if (!bucket) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return `<div class="card placements-card"><h2>Placements</h2><p class="muted">No placement data available.</p></div>`;
  }

  const rows = PLACEMENT_BUCKETS
    .filter((b) => counts.has(b.label))
    .map((b) => {
      const n = counts.get(b.label);
      const pctStr = totalTournaments > 0
        ? ` <span class="placement-pct">(${(n / totalTournaments * 100).toFixed(1)}%)</span>`
        : "";
      return `
      <div class="placement-row">
        <span class="placement-label">${b.label}</span>
        <span class="placement-count">${n}${pctStr}</span>
      </div>`;
    })
    .join("");

  const totalNote = totalTournaments > 0
    ? `<p class="muted placement-total">of ${totalTournaments} tournament${totalTournaments !== 1 ? "s" : ""}</p>`
    : "";

  return `<div class="card placements-card"><h2>Placements</h2><div class="placement-list">${rows}</div>${totalNote}</div>`;
}

/** 1-based rank (ties share a rank) of charName for a numeric stat getter, or null if not eligible. */
function rankBy(charName, perChar, getter) {
  const mine = getter(perChar.get(charName));
  if (mine == null) return null;
  let above = 0;
  for (const [name, st] of perChar) {
    if (name === charName) continue;
    const v = getter(st);
    if (v != null && v > mine) above++;
  }
  return above + 1;
}

function medalClass(rank) {
  if (rank === 1) return " medal-gold";
  if (rank === 2) return " medal-silver";
  if (rank === 3) return " medal-bronze";
  return "";
}

function statBlock(value, label, rank) {
  return `
          <div class="char-stat-block${medalClass(rank)}">
            ${rank ? `<span class="stat-rank">#${rank}</span>` : ""}
            <div class="char-stat-val">${value}</div>
            <div class="char-stat-lbl">${label}</div>
          </div>`;
}

// ── Build per-opponent matchup data from h2h map ──────────────────────────────

function buildOpponentStats(charName, h2hMap) {
  const opponents = [];
  for (const [, row] of h2hMap) {
    if (row.a !== charName && row.b !== charName) continue;
    const isA = row.a === charName;
    const opponent = isA ? row.b : row.a;
    const charWins = isA ? row.aWins : row.bWins;
    const oppWins = isA ? row.bWins : row.aWins;
    const total = row.matches;
    opponents.push({ opponent, charWins, oppWins, total });
  }
  return opponents;
}

// ── Render ────────────────────────────────────────────────────────────────────

async function renderCharDetail() {
  if (!currentCtx || !currentAgg) return;
  const token = ++renderToken;

  const charName = (charSelect ? charSelect.value : null) ?? urlChar;
  if (!charName) {
    charDetail.innerHTML = "<p class='muted'>Select a character above.</p>";
    return;
  }

  const rosterEntry = currentCtx.roster.find((r) => r.name === charName);
  const stats = currentAgg.perChar.get(charName) ?? {
    matches: 0, wins: 0, losses: 0, upsets: 0, upsetLosses: 0, elo: rosterEntry?.elo ?? null,
  };

  const winRate = pct(stats.wins, stats.matches);
  const opponents = buildOpponentStats(charName, currentAgg.h2h);

  // Most played opponent
  const mostPlayed = opponents.length
    ? opponents.reduce((best, o) => (o.total > best.total ? o : best))
    : null;

  // Best and worst win-rate opponents — require a minimum number of matches.
  // Season view: ≥3 matchups; All-time view: ≥5 matchups.
  const minMatchups = isAllTime ? 5 : 3;
  const faced = opponents.filter((o) => o.total >= minMatchups);
  const byWinRate = [...faced].sort((a, b) => (b.charWins / b.total) - (a.charWins / a.total));
  const bestWR = byWinRate[0] ?? null;
  const worstWR = byWinRate[byWinRate.length - 1] ?? null;

  // Medal ranks for wins and upsets across all characters
  const pc = currentAgg.perChar;
  const hasData = pc.has(charName);
  const rk = (g) => (hasData ? rankBy(charName, pc, g) : null);
  const winsRank    = rk((s) => s.wins);
  const lossesRank  = rk((s) => s.losses);
  const upsetsRank  = rk((s) => s.upsets);
  const upsetLossesRank = rk((s) => s.upsetLosses ?? 0);
  const matchesRank = rk((s) => s.matches);
  const winRateRank = rk((s) => (s && s.matches > 0 ? s.wins / s.matches : null));

  const chartData = await buildChartData(charName);
  if (token !== renderToken) return;

  // Players not yet faced
  const facedNames = new Set(opponents.map((o) => o.opponent));
  const notFaced = currentCtx.roster.filter((r) => r.name !== charName && !facedNames.has(r.name));

  charDetail.innerHTML = `
    <div class="char-detail-header card">
      <img class="char-portrait" src="${portraitPath(charName)}" alt="${charName}" onerror="this.style.display='none'">
      <div class="char-detail-info">
        <div class="char-detail-name">${charName}${rosterEntry ? ` <span class="char-detail-rank-num">#${rosterEntry.rank ?? "?"}</span>` : ""}</div>
        <div class="char-detail-rank muted">${rosterEntry ? `${rosterEntry.elo} Rating${rosterEntry.rd != null ? ` (RD ${rosterEntry.rd})` : ""}` : ""}</div>
        <div class="char-detail-stats-grid">
${statBlock(winRate, "Win Rate", winRateRank)}${statBlock(stats.wins, "Wins", winsRank)}${statBlock(stats.losses, "Losses", lossesRank)}${statBlock(stats.matches, "Matches", matchesRank)}${statBlock(stats.upsets, "Upsets Pulled", upsetsRank)}${statBlock(stats.upsetLosses ?? 0, "Times Upset", upsetLossesRank)}
        </div>
      </div>
    </div>

    <div class="card-row">
      ${buildRatingChartCard(chartData)}
      ${buildRecentTournamentsCard(currentAgg.tournamentResults, charName)}
    </div>
    <div class="card-row">
      <div class="card-col">
        ${buildMatchupHighlightsCard(mostPlayed, bestWR, worstWR, charName, minMatchups)}
        ${isAllTime ? buildNotFacedCard(notFaced) : ""}
      </div>
      ${buildPlacementsCard(currentAgg.tournamentResults, charName)}
    </div>
    ${buildCharNav(charName)}
  `;
}

// ── Rating chart + recent tournaments ─────────────────────────────────────────

function buildCharNav(charName) {
  const roster = currentCtx.roster;
  const i = roster.findIndex((r) => r.name === charName);
  if (i < 0 || roster.length < 2) return "";
  const prev = roster[(i - 1 + roster.length) % roster.length];
  const next = roster[(i + 1) % roster.length];
  const btn = (r, cls, label) => `
    <a class="char-nav-btn ${cls}" href="./character.html?char=${encodeURIComponent(r.name)}">
      ${cls === "prev" ? `<span>←</span>` : ""}
      <img class="char-icon" src="${iconPath(r.name)}" alt="" onerror="this.style.display='none'">
      <span>${label}: ${r.name}</span>
      ${cls === "next" ? `<span>→</span>` : ""}
    </a>`;
  return `<div class="char-nav">${btn(prev, "prev", "Previous")}${btn(next, "next", "Next")}</div>`;
}

async function buildAllTimeChartData(charName) {
  const key = canonKey(charName);
  const pts = [];
  for (let season = 1; season <= SEASON_COUNT; season++) {
    let files = [];
    try { files = (await loadTournamentIndex(season)).tournaments ?? []; } catch { continue; }
    for (const file of files) {
      const rows = await getAllTimeRatingsBeforeTournament(season, file);
      const row = rows.find((r) => canonKey(r.name) === key);
      if (row) pts.push({ label: `S${season} — ${file.replace(/\.txt$/i, "")}`, rating: row.rating });
    }
  }
  if (!pts.length) return null;
  const final = (await getAllTimeRatings()).find((r) => canonKey(r.name) === key);
  if (final) pts.push({ label: "Current", rating: final.rating });
  return { season: null, points: pts };
}

async function buildChartData(charName) {
  if (isAllTime) {
    try { return await buildAllTimeChartData(charName); } catch (e) { console.warn(e); return null; }
  }
  const key = canonKey(charName);
  let seasons = isAllTime
    ? Array.from({ length: SEASON_COUNT }, (_, i) => SEASON_COUNT - i)
    : [currentSeasonNum];
  for (const season of seasons) {
    try {
      const { initialRating, points } = await getSeasonTimeline(season);
      const pts = [{ label: "Start", rating: initialRating }];
      let played = false;
      for (const p of points) {
        const r = p.ratings.get(key);
        if (r) {
          played = true;
          pts.push({ label: p.file.replace(/\.txt$/i, ""), rating: r.rating });
        }
      }
      if (played) return { season, points: pts };
    } catch (e) {
      console.warn(e);
    }
  }
  return null;
}

function buildRatingChartCard(data) {
  if (!data || data.points.length < 2) {
    return `<div class="card rating-chart-card"><h2>Rating Over the Season</h2><p class="muted">No rating data available.</p></div>`;
  }
  const W = 560, H = 220, L = 40, R = 14, T = 12, B = 26;
  const ys = data.points.map((p) => p.rating);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (max - min < 40) { min -= 20; max += 20; }
  const pad = (max - min) * 0.1;
  min -= pad; max += pad;
  const n = data.points.length;
  const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const path = data.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="chart-grid"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="chart-axis" text-anchor="end">${Math.round(v)}</text>`;
  }
  const dots = data.points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.rating).toFixed(1)}" r="${n > 40 ? 2 : 3.5}" class="chart-dot"><title>${p.label}: ${Math.round(p.rating)}</title></circle>`).join("");
  const last = data.points[n - 1];
  return `
    <div class="card rating-chart-card">
      <h2>${data.season == null ? "Rating Over All Tournaments" : `Rating Over Season ${data.season}`}</h2>
      <svg class="rating-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Rating over the season">
        ${grid}
        <path d="${path}" class="chart-line"/>
        ${dots}
        <text x="${W - R}" y="${H - 6}" class="chart-axis" text-anchor="end">Latest: ${Math.round(last.rating)} · ${data.season == null ? n - 1 : n - 1} tournament${n - 1 !== 1 ? "s" : ""}</text>
      </svg>
    </div>`;
}

function placementText(p) {
  if (p == null) return "—";
  const b = placementBucket(p);
  return b ? b.replace(/\s*[\u{1F300}-\u{1FAFF}]/u, "") : "—";
}

function buildRecentTournamentsCard(tournamentResults, charName) {
  const rows = [];
  for (const { name, result } of tournamentResults) {
    let w = 0, l = 0;
    for (const m of result.matches) {
      if (m.winner === charName) w++;
      else if (m.loser === charName) l++;
    }
    if (w + l === 0) continue;
    rows.push({ name: name.replace(/^S\d+\s*[—–-]\s*/, ""), w, l, placement: derivePlacement(result.sections, charName) });
  }
  const last5 = rows.slice(-5).reverse();
  if (!last5.length) {
    return `<div class="card recent-card"><h2>Last 5 Tournaments</h2><p class="muted">No tournament data.</p></div>`;
  }
  const items = last5.map((r) => `
      <div class="recent-row">
        <span class="recent-name" title="${r.name}">${r.name}</span>
        <span class="recent-place">${placementText(r.placement)}</span>
        <span class="recent-record">${r.w}-${r.l}</span>
      </div>`).join("");
  return `<div class="card recent-card"><h2>Last 5 Tournaments</h2>${items}</div>`;
}

function buildMatchupHighlightsCard(mostPlayed, bestWR, worstWR, charName, minMatchups) {
  function matchupRow(label, o) {
    if (!o) {
      return `
        <div class="matchup-highlight-row">
          <span class="matchup-highlight-label">${label}</span>
          <span class="muted">No opponents with ${minMatchups}+ matches.</span>
        </div>`;
    }
    const wr = pct(o.charWins, o.total);
    return `
      <div class="matchup-highlight-row">
        <span class="matchup-highlight-label">${label}</span>
        <span class="char-name-wrap">
          <img class="char-icon" src="${iconPath(o.opponent)}" alt="" onerror="this.style.display='none'">
          ${o.opponent}
        </span>
        <span class="matchup-record">${o.charWins}–${o.oppWins} (${wr}) · ${o.total} match${o.total !== 1 ? "es" : ""}</span>
      </div>`;
  }

  const hasMostPlayed = !!mostPlayed;
  const hasBest = !!bestWR;
  const hasWorst = !!worstWR;
  const noData = !hasMostPlayed && !hasBest && !hasWorst;

  if (noData) {
    return `<div class="card"><h2>Matchup Highlights</h2><p class="muted">No matchup data available.</p></div>`;
  }

  return `
    <div class="card">
      <h2>Matchup Highlights</h2>
      ${matchupRow("Most Played", mostPlayed)}
      ${matchupRow(`Best Win Rate <span class="muted" style="font-weight:400;font-size:0.8em;">(min ${minMatchups} matches)</span>`, bestWR)}
      ${matchupRow(`Worst Win Rate <span class="muted" style="font-weight:400;font-size:0.8em;">(min ${minMatchups} matches)</span>`, worstWR)}
    </div>`;
}

function buildNotFacedCard(notFaced) {
  if (notFaced.length === 0) {
    return `<div class="card"><h2>Players Not Yet Faced</h2><p class="muted">Has faced everyone on the roster!</p></div>`;
  }
  const chips = notFaced.map((r) => `
    <span class="not-faced-chip">
      <img class="char-icon" src="${iconPath(r.name)}" alt="" onerror="this.style.display='none'">
      ${r.name}
    </span>
  `).join("");
  return `<div class="card"><h2>Players Not Yet Faced</h2><div class="not-faced-list">${chips}</div></div>`;
}

// ── Event listeners ───────────────────────────────────────────────────────────

seasonSelect.addEventListener("change", () => {
  const val = seasonSelect.value;
  if (val === "alltime") loadAllTime();
  else loadSeason(Number(val));
});

if (charSelect) charSelect.addEventListener("change", renderCharDetail);

loadAllTime();
