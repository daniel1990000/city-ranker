// The career: per division, five tiers (Amateur -> Champion) of five fights and a boss, then the title fight, then
// title defences. Opponents are generated journeymen (original names, seeded) and roster fighters as bosses and
// champions. Everything here is a pure function of the division, the step and the save, so it is testable and a
// server could compute it. Saved in the 'career' progress slot.

import type { Archetype, DivisionId, FighterSpec, FightRules, Rarity } from '../game/fight/types';
import { division, DIVISION_IDS } from './divisions';
import { generateName } from './names';
import { baseStats, rosterOf } from './roster';
import { int, obj } from './sanitize';
import { registerProgressSlot } from './save';

export const TIER_NAMES = ['Amateur', 'Regional', 'National', 'Contender', 'Champion'] as const;
export const TIERS = TIER_NAMES.length;
/** Fights per tier, the last one being the boss. */
export const FIGHTS_PER_TIER = 10;

export interface DivisionCareer {
  /** 0..TIERS: TIERS means the title fight (or defences once `belt`). */
  tier: number;
  fight: number;
  belt: boolean;
  defenses: number;
  /** Times the title was won (the first win pays the big prize; winning it back after a loss pays less). */
  titles: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  subs: number;
}

export interface CareerState {
  v: 1;
  div: Record<DivisionId, DivisionCareer>;
}

declare module './save' {
  interface ProgressSlots {
    career: CareerState;
  }
}

const freshDiv = (): DivisionCareer => ({ tier: 0, fight: 0, belt: false, defenses: 0, titles: 0, wins: 0, losses: 0, draws: 0, kos: 0, subs: 0 });

export function freshCareer(): CareerState {
  const div = {} as Record<DivisionId, DivisionCareer>;
  for (const d of DIVISION_IDS) div[d] = freshDiv();
  return { v: 1, div };
}

export function sanitizeCareer(raw: unknown): CareerState {
  const o = obj(obj(raw).div);
  const out = freshCareer();
  for (const d of DIVISION_IDS) {
    const r = obj(o[d]);
    const tier = int(r.tier, 0, 0, TIERS);
    out.div[d] = {
      tier,
      fight: tier >= TIERS ? 0 : int(r.fight, 0, 0, FIGHTS_PER_TIER - 1),
      belt: tier >= TIERS && r.belt === true,
      defenses: int(r.defenses, 0, 0, 100000),
      titles: int(r.titles, tier >= TIERS && r.belt === true ? 1 : 0, 0, 100000),
      wins: int(r.wins, 0, 0, 1e7),
      losses: int(r.losses, 0, 0, 1e7),
      draws: int(r.draws, 0, 0, 1e7),
      kos: int(r.kos, 0, 0, 1e7),
      subs: int(r.subs, 0, 0, 1e7),
    };
  }
  return out;
}

registerProgressSlot('career', { fresh: freshCareer, sanitize: sanitizeCareer });

export type StepKind = 'fight' | 'boss' | 'title' | 'defense';

export interface CareerStep {
  div: DivisionId;
  tier: number;
  fight: number;
  kind: StepKind;
  opponent: FighterSpec;
  /** AI difficulty 0..1000. */
  difficulty: number;
  rules: Partial<FightRules>;
  /** Shown on the fight card. */
  label: string;
  /** Seed of the fight (simulation + venue). */
  seed: number;
  /** A title fight for a belt never won before in this division (the big prize). */
  firstTitle: boolean;
}

const ARCHS: Archetype[] = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'];
/** Stat offset of journeymen per tier, before the fight index nudge. */
const TIER_OFFSET = [-16, -8, 0, 7, 13];
const BOSS_RARITY: Rarity[] = ['common', 'rare', 'rare', 'epic', 'legend'];

function mix(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) h = Math.imul(h ^ (x | 0), 16777619) >>> 0;
  return h;
}

const divIndex = (d: DivisionId) => DIVISION_IDS.indexOf(d);

export function stepKind(c: DivisionCareer): StepKind {
  if (c.tier >= TIERS) return c.belt ? 'defense' : 'title';
  return c.fight === FIGHTS_PER_TIER - 1 ? 'boss' : 'fight';
}

