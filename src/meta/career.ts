// The career: per division, five tiers (Amateur -> Champion) of ten fights (the last one a boss), then the title
// fight. After the title (docs/ECONOMY.md "After the title"): title defences alternate with non-title super fights
// that pay well, defences climb a Legacy track (a reward at each rank), opponents stop getting harder at a fair
// ceiling, and the champion can move up or down a weight class (`moveDivision`) or vacate and run the ladder again at
// a higher Prestige (1..5: tougher opponents, bigger purses). Opponents are generated journeymen (original names,
// seeded) and roster fighters as bosses and champions. Everything here is a pure function of the division, the step
// and the save, so it is testable and a server could compute it. Saved in the 'career' progress slot.

import type { Archetype, DivisionId, FighterSpec, FighterStats, FightRules, Rarity } from '../game/fight/types';
import { division, DIVISION_IDS } from './divisions';
import { generateName } from './names';
import { baseStats, rosterFighter, rosterOf } from './roster';
import { int, obj } from './sanitize';
import { registerProgressSlot } from './save';
import { defineTunables } from './tuning';

export const TIER_NAMES = ['Amateur', 'Regional', 'National', 'Contender', 'Champion'] as const;
export const TIERS = TIER_NAMES.length;
/** Fights per tier, the last one being the boss. */
export const FIGHTS_PER_TIER = 10;

/** Highest Prestige: the ladder can be run again five times after a title. */
export const MAX_PRESTIGE = 5;

export type CareerPack = 'standard' | 'premium' | 'elite';

/** The Legacy track: title defences won in a division (lifetime, across Prestige); each rank pays once. */
export const LEGACY: readonly { at: number; name: string; cash: number; gems: number; pack: CareerPack | null }[] = [
  { at: 1, name: 'Title Defender', cash: 1000, gems: 20, pack: null },
  { at: 3, name: 'Proven Champion', cash: 1500, gems: 30, pack: 'standard' },
  { at: 5, name: 'Dominant Champion', cash: 2000, gems: 50, pack: 'premium' },
  { at: 8, name: 'All-Time Great', cash: 3000, gems: 60, pack: 'premium' },
  { at: 12, name: 'Living Legend', cash: 4000, gems: 80, pack: 'elite' },
  { at: 20, name: 'Hall of Famer', cash: 6000, gems: 120, pack: 'elite' },
];

/** Legacy ranks reached with this many defences (0 = none yet; LEGACY[rank - 1] is the current one). */
export function legacyRank(defenses: number): number {
  let r = 0;
  for (const l of LEGACY) if (defenses >= l.at) r++;
  return r;
}

export interface DivisionCareer {
  /** 0..TIERS: TIERS means the title fight (or defences once `belt`). */
  tier: number;
  fight: number;
  belt: boolean;
  /** Title defences won in this division, lifetime (the Legacy track). */
  defenses: number;
  /** Times the title was won (the first win pays the big prize; winning it back after a loss pays less). */
  titles: number;
  wins: number;
  losses: number;
  draws: number;
  kos: number;
  subs: number;
  /** 0..MAX_PRESTIGE: times the champion vacated to run the ladder again (tougher opponents, bigger purses). */
  prestige: number;
  /** Highest Prestige at which the title was won (-1: never), so each Prestige's first title pays its prize once. */
  peak: number;
  /** Defences won in the current reign (0 when the belt is won or lost). */
  reign: number;
  /** A defence was won since the last super fight: a super fight is offered (at most one a day per division). */
  superDue: boolean;
  /** Reward-clock day (meta/days.ts) of the last super fight in this division (-1: never). */
  superDay: number;
  /** Super fights won, lifetime. */
  supers: number;
  /** Legacy ranks already paid. */
  legacyPaid: number;
  /** A champion from a neighbouring weight class who moved into this division ('' = the division's own fighter). */
  guest: string;
}

