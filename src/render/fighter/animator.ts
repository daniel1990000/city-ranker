// Turns the simulation's action (id + progress) into a pose every frame: picks the clip (with its variant for what
// the fighter was doing and where it is on the ground), maps simulation ticks to clip time (attack clips land their
// impact on the simulation's first active tick), scales hit reactions by the hit, and crossfades between actions.
// Rendering only; the simulation never waits for an animation.

import type { ActionId } from '../../game/fight/types';
import { pickClip, roleAfter, sampleClip, type Clip, type GroundRole } from './clips';
import { clonePose, mixPose, STANCE } from './poses';
import type { Pose } from './rig';

export class FighterAnimator {
  private action: ActionId | null = null;
  private prev: ActionId | null = null;
  private role: GroundRole = null;
  private clip: Clip | null = null;
  private lastTick = 0;
  private since = 0;
  private from: Pose = clonePose(STANCE);
  private blend = 1;
  private blendTime = 0.1;
  private out: Pose = clonePose(STANCE);
  private target: Pose = clonePose(STANCE);
  /** Seconds of wall time for loops, so idle bounce and breathing differ between the two fighters. */
  private phase: number;

  constructor(phase = 0) {
    this.phase = phase;
  }

  /**
   * Advance by `dt` seconds. `tick` may be fractional (interpolated between simulation ticks).
   * Returns the pose to apply (owned by the animator: copy it if you keep it).
   */
  update(action: ActionId, tick: number, length: number, impact: number, dt: number): Pose {
    if (action !== this.action || tick + 0.5 < this.lastTick || !this.clip) {
      // a new action (or the same one restarted): fade from wherever we are (into the animator's own buffer)
      mixPose(this.out, this.out, 0, this.from);
      if (action !== this.action) this.prev = this.action;
      this.role = roleAfter(action, this.role);
      this.clip = pickClip(action, this.prev, this.role);
      this.blend = 0;
      this.blendTime = Math.max(0.0001, this.clip.blendIn);
      this.action = action;
      this.since = 0;
    }
    const clip = this.clip;
    this.lastTick = tick;
    this.since += dt;
    let u: number;
    if (clip.loop > 0) u = (this.since + this.phase) / clip.loop;
    else if (length > 0) {
      const ip = clip.impact;
      if (ip !== undefined && impact > 0 && impact < length) {
        u = tick <= impact ? (ip * tick) / impact : ip + ((1 - ip) * (tick - impact)) / (length - impact);
      } else u = tick / length;
    } else u = Math.min(1, this.since / 0.6);
    sampleClip(clip, u, this.target, mixPose);
    // hit reactions: a bigger hit (a longer stun) swings further from the first key, a light one less
    if (clip.react && length > 0) {
      const s = Math.min(1.4, Math.max(0.6, length / clip.react));
      if (s !== 1) mixPose(clip.keys[0][1], this.target, s, this.target);
    }
    this.blend = Math.min(1, this.blend + dt / this.blendTime);
    const w = this.blend * this.blend * (3 - 2 * this.blend);
    mixPose(this.from, this.target, w, this.out);
    return this.out;
  }
}
