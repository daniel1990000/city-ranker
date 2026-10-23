// Every fighter animation, one clip per simulation ActionId (docs/ARCHITECTURE.md), plus context variants the
// animator picks from what the fighter was doing (a pound from guard or from mount, an armbar from the bottom or from
// mount, a stand-up from the top or the bottom). A clip is a few key poses on a 0..1 timeline; attack clips carry
// `impact` (the time the strike lands), which the animator lines up with the simulation's first active tick.
// Poses are authored in character space for the 1.747 m base male: x = the fighter's left, y = up, z = toward the
// opponent (the rig scales them to each body, and measures low hips from the mat). Ground clips are paired: both
// fighters stand on one anchor and face each other, so a point p in one fighter's space is (-x, y, -z) in the other's.

import type { ActionId } from '../../game/fight/types';
import { RELAXED, STANCE, edit } from './poses';
import type { LimbTarget, Pose, Rot, V3 } from './rig';

/** How a key is reached from the previous one: s = ease in-out, i = accelerating (falls, strikes), o = decelerating, l = linear. */
export type Ease = 's' | 'i' | 'o' | 'l';
export type Key = readonly [number, Pose] | readonly [number, Pose, Ease];

export interface Clip {
  keys: readonly Key[];
  /** Loops on wall-clock time with this period (s); 0 = driven by the simulation's action progress. */
  loop: number;
  /** 0..1: when the strike lands. */
  impact?: number;
  /** Crossfade into this clip (s). */
  blendIn: number;
  /**
   * Hit reactions: the swing away from the first key scales with the hit, read from the action's length (the
   * simulation's hit stun): length / react, clamped to 0.6..1.4.
   */
  react?: number;
}

const L = (p: V3, pole: V3): LimbTarget => ({ p, pole });
const S = STANCE;
const GUARD_L = S.handL;
const GUARD_R = S.handR;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rot = (r: Rot, d: Rot): Rot => [r[0] + d[0], r[1] + d[1], r[2] + d[2]];
const ELBOW_L: V3 = [0.6, -1, -0.15];
const ELBOW_R: V3 = [-0.6, -1, -0.15];
const ELBOW_IN_L: V3 = [0.5, -1, -0.1];

/** A key pose built as an edit of the stance. */
const st = (c: Partial<Pose>): Pose => edit(S, c);

const once = (keys: Key[], impact?: number, blendIn = 0.07): Clip => ({ keys, loop: 0, impact, blendIn });
const loop = (period: number, keys: Key[], blendIn = 0.15): Clip => ({ keys, loop: period, blendIn });
/** A looping clip sampled from a function of the phase (0..1), linear between samples. */
function cycle(period: number, n: number, f: (ph: number) => Pose, blendIn = 0.15): Clip {
  const keys: Key[] = [];
  for (let i = 0; i <= n; i++) keys.push([i / n, f(i / n), 'l']);
  return { keys, loop: period, blendIn };
}
const smooth = (x: number) => x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

// ---- standing: stance idle and footwork ------------------------------------------------------------------------

// on the balls of the feet: two small bounces a second, the weight rocking between the feet, gloves lagging the body
const idle = cycle(1.0, 16, ph => {
  const up = 0.5 - 0.5 * Math.cos(TAU * 2 * ph);
  const lag = 0.5 - 0.5 * Math.cos(TAU * 2 * ph - 0.9);
  const sway = Math.sin(TAU * ph);
  return st({
    hip: add(S.hip, [0.012 * sway, 0.016 * up, 0.006 * sway]),
    hipRot: rot(S.hipRot, [0, 2 * sway, -1.5 * sway]),
    chest: rot(S.chest, [-1.2 * up, -1.5 * sway, 1.5 * sway]),
    head: rot(S.head, [1.5 * up, 0, -1 * sway]),
    handL: L(add(GUARD_L.p, [0.008 * sway, 0.014 * lag, 0.012 * Math.sin(TAU * ph + 1)]), GUARD_L.pole),
    handR: L(add(GUARD_R.p, [0.006 * sway, 0.012 * lag, 0.008 * Math.sin(TAU * ph + 2)]), GUARD_R.pole),
    toeL: [8 * up, -12],
    toeR: [S.toeR[0] + 14 * up, 38],
    shrugL: S.shrugL + 2 * lag,
    shrugR: S.shrugR + 2 * lag,
  });
});

/**
 * Step-drag footwork without sliding: the root moves at the simulation's walking speed (about 1.6 m/s, base-male
 * units), so a planted foot moves backward in character space at exactly that speed, and the stepping foot swings
 * forward faster. `dir` 1 = forward (lead foot steps first), -1 = back (rear foot steps first).
 */
const WALK_PERIOD = 0.36;
const WALK_SPEED = 1.6;
const DUTY = 0.55;
const STRIDE = (WALK_SPEED * WALK_PERIOD * DUTY) / 2;
function footAt(ph: number, dir: number): { z: number; lift: number } {
  const p = ph - Math.floor(ph);
  const swing = 1 - DUTY;
  if (p < swing) {
    const s = p / swing;
    return { z: dir * STRIDE * (2 * smooth(s) - 1), lift: Math.sin(Math.PI * s) };
  }
  const s = (p - swing) / DUTY;
  return { z: dir * STRIDE * (1 - 2 * s), lift: 0 };
}
function walkPose(ph: number, dir: number): Pose {
  // forward: the lead foot steps at 0, the rear foot drags at 0.5; back: the rear foot leads
  const lead = footAt(dir > 0 ? ph : ph + 0.5, dir);
  const rear = footAt(dir > 0 ? ph + 0.5 : ph, dir);
  const bob = 0.5 - 0.5 * Math.cos(TAU * 2 * ph);
  return st({
    hip: add(S.hip, [0, 0.008 - 0.012 * bob, 0.02 * dir]),
    hipRot: rot(S.hipRot, [dir * 2, 3 * Math.sin(TAU * ph) * dir, 0]),
    chest: rot(S.chest, [dir * 2 + bob, -2 * Math.sin(TAU * ph) * dir, 0]),
    footL: L(add(S.footL.p, [0, 0.04 * lead.lift, lead.z]), S.footL.pole),
    footR: L(add(S.footR.p, [0, 0.04 * rear.lift, rear.z]), S.footR.pole),
    toeL: [-10 * lead.lift, -12],
    toeR: [S.toeR[0] + 10 * rear.lift, 38],
    handL: L(add(GUARD_L.p, [0, 0.01 * bob, 0]), GUARD_L.pole),
    handR: L(add(GUARD_R.p, [0, 0.01 * bob, 0]), GUARD_R.pole),
  });
}
const walkFwd = cycle(WALK_PERIOD, 16, ph => walkPose(ph, 1), 0.1);
const walkBack = cycle(WALK_PERIOD * 1.08, 16, ph => walkPose(ph, -1), 0.1);

// ---- standing: strikes ------------------------------------------------------------------------------------------
// Each one: a small load (weight and hips the other way), the shot accelerating into the impact, a short
// follow-through past it, and a decelerating return to the stance.

// jab: the lead foot steps in, the lead shoulder rolls up to cover the chin, the head slides off the centre line
const jabLoad = st({ hip: add(S.hip, [0, -0.01, -0.01]), hipRot: rot(S.hipRot, [0, 3, 0]), chest: rot(S.chest, [2, 4, 0]) });
const jabOut = st({
  hip: add(S.hip, [-0.01, -0.012, 0.06]),
  hipRot: rot(S.hipRot, [3, -8, 0]),
  chest: rot(S.chest, [5, -14, -4]),
  head: rot(S.head, [4, 12, -4]),
  handL: L([0.04, 1.43, 0.7], [0.4, -0.4, 0]),
  handR: L([-0.05, 1.38, 0.2], ELBOW_R),
  footL: L(add(S.footL.p, [0, 0, 0.06]), S.footL.pole),
  wristL: -5,
  shrugL: 18,
});
const jabBack = edit(jabOut, { handL: L([0.1, 1.4, 0.45], ELBOW_L), wristL: 10, shrugL: 10 });
const jab = once([[0, S], [0.2, jabLoad], [0.42, jabOut, 'i'], [0.55, jabOut], [0.75, jabBack, 'o'], [1, S]], 0.42);

// cross: the rear heel turns out and the hips and shoulders drive square, the weight goes onto the lead leg with the
// head over the lead knee, the lead glove stays home on the chin
const crossLoad = st({ hip: add(S.hip, [0, -0.015, -0.02]), hipRot: rot(S.hipRot, [0, -6, 0]), chest: rot(S.chest, [2, -4, 0]), handR: L([-0.05, 1.36, 0.16], ELBOW_R) });
const crossOut = st({
  hip: add(S.hip, [0.03, -0.02, 0.09]),
  hipRot: rot(S.hipRot, [5, 38, 0]),
  chest: rot(S.chest, [8, 14, 6]),
  head: rot(S.head, [6, -28, 4]),
  handR: L([0.02, 1.43, 0.76], [-0.4, -0.4, 0]),
  handL: L([0.08, 1.42, 0.24], ELBOW_IN_L),
  wristR: -5,
  toeR: [36, 4],
  footR: L(add(S.footR.p, [0.02, 0.03, 0.06]), [-0.3, 0, 1]),
  shrugR: 18,
});
const crossFollow = edit(crossOut, { hipRot: rot(crossOut.hipRot, [0, 4, 0]), chest: rot(crossOut.chest, [0, 4, 0]), handR: L([0.0, 1.42, 0.72], [-0.4, -0.4, 0]) });
const crossBack = edit(crossOut, { hipRot: rot(S.hipRot, [2, 14, 0]), chest: rot(S.chest, [4, 6, 2]), hip: add(S.hip, [0.01, -0.01, 0.04]), handR: L([-0.06, 1.4, 0.36], ELBOW_R), toeR: [20, 24] });
const cross = once([[0, S], [0.22, crossLoad], [0.45, crossOut, 'i'], [0.56, crossFollow, 'o'], [0.78, crossBack], [1, S]], 0.45);