export interface CareerState {
  v: 2;
  div: Record<DivisionId, DivisionCareer>;
}

declare module './save' {
  interface ProgressSlots {
    career: CareerState;
  }
}

const freshDiv = (): DivisionCareer => ({
  tier: 0, fight: 0, belt: false, defenses: 0, titles: 0, wins: 0, losses: 0, draws: 0, kos: 0, subs: 0,
  prestige: 0, peak: -1, reign: 0, superDue: false, superDay: -1, supers: 0, legacyPaid: 0, guest: '',
});

export function freshCareer(): CareerState {
  const div = {} as Record<DivisionId, DivisionCareer>;
  for (const d of DIVISION_IDS) div[d] = freshDiv();
  return { v: 2, div };
}

const divIndex = (d: DivisionId) => DIVISION_IDS.indexOf(d);

/** Weight classes next to this one (same sex): where a champion can move up or down. */
export function neighbourDivisions(div: DivisionId): DivisionId[] {
  const i = divIndex(div);
  const sex = division(div).sex;
  return [DIVISION_IDS[i - 1], DIVISION_IDS[i + 1]].filter((d): d is DivisionId => !!d && division(d).sex === sex);
}

/** A stored guest id: a roster fighter from a neighbouring division, or ''. */
function guestOf(v: unknown, d: DivisionId): string {
  const f = typeof v === 'string' ? rosterFighter(v) : undefined;
  return f && neighbourDivisions(d).includes(f.division) ? f.id : '';
}

/**
 * Any stored career -> a valid one (idempotent). Version 1 (before the post-title loop) had no Prestige, reign,
 * super fights, Legacy or guests: a v1 champion's reign counts as all its defences, its title as won at Prestige 0,
 * and Legacy ranks it already reached are paid with the next defence it wins (nothing paid them before).
 */
export function sanitizeCareer(raw: unknown): CareerState {
  const top = obj(raw);
  const v1 = int(top.v, 1, 1, 1000) < 2;
  const o = obj(top.div);
  const out = freshCareer();
  for (const d of DIVISION_IDS) {
    const r = obj(o[d]);
    const tier = int(r.tier, 0, 0, TIERS);
    const belt = tier >= TIERS && r.belt === true;
    const defenses = int(r.defenses, 0, 0, 100000);
    const titles = int(r.titles, belt ? 1 : 0, 0, 100000);
    const prestige = v1 ? 0 : int(r.prestige, 0, 0, MAX_PRESTIGE);
    out.div[d] = {
      tier,
      fight: tier >= TIERS ? 0 : int(r.fight, 0, 0, FIGHTS_PER_TIER - 1),
      belt,
      defenses,
      titles,
      wins: int(r.wins, 0, 0, 1e7),
      losses: int(r.losses, 0, 0, 1e7),
      draws: int(r.draws, 0, 0, 1e7),
      kos: int(r.kos, 0, 0, 1e7),
      subs: int(r.subs, 0, 0, 1e7),
      prestige,
      peak: titles === 0 ? -1 : v1 ? 0 : int(r.peak, 0, 0, prestige),
      reign: !belt ? 0 : v1 ? defenses : int(r.reign, 0, 0, defenses),
      superDue: belt && !v1 && r.superDue === true,
      superDay: v1 ? -1 : int(r.superDay, -1, -1, 1e7),
      supers: v1 ? 0 : int(r.supers, 0, 0, 100000),
      legacyPaid: v1 ? 0 : int(r.legacyPaid, 0, 0, legacyRank(defenses)),
      guest: v1 ? '' : guestOf(r.guest, d),
    };
  }
  return out;
}

registerProgressSlot('career', { fresh: freshCareer, sanitize: sanitizeCareer });

