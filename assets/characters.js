import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
  pct,
  consistencyScore,
  iconPath,
} from "./lib.js";

const seasonSelect = document.getElementById("seasonSelect");
const statusEl = document.getElementById("status");
const statsBody = document.querySelector("#statsTable tbody");
const noDataMsg = document.getElementById("noDataMsg");
const tabBtnRankings = document.getElementById("tabBtnRankings");
const tabBtnParity = document.getElementById("tabBtnParity");
const panelRankings = document.getElementById("panelRankings");
const panelParity = document.getElementById("panelParity");
const parityMeta = document.getElementById("parityMeta");
const parityEmpty = document.getElementById("parityEmpty");
const parityCanvas = document.getElementById("parityCanvas");
const paritySvg = document.getElementById("paritySvg");
const parityNodesOuter = document.getElementById("parityNodesOuter");
const parityNodesCenter = document.getElementById("parityNodesCenter");

let currentSeason = SEASON_COUNT;
let isAllTime = false;
let currentCtx = null;
let currentAgg = null;

populateSeasonSelect(seasonSelect, SEASON_COUNT);

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setActiveTab(tab) {
  const rankings = tab === "rankings";
  tabBtnRankings.classList.toggle("active", rankings);
  tabBtnParity.classList.toggle("active", !rankings);
  tabBtnRankings.setAttribute("aria-selected", rankings ? "true" : "false");
  tabBtnParity.setAttribute("aria-selected", rankings ? "false" : "true");
  panelRankings.hidden = !rankings;
  panelParity.hidden = rankings;
}

function buildStatsMapForRoster(roster, sourcePerChar) {
  const perChar = new Map();
  for (const r of roster) {
    const fromSrc = sourcePerChar.get(r.name);
    perChar.set(r.name, fromSrc ?? { matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo, expectedWins: 0 });
  }
  return perChar;
}

