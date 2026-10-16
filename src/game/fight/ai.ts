// The computer opponent. It sees only what a player sees (FightView), reacts with a human-like delay, and has a
// style per archetype. Difficulty 0..1000 sets reaction time, how often it defends, combo use and ground skill.
// It has its own seeded RNG, so a fight against it is repeatable; its inputs are recorded in replays anyway.

import { clampi, muldiv, rngChance, rngInt, rngNoise, rngWeighted, seedRng } from './math';
import { MOVES, STRIKES } from './moves';
import type { Archetype, Controller, Evade, FightInput, FightView, GroundDir, MoveId, Side, Strike } from './types';
import { METER_MAX } from './types';

interface Style {
  /** Preferred centre-to-centre distance (mm). */
  range: number;
  /** Strike preferences (weights in STRIKES order). */
  weights: number[];
  /** Chance per decision (per 10000) to shoot a takedown when in range. */
  shoot: number;
  /** How busy it is: chance per decision to attack when in range. */
  aggression: number;
  /** Longest combo it plans. */
  combo: number;
  /** Ground: chance per decision to try to improve position / submit. */
  advance: number;
  submit: number;
}

//                         jab cross hookL hookR upper body lowK bodyK headK
const STYLES: Record<Archetype, Style> = {
  brawler: { range: 880, weights: [10, 16, 18, 22, 14, 10, 4, 3, 3], shoot: 300, aggression: 6200, combo: 4, advance: 1200, submit: 300 },
  boxer: { range: 1000, weights: [20, 26, 16, 16, 10, 12, 2, 0, 0], shoot: 150, aggression: 5200, combo: 4, advance: 800, submit: 300 },
  kicker: { range: 1200, weights: [14, 10, 4, 4, 2, 4, 26, 20, 16], shoot: 250, aggression: 4800, combo: 3, advance: 900, submit: 500 },
  wrestler: { range: 1100, weights: [20, 18, 10, 12, 6, 12, 10, 6, 2], shoot: 1500, aggression: 4200, combo: 2, advance: 3000, submit: 900 },
  grappler: { range: 1100, weights: [22, 16, 8, 8, 4, 8, 14, 8, 4], shoot: 1500, aggression: 3800, combo: 2, advance: 2600, submit: 3200 },
};

export interface AIOptions {
  /** 0 (a beginner) .. 1000 (a champion). */
  difficulty: number;
  seed: number;
  /** Defaults to the fighter's archetype. */
  style?: Archetype;
}

function isAttack(a: string): a is MoveId {
  return a in MOVES;
}

export class AIController implements Controller {
  readonly difficulty: number;
  private readonly skill: number;
  private rng: { rng: number };
  private style: Style | null = null;
  private styleId: Archetype | null;
  /** A reaction decided earlier, carried out at `at` (human reaction time). */
  private reaction: { at: number; kind: 'block' | 'evade' | 'back'; evade?: Evade; until: number } | null = null;
  private blockUntil = -1;
  /** The opponent attack we already decided about (by start tick). */
  private seenAttack = -1;
  private nextThink = 0;
  private plan: Strike[] = [];
  private lastPress = -100;
  private sprawlAt = -1;
  private scrambleAt = -1;
  private scrambleDir: GroundDir | null = null;
  private seenScramble = -1;

  constructor(opts: AIOptions) {
    this.difficulty = clampi(opts.difficulty | 0, 0, 1000);
    // the skill actually used: tuned so 0 is a beginner a new player beats ~4 times in 5 and 1000 a champion a good
    // player still beats about 1 time in 4 (scripts/qa/fight-balance.test.ts measures the curve)
    this.skill = muldiv(this.difficulty, 56, 100);
    this.rng = { rng: seedRng(opts.seed ^ 0x5eed) };
    this.styleId = opts.style ?? null;
  }

  /** Reaction delay in ticks: ~400 ms for a beginner, ~170 ms for a champion, with jitter. */
  private reactTicks(): number {
    const base = 30 - muldiv(this.skill, 16, 1000);
    return Math.max(6, base + rngNoise(this.rng, 3));
  }

  private chance(p10000: number): boolean {
    return rngChance(this.rng, clampi(p10000, 0, 10000));
  }

  next(view: FightView, side: Side): FightInput {
    void side;
    if (!this.style) this.style = STYLES[this.styleId ?? view.mySpec.archetype];
    const input: FightInput = { strike: null, special: false, block: false, evade: null, move: 0, shoot: false, ground: null, tap: false };
    if (view.phase !== 'fight') return input;
    const me = view.me;
    const t = view.tick;

    // knocked down: scramble to get up
    if (me.action === 'downed') {
      if (t % Math.max(3, 9 - muldiv(this.difficulty, 5, 1000)) === 0) input.tap = true;
      return input;
    }

    if (view.ground) return this.ground(view, input);
    if (view.takedown) return this.takedown(view, input);
    return this.standing(view, input);
  }

