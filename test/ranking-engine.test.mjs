import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRankingEngine } from '../lib/ranking-engine.mjs';

test('a season leaderboard only includes players who competed that season', () => {
  const periods = [
    {
      season: 1,
      tournament: 'Season 1 Major',
      matches: [{ player1: 'Mario', player2: 'Luigi', score1: 2, score2: 0 }],
    },
    {
      season: 2,
      tournament: 'Season 2 Major',
      matches: [{ player1: 'Mario', player2: 'Peach', score1: 2, score2: 1 }],
    },
  ];

  const { seasonSnapshots } = runRankingEngine(periods);

  const season1Names = seasonSnapshots.get(1).map((p) => p.name).sort();
  const season2Names = seasonSnapshots.get(2).map((p) => p.name).sort();

  assert.deepEqual(season1Names, ['Luigi', 'Mario']);
  assert.deepEqual(season2Names, ['Mario', 'Peach']);
  // Luigi never played in season 2 and must not appear there.
  assert.ok(!season2Names.includes('Luigi'));
});

test('a player entering in a later season starts fresh instead of inheriting missed history', () => {
  const periods = [
    { season: 1, tournament: 'S1', matches: [{ player1: 'Mario', player2: 'Luigi', score1: 2, score2: 0 }] },
    { season: 2, tournament: 'S2', matches: [{ player1: 'Mario', player2: 'Luigi', score1: 2, score2: 1 }] },
    // Newcomer "Yoshi" only shows up in season 3.
    { season: 3, tournament: 'S3', matches: [{ player1: 'Yoshi', player2: 'Mario', score1: 2, score2: 0 }] },
  ];

  const { seasonSnapshots } = runRankingEngine(periods);
  const season3 = seasonSnapshots.get(3);
  const yoshi = season3.find((p) => p.name === 'Yoshi');

  assert.ok(yoshi);
  // Newcomer should have high uncertainty (close to the 350 default) since
  // this is their first tournament, not a decayed/inherited value.
  assert.ok(yoshi.rd > 200);
});

test('inactive players are not present in a season they skipped, and regain visibility if they return', () => {
  const periods = [
    { season: 1, tournament: 'S1', matches: [{ player1: 'Mario', player2: 'Luigi', score1: 2, score2: 0 }] },
    // Luigi sits out season 2 entirely.
    { season: 2, tournament: 'S2', matches: [{ player1: 'Mario', player2: 'Peach', score1: 2, score2: 1 }] },
    { season: 3, tournament: 'S3', matches: [{ player1: 'Luigi', player2: 'Peach', score1: 2, score2: 0 }] },
  ];

  const { seasonSnapshots } = runRankingEngine(periods);
  assert.ok(!seasonSnapshots.get(2).some((p) => p.name === 'Luigi'));
  assert.ok(seasonSnapshots.get(3).some((p) => p.name === 'Luigi'));
});

test('final ranking sorts by rating desc, using RD as a tiebreaker', () => {
  const periods = [
    { season: 1, tournament: 'S1', matches: [{ player1: 'A', player2: 'B', score1: 2, score2: 0 }] },
  ];
  const { finalRatings } = runRankingEngine(periods);
  assert.equal(finalRatings[0].name, 'A');
  for (let i = 1; i < finalRatings.length; i += 1) {
    const prev = finalRatings[i - 1];
    const curr = finalRatings[i];
    assert.ok(prev.rating > curr.rating || (prev.rating === curr.rating && prev.rd <= curr.rd));
  }
});
