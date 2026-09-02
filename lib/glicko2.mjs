// Glicko-2 rating system implementation.
// Reference: Mark Glickman, "Example of the Glicko-2 system"
// http://www.glicko.net/glicko/glicko2.pdf
//
// Ratings are stored/exchanged on the familiar Glicko scale
// (rating ~1500, RD ~30-350) and converted internally to the
// Glicko-2 scale (mu, phi) for the update math.

const SCALE = 173.7178;

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350; // maximum uncertainty for a brand new player
export const DEFAULT_VOLATILITY = 0.06;
export const DEFAULT_TAU = 0.5; // system constant constraining volatility change

/**
 * Creates a new player at the standard starting rating with high
 * (low-consistency) uncertainty, as required for anyone who has not
 * yet competed.
 */
export function createPlayer(overrides = {}) {
  return {
    rating: DEFAULT_RATING,
    rd: DEFAULT_RD,
    volatility: DEFAULT_VOLATILITY,
    ...overrides,
  };
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectation(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

function toScale(player) {
  return {
    mu: (player.rating - DEFAULT_RATING) / SCALE,
    phi: player.rd / SCALE,
  };
}

function fromScale(mu, phi) {
  return {
    rating: mu * SCALE + DEFAULT_RATING,
    rd: phi * SCALE,
  };
}

/**
 * Computes the updated rating/RD/volatility for a single player after one
 * rating period.
 *
 * @param {{rating:number, rd:number, volatility:number}} player Player's
 *   rating entering the period.
 * @param {Array<{opponent:{rating:number, rd:number}, score:0|0.5|1}>} results
 *   Individual game results for the period. Each *game* (not just each
 *   match/set) should be its own entry so that, e.g., a 2-0 sweep produces a
 *   larger rating change than a 2-1 win against the same opponent.
 * @param {number} tau System volatility constraint constant.
 */
export function updateRating(player, results, tau = DEFAULT_TAU) {
  const { mu, phi } = toScale(player);
  const sigma = player.volatility ?? DEFAULT_VOLATILITY;

  if (!results || results.length === 0) {
    // Step 6 (no games played this period): rating stays put but RD grows,
    // i.e. the system becomes progressively less confident the longer a
    // player is inactive. This is the mechanism that satisfies "do not
    // punish inactive players directly, only increase their uncertainty".
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    const { rating, rd } = fromScale(mu, phiStar);
    return { rating, rd, volatility: sigma };
  }

  const games = results.map((r) => ({ ...toScale(r.opponent), score: r.score }));

  let vInv = 0;
  let sumGES = 0;
  for (const game of games) {
    const gPhi = g(game.phi);
    const e = expectation(mu, game.mu, game.phi);
    vInv += gPhi * gPhi * e * (1 - e);
    sumGES += gPhi * (game.score - e);
  }
  const v = 1 / vInv;
  const delta = v * sumGES;

  // Step 5: iterative (Illinois algorithm) solve for the new volatility.
  const a = Math.log(sigma * sigma);
  const epsilon = 0.000001;
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > epsilon) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const newVolatility = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + newVolatility * newVolatility);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + vInv);
  const newMu = mu + newPhi * newPhi * sumGES;

  const { rating, rd } = fromScale(newMu, newPhi);
  return { rating, rd, volatility: newVolatility };
}

/**
 * Expands a best-of-N set result into individual game observations so that
 * score (e.g. 2-0 vs 2-1) affects the rating change magnitude.
 *
 * @returns {{player1Games: Array<{score:number}>, player2Games: Array<{score:number}>}}
 */
export function expandSetToGames(score1, score2) {
  const player1Games = [];
  const player2Games = [];
  for (let i = 0; i < score1; i += 1) {
    player1Games.push({ score: 1 });
    player2Games.push({ score: 0 });
  }
  for (let i = 0; i < score2; i += 1) {
    player1Games.push({ score: 0 });
    player2Games.push({ score: 1 });
  }
  return { player1Games, player2Games };
}
