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

// If a character name is provided in the URL (?char=NAME), use it as the fixed character.
const urlChar = new URLSearchParams(window.location.search).get("char") ?? null;

// Hide the character selector when navigating from the gallery (char is fixed by URL)
if (urlChar && charSelect) charSelect.closest("label")?.remove();

populateSeasonSelect(seasonSelect, SEASON_COUNT);
seasonSelect.value = "alltime";

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

/**
 * Returns 1, 2, or 3 if charName is in the top-3 for the given stat
 * (higher = better), or null otherwise. Ties are treated inclusively
 * (e.g. if two chars share the top score, both get rank 1).
 */
function getStatRank(charName, stat, perChar) {
  const val = perChar.get(charName)?.[stat] ?? 0;
  if (!val) return null;
  let above = 0;
  for (const [name, s] of perChar) {
    if (name !== charName && (s[stat] ?? 0) > val) above++;
  }
  return above < 3 ? above + 1 : null;
}

function medalClass(rank) {
  if (rank === 1) return " medal-gold";
  if (rank === 2) return " medal-silver";
  if (rank === 3) return " medal-bronze";
  return "";
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

  const charName = (charSelect ? charSelect.value : null) ?? urlChar;
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

  // Best and worst win-rate opponents — require a minimum number of matches.
  // Season view: ≥3 matchups; All-time view: ≥5 matchups.
  const minMatchups = isAllTime ? 5 : 3;
  const faced = opponents.filter((o) => o.total >= minMatchups);
  const byWinRate = [...faced].sort((a, b) => (b.charWins / b.total) - (a.charWins / a.total));
  const bestWR = byWinRate[0] ?? null;
  const worstWR = byWinRate[byWinRate.length - 1] ?? null;

  // Medal ranks for wins and upsets across all characters
  const winsRank = getStatRank(charName, "wins", currentAgg.perChar);
  const upsetsRank = getStatRank(charName, "upsets", currentAgg.perChar);

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
          <div class="char-stat-block${medalClass(winsRank)}">
            <div class="char-stat-val">${stats.wins}${winsRank ? ` <span class="medal-label">${["🥇","🥈","🥉"][winsRank-1]}</span>` : ""}</div>
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
          <div class="char-stat-block${medalClass(upsetsRank)}">
            <div class="char-stat-val">${stats.upsets}${upsetsRank ? ` <span class="medal-label">${["🥇","🥈","🥉"][upsetsRank-1]}</span>` : ""}</div>
            <div class="char-stat-lbl">Upsets Pulled</div>
          </div>
          <div class="char-stat-block">
            <div class="char-stat-val">${stats.upsetLosses ?? 0}</div>
            <div class="char-stat-lbl">Times Upset</div>
          </div>
        </div>
      </div>
    </div>

    ${buildMatchupHighlightsCard(mostPlayed, bestWR, worstWR, charName, minMatchups)}
    ${buildNotFacedCard(notFaced)}
  `;
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
