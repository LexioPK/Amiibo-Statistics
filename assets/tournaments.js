import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadTournamentIndex,
  loadTournamentText,
  computeTournamentResults,
  populateSeasonSelect,
  iconPath,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const tournamentSelect = document.getElementById("tournamentSelect");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const matchesBody = document.querySelector("#matchesTable tbody");

let currentSeason = SEASON_COUNT;

populateSeasonSelect(seasonSelect, SEASON_COUNT);

function setStatus(msg) { statusEl.textContent = msg; }
function clearResults() { summaryEl.innerHTML = ""; matchesBody.innerHTML = ""; }

/**
 * Parse a tournament option value into { season, filename }.
 * All-Time options are encoded as "7:March Madness.txt".
 * Per-season options are just "March Madness.txt".
 */
function parseTournamentOption(val) {
  const colon = val.indexOf(":");
  if (colon !== -1) {
    return { season: Number(val.slice(0, colon)), filename: val.slice(colon + 1) };
  }
  return { season: currentSeason, filename: val };
}

async function loadSeason(seasonVal) {
  clearResults();
  tournamentSelect.innerHTML = "";

  if (seasonVal === "alltime") {
    setStatus("Loading all tournaments…");
    let found = false;
    for (let s = SEASON_COUNT; s >= 1; s--) {
      try {
        const idx = await loadTournamentIndex(s);
        for (const f of idx.tournaments ?? []) {
          const opt = document.createElement("option");
          opt.value = `${s}:${f}`;
          opt.textContent = `S${s} — ${f.replace(/\.txt$/i, "")}`;
          tournamentSelect.appendChild(opt);
          found = true;
        }
      } catch (e) {
        console.warn(`Season ${s} index:`, e.message);
      }
    }
    if (!found) { setStatus("No tournaments found."); return; }
    const { season, filename } = parseTournamentOption(tournamentSelect.value);
    await loadTournament(season, filename);
    return;
  }

  currentSeason = Number(seasonVal);
  setStatus(`Loading season ${currentSeason}…`);
  try {
    const idx = await loadTournamentIndex(currentSeason);
    const files = idx.tournaments ?? [];
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
    await loadTournament(currentSeason, files[0]);
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
    // Always load the correct season's roster for name resolution
    const ctx = await loadSeasonRoster(season);
    const text = await loadTournamentText(season, filename);
    const state = computeTournamentResults(text, ctx);
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

  // Match results grouped by section
  matchesBody.innerHTML = "";
  let globalNum = 0;

  for (const section of state.sections) {
    if (section.matches.length === 0) continue;

    // Section header row
    const hdr = document.createElement("tr");
    hdr.className = "section-header-row";
    const label = section.topN
      ? `${section.name} — Top ${section.topN}`
      : section.name;
    hdr.innerHTML = `<td colspan="5" class="section-header-cell">${label}</td>`;
    matchesBody.appendChild(hdr);

    // Match rows
    for (const m of section.matches) {
      globalNum++;
      const tr = document.createElement("tr");
      if (m.isUpset) tr.classList.add("upset-row");
      tr.innerHTML = `
        <td>${globalNum}</td>
        <td class="winner-cell"><span class="char-name-wrap">${m.winner}<img class="char-icon" src="${iconPath(m.winner)}" alt="" onerror="this.style.display='none'"></span></td>
        <td class="score-cell">${m.winnerScore} – ${m.loserScore}</td>
        <td><span class="char-name-wrap">${m.loser}<img class="char-icon" src="${iconPath(m.loser)}" alt="" onerror="this.style.display='none'"></span></td>
        <td>${m.isUpset ? "⚡ Upset" : ""}</td>
      `;
      matchesBody.appendChild(tr);
    }
  }
}

seasonSelect.addEventListener("change", () => loadSeason(seasonSelect.value));
tournamentSelect.addEventListener("change", () => {
  const { season, filename } = parseTournamentOption(tournamentSelect.value);
  loadTournament(season, filename);
});

loadSeason(String(SEASON_COUNT));
