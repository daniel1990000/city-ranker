// The computer opponent. It sees only what a player sees (FightView), reacts with a human-like delay, and has a
// style per archetype. Difficulty 0..1000 sets reaction time, how often it defends, combo use and ground skill.
// It has its own seeded RNG, so a fight against it is repeatable; its inputs are recorded in replays anyway.

import { clampi, muldiv, rngChance, rngInt, rngNoise, rngWeighted, seedRng } from './math';
import { MOVES, STRIKES } from './moves';
import { GROUND } from './ground';
import { CLINCH } from './clinch';

const GROUND_SCRAMBLE_WINDOW = GROUND.scrambleWindow;
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
  /** Clinch: chance per decision to grab when close, to trip from the clinch (in control), to break away and to
   *  reverse (when held), and clinch strike weights [knee to the body, knee to the head, elbow, uppercut]. */
  clinch: number;
  trip: number;
  breakAway: number;
  reverse: number;
  clinchWeights: [number, number, number, number];
}

//                         jab cross hookL hookR upper body lowK bodyK headK
//                                                                                                                       knee kneeH elbow upper
const STYLES: Record<Archetype, Style> = {
  brawler: { range: 880, weights: [10, 16, 18, 22, 14, 10, 4, 3, 3], shoot: 300, aggression: 5600, combo: 3, advance: 1200, submit: 300, clinch: 300, trip: 300, breakAway: 2200, reverse: 300, clinchWeights: [20, 8, 34, 38] },
  boxer: { range: 1000, weights: [20, 26, 16, 16, 10, 12, 2, 0, 0], shoot: 150, aggression: 5200, combo: 4, advance: 800, submit: 300, clinch: 120, trip: 100, breakAway: 4500, reverse: 200, clinchWeights: [18, 4, 28, 50] },
  kicker: { range: 1200, weights: [14, 10, 4, 4, 2, 4, 26, 20, 16], shoot: 250, aggression: 4800, combo: 3, advance: 900, submit: 500, clinch: 220, trip: 150, breakAway: 7200, reverse: 300, clinchWeights: [38, 32, 18, 12] },
  wrestler: { range: 1100, weights: [20, 18, 10, 12, 6, 12, 10, 6, 2], shoot: 1100, aggression: 4200, combo: 2, advance: 3000, submit: 900, clinch: 500, trip: 1200, breakAway: 1800, reverse: 1500, clinchWeights: [46, 10, 22, 22] },
  grappler: { range: 1100, weights: [22, 16, 8, 8, 4, 8, 14, 8, 4], shoot: 1100, aggression: 3800, combo: 2, advance: 2600, submit: 3200, clinch: 450, trip: 1300, breakAway: 2600, reverse: 2000, clinchWeights: [44, 12, 24, 20] },
};