// lead hook: weight to the lead leg, the elbow comes up level with the fist, the lead foot pivots (heel out) and the
// hips turn hard to the right; the head drops off the line to the right
const hookLWind = st({ hip: add(S.hip, [0.02, -0.02, 0.01]), hipRot: rot(S.hipRot, [0, 12, 0]), handL: L([0.3, 1.38, 0.3], [1, 0.3, -0.4]), chest: rot(S.chest, [2, 10, 4]) });
const hookLOut = st({
  hip: add(S.hip, [-0.02, -0.03, 0.03]),
  hipRot: rot(S.hipRot, [3, -26, 0]),
  chest: rot(S.chest, [6, -32, -6]),
  head: rot(S.head, [2, 24, -6]),
  handL: L([-0.04, 1.42, 0.52], [1, 0.55, -0.2]),
  handR: L([-0.04, 1.39, 0.2], ELBOW_R),
  wristL: -10,
  toeL: [20, -44],
  shrugL: 12,
});
const hookLFollow = edit(hookLOut, { hipRot: rot(hookLOut.hipRot, [0, -5, 0]), chest: rot(hookLOut.chest, [0, -6, 0]), handL: L([-0.1, 1.41, 0.46], [1, 0.55, -0.2]) });
const hookL = once([[0, S], [0.24, hookLWind], [0.48, hookLOut, 'i'], [0.6, hookLFollow, 'o'], [0.8, edit(hookLWind, { hipRot: rot(S.hipRot, [0, -4, 0]), handL: L([0.18, 1.4, 0.34], ELBOW_L) })], [1, S]], 0.48);

// rear hook: the rear heel comes up and turns, the hips drive through
const hookRWind = st({ hip: add(S.hip, [-0.01, -0.02, -0.01]), hipRot: rot(S.hipRot, [0, -8, 0]), chest: rot(S.chest, [0, -6, -2]), handR: L([-0.32, 1.38, 0.18], [-1, 0.3, -0.4]) });
const hookROut = st({
  hip: add(S.hip, [0.03, -0.025, 0.06]),
  hipRot: rot(S.hipRot, [3, 42, 0]),
  chest: rot(S.chest, [6, 28, 6]),
  head: rot(S.head, [2, -24, 6]),
  handR: L([0.12, 1.4, 0.56], [-1, 0.2, -0.35]),
  handL: L([0.08, 1.41, 0.22], ELBOW_IN_L),
  wristR: -10,
  toeR: [36, 8],
  footR: L(add(S.footR.p, [0.02, 0.03, 0.04]), [-0.3, 0, 1]),
  shrugR: 12,
});
const hookRFollow = edit(hookROut, { hipRot: rot(hookROut.hipRot, [0, 5, 0]), chest: rot(hookROut.chest, [0, 6, 0]), handR: L([0.18, 1.39, 0.48], [-1, 0.2, -0.35]) });
const hookR = once([[0, S], [0.24, hookRWind], [0.5, hookROut, 'i'], [0.62, hookRFollow, 'o'], [0.82, edit(S, { hipRot: rot(S.hipRot, [0, 12, 0]), handR: L([-0.12, 1.38, 0.3], ELBOW_R) })], [1, S]], 0.5);

// rear uppercut: dip to the right, then drive up through the legs and turn the hips
const upperDip = st({ hip: add(S.hip, [-0.03, -0.08, 0]), hipRot: rot(S.hipRot, [6, -8, -4]), chest: rot(S.chest, [12, -12, -10]), head: rot(S.head, [0, 4, -6]), handR: L([-0.1, 1.1, 0.22], [-0.3, -1, -0.2]) });
const upperOut = st({
  hip: add(S.hip, [0.02, 0.03, 0.06]),
  hipRot: rot(S.hipRot, [-2, 30, 0]),
  chest: rot(S.chest, [-4, 20, 4]),
  head: rot(S.head, [-2, -20, 4]),
  handR: L([0.03, 1.46, 0.56], [-0.3, -1, 0]),
  handL: L([0.08, 1.41, 0.24], ELBOW_IN_L),
  wristR: 90,
  toeR: [34, 16],
});
const uppercut = once([[0, S], [0.28, upperDip], [0.5, upperOut, 'i'], [0.62, edit(upperOut, { hip: add(upperOut.hip, [0, 0.01, 0]), handR: L([0.02, 1.5, 0.5], [-0.3, -1, 0]) }), 'o'], [1, S]], 0.5);

// lead hook to the body: drop the level, dig under the elbow, the rear glove stays on the (lowered) cheek
const bodyLoad = st({ hip: add(S.hip, [0.02, -0.06, 0.02]), hipRot: rot(S.hipRot, [6, 8, 0]), chest: rot(S.chest, [8, 6, -6]) });
const bodyOut = st({
  hip: add(S.hip, [0.04, -0.13, 0.05]),
  hipRot: rot(S.hipRot, [10, -18, 0]),
  chest: rot(S.chest, [14, -28, -12]),
  head: rot(S.head, [-10, 18, 0]),
  handL: L([0.0, 1.06, 0.5], [1, 0.25, -0.3]),
  handR: L([-0.1, 1.22, 0.3], ELBOW_R),
  toeL: [14, -30],
  wristL: 10,
});
const bodyShot = once([[0, S], [0.25, bodyLoad], [0.47, bodyOut, 'i'], [0.6, bodyOut, 'o'], [1, S]], 0.47);

// rear low kick: step out with the lead foot, pivot on it (heel to the opponent), the shin swings through the thigh,
// the kicking-side arm swings back for balance
const lowChamber = st({ hip: add(S.hip, [0.02, 0.0, 0.04]), hipRot: rot(S.hipRot, [0, 22, 0]), chest: rot(S.chest, [0, -4, 0]), footR: L([-0.08, 0.42, 0.02], [0, 0.4, 1]), toeL: [0, -40], toeR: [30, 30], handR: L([-0.28, 1.1, 0.0], [-0.5, -1, 0]) });
const lowOut = st({
  hip: add(S.hip, [0, 0.02, 0.06]),
  hipRot: [-6, 40, 6],
  chest: [6, 0, -8],
  head: [0, -18, 0],
  footR: L([0.22, 0.42, 0.52], [0.3, 0.4, 1]),
  footL: L(S.footL.p, [0.1, 0, 1]),
  toeL: [0, -72],
  toeR: [40, 60],
  handR: L([-0.4, 1.04, -0.14], [-0.4, -1, 0]),
  handL: L([0.1, 1.42, 0.3], [0.6, -1, -0.1]),
});
const lowFollow = edit(lowOut, { hipRot: [-6, 50, 8], footR: L([0.32, 0.38, 0.4], [0.3, 0.4, 1]) });
const lowKick = once([[0, S], [0.3, lowChamber], [0.5, lowOut, 'i'], [0.6, lowFollow, 'o'], [0.8, edit(lowChamber, { hipRot: rot(S.hipRot, [0, 14, 0]), footR: L([-0.12, 0.3, -0.12], [0, 0.3, 1]) })], [1, S]], 0.5);

const bodyChamber = st({ hip: add(S.hip, [0.02, 0.01, 0.03]), hipRot: rot(S.hipRot, [0, 32, -6]), footR: L([-0.06, 0.55, 0.1], [0, 0.7, 1]), toeL: [0, -45], toeR: [30, 40], handR: L([-0.3, 1.12, 0.0], [-0.5, -1, 0]) });
const bodyKickOut = st({
  hip: add(S.hip, [0, 0.04, 0.03]),
  hipRot: [-14, 64, 18],
  chest: [-4, -6, -14],
  head: [4, -40, 10],
  footR: L([0.16, 0.98, 0.66], [0, 1, 0.3]),
  footL: L(S.footL.p, [0.2, 0, 1]),
  toeL: [0, -92],
  toeR: [50, 70],
  handR: L([-0.44, 0.98, -0.12], [-0.4, -1, 0]),
  handL: L([0.06, 1.46, 0.24], [0.6, -1, -0.1]),
});
const bodyKickFollow = edit(bodyKickOut, { hipRot: [-14, 72, 18], footR: L([0.26, 0.96, 0.56], [0, 1, 0.3]) });
const bodyKick = once([[0, S], [0.32, bodyChamber], [0.5, bodyKickOut, 'i'], [0.6, bodyKickFollow, 'o'], [0.8, edit(bodyChamber, { hipRot: rot(S.hipRot, [0, 18, -3]) })], [1, S]], 0.5);

const headChamber = st({ hip: add(S.hip, [0.02, 0.02, 0.03]), hipRot: rot(S.hipRot, [-6, 36, -8]), footR: L([-0.04, 0.7, 0.12], [0, 1, 0.6]), toeL: [0, -50], toeR: [30, 40], handR: L([-0.32, 1.1, -0.02], [-0.5, -1, 0]) });
const headKickOut = st({
  hip: add(S.hip, [0, 0.05, 0.0]),
  hipRot: [-28, 76, 30],
  chest: [-14, -8, -18],
  head: [10, -48, 16],
  footR: L([0.1, 1.5, 0.62], [0, 1, 0]),
  footL: L(S.footL.p, [0.2, 0, 1]),
  toeL: [0, -102],
  toeR: [55, 70],
  handR: L([-0.48, 0.96, -0.18], [-0.4, -1, 0]),
  handL: L([0.04, 1.5, 0.18], [0.6, -1, -0.1]),
});
const headKickFollow = edit(headKickOut, { hipRot: [-26, 86, 30], footR: L([0.24, 1.44, 0.5], [0, 1, 0]) });
const headKick = once([[0, S], [0.36, headChamber], [0.55, headKickOut, 'i'], [0.66, headKickFollow, 'o'], [0.84, edit(headChamber, { hipRot: rot(S.hipRot, [0, 20, -4]) })], [1, S]], 0.55);

