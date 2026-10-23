// Fighter runtime model (docs/03). Immutable `spec` (data) + mutable runtime state.

import { RATINGS, REGIONS, Mode, HEALTH_EVENT_ID, toTicks } from '../core/taxonomy.js';
import { clamp, vFromAngle } from '../core/math.js';

const DEFAULT_RATING = 50;
const MODE_INDEX = Object.fromEntries(Object.values(Mode).map((m, i) => [m, i]));

export function defaultSpec(over = {}) {
  const ratings = {};
  for (const r of RATINGS) ratings[r] = DEFAULT_RATING;
  return {
    id: 'f0', name: 'Fighter', stance: 'orthodox', style: 'kickboxer', tendency: 'striking_purist',
    handsDown: false, difficulty: 'pro', skills: [],
    ...over,
    physique: { heightCm: 180, reachCm: 182, weightKg: 77, ...(over.physique ?? {}) },
    ratings: { ...ratings, ...(over.ratings ?? {}) },
  };
}

export class Fighter {
  constructor(spec, tun, index = 0) {
    this.spec = defaultSpec(spec);
    this.tun = tun;
    this.index = index;
    this.id = this.spec.id;
    this.name = this.spec.name;
    this.stance = this.spec.stance;
    this.style = this.spec.style;
    this.tendency = this.spec.tendency;
    this.skills = [...(this.spec.skills ?? [])];
    this.ratings = { ...this.spec.ratings };
    this.handsDown = !!this.spec.handsDown;
    this.radius = tun.fighter.radius;
    this.reachFactor = clamp(1 + 0.12 * (this.spec.physique.reachCm - tun.fighter.reachRefCm) / 20, 0.9, 1.12);

    // geometry
    this.pos = { x: 0, y: 0 };
    this.facing = 0;
    this.vel = { x: 0, y: 0 };

    // health & stamina
    this.pools = {};
    const t = tun.pools;
    const tough = this.ratings.toughness;
    const mix = t.toughnessMix;
    this.pools.head = this.#pool(t.headBase + t.headPerChin * ((1 - mix) * this.ratings.chinhealth + mix * tough));
    this.pools.body = this.#pool(t.bodyBase + t.bodyPerBody * ((1 - mix) * this.ratings.bodyhealth + mix * tough));
    this.pools.legL = this.#pool(t.legBase + t.legPerLeg * ((1 - mix) * this.ratings.leghealth + mix * tough));
    this.pools.legR = this.#pool(t.legBase + t.legPerLeg * ((1 - mix) * this.ratings.leghealth + mix * tough));
    this.maxStamina = tun.stamina.max;
    this.stamina = this.maxStamina;

    // state machine
    this.mode = Mode.STANDUP;
    this.bout = null;
    this.action = null;           // {move, tick, resolved, charge, feint}
    this.recoveryExtra = 0;       // extra recovery ticks (e.g. after a parried strike)
    this.guard = { state: 'none', timeUp: 0 };
    this.parryTicks = 0; this.parryLock = 0;
    this.slipTicks = 0; this.catchTicks = 0;
    this.counterWindow = 0;
    this.heldLeg = null;          // catch state: {ticks, from}
    this.trapped = 0;             // ticks this fighter is stuck in a caught kick
    this.status = { event: 'none', ticks: 0, recovery: 0, helpless: false, moveMult: 1, guardMult: 1, limpLeg: null, limpTicks: 0, nextHeavyKdBonus: 0 };
    this.floorPosture = null;
    this.combo = { count: 0, lastTick: -999 };
    this.stanceSwitchTicks = 0;
    this.intent = null;
    this.lastHitTick = -9999;
    this.injuries = {};
    this.abilities = [];

    // control & bookkeeping used by the paired states, referee and AI
    this.human = !!this.spec.human;
    this.groundRole = null;       // 'dom' | 'sub' while in a clinch / ground / submission bout
    this.fenceDominance = false; this.backAgainstCage = false;
    this.cooldowns = { clinch: 0, ground: 0, takedown: 0, submission: 0 };
    this.cover = 0;               // ticks of ground cover (blocking) remaining
    this.activeDefenceTick = -9999;
    this.failedGetups = 0;
    this.damageLog = [];          // [{tick, taken}] trimmed to the last 8 s
    this.strikeLog = [];          // ticks at which this fighter threw a strike (last 5 s)
    this.lastActionTick = 0;
    this.mods = { strike: null, takedown: 0, submission: 0 };   // one-shot ability effects (docs/15)
    this.buckled = false; this.downTick = 0;
  }

