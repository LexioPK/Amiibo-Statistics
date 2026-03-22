import {
  SEASON_COUNT,
  loadSeasonRoster,
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

function setStatus(msg) { statusEl.textContent = msg; }

async function loadAndRender(seasonVal) {
  statsBody.innerHTML = "";
  if (noDataMsg) noDataMsg.hidden = true;

  try {
    let roster, perChar;

    if (seasonVal === "alltime") {
      setStatus("Loading all seasons…");
      const all = await loadAllSeasonsData(SEASON_COUNT);
      roster = all.ctx.roster;
      perChar = all.perChar;
    } else {
      const season = Number(seasonVal);
      setStatus(`Loading season ${season} data…`);
      const ctx = await loadSeasonRoster(season);
      const agg = await loadAndAggregateAllTournaments(season, ctx);
      roster = ctx.roster;
      perChar = agg.perChar;
    }

    const hasAnyData = [...perChar.values()].some((s) => s.matches > 0);
    if (noDataMsg) noDataMsg.hidden = hasAnyData;
    renderStats(roster, perChar);
    setStatus(hasAnyData ? "Loaded." : "No tournament data found.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

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

seasonSelect.addEventListener("change", () => loadAndRender(seasonSelect.value));
loadAndRender(String(SEASON_COUNT));
