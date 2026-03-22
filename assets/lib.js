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

// ── Section parsing ──────────────────────────────────────────────────────────

/**
 * A line is a section-start header if it begins with one of the known bracket
 * keywords, OR is a standalone "Round N" line (qualifier pool rounds).
 */
const SECTION_START_RE = /^(Winners|Losers|Grand)\b|^Round\s+\d+\s*$/i;

/**
 * The second line of a header pair is either "Top N" or "Completed".
 */
const SECTION_COMPANION_RE = /^(Top\s+\d+|Completed)\s*$/i;

/**
 * Splits raw tournament text into sections.
 * Each section: { name, topN, lines }
 * - name: the round label ("Winners Round 2", "Round 1", "Qualifiers", …)
 * - topN: number from "Top N" companion line, or null
 * - lines: raw match lines belonging to this section
 *
 * The implicit first section (lines before the first header) is "Qualifiers".
 */
export function parseTournamentSections(rawText) {
  const lines = rawText.split(/\r?\n/g).map((l) => norm(l)).filter(Boolean);

  const sections = [];
  let curName = "Qualifiers";
  let curTopN = null;
  let curLines = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (SECTION_START_RE.test(line)) {
      // Save the section we were accumulating (if it has match lines)
      if (curLines.length > 0) {
        sections.push({ name: curName, topN: curTopN, lines: curLines });
      }
      curName = line;
      curTopN = null;
      curLines = [];
      i++;
      // Consume the companion line ("Top N" or "Completed")
      if (i < lines.length && SECTION_COMPANION_RE.test(lines[i])) {
        const m = lines[i].match(/(\d+)/);
        curTopN = m ? parseInt(m[1], 10) : null;
        i++;
      }
    } else {
      curLines.push(line);
      i++;
    }
  }
  if (curLines.length > 0) {
    sections.push({ name: curName, topN: curTopN, lines: curLines });
  }
  return sections;
}

/**
 * Returns a [primary, secondary] sort key.
 * Display order: ascending (smallest key → top of page = most important).
 *
 * Grand Finals (topN 2)          → [2, 0]   — first
 * Winners bracket sections       → [topN, 0]
 * Losers bracket sections        → [topN, 1] — below matching winners
 * Qualifier pools ("Round N")    → [99990 + N, 0]
 * Unnamed qualifiers             → [99999, 0] — last
 */
export function sectionSortKey(section) {
  if (section.name === "Qualifiers") return [99999, 0];

  // Standalone pool round: "Round N"
  if (/^Round\s+\d+\s*$/i.test(section.name)) {
    const m = section.name.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    return [99990 + n, 0];
  }

  const isLosers = /^Losers\b/i.test(section.name);
  const topN = section.topN ?? 99998;
  return [topN, isLosers ? 1 : 0];
}

// ── Competitor-line parsing ───────────────────────────────────────────────────

/** Parse a single competitor line from tournament text. */
export function parseCompetitorLine(line) {
  const raw = norm(line);
  if (!raw) return null;
  if (isByeLine(raw)) return { nameRaw: "Bye", score: null, bye: true };

  const parts = raw.split(" ").filter(Boolean);
  // Strip leading match number (e.g. "65 Byleth 3" → ["Byleth", "3"])
  if (/^\d+$/.test(parts[0])) parts.shift();

  // After stripping match number, check for a bare "Bye"
  if (parts.length === 1 && canonKey(parts[0]) === "bye") {
    return { nameRaw: "Bye", score: null, bye: true };
  }

  let score = null;
  if (parts.length && /^\d+$/.test(parts[parts.length - 1])) {
    score = Number(parts.pop());
  }

  const nameRaw = norm(parts.join(" "));

  // Treat placeholder lines like "Winner of 128" / "Loser of 128" as byes
  if (/^(Winner|Loser)\s+of\s+\d+$/i.test(nameRaw)) {
    return { nameRaw: "Bye", score: null, bye: true };
  }

  return { nameRaw, score, bye: false };
}

