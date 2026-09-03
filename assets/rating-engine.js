// Builds the full Glicko-2 rating history from tournament match data.
//
// This is the automated replacement for the old "Season Data" CSVs: instead of
// reading pre-computed standings, we replay recorded matches, in chronological
// order (season 1 → SEASON_COUNT, tournaments within a season in their listed
// order), updating each amiibo's Glicko-2 rating/RD/volatility as we go.
//
// Two independent replays are maintained:
//   - A "season-reset" replay: every player starts fresh from the standard
//     starting rating/RD at the beginning of each season, so a season's
//     standings only ever reflect that season's own matches. This backs the
//     per-season pages/rosters and only includes players who actually
//     competed that season.
//   - A single continuous replay across every tournament ever recorded, with
//     no resets, which backs the "All Time" pages so they take every
//     tournament into account together.

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

/** Applies one match's result to both players' ratings (using pre-match snapshots for both).
 * `weight` (default 1) scales how much this match's *rating* change counts —
 * used to give more recent seasons slightly more influence on the continuous
 * all-time rating without touching RD/volatility (uncertainty) tracking or
 * retroactively altering what earlier matches already contributed.
 */
function applyMatch(players, match, weight = 1) {
  const winner = ensurePlayer(players, match.winnerKey, match.winnerName);
  const loser = ensurePlayer(players, match.loserKey, match.loserName);

  const winnerPre = { rating: winner.rating, rd: winner.rd, volatility: winner.volatility };
  const loserPre = { rating: loser.rating, rd: loser.rd, volatility: loser.volatility };

  const winnerValue = matchOutcomeValue(match.winnerScore, match.loserScore);
  const loserValue = 1 - winnerValue;

  const winnerPost = updateForMatch(winnerPre, loserPre, winnerValue);
  const loserPost = updateForMatch(loserPre, winnerPre, loserValue);

  if (weight === 1) {
    Object.assign(winner, winnerPost);
    Object.assign(loser, loserPost);
  } else {
    winner.rating = winnerPre.rating + weight * (winnerPost.rating - winnerPre.rating);
    winner.rd = winnerPost.rd;
    winner.volatility = winnerPost.volatility;
    loser.rating = loserPre.rating + weight * (loserPost.rating - loserPre.rating);
    loser.rd = loserPost.rd;
    loser.volatility = loserPost.volatility;
  }
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

function tournamentKey(season, filename) {
  return `${season}::${filename}`;
}

/**
 * Recency weight applied to a match's *rating* impact in the continuous
 * all-time replay: each season's matches count slightly more than the
 * previous season's, so recent performance moves the all-time rating more
 * than older performance — without diminishing what earlier seasons already
 * contributed. Not drastic: season 1 is baseline (1.0x), and weight grows by
 * a fixed step per season (season SEASON_COUNT is at most ~1.3x baseline).
 */
const SEASON_WEIGHT_STEP = 0.04;
function seasonWeight(season) {
  return 1 + SEASON_WEIGHT_STEP * (season - 1);
}

/**
 * Replays every tournament from season 1..SEASON_COUNT in chronological
 * order, applying matches to a shared `players` map.
 *
 * If `resetPerSeason` is true, `players` is cleared at the start of each
 * season so that season's standings only reflect its own matches (everyone
 * effectively starts from the standard starting rating/RD again) — used for
 * the per-season pages/rosters.
 *
 * If `resetPerSeason` is false, `players` persists across every season with
 * no resets (the continuous "All Time" replay), and each match's rating
 * impact is scaled by `seasonWeight(season)` so more recent seasons carry
 * slightly more weight without erasing earlier results.
 */
async function replayAll({ resetPerSeason }) {
  let players = new Map(); // canonKey -> { name, rating, rd, volatility, matches }
  const seasonSnapshots = new Map(); // season number -> snapshot rows
  const tournamentPreSnapshots = new Map(); // "season::filename" -> snapshot rows (as of just before that tournament)

  for (let season = 1; season <= SEASON_COUNT; season++) {
    if (resetPerSeason) players = new Map();
    const weight = resetPerSeason ? 1 : seasonWeight(season);

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
      tournamentPreSnapshots.set(tournamentKey(season, file), snapshotOf(players));

      const matches = extractMatchesInOrder(text);
      const participants = new Set();
      for (const m of matches) {
        participants.add(m.winnerKey);
        participants.add(m.loserKey);
        applyMatch(players, m, weight);
      }

      // Inactivity: everyone already known who didn't play this tournament
      // becomes less certain (higher RD), without any direct rating penalty.
      for (const [key, p] of players) {
        if (participants.has(key)) continue;
        const inflated = inflateForInactivity({ rating: p.rating, rd: p.rd, volatility: p.volatility });
        p.rd = inflated.rd;
      }
    }

    seasonSnapshots.set(season, snapshotOf(players));
  }

  return { seasonSnapshots, finalSnapshot: snapshotOf(players), tournamentPreSnapshots };
}

let seasonResetHistoryPromise = null;
let continuousHistoryPromise = null;

function getSeasonResetHistory() {
  if (!seasonResetHistoryPromise) seasonResetHistoryPromise = replayAll({ resetPerSeason: true });
  return seasonResetHistoryPromise;
}

function getContinuousHistory() {
  if (!continuousHistoryPromise) continuousHistoryPromise = replayAll({ resetPerSeason: false });
  return continuousHistoryPromise;
}

/**
 * Ratings for the given season alone: everyone starts from the standard
 * starting rating/RD at the beginning of that season, so these standings
 * only reflect that season's own matches. Players who didn't compete that
 * season are excluded (never carried over from earlier or later seasons).
 */
export async function getSeasonRatings(season) {
  const history = await getSeasonResetHistory();
  return history.seasonSnapshots.get(season) ?? [];
}

/**
 * All-time ratings from the single continuous replay across every recorded
 * tournament (no resets), with more recent seasons weighted slightly more
 * heavily (see `seasonWeight`).
 */
export async function getAllTimeRatings() {
  const history = await getContinuousHistory();
  return history.finalSnapshot;
}

/**
 * Ratings as of immediately *before* the given tournament, within that
 * tournament's own season (i.e. reset at the start of the season, excluding
 * that tournament's own results and anything after it). Used so a single
 * season's upsets are judged only against that season's "at the time"
 * standings.
 */
export async function getSeasonRatingsBeforeTournament(season, filename) {
  const history = await getSeasonResetHistory();
  return history.tournamentPreSnapshots.get(tournamentKey(season, filename)) ?? [];
}

/**
 * Continuous all-time ratings as of immediately *before* the given
 * tournament (excluding that tournament's own results and anything after
 * it, across every season). Used so the "All Time" view's upsets are judged
 * against the full cross-season history at that point, not a per-season
 * reset.
 */
export async function getAllTimeRatingsBeforeTournament(season, filename) {
  const history = await getContinuousHistory();
  return history.tournamentPreSnapshots.get(tournamentKey(season, filename)) ?? [];
}