  /** damage received in the last `ticks` ticks (aggression input `delta_health`) */
  recentDamage(tick, ticks = 480) {
    let s = 0;
    for (const e of this.damageLog) if (tick - e.tick <= ticks) s += e.taken;
    return s;
  }
  logDamage(tick, taken) {
    this.damageLog.push({ tick, taken });
    while (this.damageLog.length && tick - this.damageLog[0].tick > 480) this.damageLog.shift();
  }
  logStrike(tick) {
    this.strikeLog.push(tick);
    while (this.strikeLog.length && tick - this.strikeLog[0] > 300) this.strikeLog.shift();
  }

  #pool(max) { return { cur: max, max }; }

  rating(name) { return this.ratings[name] ?? DEFAULT_RATING; }

  /** lead/back → left/right limb under the current stance (orthodox lead = left). */
  limbSide(side) {
    const leftLead = this.stance === 'orthodox';
    return (side === 'lead') === leftLead ? 'left' : 'right';
  }
  limbPower(limb, side) {
    const lr = this.limbSide(side);
    return this.rating(limb === 'punch' ? `${lr}handpower` : `${lr}legpower`);
  }
  speedRating(limb) { return this.rating(limb === 'punch' ? 'punchspeed' : 'kickspeed'); }
  /** the region key for the lead/back leg (orthodox lead leg = left). */
  legRegion(which) { return this.limbSide(which) === 'left' ? 'legL' : 'legR'; }

  facingVec() { return vFromAngle(this.facing); }

  poolFraction(region) { const p = this.pools[region]; return p.max > 0 ? p.cur / p.max : 0; }
  overallHealthFraction() {
    return 0.5 * this.poolFraction('head') + 0.3 * this.poolFraction('body') + 0.1 * this.poolFraction('legL') + 0.1 * this.poolFraction('legR');
  }
  /** damage a pool; returns the amount actually removed */
  damagePool(region, amount) {
    const p = this.pools[region];
    const before = p.cur;
    p.cur = Math.max(0, p.cur - amount);
    return before - p.cur;
  }
  healPool(region, amount) { const p = this.pools[region]; p.cur = Math.min(p.max, p.cur + amount); }

  staminaFraction() { return this.stamina / this.maxStamina; }
  spendStamina(n) { this.stamina = clamp(this.stamina - n, 0, this.maxStamina); }
  gassed() { return this.staminaFraction() < this.tun.stamina.gassedBelow; }

  isHelpless() { return this.status.helpless && this.status.ticks > 0; }
  isDown() { return this.mode === Mode.DOWN; }
  busy() { return this.action !== null; }

  moveSpeedMult() {
    const f = this.tun.fighter;
    let m = 0.85 + f.movementRatingSpan * this.rating('movement') / 100;
    if (this.status.limpTicks > 0) m *= f.limpMult;
    if (this.gassed()) m *= f.gassedSpeedMult;
    if (this.status.ticks > 0 || this.status.recovery > 0) m *= this.status.moveMult;
    return m;
  }

  /** numbers used for the sim state hash (stable, order-fixed; includes the paired-state bout if any) */
  hashNumbers() {
    return [this.pos.x, this.pos.y, this.facing, this.stamina, this.pools.head.cur, this.pools.body.cur, this.pools.legL.cur, this.pools.legR.cur,
      this.action ? this.action.tick + 1 : 0, this.status.ticks, this.status.recovery, MODE_INDEX[this.mode] ?? 99,
      HEALTH_EVENT_ID[this.status.event] ?? 99, this.guard.timeUp, this.counterWindow, this.combo.count,
      ...(this.bout && this.bout.hashNumbers ? this.bout.hashNumbers() : [])];
  }

  /** frames scaled by speed rating, gassing and hands-down */
  scaledFrames(move) {
    const sp = 0.9 + 0.2 * this.speedRating(move.limb) / 100;
    const gas = this.gassed() ? 1.08 : 1;
    const f = move.frames;
    const startupBonus = this.handsDown ? this.tun.defense.handsDownStartupBonus : 0;
    return {
      startup: Math.max(1, Math.round((f.startup * gas) / sp) - startupBonus),
      active: f.active,
      recovery: Math.max(2, Math.round((f.recovery * gas) / sp)),
    };
  }
}

export function placeFighters(a, b, gap = 1.6) {
  a.pos = { x: -gap / 2, y: 0 }; b.pos = { x: gap / 2, y: 0 };
  a.facing = 0; b.facing = Math.PI;
}

export const secondsToTicks = toTicks;
export { REGIONS };
