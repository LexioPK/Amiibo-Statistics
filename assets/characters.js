import {
  SEASON_COUNT,
  loadSeasonRoster,
  loadAllTimesRoster,
  loadAndAggregateAllTournaments,
  loadAllSeasonsData,
  populateSeasonSelect,
  pct,
  iconPath,
  canonKey,
} from "./lib.js";
import { getSeasonTimeline } from "./rating-engine.js";

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
    perChar.set(r.name, fromSrc ?? { matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo });
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

    let trends = new Map();
    try { trends = await computeTrends(season); } catch (e) { console.warn(e); }
    renderStats(ctx.roster, perChar, trends);
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

/** Rating change over the last 5 tournaments of a season, keyed by canonKey. */
async function computeTrends(season) {
  const { initialRating, points } = await getSeasonTimeline(season);
  const trends = new Map();
  if (!points.length) return trends;
  const latest = points[points.length - 1].ratings;
  const before = points.length > 5 ? points[points.length - 6].ratings : null;
  for (const [key, cur] of latest) {
    const prev = before?.get(key)?.rating ?? initialRating;
    trends.set(key, cur.rating - prev);
  }
  return trends;
}

function trendIndicator(delta) {
  if (delta == null) return "";
  const a = Math.abs(delta);
  const up = delta > 0;
  const sign = delta > 0 ? "+" : "";
  const title = `${sign}${Math.round(delta)} rating over last 5 tournaments`;
  if (a < 15) return `<span class="trend trend-flat" title="Little change over last 5 tournaments"><svg viewBox="0 0 20 12" width="20" height="12"><rect x="3" y="4" width="14" height="4" rx="1" fill="currentColor"/></svg></span>`;
  const big = a >= 50;
  // Short, fat arrows: big = solid triangle with stubby shaft, slight = angled wide arrow
  const shape = big
    ? (up
      ? `<path d="M10 1 L19 8 L13 8 L13 11 L7 11 L7 8 L1 8 Z" fill="currentColor"/>`
      : `<path d="M10 11 L19 4 L13 4 L13 1 L7 1 L7 4 L1 4 Z" fill="currentColor"/>`)
    : (up
      ? `<path d="M3 11 L9 5 L7 3 L17 2 L16 12 L14 10 L8 15 Z" fill="currentColor" transform="translate(0,-2)"/>`
      : `<path d="M3 1 L9 7 L7 9 L17 10 L16 0 L14 2 L8 -3 Z" fill="currentColor" transform="translate(0,2)"/>`);
  return `<span class="trend ${up ? "trend-up" : "trend-down"}" title="${title}"><svg viewBox="0 0 20 12" width="20" height="12" overflow="visible">${shape}</svg></span>`;
}

