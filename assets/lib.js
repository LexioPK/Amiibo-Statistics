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

/**
 * Hardcoded name aliases: maps the canonical key of an alternate spelling to
 * the preferred display name that appears in the season roster CSVs.
 * Used to merge results from tournament files that use different spellings.
 */
const HARDCODED_ALIASES = new Map([
  ["metaknight", "Meta Knight"],
  ["sans", "Mii Gunner"],
  ["megaman", "Mega Man"],
  ["wii-fit trainer", "Wii Fit Trainer"],
  ["pokémon trainer", "Pokemon Trainer"],
  ["doctor mario", "Dr. Mario"],
  ["captian falcon", "Captain Falcon"],
  ["shiek", "Sheik"],
]);

/** If nameRaw is a known alternate spelling, return the preferred name; otherwise return nameRaw unchanged. */
export function resolveAlias(nameRaw) {
  const key = canonKey(nameRaw);
  return HARDCODED_ALIASES.get(key) ?? nameRaw;
}

/**
 * Names that are excluded from all rankings/stats entirely (e.g. entries that
 * aren't actually amiibo characters). Matches involving an excluded name are
 * skipped everywhere — ratings, win/loss counts, upsets — the same as a bye.
 */
const EXCLUDED_NAMES = new Set(["sean"]);

/** True if nameRaw (after alias resolution) refers to an excluded name. */
export function isExcludedName(nameRaw) {
  return EXCLUDED_NAMES.has(canonKey(resolveAlias(nameRaw)));
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
 * Builds the roster context shape ({ roster, eloByNameKey, displayByNameKey,
 * rankByNameKey }) that the rest of the app consumes, from a list of computed
 * Glicko-2 rating rows ({ rank, name, rating, rd, matches }).
 *
 * `elo` here holds the character's current Glicko-2 rating (kept under the
 * historical name for compatibility with the rest of the codebase); `rd`
 * carries the rating deviation (uncertainty) alongside it.
 */
function buildRosterContext(rows) {
  const roster = [];
  const eloByNameKey = new Map();
  const rdByNameKey = new Map();
  const displayByNameKey = new Map();
  const rankByNameKey = new Map();

  for (const row of rows) {
    const name = norm(row.name);
    if (isExcludedName(name)) continue;
    const entry = { rank: row.rank ?? null, name, elo: row.rating, rd: row.rd };
    roster.push(entry);

    const key = canonKey(name);
    eloByNameKey.set(key, row.rating);
    rdByNameKey.set(key, row.rd);
    displayByNameKey.set(key, name);
    if (entry.rank != null) rankByNameKey.set(key, entry.rank);
  }

  return { roster, eloByNameKey, rdByNameKey, displayByNameKey, rankByNameKey };
}

/**
 * Loads the season roster: every amiibo's Glicko-2 rating/RD for the given
 * season alone. Every player starts fresh from the standard starting
 * rating/RD at the beginning of the season (a reset), so standings only
 * reflect that season's own matches — not earlier or later seasons.
 * Characters who didn't compete that season are excluded.
 * Returns { roster, eloByNameKey, rdByNameKey, displayByNameKey, rankByNameKey }
 */
export async function loadSeasonRoster(season) {
  const { getSeasonRatings } = await import("./rating-engine.js");
  const rows = await getSeasonRatings(season);
  return buildRosterContext(rows);
}

/**
 * Loads the all-time roster: every amiibo's Glicko-2 rating/RD from the
 * single continuous history across every recorded tournament (no per-season
 * resets), with more recent seasons weighted slightly more heavily so
 * current performance counts a bit more without diminishing earlier results.
 */
