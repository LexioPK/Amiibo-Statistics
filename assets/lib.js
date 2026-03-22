// Shared utilities for all pages

export const SEASON_COUNT = 7;

export function norm(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

export function canonKey(s) {
  return norm(s).toLowerCase().replace(/[.'']/g, "");
}

export function isByeLine(line) {
  return canonKey(line) === "bye";
}

export function parseCsvLoose(line) {
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

export function stripQuotes(s) {
  const t = String(s ?? "").trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

export async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Loads season roster from Season Data CSV.
 * Returns { roster, eloByNameKey, displayByNameKey }
 */
export async function loadSeasonRoster(season) {
  const url = `./${encodeURIComponent("Season Data")}/${encodeURIComponent(`Season ${season}.csv`)}`;
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

    const keys = new Set([canonKey(row.name)]);
    if (row.alias) keys.add(canonKey(row.alias));
    for (const k of keys) {
      eloByNameKey.set(k, elo);
      displayByNameKey.set(k, row.name);
    }
  }

  roster.sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank;
    return b.elo - a.elo;
  });

  return { roster, eloByNameKey, displayByNameKey };
}

export async function loadTournamentIndex(season) {
  const url = `./tournaments/season-${encodeURIComponent(season)}/index.json`;
  return fetchJson(url);
}

export async function loadTournamentText(season, filename) {
  const url = `./tournaments/season-${encodeURIComponent(season)}/${encodeURIComponent(filename)}`;
  return fetchText(url);
}

