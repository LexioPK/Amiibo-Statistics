// Builds the full Glicko-2 rating history from tournament match data.
//
// This is the automated replacement for the old "Season Data" CSVs: instead of
// reading pre-computed standings, we replay recorded matches, in chronological
// order (season 1 → SEASON_COUNT, tournaments within a season in their listed
// order), updating each amiibo's Glicko-2 rating/RD/volatility as we go.
//
// A single "season-reset" replay is maintained: every player starts fresh
// from the standard starting rating/RD at the beginning of each season, so a
// season's standings only ever reflect that season's own matches. This backs
// the per-season pages/rosters (only players who actually competed that
// season appear).
//
// The "All Time" rating is derived from that same replay as a weighted
// average of each player's per-season Glicko-2 rating: every season they
// competed in contributes its own final (or, mid-season, "as of now") rating,
// weighted so more recent seasons count more heavily (see
// `computeSeasonWeights`). Seasons a player didn't compete in simply don't
// contribute — never diminishing seasons they did play, and never inventing
// results for seasons before they joined.

import {
  SEASON_COUNT,
  norm,
  canonKey,
  resolveAlias,
  isExcludedName,
  parseTournamentSections,
  parseCompetitorLine,
  loadTournamentIndex,
  loadTournamentText,
} from "./lib.js";
import {
  createPlayer,
  updateForMatch,
  inflateForInactivity,
  matchOutcomeValue,
} from "./glicko2.js";

/** Extracts { key, name, score } matches from raw tournament text, in file order. */
function extractMatchesInOrder(rawText) {
  const sections = parseTournamentSections(rawText);
  const matches = [];

  for (const section of sections) {
    const lines = section.lines;
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c1 = parseCompetitorLine(lines[i]);
      const c2 = parseCompetitorLine(lines[i + 1]);
      if (!c1 || !c2) continue;
      if (c1.bye || c2.bye) continue;
      if (c1.score == null || c2.score == null) continue;
      if (isExcludedName(c1.nameRaw) || isExcludedName(c2.nameRaw)) continue;

      const name1 = norm(resolveAlias(c1.nameRaw));
      const name2 = norm(resolveAlias(c2.nameRaw));
      const isC1Winner = c1.score > c2.score;

      matches.push({
        winnerKey: canonKey(isC1Winner ? name1 : name2),
        winnerName: isC1Winner ? name1 : name2,
        winnerScore: isC1Winner ? c1.score : c2.score,
        loserKey: canonKey(isC1Winner ? name2 : name1),
        loserName: isC1Winner ? name2 : name1,
        loserScore: isC1Winner ? c2.score : c1.score,
      });
    }
  }
  return matches;
}

function ensurePlayer(players, key, name) {
  if (!players.has(key)) {
    players.set(key, { name, ...createPlayer(), matches: 0 });
  }
  return players.get(key);
}

/** Applies one match's result to both players' ratings (using pre-match snapshots for both). */
function applyMatch(players, match) {
  const winner = ensurePlayer(players, match.winnerKey, match.winnerName);
  const loser = ensurePlayer(players, match.loserKey, match.loserName);

  const winnerPre = { rating: winner.rating, rd: winner.rd, volatility: winner.volatility };
  const loserPre = { rating: loser.rating, rd: loser.rd, volatility: loser.volatility };

  const winnerValue = matchOutcomeValue(match.winnerScore, match.loserScore);
  const loserValue = 1 - winnerValue;

  const winnerPost = updateForMatch(winnerPre, loserPre, winnerValue);
  const loserPost = updateForMatch(loserPre, winnerPre, loserValue);

  Object.assign(winner, winnerPost);
  Object.assign(loser, loserPost);
  winner.matches += 1;
  loser.matches += 1;
}

/** Produces a sorted, ranked snapshot of every player who has played at least one match so far. */
function snapshotOf(players) {
  const rows = [];
  for (const p of players.values()) {
    if (p.matches > 0) {
      rows.push({ name: p.name, rating: Math.round(p.rating), rd: Math.round(p.rd), matches: p.matches });
    }
  }
  rows.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.rd - b.rd; // lower RD (more confidence) wins ties
  });
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

/** Raw (unrounded) copy of every player who has played at least one match so far, keyed by canonKey. */
function rawSnapshotOf(players) {
  const map = new Map();
  for (const [key, p] of players) {
    if (p.matches > 0) {
      map.set(key, { name: p.name, rating: p.rating, rd: p.rd, matches: p.matches });
    }
  }
  return map;
}

