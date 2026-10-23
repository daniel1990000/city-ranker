// One fight from first bell to result: the deterministic simulation stepped at a fixed 60 Hz, the player's touch /
// keyboard input and the AI as controllers, the replay recorder, the 3D scene and the HUD. Pausing stops the clock;
// knockdowns slow the action (the simulation simply takes fewer ticks per second, so it stays deterministic).
// The TV-broadcast layer (src/ui/fight/broadcast*.ts) rides on top: walkout name plates during the intro, the corner
// screen in the round break, commentary captions, and the finish replay (a separate re-run of the last seconds from a
// snapshot and the recorded inputs, so the real fight, its result and the save are never touched). The plates and
// the corner screen may hold the clock at the very end of the intro / break: the simulation just takes no ticks
// while they are up, so it stays deterministic.

import * as THREE from 'three';
import { AIController, createFight, decodeInput, drainEvents, encodeInput, ReplayRecorder, restore, snapshot, stepFight, viewFor, type Fight } from '../game/fight';
import { endFight } from '../game/fight/core';
import type { Controller, FightEvent, FightInput, FightResult, FighterSpec, FightRules, FightState, Replay, RoundStats, Side } from '../game/fight/types';
import { METER_MAX, TICK_HZ } from '../game/fight/types';
import type { TouchContext } from '../game/touch/types';
import type { Quality } from '../render/arena/arena';
import type { VenueId } from '../render/arena/venues';
import { FightScene } from '../render/fightScene';
import type { FighterLook } from '../render/fighter/look';
import { callName, Commentary, cornerReport, plateInfo, REPLAY_AFTER, REPLAY_BEFORE, replayable, replaySpeed, type PlateInfo } from '../ui/fight/broadcast';
import { BroadcastHud, CORNER_SECONDS, PLATES_SECONDS } from '../ui/fight/broadcastHud';
import { FightHud } from '../ui/fight/hud';
import { TouchOverlay } from '../ui/fight/touchOverlay';
import { STEPS, Tutorial } from './tutorial';

export interface FightSessionSetup {
  seed: number;
  player: FighterSpec;
  opponent: FighterSpec;
  looks: [FighterLook, FighterLook];
  venue: VenueId;
  /** AI difficulty 0..1000. */
  difficulty: number;
  rules?: Partial<FightRules>;
  quality: Quality;
  showHints: boolean;
  /** Let the AI fight for the player too (attract mode, QA). */
  autoplay?: boolean;
  /** No sound (the menu backdrop). Also no broadcast layer. */
  silent?: boolean;
  /** The first fight's guided lesson. */
  tutorial?: boolean;
  /** Settings: attack on the left; less camera motion. */
  leftHanded?: boolean;
  reducedMotion?: boolean;
  /** Training Room: the dummy drives the opponent, and the room looks at every tick (app/practice.ts). */
  practice?: PracticeHooks;
  /** Settings > Commentary: the caption lines on key moments (default on). */
  commentary?: boolean;
  /** What the walkout plates show (default: from the specs and the roster; see plateInfo). */
  plates?: [PlateInfo, PlateInfo];
}

/** What a practice fight plugs in (app/practice.ts PracticeRoom). */
export interface PracticeHooks {
  readonly dummy: Controller;
  afterTick(f: Fight, events: readonly FightEvent[], inputs: readonly [FightInput, FightInput]): void;
}

export interface FightOutcome {
  result: FightResult;
  replay: Replay;
  /** Per-fighter totals over the fight (for the result screen). */
  /** `damage`: damage each fighter dealt (head + body + legs), so damage[1] is what the player took. */
  totals: { landed: [number, number]; thrown: [number, number]; knockdowns: [number, number]; takedowns: [number, number]; damage: [number, number] };
  /** Per-round stats [player, opponent], a copy (for missions and achievements). */
  rounds: [RoundStats, RoundStats][];
}

/** Snapshot spacing for the finish replay (ticks), and how many are kept (enough to start REPLAY_BEFORE back). */
const SNAP_EVERY = 30;
const SNAPS_KEPT = Math.ceil(REPLAY_BEFORE / SNAP_EVERY) + 2;
/** Real seconds into the round break before the corner screen comes up (the "End of round" banner first). */
const CORNER_DELAY = 1.2;
/** Events the replay passes on for sound (no bells, no result fanfare). */
const REPLAY_SOUND = new Set<FightEvent['type']>(['hit', 'miss', 'evade', 'knockdown', 'stun', 'hurt', 'takedown', 'tapOut', 'check', 'parry']);
/** "No input" as a replay code (move 0 is stored as 1 in bits 8-9). */
const IDLE_CODE = 0x100;

