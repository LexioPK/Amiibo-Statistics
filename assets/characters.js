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
 * Quadrant graph.
 *  Season:   x = match closeness C = 1 - avg(|W-L| / (W+L)), y = average opponent rating.
 *  All Time: x = average opponent rating, y = win %.
 */
function renderParity() {
  clearParity();
  if (!currentCtx || !currentAgg) return;

  const eloByName = new Map(currentCtx.roster.map((r) => [r.name, r.elo]));
  const acc = new Map();
  const get = (n) => {
    if (!acc.has(n)) acc.set(n, { m: 0, wins: 0, oppSum: 0, oppN: 0, dSum: 0, dN: 0 });
    return acc.get(n);
  };
  const record = (self, opp, won, w, l) => {
    const a = get(self);
    a.m++;
    if (won) a.wins++;
    const oe = eloByName.get(opp);
    if (oe != null) { a.oppSum += oe; a.oppN++; }
    if (w + l > 0) { a.dSum += Math.abs(w - l) / (w + l); a.dN++; }
  };
  for (const { result } of currentAgg.tournamentResults) {
    for (const m of result.matches) {
      record(m.winner, m.loser, true, m.winnerScore, m.loserScore);
      record(m.loser, m.winner, false, m.winnerScore, m.loserScore);
    }
  }

  const pts = [];
  for (const [name, a] of acc) {
    if (!eloByName.has(name) || a.oppN === 0 || a.dN === 0) continue;
    const opp = a.oppSum / a.oppN;
    const closeness = 1 - a.dSum / a.dN;
    const winPct = (a.wins / a.m) * 100;
    pts.push(isAllTime
      ? { name, x: opp, y: winPct, tip: `${Math.round(opp)} avg opponent rating, ${winPct.toFixed(1)}% win rate` }
      : { name, x: closeness, y: opp, tip: `${Math.round(opp)} avg opponent rating, ${closeness.toFixed(2)} match closeness` });
  }

  const scopeLabel = isAllTime ? "All Time" : `Season ${currentSeason}`;
  parityMeta.textContent = isAllTime
    ? `${scopeLabel}: x = average opponent rating, y = win % against those opponents. ${pts.length} characters plotted. Click an icon to open its page.`
    : `${scopeLabel}: x = match closeness (1 − avg |W−L| / (W+L)), y = average rating of opponents faced. ${pts.length} characters plotted. Click an icon to open its page.`;
  if (!pts.length) {
    parityEmpty.hidden = false;
    return;
  }
  parityCanvas.hidden = false;

  const range = (vals) => {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const d = (hi - lo) * 0.08;
    return [lo - d, hi + d];
  };
  const mean = (vals) => vals.reduce((t, v) => t + v, 0) / vals.length;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const [x0, x1] = range(xs);
  const [y0, y1] = range(ys);
  const xMid = mean(xs), yMid = mean(ys);
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
  line(px(xMid), 0, px(xMid), 100);
  line(0, py(yMid), 100, py(yMid));

  const addText = (txt, cls) => {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = txt;
    parityNodesOuter.appendChild(d);
  };
  const labels = isAllTime
    ? { tr: "Beating tough foes", tl: "Beating weaker foes", br: "Struggling vs tough foes", bl: "Struggling vs weaker foes" }
    : { tr: "Tough & tight", tl: "Tough & lopsided", br: "Easy & tight", bl: "Easy & lopsided" };
  addText(labels.tr, "quad-label quad-tr");
  addText(labels.tl, "quad-label quad-tl");
  addText(labels.br, "quad-label quad-br");
  addText(labels.bl, "quad-label quad-bl");
  addText(isAllTime ? "Avg opponent rating →" : "Match closeness →", "quad-axis quad-x");
  addText(isAllTime ? "Win % vs opponents →" : "Avg opponent rating →", "quad-axis quad-y");

  for (const q of pts) {
    const a = document.createElement("a");
    a.className = "parity-node";
    a.href = charLink(q.name);
    a.title = `${q.name}: ${q.tip}`;
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