  // ---- standing ------------------------------------------------------------------------------------------------

  private standing(view: FightView, input: FightInput): FightInput {
    const me = view.me;
    const them = view.opp;
    const st = this.style as Style;
    const t = view.tick;
    const d = this.skill;
    const stats = view.mySpec.stats;

    // see their attack start and decide how (and whether) to defend
    if (isAttack(them.action) && them.actionTick <= 2) {
      const startTick = t - them.actionTick;
      if (startTick !== this.seenAttack) {
        this.seenAttack = startTick;
        const defendChance = 800 + muldiv(d, 46, 10) + (stats.defense - 50) * 25;
        if (this.chance(defendChance)) {
          const move = them.action;
          const impactIn = Math.max(1, them.actionImpact - them.actionTick);
          const at = t + this.reactTicks();
          const md = MOVES[move];
          const evadePref = 1000 + muldiv(d, 3, 1) + ((this.styleId ?? view.mySpec.archetype) === 'boxer' ? 1800 : 0);
          let kind: 'block' | 'evade' | 'back' = 'block';
          let evade: Evade | undefined;
          if (md.kind === 'lowKick') kind = 'back';
          else if (this.chance(evadePref)) {
            if (md.kind === 'straight' || md.kind === 'lunge') {
              kind = 'evade';
              evade = rngInt(this.rng, 2) === 0 ? 'left' : 'right';
            } else if (move === 'hookL') {
              kind = 'evade';
              evade = 'right';
            } else if (move === 'hookR') {
              kind = 'evade';
              evade = 'left';
            } else if (md.zone === 'head' && md.kind === 'kick') {
              kind = 'evade';
              evade = 'back';
            }
          }
          // a reaction that comes too late is wasted (the hit lands first), but the AI does not know that
          this.reaction = { at, kind, evade, until: t + impactIn + md.active + 8 };
        }
      }
    }

    if (this.reaction && t >= this.reaction.at) {
      const r = this.reaction;
      this.reaction = null;
      if (r.kind === 'evade' && r.evade) {
        input.evade = r.evade;
        return input;
      }
      if (r.kind === 'back') {
        input.move = -1;
        this.blockUntil = t + 10;
      } else this.blockUntil = r.until;
    }
    if (t < this.blockUntil) {
      input.block = this.reaction === null && this.blockUntil > t && !isAttack(me.action);
      if (input.block) return input;
    }

    // the opponent is down: jump on them or let them up
    if (them.downed && them.action === 'downed') {
      if (view.dist > 1400) input.move = 1;
      else if (st.shoot > 1000 || this.chance(4000)) input.shoot = true;
      return input;
    }

    // a counter window after a perfect evade: punish right now
    if (me.counter && this.chance(4000 + muldiv(d, 6, 1))) {
      input.strike = view.dist < 950 ? 'hookR' : 'cross';
      return input;
    }

    // keep a combo going: press the next strike once the current one has hit or been blocked
    if (isAttack(me.action) && this.plan.length > 0 && me.actionTick > me.actionImpact + 2 && t - this.lastPress > 4) {
      const next = this.plan.shift() as Strike;
      input.strike = next;
      this.lastPress = t;
      return input;
    }

    if (t < this.nextThink) return this.footwork(view, input, false);
    this.nextThink = t + 8 + rngInt(this.rng, 10) - muldiv(d, 4, 1000);

    const tired = me.stamina < 2400;
    const special = me.special >= METER_MAX;
    const hurtThem = them.stunned || them.guardBroken;

    if (special && view.dist <= 1300 && this.chance(5000 + muldiv(d, 4, 1))) {
      input.special = true;
      return input;
    }
    // takedown
    if (view.dist <= 1450 && !tired && this.chance(st.shoot - (view.oppSpec.stats.wrestling - 50) * 10)) {
      input.shoot = true;
      return input;
    }
    // attack when in range
    let aggr = st.aggression - 1500 + muldiv(d, 2, 1) + (hurtThem ? 3500 : 0) - (tired ? 3000 : 0);
    if (them.gassed) aggr += 1000;
    if (view.dist <= st.range + 180 && this.chance(aggr)) {
      const first = this.pick(view.dist);
      if (first) {
        input.strike = first;
        this.lastPress = t;
        // plan a follow-up combo
        this.plan = [];
        const n = rngInt(this.rng, st.combo) + (d > 600 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const nx = this.pick(Math.max(700, view.dist - 120));
          if (nx) this.plan.push(nx);
        }
        return input;
      }
    }
    // taunt now and then when well ahead and safe
    if (!tired && view.dist > 2000 && them.stamina < 3000 && this.chance(200)) {
      input.taunt = true;
      return input;
    }
    return this.footwork(view, input, true);
  }