interface ReplayRun {
  fight: Fight;
  /** The tick the finish happened on, and when the replay stops. */
  endTick: number;
  stopTick: number;
  acc: number;
  done: () => void;
}

export class FightSession {
  readonly fight: Fight;
  private scene!: FightScene;
  private hud!: FightHud;
  private overlay!: TouchOverlay;
  private ai: Controller;
  private auto: Controller | null;
  private recorder: ReplayRecorder;
  private acc = 0;
  private paused = false;
  private ended = false;
  private endTimer = 0;
  private hintsShown: boolean;
  private lastInput: FightInput | null = null;
  /** QA only: run the simulation faster than real time (software-rendered test browsers draw a few frames a second). */
  speed = 1;
  /** Events this frame (for audio). */
  onEvents: ((e: FightEvent[], crowd: number) => void) | null = null;
  onEnd: ((o: FightOutcome) => void) | null = null;
  onPause: (() => void) | null = null;
  /** The lesson finished or was skipped. */
  /** The lesson ended: `skipped` when the player pressed Skip, `step` how far they got. */
  onTutorialDone: ((skipped: boolean, step: number) => void) | null = null;
  private tutorial: Tutorial | null = null;

  // ---- the broadcast layer (null for the menu backdrop)
  private bc: BroadcastHud | null = null;
  private commentary: Commentary | null = null;
  private platesT = 0;
  private breakT = 0;
  private cornerT = 0;
  /** The last round whose corner screen has been shown. */
  private cornerRound = 0;
  private coachOn = false;
  private pendingCoach: (() => void) | null = null;
  private offered = false;
  /** Snapshots (every SNAP_EVERY ticks) and the input codes since the oldest one, for the finish replay. */
  private snaps: { tick: number; state: FightState }[] = [];
  private codes: [number[], number[]] = [[], []];
  private codesBase = 0;
  private replay: ReplayRun | null = null;

  private constructor(readonly setup: FightSessionSetup) {
    this.fight = createFight({ seed: setup.seed, a: setup.player, b: setup.opponent, rules: setup.rules });
    this.ai = setup.practice ? setup.practice.dummy : new AIController({ difficulty: setup.difficulty, seed: setup.seed ^ 0x5151 });
    this.auto = setup.autoplay ? new AIController({ difficulty: 650, seed: setup.seed ^ 0x777 }) : null;
    this.recorder = new ReplayRecorder(this.fight);
    this.hintsShown = setup.showHints;
  }

  static async start(setup: FightSessionSetup, ui: HTMLElement): Promise<FightSession> {
    const s = new FightSession(setup);
    s.scene = await FightScene.create({
      venue: setup.venue,
      looks: setup.looks,
      names: [setup.player.name, setup.opponent.name],
      quality: setup.quality,
      reducedMotion: setup.reducedMotion,
    });
    s.hud = new FightHud(ui, [setup.player, setup.opponent]);
    // practice has no clock (practice.css hides it)
    if (setup.practice) s.hud.root.classList.add('practice');
    s.overlay = new TouchOverlay(ui, () => s.onPause?.(), setup.showHints && !setup.tutorial, setup.leftHanded);
    if (!setup.silent) {
      s.bc = new BroadcastHud(ui, !!setup.reducedMotion);
      s.commentary = new Commentary([setup.player, setup.opponent]);
      if (s.fight.state.phase === 'intro') s.bc.showPlates(setup.plates ?? [plateInfo(setup.player), plateInfo(setup.opponent)], () => s.endPlates());
    }
    if (setup.tutorial) {
      const t = new Tutorial(setup.seed ^ 0x7777);
      s.tutorial = t;
      s.ai = t;
      // left-handed players have attack and defence on the other halves
      const sides = (st: (typeof STEPS)[number] | null) =>
        st && setup.leftHanded ? { ...st, text: st.text.replace(/\b(left|right) side\b/g, (_m, w: string) => `${w === 'left' ? 'right' : 'left'} side`) } : st;
      t.onStep = (step, i) => {
        s.coachOn = !!step;
        if (step) s.bc?.hideCaption();
        s.hud.coach(sides(step), i, STEPS.length, () => t.skip());
        if (!step) s.onTutorialDone?.(t.skipped, i);
      };
      s.coachOn = true;
      // the lesson card waits for the walkout plates (both sit at the bottom of the screen)
      const first = () => s.hud.coach(sides(STEPS[0]), 0, STEPS.length, () => t.skip());
      if (s.bc?.platesOn) s.pendingCoach = first;
      else first();
    }
    return s;
  }

