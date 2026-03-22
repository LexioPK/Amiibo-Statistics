import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadTournamentIndex,
  loadTournamentText,
  computeTournamentResults,
  populateSeasonSelect,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const tournamentSelect = document.getElementById("tournamentSelect");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const matchesBody = document.querySelector("#matchesTable tbody");

let seasonCtx = null;
let currentSeason = SEASON_COUNT;

populateSeasonSelect(seasonSelect, SEASON_COUNT);

function setStatus(msg) {
  statusEl.textContent = msg;
}

function clearResults() {
  summaryEl.innerHTML = "";
  matchesBody.innerHTML = "";
}

async function loadSeason(season) {
  setStatus(`Loading season ${season}…`);
  currentSeason = season;
  clearResults();
  try {
    seasonCtx = await loadSeasonRoster(season);
    const idx = await loadTournamentIndex(season);
    const files = idx.tournaments ?? [];

    tournamentSelect.innerHTML = "";
    if (files.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No tournaments";
      tournamentSelect.appendChild(opt);
      setStatus("No tournaments found for this season.");
      return;
    }

    for (const f of files) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f.replace(/\.txt$/i, "");
      tournamentSelect.appendChild(opt);
    }

    await loadTournament(season, files[0]);
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

async function loadTournament(season, filename) {
  if (!filename) return;
  setStatus(`Loading ${filename.replace(/\.txt$/i, "")}…`);
  clearResults();
  try {
    const text = await loadTournamentText(season, filename);
    const state = computeTournamentResults(text, seasonCtx);
    renderResults(state);
    setStatus("Loaded.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

function renderResults(state) {
  // Summary pills
  summaryEl.innerHTML = "";
  const pills = [
    ["Matches", state.matchesCounted],
    ["Upsets", state.totalUpsets],
    ["Byes Ignored", state.matchesIgnoredBye],
    ["Skipped (no score)", state.matchesSkippedNoScore],
  ];
  for (const [label, val] of pills) {
    const div = document.createElement("div");
    div.className = "pill";
    div.innerHTML = `<div class="pill-label">${label}</div><div class="pill-val">${val}</div>`;
    summaryEl.appendChild(div);
  }
  if (state.unknownNames.length) {
    const div = document.createElement("div");
    div.className = "pill pill-warn";
    div.innerHTML = `<div class="pill-label">Unknown names</div><div class="pill-val">${state.unknownNames.join(", ")}</div>`;
    summaryEl.appendChild(div);
  }

  // Match results table
  matchesBody.innerHTML = "";
  let num = 0;
  for (const m of state.matches) {
    num++;
    const tr = document.createElement("tr");
    if (m.isUpset) tr.classList.add("upset-row");
    tr.innerHTML = `
      <td>${num}</td>
      <td class="winner-cell">${m.winner}</td>
      <td class="score-cell">${m.winnerScore} – ${m.loserScore}</td>
      <td>${m.loser}</td>
      <td>${m.isUpset ? "⚡ Upset" : ""}</td>
    `;
    matchesBody.appendChild(tr);
  }
}

seasonSelect.addEventListener("change", () => loadSeason(Number(seasonSelect.value)));
tournamentSelect.addEventListener("change", () => {
  if (seasonCtx) loadTournament(currentSeason, tournamentSelect.value);
});

loadSeason(SEASON_COUNT);