function renderStats(roster, perChar, trends = new Map()) {
  statsBody.innerHTML = "";
  for (const r of roster) {
    const st = perChar.get(r.name) ?? {
      matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo,
    };

    const winPct = pct(st.wins, st.matches);
    const upsetPct = pct(st.upsets, st.wins);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.rank ?? ""}</td>
      <td class="name-cell"><a class="char-link" href="${charLink(r.name)}"><span class="char-name-wrap">${r.name}<img class="char-icon" src="${iconPath(r.name)}" alt="" onerror="this.style.display='none'">${trendIndicator(trends.get(canonKey(r.name)))}</span></a></td>
      <td>${r.elo}</td>
      <td>${r.rd ?? "—"}</td>
      <td>${st.matches}</td>
      <td>${st.wins}</td>
      <td>${st.losses}</td>
      <td>${winPct}</td>
      <td>${st.upsets}</td>
      <td>${upsetPct}</td>
    `;
    statsBody.appendChild(tr);
  }
}

const TOP_RANK_CUTOFF = 43;

function charLink(name) {
  const base = `./character.html?char=${encodeURIComponent(name)}`;
  return isAllTime ? base : `${base}&season=${currentSeason}`;
}

function clearParity() {
  if (parityMeta) parityMeta.textContent = "";
  if (parityEmpty) parityEmpty.hidden = true;
  if (parityCanvas) parityCanvas.hidden = true;
  if (paritySvg) paritySvg.innerHTML = "";
  if (parityNodesOuter) parityNodesOuter.innerHTML = "";
  if (parityNodesCenter) parityNodesCenter.innerHTML = "";
}

/**
 * Quadrant graph: x = average score differential per match against top-N
 * opponents (3-0 = +3, 0-3 = -3), y = win % against opponents ranked
 * #TOP_RANK_CUTOFF or better.
 */
function renderParity() {
  clearParity();
  if (!currentCtx || !currentAgg) return;

  const rankByName = new Map(currentCtx.roster.map((r) => [r.name, r.rank]));
  const acc = new Map();
  const get = (n) => {
    if (!acc.has(n)) acc.set(n, { diff: 0, topW: 0, topM: 0 });
    return acc.get(n);
  };
  for (const { result } of currentAgg.tournamentResults) {
    for (const m of result.matches) {
      const wTop = (rankByName.get(m.winner) ?? Infinity) <= TOP_RANK_CUTOFF;
      const lTop = (rankByName.get(m.loser) ?? Infinity) <= TOP_RANK_CUTOFF;
      const d = m.winnerScore - m.loserScore;
      if (lTop) { const w = get(m.winner); w.topM++; w.topW++; w.diff += d; }
      if (wTop) { const l = get(m.loser); l.topM++; l.diff -= d; }
    }
  }

  const pts = [];
  for (const [name, a] of acc) {
    if (!rankByName.has(name) || a.topM === 0) continue;
    pts.push({ name, x: a.diff / a.topM, y: (a.topW / a.topM) * 100 });
  }

  const scopeLabel = isAllTime ? "All Time" : `Season ${currentSeason}`;
  parityMeta.textContent = `${scopeLabel}: x = avg game-score differential per match (3-0 = +3, 0-3 = −3), y = win % vs. top ${TOP_RANK_CUTOFF} opponents. ${pts.length} characters plotted. Click an icon to open its page.`;
  if (!pts.length) {
    parityEmpty.hidden = false;
    return;
  }
  parityCanvas.hidden = false;

  const xr = Math.max(0.5, ...pts.map((q) => Math.abs(q.x))) * 1.08;
  const [x0, x1] = [-xr, xr];
  const pad = (lo, hi) => {
    lo = Math.min(lo, 50); hi = Math.max(hi, 50);
    const d = Math.max(hi - lo, 10) * 0.08;
    return [Math.max(0, lo - d), Math.min(100, hi + d)];
  };
  const [y0, y1] = pad(Math.min(...pts.map((q) => q.y)), Math.max(...pts.map((q) => q.y)));
  const px = (v) => ((v - x0) / (x1 - x0)) * 100;
  const py = (v) => (1 - (v - y0) / (y1 - y0)) * 100;

  const NS = "http://www.w3.org/2000/svg";
  paritySvg.setAttribute("viewBox", "0 0 100 100");
  paritySvg.setAttribute("preserveAspectRatio", "none");
  const line = (a, b, c, d) => {
    const el = document.createElementNS(NS, "line");
    el.setAttribute("x1", a); el.setAttribute("y1", b);
    el.setAttribute("x2", c); el.setAttribute("y2", d);
    el.setAttribute("stroke", "#64748b");
    el.setAttribute("stroke-width", "0.3");
    el.setAttribute("vector-effect", "non-scaling-stroke");
    paritySvg.appendChild(el);
  };
  line(px(0), 0, px(0), 100);
  line(0, py(50), 100, py(50));

  const label = (txt, cls) => {
    const d = document.createElement("div");
    d.className = `quad-label ${cls}`;
    d.textContent = txt;
    parityNodesOuter.appendChild(d);
  };
  label("Dominant", "quad-tr");
  label("Clutch wins", "quad-tl");
  label("Close losses", "quad-br");
  label("Struggling", "quad-bl");
  const axis = (txt, cls) => {
    const d = document.createElement("div");
    d.className = `quad-axis ${cls}`;
    d.textContent = txt;
    parityNodesOuter.appendChild(d);
  };
  axis(`Avg score differential vs top ${TOP_RANK_CUTOFF} →`, "quad-x");
  axis(`Win % vs top ${TOP_RANK_CUTOFF} →`, "quad-y");

  for (const q of pts) {
    const a = document.createElement("a");
    a.className = "parity-node";
    a.href = charLink(q.name);
    a.title = `${q.name}: ${q.x >= 0 ? "+" : ""}${q.x.toFixed(2)} avg score diff, ${q.y.toFixed(1)}% win vs top ${TOP_RANK_CUTOFF}`;
    a.style.left = `${px(q.x)}%`;
    a.style.top = `${py(q.y)}%`;
    a.innerHTML = `<img src="${iconPath(q.name)}" alt="${q.name}" onerror="this.style.display='none'">`;
    parityNodesCenter.appendChild(a);
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