  get threeScene(): THREE.Scene {
    return this.scene.scene;
  }
  get camera(): THREE.PerspectiveCamera {
    return this.scene.camera;
  }

  resize(w: number, h: number): void {
    this.scene.resize(w, h);
    this.overlay.relayout();
  }

  /** QA: let the AI play the player's side. */
  setAutoplay(on: boolean): void {
    this.auto = on ? new AIController({ difficulty: 900, seed: this.setup.seed ^ 0x777 }) : null;
  }

  /** Live play worth measuring for auto quality (not paused, not finished, normal speed). */
  get live(): boolean {
    return !this.paused && !this.ended && this.speed === 1;
  }

  /** The player retires from the fight (pause menu): a loss by TKO, then the normal result flow. */
  forfeit(): void {
    if (this.fight.state.result) return;
    endFight(this.fight, 1, 'TKO', { stoppage: 'forfeit' });
    this.paused = false;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (p) this.overlay.recognizer.cancelAll(performance.now());
  }

  private context(): TouchContext {
    const s = this.fight.state;
    const me = s.fighters[0];
    let mode: TouchContext['mode'] = 'stand';
    if (s.phase !== 'fight') mode = 'locked';
    else if (s.ground?.sub) mode = 'sub';
    else if (s.ground) mode = 'ground';
    else if (me.action === 'knockdown') mode = 'locked';
    // sprawl as soon as their shot starts coming (the simulation counts an early sprawl), not only at contact
    const theirShot = s.fighters[1].action === 'shoot' && !s.takedown;
    return { mode, forward: 1, sprawl: (!!s.takedown && s.takedown.atk !== 0) || theirShot, specialReady: me.special >= METER_MAX };
  }

  // ---- broadcast: plates, corner screen, captions -------------------------------------------------------------

  private endPlates(): void {
    this.bc?.hidePlates();
    const c = this.pendingCoach;
    this.pendingCoach = null;
    c?.();
  }

  /** The clock waits at the last tick of the intro while the plates are up, and of the break until the corner is done. */
  private holding(): boolean {
    const s = this.fight.state;
    if (!this.bc) return false;
    if (s.phase === 'intro') return this.bc.platesOn && s.phaseTick + 1 >= this.fight.rules.introTicks;
    if (s.phase === 'break') return (this.bc.cornerOn || this.cornerRound < s.round) && s.phaseTick + 1 >= this.fight.rules.breakTicks;
    return false;
  }

  /** Broadcast timers (real seconds, sped up with the QA speed). */
  private broadcastFrame(dt: number): void {
    const bc = this.bc;
    if (!bc) return;
    const t = dt * this.speed;
    bc.tick(t);
    const s = this.fight.state;
    if (bc.platesOn) {
      this.platesT += t;
      if (this.platesT >= PLATES_SECONDS || s.phase !== 'intro') this.endPlates();
    }
    if (s.phase === 'break') {
      this.breakT += t;
      if (this.cornerRound < s.round && this.breakT >= CORNER_DELAY) {
        this.cornerRound = s.round;
        this.cornerT = 0;
        bc.hideCaption();
        const names: [string, string] = [callName(this.setup.player), callName(this.setup.opponent)];
        bc.showCorner(cornerReport(s, 0, this.setup.opponent, !!this.setup.leftHanded), names, 0, () => bc.hideCorner());
      }
      if (bc.cornerOn) {
        this.cornerT += t;
        bc.cornerProgress(1 - this.cornerT / CORNER_SECONDS);
        if (this.cornerT >= CORNER_SECONDS) bc.hideCorner();
      }
    } else {
      this.breakT = 0;
      if (bc.cornerOn) bc.hideCorner();
    }
  }

  // ---- the finish replay ----------------------------------------------------------------------------------------