/** 'super': a non-title main event between title defences (pays well; the belt is not at stake). */
export type StepKind = 'fight' | 'boss' | 'title' | 'defense' | 'super';

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
  /** The ladder's Prestige (0..MAX_PRESTIGE). */
  prestige: number;
  /** A title fight for a belt not yet won at this Prestige (above 0): the Prestige prize. */
  prestigeTitle: boolean;
  /** Indexes into LEGACY that a win here pays (the rank this defence reaches, and any reached but not yet paid). */
  legacy: number[];
  /** Holds a belt in another division: a title win here makes a two-division champion. */
  champElsewhere: boolean;
  /** The reward-clock day the step was made for (super fights: one a day). */
  day: number;
}

const ARCHS: Archetype[] = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'];
/** Stat offset of journeymen per tier, before the fight index nudge. */
const TIER_OFFSET = [-16, -8, 0, 7, 13];
const BOSS_RARITY: Rarity[] = ['common', 'rare', 'rare', 'epic', 'legend'];

/** Each Prestige adds this to every ladder opponent's stats and AI difficulty (the title fight gets half). */
export const PRESTIGE_STATS = 3;
export const PRESTIGE_DIFFICULTY = 30;
/** Purses grow 25 % per Prestige. */
export const PRESTIGE_PAY = 25;
/**
 * The fair ceiling of title defences. A contender's stat bonus grows by 1 per defence of the reign from `base` up
 * to `max` (plus `prestige` per Prestige, never above `cap`), the AI difficulty from `base` up to `max` (plus
 * `prestige` per Prestige, never above `cap`). The title fight itself is +16 at 900: at Prestige 0 a defence is
 * never harder than winning the belt was.
 */
export const DEFENSE_STATS = { base: 4, max: 8, prestige: 2, cap: 16 } as const;
export const DEFENSE_DIFFICULTY = { base: 720, perReign: 10, max: 780, prestige: 20, cap: 880 } as const;
/** Super fights: a star from outside the top three contenders (+stats, AI difficulty). */
export const SUPER_FIGHT = { stats: 2, prestige: 2, difficulty: 680, perPrestige: 20 } as const;
/**
 * What a super fight pays at Prestige 0 (remote-tunable): the win purse (x1.5 for a finish; a loss pays 30 %) and
 * gems for a win. One a day per division, after a defence, so it stays a payday and not a farm.
 */
export const CAREER_TUNING = defineTunables({
  superPurse: { def: 2500, min: 600, max: 10000 },
  superGems: { def: 25, min: 0, max: 100 },
});
/** A champion moving up or down a weight class starts the new division's ladder at Contender at least. */
export const MOVE_START_TIER = 3;
/** Bonus for a title won while holding a belt in another division. */
export const TWO_BELTS = { cash: 1500, gems: 50 } as const;

function mix(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) h = Math.imul(h ^ (x | 0), 16777619) >>> 0;
  return h;
}

/** No day given (tools, tests): a due super fight is always available. */
const ANY_DAY = 1e8;

/** The kind of the next fight. `today` (reward-clock day) limits super fights to one a day per division. */
export function stepKind(c: DivisionCareer, today = ANY_DAY): StepKind {
  if (c.tier >= TIERS) return c.belt ? (c.superDue && c.superDay < today ? 'super' : 'defense') : 'title';
  return c.fight === FIGHTS_PER_TIER - 1 ? 'boss' : 'fight';
}

/** Holds a belt in any division other than `div`. */
export function champElsewhere(state: CareerState, div: DivisionId): boolean {
  return DIVISION_IDS.some(d => d !== div && state.div[d].belt);
}

const clampStat = (v: number) => Math.max(1, Math.min(99, v));

/**
 * The next fight in a division's career. `playerId` keeps the player's own fighter off the opposite side; `today`
 * (the reward clock's day) decides whether today's super fight is still available.
 */