// superman punch: fake a knee, hop, throw the rear hand while flying forward
const supermanHop = st({
  hip: add(S.hip, [0, 0.16, 0.08]),
  hipRot: rot(S.hipRot, [8, 10, 0]),
  footR: L([-0.12, 0.42, -0.42], [0, -0.3, 1]),
  footL: L([0.12, 0.22, 0.18], [0.1, 0.2, 1]),
  handR: L([-0.22, 1.42, -0.1], [-1, -0.3, 0]),
});
const supermanOut = st({
  hip: add(S.hip, [0, 0.08, 0.16]),
  hipRot: [8, 18, 0],
  chest: [14, 18, 0],
  head: [-2, -20, 0],
  handR: L([0.0, 1.5, 0.78], [-0.4, -0.4, 0]),
  handL: L([0.34, 1.18, -0.18], [0.6, -0.4, -1]),
  footR: L([-0.16, 0.2, -0.5], [0, -0.3, 1]),
  footL: L([0.12, 0.075, 0.3], S.footL.pole),
  toeR: [40, 30],
});
const supermanLand = st({ hip: add(S.hip, [0, -0.04, 0.08]), hipRot: rot(S.hipRot, [6, 16, 0]), chest: rot(S.chest, [6, 8, 0]), footL: L(add(S.footL.p, [0, 0, 0.06]), S.footL.pole) });
const superman = once([[0, S], [0.42, supermanHop, 'o'], [0.62, supermanOut, 'i'], [0.72, supermanOut], [0.86, supermanLand, 'i'], [1, S]], 0.62);

// flying knee: jump off the lead leg, drive the rear knee up into the head, hands pull down
const kneeJump = st({ hip: add(S.hip, [0, 0.18, 0.08]), footL: L([0.12, 0.25, 0.18], S.footL.pole), footR: L([-0.1, 0.4, -0.3], [0, 0, 1]), hipRot: rot(S.hipRot, [0, 20, 0]) });
const kneeOut = st({
  hip: add(S.hip, [0, 0.3, 0.14]),
  hipRot: [-6, 20, 0],
  chest: [-6, 0, 0],
  head: [8, -10, 0],
  footR: L([-0.04, 0.85, 0.12], [0, 0.6, 1]),
  footL: L([0.14, 0.35, -0.2], [0, -0.2, 1]),
  handL: L([0.14, 1.5, 0.46], [0.6, -0.6, 0]),
  handR: L([-0.14, 1.5, 0.46], [-0.6, -0.6, 0]),
  toeR: [50, 0],
  toeL: [40, 0],
});
const kneeLand = st({ hip: add(S.hip, [0, -0.06, 0.06]), chest: rot(S.chest, [8, 0, 0]) });
const flyingKnee = once([[0, S], [0.45, kneeJump, 'o'], [0.66, kneeOut, 'i'], [0.76, kneeOut], [0.88, kneeLand, 'i'], [1, S]], 0.66);

// spinning back fist: turn the back to them, whip the rear arm round
const spinHalf = st({ hipRot: [6, -150, 0], chest: [8, -30, 0], head: [6, -90, 0], toeL: [0, -120], toeR: [20, -100], handR: L([-0.25, 1.38, -0.1], [-1, 0, 0]) });
const spinOut = st({
  hipRot: [4, -268, 0],
  chest: [6, -40, 0],
  head: [4, -50, 0],
  handR: L([0.3, 1.46, 0.62], [-0.2, 0.2, -1]),
  handL: L([-0.1, 1.34, 0.0], [0.6, -1, 0]),
  footR: L([0.2, 0.075, 0.1], [0, 0, 1]),
  toeL: [0, -200],
  toeR: [10, -250],
  wristR: 80,
});
const spinBackfist = once([[0, S], [0.3, spinHalf], [0.55, spinOut, 'i'], [0.66, spinOut], [1, edit(S, { hipRot: [S.hipRot[0], S.hipRot[1] - 360, 0] }), 'o']], 0.55);

// ---- standing: defence -----------------------------------------------------------------------------------------

// the shell: elbows in over the ribs, gloves on the temples, chin down, knees bent
const blockPose = st({
  hip: add(S.hip, [0, -0.04, -0.02]),
  chest: rot(S.chest, [10, 0, 0]),
  head: [16, 14, 0],
  handL: L([0.1, 1.43, 0.22], [0.3, -1, 0.3]),
  handR: L([-0.06, 1.44, 0.16], [-0.3, -1, 0.3]),
  wristL: 85,
  wristR: 85,
  shrugL: 16,
  shrugR: 16,
});
const block = loop(1.2, [
  [0, blockPose],
  [0.5, edit(blockPose, { hip: add(blockPose.hip, [0, 0.008, 0]), chest: rot(blockPose.chest, [-1.5, 0, 0]) })],
  [1, blockPose],
], 0.06);
const blockHitPose = edit(blockPose, { hip: add(blockPose.hip, [0, -0.03, -0.1]), hipRot: rot(S.hipRot, [-4, 0, 0]), chest: rot(blockPose.chest, [-10, 0, 0]), head: rot(blockPose.head, [-10, 0, 0]), footL: L(add(S.footL.p, [0, 0, -0.04]), S.footL.pole) });
const blockHit = once([[0, blockPose], [0.22, blockHitPose, 'o'], [1, blockPose]], undefined, 0.04);

// slips: bend at the knees and the waist so the head drops off the line, eyes on the opponent
const slipLPose = st({ hip: add(S.hip, [0.08, -0.11, 0.01]), hipRot: rot(S.hipRot, [8, 4, 8]), chest: rot(S.chest, [14, 6, 24]), head: rot(S.head, [4, -4, 12]), handL: L(add(GUARD_L.p, [0.06, -0.08, -0.02]), GUARD_L.pole), handR: L(add(GUARD_R.p, [0.06, -0.08, 0]), GUARD_R.pole) });
const slipL = once([[0, S], [0.32, slipLPose, 'o'], [0.6, slipLPose], [1, S]], undefined, 0.04);
const slipRPose = st({ hip: add(S.hip, [-0.08, -0.11, 0.01]), hipRot: rot(S.hipRot, [8, -4, -8]), chest: rot(S.chest, [14, -6, -24]), head: rot(S.head, [4, 4, -12]), handL: L(add(GUARD_L.p, [-0.06, -0.08, 0]), GUARD_L.pole), handR: L(add(GUARD_R.p, [-0.06, -0.08, -0.02]), GUARD_R.pole) });
const slipR = once([[0, S], [0.32, slipRPose, 'o'], [0.6, slipRPose], [1, S]], undefined, 0.04);
// sway back: the weight goes onto the rear leg, the upper body leans away, the chin stays tucked
const swayPose = st({ hip: add(S.hip, [0, -0.05, -0.14]), hipRot: rot(S.hipRot, [-6, 0, 0]), chest: rot(S.chest, [-24, 0, 0]), head: rot(S.head, [4, 0, 0]), footL: L(add(S.footL.p, [0, 0, -0.06]), S.footL.pole), toeL: [10, -12] });
const swayBack = once([[0, S], [0.32, swayPose, 'o'], [0.6, swayPose], [1, S]], undefined, 0.04);

// ---- standing: getting hit (react: the size of the hit is read from the stun length) ------------------------------

