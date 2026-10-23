// Submissions (docs/10 §4): a SubmissionBout runs up to five stage duels between attacker and defender.
//   auto   – rating roll per stage                           (AI vs AI, headless sims)
//   meter  – SnakeMeter timing duel per stage                 (human, mobile-style)
//   gate   – ButtonSnipe prompt per stage (defender blocks)   (human, console-style)
//   snipe  – SnipeChain: 3 count-up tries to set the hold, then a countdown of ever-faster prompts
// Attacker wins a duel → stage++ and submission damage; defender wins → depth--; depth < 0 → escape.
// Completing stage 5 → tap decision: tap → win; no-tap → choke = unconscious (KO), lock = injury stoppage.

import { SUBMISSIONS, Mode, ClinchRole as R, DT } from '../core/taxonomy.js';
import { clamp } from '../core/math.js';
import { EventType } from '../sim/events.js';
import { SnakeMeter, ButtonSnipe, SnipeChain } from './minigames.js';
import { GroundBout, GROUND_GRAPH } from './ground.js';

const RATING = { choke: ['chokesubmission', 'chokedefense'], lock: ['jointsubmission', 'jointdefense'] };

export const submissionCategory = (name) => SUBMISSIONS[name]?.category ?? 'none';

/** Names applicable from `position` for a fighter in `role` ('dom' = top, 'sub' = bottom). */
export function availableSubmissions(position, role) {
  return Object.entries(SUBMISSIONS).filter(([, s]) => s.from[position] === role).map(([name]) => name);
}

const ratings = (att, def, name) => {
  const [a, d] = RATING[submissionCategory(name)] ?? RATING.lock;
  return [att.rating(a), def.rating(d)];
};

/** Gate roll to lock the submission in (docs/10 §4). */
export function submissionStartProbability(att, def, name, tun) {
  const s = tun.submission;
  const [atk, dfn] = ratings(att, def, name);
  return clamp(s.startBase + s.startPerRating * (atk - dfn) - 0.1 * (1 - att.staminaFraction()) + (att.mods?.submission ?? 0), s.startMin, s.startMax);
}

/** Probability the attacker wins the duel for stage `stage` (1..5). */
export function stageProbability(att, def, name, stage, tun) {
  const s = tun.submission;
  const [atk, dfn] = ratings(att, def, name);
  return clamp(s.stageBase + s.stagePerRating * (atk - dfn) - s.stagePenaltyPerStage * stage + s.staminaDiffWeight * (att.staminaFraction() - def.staminaFraction()) + (att.mods?.submission ?? 0), s.stageMin, s.stageMax);
}

/** Meter difficulty from the rating delta (docs/10 §3.1 [REC]). */
export function meterDifficulty(att, def, name) {
  const [atk, dfn] = ratings(att, def, name);
  return clamp(0.5 + (dfn - atk) / 200, 0.1, 0.9);
}

/** Position a defender reaches by escaping a submission applied by the fighter on top. */
export function escapePosition(position) {
  const e = GROUND_GRAPH[position].bottom.find((x) => !x.flag && !x.swap) ?? GROUND_GRAPH[position].bottom[0];
  return e.to;
}

/**
 * Start a submission attempt from a ground position. Emits `start`, rolls the gate and, if it locks, takes the fighters out of
 * the ground bout into a SubmissionBout. Returns {ok:false} when the move is not available from this position / role.
 */
export function beginSubmission(world, { attacker, defender, name, position, role, ground = null }) {
  const sub = SUBMISSIONS[name];
  if (!sub || sub.from[position] !== role) return { ok: false, reason: 'unavailable' };
  const base = { attacker: attacker.id, defender: defender.id, name, category: sub.category };
  world.emit(EventType.SUBMISSION, { ...base, stage: 0, result: 'start' });
  if (!world.rng('submission').chance(submissionStartProbability(attacker, defender, name, world.tun))) {
    world.emit(EventType.SUBMISSION, { ...base, stage: 0, result: 'denied' });
    return { ok: true, started: false };
  }
  const ctx = { position, role, top: ground ? ground.top : (role === R.DOM ? attacker : defender), bottom: ground ? ground.bottom : (role === R.DOM ? defender : attacker), topPosture: ground ? ground.topPosture : 'upright' };
  if (ground) ground.release({ restore: false });
  return { ok: true, started: true, bout: new SubmissionBout(world, attacker, defender, name, ctx) };
}

