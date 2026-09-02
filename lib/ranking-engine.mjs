// Orchestrates Glicko-2 rating updates across a chronological sequence of
// tournaments ("rating periods"), producing per-season leaderboard
// snapshots.
//
// Design goals (see problem statement for the full rules):
//  - Every new competitor starts at 1500 / RD 350 the moment they first
//    appear in a match, never before (no retroactive penalty for players
//    who join later).
//  - Ratings move per individual game within a set, so a 2-0 sweep moves
//    the rating more than a narrow 2-1 win over the same opponent.
//  - A player who is registered but doesn't compete in a given period still
//    has their RD grow (uncertainty increases) even though their rating
//    stays unchanged - this is inactivity handling without direct
//    punishment.
//  - A season's leaderboard only lists players who actually competed that
//    season.
import { createPlayer, updateRating, expandSetToGames, DEFAULT_TAU } from './glicko2.mjs';

/**
 * @typedef {Object} Match
 * @property {string} player1
 * @property {string} player2
 * @property {number} score1 games won by player1 in the set
 * @property {number} score2 games won by player2 in the set
 *
 * @typedef {Object} RatingPeriod
 * @property {number|string} season
 * @property {string} tournament
 * @property {Match[]} matches
 */

/**
 * @param {RatingPeriod[]} periods Rating periods in chronological order.
 * @param {number} tau Glicko-2 system constant.
 */
export function runRankingEngine(periods, tau = DEFAULT_TAU) {
  const players = new Map(); // name -> {rating, rd, volatility}
  const seasonParticipants = new Map(); // season -> Set<name>
  const seasonOrder = [];
  const seasonSnapshots = new Map(); // season -> [{name, rating, rd, volatility}]

  const ensurePlayer = (name) => {
    if (!players.has(name)) players.set(name, createPlayer());
    return players.get(name);
  };

  const snapshotSeason = (season) => {
    const participants = seasonParticipants.get(season);
    if (!participants) return;
    const rows = [...participants].map((name) => ({ name, ...players.get(name) }));
    rows.sort((a, b) => b.rating - a.rating || a.rd - b.rd);
    seasonSnapshots.set(season, rows);
  };

  let currentSeason;

  for (const period of periods) {
    const { season, matches } = period;

    if (currentSeason !== undefined && season !== currentSeason) {
      snapshotSeason(currentSeason);
    }
    currentSeason = season;

    if (!seasonParticipants.has(season)) seasonParticipants.set(season, new Set());
    if (!seasonOrder.includes(season)) seasonOrder.push(season);
    const participants = seasonParticipants.get(season);

    // Snapshot ratings as they stood at the *start* of this period: every
    // player in a period is compared against opponents' pre-period rating,
    // never a rating already updated earlier in the same period.
    const startOfPeriod = new Map();
    for (const [name, p] of players) startOfPeriod.set(name, { ...p });
    const getStart = (name) => startOfPeriod.get(name) ?? players.get(name);

    const gamesByPlayer = new Map(); // name -> [{opponent, score}]
    const addGame = (name, opponent, score) => {
      if (!gamesByPlayer.has(name)) gamesByPlayer.set(name, []);
      gamesByPlayer.get(name).push({ opponent, score });
    };

    for (const match of matches ?? []) {
      const { player1, player2, score1, score2 } = match;
      ensurePlayer(player1);
      ensurePlayer(player2);
      participants.add(player1);
      participants.add(player2);

      const opp1 = getStart(player1);
      const opp2 = getStart(player2);
      const { player1Games, player2Games } = expandSetToGames(score1, score2);
      for (const g of player1Games) addGame(player1, opp2, g.score);
      for (const g of player2Games) addGame(player2, opp1, g.score);
    }

    for (const [name] of players) {
      const results = gamesByPlayer.get(name);
      const base = startOfPeriod.get(name) ?? players.get(name);
      players.set(name, updateRating(base, results, tau));
    }
  }

  if (currentSeason !== undefined) snapshotSeason(currentSeason);

  const finalRatings = [...players.entries()]
    .map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => b.rating - a.rating || a.rd - b.rd);

  return {
    seasons: seasonOrder,
    seasonSnapshots,
    finalRatings,
  };
}