const snapL = st({ chest: rot(S.chest, [-8, 20, 10]), head: [-16, 48, 24], hip: add(S.hip, [0.01, -0.03, -0.06]), hipRot: rot(S.hipRot, [-4, 6, 0]), handR: L([-0.16, 1.3, 0.1], ELBOW_R), handL: L([0.24, 1.3, 0.26], [0.6, -1, 0]), toeL: [12, -12] });
const hitHeadL: Clip = { ...once([[0, S], [0.16, snapL, 'o'], [0.45, edit(snapL, { head: [-6, 30, 12] })], [1, S]], undefined, 0.03), react: 18 };
const snapR = st({ chest: rot(S.chest, [-8, -18, -10]), head: [-16, -22, -24], hip: add(S.hip, [-0.01, -0.03, -0.06]), hipRot: rot(S.hipRot, [-4, -6, 0]), handL: L([0.26, 1.28, 0.24], [0.6, -1, 0]), toeL: [12, -12] });
const hitHeadR: Clip = { ...once([[0, S], [0.16, snapR, 'o'], [0.45, edit(snapR, { head: [-6, -6, -12] })], [1, S]], undefined, 0.03), react: 16 };
const rocked = st({
  hip: add(S.hip, [0, -0.08, -0.12]),
  hipRot: rot(S.hipRot, [-12, 0, 6]),
  chest: rot(S.chest, [-24, 10, 8]),
  head: [-34, 30, 18],
  handL: L([0.36, 1.18, 0.14], [0.6, -1, -0.4]),
  handR: L([-0.36, 1.12, 0.06], [-0.6, -1, -0.4]),
  footL: L(add(S.footL.p, [0, 0, -0.08]), S.footL.pole),
  fist: 0.4,
  toeL: [18, -12],
});
const hitHeadHeavy: Clip = { ...once([[0, S], [0.16, rocked, 'o'], [0.5, edit(rocked, { head: [-10, 16, 8], hip: add(rocked.hip, [0, -0.02, -0.03]) })], [1, S]], undefined, 0.03), react: 30 };
const fold = st({ hip: add(S.hip, [0, -0.07, -0.09]), hipRot: rot(S.hipRot, [6, 0, 0]), chest: rot(S.chest, [28, 0, 0]), head: rot(S.head, [10, 0, 0]), handL: L([0.1, 1.15, 0.22], [0.6, -1, 0]), handR: L([-0.1, 1.15, 0.18], [-0.6, -1, 0]) });
const hitBody: Clip = { ...once([[0, S], [0.2, fold, 'o'], [0.5, fold], [1, S]], undefined, 0.03), react: 18 };
const buckle = st({ hip: add(S.hip, [0.04, -0.1, -0.02]), hipRot: rot(S.hipRot, [0, 0, 10]), footL: L(add(S.footL.p, [-0.06, 0.08, -0.04]), [-0.6, 0, 1]), toeL: [20, 10], chest: rot(S.chest, [6, 0, 6]) });
const hitLeg: Clip = { ...once([[0, S], [0.2, buckle, 'o'], [0.55, buckle], [1, S]], undefined, 0.03), react: 14 };
// doubled over from a liver shot: bent at the waist, elbow clamped to the side, the other glove pawing out
const doubled = st({
  hip: add(S.hip, [0.03, -0.14, -0.12]),
  hipRot: rot(S.hipRot, [8, 10, 0]),
  chest: rot(S.chest, [42, 10, -10]),
  head: rot(S.head, [-18, 0, 0]),
  handL: L([0.14, 1.0, 0.3], [0.6, -1, 0]),
  handR: L([-0.16, 0.98, 0.08], [-0.6, -1, -0.3]),
  fist: 0.5,
});
const hurtBody = once([[0, S], [0.12, doubled, 'o'], [0.5, edit(doubled, { hip: add(doubled.hip, [0, -0.03, -0.02]) })], [0.82, doubled], [1, S]], undefined, 0.04);

// rocked: guard sagging, knees going, the whole body drifting from side to side
const woozy = st({ hip: add(S.hip, [0.05, -0.08, -0.05]), chest: rot(S.chest, [2, 0, 10]), head: [18, 14, 18], handL: L([0.22, 1.12, 0.24], [0.6, -1, 0]), handR: L([-0.18, 1.1, 0.16], ELBOW_R), fist: 0.5 });
const stunned = loop(1.3, [
  [0, woozy],
  [0.5, edit(woozy, { hip: add(woozy.hip, [-0.1, -0.03, 0.02]), chest: rot(woozy.chest, [4, 0, -20]), head: [24, -8, -22] })],
  [1, woozy],
], 0.08);

// ---- knockdowns and getting up ------------------------------------------------------------------------------------

/** On the canvas, face up (hips measured from the mat: the rig lays any body flat). */
const LYING: Pose = {
  hip: [0, -0.81, -0.05],
  hipRot: [-90, 0, 0],
  chest: [0, 0, 0],
  head: [8, 20, 0],
  handL: L([0.48, 0.08, -0.25], [1, 0.2, 0]),
  handR: L([-0.46, 0.08, -0.35], [-1, 0.2, 0]),
  wristL: 60,
  wristR: 60,
  footL: L([0.2, 0.09, 0.8], [0.2, 1, 0]),
  footR: L([-0.16, 0.09, 0.78], [-0.2, 1, 0]),
  toeL: [-110, 10],
  toeR: [-110, -10],
  fist: 0.2,
  shrugL: 0,
  shrugR: 0,
};
// out on the feet: the knees go first, the body drops, then tips back; the back hits the canvas, bounces, settles
const kdBuckle = edit(rocked, { hip: [0.02, -0.3, -0.12], hipRot: [-14, -20, 6], chest: [-16, 10, 8], head: [-30, 24, 10], handL: L([0.36, 0.9, 0.0], [1, -0.3, 0]), handR: L([-0.36, 0.86, -0.04], [-1, -0.3, 0]), footL: L([0.13, 0.08, 0.22], [0.3, 0.2, 1]), footR: L([-0.15, 0.08, -0.2], [-0.2, 0.2, 1]), toeR: [10, 30], fist: 0.25 });
const kdSit = edit(LYING, { hip: [0, -0.74, -0.12], hipRot: [-40, 0, 4], chest: [-10, 6, 6], head: [-26, 16, 6], handL: L([0.42, 0.42, -0.3], [1, 0, 0]), handR: L([-0.42, 0.4, -0.34], [-1, 0, 0]), footL: L([0.18, 0.12, 0.42], [0.3, 1, 0.3]), footR: L([-0.16, 0.1, 0.36], [-0.3, 1, 0.3]), toeL: [-40, 10], toeR: [-40, -10] });
const kdBounce = edit(LYING, { hip: [0, -0.79, -0.05], chest: [6, 0, 0], head: [20, 26, 0], handL: L([0.5, 0.16, -0.2], [1, 0.2, 0]), handR: L([-0.48, 0.15, -0.3], [-1, 0.2, 0]), footL: L([0.2, 0.15, 0.74], [0.2, 1, 0]), footR: L([-0.16, 0.13, 0.72], [-0.2, 1, 0]) });
const knockdown = once([[0, rocked], [0.26, kdBuckle, 'i'], [0.5, kdSit, 'i'], [0.66, LYING, 'i'], [0.78, kdBounce, 'o'], [0.92, LYING, 's'], [1, LYING]], undefined, 0.04);
const downed = loop(2.4, [
  [0, LYING],
  [0.5, edit(LYING, { head: [2, 10, 0], chest: [2, 0, 0], handR: L([-0.4, 0.1, -0.2], [-1, 0.2, 0]) })],
  [1, LYING],
], 0.2);
const SITTING: Pose = edit(LYING, { hip: [0, -0.8, 0.0], hipRot: [-20, 0, 0], chest: [10, 0, 0], head: [10, 0, 0], handL: L([0.32, 0.12, -0.25], [1, 0.5, 0]), handR: L([-0.32, 0.12, -0.25], [-1, 0.5, 0]), footL: L([0.2, 0.08, 0.55], [0.2, 1, 0.3]), footR: L([-0.2, 0.08, 0.5], [-0.2, 1, 0.3]), toeL: [-30, 10], toeR: [-30, -10] });
// technical stand-up: post the right hand behind, plant the left foot, lift the hips and swing the right leg back
const TECH_UP: Pose = edit(SITTING, {
  hip: [0.04, -0.56, -0.12],
  hipRot: [20, -20, -16],
  chest: [24, 10, 6],
  head: [-20, 10, 0],
  handR: L([-0.36, 0.08, -0.18], [-1, 0.3, 0]),
  handL: L([0.24, 0.9, 0.3], [1, -0.4, 0]),
  footL: L([0.2, 0.08, 0.3], [0.3, 0.5, 1]),
  footR: L([-0.16, 0.08, -0.5], [0, -0.3, 1]),
  toeL: [0, -10],
  toeR: [30, 20],
});
const CROUCH: Pose = st({ hip: [0, -0.4, -0.06], hipRot: [28, -14, 0], chest: [26, 4, 0], head: [-18, 6, 0], handL: L([0.16, 1.14, 0.3], [0.6, -1, 0]), handR: L([-0.06, 1.12, 0.18], ELBOW_R), footL: L([0.15, 0.08, 0.28], [0.2, 0.3, 1]), footR: L([-0.17, 0.08, -0.26], [-0.1, 0.3, 1]), toeR: [30, 30] });
const getUp = once([[0, LYING], [0.25, SITTING], [0.52, TECH_UP], [0.76, CROUCH], [1, S]], undefined, 0.12);

// ---- takedown shot and the sprawl ---------------------------------------------------------------------------------

const shootDip = st({ hip: [0, -0.32, 0.05], hipRot: [30, -15, 0], chest: [30, 5, 0], head: [-30, 5, 0], handL: L([0.2, 0.88, 0.55], [1, -0.5, 0]), handR: L([-0.2, 0.88, 0.5], [-1, -0.5, 0]), footL: L([0.13, 0.08, 0.45], [0.2, 0, 1]), footR: L([-0.17, 0.1, -0.35], [-0.1, 0, 1]), toeR: [40, 20], fist: 0.3 });
// the penetration step: the lead knee nearly touches the canvas, the head up on the outside of the hip
const shootDrive = edit(shootDip, { hip: [0, -0.46, 0.26], hipRot: [42, -8, 0], chest: [26, 0, 0], head: [-38, 0, 0], handL: L([0.24, 0.66, 0.8], [1, -0.2, 0]), handR: L([-0.24, 0.66, 0.8], [-1, -0.2, 0]), footL: L([0.15, 0.08, 0.5], [0.2, -0.3, 1]), footR: L([-0.18, 0.1, -0.5], [0, -0.5, 1]), toeR: [50, 10] });
const shoot = once([[0, S], [0.32, shootDip], [0.66, shootDrive, 'i'], [1, shootDrive]], 0.66, 0.05);
// the sprawl: hips back and down onto the shooter's shoulders, legs kicked back, hands pushing the head down
const sprawlDown = st({ hip: [0, -0.62, -0.42], hipRot: [72, 0, 0], chest: [8, 0, 0], head: [-48, 0, 0], handL: L([0.22, 0.56, 0.32], [1, 0.4, 0]), handR: L([-0.22, 0.56, 0.32], [-1, 0.4, 0]), footL: L([0.22, 0.1, -1.05], [0, -1, 0]), footR: L([-0.22, 0.1, -1.1], [0, -1, 0]), toeL: [-10, 0], toeR: [-10, 0] });
const sprawl = once([[0, S], [0.22, sprawlDown, 'i'], [0.6, sprawlDown], [0.82, CROUCH], [1, S]], undefined, 0.04);
// a stuffed shot: flattened on the knees, then back up to the stance
const FLAT: Pose = edit(shootDrive, { hip: [0, -0.62, -0.05], hipRot: [70, 0, 0], chest: [16, 0, 0], head: [-50, 0, 0], handL: L([0.24, 0.08, 0.36], [1, 0.2, 0]), handR: L([-0.24, 0.08, 0.34], [-1, 0.2, 0]), footL: L([0.16, 0.08, -0.5], [0.1, -0.3, 1]), footR: L([-0.16, 0.08, -0.56], [-0.1, -0.3, 1]), toeL: [-10, 180], toeR: [-10, 180] });
const getUpShot = once([[0, FLAT], [0.35, FLAT], [0.7, CROUCH], [1, S]], undefined, 0.12);