/** What to press for each clinch strike (the simulation turns the press into the clinch strike). */
const CLINCH_PRESS: readonly Strike[] = ['bodyShot', 'headKick', 'hookR', 'uppercut'];

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
  /** Last tick the opponent was throwing something (for covering up under pressure). */
  private lastOppAttack = -1000;
  /** No new takedown attempt before this tick (it rests between shots, and after a spell on the ground). */
  private shootAfter = 0;
  private wasGround = false;
  private wasShooting = false;
  /** The knockdown we already decided about (pounce or not), by its start tick. */
  private pounceFor = -1;
  private pounceYes = false;
  private counterBack = false;
  private shellUntil = -1;
  /** How often the opponent has thrown each move this fight (it reads habits) and shot for takedowns. */
  private seenMoves = new Map<MoveId, number>();
  private oppShots = 0;
  private seenTotal = 0;
  private punishThis = false;
  /** Clinch: no grab before this tick; the clinch contest / trip / strike already decided about. */
  private clinchAfter = 0;
  private wasClinch = false;
  private oppGrabs = 0;
  private seenGrab = -1;
  private seenContest = -1;
  private contestAt = -1;
  private contestDir: Evade | null = null;
  private seenTrip = -1;
  private tripDefendAt = -1;
  private clinchBlockFrom = -1;
  private clinchBlockUntil = -1;
  private clinchSeenStrike = -1;
  private grabPunishAt = -1;

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

    // rest between takedown attempts, and after a spell on the ground
    const shooting = me.action === 'shoot';
    if (shooting && !this.wasShooting) this.shootAfter = t + 540 + rngInt(this.rng, 300);
    this.wasShooting = shooting;
    if (this.wasGround && !view.ground) this.shootAfter = Math.max(this.shootAfter, t + 660 + rngInt(this.rng, 300));
    this.wasGround = !!view.ground;

    if (this.wasClinch && !view.clinch) this.clinchAfter = Math.max(this.clinchAfter, t + 240 + rngInt(this.rng, 240));
    this.wasClinch = !!view.clinch;

    if (view.ground) return this.ground(view, input);
    if (view.takedown) return this.takedown(view, input);
    if (view.clinch) return this.clinchPlay(view, input);
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
        // under a barrage (another attack right after the last one) it is readier to cover up
        const pressured = startTick - this.lastOppAttack < 50;
        const md0 = MOVES[them.action as MoveId];
        // slow, telegraphed attacks (kicks, specials) are easier to read; habits it has seen this fight even more so
        const telegraph = md0.startup >= 15 ? 1500 : 0;
        const habit = Math.min(2000, (this.seenMoves.get(them.action as MoveId) ?? 0) * 200);
        this.seenMoves.set(them.action as MoveId, (this.seenMoves.get(them.action as MoveId) ?? 0) + 1);
        this.seenTotal++;
        // answer it in its recovery (slow moves leave the bigger opening)
        this.punishThis = this.chance(800 + muldiv(d, 9, 1) + (md0.recovery >= 17 ? 1500 : 0) + muldiv(habit, 1, 2));
        const defendChance = 1200 + muldiv(d, 7, 1) + (stats.defense - 50) * 25 + (pressured ? 600 + muldiv(d, 4, 1) : 0) + telegraph + muldiv(habit, d, 560);
        // a barrage: hold the guard up for a while instead of reacting punch by punch (a beginner rarely does)
        if (pressured && this.chance(1200 + muldiv(d, 7, 1))) this.shellUntil = t + 30 + rngInt(this.rng, 12);
        this.lastOppAttack = startTick;
        if (this.chance(defendChance)) {
          const move = them.action;
          const impactIn = Math.max(1, them.actionImpact - them.actionTick);
          const at = t + this.reactTicks();
          const md = MOVES[move];
          const evadePref = 1000 + muldiv(d, 3, 1) + ((this.styleId ?? view.mySpec.archetype) === 'boxer' ? 1800 : 0);
          let kind: 'block' | 'evade' | 'back' = 'block';
          let evade: Evade | undefined;
          // a leg kick: check it (raise the guard / leg) or step out of range; better fighters check
          if (md.kind === 'lowKick') kind = this.chance(4500 + muldiv(d, 8, 1)) ? 'block' : 'back';
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


    // rocked: cover up and get out of there (a beginner forgets to)
    if (me.stunned && !isAttack(me.action)) {
      if (this.chance(3000 + muldiv(d, 10, 1))) {
        input.block = true;
        if (view.myRoom > 500 && this.chance(5000)) {
          input.block = false;
          input.move = -1;
        }
        return input;
      }
    }

    // blocked one and they are still in their recovery: hit back (decided once per blocked strike)
    if (me.action === 'blockHit' && me.actionTick === 1) this.counterBack = this.chance(800 + muldiv(d, 9, 1));
    if (this.counterBack && me.action !== 'blockHit' && isAttack(them.action) && them.actionTick > them.actionImpact) {
      this.counterBack = false;
      input.strike = view.dist < 950 ? (this.chance(5000) ? 'hookL' : 'uppercut') : 'cross';
      this.lastPress = t;
      this.plan = [view.dist < 950 ? 'hookR' : 'cross'];
      return input;
    }

    if (t < this.shellUntil && !isAttack(me.action) && !this.counterBack) {
      input.block = true;
      return input;
    }

    // the opponent is down: jump on them or let them up (decided once per knockdown, by style)
    if (them.downed && them.action === 'downed') {
      const kdStart = t - them.actionTick;
      if (kdStart !== this.pounceFor) {
        this.pounceFor = kdStart;
        this.pounceYes = this.chance(st.shoot >= 1000 ? 8000 : (this.styleId ?? view.mySpec.archetype) === 'brawler' ? 5500 : 2500);
      }
      if (!this.pounceYes) return this.footwork(view, input, false);
      if (view.dist > 1400) input.move = 1;
      else input.shoot = true;
      return input;
    }
    // they threw and are still recovering: hit back now
    if (this.punishThis && isAttack(them.action) && them.actionTick > them.actionImpact + 1 && !isAttack(me.action) && view.dist <= 1150 && me.action !== 'blockHit') {
      this.punishThis = false;
      input.strike = view.dist < 900 ? (this.chance(5000) ? 'hookR' : 'hookL') : 'cross';
      this.lastPress = t;
      return input;
    }
    // a one-trick opponent: when they are free and in range of their favourite, expect it (guard up / leg ready)
    if (!isAttack(them.action) && !isAttack(me.action) && this.seenTotal >= 6 && t >= this.shellUntil) {
      let fav: MoveId | null = null;
      let n = 0;
      for (const [m, c] of this.seenMoves) if (c > n) [fav, n] = [m, c];
      if (fav && n * 2 >= this.seenTotal && view.dist <= MOVES[fav].reach + 100 && this.chance(muldiv(d, 5, 1))) {
        this.shellUntil = t + 14 + rngInt(this.rng, 10);
        input.block = true;
        return input;
      }
    }
    // their shot got stuffed and they are scrambling up: make them pay
    if (them.action === 'getUp' && !them.downed && view.dist <= 1100 && !isAttack(me.action) && t - this.lastPress > 8 && this.chance(3000 + muldiv(d, 8, 1))) {
      input.strike = view.dist < 900 ? 'uppercut' : 'cross';
      this.lastPress = t;
      return input;
    }
    // doubled over or rocked in front of us: go for it
    if ((them.action === 'hurtBody' || them.stunned) && view.dist <= st.range + 200 && !isAttack(me.action) && t - this.lastPress > 6 && this.chance(5000 + muldiv(d, 6, 1))) {
      const first = this.pick(view.dist);
      if (first) {
        input.strike = first;
        this.lastPress = t;
        this.plan = [];
        const nx = this.pick(view.dist);
        if (nx) this.plan.push(nx);
        return input;
      }
    }

    // they keep grabbing: when they walk in close, meet them with a jab (walking in gets countered) or step off
    if (them.action === 'clinchEnter' && them.actionTick <= 2 && t - them.actionTick !== this.seenGrab) {
      this.seenGrab = t - them.actionTick;
      this.oppGrabs++;
      // a reach for the clinch is a target: a sharp fighter sees it and punches into it (decided once per grab)
      this.grabPunishAt = !isAttack(me.action) && this.chance(800 + muldiv(d, 7, 1) + Math.min(1200, this.oppGrabs * 200)) ? t + this.reactTicks() - 4 : -1;
    }
    if (this.grabPunishAt >= 0 && t >= this.grabPunishAt) {
      this.grabPunishAt = -1;
      if (them.action === 'clinchEnter' && them.actionTick < CLINCH.enterStartup - 2 && !isAttack(me.action)) {
        input.strike = view.dist < 820 ? 'uppercut' : 'jab';
        this.lastPress = t;
        return input;
      }
    }
    if (this.oppGrabs >= 2 && them.action === 'walkFwd' && view.dist <= 1250 && view.dist > 700 && !isAttack(me.action) && t - this.lastPress > 10 && this.chance(muldiv(d, 4, 1) + Math.min(1500, this.oppGrabs * 250))) {
      this.lastPress = t;
      if (view.myRoom > 600 && this.chance(3000)) input.move = -1;
      else input.strike = 'jab';
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
    // the clinch: grab when close (more against the cage, a turtle or a wobbled opponent)
    if (view.dist <= 1150 && !tired && t >= this.clinchAfter) {
      let c = st.clinch;
      if (view.oppRoom < 900) c += st.clinch >> 1;
      if (them.action === 'block' || them.stunned) c += 600;
      if (this.chance(c)) {
        input.clinch = true;
        this.clinchAfter = t + 300 + rngInt(this.rng, 300);
        return input;
      }
    }
    // takedown
    if (view.dist <= 1450 && !tired && t >= this.shootAfter && this.chance(st.shoot - (view.oppSpec.stats.wrestling - 50) * 10)) {
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
    let want = me.stamina < 2400 ? st.range + 500 : st.range;
    // against someone who lives on kicks, get inside them
    let kicks = 0;
    for (const [m, c] of this.seenMoves) if (MOVES[m].kind === 'kick' || MOVES[m].kind === 'lowKick') kicks += c;
    if (this.seenTotal >= 6 && kicks * 2 >= this.seenTotal && this.skill > 150) want = Math.min(want, 860);
    if (view.dist > want + 140) input.move = 1;
    // too close: back off to the range it likes, unless the cage is right behind (then stand and fight; walking
    // forward into them would only feed their takedowns)
    else if (view.dist < want - 220 && view.myRoom > 450) input.move = -1;
    else if (fresh && this.chance(1800)) input.move = rngInt(this.rng, 2) === 0 ? 1 : -1;
    return input;
  }

  // ---- the clinch ---------------------------------------------------------------------------------------------------

  private clinchPlay(view: FightView, input: FightInput): FightInput {
    const c = view.clinch;
    if (!c) return input;
    const t = view.tick;
    const d = this.skill;
    const st = this.style as Style;
    const me = view.me;
    const them = view.opp;
    const stats = view.mySpec.stats;

    // the position contest: read the arrow and flick it at a person's pace (like a ground scramble)
    if (c.contest) {
      const startTick = t - (CLINCH.contestWindow - c.contest.ticksLeft);
      if (startTick !== this.seenContest) {
        this.seenContest = startTick;
        this.contestAt = t + 22 + muldiv(1000 - this.difficulty, 16, 1000) + rngNoise(this.rng, 4);
        const right = this.chance(6500 + muldiv(d, 33, 10));
        const others = (['left', 'right', 'back'] as Evade[]).filter(x => x !== c.contest?.need);
        this.contestDir = right ? c.contest.need : others[rngInt(this.rng, 2)];
      }
      if (t >= this.contestAt && this.contestDir) {
        input.evade = this.contestDir;
        this.contestDir = null;
      }
      return input;
    }
    // a trip coming: fight it (once decided, at a person's reaction time)
    if (c.trip) {
      if (!c.trip.mine) {
        const startTick = t - (CLINCH.tripTicks - c.trip.ticksLeft);
        if (startTick !== this.seenTrip) {
          this.seenTrip = startTick;
          const chance = 3000 + muldiv(d, 9, 1) + (stats.wrestling - 50) * 40;
          this.tripDefendAt = this.chance(chance) ? t + this.reactTicks() : -1;
        }
        if (this.tripDefendAt >= 0 && t >= this.tripDefendAt) {
          input.shoot = true;
          this.tripDefendAt = -1;
        }
      }
      return input;
    }
    // their strike: cover up (decided once per strike)
    if (isAttack(them.action) && them.actionTick <= 2 && t - them.actionTick !== this.clinchSeenStrike) {
      this.clinchSeenStrike = t - them.actionTick;
      if (this.chance(1500 + muldiv(d, 9, 1) + (stats.defense - 50) * 25)) {
        this.clinchBlockFrom = t + this.reactTicks() - 4;
        this.clinchBlockUntil = t + Math.max(1, them.actionImpact - them.actionTick) + 8;
      }
    }
    if (t >= this.clinchBlockFrom && t < this.clinchBlockUntil && !isAttack(me.action)) {
      input.block = true;
      return input;
    }
    // keep a combo going
    if (isAttack(me.action) && this.plan.length > 0 && me.actionTick > me.actionImpact + 2 && t - this.lastPress > 4) {
      input.strike = this.plan.shift() as Strike;
      this.lastPress = t;
      return input;
    }
    if (t < this.nextThink) return input;
    this.nextThink = t + 10 + rngInt(this.rng, 12) - muldiv(d, 4, 1000);
    const tired = me.stamina < 2000;
    const hurt = me.stunned || me.hurt > 6000;
    if (c.mine) {
      // in control: knees and elbows, the trip, or let go to breathe
      if ((tired || hurt) && this.chance(3500)) {
        input.move = -1;
        return input;
      }
      if (!tired && this.chance(st.trip + (c.wall ? 600 : 0) + (them.stunned ? 1500 : 0) + (them.gassed ? 800 : 0))) {
        input.shoot = true;
        return input;
      }
      if (this.chance(5200 + muldiv(d, 2, 1) - (tired ? 2500 : 0))) return this.clinchStrike(input, d > 500 ? 2 : 1, t);
      return input;
    }
    // held: get out, turn it around, or fight back
    if (this.chance(st.breakAway + (c.wall ? 1500 : 0) + (hurt ? 2500 : 0) + (tired ? 1500 : 0) + muldiv(d, 2, 1))) {
      input.evade = 'back';
      return input;
    }
    if (!tired && this.chance(st.reverse)) {
      input.shoot = true;
      return input;
    }
    if (this.chance(3200 + muldiv(d, 2, 1) - (tired ? 2000 : 0))) return this.clinchStrike(input, 1, t);
    return input;
  }

  /** Throw a clinch strike by the style's weights, with a short follow-up plan. */
  private clinchStrike(input: FightInput, follow: number, t: number): FightInput {
    const st = this.style as Style;
    input.strike = rngWeighted(this.rng, CLINCH_PRESS, st.clinchWeights);
    this.lastPress = t;
    this.plan = [];
    const n = rngInt(this.rng, follow + 1);
    for (let i = 0; i < n; i++) this.plan.push(rngWeighted(this.rng, CLINCH_PRESS, st.clinchWeights));
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
      // every shot it has already seen makes it readier for the next one
      const chance = 2500 + muldiv(this.skill, 6, 1) + (view.mySpec.stats.wrestling - 50) * 30 + Math.min(3000, this.oppShots * 600);
      this.oppShots++;
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

    // the submission tug-of-war: mash at a human pace that depends on difficulty (4.3..7.5 taps a second; a person
    // on a phone manages 6..8)
    if (g.sub) {
      const every = Math.max(8, 15 - muldiv(this.difficulty, 7, 1000));
      if (t % every === 0) input.tap = true;
      return input;
    }
    // scramble: see the arrow, answer it (sometimes wrong when flustered)
    if (g.scramble) {
      const startTick = t - (GROUND_SCRAMBLE_WINDOW - g.scramble.ticksLeft);
      if (startTick !== this.seenScramble) {
        this.seenScramble = startTick;
        // reading a random arrow and swiping takes a person about half a second: so does the AI (0.4..0.7 s)
        this.scrambleAt = t + 24 + muldiv(1000 - this.difficulty, 18, 1000) + rngNoise(this.rng, 4);
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
