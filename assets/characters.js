import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
  pct,
  consistencyScore,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const statusEl = document.getElementById("status");
const statsBody = document.querySelector("#statsTable tbody");
const noDataMsg = document.getElementById("noDataMsg");

populateSeasonSelect(seasonSelect, SEASON_COUNT);

function setStatus(msg) {
  statusEl.textContent = msg;
}

// ── Original per-season function (unchanged) ──────────────────────────────────

async function loadAndRender(season) {
  setStatus(`Loading season ${season} data…`);
  statsBody.innerHTML = "";
  if (noDataMsg) noDataMsg.hidden = true;

  try {
    const ctx = await loadSeasonRoster(season);
    const agg = await loadAndAggregateAllTournaments(season, ctx);

    const hasAnyData = [...agg.perChar.values()].some((s) => s.matches > 0);

    if (noDataMsg) noDataMsg.hidden = hasAnyData;

    renderStats(ctx.roster, agg.perChar);
    setStatus(hasAnyData ? "Loaded." : "No tournament data found for this season.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── All Time function ─────────────────────────────────────────────────────────

async function loadAndRenderAllTime() {
  setStatus("Loading all seasons…");
  statsBody.innerHTML = "";
  if (noDataMsg) noDataMsg.hidden = true;

  try {
    const ctx = await loadAllTimesRoster();
    const all = await loadAllSeasonsData(SEASON_COUNT);

    // Merge all-time tournament stats into the all-time roster
    const perChar = new Map();
    for (const r of ctx.roster) {
      const key = r.name;
      const fromAll = all.perChar.get(key);
      perChar.set(key, fromAll ?? { matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo, expectedWins: 0 });
    }

    const hasAnyData = [...perChar.values()].some((s) => s.matches > 0);
    if (noDataMsg) noDataMsg.hidden = hasAnyData;

    renderStats(ctx.roster, perChar);
    setStatus(hasAnyData ? "Loaded." : "No tournament data found.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderStats(roster, perChar) {
  statsBody.innerHTML = "";
  for (const r of roster) {
    const st = perChar.get(r.name) ?? {
      matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo, expectedWins: 0,
    };

    const winPct = pct(st.wins, st.matches);
    const upsetPct = pct(st.upsets, st.wins);
    const cs = consistencyScore(st.wins, st.matches, st.expectedWins);
    const consistencyText = cs != null ? `${cs}%` : "—";

    // Highlight over/under-performers
    let perfClass = "";
    if (cs != null) {
      if (cs >= 80) perfClass = "perf-good";
      else if (cs <= 40) perfClass = "perf-poor";
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.rank ?? ""}</td>
      <td class="name-cell">${r.name}</td>
      <td>${r.elo}</td>
      <td>${st.matches}</td>
      <td>${st.wins}</td>
      <td>${st.losses}</td>
      <td>${winPct}</td>
      <td>${st.upsets}</td>
      <td>${upsetPct}</td>
      <td class="${perfClass}">${consistencyText}</td>
    `;
    statsBody.appendChild(tr);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

seasonSelect.addEventListener("change", () => {
  const val = seasonSelect.value;
  if (val === "alltime") loadAndRenderAllTime();
  else loadAndRender(Number(val));
});

loadAndRender(SEASON_COUNT);