  /** Keep what the finish replay needs: a snapshot every SNAP_EVERY ticks and every input since the oldest one. */
  private keepForReplay(inputs: [FightInput, FightInput]): void {
    const s = this.fight.state;
    if (s.tick % SNAP_EVERY === 0 || this.snaps.length === 0) {
      this.snaps.push({ tick: s.tick, state: snapshot(this.fight) });
      if (this.snaps.length > SNAPS_KEPT) {
        this.snaps.shift();
        const drop = this.snaps[0].tick - this.codesBase;
        if (drop > 0) {
          this.codes[0].splice(0, drop);
          this.codes[1].splice(0, drop);
          this.codesBase += drop;
        }
      }
    }
    if (this.codes[0].length === 0) this.codesBase = s.tick;
    // codes[k][i] is the input applied to the state at tick codesBase + i
    const i = s.tick - this.codesBase;
    this.codes[0][i] = encodeInput(inputs[0]);
    this.codes[1][i] = encodeInput(inputs[1]);
  }

  /** A KO, TKO or submission that can be replayed (the result is in and the seconds before it were kept). */
  get replayAvailable(): boolean {
    return !this.replay && replayable(this.fight.state.result) && this.snaps.length > 0;
  }

  /** The finish replay is playing. */
  get replaying(): boolean {
    return this.replay !== null;
  }

  /**
   * Re-run the last seconds before the finish in slow motion with the cinematic camera. It runs on its own copy of
   * the fight (restored from a snapshot, fed the recorded inputs), so the real fight and its result never change.
   * Resolves when it ends or is skipped. Hides the HUD, the controls and the result card while it plays.
   */
  playReplay(): Promise<void> {
    const r = this.fight.state.result;
    if (!this.replayAvailable || !r) return Promise.resolve();
    const endTick = r.totalTicks;
    const start = endTick - REPLAY_BEFORE;
    let snap = this.snaps[0];
    for (const sn of this.snaps) if (sn.tick <= start) snap = sn;
    const f = createFight({ seed: this.setup.seed, a: this.setup.player, b: this.setup.opponent, rules: this.fight.rules });
    restore(f, snap.state);
    while (f.state.tick < start) this.replayStep(f);
    drainEvents(f);
    this.bc?.hideOffer();
    return new Promise(done => {
      this.replay = { fight: f, endTick, stopTick: endTick + REPLAY_AFTER, acc: 0, done };
      this.scene.startReplay();
      this.bc?.showReplay(() => this.stopReplay());
    });
  }

  private replayStep(f: Fight): void {
    const i = f.state.tick - this.codesBase;
    // past the recording (after the finish): no input; the fight's aftermath needs none
    const a = this.codes[0][i] ?? IDLE_CODE;
    const b = this.codes[1][i] ?? IDLE_CODE;
    stepFight(f, [decodeInput(a), decodeInput(b)]);
  }

  /** End (or skip) the replay and cut back to the live, finished fight. */
  stopReplay(): void {
    const rp = this.replay;
    if (!rp) return;
    this.replay = null;
    this.scene.endReplay();
    this.bc?.hideReplay();
    rp.done();
  }

  private replayFrame(dt: number): void {
    const rp = this.replay;
    if (!rp) return;
    const step = 1 / TICK_HZ;
    const f = rp.fight;
    const sound: FightEvent[] = [];
    if (!this.paused) {
      rp.acc += Math.min(0.1 * this.speed, dt * replaySpeed(f.state.tick, rp.endTick) * this.speed);
      while (rp.acc >= step) {
        rp.acc -= step;
        this.replayStep(f);
        const ev = drainEvents(f);
        if (ev.length) {
          this.scene.onEvents(ev, f.state);
          for (const e of ev) if (REPLAY_SOUND.has(e.type)) sound.push(e);
        }
        if (f.state.tick >= rp.stopTick) {
          this.stopReplay();
          this.scene.frame(this.fight.state, 1, dt);
          return;
        }
      }
    }
    this.scene.frame(f.state, this.paused ? 1 : rp.acc / step, this.paused ? 0 : dt);
    if (sound.length) this.onEvents?.(sound, this.scene.crowd);
  }

  /**
   * "Watch replay" was tapped: the result goes through first (rewards and save happen now, exactly as without the
   * replay), then the replay plays over the hidden result card, which comes back when it ends.
   */
  private watchReplay(): void {
    const replay = this.playReplay();
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.(this.outcome());
    void replay;
  }

  // ---- the frame loop -------------------------------------------------------------------------------------------

