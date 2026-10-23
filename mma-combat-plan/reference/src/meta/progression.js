// Minimal progression (docs/15 §3): training belts from a score or a combo count, and spending rating points under a cap.

export const BELTS = Object.freeze(['white', 'blue', 'purple', 'brown', 'black']);

export function validateThresholds(th) {
  if (th.length !== BELTS.length - 1) return false;
  for (let i = 1; i < th.length; i++) if (!(th[i] > th[i - 1])) return false;
  return th[0] > 0;
}

/** Belt for a score (score mode): the highest belt whose threshold is reached; white below the first. */
export function beltFromScore(score, thresholds) {
  if (!validateThresholds(thresholds)) throw new Error('thresholds must be strictly ascending (blue, purple, brown, black)');
  let belt = 0;
  for (let i = 0; i < thresholds.length; i++) if (score >= thresholds[i]) belt = i + 1;
  return BELTS[belt];
}

/** Belt for a combo drill (combo mode): thresholds are fractions of the total combos landed. */
export function beltFromCombos(done, total, fractions = [0.25, 0.5, 0.75, 1.0]) {
  return beltFromScore(total > 0 ? done / total : 0, fractions);
}

/** Spend `points` across ratings without exceeding `cap`; returns the new ratings and the leftover points. */
export function spendRatingPoints(ratings, allocation, points, cap = 100) {
  const out = { ...ratings };
  let left = points;
  for (const [name, want] of Object.entries(allocation)) {
    const add = Math.max(0, Math.min(want, left, cap - (out[name] ?? 0)));
    out[name] = (out[name] ?? 0) + add;
    left -= add;
  }
  return { ratings: out, left };
}
