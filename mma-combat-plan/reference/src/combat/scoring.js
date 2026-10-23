// Judging (docs/12 §4): 12 observed components → per-round scores → 10-point-must cards for three judges → decision.
// Components and their names are observed; every formula and weight here is ours.

import { JUDGE_COMPONENTS, FightResultType, TICK_HZ } from '../core/taxonomy.js';
import { clamp } from '../core/math.js';

const share = (mine, theirs) => (mine + theirs > 1e-12 ? mine / (mine + theirs) : 0.5);
const EVENTS = ['wobbled_shot', 'stun', 'critical_stun', 'knockdown', 'liver_shot', 'limping'];

/** Raw (un-normalised) value of each of the 12 components for fighter `f` against `o` in `round`. */
export function rawComponents(stats, f, o, round, tun) {
  const g = (x, key) => stats.get(x.id, key, round);
  const { targetValue: tv, eventValue: ev } = tun.scoring;
  const accuracy = g(f, 'strikes.thrown') > 0 ? g(f, 'strikes.landed') / g(f, 'strikes.thrown') : 0;
  const poolMax = o.pools.head.max + o.pools.body.max + o.pools.legL.max + o.pools.legR.max;
  const defended = ['blocked', 'parried', 'slipped', 'caught', 'evaded'].reduce((s, k) => s + g(f, `defense.${k}`), 0);
  const faced = g(o, 'strikes.thrown');
  const gnp = g(f, 'strikes.landed.ground');
  return {
    effective_striking: (tv.head * g(f, 'strikes.sig.landed.head') + tv.body * g(f, 'strikes.sig.landed.body') + tv.leg * g(f, 'strikes.sig.landed.leg')) * (0.85 + 0.3 * accuracy),
    damage: g(f, 'damage.dealt') / poolMax,
    health_events: EVENTS.reduce((s, k) => s + (ev[k] ?? 0) * g(f, `events.inflicted.${k}`), 0),
    blocks_and_parries: faced > 0 ? defended / faced : 0,
    clinch_dominance: g(f, 'time.clinch.dom') / TICK_HZ + 2 * g(f, 'strikes.landed.clinch'),
    ground_dominance: (g(f, 'time.ground.dominant') / TICK_HZ) * (1 + 0.1 * gnp),
    takedowns_performed: g(f, 'takedowns.landed'),
    takedowns_denied: 0.4 * g(f, 'takedowns.denied'),
    passes_performed: g(f, 'passes.landed'),
    passes_denied: 0.5 * g(f, 'passes.denied'),
    submissions: g(f, 'subs.depth') + 0.5 * g(f, 'subs.attempted'),
    submissions_escaped: g(f, 'subs.escaped'),
  };
}

/** Judges: jittered weights plus one style bias each. */
const BIASES = {
  damage: { damage: 1.3, health_events: 1.3 },
  grappling: { takedowns_performed: 1.4, takedowns_denied: 1.4, ground_dominance: 1.4, passes_performed: 1.4, passes_denied: 1.4, submissions: 1.4, submissions_escaped: 1.4, clinch_dominance: 1.2 },
  activity: { effective_striking: 1.3, blocks_and_parries: 1.2 },
};
export const JUDGE_BIASES = Object.freeze(Object.keys(BIASES));

export function makeJudges(rng, tun, n = 3) {
  const order = [...JUDGE_BIASES];
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  return Array.from({ length: n }, (_, i) => {
    const bias = order[i % order.length];
    const w = {};
    let total = 0;
    for (const c of JUDGE_COMPONENTS) {
      w[c] = tun.scoring.weights[c] * (1 + (rng.next() * 2 - 1) * tun.scoring.judgeWeightJitter) * (BIASES[bias][c] ?? 1);
      total += w[c];
    }
    for (const c of JUDGE_COMPONENTS) w[c] /= total;
    return { id: i, bias, weights: w };
  });
}
/** A neutral judge using the base weights (used for in-fight "who is winning" estimates). */
export const neutralJudge = (tun) => ({ id: -1, bias: 'none', weights: { ...tun.scoring.weights } });

