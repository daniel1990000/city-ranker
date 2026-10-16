// One fight from first bell to result: the deterministic simulation stepped at a fixed 60 Hz, the player's touch /
// keyboard input and the AI as controllers, the replay recorder, the 3D scene and the HUD. Pausing stops the clock;
// knockdowns slow the action (the simulation simply takes fewer ticks per second, so it stays deterministic).

import * as THREE from 'three';
import { AIController, createFight, drainEvents, ReplayRecorder, stepFight, viewFor, type Fight } from '../game/fight';
import type { Controller, FightEvent, FightInput, FightResult, FighterSpec, FightRules, Replay, Side } from '../game/fight/types';
import { METER_MAX, TICK_HZ } from '../game/fight/types';
import type { TouchContext } from '../game/touch/types';
import type { Quality } from '../render/arena/arena';
import type { VenueId } from '../render/arena/venues';
import { FightScene } from '../render/fightScene';
import type { FighterLook } from '../render/fighter/look';
import { FightHud } from '../ui/fight/hud';
import { TouchOverlay } from '../ui/fight/touchOverlay';

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
  /** No sound (the menu backdrop). */
  silent?: boolean;
}

export interface FightOutcome {
  result: FightResult;
  replay: Replay;
  /** Per-fighter totals over the fight (for the result screen). */
  totals: { landed: [number, number]; thrown: [number, number]; knockdowns: [number, number]; takedowns: [number, number] };
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

  private constructor(readonly setup: FightSessionSetup) {
    this.fight = createFight({ seed: setup.seed, a: setup.player, b: setup.opponent, rules: setup.rules });
    this.ai = new AIController({ difficulty: setup.difficulty, seed: setup.seed ^ 0x5151 });
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
    });
    s.hud = new FightHud(ui, [setup.player, setup.opponent]);
    s.overlay = new TouchOverlay(ui, () => s.onPause?.(), setup.showHints);
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
    return { mode, forward: 1, sprawl: !!s.takedown && s.takedown.atk !== 0, specialReady: me.special >= METER_MAX };
  }

  /** Advance real time `dt` seconds: step the simulation, then draw. */
  frame(dt: number): void {
    if (this.paused) {
      this.scene.frame(this.fight.state, 1, 0);
      return;
    }
    const scale = this.scene.timeScale * this.speed;
    this.acc += Math.min(0.1 * this.speed, dt * scale);
    const step = 1 / TICK_HZ;
    let events: FightEvent[] = [];
    while (this.acc >= step) {
      this.acc -= step;
      const ctx = this.context();
      let mine = this.overlay.tick(ctx);
      if (this.auto) mine = this.auto.next(viewFor(this.fight, 0), 0);
      const theirs = this.ai.next(viewFor(this.fight, 1), 1 as Side);
      const inputs: [FightInput, FightInput] = [mine, theirs];
      if (!this.ended) this.recorder.record(inputs);
      stepFight(this.fight, inputs);
      this.lastInput = mine;
      const ev = drainEvents(this.fight);
      if (ev.length) {
        events = events.concat(ev);
        this.scene.onEvents(ev, this.fight.state);
        this.hud.onEvents(ev, [this.setup.player, this.setup.opponent]);
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
    this.scene.frame(this.fight.state, this.acc / step, dt);
    if (events.length || this.onEvents) this.onEvents?.(events, this.scene.crowd);
    if (this.fight.state.result && !this.ended) {
      this.ended = true;
      this.endTimer = 0;
    }
    if (this.ended) {
      this.endTimer += dt;
      if (this.endTimer > 4.2 && this.onEnd) {
        const cb = this.onEnd;
        this.onEnd = null;
        cb(this.outcome());
      }
    }
  }

  outcome(): FightOutcome {
    const s = this.fight.state;
    const t = { landed: [0, 0] as [number, number], thrown: [0, 0] as [number, number], knockdowns: [0, 0] as [number, number], takedowns: [0, 0] as [number, number] };
    for (const r of s.stats) {
      for (const i of [0, 1] as const) {
        t.landed[i] += r[i].landed;
        t.thrown[i] += r[i].thrown;
        t.knockdowns[i] += r[i].knockdowns;
        t.takedowns[i] += r[i].takedowns;
      }
    }
    return { result: s.result as FightResult, replay: this.recorder.finish(), totals: t };
  }

  dispose(): void {
    this.scene.dispose();
    this.hud.dispose();
    this.overlay.dispose();
  }
}
