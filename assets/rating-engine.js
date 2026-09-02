// Builds the full Glicko-2 rating history from tournament match data.
//
// This is the automated replacement for the old "Season Data" CSVs: instead of
// reading pre-computed standings, we replay every recorded match, in
// chronological order (season 1 → SEASON_COUNT, tournaments within a season in
// their listed order), updating each amiibo's Glicko-2 rating/RD/volatility as
// we go. A snapshot of the ratings is captured after each season so season
// pages can show the standings "as of" that point in time, without being
// affected by later seasons' results.

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

function tournamentKey(season, filename) {
  return `${season}::${filename}`;
}

let historyPromise = null;

async function buildHistory() {
  const players = new Map(); // canonKey -> { name, rating, rd, volatility, matches }
  const seasonSnapshots = new Map(); // season number -> snapshot rows
  const tournamentPreSnapshots = new Map(); // "season::filename" -> snapshot rows (as of just before that tournament)

  for (let season = 1; season <= SEASON_COUNT; season++) {
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
        applyMatch(players, m);
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

function getHistory() {
  if (!historyPromise) historyPromise = buildHistory();
  return historyPromise;
}

/** Ratings as of the end of the given season (players who hadn't competed yet are excluded). */
export async function getSeasonRatings(season) {
  const history = await getHistory();
  return history.seasonSnapshots.get(season) ?? [];
}

/** Ratings as of the end of the most recent season (SEASON_COUNT). */
export async function getAllTimeRatings() {
  const history = await getHistory();
  return history.finalSnapshot;
}

/**
 * Ratings as of immediately *before* the given tournament was played (i.e.
 * excluding that tournament's own results and anything that happened after
 * it). Players who hadn't competed in an earlier tournament are excluded, so
 * upsets are never judged using data from later tournaments.
 */
export async function getRatingsBeforeTournament(season, filename) {
  const history = await getHistory();
  return history.tournamentPreSnapshots.get(tournamentKey(season, filename)) ?? [];
}