/** The next fight in a division's career. `playerId` keeps the player's own fighter off the opposite side. */
export function nextStep(state: CareerState, div: DivisionId, playerId: string): CareerStep {
  const c = state.div[div];
  const kind = stepKind(c);
  const sex = division(div).sex;
  const seed = mix(divIndex(div), c.tier, c.fight, c.defenses, 77);
  const roster = rosterOf(div).filter(f => f.id !== playerId);
  let opponent: FighterSpec;
  let difficulty: number;
  let rules: Partial<FightRules> = { rounds: 3, roundTicks: 75 * 60 };
  let label: string;
  if (kind === 'fight') {
    const arch = ARCHS[seed % ARCHS.length];
    const s = baseStats(arch, 'common', div, seed);
    const off = TIER_OFFSET[c.tier] + c.fight;
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = Math.max(1, Math.min(99, s[k] + off + 6));
    const n = generateName(seed, sex);
    opponent = { id: `jm-${div}-${c.tier}-${c.fight}`, name: n.name, nickname: n.nickname, division: div, archetype: arch, rarity: 'common', stats: s, lookSeed: seed % 100000, lookHints: { sex, beard: seed % 3 === 0, tattoos: seed % 4 === 0 } };
    difficulty = 120 + c.tier * 170 + c.fight * 14;
    label = `${TIER_NAMES[c.tier]} · Fight ${c.fight + 1} of ${FIGHTS_PER_TIER}`;
  } else if (kind === 'boss') {
    const pool = roster.filter(f => f.rarity === BOSS_RARITY[c.tier]);
    const boss = (pool.length ? pool : roster)[seed % Math.max(1, (pool.length ? pool : roster).length)];
    const s = { ...boss.stats };
    const off = [-6, 0, 5, 10, 14][c.tier];
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = Math.max(1, Math.min(99, s[k] + off));
    opponent = { ...boss, stats: s };
    difficulty = 220 + c.tier * 180;
    label = `${TIER_NAMES[c.tier]} · Boss fight`;
  } else {
    // the champion (title) or the next contender (defences): the strongest fighters in the division
    const sorted = [...roster].sort((a, b) => b.stats.power + b.stats.speed - (a.stats.power + a.stats.speed));
    const champ = kind === 'title' ? (roster.find(f => f.rarity === 'legend') ?? sorted[0]) : sorted[(c.defenses + 1) % Math.min(3, sorted.length)];
    const s = { ...champ.stats };
    const off = kind === 'title' ? 16 : 8 + Math.min(12, c.defenses);
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = Math.max(1, Math.min(99, s[k] + off));
    opponent = { ...champ, stats: s };
    difficulty = kind === 'title' ? 900 : Math.min(950, 780 + c.defenses * 10);
    rules = { rounds: 5, roundTicks: 60 * 60, title: true };
    label = kind === 'title' ? `${division(div).name} title fight` : `Title defence #${c.defenses + 1}`;
  }
  return { div, tier: c.tier, fight: c.fight, kind, opponent, difficulty, rules, label, seed, firstTitle: kind === 'title' && c.titles === 0 };
}

export interface CareerReward {
  cash: number;
  xp: number;
  gems: number;
  /** A pack earned at the end of a tier. */
  pack: 'standard' | 'premium' | 'elite' | null;
  /** Won the belt in this fight. */
  belt: boolean;
}

/** What a career fight pays (pure: a server could compute it). */
export function careerReward(step: CareerStep, won: boolean, draw: boolean, method: 'KO' | 'TKO' | 'SUB' | 'DEC'): CareerReward {
  const base = 150 + step.tier * 90 + (step.kind === 'boss' ? 300 : 0) + (step.kind === 'title' ? (step.firstTitle ? 2000 : 500) : 0) + (step.kind === 'defense' ? 600 : 0);
  const finish = method !== 'DEC' && won ? 1.5 : 1;
  const cash = Math.round((won ? base * finish : draw ? base * 0.5 : base * 0.3) / 10) * 10;
  const xp = Math.round((won ? 90 : 45) + step.tier * 25 + (step.kind !== 'fight' ? 80 : 0));
  let gems = 0;
  let pack: CareerReward['pack'] = null;
  if (won && step.kind === 'boss') {
    gems = 15 + step.tier * 10;
    pack = step.tier >= 3 ? 'premium' : 'standard';
  }
  if (won && step.kind === 'title') {
    gems = step.firstTitle ? 150 : 30;
    pack = step.firstTitle ? 'elite' : 'standard';
  }
  if (won && step.kind === 'defense') gems = 15;
  return { cash, xp, gems, pack, belt: won && step.kind === 'title' };
}

/** Record the result and move the ladder on (a loss keeps you on the same step). */
export function applyCareerResult(state: CareerState, step: CareerStep, won: boolean, draw: boolean, method: 'KO' | 'TKO' | 'SUB' | 'DEC'): void {
  const c = state.div[step.div];
  if (c.tier !== step.tier || c.fight !== step.fight) return; // stale (the save moved on)
  if (won) {
    c.wins++;
    if (method === 'KO' || method === 'TKO') c.kos++;
    if (method === 'SUB') c.subs++;
    if (step.kind === 'title') {
      c.belt = true;
      c.titles++;
    } else if (step.kind === 'defense') {
      c.defenses++;
    } else if (c.fight >= FIGHTS_PER_TIER - 1) {
      c.tier++;
      c.fight = 0;
    } else c.fight++;
  } else if (draw) c.draws++;
  else {
    c.losses++;
    if (step.kind === 'defense') {
      // losing the belt: win the title back
      c.belt = false;
    }
  }
}

/** 0..1 progress through a division's ladder (for the menus). */
export function careerProgress(c: DivisionCareer): number {
  if (c.tier >= TIERS) return 1;
  return (c.tier * FIGHTS_PER_TIER + c.fight) / (TIERS * FIGHTS_PER_TIER);
}