export function nextStep(state: CareerState, div: DivisionId, playerId: string, today = ANY_DAY): CareerStep {
  const c = state.div[div];
  const kind = stepKind(c, today);
  const sex = division(div).sex;
  const p = c.prestige;
  // Prestige 0 without super fights keeps the seeds (and so the opponents) of the original career
  const seed = mix(divIndex(div), c.tier, c.fight, c.defenses, 77 + p * 1009 + c.supers * 7);
  const roster = rosterOf(div).filter(f => f.id !== playerId);
  const pStats = p * PRESTIGE_STATS;
  const pDiff = p * PRESTIGE_DIFFICULTY;
  const pre = p > 0 ? `Prestige ${p} · ` : '';
  let opponent: FighterSpec;
  let difficulty: number;
  let rules: Partial<FightRules> = { rounds: 3, roundTicks: 75 * 60 };
  let label: string;
  if (kind === 'fight') {
    const arch = ARCHS[seed % ARCHS.length];
    const s = baseStats(arch, 'common', div, seed);
    const off = TIER_OFFSET[c.tier] + c.fight + pStats;
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = clampStat(s[k] + off + 6);
    const n = generateName(seed, sex);
    opponent = { id: `jm-${div}-${c.tier}-${c.fight}`, name: n.name, nickname: n.nickname, division: div, archetype: arch, rarity: 'common', stats: s, lookSeed: seed % 100000, lookHints: { sex, beard: seed % 3 === 0, tattoos: seed % 4 === 0 } };
    difficulty = Math.min(950, 120 + c.tier * 170 + c.fight * 14 + pDiff);
    label = `${pre}${TIER_NAMES[c.tier]} · Fight ${c.fight + 1} of ${FIGHTS_PER_TIER}`;
  } else if (kind === 'boss') {
    const pool = roster.filter(f => f.rarity === BOSS_RARITY[c.tier]);
    const boss = (pool.length ? pool : roster)[seed % Math.max(1, (pool.length ? pool : roster).length)];
    const s = { ...boss.stats };
    const off = [-6, 0, 5, 10, 14][c.tier] + pStats;
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = clampStat(s[k] + off);
    opponent = { ...boss, stats: s };
    difficulty = Math.min(950, 220 + c.tier * 180 + pDiff);
    label = `${pre}${TIER_NAMES[c.tier]} · Boss fight`;
  } else {
    // the champion (title), the next contender (defences) or a star of the division (super fights)
    const sorted = [...roster].sort((a, b) => b.stats.power + b.stats.speed - (a.stats.power + a.stats.speed));
    let champ: FighterSpec;
    let off: number;
    if (kind === 'title') {
      champ = roster.find(f => f.rarity === 'legend') ?? sorted[0];
      if (c.peak >= p) {
        // winning back a belt already won at this Prestige: the champion is at the defences' fair ceiling
        off = Math.min(DEFENSE_STATS.cap, DEFENSE_STATS.base + p * DEFENSE_STATS.prestige);
        difficulty = Math.min(DEFENSE_DIFFICULTY.cap, DEFENSE_DIFFICULTY.base + p * DEFENSE_DIFFICULTY.prestige);
      } else {
        off = 16 + Math.floor(pStats / 2);
        difficulty = Math.min(950, 900 + Math.floor(pDiff / 2));
      }
      rules = { rounds: 5, roundTicks: 60 * 60, title: true };
      label = `${pre}${division(div).name} title fight`;
    } else if (kind === 'defense') {
      champ = sorted[(c.defenses + 1) % Math.min(3, sorted.length)];
      off = Math.min(DEFENSE_STATS.cap, Math.min(DEFENSE_STATS.max, DEFENSE_STATS.base + c.reign) + p * DEFENSE_STATS.prestige);
      difficulty = Math.min(DEFENSE_DIFFICULTY.cap, Math.min(DEFENSE_DIFFICULTY.max, DEFENSE_DIFFICULTY.base + c.reign * DEFENSE_DIFFICULTY.perReign) + p * DEFENSE_DIFFICULTY.prestige);
      rules = { rounds: 5, roundTicks: 60 * 60, title: true };
      label = `${pre}Title defence #${c.reign + 1}`;
    } else {
      // from outside the top three contenders, so super fights bring new faces
      const pool = sorted.length > 3 ? sorted.slice(3) : sorted;
      champ = pool[seed % pool.length];
      off = SUPER_FIGHT.stats + p * SUPER_FIGHT.prestige;
      difficulty = Math.min(950, SUPER_FIGHT.difficulty + p * SUPER_FIGHT.perPrestige);
      label = `${pre}Super fight (non-title)`;
    }
    const s = { ...champ.stats };
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = clampStat(s[k] + off);
    opponent = { ...champ, stats: s };
  }
  const legacy: number[] = [];
  if (kind === 'defense') for (let i = c.legacyPaid; i < legacyRank(c.defenses + 1); i++) legacy.push(i);
  return {
    div,
    tier: c.tier,
    fight: c.fight,
    kind,
    opponent,
    difficulty,
    rules,
    label,
    seed,
    firstTitle: kind === 'title' && c.titles === 0,
    prestige: p,
    prestigeTitle: kind === 'title' && p > 0 && c.peak < p,
    legacy,
    champElsewhere: kind === 'title' && champElsewhere(state, div),
    day: today,
  };
}

