// Glicko-2 rating system core math.
// Reference: Mark Glickman, "Example of the Glicko-2 system"
// (http://www.glicko.net/glicko/glicko2.pdf)

/** Conversion factor between Glicko-2's internal scale and the display rating scale. */
export const GLICKO_SCALE = 173.7178;

/** Every new player starts at this rating. */
export const DEFAULT_RATING = 2000;

/** Every new player starts with this (high) rating deviation, i.e. high uncertainty. */
export const DEFAULT_RD = 350;

/** Every new player starts with this volatility. */
export const DEFAULT_VOLATILITY = 0.06;

/** System constant that constrains how much volatility can change over time. */
export const DEFAULT_TAU = 0.5;

/** RD is clamped to this range so it never becomes unrealistically small or large. */
export const MIN_RD = 30;
export const MAX_RD = 350;

function toMu(rating) {
  return (rating - DEFAULT_RATING) / GLICKO_SCALE;
}

function toPhi(rd) {
  return rd / GLICKO_SCALE;
}

function fromMu(mu) {
  return mu * GLICKO_SCALE + DEFAULT_RATING;
}

function fromPhi(phi) {
  return phi * GLICKO_SCALE;
}

function clampRd(rd) {
  return Math.min(MAX_RD, Math.max(MIN_RD, rd));
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** Expected score (win probability) of a player (mu) against an opponent (muj, phij). */
function E(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

/** Creates a brand-new player at the default rating/RD/volatility. */
export function createPlayer() {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, volatility: DEFAULT_VOLATILITY };
}

/**
 * Public helper: win probability of player `a` against player `b`, using their
 * current rating and RD (matches the standard Glicko-2 expectation function).
 */
export function expectedScore(a, b) {
  return E(toMu(a.rating), toMu(b.rating), toPhi(b.rd));
}

/**
 * Converts a best-of-N match score into a soft outcome value in [0, 1] for the
 * winner (the loser's value is `1 - winnerScore`).
 *
 * A "clean sweep" (loser has 0 games) always yields the maximum value (1),
 * regardless of whether it was a 1-0, 2-0, or 3-0 - so a single-game bo1 sweep
 * counts exactly as much as a bo5 3-0 sweep. Closer sets (e.g. 3-2) are scaled
 * down proportionally to how many games the winner dropped relative to how
 * many they won.
 */
export function matchOutcomeValue(winnerGames, loserGames) {
  const w = Math.max(0, winnerGames);
  const l = Math.max(0, loserGames);
  if (w <= 0) return 0.5;
  const closeness = Math.min(1, l / w);
  // Blend between a decisive win (1.0) and a draw-like result (0.5) based on closeness.
  return 1 - closeness * 0.5;
}

/**
 * Applies a single Glicko-2 rating period update for one player against a list
 * of opponents faced during that period.
 *
 * `results`: [{ rating, rd, score }], where `score` is the player's outcome
 * against that opponent (1 = win, 0 = loss, 0.5 = draw, or any soft value in
 * between produced by `matchOutcomeValue`).
 *
 * When `results` is empty, only the "no games played" RD-inflation step runs
 * (see Glickman's Step 6): the rating and volatility stay the same, but RD
 * grows to reflect increased uncertainty about a player who didn't compete.
 */
export function updateRatingPeriod(player, results, { tau = DEFAULT_TAU } = {}) {
  const mu = toMu(player.rating);
  const phi = toPhi(player.rd);
  const sigma = player.volatility ?? DEFAULT_VOLATILITY;

  if (!results.length) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: clampRd(fromPhi(phiStar)), volatility: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const r of results) {
    const muj = toMu(r.rating);
    const phij = toPhi(r.rd);
    const gj = g(phij);
    const Ej = E(mu, muj, phij);
    vInv += gj * gj * Ej * (1 - Ej);
    deltaSum += gj * (r.score - Ej);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: iteratively solve for the new volatility (Illinois algorithm).
  const a = Math.log(sigma * sigma);
  function f(x) {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  }

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);
  let iterations = 0;
  while (Math.abs(B - A) > 0.000001 && iterations < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
    iterations++;
  }
  const newSigma = Math.exp(A / 2);

  // Step 6/7: update RD and rating.
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  return { rating: fromMu(newMu), rd: clampRd(fromPhi(newPhi)), volatility: newSigma };
}

/** Convenience wrapper for updating a single player against a single opponent (one match). */
export function updateForMatch(player, opponent, score, opts) {
  return updateRatingPeriod(player, [{ rating: opponent.rating, rd: opponent.rd, score }], opts);
}

/** Convenience wrapper for the "player did not compete this period" RD-inflation step. */
export function inflateForInactivity(player, opts) {
  return updateRatingPeriod(player, [], opts);
}