  /** Pick a strike that reaches from here, by the style's weights. */
  private pick(dist: number): Strike | null {
    const st = this.style as Style;
    const w = STRIKES.map((s, i) => (MOVES[s].reach >= dist - 40 ? st.weights[i] : 0));
    if (w.every(v => v === 0)) return null;
    return rngWeighted(this.rng, STRIKES, w);
  }

  private footwork(view: FightView, input: FightInput, fresh: boolean): FightInput {
    const st = this.style as Style;
    const me = view.me;
    const want = me.stamina < 2400 ? st.range + 500 : st.range;
    if (view.dist > want + 140) input.move = 1;
    else if (view.dist < want - 220) input.move = view.myRoom > 450 ? -1 : 1;
    else if (fresh && this.chance(1800)) input.move = rngInt(this.rng, 2) === 0 ? 1 : -1;
    return input;
  }

  // ---- the takedown window ---------------------------------------------------------------------------------------

  private takedown(view: FightView, input: FightInput): FightInput {
    const td = view.takedown;
    if (!td || td.mine) {
      this.sprawlAt = -1;
      return input;
    }
    if (this.sprawlAt < 0) {
      const chance = 2500 + muldiv(this.skill, 6, 1) + (view.mySpec.stats.wrestling - 50) * 30;
      this.sprawlAt = this.chance(chance) ? view.tick + this.reactTicks() - 6 : view.tick + 1000;
    }
    if (view.tick >= this.sprawlAt) {
      input.shoot = true;
      this.sprawlAt = view.tick + 1000;
    }
    return input;
  }

  // ---- the ground ------------------------------------------------------------------------------------------------

  private ground(view: FightView, input: FightInput): FightInput {
    const g = view.ground;
    if (!g) return input;
    const t = view.tick;
    const d = this.skill;
    const st = this.style as Style;
    const me = view.me;
    const them = view.opp;

    // the submission tug-of-war: mash at a rate that depends on difficulty (5.5..8.5 taps a second)
    if (g.sub) {
      const every = Math.max(6, 11 - muldiv(d, 4, 1000));
      if (t % every === 0) input.tap = true;
      return input;
    }
    // scramble: see the arrow, answer it (sometimes wrong when flustered)
    if (g.scramble) {
      const startTick = t - (48 - g.scramble.ticksLeft);
      if (startTick !== this.seenScramble) {
        this.seenScramble = startTick;
        this.scrambleAt = t + this.reactTicks() - 3;
        const right = this.chance(6500 + muldiv(d, 33, 10));
        this.scrambleDir = right ? g.scramble.dir : (['up', 'down', 'left', 'right'] as GroundDir[]).filter(x => x !== g.scramble?.dir)[rngInt(this.rng, 3)];
      }
      if (t >= this.scrambleAt && this.scrambleDir) {
        input.ground = this.scrambleDir;
        this.scrambleDir = null;
      }
      return input;
    }
    if (g.meTop) {
      if (me.action !== 'gndGuardTop' && me.action !== 'gndMountTop') return input;
      if (t < this.nextThink) return input;
      this.nextThink = t + 14 + rngInt(this.rng, 14) - muldiv(d, 6, 1000);
      if (g.pos === 'guard' && this.chance(st.advance)) input.ground = 'up';
      else if (this.chance(st.submit + (them.hurt > 6000 ? 1500 : 0) - (them.stamina > 6000 ? 600 : 0))) input.ground = 'down';
      else input.tap = true;
      return input;
    }
    // bottom: cover up against ground-and-pound, look for the way out
    if (them.action === 'gndPound' && them.actionTick < 9 && this.chance(2500 + muldiv(d, 6, 1))) {
      input.block = true;
      return input;
    }
    if (me.action === 'gndBlock' && them.action === 'gndPound') {
      input.block = true;
      return input;
    }
    if (t < this.nextThink) return input;
    this.nextThink = t + 20 + rngInt(this.rng, 20);
    if (g.pos === 'guard' && this.chance(muldiv(st.submit, 6, 10))) input.ground = 'down';
    else if (this.chance(2200 + muldiv(d, 3, 1))) input.ground = 'up';
    return input;
  }
}

/** A stand-in for a reasonable human player, for difficulty and balance tests. */
export function humanLikeBot(seed: number, style: Archetype = 'boxer'): AIController {
  return new AIController({ difficulty: 520, seed, style });
}