export interface CareerReward {
  cash: number;
  xp: number;
  gems: number;
  /** A pack earned at the end of a tier. */
  pack: CareerPack | null;
  /** Won the belt in this fight. */
  belt: boolean;
  /** Legacy ranks (indexes into LEGACY) reached and paid by this fight. */
  legacy: number[];
}

const PACK_ORDER: readonly CareerPack[] = ['standard', 'premium', 'elite'];

/** What a career fight pays (pure: a server could compute it). */
export function careerReward(step: CareerStep, won: boolean, draw: boolean, method: 'KO' | 'TKO' | 'SUB' | 'DEC'): CareerReward {
  const purse =
    step.kind === 'super'
      ? CAREER_TUNING.superPurse
      : 150 + step.tier * 90 + (step.kind === 'boss' ? 300 : 0) + (step.kind === 'title' ? (step.firstTitle ? 2000 : 500) : 0) + (step.kind === 'defense' ? 600 : 0);
  const base = (purse * (100 + step.prestige * PRESTIGE_PAY)) / 100;
  const finish = method !== 'DEC' && won ? 1.5 : 1;
  let cash = Math.round((won ? base * finish : draw ? base * 0.5 : base * 0.3) / 10) * 10;
  const xp = Math.round((won ? 90 : 45) + step.tier * 25 + (step.kind !== 'fight' ? 80 : 0));
  let gems = 0;
  let pack: CareerReward['pack'] = null;
  const legacy: number[] = [];
  if (won && step.kind === 'boss') {
    gems = 15 + step.tier * 10;
    pack = step.tier >= 3 ? 'premium' : 'standard';
  }
  if (won && step.kind === 'title') {
    if (step.firstTitle) {
      gems = 150;
      pack = 'elite';
    } else if (step.prestigeTitle) {
      // the first belt at a new Prestige
      cash += 500 * step.prestige;
      gems = 50 + 25 * step.prestige;
      pack = step.prestige >= MAX_PRESTIGE ? 'elite' : 'premium';
    } else {
      gems = 30;
      pack = 'standard';
    }
    if (step.champElsewhere) {
      cash += TWO_BELTS.cash;
      gems += TWO_BELTS.gems;
    }
  }
  if (won && step.kind === 'defense') {
    gems = 15;
    for (const i of step.legacy) {
      const l = LEGACY[i];
      if (!l) continue;
      cash += l.cash;
      gems += l.gems;
      legacy.push(i);
      // one pack per fight (the best of the ranks reached), so a long-unpaid old save doesn't flood the packs
      if (l.pack && (!pack || PACK_ORDER.indexOf(l.pack) > PACK_ORDER.indexOf(pack))) pack = l.pack;
    }
  }
  if (won && step.kind === 'super') gems = CAREER_TUNING.superGems;
  return { cash, xp, gems, pack, belt: won && step.kind === 'title', legacy };
}