/** Score one round for one judge. Returns the continuous scores, the 10-point card and the reasons for a 10-8 / 10-7. */
export function scoreRound(stats, fa, fb, round, tun, judge = neutralJudge(tun)) {
  const ra = rawComponents(stats, fa, fb, round, tun), rb = rawComponents(stats, fb, fa, round, tun);
  let Sa = 0, Sb = 0;
  const shares = {};
  for (const c of JUDGE_COMPONENTS) {
    const sa = share(ra[c], rb[c]);
    shares[c] = sa;
    Sa += judge.weights[c] * sa; Sb += judge.weights[c] * (1 - sa);
  }
  const delta = Sa - Sb;
  const sc = tun.scoring;
  if (Math.abs(delta) < sc.drawMargin) return { round, Sa, Sb, delta, a: 10, b: 10, winner: null, criteria: [], shares };
  const winner = delta > 0 ? fa : fb, loser = delta > 0 ? fb : fa;
  const lg = (key) => stats.get(loser.id, key, round);
  const criteria = [];
  if (Math.abs(delta) >= sc.ten8Margin) criteria.push('margin');
  const events = EVENTS.reduce((s, k) => s + lg(`events.${k}`), 0);
  const clear = Math.abs(delta) >= sc.ten8SoftMargin;                           // a knockdown / ground control only makes a 10-8 in a round the winner clearly won
  if (clear && lg('events.knockdown') >= 1 && events >= 2) criteria.push('knockdown');
  if (clear && stats.get(winner.id, 'time.ground.dominant', round) >= 120 * TICK_HZ && stats.get(winner.id, 'strikes.landed.ground', round) >= 10) criteria.push('ground_dominance');
  const loserPoints = criteria.length >= 2 && Math.abs(delta) >= sc.ten7Margin ? 7 : criteria.length >= 1 ? 8 : 9;
  const pts = delta > 0 ? { a: 10, b: loserPoints } : { a: loserPoints, b: 10 };
  return { round, Sa, Sb, delta, ...pts, winner: winner.id, criteria, shares };
}

/** Result classification from the three judges' totals (docs/12 §4, real-world definitions). */
export function classifyDecision(verdicts) {
  const n = (v) => verdicts.filter((x) => x === v).length;
  const a = n('a'), b = n('b'), d = n('draw');
  if (a + b === 0) return { result: FightResultType.DRAW, winner: null };
  if (d === 2) return { result: FightResultType.MAJORITY_DRAW, winner: null };
  if (a > 0 && b > 0 && a === b) return { result: FightResultType.DRAW, winner: null };       // split draw (A, B, draw)
  const winner = a > b ? 'a' : 'b';
  const w = Math.max(a, b);
  if (w === verdicts.length) return { result: FightResultType.UNANIMOUS, winner };
  if (d >= 1) return { result: FightResultType.MAJORITY, winner };
  return { result: FightResultType.SPLIT, winner };
}

/** Score the whole fight over `rounds` (array of round numbers). */
export function scoreFight(stats, fa, fb, rounds, tun, judges) {
  const cards = judges.map((j) => {
    const rs = rounds.map((r) => scoreRound(stats, fa, fb, r, tun, j));
    const a = rs.reduce((s, x) => s + x.a, 0), b = rs.reduce((s, x) => s + x.b, 0);
    return { judge: j.id, bias: j.bias, rounds: rs, a, b, verdict: a > b ? 'a' : b > a ? 'b' : 'draw' };
  });
  const { result, winner } = classifyDecision(cards.map((c) => c.verdict));
  return { cards, result, winner: winner === 'a' ? fa.id : winner === 'b' ? fb.id : null };
}

/** −1 (losing badly) … +1 (winning badly) for `f`, from the neutral judge over the rounds so far (AI input `score_differential`). */
export function scoreDifferential(stats, f, o, rounds, tun) {
  if (!rounds.length) return 0;
  const sign = f.index === 0 ? 1 : -1;
  const fa = f.index === 0 ? f : o, fb = f.index === 0 ? o : f;
  let sum = 0;
  for (const r of rounds) sum += scoreRound(stats, fa, fb, r, tun).delta;
  return clamp(sign * (sum / rounds.length) * 2, -1, 1);
}
