// The fight on screen: arena + two realistic fighters driven by the simulation state, hit effects, the broadcast
// camera and crowd excitement. Rendering only: it reads FightState and FightEvents, it never changes the fight.

import * as THREE from 'three';
import type { FightEvent, FightState, Side } from '../game/fight/types';
import { MOVES } from '../game/fight/moves';
import { applyVenueAtmosphere, createArena, type Arena, type Quality } from './arena/arena';
import { simToWorldX } from './arena/layout';
import type { VenueId } from './arena/venues';
import { CameraDirector } from './camera';
import { FighterAnimator } from './fighter/animator';
import { createFighterView, type FighterView } from './fighter/fighterView';
import type { FighterLook } from './fighter/look';
import { HitFx } from './fx';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export interface FightSceneSetup {
  venue: VenueId;
  looks: [FighterLook, FighterLook];
  names: [string, string];
  quality: Quality;
}

export class FightScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 220);
  readonly director = new CameraDirector(this.camera);
  /** Rendering time scale: the app slows the simulation down while this is below 1 (knockdowns). */
  timeScale = 1;
  private arena: Arena;
  private fighters: [FighterView, FighterView];
  private anims: [FighterAnimator, FighterAnimator];
  private fx = new HitFx();
  private prevX: [number, number] = [0, 0];
  private excitement = 0.25;
  private slowUntil = 0;
  private clock = 0;
  private lastTick = -1;

  private constructor(arena: Arena, fighters: [FighterView, FighterView]) {
    this.arena = arena;
    this.fighters = fighters;
    this.anims = [new FighterAnimator(0), new FighterAnimator(0.37)];
    this.scene.add(arena.group, this.fx.points, fighters[0].root, fighters[1].root);
    applyVenueAtmosphere(this.scene, arena.venue);
  }

  static async create(setup: FightSceneSetup): Promise<FightScene> {
    const arena = createArena(setup.venue, setup.quality);
    arena.setNames(setup.names[0], setup.names[1]);
    const fighters = (await Promise.all(setup.looks.map(l => createFighterView(l)))) as [FighterView, FighterView];
    return new FightScene(arena, fighters);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** World position of a fighter's bone (character-space FK result, through the fighter's transform). */
  bonePos(side: Side, bone: string, out: THREE.Vector3): THREE.Vector3 {
    const f = this.fighters[side];
    const b = f.rig.get(bone);
    if (!b) return out.copy(f.root.position).setY(1.2);
    out.copy(b.wp);
    return f.root.localToWorld(out);
  }

  /** React to what happened this tick. */
  onEvents(events: FightEvent[], state: FightState): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const target: Side = e.side === 0 ? 1 : 0;
          const bone = e.zone === 'head' ? 'head' : e.zone === 'body' ? 'spine_02' : 'calf_l';
          this.bonePos(target, bone, _v);
          const dir = _w.set(state.fighters[e.side].facing, 0.25, 0).normalize();
          const strength = e.strength === 'heavy' ? 1 : e.strength === 'medium' ? 0.55 : 0.25;
          if (!e.blocked) {
            this.fx.burst(_v, dir, strength, 'sweat');
            if (e.strength !== 'light' || e.counter) this.fx.burst(_v, dir, strength, 'flash');
            this.director.shake(strength * (e.counter ? 1.3 : 1));
            if (e.strength === 'heavy') this.director.punchIn(0.6);
            this.excitement = Math.min(1, this.excitement + strength * 0.25);
          } else {
            this.fx.burst(_v, dir, 0.15, 'sweat');
            this.director.shake(0.1);
          }
          break;
        }
        case 'knockdown':
          this.director.punchIn(1);
          this.director.shake(1);
          this.excitement = 1;
          this.slowUntil = this.clock + 0.9;
          break;
        case 'takedown':
          this.director.shake(0.5);
          this.excitement = Math.min(1, this.excitement + 0.35);
          break;
        case 'fightEnd':
          this.excitement = 1;
          if (e.result.method === 'KO' || e.result.method === 'TKO') this.slowUntil = this.clock + 1.4;
          break;
        case 'tapOut':
          this.excitement = 1;
          break;
        case 'stun':
          this.excitement = Math.min(1, this.excitement + 0.3);
          break;
        default:
          break;
      }
    }
  }

  /**
   * Draw the state. `alpha` (0..1) interpolates positions between the previous tick and this one; `dt` is real time.
   */
  frame(state: FightState, alpha: number, dt: number): void {
    this.clock += dt;
    this.timeScale = this.clock < this.slowUntil ? 0.3 : 1;
    if (state.tick !== this.lastTick) {
      this.lastTick = state.tick;
    }
    const g = state.ground;
    // the simulation lets centres come 0.56 m apart; bodies with a guard up need a little more room on screen
    const x0 = simToWorldX(state.fighters[0].x);
    const x1 = simToWorldX(state.fighters[1].x);
    const spread = g ? 0 : Math.max(0, 0.8 - (x1 - x0)) / 2;
    for (const i of [0, 1] as const) {
      const fs = state.fighters[i];
      const view = this.fighters[i];
      const xNow = simToWorldX(fs.x) + (i === 0 ? -spread : spread);
      const x = this.prevX[i] + (xNow - this.prevX[i]) * Math.min(1, alpha + 0.0001);
      this.prevX[i] = x;
      // reach assist: around the impact, close the visual gap so shots land on the body, not in the air
      let assist = 0;
      if (fs.move && !g) {
        const d = MOVES[fs.move];
        const other = state.fighters[i === 0 ? 1 : 0];
        const gap = Math.abs(simToWorldX(other.x) - xNow);
        const visual = d.kind === 'kick' || d.kind === 'lowKick' ? 1.0 : d.kind === 'upper' ? 0.62 : d.kind === 'hook' ? 0.66 : 0.78;
        const t = fs.actionTick - fs.actionImpact;
        const w = Math.max(0, 1 - Math.abs(t) / 9);
        if (fs.moveResult !== 4) assist = Math.max(0, Math.min(0.42, gap - visual)) * w;
      }
      view.root.position.set(x + fs.facing * assist, 0, 0);
      view.root.rotation.y = fs.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
      const tick = fs.actionTick + alpha;
      const pose = this.anims[i].update(fs.action, tick, fs.actionLength, fs.actionImpact, dt);
      // look at the other fighter's head (character space of this fighter)
      const otherSide: Side = i === 0 ? 1 : 0;
      this.bonePos(otherSide, 'head', _v);
      view.root.worldToLocal(_v);
      const lookW = g || fs.action === 'downed' || fs.action === 'knockdown' || fs.action === 'victory' ? 0 : 0.55;
      view.pose(pose, _v, lookW);
      view.setDamage(Math.min(1, fs.head / 5000), Math.min(1, fs.body / 7000), Math.min(1, fs.legs / 7000));
      const work = 1 - fs.stamina / Math.max(1, fs.staminaCap);
      view.setSweat(Math.min(1, state.tick / 9000 + work * 0.5 + 0.15));
    }
    // camera
    this.director.mode = state.phase === 'intro' ? 'intro' : state.phase === 'ended' ? 'result' : g ? 'ground' : 'fight';
    const a = this.fighters[0].root.position.clone().setY(1);
    const b = this.fighters[1].root.position.clone().setY(1);
    this.director.update(a, b, dt);
    // the key light follows the action a little
    const mid = (a.x + b.x) / 2;
    this.arena.key.target.position.set(mid * 0.5, 0, 0);
    this.excitement = Math.max(0.22, this.excitement - dt * 0.06);
    this.arena.setExcitement(this.excitement);
    this.arena.update(dt, this.camera);
    this.fx.update(dt);
  }

  /** Current crowd excitement (the audio follows it). */
  get crowd(): number {
    return this.excitement;
  }

  dispose(): void {
    this.arena.dispose();
    for (const f of this.fighters) f.dispose();
    this.fx.dispose();
  }
}