function tournamentKey(season, filename) {
  return `${season}::${filename}`;
}

/**
 * Computes each season's weight as a percentage (0-100) of a 100% pool split
 * across seasons 1..seasonCount, used to weight that season's rating when
 * averaging into the "All Time" rating.
 *
 * The weights increase linearly from season 1 to the newest season, with the
 * newest season weighted exactly twice as heavily as season 1, and always
 * summing to exactly 100% — regardless of how many seasons exist, so adding
 * a new season automatically re-splits the pool with no manual re-tuning.
 *
 * Derivation: for an arithmetic sequence w_i = a + (i-1)*d (i = 1..N) with
 * w_N = 2*a (newest twice season 1) and sum(w_i) = 100, solving gives
 * a = 200 / (3N) and d = a / (N-1).
 */
function computeSeasonWeights(seasonCount) {
  if (seasonCount <= 0) return [];
  if (seasonCount === 1) return [100];

  const a = 200 / (3 * seasonCount);
  const d = a / (seasonCount - 1);
  const weights = [];
  for (let i = 1; i <= seasonCount; i++) weights.push(a + (i - 1) * d);
  return weights;
}

/**
 * Combines multiple seasons' raw rating maps into one weighted-average
 * ranked snapshot. `seasonEntries` is an array of `{ season, map }` pairs
 * (map may be undefined/missing if that season has no data yet); `weights`
 * is indexed by `season - 1` (see `computeSeasonWeights`).
 *
 * For each player, only the seasons they actually have an entry for
 * contribute to their weighted average — seasons they didn't compete in are
 * simply excluded (not treated as a zero), so missing earlier seasons never
 * drag down a newer player's rating, and missing later seasons never
 * penalize a retired player.
 */
function weightedAverageAcrossSeasons(seasonEntries, weights) {
  const combined = new Map(); // key -> { name, ratingSum, rdSum, weightSum, matches }

  for (const { season, map } of seasonEntries) {
    if (!map) continue;
    const w = weights[season - 1] ?? 0;
    if (w <= 0) continue;

    for (const [key, p] of map) {
      let entry = combined.get(key);
      if (!entry) {
        entry = { name: p.name, ratingSum: 0, rdSum: 0, weightSum: 0, matches: 0 };
        combined.set(key, entry);
      }
      entry.ratingSum += p.rating * w;
      entry.rdSum += p.rd * w;
      entry.weightSum += w;
      entry.matches += p.matches;
    }
  }

  const rows = [];
  for (const entry of combined.values()) {
    if (entry.weightSum <= 0) continue;
    rows.push({
      name: entry.name,
      rating: Math.round(entry.ratingSum / entry.weightSum),
      rd: Math.round(entry.rdSum / entry.weightSum),
      matches: entry.matches,
    });
  }

  rows.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.rd - b.rd; // lower RD (more confidence) wins ties
  });
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

/**
 * Replays every tournament from season 1..SEASON_COUNT in chronological
 * order. `players` is reset at the start of each season so that season's
 * standings only reflect its own matches (everyone effectively starts from
 * the standard starting rating/RD again).
 *
 * Records, per season: a ranked snapshot (for per-season pages) and a raw
 * (unrounded) map (for weighted-averaging into the "All Time" rating); and
 * per tournament: the same pair, captured immediately *before* that
 * tournament's matches are applied (for "at the time" upset detection).
 */
