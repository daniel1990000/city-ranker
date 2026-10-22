// Daily missions: three small goals a day ("Land 50 strikes", "Win by KO or TKO", "Open a pack"...), the same three
// for every player on the same calendar day (picked from MISSIONS by a hash of the day number). Each pays cash and a
// little season xp the moment it is done, and finishing all three pays a bonus (gems and season xp). A new set starts
// at the player's local midnight on the reward clock (meta/clock.ts), so moving the phone's clock back can't reopen a
// day or pay twice.
//
// Saved in the 'missions' progress slot (meta/save.ts ProgressSlots). app/game.ts feeds it events (fights, packs,
// training). Amounts are remote-tunable (MISSION_TUNING, docs/REMOTE-TUNING.md).

import type { FightFacts } from './achievements';
import { rewardTime } from './clock';
import { dayNumber } from './days';
import { bool, int, intSet, obj } from './sanitize';
import { registerProgressSlot, type SaveData } from './save';
import { addSeasonXp } from './season';
import { defineTunables } from './tuning';
import { addCash, addGems } from './wallet';

/** What moves a mission on. */
export type MissionEvent = { kind: 'fight'; fight: FightFacts } | { kind: 'pack'; count: number } | { kind: 'train' };

export interface MissionDef {
  id: string;
  /** shown on the hub: "Land 50 strikes" */
  text: string;
  target: number;
  /** cash before MISSION_TUNING.missionCashPct */
  cash: number;
  /** a day's three missions come from three different groups (never three "win by..." in one day) */
  group: 'finish' | 'win' | 'volume' | 'meta';
  /** how much an event moves it on */
  step(e: MissionEvent): number;
}

/**
 * Remote-tunable amounts: cash per mission (percent of the built-in amount), season xp per mission (a bonus: it
 * doesn't count against the daily fight xp cap) and the all-three bonus. Floors keep a finished mission worth something.
 */
export const MISSION_TUNING = defineTunables({
  missionCashPct: { def: 100, min: 25, max: 400 },
  missionXp: { def: 50, min: 0, max: 500 },
  missionBonusGems: { def: 10, min: 0, max: 100 },
  missionBonusXp: { def: 100, min: 0, max: 1000 },
});

const fight = (e: MissionEvent, fn: (f: FightFacts) => number): number => (e.kind === 'fight' ? fn(e.fight) : 0);
const isKo = (f: FightFacts) => f.method === 'KO' || f.method === 'TKO';

/** The pool. Ids are stored in saves: never rename one (a removed one counts as done in a stored set). */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'winKo', text: 'Win by KO or TKO', target: 1, cash: 450, group: 'finish', step: e => fight(e, f => (f.won && isKo(f) ? 1 : 0)) },
  { id: 'winSub', text: 'Win by submission', target: 1, cash: 500, group: 'finish', step: e => fight(e, f => (f.won && f.method === 'SUB' ? 1 : 0)) },
  { id: 'winDec', text: "Win on the judges' cards", target: 1, cash: 400, group: 'finish', step: e => fight(e, f => (f.won && f.method === 'DEC' ? 1 : 0)) },
  { id: 'win2', text: 'Win 2 fights', target: 2, cash: 400, group: 'win', step: e => fight(e, f => (f.won ? 1 : 0)) },
  { id: 'careerWin', text: 'Win a career fight', target: 1, cash: 350, group: 'win', step: e => fight(e, f => (f.won && f.career ? 1 : 0)) },
  { id: 'cleanWin', text: 'Win without being knocked down', target: 1, cash: 400, group: 'win', step: e => fight(e, f => (f.won && f.knockedDown === 0 ? 1 : 0)) },
  { id: 'land50', text: 'Land 50 strikes', target: 50, cash: 300, group: 'volume', step: e => fight(e, f => f.landed) },
  { id: 'takedowns3', text: 'Score 3 takedowns', target: 3, cash: 400, group: 'volume', step: e => fight(e, f => f.takedowns) },
  { id: 'knockdowns2', text: 'Score 2 knockdowns', target: 2, cash: 400, group: 'volume', step: e => fight(e, f => f.knockdowns) },
  { id: 'fights3', text: 'Finish 3 fights', target: 3, cash: 300, group: 'volume', step: e => (e.kind === 'fight' ? 1 : 0) },
  { id: 'openPack', text: 'Open a pack', target: 1, cash: 300, group: 'meta', step: e => (e.kind === 'pack' ? e.count : 0) },
  { id: 'train', text: 'Train a stat', target: 1, cash: 300, group: 'meta', step: e => (e.kind === 'train' ? 1 : 0) },
];

/** Missions a day. */
export const MISSIONS_PER_DAY = 3;

const BY_ID = new Map(MISSIONS.map(m => [m.id, m]));

export function missionDef(id: string): MissionDef | undefined {
  return BY_ID.get(id);
}

/** Cash a mission pays now (built-in amount x the remote percentage). */
export function missionCash(def: MissionDef): number {
  return Math.round((def.cash * MISSION_TUNING.missionCashPct) / 100 / 10) * 10;
}

// ------------------------------------------------------------------ the saved state
export interface MissionsState {
  v: 1;
  /** reward-clock day these missions are for (-1: none yet) */
  day: number;
  ids: string[];
  /** progress per mission (capped at its target) */
  prog: number[];
  /** indices of the missions already paid */
  paid: number[];
  /** the all-done bonus was paid */
  bonus: boolean;
}