/** Parse a single competitor line from tournament text. */
export function parseCompetitorLine(line) {
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

export function expectedWinProb(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * Parses tournament text and computes full results.
 * Returns:
 *   { matchesCounted, matchesIgnoredBye, matchesSkippedNoScore, totalUpsets,
 *     matches: [{winner, winnerScore, loser, loserScore, isUpset}],
 *     perChar: Map<name, {matches,wins,losses,upsets,elo,expectedWins}>,
 *     h2h: Map<key, {a,b,matches,aWins,bWins}>,
 *     unknownNames: string[] }
 */
export function computeTournamentResults(text, ctx) {
  const lines = text.split(/\r?\n/g).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length % 2 !== 0) {
    throw new Error(`Expected an even number of non-empty lines (2 per match). Got ${lines.length}.`);
  }

  const perChar = new Map();
  const h2h = new Map();
  const matches = [];

  let matchesCounted = 0;
  let matchesIgnoredBye = 0;
  let matchesSkippedNoScore = 0;
  let totalUpsets = 0;
  const unknownNames = new Set();

  function ensure(displayName, elo) {
    if (!perChar.has(displayName)) {
      perChar.set(displayName, { matches: 0, wins: 0, losses: 0, upsets: 0, elo: elo ?? null, expectedWins: 0 });
    }
    return perChar.get(displayName);
  }

  function toDisplay(nameRaw) {
    const key = canonKey(nameRaw);
    const display = ctx.displayByNameKey.get(key);
    if (!display) { unknownNames.add(nameRaw); return norm(nameRaw); }
    return display;
  }

  function eloFor(nameRaw) {
    return ctx.eloByNameKey.get(canonKey(nameRaw)) ?? null;
  }

  for (let i = 0; i < lines.length; i += 2) {
    const c1 = parseCompetitorLine(lines[i]);
    const c2 = parseCompetitorLine(lines[i + 1]);
    if (!c1 || !c2) continue;

    if (c1.bye || c2.bye) { matchesIgnoredBye++; continue; }
    if (c1.score == null || c2.score == null) { matchesSkippedNoScore++; continue; }

    const d1 = toDisplay(c1.nameRaw);
    const d2 = toDisplay(c2.nameRaw);
    const elo1 = eloFor(c1.nameRaw);
    const elo2 = eloFor(c2.nameRaw);

    const isC1Winner = c1.score > c2.score;
    const winner = isC1Winner
      ? { name: d1, elo: elo1, score: c1.score }
      : { name: d2, elo: elo2, score: c2.score };
    const loser = isC1Winner
      ? { name: d2, elo: elo2, score: c2.score }
      : { name: d1, elo: elo1, score: c1.score };

    const e1 = ensure(d1, elo1);
    const e2 = ensure(d2, elo2);
    e1.matches++;
    e2.matches++;
    ensure(winner.name, winner.elo).wins++;
    ensure(loser.name, loser.elo).losses++;
    matchesCounted++;

    // Track expected wins for consistency metric
    if (elo1 != null && elo2 != null) {
      const p1wins = expectedWinProb(elo1, elo2);
      e1.expectedWins += p1wins;
      e2.expectedWins += (1 - p1wins);
    }

    // Head-to-head aggregate
    const a = d1 < d2 ? d1 : d2;
    const b = d1 < d2 ? d2 : d1;
    const h2hKey = `${a}__${b}`;
    const h2hRow = h2h.get(h2hKey) ?? { a, b, matches: 0, aWins: 0, bWins: 0 };
    h2hRow.matches++;
    if (winner.name === h2hRow.a) h2hRow.aWins++; else h2hRow.bWins++;
    h2h.set(h2hKey, h2hRow);

    // Upset detection
    let isUpset = false;
    if (winner.elo != null && loser.elo != null) {
      const p = expectedWinProb(winner.elo, loser.elo);
      if (p < 0.5) {
        ensure(winner.name, winner.elo).upsets++;
        totalUpsets++;
        isUpset = true;
      }
    }

    matches.push({
      winner: winner.name,
      winnerScore: winner.score,
      loser: loser.name,
      loserScore: loser.score,
      isUpset,
    });
  }

  return {
    matchesCounted, matchesIgnoredBye, matchesSkippedNoScore, totalUpsets,
    matches, perChar, h2h,
    unknownNames: Array.from(unknownNames),
  };
}

/**
 * Loads all tournaments for a season and returns aggregated per-character and h2h data.
 * Returns { perChar, h2h, tournamentResults: [{name, result}] }
 */
export async function loadAndAggregateAllTournaments(season, ctx) {
  const idx = await loadTournamentIndex(season);
  const files = idx.tournaments ?? [];

  const perChar = new Map();
  const h2h = new Map();
  const tournamentResults = [];

  function mergeChar(name, elo, src) {
    if (!perChar.has(name)) {
      perChar.set(name, { matches: 0, wins: 0, losses: 0, upsets: 0, elo, expectedWins: 0 });
    }
    const dst = perChar.get(name);
    dst.matches += src.matches;
    dst.wins += src.wins;
    dst.losses += src.losses;
    dst.upsets += src.upsets;
    dst.expectedWins += src.expectedWins;
  }

  function mergeH2H(srcMap) {
    for (const [key, row] of srcMap) {
      const ex = h2h.get(key) ?? { a: row.a, b: row.b, matches: 0, aWins: 0, bWins: 0 };
      ex.matches += row.matches;
      ex.aWins += row.aWins;
      ex.bWins += row.bWins;
      h2h.set(key, ex);
    }
  }

  for (const file of files) {
    try {
      const text = await loadTournamentText(season, file);
      const result = computeTournamentResults(text, ctx);
      tournamentResults.push({ name: file.replace(/\.txt$/i, ""), result });
      for (const [name, stats] of result.perChar) {
        mergeChar(name, stats.elo, stats);
      }
      mergeH2H(result.h2h);
    } catch (e) {
      console.warn(`Skipping ${file}:`, e.message);
    }
  }

  return { perChar, h2h, tournamentResults };
}

/** Populate a <select> with season options (latest first). */
export function populateSeasonSelect(selectEl, latestSeason) {
  selectEl.innerHTML = "";
  for (let s = latestSeason; s >= 1; s--) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = `Season ${s}`;
    if (s === latestSeason) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

/** Format a number as a percentage string. */
export function pct(n, d) {
  if (!d) return "—";
  return (n / d * 100).toFixed(1) + "%";
}

/** Compute consistency score (0–100) for a character. */
export function consistencyScore(wins, matches, expectedWins) {
  if (!matches) return null;
  const actualRate = wins / matches;
  const expectedRate = expectedWins / matches;
  const diff = Math.abs(actualRate - expectedRate);
  return Math.max(0, Math.round((1 - diff * 2) * 100));
}
