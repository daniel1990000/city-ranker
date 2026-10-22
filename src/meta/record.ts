// The player's fight record across all modes, for the Play Games leaderboards: wins (save.wins), knockouts (KO and
// TKO wins) and the best single win, scored by `fightScore`. Play Games keeps each player's best per day, week and
// all time, so the "best win" board doubles as the weekly ranking. Saved in the 'record' progress slot.

import type { FightResult } from '../game/fight/types';
import { countsForBoards, DIFFICULTY_SCORE_PCT, type DifficultyLevel } from './difficulty';
import { int, obj } from './sanitize';
import { registerProgressSlot } from './save';

export interface RecordState {
  v: 1;
  /** KO and TKO wins */
  kos: number;
  subs: number;
  /** best fightScore so far */
  best: number;
  /** wins and KO / TKO wins on the Easy setting: shown in the record, left off the wins and knockouts boards */
  easyWins: number;
  easyKos: number;
}

declare module './save' {
  interface ProgressSlots {
    record: RecordState;
  }
}

export function freshRecord(): RecordState {
  return { v: 1, kos: 0, subs: 0, best: 0, easyWins: 0, easyKos: 0 };
}

export function sanitizeRecord(raw: unknown): RecordState {
  const o = obj(raw);
  const kos = int(o.kos, 0, 0, 1_000_000);
  return {
    v: 1,
    kos,
    subs: int(o.subs, 0, 0, 1_000_000),
    best: int(o.best, 0, 0, 100_000),
    // older saves have none (there was no Easy before)
    easyWins: int(o.easyWins, 0, 0, 1_000_000_000),
    easyKos: Math.min(kos, int(o.easyKos, 0, 0, 1_000_000)),
  };
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

/**
 * Count a finished fight. Returns this fight's score (0 when not a win). `difficulty` is the AI difficulty the fight
 * was really played at (after the setting's offset); `level` is the setting. An Easy win scores half and is kept
 * apart (easyWins / easyKos), so the boards can leave it out.
 */
export function recordFight(s: RecordState, r: Pick<FightResult, 'winner' | 'method'>, seconds: number, oppOverall: number, difficulty: number, level: DifficultyLevel = 'normal'): number {
  const ko = r.winner === 0 && (r.method === 'KO' || r.method === 'TKO');
  if (ko) s.kos++;
  if (r.winner === 0 && r.method === 'SUB') s.subs++;
  if (r.winner === 0 && !countsForBoards(level)) {
    s.easyWins++;
    if (ko) s.easyKos++;
  }
  const score = Math.floor((fightScore(r, seconds, oppOverall, difficulty) * DIFFICULTY_SCORE_PCT[level]) / 100);
  if (score > s.best) s.best = score;
  return score;
}

/** What the wins and knockouts leaderboards get: Easy wins left out. */
export function boardCounts(s: RecordState, wins: number): { wins: number; knockouts: number } {
  return { wins: Math.max(0, wins - s.easyWins), knockouts: Math.max(0, s.kos - s.easyKos) };
}