declare module './save' {
  interface ProgressSlots {
    missions: MissionsState;
  }
}

export function freshMissions(): MissionsState {
  return { v: 1, day: -1, ids: [], prog: [], paid: [], bonus: false };
}

/**
 * Any stored value -> valid missions. Saves from before missions existed have none (a new set starts on the next
 * check). A set whose parts don't line up (a broken or edited save) keeps its day with nothing left to do, so that
 * day never pays twice; the next day starts a fresh set.
 */
export function sanitizeMissions(raw: unknown): MissionsState {
  const m = obj(raw);
  const day = int(m.day, -1, -1, 1e7);
  if (day < 0) return freshMissions();
  const none: MissionsState = { v: 1, day, ids: [], prog: [], paid: [], bonus: true };
  const rawIds: unknown[] = Array.isArray(m.ids) ? m.ids : [];
  const rawProg: unknown[] = Array.isArray(m.prog) ? m.prog : [];
  const ids = rawIds.filter((x): x is string => typeof x === 'string' && /^[a-zA-Z0-9]{1,24}$/.test(x));
  if (ids.length === 0 || ids.length > 5 || ids.length !== rawIds.length || rawProg.length !== ids.length) return none;
  return { v: 1, day, ids, prog: rawProg.map(x => int(x, 0, 0, 1e6)), paid: intSet(m.paid, 0, ids.length - 1, ids.length), bonus: bool(m.bonus, false) };
}

registerProgressSlot('missions', { fresh: freshMissions, sanitize: sanitizeMissions, maxBytes: 2048 });

// ------------------------------------------------------------------ rules
function hash(n: number): number {
  let h = (n ^ 0x6d2b79f5) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return (h ^ (h >>> 14)) >>> 0;
}

/** The day's missions: the same for everyone on that calendar day, three from three different groups. */
export function missionsForDay(day: number): string[] {
  const groups = [...new Set(MISSIONS.map(m => m.group))];
  let r = hash(day);
  const next = (n: number) => {
    const v = r % n;
    r = hash(r + 0x9e3779b9);
    return v;
  };
  const picked: string[] = [];
  while (picked.length < MISSIONS_PER_DAY && groups.length) picked.push(groups.splice(next(groups.length), 1)[0]);
  return picked.map(g => {
    const pool = MISSIONS.filter(m => m.group === g);
    return pool[next(pool.length)].id;
  });
}

/**
 * Today's missions, starting a new set when the reward-clock day has moved on. Only a later day starts a new set:
 * the same day never starts again, and a day stored ahead of today (a save from a phone whose clock was ahead) keeps
 * what it paid until clock.ts `unlock` makes it today's.
 */
export function ensureMissions(save: SaveData, now = Date.now()): MissionsState {
  const today = dayNumber(rewardTime(now));
  if (today > save.progress.missions.day) {
    const ids = missionsForDay(today);
    save.progress.missions = { v: 1, day: today, ids, prog: ids.map(() => 0), paid: [], bonus: false };
  }
  return save.progress.missions;
}

export interface MissionPayout {
  /** missions finished by this event */
  done: MissionDef[];
  /** all of today's missions are now done and the bonus was paid */
  bonus: boolean;
  cash: number;
  gems: number;
  xp: number;
}

/** Move today's missions on by an event, paying any that it finishes (each once) and the all-done bonus (once). */
export function progressMissions(save: SaveData, e: MissionEvent, now = Date.now()): MissionPayout {
  const m = ensureMissions(save, now);
  const out: MissionPayout = { done: [], bonus: false, cash: 0, gems: 0, xp: 0 };
  m.ids.forEach((id, i) => {
    const def = BY_ID.get(id);
    if (!def || m.paid.includes(i)) return;
    const add = Math.max(0, Math.floor(def.step(e)));
    m.prog[i] = Math.min(def.target, (m.prog[i] ?? 0) + add);
    if (m.prog[i] >= def.target) {
      m.paid.push(i);
      out.done.push(def);
      out.cash += addCash(save, missionCash(def));
      const xp = Math.round(MISSION_TUNING.missionXp);
      addSeasonXp(save, xp, now, 'bonus');
      out.xp += xp;
    }
  });
  if (!m.bonus && m.ids.length > 0 && m.ids.every((id, i) => m.paid.includes(i) || !BY_ID.has(id))) {
    m.bonus = true;
    out.bonus = true;
    out.gems += addGems(save, Math.round(MISSION_TUNING.missionBonusGems));
    const xp = Math.round(MISSION_TUNING.missionBonusXp);
    addSeasonXp(save, xp, now, 'bonus');
    out.xp += xp;
  }
  return out;
}

/** One mission as the hub panel shows it. */
export interface MissionView {
  def: MissionDef;
  prog: number;
  done: boolean;
  /** what it pays now */
  cash: number;
}

export function missionsView(save: SaveData, now = Date.now()): { list: MissionView[]; bonus: boolean } {
  const m = ensureMissions(save, now);
  const list: MissionView[] = [];
  m.ids.forEach((id, i) => {
    const def = BY_ID.get(id);
    if (def) list.push({ def, prog: Math.min(def.target, m.prog[i] ?? 0), done: m.paid.includes(i), cash: missionCash(def) });
  });
  return { list, bonus: m.bonus };
}