export function expectedWinProb(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// ── Tournament result computation ────────────────────────────────────────────

/**
 * Parses a tournament text file and computes full results.
 * Returns:
 *   { matchesCounted, matchesIgnoredBye, matchesSkippedNoScore, totalUpsets,
 *     matches: [{winner, winnerScore, loser, loserScore, isUpset}],  ← flat, sorted
 *     sections: [{name, topN, sortKey, matches}],                    ← sorted for display
 *     perChar: Map, h2h: Map, unknownNames: string[] }
 */
export function computeTournamentResults(text, ctx) {
  const rawSections = parseTournamentSections(text);

  const perChar = new Map();
  const h2h = new Map();
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

  const processedSections = [];

  for (const section of rawSections) {
    const sectionMatches = [];
    const lines = section.lines;

    for (let i = 0; i + 1 < lines.length; i += 2) {
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

      if (elo1 != null && elo2 != null) {
        const p1wins = expectedWinProb(elo1, elo2);
        e1.expectedWins += p1wins;
        e2.expectedWins += (1 - p1wins);
      }

      const a = d1 < d2 ? d1 : d2;
      const b = d1 < d2 ? d2 : d1;
      const h2hKey = `${a}__${b}`;
      const h2hRow = h2h.get(h2hKey) ?? { a, b, matches: 0, aWins: 0, bWins: 0 };
      h2hRow.matches++;
      if (winner.name === h2hRow.a) h2hRow.aWins++; else h2hRow.bWins++;
      h2h.set(h2hKey, h2hRow);

      let isUpset = false;
      if (winner.elo != null && loser.elo != null) {
        const p = expectedWinProb(winner.elo, loser.elo);
        if (p < 0.5) {
          ensure(winner.name, winner.elo).upsets++;
          totalUpsets++;
          isUpset = true;
        }
      }

      sectionMatches.push({
        winner: winner.name, winnerScore: winner.score,
        loser: loser.name, loserScore: loser.score,
        isUpset,
      });
    }

    processedSections.push({
      name: section.name,
      topN: section.topN,
      sortKey: sectionSortKey(section),
      matches: sectionMatches,
    });
  }

  // Sort sections: Grand Finals first → Qualifiers last
  processedSections.sort((a, b) => {
    const [a0, a1] = a.sortKey;
    const [b0, b1] = b.sortKey;
    return a0 !== b0 ? a0 - b0 : a1 - b1;
  });

  return {
    matchesCounted, matchesIgnoredBye, matchesSkippedNoScore, totalUpsets,
    matches: processedSections.flatMap((s) => s.matches),
    sections: processedSections,
    perChar, h2h,
    unknownNames: Array.from(unknownNames),
  };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Loads all tournaments for one season and aggregates per-character + h2h data.
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

/**
 * Loads and aggregates ALL seasons' data.
 * Uses the latest season's roster as the reference (for consistent rankings).
 * Returns { perChar, h2h, tournamentResults, ctx }
 */
export async function loadAllSeasonsData(latestSeason) {
  const ctx = await loadSeasonRoster(latestSeason);
  const perChar = new Map();
  const h2h = new Map();
  const tournamentResults = [];

  for (let s = 1; s <= latestSeason; s++) {
    try {
      const sCtx = await loadSeasonRoster(s);
      const agg = await loadAndAggregateAllTournaments(s, sCtx);

      for (const [name, stats] of agg.perChar) {
        // Map to latest-season canonical name where possible
        const key = canonKey(name);
        const canonName = ctx.displayByNameKey.get(key) ?? name;
        const elo = ctx.eloByNameKey.get(key) ?? stats.elo;

        if (!perChar.has(canonName)) {
          perChar.set(canonName, { matches: 0, wins: 0, losses: 0, upsets: 0, elo, expectedWins: 0 });
        }
        const dst = perChar.get(canonName);
        dst.matches += stats.matches;
        dst.wins += stats.wins;
        dst.losses += stats.losses;
        dst.upsets += stats.upsets;
        dst.expectedWins += stats.expectedWins;
      }

      for (const [key2, row] of agg.h2h) {
        const ex = h2h.get(key2) ?? { a: row.a, b: row.b, matches: 0, aWins: 0, bWins: 0 };
        ex.matches += row.matches;
        ex.aWins += row.aWins;
        ex.bWins += row.bWins;
        h2h.set(key2, ex);
      }

      for (const t of agg.tournamentResults) {
        tournamentResults.push({ ...t, name: `S${s} — ${t.name}` });
      }
    } catch (e) {
      console.warn(`Skipping season ${s}:`, e.message);
    }
  }

  return { perChar, h2h, tournamentResults, ctx };
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Populate a <select> with "All Time" + season options (latest first).
 * Latest season is selected by default.
 */
export function populateSeasonSelect(selectEl, latestSeason) {
  selectEl.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "alltime";
  allOpt.textContent = "All Time";
  selectEl.appendChild(allOpt);

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