  /** Advance real time `dt` seconds: step the simulation, then draw. */
  frame(dt: number): void {
    if (this.replay) {
      this.bc?.tick(dt);
      this.replayFrame(dt);
      return;
    }
    if (this.paused) {
      this.scene.frame(this.fight.state, 1, 0);
      return;
    }
    const scale = this.scene.timeScale * this.speed;
    this.acc += Math.min(0.1 * this.speed, dt * scale);
    const step = 1 / TICK_HZ;
    let events: FightEvent[] = [];
    while (this.acc >= step) {
      if (this.holding()) {
        this.acc = 0;
        break;
      }
      this.acc -= step;
      const ctx = this.context();
      let mine = this.overlay.tick(ctx);
      if (this.auto) mine = this.auto.next(viewFor(this.fight, 0), 0);
      if (this.tutorial && this.fight.state.phase === 'fight') this.tutorial.observe(mine);
      if (mine.tap && this.fight.state.ground?.sub) this.hud.tapPulse();
      const theirs = this.ai.next(viewFor(this.fight, 1), 1 as Side);
      const inputs: [FightInput, FightInput] = [mine, theirs];
      if (!this.ended) {
        this.recorder.record(inputs);
        if (this.bc) this.keepForReplay(inputs);
      }
      stepFight(this.fight, inputs);
      this.lastInput = mine;
      const ev = drainEvents(this.fight);
      this.setup.practice?.afterTick(this.fight, ev, inputs);
      if (ev.length) {
        events = events.concat(ev);
        this.scene.onEvents(ev, this.fight.state);
        this.hud.onEvents(ev, [this.setup.player, this.setup.opponent]);
        const line = this.commentary?.feed(ev, this.fight.state);
        if (line && this.setup.commentary !== false && !this.coachOn && !this.bc?.cornerOn && !this.bc?.platesOn) this.bc?.say(line);
      }
      if (this.hintsShown && this.fight.state.phase === 'fight' && this.fight.state.round === 1 && this.fight.state.clock < this.fight.rules.roundTicks - 60 * 8) {
        this.overlay.hideHints();
        this.hintsShown = false;
      }
    }
    if (this.lastInput && this.hintsShown && (this.lastInput.strike || this.lastInput.block)) {
      this.overlay.hideHints();
      this.hintsShown = false;
    }
    this.hud.update(this.fight.state, this.fight.rules.rounds);
    this.broadcastFrame(dt);
    this.scene.frame(this.fight.state, this.acc / step, dt);
    if (events.length || this.onEvents) this.onEvents?.(events, this.scene.crowd);
    if (this.fight.state.result && !this.ended) {
      this.ended = true;
      this.endTimer = 0;
    }
    if (this.ended) {
      this.endTimer += dt;
      // a finish: offer the replay under the result banner (and wait a little longer for the answer)
      if (!this.offered && this.endTimer > 1 && this.onEnd && this.bc && this.replayAvailable) {
        this.offered = true;
        this.bc.offerReplay(() => this.watchReplay());
      }
      if (this.endTimer > (this.offered ? 6 : 4.2) && this.onEnd) {
        this.bc?.hideOffer();
        const cb = this.onEnd;
        this.onEnd = null;
        cb(this.outcome());
      }
    }
  }

  outcome(): FightOutcome {
    const s = this.fight.state;
    const t = { landed: [0, 0] as [number, number], thrown: [0, 0] as [number, number], knockdowns: [0, 0] as [number, number], takedowns: [0, 0] as [number, number], damage: [0, 0] as [number, number] };
    for (const r of s.stats) {
      for (const i of [0, 1] as const) {
        t.landed[i] += r[i].landed;
        t.thrown[i] += r[i].thrown;
        t.knockdowns[i] += r[i].knockdowns;
        t.takedowns[i] += r[i].takedowns;
        t.damage[i] += r[i].headDmg + r[i].bodyDmg + r[i].legDmg;
      }
    }
    const rounds = s.stats.map(([a, b]): [RoundStats, RoundStats] => [{ ...a }, { ...b }]);
    return { result: s.result as FightResult, replay: this.recorder.finish(), totals: t, rounds };
  }

  dispose(): void {
    if (this.replay) this.stopReplay();
    this.bc?.dispose();
    this.scene.dispose();
    this.hud.dispose();
    this.overlay.dispose();
  }
}