// ---- moments and the result ---------------------------------------------------------------------------------------

const taunt = once([
  [0, S],
  [0.2, edit(RELAXED, { hip: [0, -0.03, 0], handL: L([0.5, 1.1, 0.12], [1, -0.2, -1]), handR: L([-0.5, 1.1, 0.12], [-1, -0.2, -1]), head: [-14, 0, 0], chest: [-6, 0, 0], fist: 0.3 })],
  [0.5, edit(RELAXED, { hip: [0, 0.0, 0], handL: L([0.52, 1.16, 0.14], [1, -0.2, -1]), handR: L([-0.52, 1.16, 0.14], [-1, -0.2, -1]), head: [-18, 10, 0], chest: [-8, 0, 0], fist: 0.3 })],
  [0.8, edit(RELAXED, { hip: [0, -0.03, 0], handL: L([0.5, 1.1, 0.12], [1, -0.2, -1]), handR: L([-0.5, 1.1, 0.12], [-1, -0.2, -1]), head: [-14, -10, 0], chest: [-6, 0, 0], fist: 0.3 })],
  [1, S],
], undefined, 0.12);
// victory: both fists up, chest out, then one arm pumping
const arms = edit(RELAXED, { hip: [0, -0.02, 0], handL: L([0.3, 2.0, 0.1], [1, 0, -0.3]), handR: L([-0.3, 2.0, 0.1], [-1, 0, -0.3]), head: [-20, 0, 0], chest: [-10, 0, 0], fist: 1, wristL: 90, wristR: 90, footL: L([0.16, 0.075, 0.06], [0.1, 0, 1]), footR: L([-0.16, 0.075, -0.04], [-0.1, 0, 1]) });
const victory = loop(1.6, [
  [0, arms],
  [0.3, edit(arms, { hip: [0, 0.01, 0], chest: [-14, 6, 0], head: [-26, 8, 0], handL: L([0.36, 2.06, 0.06], [1, 0, -0.3]), handR: L([-0.42, 1.72, 0.18], [-1, -0.3, -0.3]) })],
  [0.55, edit(arms, { hip: [0, -0.03, 0], chest: [-8, 0, 0] })],
  [0.8, edit(arms, { hip: [0, 0.01, 0], chest: [-14, -6, 0], head: [-26, -8, 0], handR: L([-0.36, 2.06, 0.06], [-1, 0, -0.3]), handL: L([0.42, 1.72, 0.18], [1, -0.3, -0.3]) })],
  [1, arms],
], 0.3);
// defeat: hands on the hips, head down, breathing hard
const slump = edit(RELAXED, { hip: [0, -0.02, 0], head: [30, 0, 0], chest: [12, 0, 0], handL: L([0.26, 1.0, -0.02], [1, 0.2, -0.6]), handR: L([-0.26, 1.0, -0.02], [-1, 0.2, -0.6]), shrugL: -4, shrugR: -4, fist: 0.4 });
const defeat = loop(2.6, [
  [0, slump],
  [0.4, edit(slump, { chest: [8, 0, 0], head: [24, -8, 0], shrugL: 2, shrugR: 2 })],
  [1, slump],
], 0.4);
const loose = edit(RELAXED, { handL: L([0.28, 1.12, 0.12], [1, -0.3, -0.6]), handR: L([-0.28, 1.12, 0.12], [-1, -0.3, -0.6]), fist: 0.8 });
const walkout = loop(1.2, [
  [0, loose],
  [0.25, edit(loose, { hip: [0, 0.01, 0], chest: [0, 8, 4], shrugL: 12 })],
  [0.5, loose],
  [0.75, edit(loose, { hip: [0, 0.01, 0], chest: [0, -8, -4], shrugR: 12 })],
  [1, loose],
], 0.3);

// ---- ground (paired around one anchor: the bottom fighter's hips) ------------------------------------------------

/** Kneeling feet: shins on the canvas, toes pointing back. */
const KNEEL_TOE: readonly [number, number] = [-10, 180];

// closed guard: the bottom lies with the hips pulled onto the top's thighs, legs locked round the waist
const GUARD_BOTTOM: Pose = edit(LYING, {
  hip: [0, -0.79, 0.02],
  hipRot: [-72, 0, 0],
  chest: [-12, 0, 0],
  head: [32, 0, 0],
  footL: L([-0.07, 0.56, 0.6], [1, 0.5, 0.2]),
  footR: L([0.07, 0.6, 0.62], [-1, 0.5, 0.2]),
  handL: L([0.16, 0.44, -0.06], [1, -0.2, -0.3]),
  handR: L([-0.16, 0.44, -0.06], [-1, -0.2, -0.3]),
  toeL: [-60, -40],
  toeR: [-60, 40],
  fist: 0.4,
});
// in the guard: on the knees, sitting back a little, hands posted on the bottom's chest
const GUARD_TOP: Pose = st({
  hip: [0, -0.56, -0.46],
  hipRot: [30, 0, 0],
  chest: [14, 0, 0],
  head: [-34, 0, 0],
  handL: L([0.15, 0.36, 0.14], [1, 0.2, -0.6]),
  handR: L([-0.15, 0.36, 0.14], [-1, 0.2, -0.6]),
  footL: L([0.17, 0.07, -0.72], [0.2, -0.2, 1]),
  footR: L([-0.17, 0.07, -0.72], [-0.2, -0.2, 1]),
  toeL: KNEEL_TOE,
  toeR: KNEEL_TOE,
  wristL: 60,
  wristR: 60,
  fist: 0.6,
});
// mount: sitting on the belly, knees on the canvas beside the ribs, feet hooked by the hips
const MOUNT_BOTTOM: Pose = edit(LYING, { hip: [0, -0.8, 0], hipRot: [-88, 0, 0], head: [22, 0, 0], footL: L([0.22, 0.08, 0.46], [0.3, 1, 0.3]), footR: L([-0.22, 0.08, 0.46], [-0.3, 1, 0.3]), toeL: [0, 10], toeR: [0, -10], handL: L([0.14, 0.42, -0.12], [1, 0, -0.3]), handR: L([-0.14, 0.42, -0.12], [-1, 0, -0.3]), fist: 0.5 });
const MOUNT_TOP: Pose = st({
  hip: [0, -0.57, 0.14],
  hipRot: [10, 0, 0],
  chest: [12, 0, 0],
  head: [-22, 0, 0],
  handL: L([0.17, 0.46, 0.4], [1, 0, -0.3]),
  handR: L([-0.17, 0.48, 0.38], [-1, 0, -0.3]),
  footL: L([0.34, 0.07, -0.34], [1, 0.1, 0.5]),
  footR: L([-0.34, 0.07, -0.34], [-1, 0.1, 0.5]),
  toeL: [-10, 160],
  toeR: [-10, -160],
});
const gndGuardTop = loop(2.2, [[0, GUARD_TOP], [0.5, edit(GUARD_TOP, { chest: [18, 0, 0], hip: add(GUARD_TOP.hip, [0, 0.01, 0.01]) })], [1, GUARD_TOP]], 0.25);
const gndGuardBottom = loop(2.2, [[0, GUARD_BOTTOM], [0.5, edit(GUARD_BOTTOM, { chest: [-16, 0, 0], hip: add(GUARD_BOTTOM.hip, [0, 0.01, 0.01]) })], [1, GUARD_BOTTOM]], 0.25);
const gndMountTop = loop(2.0, [[0, MOUNT_TOP], [0.5, edit(MOUNT_TOP, { chest: [16, 0, 0] })], [1, MOUNT_TOP]], 0.25);
const gndMountBottom = loop(2.0, [[0, MOUNT_BOTTOM], [0.5, edit(MOUNT_BOTTOM, { head: [26, 6, 0], hip: add(MOUNT_BOTTOM.hip, [0, 0.01, 0]) })], [1, MOUNT_BOTTOM]], 0.25);