export async function loadAllTimesRoster() {
  const { getAllTimeRatings } = await import("./rating-engine.js");
  const rows = await getAllTimeRatings();
  return buildRosterContext(rows);
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
 * Returns a [primary, secondary, tertiary] sort key.
 * Display order: ascending (smallest key → top of page = most important).
 *
 * Grand Finals Set 2 (topN 2)    → [2, 0, -2]  — first (higher set # sorts first)
 * Grand Finals Set 1 (topN 2)    → [2, 0, -1]  — second
 * Losers bracket sections        → [topN, 0, 0] — above matching winners
 * Winners bracket sections       → [topN, 1, 0]
 * Qualifier pools ("Round N")    → [99990 + N, 0, 0]
 * Unnamed qualifiers             → [99999, 0, 0] — last
 */
export function sectionSortKey(section) {
  if (section.name === "Qualifiers") return [99999, 0, 0];

  // Standalone pool round: "Round N"
  if (/^Round\s+\d+\s*$/i.test(section.name)) {
    const m = section.name.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    return [99990 + n, 0, 0];
  }

  const isLosers = /^Losers\b/i.test(section.name);
  const topN = section.topN ?? 99998;
  // When multiple Grand Finals sets exist (Set 1, Set 2…), display higher sets first.
  const setM = section.name.match(/\bSet\s+(\d+)/i);
  const setOrder = setM ? -parseInt(setM[1], 10) : 0;
  return [topN, isLosers ? 0 : 1, setOrder];
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

  const nameRaw = norm(parts.join(" ").replace(/\[\d+\]/g, ""));

  // Treat placeholder lines like "Winner of 128" / "Loser of 128" as byes.
  // Note: the trailing number is already stripped as `score` above, so match
  // with or without a trailing digit.
  if (/^(Winner|Loser)\s+of(\s+\d+)?$/i.test(nameRaw)) {
    return { nameRaw: "Bye", score: null, bye: true };
  }

  return { nameRaw, score, bye: false };
}

// ── Tournament result computation ────────────────────────────────────────────

/**
 * Parses a tournament text file and computes full results.
 * Returns:
 *   { matchesCounted, matchesIgnoredBye, matchesSkippedNoScore, totalUpsets,
 *     matches: [{winner, winnerScore, loser, loserScore, isUpset}],  ← flat, sorted
 *     sections: [{name, topN, sortKey, matches}],                    ← sorted for display
 *     perChar: Map, h2h: Map, unknownNames: string[] }
 *
 * `ctx.rankByNameKey` (and `ctx.eloByNameKey`) should reflect standings as of
 * immediately *before* this tournament started, so that upsets are judged
 * against the ranking at the time the tournament was played, not against
 * ranking data from tournaments that happened afterwards.
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
      perChar.set(displayName, { matches: 0, wins: 0, losses: 0, upsets: 0, upsetLosses: 0, elo: elo ?? null });
    }
    return perChar.get(displayName);
  }

  function toDisplay(nameRaw) {
    const resolved = resolveAlias(nameRaw);
    const key = canonKey(resolved);
    const display = ctx.displayByNameKey.get(key);
    if (!display) { unknownNames.add(nameRaw); return norm(resolved); }
    return display;
  }

  function eloFor(nameRaw) {
    return ctx.eloByNameKey.get(canonKey(resolveAlias(nameRaw))) ?? null;
  }

  function rankFor(nameRaw) {
    return ctx.rankByNameKey?.get(canonKey(resolveAlias(nameRaw))) ?? null;
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
      if (isExcludedName(c1.nameRaw) || isExcludedName(c2.nameRaw)) { matchesIgnoredBye++; continue; }
      if (c1.score == null || c2.score == null) { matchesSkippedNoScore++; continue; }

      const d1 = toDisplay(c1.nameRaw);
      const d2 = toDisplay(c2.nameRaw);
      const elo1 = eloFor(c1.nameRaw);
      const elo2 = eloFor(c2.nameRaw);
      const rank1 = rankFor(c1.nameRaw);
      const rank2 = rankFor(c2.nameRaw);

      const isC1Winner = c1.score > c2.score;
      const winner = isC1Winner
        ? { name: d1, elo: elo1, rank: rank1, score: c1.score }
        : { name: d2, elo: elo2, rank: rank2, score: c2.score };
      const loser = isC1Winner
        ? { name: d2, elo: elo2, rank: rank2, score: c2.score }
        : { name: d1, elo: elo1, rank: rank1, score: c1.score };

      const e1 = ensure(d1, elo1);
      const e2 = ensure(d2, elo2);
      e1.matches++;
      e2.matches++;
      ensure(winner.name, winner.elo).wins++;
      ensure(loser.name, loser.elo).losses++;
      matchesCounted++;

      const a = d1 < d2 ? d1 : d2;
      const b = d1 < d2 ? d2 : d1;
      const h2hKey = `${a}__${b}`;
      const h2hRow = h2h.get(h2hKey) ?? { a, b, matches: 0, aWins: 0, bWins: 0 };
      h2hRow.matches++;
      if (winner.name === h2hRow.a) h2hRow.aWins++; else h2hRow.bWins++;
      h2h.set(h2hKey, h2hRow);

      let isUpset = false;
      if (winner.rank != null && loser.rank != null) {
        // Upset: winner is ranked at least `threshold` spots below the loser,
        // using standings as of immediately before this tournament.
        // For top-10 losers the bar is lower (5 spots); otherwise 10 spots.
        const threshold = loser.rank <= 10 ? 5 : 10;
        if (winner.rank - loser.rank >= threshold) {
          ensure(winner.name, winner.elo).upsets++;
          ensure(loser.name, loser.elo).upsetLosses++;
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
    const [a0, a1, a2 = 0] = a.sortKey;
    const [b0, b1, b2 = 0] = b.sortKey;
    if (a0 !== b0) return a0 - b0;
    if (a1 !== b1) return a1 - b1;
    return a2 - b2;
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
 * Builds a copy of `ctx` whose rank/rating lookups are overridden from the
 * given rating rows. Name-display lookups (`displayByNameKey`) are left
 * untouched since those are just alias→canonical-name mappings, not
 * point-in-time standings.
 */
function contextFromRows(rows, baseCtx) {
  const rankByNameKey = new Map();
  const eloByNameKey = new Map(baseCtx.eloByNameKey);
  for (const row of rows) {
    const key = canonKey(row.name);
    rankByNameKey.set(key, row.rank);
    eloByNameKey.set(key, row.rating);
  }

  return { ...baseCtx, rankByNameKey, eloByNameKey };
}

/**
 * Builds a copy of `ctx` whose rank/rating lookups reflect standings as of
 * immediately *before* the given tournament, within that tournament's own
 * season (season-reset), so a season's upsets are judged against "at the
 * time" rankings for that season alone.
 */
async function contextForTournament(season, filename, baseCtx) {
  const { getSeasonRatingsBeforeTournament } = await import("./rating-engine.js");
  const rows = await getSeasonRatingsBeforeTournament(season, filename);
  return contextFromRows(rows, baseCtx);
}

/**
 * Builds a copy of `ctx` whose rank/rating lookups reflect the continuous
 * all-time standings as of immediately *before* the given tournament (across
 * every season, no resets), for the "All Time" view.
 */
async function contextForTournamentAllTime(season, filename, baseCtx) {
  const { getAllTimeRatingsBeforeTournament } = await import("./rating-engine.js");
  const rows = await getAllTimeRatingsBeforeTournament(season, filename);
  return contextFromRows(rows, baseCtx);
}

/**
 * Loads the roster context to use for a single tournament. By default,
 * display names and rank/rating come from that tournament's own season
 * (reset at the start of the season). Pass `{ continuous: true }` to use the
 * continuous all-time standings instead (for the "All Time" tournament
 * browser), optionally with a pre-loaded all-time `baseCtx`.
 */
export async function loadTournamentRosterContext(season, filename, baseCtx, opts = {}) {
  const continuous = opts.continuous ?? false;
  const ctx = baseCtx ?? (continuous ? await loadAllTimesRoster() : await loadSeasonRoster(season));
  return continuous
    ? contextForTournamentAllTime(season, filename, ctx)
    : contextForTournament(season, filename, ctx);
}

/**
 * Loads all tournaments for one season and aggregates per-character + h2h data.
 * By default, each tournament's upsets are computed against that season's own
 * "at the time" standings (season-reset). Pass `{ continuous: true }` to
 * instead judge upsets against the continuous all-time standings as of that
 * point (used when aggregating for the "All Time" view).
 * Returns { perChar, h2h, tournamentResults: [{name, result}] }
 */
export async function loadAndAggregateAllTournaments(season, ctx, opts = {}) {
  const continuous = opts.continuous ?? false;
  const idx = await loadTournamentIndex(season);
  const files = idx.tournaments ?? [];

  const perChar = new Map();
  const h2h = new Map();
  const tournamentResults = [];

  function mergeChar(name, elo, src) {
    if (!perChar.has(name)) {
      perChar.set(name, { matches: 0, wins: 0, losses: 0, upsets: 0, upsetLosses: 0, elo });
    }
    const dst = perChar.get(name);
    dst.matches += src.matches;
    dst.wins += src.wins;
    dst.losses += src.losses;
    dst.upsets += src.upsets;
    dst.upsetLosses += (src.upsetLosses ?? 0);
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
      const tourCtx = continuous
        ? await contextForTournamentAllTime(season, file, ctx)
        : await contextForTournament(season, file, ctx);
      const result = computeTournamentResults(text, tourCtx);
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
 * Loads and aggregates ALL seasons' data using the continuous all-time
 * standings (every tournament taken into account together, more recent
 * seasons weighted slightly more heavily) as the reference for ranks/ratings
 * and canonical names.
 * Returns { perChar, h2h, tournamentResults, ctx }
 */
export async function loadAllSeasonsData(latestSeason) {
  const ctx = await loadAllTimesRoster();
  const perChar = new Map();
  const h2h = new Map();
  const tournamentResults = [];

  for (let s = 1; s <= latestSeason; s++) {
    try {
      const agg = await loadAndAggregateAllTournaments(s, ctx, { continuous: true });

      for (const [name, stats] of agg.perChar) {
        // Map to all-time canonical name where possible
        const key = canonKey(name);
        const canonName = ctx.displayByNameKey.get(key) ?? name;
        const elo = ctx.eloByNameKey.get(key) ?? stats.elo;

        if (!perChar.has(canonName)) {
          perChar.set(canonName, { matches: 0, wins: 0, losses: 0, upsets: 0, upsetLosses: 0, elo });
        }
        const dst = perChar.get(canonName);
        dst.matches += stats.matches;
        dst.wins += stats.wins;
        dst.losses += stats.losses;
        dst.upsets += stats.upsets;
        dst.upsetLosses += (stats.upsetLosses ?? 0);
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

/** Normalise a character name into the filename stem used by image assets. */
function imageSlug(name) {
  return name.replace(/\s+/g, "").replace(/\//g, "");
}

/** Return the path to a character's stock icon image. */
export function iconPath(name) {
  return `./images/icons/${imageSlug(name)}.png`;
}

/** Return the path to a character's portrait image. */
export function portraitPath(name) {
  return `./images/portraits/${imageSlug(name).toLowerCase()}.png`;
}

/** Format a number as a percentage string. */
export function pct(n, d) {
  if (!d) return "—";
  return (n / d * 100).toFixed(1) + "%";
}
