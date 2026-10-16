// Judging: three judges score every round on the 10-point-must system from what happened in it (strikes, damage,
// knockdowns, takedowns, control), each with a small seeded leaning toward striking or grappling.

import { muldiv } from './math';
import type { DecisionKind, FightState, JudgeCard, RoundStats, Side } from './types';

/** One fighter's round score (unitless) as one judge sees it. */
function roundPoints(r: RoundStats, strikingPm: number, grapplingPm: number): number {
  const striking =
    r.power * 30 + (r.landed - r.power) * 12 + muldiv(r.headDmg, 1, 18) + muldiv(r.bodyDmg, 1, 26) + muldiv(r.legDmg, 1, 28) + r.knockdowns * 420;
  const grappling = r.takedowns * 120 + muldiv(r.controlTicks, 1, 7) + r.subAttempts * 60;
  return muldiv(striking, strikingPm, 1000) + muldiv(grappling, grapplingPm, 1000);
}

/** Score one round for one judge: [fighter 0, fighter 1]. */
export function scoreRound(
  r: [RoundStats, RoundStats],
  judge: { striking: number; grappling: number; nudge: number },
): [number, number] {
  const a = roundPoints(r[0], judge.striking, judge.grappling);
  const b = roundPoints(r[1], judge.striking, judge.grappling);
  if (a === 0 && b === 0) return [10, 10];
  // a close round goes to the judge's leaning; only a genuinely level round is a 10-10
  const margin = Math.abs(a - b);
  const close = margin * 100 < Math.max(a, b) * 4; // within 4 %
  let winner: Side | null = a > b ? 0 : b > a ? 1 : null;
  if (close) winner = judge.nudge > 0 ? 0 : judge.nudge < 0 ? 1 : winner;
  if (winner === null) return [10, 10];
  const w = winner === 0 ? a : b;
  const l = winner === 0 ? b : a;
  const kdW = r[winner].knockdowns;
  const kdL = r[winner === 0 ? 1 : 0].knockdowns;
  const dominant = kdW - kdL >= 2 || (w > 900 && w > l * 3);
  const lose = dominant ? 8 : 9;
  return winner === 0 ? [10, lose] : [lose, 10];
}

/** All three judges' cards for the rounds fought so far (`rounds` = how many rounds count). */
export function judgeCards(s: FightState, rounds: number): JudgeCard[] {
  return s.judges.map(j => {
    const card: JudgeCard = { rounds: [], total: [0, 0] };
    for (let i = 0; i < rounds && i < s.stats.length; i++) {
      const sc = scoreRound(s.stats[i], j);
      card.rounds.push(sc);
      card.total[0] += sc[0];
      card.total[1] += sc[1];
    }
    return card;
  });
}

/** Decide the fight from the judges' cards. */
export function decide(cards: JudgeCard[]): { winner: Side | null; decision: DecisionKind } {
  let a = 0;
  let b = 0;
  for (const c of cards) {
    if (c.total[0] > c.total[1]) a++;
    else if (c.total[1] > c.total[0]) b++;
  }
  const draws = cards.length - a - b;
  if (a === cards.length) return { winner: 0, decision: 'unanimous' };
  if (b === cards.length) return { winner: 1, decision: 'unanimous' };
  if (a === 2 && b === 1) return { winner: 0, decision: 'split' };
  if (b === 2 && a === 1) return { winner: 1, decision: 'split' };
  if (a === 2 && draws === 1) return { winner: 0, decision: 'majority' };
  if (b === 2 && draws === 1) return { winner: 1, decision: 'majority' };
  return { winner: null, decision: 'draw' };
}
