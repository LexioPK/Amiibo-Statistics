const seasonEl = document.getElementById("season");
const loadSeasonBtn = document.getElementById("loadSeasonBtn");

const tournamentSelect = document.getElementById("tournamentSelect");
const loadTournamentBtn = document.getElementById("loadTournamentBtn");
const computeBtn = document.getElementById("computeBtn");

const inputEl = document.getElementById("input");
const statusEl = document.getElementById("status");

const summaryEl = document.getElementById("summary");
const statsBody = document.querySelector("#stats tbody");

const h2hAEl = document.getElementById("h2hA");
const h2hBEl = document.getElementById("h2hB");
const h2hBtn = document.getElementById("h2hBtn");
const h2hOut = document.getElementById("h2hOut");

let lastState = null;
let seasonCtx = null;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function norm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function canonKey(s) {
  return norm(s).toLowerCase().replace(/[.'']/g, "");
}

function isByeLine(line) {
  return canonKey(line) === "bye";
}

// Small CSV parser (handles quotes enough for your season files)
function parseCsvLoose(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function stripQuotes(s) {
  const t = String(s ?? "").trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.json();
}

/**
 * Loads season roster from Season Data CSV.
 * Returns:
 * - roster: [{ rank, name, alias, elo }]
 * - eloByNameKey: Map<canonKey(name or alias), eloNumber>
 * - displayByNameKey: Map<canonKey(name or alias), displayName>
 */
async function loadSeasonRoster(season) {
  const url = `./Season%20Data/Season%20${encodeURIComponent(season)}.csv`;
  const text = await fetchText(url);
  const lines = text.split(/\r?\n/g).map((l) => l.trim()).filter(Boolean);

  const roster = [];
  const eloByNameKey = new Map();
  const displayByNameKey = new Map();

  for (const line of lines) {
    const cols = parseCsvLoose(line);
    const rank = Number(stripQuotes(cols[0] ?? ""));
    const name = stripQuotes(cols[1] ?? "");
    const elo = Number(stripQuotes(cols[2] ?? ""));
    const alias = stripQuotes(cols[4] ?? "");

    if (!name || !Number.isFinite(elo)) continue;

    const row = { rank: Number.isFinite(rank) ? rank : null, name: norm(name), alias: norm(alias), elo };
    roster.push(row);

    // Match keys: both name and alias (if present)
    const keys = new Set([canonKey(row.name)]);
    if (row.alias) keys.add(canonKey(row.alias));

    for (const k of keys) {
      eloByNameKey.set(k, elo);
      displayByNameKey.set(k, row.name);
    }
  }

  // Sort roster by rank if rank exists; else by elo desc
  roster.sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    return b.elo - a.elo;
  });

  return { roster, eloByNameKey, displayByNameKey };
}

async function loadTournamentIndex(season) {
  const url = `./tournaments/season-${encodeURIComponent(season)}/index.json`;
  return fetchJson(url);
}

async function loadTournamentText(season, filename) {
  const url = `./tournaments/season-${encodeURIComponent(season)}/${encodeURIComponent(filename)}`;
  return fetchText(url);
}

// Competitor line: optional match number, then name words, optional last score
function parseCompetitorLine(line) {
  const raw = norm(line);
  if (!raw) return null;
  if (isByeLine(raw)) return { nameRaw: "Bye", score: null, bye: true };

  const parts = raw.split(" ").filter(Boolean);
  if (/^\d+$/.test(parts[0])) parts.shift();

  let score = null;
  if (parts.length && /^\d+$/.test(parts[parts.length - 1])) {
    score = Number(parts.pop());
  }

  return { nameRaw: norm(parts.join(" ")), score, bye: false };
}

function expectedWinProb(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function computeDetailsFromTournamentText(text, ctx) {
  const lines = text.split(/\r?\n/g).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length % 2 !== 0) {
    throw new Error(`Expected an even number of lines (2 per match). Got ${lines.length}.`);
  }

  const perChar = new Map();
  const h2h = new Map();

  let matchesCounted = 0;
  let matchesIgnoredBye = 0;
  let matchesSkippedNoScore = 0;
  let totalUpsets = 0;
  const unknownNames = new Set();

  function ensure(displayName, elo) {
    if (!perChar.has(displayName)) {
      perChar.set(displayName, { matches: 0, wins: 0, losses: 0, upsets: 0, elo: elo ?? null });
    }
    return perChar.get(displayName);
  }

  function toDisplay(nameRaw) {
    const key = canonKey(nameRaw);
    const display = ctx.displayByNameKey.get(key);
    if (!display) {
      unknownNames.add(nameRaw);
      return norm(nameRaw);
    }
    return display;
  }

  function eloFor(nameRaw) {
    const key = canonKey(nameRaw);
    return ctx.eloByNameKey.get(key) ?? null;
  }

  for (let i = 0; i < lines.length; i += 2) {
    const c1 = parseCompetitorLine(lines[i]);
    const c2 = parseCompetitorLine(lines[i + 1]);
    if (!c1 || !c2) continue;

    if (c1.bye || c2.bye) {
      matchesIgnoredBye++;
      continue;
    }

    if (c1.score == null || c2.score == null) {
      matchesSkippedNoScore++;
      continue;
    }

    const d1 = toDisplay(c1.nameRaw);
    const d2 = toDisplay(c2.nameRaw);
    const elo1 = eloFor(c1.nameRaw);
    const elo2 = eloFor(c2.nameRaw);

    const winner = c1.score > c2.score ? { name: d1, elo: elo1 } : { name: d2, elo: elo2 };
    const loser  = c1.score > c2.score ? { name: d2, elo: elo2 } : { name: d1, elo: elo1 };

    ensure(d1, elo1).matches++;
    ensure(d2, elo2).matches++;

    ensure(winner.name, winner.elo).wins++;
    ensure(loser.name, loser.elo).losses++;

    matchesCounted++;

    // head-to-head aggregate
    const a = d1 < d2 ? d1 : d2;
    const b = d1 < d2 ? d2 : d1;
    const h2hKey = `${a}__${b}`;
    const row = h2h.get(h2hKey) ?? { a, b, matches: 0, aWins: 0, bWins: 0 };
    row.matches++;
    if (winner.name === row.a) row.aWins++; else row.bWins++;
    h2h.set(h2hKey, row);

    // upset detection
    if (typeof winner.elo === "number" && typeof loser.elo === "number") {
      const p = expectedWinProb(winner.elo, loser.elo);
      if (p < 0.5) {
        ensure(winner.name, winner.elo).upsets++;
        totalUpsets++;
      }
    }
  }

  return {
    matchesCounted,
    matchesIgnoredBye,
    matchesSkippedNoScore,
    totalUpsets,
    perChar,
    h2h,
    unknownNames: Array.from(unknownNames)
  };
}