async function loadAndRender(season) {
  setStatus(`Loading season ${season} data…`);
  currentSeason = season;
  isAllTime = false;
  statsBody.innerHTML = "";
  clearParity();
  if (noDataMsg) noDataMsg.hidden = true;

  try {
    const ctx = await loadSeasonRoster(season);
    const agg = await loadAndAggregateAllTournaments(season, ctx);
    const perChar = buildStatsMapForRoster(ctx.roster, agg.perChar);
    currentCtx = ctx;
    currentAgg = { ...agg, perChar };

    const hasAnyData = [...perChar.values()].some((s) => s.matches > 0);

    if (noDataMsg) noDataMsg.hidden = hasAnyData;

    renderStats(ctx.roster, perChar);
    renderParity();
    setStatus(hasAnyData ? "Loaded." : "No tournament data found for this season.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
}

// ── All Time function ─────────────────────────────────────────────────────────

async function loadAndRenderAllTime() {
  setStatus("Loading all seasons…");
  isAllTime = true;
  statsBody.innerHTML = "";
  clearParity();
  if (noDataMsg) noDataMsg.hidden = true;

  try {
    const ctx = await loadAllTimesRoster();
    const all = await loadAllSeasonsData(SEASON_COUNT);
    const perChar = buildStatsMapForRoster(ctx.roster, all.perChar);
    currentCtx = ctx;
    currentAgg = { ...all, perChar };

    const hasAnyData = [...perChar.values()].some((s) => s.matches > 0);
    if (noDataMsg) noDataMsg.hidden = hasAnyData;

    renderStats(ctx.roster, perChar);
    renderParity();
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
      <td class="name-cell"><span class="char-name-wrap">${r.name}<img class="char-icon" src="${iconPath(r.name)}" alt="" onerror="this.style.display='none'"></span></td>
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

function clearParity() {
  if (parityMeta) parityMeta.textContent = "";
  if (parityEmpty) parityEmpty.hidden = true;
  if (parityCanvas) parityCanvas.hidden = true;
  if (paritySvg) paritySvg.innerHTML = "";
  if (parityNodesOuter) parityNodesOuter.innerHTML = "";
  if (parityNodesCenter) parityNodesCenter.innerHTML = "";
}

function buildWinnerAdjacency(roster, h2hMap) {
  const rosterSet = new Set(roster.map((r) => r.name));
  const winsByChar = new Map(roster.map((r) => [r.name, new Set()]));
  for (const [, row] of h2hMap) {
    if (!rosterSet.has(row.a) || !rosterSet.has(row.b)) continue;
    if (row.aWins > 0) winsByChar.get(row.a).add(row.b);
    if (row.bWins > 0) winsByChar.get(row.b).add(row.a);
  }
  return winsByChar;
}

function chooseParityCover(chars, winsByChar) {
  const n = chars.length;
  if (n === 0) return { succ: new Map(), cycles: [] };
  const idx = new Map(chars.map((c, i) => [c, i]));

  const w = Array.from({ length: n + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const from = chars[i - 1];
    const wins = winsByChar.get(from) ?? new Set();
    for (let j = 1; j <= n; j++) {
      const to = chars[j - 1];
      if (i === j) w[i][j] = 0; // self means excluded from parity cycles
      else if (wins.has(to)) w[i][j] = 1;
      else w[i][j] = -1000000;
    }
  }

  // Hungarian algorithm (maximization, 1-indexed)
  const u = Array(n + 1).fill(0);
  const v = Array(n + 1).fill(0);
  const p = Array(n + 1).fill(0);
  const way = Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Infinity);
    const used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = -(w[i0][j]) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const succ = new Map();
  for (let j = 1; j <= n; j++) {
    const i = p[j];
    succ.set(chars[i - 1], chars[j - 1]);
  }

  const visited = new Set();
  const cycles = [];
  for (const c of chars) {
    if (visited.has(c)) continue;
    const seen = new Map();
    let cur = c;
    while (!visited.has(cur) && !seen.has(cur)) {
      seen.set(cur, seen.size);
      cur = succ.get(cur);
      if (!cur) break;
    }
    for (const k of seen.keys()) visited.add(k);
    if (cur && seen.has(cur)) {
      const order = Array.from(seen.keys());
      const start = seen.get(cur);
      const cyc = order.slice(start);
      if (cyc.length >= 2) cycles.push(cyc);
    }
  }

  cycles.sort((a, b) => b.length - a.length);
  return { succ, cycles };
}

function renderParity() {
  clearParity();
  if (!currentCtx || !currentAgg) return;

  const roster = currentCtx.roster;
  const chars = roster.map((r) => r.name);
  const winsByChar = buildWinnerAdjacency(roster, currentAgg.h2h);
  const { succ, cycles } = chooseParityCover(chars, winsByChar);

  const inCycle = new Set(cycles.flat());
  const centerChars = chars.filter((c) => !inCycle.has(c));

  const scopeLabel = isAllTime ? "All Time" : `Season ${currentSeason}`;
  parityMeta.textContent = `${scopeLabel}: ${inCycle.size} in parity cycle${inCycle.size === 1 ? "" : "s"}, ${centerChars.length} in center.`;

  if (inCycle.size === 0) {
    parityEmpty.hidden = false;
    return;
  }

  parityCanvas.hidden = false;

  const W = 900;
  const H = 900;
  const cx = W / 2;
  const cy = H / 2;
  const outer = Array.from(inCycle);
  const R = outer.length <= 8 ? 320 : outer.length <= 20 ? 350 : 370;

  const pointByChar = new Map();
  for (let i = 0; i < outer.length; i++) {
    const theta = (2 * Math.PI * i / outer.length) - Math.PI / 2;
    const x = cx + Math.cos(theta) * R;
    const y = cy + Math.sin(theta) * R;
    pointByChar.set(outer[i], { x, y });
  }

  const centerRows = Math.max(1, Math.ceil(Math.sqrt(centerChars.length || 1)));
  const spacing = 58;
  const x0 = cx - ((centerRows - 1) * spacing) / 2;
  const y0 = cy - ((centerRows - 1) * spacing) / 2;
  for (let i = 0; i < centerChars.length; i++) {
    const col = i % centerRows;
    const row = Math.floor(i / centerRows);
    const x = x0 + col * spacing;
    const y = y0 + row * spacing;
    pointByChar.set(centerChars[i], { x, y });
  }

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "parityArrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "6");
  marker.setAttribute("markerHeight", "6");
  marker.setAttribute("orient", "auto-start-reverse");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowPath.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrowPath.setAttribute("fill", "#374151");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  paritySvg.appendChild(defs);

  for (const cyc of cycles) {
    for (const from of cyc) {
      const to = succ.get(from);
      const p1 = pointByChar.get(from);
      const p2 = pointByChar.get(to);
      if (!p1 || !p2) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(p1.x));
      line.setAttribute("y1", String(p1.y));
      line.setAttribute("x2", String(p2.x));
      line.setAttribute("y2", String(p2.y));
      line.setAttribute("stroke", "#374151");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("opacity", "0.9");
      line.setAttribute("marker-end", "url(#parityArrow)");
      paritySvg.appendChild(line);
    }
  }

  for (const name of outer) {
    const p = pointByChar.get(name);
    const node = document.createElement("div");
    node.className = "parity-node";
    node.style.left = `${(p.x / W) * 100}%`;
    node.style.top = `${(p.y / H) * 100}%`;
    node.innerHTML = `<img src="${iconPath(name)}" alt="${name}" onerror="this.style.display='none'"><span>${name}</span>`;
    parityNodesOuter.appendChild(node);
  }

  for (const name of centerChars) {
    const p = pointByChar.get(name);
    const node = document.createElement("div");
    node.className = "parity-node parity-node-center";
    node.style.left = `${(p.x / W) * 100}%`;
    node.style.top = `${(p.y / H) * 100}%`;
    node.innerHTML = `<img src="${iconPath(name)}" alt="${name}" onerror="this.style.display='none'"><span>${name}</span>`;
    parityNodesCenter.appendChild(node);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

seasonSelect.addEventListener("change", () => {
  const val = seasonSelect.value;
  if (val === "alltime") loadAndRenderAllTime();
  else loadAndRender(Number(val));
});

tabBtnRankings.addEventListener("click", () => setActiveTab("rankings"));
tabBtnParity.addEventListener("click", () => setActiveTab("parity"));

setActiveTab("rankings");
loadAndRender(SEASON_COUNT);