// ground-and-pound from mount: post the left hand on the chest, cock the right, drop it onto the face
const poundCock = edit(MOUNT_TOP, { hip: add(MOUNT_TOP.hip, [0, 0.03, -0.02]), chest: [4, -22, 0], head: [-20, 10, 0], handR: L([-0.26, 1.08, 0.04], [-1, 0.3, -0.5]), handL: L([0.12, 0.34, 0.42], [1, 0.2, -0.3]) });
const poundDown = edit(MOUNT_TOP, { hip: add(MOUNT_TOP.hip, [0, -0.01, 0.06]), chest: [34, 16, 0], head: [-30, -6, 0], handR: L([-0.02, 0.44, 0.58], [-1, 0.3, 0]), handL: L([0.12, 0.34, 0.42], [1, 0.2, -0.3]) });
const gndPound = once([[0, MOUNT_TOP], [0.25, poundCock, 'o'], [0.42, poundDown, 'i'], [0.58, poundDown], [1, MOUNT_TOP]], 0.42, 0.05);
const GND_BLOCK = edit(MOUNT_BOTTOM, { handL: L([0.07, 0.42, -0.5], [1, 0.4, 0]), handR: L([-0.07, 0.44, -0.48], [-1, 0.4, 0]), head: [34, 0, 0], wristL: 85, wristR: 85 });
const gndBlock = loop(1.0, [[0, GND_BLOCK], [0.5, edit(GND_BLOCK, { head: [36, 4, 0] })], [1, GND_BLOCK]], 0.06);
const gndPoundHit: Clip = { ...once([[0, MOUNT_BOTTOM], [0.22, edit(MOUNT_BOTTOM, { head: [24, 40, 24], chest: [4, 8, 4], handL: L([0.3, 0.3, -0.3], [1, 0, 0]) }), 'o'], [1, MOUNT_BOTTOM]], undefined, 0.03), react: 14 };

// the same from inside the guard: rise up on the knees, post on the chest, punch down at the face
const poundGuardCock = edit(GUARD_TOP, { hip: add(GUARD_TOP.hip, [0, 0.06, 0.04]), chest: [10, -20, 0], head: [-26, 10, 0], handR: L([-0.26, 1.02, -0.1], [-1, 0.3, -0.5]), handL: L([0.13, 0.32, 0.18], [1, 0.2, -0.6]) });
const poundGuardDown = edit(GUARD_TOP, { hip: add(GUARD_TOP.hip, [0, 0.04, 0.12]), chest: [36, 16, 0], head: [-36, -6, 0], handR: L([-0.02, 0.44, 0.5], [-1, 0.3, 0]), handL: L([0.13, 0.32, 0.18], [1, 0.2, -0.6]) });
const gndPoundGuard = once([[0, GUARD_TOP], [0.25, poundGuardCock, 'o'], [0.42, poundGuardDown, 'i'], [0.58, poundGuardDown], [1, GUARD_TOP]], 0.42, 0.05);
const GUARD_BLOCK = edit(GUARD_BOTTOM, { chest: [-4, 0, 0], head: [38, 0, 0], handL: L([0.07, 0.48, -0.42], [1, 0.4, 0]), handR: L([-0.07, 0.5, -0.4], [-1, 0.4, 0]), wristL: 85, wristR: 85 });
const gndBlockGuard = loop(1.0, [[0, GUARD_BLOCK], [0.5, edit(GUARD_BLOCK, { head: [40, 4, 0] })], [1, GUARD_BLOCK]], 0.06);
const gndPoundHitGuard: Clip = { ...once([[0, GUARD_BOTTOM], [0.22, edit(GUARD_BOTTOM, { head: [26, 40, 24], chest: [-6, 8, 4] }), 'o'], [1, GUARD_BOTTOM]], undefined, 0.03), react: 14 };

// scrambles
const passMid = edit(GUARD_TOP, { hip: [0.08, -0.5, -0.2], hipRot: [30, 24, 6], chest: [30, 10, 0], head: [-30, -10, 0], footR: L([-0.28, 0.32, -0.3], [-1, 0.3, 0.5]), handL: L([0.2, 0.34, 0.3], [1, 0.2, -0.4]), handR: L([-0.1, 0.32, 0.36], [-1, 0.2, -0.4]) });
const gndAdvance = once([[0, GUARD_TOP], [0.5, passMid], [1, MOUNT_TOP]], undefined, 0.1);
const escapeMid = edit(MOUNT_BOTTOM, { hip: [0.1, -0.74, 0.04], hipRot: [-80, 30, 24], chest: [-6, -10, 0], footL: L([0.3, 0.08, 0.3], [0.5, 1, 0.3]), footR: L([-0.14, 0.24, 0.44], [-0.3, 1, 0.5]), handL: L([0.12, 0.48, 0.0], [1, 0, -0.3]), handR: L([-0.08, 0.5, 0.02], [-1, 0, -0.3]) });
const gndEscape = once([[0, MOUNT_BOTTOM], [0.5, escapeMid], [1, GUARD_BOTTOM]], undefined, 0.1);
const gndStandUp = once([[0, GUARD_TOP], [0.45, CROUCH], [1, S]], undefined, 0.15);
// from the bottom: sit up, post a hand and stand up out of it
const gndStandUpBottom = once([[0, GUARD_BOTTOM], [0.3, SITTING], [0.6, TECH_UP], [0.82, CROUCH], [1, S]], undefined, 0.12);

// ---- submissions ----------------------------------------------------------------------------------------------------

// armbar from the guard: the bottom swings the hips out, one leg across the face, the other over the back, and pulls
// the trapped arm straight across the chest; the top is bent over with the arm stuck between the legs
const ARMBAR_ATK: Pose = edit(GUARD_BOTTOM, {
  hip: [0.04, -0.76, 0.06],
  hipRot: [-70, 26, 10],
  chest: [-16, -8, 0],
  head: [28, -12, 0],
  footL: L([-0.32, 0.84, 0.24], [1, 1, 0]),
  footR: L([0.22, 0.66, 0.58], [-1, 1, 0.2]),
  handL: L([0.06, 0.42, -0.2], [1, -0.4, 0]),
  handR: L([0.0, 0.44, -0.16], [-1, -0.4, 0]),
  toeL: [-80, 0],
  toeR: [-80, 0],
  fist: 0.8,
});
const ARMBAR_DEF: Pose = edit(GUARD_TOP, {
  hip: [0, -0.52, -0.4],
  hipRot: [36, 6, 4],
  chest: [32, -8, 8],
  head: [-24, 16, 0],
  handR: L([-0.02, 0.44, 0.2], [-1, 0, 0]),
  handL: L([0.34, 0.08, 0.06], [1, 0.4, 0]),
  fist: 0.5,
});
const subArmbarAtk = loop(0.5, [[0, ARMBAR_ATK], [0.5, edit(ARMBAR_ATK, { hip: add(ARMBAR_ATK.hip, [0, 0.02, 0]), hipRot: rot(ARMBAR_ATK.hipRot, [4, 0, 0]) })], [1, ARMBAR_ATK]], 0.2);
const subArmbarDef = loop(0.5, [[0, ARMBAR_DEF], [0.5, edit(ARMBAR_DEF, { chest: rot(ARMBAR_DEF.chest, [-4, -4, 4]), hip: add(ARMBAR_DEF.hip, [0, 0.01, -0.02]) })], [1, ARMBAR_DEF]], 0.2);

// armbar from mount: the top slides up onto the chest, swings a leg over the face and falls back holding the arm,
// which the bottom keeps bent by gripping the other hand
const ARMBAR_MOUNT_ATK: Pose = edit(MOUNT_TOP, {
  hip: [0, -0.6, 0.3],
  hipRot: [-40, 0, 0],
  chest: [-6, 0, 0],
  head: [20, 0, 0],
  footL: L([0.3, 0.08, 0.74], [0.6, 1, 0.2]),
  footR: L([-0.36, 0.08, 0.06], [-1, 0.4, 0.4]),
  toeL: [-80, 0],
  toeR: [0, -20],
  handL: L([0.1, 0.62, 0.28], [1, -0.3, 0]),
  handR: L([0.18, 0.58, 0.3], [-1, -0.3, 0]),
  fist: 0.8,
});
const ARMBAR_MOUNT_DEF: Pose = edit(MOUNT_BOTTOM, {
  chest: [6, -6, 0],
  head: [20, -14, 0],
  handR: L([-0.12, 0.66, -0.3], [-1, 0, 0.3]),
  handL: L([-0.08, 0.6, -0.34], [1, 0, 0.3]),
  footL: L([0.22, 0.08, 0.4], [0.3, 1, 0.3]),
  footR: L([-0.2, 0.2, 0.44], [-0.3, 1, 0.3]),
});
const subArmbarMountAtk = loop(0.5, [[0, ARMBAR_MOUNT_ATK], [0.5, edit(ARMBAR_MOUNT_ATK, { hipRot: [-44, 0, 0] })], [1, ARMBAR_MOUNT_ATK]], 0.2);
const subArmbarMountDef = loop(0.5, [[0, ARMBAR_MOUNT_DEF], [0.5, edit(ARMBAR_MOUNT_DEF, { chest: [8, -2, 0], hip: add(ARMBAR_MOUNT_DEF.hip, [0, 0.015, 0]) })], [1, ARMBAR_MOUNT_DEF]], 0.2);

// choke from inside the guard (head and arm): the top drops the chest onto the bottom, the head beside the head, the
// arms locked round the neck; the bottom pushes at the hips and turns the chin away
const CHOKE_ATK: Pose = edit(GUARD_TOP, {
  hip: [0, -0.56, -0.28],
  hipRot: [56, 10, 0],
  chest: [26, 10, 0],
  head: [-10, 30, 0],
  handL: L([0.04, 0.26, 0.6], [1, 0.5, 0]),
  handR: L([-0.14, 0.2, 0.62], [-1, 0.5, 0]),
  fist: 0.7,
});
const CHOKE_DEF: Pose = edit(GUARD_BOTTOM, {
  hip: [0, -0.8, 0.02],
  chest: [-6, 0, 0],
  head: [26, -30, 0],
  footL: L([0.24, 0.4, 0.5], [1, 0.6, 0.2]),
  footR: L([-0.24, 0.4, 0.5], [-1, 0.6, 0.2]),
  handL: L([0.18, 0.42, -0.02], [1, -0.2, 0]),
  handR: L([-0.18, 0.4, 0.04], [-1, -0.2, 0]),
  toeL: [-40, -20],
  toeR: [-40, 20],
});
const subChokeAtk = loop(0.6, [[0, CHOKE_ATK], [0.5, edit(CHOKE_ATK, { chest: rot(CHOKE_ATK.chest, [3, 2, 0]), hip: add(CHOKE_ATK.hip, [0, -0.01, 0.01]) })], [1, CHOKE_ATK]], 0.2);
const subChokeDef = loop(0.6, [[0, CHOKE_DEF], [0.5, edit(CHOKE_DEF, { head: [30, -34, 0], hip: add(CHOKE_DEF.hip, [0, 0.01, 0]) })], [1, CHOKE_DEF]], 0.2);