export class SubmissionBout {
  constructor(world, attacker, defender, name, ctx) {
    this.kind = 'submission';
    this.world = world;
    this.attacker = attacker; this.defender = defender;
    this.a = world.fighters[0]; this.b = world.fighters[1];
    this.name = name; this.category = submissionCategory(name);
    this.position = ctx.position; this.role = ctx.role; this.ctx = ctx;
    const s = world.tun.submission;
    this.stage = 0; this.depth = s.startDepth; this.damage = 0;
    this.finished = false; this.result = null;
    this.phase = 'duel'; this.ticks = 0; this.stageTicks = 0; this.tapTicks = 0;
    this.input = new Map([[attacker.id, {}], [defender.id, {}]]);
    this.mode = (s.mode !== 'auto' && (attacker.human || defender.human)) ? s.mode : 'auto';
    for (const f of this.fighters) {
      f.mode = Mode.SUBMISSION; f.bout = this; f.action = null; f.vel = { x: 0, y: 0 };
      f.guard = { state: 'none', timeUp: 0 }; f.cover = 0;
    }
    this.#newDuel(true);
  }

  get fighters() { return [this.a, this.b]; }
  other(f) { return f === this.attacker ? this.defender : this.attacker; }
  get locked() { return this.stage >= 2; }
  base(extra) { return { attacker: this.attacker.id, defender: this.defender.id, name: this.name, category: this.category, ...extra }; }

  applyIntent(f, intent) {
    const p = intent.prompt ?? {};
    this.input.set(f.id, { end: !!p.end, buttons: p.buttons ?? [0, 0, 0, 0], tap: !!p.tap, noTap: !!p.noTap });
    return true;
  }
  resolveAction() { return null; }
  legalActions() { return []; }