async function buildHistory() {
  let players = new Map(); // canonKey -> { name, rating, rd, volatility, matches }
  const seasonSnapshots = new Map(); // season number -> ranked snapshot rows
  const seasonRawMaps = new Map(); // season number -> raw rating map (for weighted averaging)
  const tournamentPreSnapshots = new Map(); // "season::filename" -> ranked rows (as of just before that tournament)
  const tournamentPreRawMaps = new Map(); // "season::filename" -> raw rating map (as of just before that tournament)

  for (let season = 1; season <= SEASON_COUNT; season++) {
    players = new Map();

    let files = [];
    try {
      const idx = await loadTournamentIndex(season);
      files = idx.tournaments ?? [];
    } catch (e) {
      console.warn(`Season ${season} index:`, e.message);
    }

    for (const file of files) {
      let text;
      try {
        text = await loadTournamentText(season, file);
      } catch (e) {
        console.warn(`Skipping ${file}:`, e.message);
        continue;
      }

      // Snapshot ratings as of immediately before this tournament is applied,
      // so per-tournament upset detection can use "at the time" standings.
      const key = tournamentKey(season, file);
      tournamentPreSnapshots.set(key, snapshotOf(players));
      tournamentPreRawMaps.set(key, rawSnapshotOf(players));

      const matches = extractMatchesInOrder(text);
      const participants = new Set();
      for (const m of matches) {
        participants.add(m.winnerKey);
        participants.add(m.loserKey);
        applyMatch(players, m);
      }

      // Inactivity: everyone already known who didn't play this tournament
      // becomes less certain (higher RD), without any direct rating penalty.
      for (const [pkey, p] of players) {
        if (participants.has(pkey)) continue;
        const inflated = inflateForInactivity({ rating: p.rating, rd: p.rd, volatility: p.volatility });
        p.rd = inflated.rd;
      }
    }

    seasonSnapshots.set(season, snapshotOf(players));
    seasonRawMaps.set(season, rawSnapshotOf(players));
  }

  return { seasonSnapshots, seasonRawMaps, tournamentPreSnapshots, tournamentPreRawMaps };
}

let historyPromise = null;

function getHistory() {
  if (!historyPromise) historyPromise = buildHistory();
  return historyPromise;
}

/**
 * Ratings for the given season alone: everyone starts from the standard
 * starting rating/RD at the beginning of that season, so these standings
 * only reflect that season's own matches. Players who didn't compete that
 * season are excluded (never carried over from earlier or later seasons).
 */
export async function getSeasonRatings(season) {
  const history = await getHistory();
  return history.seasonSnapshots.get(season) ?? [];
}

/**
 * All-time ratings: a weighted average of each player's per-season final
 * Glicko-2 rating, across every season they competed in, with more recent
 * seasons weighted more heavily (see `computeSeasonWeights` — the newest
 * season counts exactly twice as much as season 1, and all seasons' weights
 * sum to 100%). Seasons a player didn't compete in are simply excluded from
 * their average, so missing seasons never drag a rating down or invent
 * results before a player joined.
 */
export async function getAllTimeRatings() {
  const history = await getHistory();
  const weights = computeSeasonWeights(SEASON_COUNT);
  const seasonEntries = [];
  for (let s = 1; s <= SEASON_COUNT; s++) {
    seasonEntries.push({ season: s, map: history.seasonRawMaps.get(s) });
  }
  return weightedAverageAcrossSeasons(seasonEntries, weights);
}

/**
 * Returns each season's recency weight as a percentage (0-100) of the total
 * pool used to compute the "All Time" weighted average, e.g.
 * `[{ season: 1, percent: 9.5 }, ..., { season: 7, percent: 19.0 }]`.
 * Always sums to 100 (within floating-point rounding), with the newest
 * season weighted exactly twice season 1, and automatically re-splits
 * whenever SEASON_COUNT grows.
 */
export function getSeasonWeightBreakdown() {
  return computeSeasonWeights(SEASON_COUNT).map((percent, i) => ({ season: i + 1, percent }));
}

/**
 * Ratings as of immediately *before* the given tournament, within that
 * tournament's own season (i.e. reset at the start of the season, excluding
 * that tournament's own results and anything after it). Used so a single
 * season's upsets are judged only against that season's "at the time"
 * standings.
 */
export async function getSeasonRatingsBeforeTournament(season, filename) {
  const history = await getHistory();
  return history.tournamentPreSnapshots.get(tournamentKey(season, filename)) ?? [];
}

/**
 * "All Time" weighted-average ratings as of immediately *before* the given
 * tournament: every earlier season contributes its final rating, and the
 * tournament's own (in-progress) season contributes its "as of now" rating,
 * each weighted per `computeSeasonWeights` — excluding that tournament's own
 * results and anything from later seasons. Used so the "All Time" view's
 * upsets are judged against the weighted history at that point, not a
 * completed-season snapshot.
 */
export async function getAllTimeRatingsBeforeTournament(season, filename) {
  const history = await getHistory();
  const weights = computeSeasonWeights(SEASON_COUNT);
  const seasonEntries = [];
  for (let s = 1; s < season; s++) {
    seasonEntries.push({ season: s, map: history.seasonRawMaps.get(s) });
  }
  seasonEntries.push({ season, map: history.tournamentPreRawMaps.get(tournamentKey(season, filename)) });
  return weightedAverageAcrossSeasons(seasonEntries, weights);
}