// tapping: the free hand slaps the opponent (or the canvas) fast
const TAP_UP = edit(CHOKE_DEF, { handL: L([0.36, 0.42, 0.12], [1, 0.4, 0]) });
const TAP_DOWN = edit(CHOKE_DEF, { handL: L([0.4, 0.14, 0.1], [1, 0.4, 0]) });
const tapOut = loop(0.36, [[0, TAP_UP], [0.5, TAP_DOWN, 'i'], [1, TAP_UP]], 0.1);
const tapArmbar = loop(0.36, [[0, edit(ARMBAR_DEF, { handL: L([0.34, 0.36, 0.06], [1, 0.4, 0]) })], [0.5, ARMBAR_DEF, 'i'], [1, edit(ARMBAR_DEF, { handL: L([0.34, 0.36, 0.06], [1, 0.4, 0]) })]], 0.1);
const tapArmbarMount = loop(0.36, [[0, edit(ARMBAR_MOUNT_DEF, { handL: L([0.46, 0.4, -0.1], [1, 0.4, 0]) })], [0.5, edit(ARMBAR_MOUNT_DEF, { handL: L([0.5, 0.1, -0.1], [1, 0.4, 0]) }), 'i'], [1, edit(ARMBAR_MOUNT_DEF, { handL: L([0.46, 0.4, -0.1], [1, 0.4, 0]) })]], 0.1);

// ---- takedowns ------------------------------------------------------------------------------------------------------

// double leg: drive through with the head on the hip and the arms round the thighs, lift, then follow them down
const tdDrive = edit(shootDrive, { hip: [0, -0.42, -0.34], hipRot: [44, 0, 0], chest: [24, 0, 0], head: [-34, 18, 0], handL: L([0.2, 0.56, 0.18], [1, 0, -0.2]), handR: L([-0.2, 0.56, 0.18], [-1, 0, -0.2]), footL: L([0.16, 0.08, -0.12], [0.2, 0, 1]), footR: L([-0.18, 0.1, -0.7], [0, -0.3, 1]) });
const tdLift = edit(tdDrive, { hip: [0, -0.34, -0.24], hipRot: [36, 0, 0], chest: [18, 0, 0], handL: L([0.2, 0.74, 0.2], [1, 0, -0.2]), handR: L([-0.2, 0.74, 0.2], [-1, 0, -0.2]), footL: L([0.16, 0.08, 0.0], [0.2, 0, 1]), footR: L([-0.18, 0.1, -0.5], [0, -0.3, 1]) });
const tdLand = edit(GUARD_TOP, { hip: [0, -0.5, -0.3], hipRot: [46, 0, 0], chest: [30, 0, 0], head: [-36, 0, 0], handL: L([0.2, 0.3, 0.2], [1, 0.2, -0.4]), handR: L([-0.2, 0.3, 0.2], [-1, 0.2, -0.4]) });
const takedownTop = once([[0, tdDrive], [0.3, tdLift], [0.62, tdLand, 'i'], [1, GUARD_TOP, 's']], undefined, 0.08);
// taken off the feet: legs gathered, falling back, the back slapping the canvas, legs coming up into the guard
const tdCaught = st({ hip: [0, -0.05, -0.04], hipRot: [-10, 0, 0], chest: [-6, 0, 0], head: [10, 0, 0], handL: L([0.22, 1.0, 0.34], [1, -0.4, -0.3]), handR: L([-0.22, 1.0, 0.34], [-1, -0.4, -0.3]), footL: L([0.1, 0.075, 0.08], [0.1, 0, 1]), footR: L([-0.1, 0.075, -0.04], [-0.1, 0, 1]), toeL: [0, 0], toeR: [0, 0] });
const tdTip = edit(tdCaught, { hip: [0, -0.18, -0.1], hipRot: [-38, 0, 0], chest: [-10, 0, 0], head: [24, 0, 0], footL: L([0.12, 0.3, 0.3], [0.3, 0.5, 1]), footR: L([-0.12, 0.28, 0.24], [-0.3, 0.5, 1]), handL: L([0.4, 0.86, -0.1], [1, 0, 0]), handR: L([-0.4, 0.86, -0.12], [-1, 0, 0]) });
const tdBack = edit(GUARD_BOTTOM, { hip: [0, -0.79, -0.04], hipRot: [-82, 0, 0], head: [36, 0, 0], handL: L([0.46, 0.1, -0.3], [1, 0.2, 0]), handR: L([-0.46, 0.1, -0.32], [-1, 0.2, 0]), footL: L([0.24, 0.5, 0.5], [1, 0.6, 0]), footR: L([-0.24, 0.5, 0.5], [-1, 0.6, 0]) });
const takedownBottom = once([[0, tdCaught], [0.3, tdTip, 's'], [0.62, tdBack, 'i'], [0.74, edit(tdBack, { chest: [-6, 0, 0], head: [40, 0, 0] }), 'o'], [1, GUARD_BOTTOM]], undefined, 0.06);


// ---- the clinch ---------------------------------------------------------------------------------------------------
// Chest to chest, about half a metre apart (fightScene pulls the pair together): squared up, foreheads close. The
// fighter in control has both hands behind the other's neck (a collar tie), elbows in on their chest; the one held is
// bent over with forearms framing on the other's arms and hips, looking for a way out.

const CL_FEET = { footL: L([0.15, 0.075, 0.16], [0.2, 0, 1]), footR: L([-0.17, 0.075, -0.3], [-0.1, 0, 1]), toeL: [4, -8] as [number, number], toeR: [10, 20] as [number, number] };
const CLINCH_CTL = st({
  ...CL_FEET,
  hip: [0.03, -0.1, -0.04],
  hipRot: [10, -12, 0],
  chest: [16, 6, 0],
  head: [6, 16, 6],
  handL: L([0.08, 1.31, 0.45], [0.4, -1, 0.1]),
  handR: L([-0.08, 1.32, 0.45], [-0.4, -1, 0.1]),
  wristL: 80,
  wristR: 80,
  fist: 0.3,
  shrugL: 10,
  shrugR: 10,
});
const CLINCH_HELD = st({
  ...CL_FEET,
  hip: [-0.03, -0.14, -0.07],
  hipRot: [16, -8, 0],
  chest: [22, -4, 0],
  head: [14, -14, -6],
  handL: L([0.22, 1.0, 0.28], [1, -0.4, -0.2]),
  handR: L([-0.2, 0.98, 0.28], [-1, -0.4, -0.2]),
  wristL: 60,
  wristR: 60,
  fist: 0.4,
  shrugL: 12,
  shrugR: 12,
});
const sway = (p: Pose, k: number): Clip =>
  cycle(1.4, 12, ph => edit(p, { hip: add(p.hip, [0.012 * Math.sin(TAU * ph) * k, 0.006 * Math.sin(TAU * 2 * ph), 0]), chest: rot(p.chest, [1.5 * Math.sin(TAU * 2 * ph), 3 * Math.sin(TAU * ph) * k, 0]) }), 0.12);
const clinchHold = sway(CLINCH_CTL, 1);
const clinchHeld = sway(CLINCH_HELD, -1);

// the grab: a step in with both hands reaching for the back of the neck
const grabReach = st({ hip: add(S.hip, [0, -0.05, 0.12]), hipRot: [8, -16, 0], chest: [18, 4, 0], head: [6, 6, 0], handL: L([0.11, 1.46, 0.62], [0.6, -0.6, 0]), handR: L([-0.11, 1.47, 0.6], [-0.6, -0.6, 0]), footL: L(add(S.footL.p, [0, 0, 0.12]), S.footL.pole), wristL: 70, wristR: 70, fist: 0.2 });
const clinchEnter = once([[0, S], [0.44, grabReach, 'i'], [0.6, grabReach], [1, S, 'o']], 0.44, 0.05);

// swimming for position: the arms fight for the inside, one under and one over, then the other way round
const pummelA = edit(CLINCH_HELD, { handL: L([0.14, 1.12, 0.4], [1, -0.6, 0]), handR: L([-0.1, 1.42, 0.36], [-0.8, -1, 0.2]), chest: [20, 8, 0] });
const pummelB = edit(CLINCH_HELD, { handR: L([-0.14, 1.12, 0.4], [-1, -0.6, 0]), handL: L([0.1, 1.42, 0.36], [0.8, -1, 0.2]), chest: [20, -8, 0] });
const clinchPummel = loop(0.5, [[0, pummelA], [0.5, pummelB], [1, pummelA]], 0.08);

// pushing off and stepping back to range
const pushOff = st({ hip: add(S.hip, [0, -0.04, -0.08]), hipRot: [6, -20, 0], chest: [8, 6, 0], handL: L([0.14, 1.36, 0.56], [0.6, -1, 0]), handR: L([-0.12, 1.36, 0.54], [-0.6, -1, 0]), wristL: 85, wristR: 85, fist: 0.2, footR: L(add(S.footR.p, [0, 0, -0.08]), S.footR.pole) });
const clinchBreak = once([[0, CLINCH_CTL], [0.3, pushOff, 'o'], [1, S]], undefined, 0.06);

