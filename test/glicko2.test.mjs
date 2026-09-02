import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, updateRating, expandSetToGames, DEFAULT_RATING, DEFAULT_RD } from '../lib/glicko2.mjs';

test('new player starts at 1500 rating with high (350) uncertainty', () => {
  const p = createPlayer();
  assert.equal(p.rating, DEFAULT_RATING);
  assert.equal(p.rd, DEFAULT_RD);
});

test('beating a higher rated opponent gains more rating than beating a lower rated one', () => {
  const player = createPlayer();
  const strongOpponent = createPlayer({ rating: 1800, rd: 50 });
  const weakOpponent = createPlayer({ rating: 1200, rd: 50 });

  const afterBeatingStrong = updateRating(player, [{ opponent: strongOpponent, score: 1 }]);
  const afterBeatingWeak = updateRating(player, [{ opponent: weakOpponent, score: 1 }]);

  assert.ok(afterBeatingStrong.rating > afterBeatingWeak.rating);
});

test('losing to a higher rated opponent hurts less than losing to a lower rated one', () => {
  const player = createPlayer({ rating: 1500, rd: 50 });
  const strongOpponent = createPlayer({ rating: 1800, rd: 50 });
  const weakOpponent = createPlayer({ rating: 1200, rd: 50 });

  const afterLosingToStrong = updateRating(player, [{ opponent: strongOpponent, score: 0 }]);
  const afterLosingToWeak = updateRating(player, [{ opponent: weakOpponent, score: 0 }]);

  assert.ok(afterLosingToStrong.rating > afterLosingToWeak.rating);
});

test('RD decreases as a player competes more', () => {
  const opponent = createPlayer({ rating: 1500, rd: 100 });
  let player = createPlayer();
  for (let i = 0; i < 5; i += 1) {
    player = updateRating(player, [{ opponent, score: 1 }]);
  }
  assert.ok(player.rd < DEFAULT_RD);
});

test('RD grows (uncertainty increases) for an inactive period instead of changing rating', () => {
  const player = createPlayer({ rating: 1600, rd: 60 });
  const afterInactivePeriod = updateRating(player, []);
  assert.equal(afterInactivePeriod.rating, player.rating);
  assert.ok(afterInactivePeriod.rd > player.rd);
});

test('a 2-0 sweep produces a bigger rating gain than a narrow 2-1 win over the same opponent', () => {
  const opponent = createPlayer({ rating: 1500, rd: 60 });
  const player = createPlayer({ rating: 1500, rd: 60 });

  const sweep = expandSetToGames(2, 0);
  const narrowWin = expandSetToGames(2, 1);

  const afterSweep = updateRating(
    player,
    sweep.player1Games.map((g) => ({ opponent, score: g.score })),
  );
  const afterNarrowWin = updateRating(
    player,
    narrowWin.player1Games.map((g) => ({ opponent, score: g.score })),
  );

  assert.ok(afterSweep.rating > afterNarrowWin.rating);
});
