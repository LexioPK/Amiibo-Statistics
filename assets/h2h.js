import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const charASelect = document.getElementById("charA");
const charBSelect = document.getElementById("charB");
const h2hResult = document.getElementById("h2hResult");
const statusEl = document.getElementById("status");

populateSeasonSelect(seasonSelect, SEASON_COUNT);

let currentCtx = null;
let currentAgg = null;
let currentSeason = SEASON_COUNT;
let isAllTime = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Original per-season function (unchanged) ──────────────────────────────────

async function loadSeason(season) {
  setStatus(`Loading season ${season}…`);
  currentSeason = season;
  isAllTime = false;
  h2hResult.innerHTML = "";
  try {
    currentCtx = await loadSeasonRoster(season);
    currentAgg = await loadAndAggregateAllTournaments(season, currentCtx);
    populateCharSelects(currentCtx.roster);
    renderH2H();
    setStatus("Loaded.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── All Time function ─────────────────────────────────────────────────────────

async function loadSeasonAllTime() {
  setStatus("Loading all seasons…");
  isAllTime = true;
  h2hResult.innerHTML = "";
  try {
    currentCtx = await loadAllTimesRoster();
    const all = await loadAllSeasonsData(SEASON_COUNT);
    // Use the all-time roster for display but all-time h2h/tournament data for stats
    currentAgg = all;
    populateCharSelects(currentCtx.roster);
    renderH2H();
    setStatus("Loaded.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function populateCharSelects(roster) {
  const prevA = charASelect.value;
  const prevB = charBSelect.value;

  charASelect.innerHTML = "";
  charBSelect.innerHTML = "";

  for (const r of roster) {
    for (const sel of [charASelect, charBSelect]) {
      const opt = document.createElement("option");
      opt.value = r.name;
      opt.textContent = `#${r.rank ?? "?"} ${r.name}`;
      sel.appendChild(opt);
    }
  }

  // Restore previous selections when possible
  if (roster.find((r) => r.name === prevA)) charASelect.value = prevA;
  if (roster.find((r) => r.name === prevB)) {
    charBSelect.value = prevB;
  } else if (roster.length > 1) {
    charBSelect.selectedIndex = 1;
  }
}

function renderH2H() {
  if (!currentCtx || !currentAgg) return;

  const aName = charASelect.value;
  const bName = charBSelect.value;

  if (!aName || !bName) {
    h2hResult.innerHTML = "<p class='muted'>Select two characters above.</p>";
    return;
  }

  if (aName === bName) {
    h2hResult.innerHTML = "<p class='muted'>Select two <em>different</em> characters.</p>";
    return;
  }

  const aRoster = currentCtx.roster.find((r) => r.name === aName);
  const bRoster = currentCtx.roster.find((r) => r.name === bName);

  // Find h2h record
  const x = aName < bName ? aName : bName;
  const y = aName < bName ? bName : aName;
  const h2hKey = `${x}__${y}`;
  const record = currentAgg.h2h.get(h2hKey);

  let aWins = 0, bWins = 0, total = 0;
  if (record) {
    total = record.matches;
    aWins = aName === record.a ? record.aWins : record.bWins;
    bWins = aName === record.a ? record.bWins : record.aWins;
  }

  const rankDiff = (aRoster?.rank ?? 0) - (bRoster?.rank ?? 0);
  const eloDiff = (aRoster?.elo ?? 0) - (bRoster?.elo ?? 0);

  const seasonWinner =
    aWins > bWins ? aName :
    bWins > aWins ? bName :
    null;

  const aWinClass = aWins > bWins ? "h2h-leader" : "";
  const bWinClass = bWins > aWins ? "h2h-leader" : "";

  const seasonLabel = isAllTime ? "All Time" : `Season ${currentSeason}`;
  const matchList = buildMatchList(aName, bName);

  h2hResult.innerHTML = `
    <div class="h2h-overview">
      <div class="h2h-side ${aWinClass}">
        <div class="h2h-rank">#${aRoster?.rank ?? "?"}</div>
        <div class="h2h-name">${aName}</div>
        <div class="h2h-elo">${aRoster?.elo ?? "?"} Elo</div>
        <div class="h2h-wins-big">${aWins}</div>
        <div class="h2h-wins-label">win${aWins !== 1 ? "s" : ""}</div>
      </div>

      <div class="h2h-center">
        <div class="h2h-vs">VS</div>
        <div class="h2h-total">${total} match${total !== 1 ? "es" : ""} in ${seasonLabel}</div>
        ${seasonWinner
          ? `<div class="h2h-verdict">${isAllTime ? "" : "Season "}winner: <strong>${seasonWinner}</strong></div>`
          : total > 0
            ? `<div class="h2h-verdict">Even series</div>`
            : `<div class="muted">No matches recorded</div>`
        }
        <div class="h2h-diff-row">
          <span>Rank diff: <b>${rankDiff > 0 ? "+" : ""}${rankDiff}</b></span>
          <span>Elo diff: <b>${eloDiff > 0 ? "+" : ""}${eloDiff}</b></span>
        </div>
      </div>

      <div class="h2h-side ${bWinClass}">
        <div class="h2h-rank">#${bRoster?.rank ?? "?"}</div>
        <div class="h2h-name">${bName}</div>
        <div class="h2h-elo">${bRoster?.elo ?? "?"} Elo</div>
        <div class="h2h-wins-big">${bWins}</div>
        <div class="h2h-wins-label">win${bWins !== 1 ? "s" : ""}</div>
      </div>
    </div>
    ${matchList}
  `;
}

function buildMatchList(aName, bName) {
  const rows = [];
  for (const { name: tName, result } of currentAgg.tournamentResults) {
    for (const m of result.matches) {
      if (
        (m.winner === aName && m.loser === bName) ||
        (m.winner === bName && m.loser === aName)
      ) {
        rows.push({ tournament: tName, ...m });
      }
    }
  }

  const seasonLabel = isAllTime ? "All Time" : `Season ${currentSeason}`;

  if (rows.length === 0) {
    return `<p class="muted" style="margin-top:1.5rem">No recorded matches between these two in ${seasonLabel}.</p>`;
  }

  let html = `
    <h3 style="margin-top:1.5rem;margin-bottom:0.5rem">Match history</h3>
    <div class="tableWrap">
    <table>
      <thead><tr>
        <th>Tournament</th>
        <th>Winner</th>
        <th>Score</th>
        <th>Loser</th>
        <th>Upset?</th>
      </tr></thead>
      <tbody>
  `;
  for (const m of rows) {
    html += `<tr${m.isUpset ? ' class="upset-row"' : ""}>
      <td>${m.tournament}</td>
      <td class="winner-cell">${m.winner}</td>
      <td class="score-cell">${m.winnerScore} – ${m.loserScore}</td>
      <td>${m.loser}</td>
      <td>${m.isUpset ? "⚡ Upset" : ""}</td>
    </tr>`;
  }
  html += "</tbody></table></div>";
  return html;
}

// ── Event listeners ───────────────────────────────────────────────────────────

seasonSelect.addEventListener("change", () => {
  const val = seasonSelect.value;
  if (val === "alltime") loadSeasonAllTime();
  else loadSeason(Number(val));
});

charASelect.addEventListener("change", renderH2H);
charBSelect.addEventListener("change", renderH2H);

loadSeason(SEASON_COUNT);