// knee to the body: pull the head down, drive the hips through and the rear knee up into the stomach
const kneeCock = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0, 0.01, -0.04]), footR: L([-0.1, 0.42, -0.18], [-0.1, 0.4, 1]), toeR: [40, 10], handL: L([0.07, 1.3, 0.42], [0.3, -1, 0.2]), handR: L([-0.07, 1.3, 0.42], [-0.3, -1, 0.2]) });
const kneeIn = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0, 0.05, 0.08]), hipRot: [-6, -6, 0], chest: [14, 2, 0], footR: L([-0.04, 0.58, 0.3], [0, 0.3, 1]), toeR: [50, 0], handL: L([0.07, 1.24, 0.42], [0.3, -1, 0.2]), handR: L([-0.07, 1.24, 0.42], [-0.3, -1, 0.2]) });
const clinchKnee = once([[0, CLINCH_CTL], [0.2, kneeCock, 'o'], [0.36, kneeIn, 'i'], [0.5, kneeIn], [1, CLINCH_CTL, 's']], 0.36, 0.05);

// knee to the head: both hands drag the head down hard, the knee comes up to meet it
const kneeHeadIn = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0, 0.08, 0.06]), hipRot: [-10, -4, 0], chest: [8, 0, 0], head: [20, 0, 0], footR: L([-0.03, 0.82, 0.26], [0, 0.6, 1]), toeR: [60, 0], handL: L([0.07, 1.12, 0.38], [0.3, -1, 0.3]), handR: L([-0.07, 1.12, 0.38], [-0.3, -1, 0.3]) });
const clinchKneeHead = once([[0, CLINCH_CTL], [0.24, edit(kneeCock, { footR: L([-0.12, 0.5, -0.22], [-0.1, 0.4, 1]) }), 'o'], [0.38, kneeHeadIn, 'i'], [0.52, kneeHeadIn], [1, CLINCH_CTL, 's']], 0.38, 0.05);

// short elbow: the rear arm folds tight and the shoulders turn, the point of the elbow across the brow
const elbowCock = edit(CLINCH_CTL, { chest: [20, -10, 0], hipRot: [10, -20, 0], handR: L([-0.24, 1.46, 0.08], [-1, 0.2, -0.2]) });
const elbowIn = edit(CLINCH_CTL, { chest: [18, 30, 6], hipRot: [8, 10, 0], head: [10, -14, 0], handR: L([0.12, 1.52, 0.1], [-0.2, 0.2, 1]), wristR: 0, fist: 0.9 });
const clinchElbow = once([[0, CLINCH_CTL], [0.2, elbowCock, 'o'], [0.36, elbowIn, 'i'], [0.5, elbowIn], [1, CLINCH_CTL, 's']], 0.36, 0.05);

// uppercut in close: dip, then the rear fist comes straight up between the arms
const upDip = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0, -0.05, 0]), chest: [26, -10, -6], handR: L([-0.1, 1.12, 0.2], [-0.3, -1, -0.2]), fist: 0.9 });
const upIn = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0, 0.02, 0.03]), chest: [14, 18, 4], hipRot: [8, 4, 0], handR: L([-0.02, 1.47, 0.32], [-0.3, -1, 0]), wristR: 90, fist: 0.9 });
const clinchUpper = once([[0, CLINCH_CTL], [0.18, upDip, 'o'], [0.35, upIn, 'i'], [0.48, upIn], [1, CLINCH_CTL, 's']], 0.35, 0.05);

// the trip: the lead foot steps deep behind their lead leg, then the upper body turns and pulls them over it
const tripStep = edit(CLINCH_CTL, { hip: add(CLINCH_CTL.hip, [0.04, -0.04, 0.12]), hipRot: [12, -30, 0], chest: [24, -20, 0], footL: L([0.26, 0.08, 0.52], [0.4, 0, 1]), toeL: [0, -30] });
const tripTurn = edit(tripStep, { hip: add(tripStep.hip, [0, -0.12, 0]), hipRot: [16, -50, 0], chest: [26, -55, -10], head: [16, -30, 0], handL: L([-0.04, 1.2, 0.32], [0.6, -1, 0]), handR: L([-0.26, 1.24, 0.24], [-0.6, -1, 0]) });
const clinchTrip = once([[0, CLINCH_CTL], [0.45, tripStep, 's'], [0.9, tripTurn, 'i'], [1, tripTurn]], 0.94, 0.06);

/** Clips by action id. */
export const CLIPS: Record<ActionId, Clip> = {
  idle,
  walkFwd,
  walkBack,
  jab,
  cross,
  hookL,
  hookR,
  uppercut,
  bodyShot,
  lowKick,
  bodyKick,
  headKick,
  superman,
  flyingKnee,
  spinBackfist,
  block,
  blockHit,
  slipL,
  slipR,
  swayBack,
  hitHeadL,
  hitHeadR,
  hitHeadHeavy,
  hitBody,
  hitLeg,
  stunned,
  hurtBody,
  knockdown,
  downed,
  getUp,
  shoot,
  sprawl,
  takedownTop,
  takedownBottom,
  taunt,
  victory,
  defeat,
  walkout,
  gndGuardTop,
  gndGuardBottom,
  gndMountTop,
  gndMountBottom,
  gndPound,
  gndPoundHit,
  gndBlock,
  gndAdvance,
  gndEscape,
  gndStandUp,
  subChokeAtk,
  subChokeDef,
  subArmbarAtk,
  subArmbarDef,
  tapOut,
  clinchEnter,
  clinchHold,
  clinchHeld,
  clinchPummel,
  clinchBreak,
  clinchTrip,
  clinchKnee,
  clinchKneeHead,
  clinchElbow,
  clinchUpper,
};

/** Where a fighter is on the ground (remembered by the animator to pick the right variant of a clip). */
export type GroundRole = 'guardTop' | 'guardBottom' | 'mountTop' | 'mountBottom' | null;

/** The role after `action` starts. */
export function roleAfter(action: ActionId, role: GroundRole): GroundRole {
  switch (action) {
    case 'gndGuardTop':
    case 'takedownTop':
      return 'guardTop';
    case 'gndGuardBottom':
    case 'takedownBottom':
    case 'gndEscape':
      return 'guardBottom';
    case 'gndMountTop':
    case 'gndAdvance':
      return 'mountTop';
    case 'gndMountBottom':
      return 'mountBottom';
    case 'gndPound':
    case 'gndPoundHit':
    case 'gndBlock':
    case 'subChokeAtk':
    case 'subChokeDef':
    case 'subArmbarAtk':
    case 'subArmbarDef':
    case 'tapOut':
      return role;
    default:
      return null;
  }
}

/** Variant names for the lab (they are not simulation actions). */
export const VARIANT_CLIPS = {
  gndPoundGuard,
  gndPoundHitGuard,
  gndBlockGuard,
  subArmbarMountAtk,
  subArmbarMountDef,
  tapArmbar,
  tapArmbarMount,
  gndStandUpBottom,
  getUpShot,
} as const;
export type VariantId = keyof typeof VARIANT_CLIPS;

/** The clip for `action`, given what the fighter was doing (`prev`) and where it is on the ground (`role`). */
export function pickClip(action: ActionId, prev: ActionId | null, role: GroundRole): Clip {
  switch (action) {
    case 'gndPound':
      return role === 'guardTop' ? gndPoundGuard : gndPound;
    case 'gndPoundHit':
      return role === 'guardBottom' ? gndPoundHitGuard : gndPoundHit;
    case 'gndBlock':
      return role === 'guardBottom' ? gndBlockGuard : gndBlock;
    case 'subArmbarAtk':
      return role === 'mountTop' ? subArmbarMountAtk : subArmbarAtk;
    case 'subArmbarDef':
      return role === 'mountBottom' ? subArmbarMountDef : subArmbarDef;
    case 'tapOut':
      if (prev === 'subArmbarDef') return role === 'mountBottom' ? tapArmbarMount : tapArmbar;
      return tapOut;
    case 'gndStandUp':
      return role === 'guardBottom' || role === 'mountBottom' ? gndStandUpBottom : gndStandUp;
    case 'getUp':
      return prev === 'shoot' ? getUpShot : getUp;
    default:
      return CLIPS[action];
  }
}

function ease(e: Ease, t: number): number {
  switch (e) {
    case 's':
      return t * t * (3 - 2 * t);
    case 'i':
      return t * t;
    case 'o':
      return 1 - (1 - t) * (1 - t);
    case 'l':
      return t;
  }
}

/** Sample a clip at normalised time u (0..1); loops wrap. `out` must own its arrays (clonePose). */
export function sampleClip(c: Clip, u: number, out: Pose, mix: (a: Pose, b: Pose, t: number, out?: Pose) => Pose): Pose {
  const k = c.keys;
  if (c.loop > 0) u = u - Math.floor(u);
  else u = Math.min(1, Math.max(0, u));
  if (u <= k[0][0]) return mix(k[0][1], k[0][1], 0, out);
  for (let i = 1; i < k.length; i++) {
    const key = k[i];
    if (u <= key[0]) {
      const prev = k[i - 1];
      const t = (u - prev[0]) / Math.max(1e-6, key[0] - prev[0]);
      return mix(prev[1], key[1], ease(key[2] ?? 's', t), out);
    }
  }
  const last = k[k.length - 1][1];
  return mix(last, last, 0, out);
}