  // ---- duel factories ----
  #newDuel(first = false) {
    const { world } = this, s = world.tun.submission, rng = world.rng('minigame');
    this.stageTicks = 0;
    if (this.mode === 'meter') {
      this.duel = new SnakeMeter({ ...s.meter, difficulty: meterDifficulty(this.attacker, this.defender, this.name), random: rng.next(), domPlaying: this.attacker.human, subPlaying: this.defender.human }).start();
    } else if (this.mode === 'gate') {
      this.duel = new ButtonSnipe().start(rng.int(4));
      this.gateTime = s.gateTicks;
    } else if (this.mode === 'snipe') {
      if (first) { this.chain = new SnipeChain(); this.chainPhase = 'countup'; this.tries = 0; this.promptIn = 20; this.chainStarted = false; }
    }
  }

  // ---- per tick ----
  update() {
    if (this.finished) return { ended: true };
    const { world } = this, s = world.tun.submission;
    this.ticks += 1;
    this.attacker.spendStamina(s.staminaPerSecAttacker * DT); this.defender.spendStamina(s.staminaPerSecDefender * DT);
    if (this.phase === 'tap') return this.#tickTapDecision();
    if (this.attacker.staminaFraction() < s.abortStamina && !this.attacker.human) { this.#abort('fatigue'); return { ended: true }; }
    switch (this.mode) {
      case 'meter': this.#tickMeter(); break;
      case 'gate': this.#tickGate(); break;
      case 'snipe': this.#tickSnipe(); break;
      default: this.#tickAuto();
    }
    return this.finished ? { ended: true } : null;
  }

  #tickAuto() {
    const s = this.world.tun.submission;
    if (++this.stageTicks < s.stageTicks) return;
    const won = this.world.rng('submission').chance(stageProbability(this.attacker, this.defender, this.name, this.stage + 1, this.world.tun));
    this.#duelResult(won);
  }

  #tickMeter() {
    const i = this.input;
    const out = this.duel.tick(DT, { domEnd: !!i.get(this.attacker.id).end, subEnd: !!i.get(this.defender.id).end });
    if (out.finished) { this.#duelResult(out.domWon); }
  }

  #tickGate() {
    const i = this.input;
    const out = this.duel.tick({
      snipeTime: this.gateTime, domPlaying: this.attacker.human, domButtons: i.get(this.attacker.id).buttons,
      subPlaying: this.defender.human, subButtons: i.get(this.defender.id).buttons, dt: 1,
    });
    if (out.finished) this.#duelResult(out.domWon);
  }

  #tickSnipe() {
    const { world } = this, s = world.tun.submission, i = this.input, rng = world.rng('minigame');
    if (this.promptIn > 0) this.promptIn -= 1;
    const prompting = this.promptIn === 0 && !this.chainBusy;
    const countingDown = this.chainPhase === 'countdown';
    const out = this.chain.tick({
      resetTrigger: !this.chainStarted, countUpTrigger: prompting && !countingDown, countUpSnipeTime: s.snipeCountUpTime,
      isCountingDown: countingDown, countDownSnipeTime: s.snipeCountDownTime, countDownTimerDelay: s.snipeDelayTicks,
      countDownTimerDelaySpeedIncrease: s.snipeSpeedUp, countDownTimerDelayMinTicks: s.snipeMinDelay,
      snipeButton: this.nextButton ?? (this.nextButton = rng.int(4)),
      domPlaying: this.attacker.human, domButtons: i.get(this.attacker.id).buttons,
      subPlaying: this.defender.human, subButtons: i.get(this.defender.id).buttons, dt: 1, domInitiates: true, stopTrigger: false,
    });
    this.chainStarted = true;
    this.chainBusy = out.snipeTime > 0;
    if (out.snipeResult) {
      this.nextButton = null; this.chainBusy = false; this.promptIn = 12;
      if (this.chainPhase === 'countup') {
        this.tries += 1;
        if (this.tries >= 3) {
          if (out.snipeCount <= 0) { this.#denied(); return; }
          this.chainPhase = 'countdown'; this.depth = Math.min(out.snipeCount, s.startDepth + 1) - 1; this.promptIn = 0;   // same chain keeps its SnipeCount
        }
      } else {
        this.#duelResult(!!out.initiatorWon, { fromSnipe: true });
      }
    }
  }

  #denied() {
    this.world.emit(EventType.SUBMISSION, this.base({ stage: 0, result: 'denied' }));
    this.#restoreGround(this.position, 'denied');
  }

  // ---- results ----
  #duelResult(attackerWon) {
    const { world } = this, s = world.tun.submission;
    if (attackerWon) {
      this.stage += 1;
      this.damage += s.stageDamage[this.category] ?? 0.2;
      world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'stage' }));
      if (this.stage >= s.stages) return this.#complete();
    } else {
      this.depth -= 1;
      if (this.depth < 0) return this.#escape();
      world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'defend' }));
    }
    if (this.mode === 'snipe') { this.stageTicks = 0; return undefined; }
    this.#newDuel();
    return undefined;
  }

  #complete() {
    this.phase = 'tap'; this.tapTicks = 0;
    if (this.defender.human) this.tapWait = 120;
  }

  #tickTapDecision() {
    const { world } = this, s = world.tun.submission;
    this.tapTicks += 1;
    const inp = this.input.get(this.defender.id);
    let decision = null;
    if (this.defender.human) {
      if (inp.tap) decision = 'tap'; else if (inp.noTap) decision = 'no_tap';
      else if (this.tapTicks >= this.tapWait) decision = 'tap';
    } else if (this.tapTicks >= 20) {
      const pTap = clamp(s.tapBase - s.tapToughnessWeight * (this.defender.rating('toughness') - 50), s.tapMin, s.tapMax);
      decision = world.rng('submission').chance(pTap) ? 'tap' : 'no_tap';
    }
    if (!decision) return null;
    this.finished = true; this.phase = 'done';
    if (this.attacker.mods) this.attacker.mods.submission = 0;
    for (const f of this.fighters) if (f.bout === this) f.bout = null;
    if (decision === 'tap') {
      this.result = 'tap';
      world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'tap', tap: 'tap' }));
    } else if (this.category === 'choke') {
      this.result = 'ko';
      world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'ko', tap: 'no_tap' }));
      world.healthEvent(this.defender, this.attacker, 'knockout', 'head');
    } else {
      this.result = 'injury';
      world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'injury', tap: 'no_tap' }));
    }
    return { ended: true, reason: this.result };
  }

  #escape() {
    this.result = 'escape';
    this.world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'escape' }));
    const pos = this.role === R.DOM ? escapePosition(this.position) : this.position;
    this.#restoreGround(pos, 'submission_escape');
  }

  #abort(reason) {
    this.result = 'abort';
    this.world.emit(EventType.SUBMISSION, this.base({ stage: this.stage, result: 'abort', reason }));
    this.#restoreGround(this.position, reason);
  }

  #restoreGround(position, reason) {
    this.finished = true; this.phase = 'done';
    const { world, ctx } = this;
    if (this.attacker.mods) this.attacker.mods.submission = 0;                      // a one-shot ability bonus is spent
    for (const f of this.fighters) { if (f.bout === this) f.bout = null; f.cooldowns.submission = world.tun.ground.transitionCooldownTicks; }
    const g = new GroundBout(world, ctx.top, ctx.bottom, position, { reason, silent: position === this.position });
    g.topPosture = ctx.topPosture;
  }

  /** Called by the sim when the bell rings or the fight is stopped: back to the ground without a result. */
  end(reason) {
    if (this.finished) return;
    if (this.stage >= 3 && reason === 'bell') this.world.stats.inc(this.defender.id, 'subs.saved_by_bell');
    this.#abort(reason ?? 'end');
  }

  timeKeys(f) { return [f === this.attacker ? 'time.submission.attacker' : 'time.submission.defender']; }

  hashNumbers() {
    return [4, this.stage, this.depth, this.damage, this.ticks, this.attacker.index, this.phase === 'tap' ? 1 : 0];
  }
}