function renderSummary(state) {
  summaryEl.innerHTML = "";
  const items = [
    ["Matches counted", state.matchesCounted],
    ["Bye matches ignored", state.matchesIgnoredBye],
    ["Skipped (missing score)", state.matchesSkippedNoScore],
    ["Upsets", state.totalUpsets],
    ["Unknown names", state.unknownNames.length]
  ];

  for (const [k, v] of items) {
    const div = document.createElement("div");
    div.className = "pill";
    div.innerHTML = `<div class="muted">${k}</div><div><b>${v}</b></div>`;
    summaryEl.appendChild(div);
  }

  if (state.unknownNames.length) {
    const div = document.createElement("div");
    div.className = "pill";
    div.innerHTML = `<div class="muted">Unknown list</div><div><b>${state.unknownNames.join(", ")}</b></div>`;
    summaryEl.appendChild(div);
  }
}

function renderStatsTable(roster, state) {
  statsBody.innerHTML = "";

  for (const r of roster) {
    const st = state.perChar.get(r.name) ?? { matches: 0, wins: 0, losses: 0, upsets: 0, elo: r.elo };

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.rank ?? ""}</td>
      <td>${r.name}</td>
      <td>${r.elo}</td>
      <td>${st.matches}</td>
      <td>${st.wins}</td>
      <td>${st.losses}</td>
      <td>${st.upsets}</td>
    `;
    statsBody.appendChild(tr);
  }
}

function findH2H(state, aName, bName) {
  const a = norm(aName);
  const b = norm(bName);
  const x = a < b ? a : b;
  const y = a < b ? b : a;
  return state.h2h.get(`${x}__${y}`) ?? null;
}

loadSeasonBtn.addEventListener("click", async () => {
  try {
    setStatus("Loading season roster + tournament list…");
    computeBtn.disabled = true;
    h2hBtn.disabled = true;

    const season = Number(seasonEl.value);
    seasonCtx = await loadSeasonRoster(season);

    const idx = await loadTournamentIndex(season);
    const files = idx.tournaments ?? [];

    tournamentSelect.innerHTML = "";
    for (const f of files) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f.replace(/\.txt$/i, "");
      tournamentSelect.appendChild(opt);
    }

    tournamentSelect.disabled = files.length === 0;
    loadTournamentBtn.disabled = files.length === 0;

    setStatus(files.length ? "Season loaded. Load a tournament." : "No tournaments found in index.json.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
});

loadTournamentBtn.addEventListener("click", async () => {
  try {
    if (!seasonCtx) throw new Error("Load season first.");
    setStatus("Loading tournament text…");

    const season = Number(seasonEl.value);
    const file = tournamentSelect.value;
    inputEl.value = await loadTournamentText(season, file);

    computeBtn.disabled = false;
    setStatus("Tournament loaded. Click Compute details.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
});

computeBtn.addEventListener("click", () => {
  try {
    if (!seasonCtx) throw new Error("Load season first.");
    setStatus("Computing…");

    const state = computeDetailsFromTournamentText(inputEl.value, seasonCtx);
    lastState = state;

    renderSummary(state);
    renderStatsTable(seasonCtx.roster, state);

    h2hBtn.disabled = false;
    setStatus("Done.");
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message ?? e));
  }
});

h2hBtn.addEventListener("click", () => {
  if (!lastState) {
    h2hOut.textContent = "Compute details first.";
    return;
  }

  const aRaw = norm(h2hAEl.value);
  const bRaw = norm(h2hBEl.value);
  if (!aRaw || !bRaw) {
    h2hOut.textContent = "Enter A and B.";
    return;
  }

  const aDisp = seasonCtx?.displayByNameKey.get(canonKey(aRaw)) ?? aRaw;
  const bDisp = seasonCtx?.displayByNameKey.get(canonKey(bRaw)) ?? bRaw;

  const row = findH2H(lastState, aDisp, bDisp);
  if (!row) {
    h2hOut.textContent = `No matches found between "${aDisp}" and "${bDisp}".`;
    return;
  }

  let aWins = 0, bWins = 0;
  if (aDisp === row.a) { aWins = row.aWins; bWins = row.bWins; }
  else { aWins = row.bWins; bWins = row.aWins; }

  h2hOut.textContent =
    `${aDisp} vs ${bDisp}\n` +
    `matches: ${row.matches}\n` +
    `${aDisp} wins: ${aWins}\n` +
    `${bDisp} wins: ${bWins}\n`;
});

setStatus("Enter a season and click Load season.");
