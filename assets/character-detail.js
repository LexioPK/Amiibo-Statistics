import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
  pct,
  iconPath,
  portraitPath,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const charSelect = document.getElementById("charSelect");
const charDetail = document.getElementById("charDetail");
const statusEl = document.getElementById("status");

populateSeasonSelect(seasonSelect, SEASON_COUNT);

let currentCtx = null;
let currentAgg = null;
let isAllTime = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadSeason(season) {
  setStatus(`Loading season ${season}…`);
  isAllTime = false;
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
  const prev = charSelect.value;
  charSelect.innerHTML = "";
  for (const r of roster) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = `#${r.rank ?? "?"} ${r.name}`;
    charSelect.appendChild(opt);
  }
  if (roster.find((r) => r.name === prev)) charSelect.value = prev;
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

function renderCharDetail() {
  if (!currentCtx || !currentAgg) return;

  const charName = charSelect.value;
  if (!charName) {
    charDetail.innerHTML = "<p class='muted'>Select a character above.</p>";
    return;
  }

  const rosterEntry = currentCtx.roster.find((r) => r.name === charName);
  const stats = currentAgg.perChar.get(charName) ?? {
    matches: 0, wins: 0, losses: 0, upsets: 0, upsetLosses: 0, elo: rosterEntry?.elo ?? null, expectedWins: 0,
  };

  const winRate = pct(stats.wins, stats.matches);
  const opponents = buildOpponentStats(charName, currentAgg.h2h);

  // Most played opponent
  const mostPlayed = opponents.length
    ? opponents.reduce((best, o) => (o.total > best.total ? o : best))
    : null;

  // Best and worst win-rate opponents (must have at least 1 match)
  const faced = opponents.filter((o) => o.total > 0);
  const byWinRate = [...faced].sort((a, b) => (b.charWins / b.total) - (a.charWins / a.total));
  const bestWR = byWinRate[0] ?? null;
  const worstWR = byWinRate[byWinRate.length - 1] ?? null;

  // Players not yet faced
  const facedNames = new Set(opponents.map((o) => o.opponent));
  const notFaced = currentCtx.roster.filter((r) => r.name !== charName && !facedNames.has(r.name));

  charDetail.innerHTML = `
    <div class="char-detail-header card">
      <img class="char-portrait" src="${portraitPath(charName)}" alt="${charName}" onerror="this.style.display='none'">
      <div class="char-detail-info">
        <div class="char-detail-name">${charName}</div>
        <div class="char-detail-rank muted">${rosterEntry ? `Rank #${rosterEntry.rank ?? "?"} · ${rosterEntry.elo} Elo` : ""}</div>
        <div class="char-detail-stats-grid">
          <div class="char-stat-block">
            <div class="char-stat-val">${winRate}</div>
            <div class="char-stat-lbl">Win Rate</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.wins}</div>
            <div class="char-stat-lbl">Wins</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.losses}</div>
            <div class="char-stat-lbl">Losses</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.matches}</div>
            <div class="char-stat-lbl">Matches</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.upsets}</div>
            <div class="char-stat-lbl">Upsets Pulled</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.upsetLosses ?? 0}</div>
            <div class="char-stat-lbl">Times Upset</div>
          </div>
        </div>
      </div>
    </div>

    ${buildMatchupCard("Most Played Opponent", mostPlayed ? [mostPlayed] : [], charName)}
    ${buildMatchupCard("Best Win Rate vs.", bestWR ? [bestWR] : [], charName)}
    ${buildMatchupCard("Worst Win Rate vs.", worstWR ? [worstWR] : [], charName)}
    ${buildNotFacedCard(notFaced)}
  `;
}

function buildMatchupCard(title, entries, charName) {
  if (entries.length === 0) {
    return `<div class="card"><h2>${title}</h2><p class="muted">No data available.</p></div>`;
  }
  const rows = entries.map((o) => {
    const wr = pct(o.charWins, o.total);
    return `
      <div class="matchup-row">
        <span class="char-name-wrap">
          ${o.opponent}
          <img class="char-icon" src="${iconPath(o.opponent)}" alt="" onerror="this.style.display='none'">
        </span>
        <span class="matchup-record">${o.charWins}–${o.oppWins} (${wr}) · ${o.total} match${o.total !== 1 ? "es" : ""}</span>
      </div>
    `;
  }).join("");
  return `<div class="card"><h2>${title}</h2>${rows}</div>`;
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

charSelect.addEventListener("change", renderCharDetail);

loadSeason(SEASON_COUNT);
