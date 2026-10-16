// The player's fight record across all modes, for the Play Games leaderboards: wins (save.wins), knockouts (KO and
// TKO wins) and the best single win, scored by `fightScore`. Play Games keeps each player's best per day, week and
// all time, so the "best win" board doubles as the weekly ranking. Saved in the 'record' progress slot.

import type { FightResult } from '../game/fight/types';
import { int, obj } from './sanitize';
import { registerProgressSlot } from './save';

export interface RecordState {
  v: 1;
  /** KO and TKO wins */
  kos: number;
  subs: number;
  /** best fightScore so far */
  best: number;
}

declare module './save' {
  interface ProgressSlots {
    record: RecordState;
  }
}

export function freshRecord(): RecordState {
  return { v: 1, kos: 0, subs: 0, best: 0 };
}

export function sanitizeRecord(raw: unknown): RecordState {
  const o = obj(raw);
  return { v: 1, kos: int(o.kos, 0, 0, 1_000_000), subs: int(o.subs, 0, 0, 1_000_000), best: int(o.best, 0, 0, 100_000) };
}

registerProgressSlot('record', { fresh: freshRecord, sanitize: sanitizeRecord });

const METHOD_BONUS: Record<FightResult['method'], number> = { KO: 600, TKO: 450, SUB: 500, DEC: 0 };

/**
 * One win's score: a finish beats a decision, a quick finish beats a late one, and a stronger, harder opponent counts
 * for more. 0 for a loss or draw. Whole numbers only (Play Games scores are integers).
 */
export function fightScore(r: Pick<FightResult, 'winner' | 'method'>, seconds: number, oppOverall: number, difficulty: number): number {
  if (r.winner !== 0) return 0;
  const quick = Math.max(0, 900 - Math.floor(Math.max(0, seconds)));
  const opp = Math.max(0, Math.min(99, Math.round(oppOverall))) * 10;
  const hard = Math.floor(Math.max(0, Math.min(1000, Math.round(difficulty))) / 2);
  return 1000 + METHOD_BONUS[r.method] + quick + opp + hard;
}

/** Count a finished fight. Returns this fight's score (0 when not a win). */
export function recordFight(s: RecordState, r: Pick<FightResult, 'winner' | 'method'>, seconds: number, oppOverall: number, difficulty: number): number {
  if (r.winner === 0 && (r.method === 'KO' || r.method === 'TKO')) s.kos++;
  if (r.winner === 0 && r.method === 'SUB') s.subs++;
  const score = fightScore(r, seconds, oppOverall, difficulty);
  if (score > s.best) s.best = score;
  return score;
}