/** Record the result and move the ladder on (a loss keeps you on the same step). Returns false for a stale step. */
export function applyCareerResult(state: CareerState, step: CareerStep, won: boolean, draw: boolean, method: 'KO' | 'TKO' | 'SUB' | 'DEC'): boolean {
  const c = state.div[step.div];
  // stale: the save moved on (a restore, or the champion vacated) since the fight started
  if (c.tier !== step.tier || c.fight !== step.fight || stepKind(c, step.day) !== step.kind || c.prestige !== step.prestige) return false;
  if (step.kind === 'super') {
    // win, lose or draw: the day's super fight is fought (the belt is not at stake)
    c.superDue = false;
    c.superDay = step.day;
  }
  if (won) {
    c.wins++;
    if (method === 'KO' || method === 'TKO') c.kos++;
    if (method === 'SUB') c.subs++;
    if (step.kind === 'title') {
      c.belt = true;
      c.titles++;
      c.peak = Math.max(c.peak, c.prestige);
      c.reign = 0;
      c.superDue = false;
    } else if (step.kind === 'defense') {
      c.defenses++;
      c.reign++;
      c.superDue = true;
      for (const i of step.legacy) c.legacyPaid = Math.max(c.legacyPaid, i + 1);
    } else if (step.kind === 'super') {
      c.supers++;
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
      c.reign = 0;
      c.superDue = false;
    }
  }
  return true;
}

/** Can the champion vacate and run this division's ladder again at the next Prestige? */
export function canPrestige(c: DivisionCareer): boolean {
  return c.belt && c.prestige < MAX_PRESTIGE;
}

/** Vacate the belt and start the ladder again at the next Prestige (record, titles and Legacy stay). */
export function prestigeUp(state: CareerState, div: DivisionId): boolean {
  const c = state.div[div];
  if (!canPrestige(c)) return false;
  c.prestige++;
  c.tier = 0;
  c.fight = 0;
  c.belt = false;
  c.reign = 0;
  c.superDue = false;
  return true;
}

/**
 * The champion of `from` moves up or down to the neighbouring weight class `to`: `fighterId` fights `to`'s career
 * from now on (until the player picks one of that division's own fighters), starting at Contender if that ladder is
 * lower. The belt in `from` is kept: win both for a two-division champion.
 */
export function moveDivision(state: CareerState, from: DivisionId, to: DivisionId, fighterId: string): boolean {
  const f = rosterFighter(fighterId);
  if (!state.div[from].belt || !neighbourDivisions(from).includes(to) || !f || f.division !== from) return false;
  const c = state.div[to];
  c.guest = fighterId;
  if (c.tier < MOVE_START_TIER) {
    c.tier = MOVE_START_TIER;
    c.fight = 0;
  }
  return true;
}

/**
 * A fighter's stats outside their own weight class: moving up they give away size (less power and chin, a little
 * quicker); moving down they cut weight (more power, less speed and cardio).
 */
export function weightClassStats(stats: FighterStats, from: DivisionId, to: DivisionId): FighterStats {
  const s = { ...stats };
  const d = divIndex(to) - divIndex(from);
  const adj = (k: keyof FighterStats, v: number) => (s[k] = Math.max(1, Math.min(100, s[k] + v)));
  if (d > 0) {
    adj('power', -3);
    adj('chin', -2);
    adj('speed', 2);
  } else if (d < 0) {
    adj('power', 2);
    adj('speed', -2);
    adj('cardio', -3);
  }
  return s;
}

/** 0..1 progress through a division's ladder (for the menus). */
export function careerProgress(c: DivisionCareer): number {
  if (c.tier >= TIERS) return 1;
  return (c.tier * FIGHTS_PER_TIER + c.fight) / (TIERS * FIGHTS_PER_TIER);
}
