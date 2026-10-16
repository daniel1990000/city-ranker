// Every fighter animation, one clip per simulation ActionId (docs/ARCHITECTURE.md). A clip is a few key poses on a
// 0..1 timeline; attack clips carry `impact` (the time the strike lands), which the animator lines up with the
// simulation's first active tick. Poses are authored in character space for the 1.747 m base male: x = the fighter's
// left, y = up, z = toward the opponent. Ground clips are paired: both fighters stand on one anchor and face each
// other, so a point p in one fighter's space is (-x, y, -z) in the other's.

import type { ActionId } from '../../game/fight/types';
import { RELAXED, STANCE, edit } from './poses';
import type { LimbTarget, Pose, Rot, V3 } from './rig';

export interface Clip {
  keys: readonly (readonly [number, Pose])[];
  /** Loops on wall-clock time with this period (s); 0 = driven by the simulation's action progress. */
  loop: number;
  /** 0..1: when the strike lands. */
  impact?: number;
  /** Crossfade into this clip (s). */
  blendIn: number;
}

const L = (p: V3, pole: V3): LimbTarget => ({ p, pole });
const S = STANCE;
const GUARD_L = S.handL;
const GUARD_R = S.handR;
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const rot = (r: Rot, d: Rot): Rot => [r[0] + d[0], r[1] + d[1], r[2] + d[2]];

/** A key pose built as an edit of the stance. */
const st = (c: Partial<Pose>): Pose => edit(S, c);

const once = (keys: [number, Pose][], impact?: number, blendIn = 0.06): Clip => ({ keys, loop: 0, impact, blendIn });
const loop = (period: number, keys: [number, Pose][], blendIn = 0.15): Clip => ({ keys, loop: period, blendIn });

// ---- standing --------------------------------------------------------------------------------------------------

const bounceUp = st({ hip: add(S.hip, [0, 0.018, 0.01]), handL: L(add(GUARD_L.p, [0, 0.015, 0]), GUARD_L.pole), handR: L(add(GUARD_R.p, [0, 0.012, 0]), GUARD_R.pole), toeL: [8, -12], toeR: [16, 38] });
const idle = loop(0.9, [
  [0, S],
  [0.5, bounceUp],
  [1, S],
]);

const stepFwd = st({ hip: add(S.hip, [0, 0.01, 0.05]), footL: L(add(S.footL.p, [0, 0.05, 0.1]), S.footL.pole), toeL: [-8, -12] });
const dragFwd = st({ hip: add(S.hip, [0, -0.005, 0.04]), footR: L(add(S.footR.p, [0, 0.04, 0.1]), S.footR.pole), toeR: [20, 38] });
const walkFwd = loop(0.55, [
  [0, S],
  [0.3, stepFwd],
  [0.65, dragFwd],
  [1, S],
]);
const stepBack = st({ hip: add(S.hip, [0, 0.01, -0.05]), footR: L(add(S.footR.p, [0, 0.05, -0.1]), S.footR.pole), toeR: [12, 38] });
const dragBack = st({ hip: add(S.hip, [0, -0.005, -0.04]), footL: L(add(S.footL.p, [0, 0.04, -0.1]), S.footL.pole), toeL: [10, -12] });
const walkBack = loop(0.6, [
  [0, S],
  [0.3, stepBack],
  [0.65, dragBack],
  [1, S],
]);

// jab: lead hand snaps straight out, lead shoulder turns in, chin behind it
const jabOut = st({
  hip: add(S.hip, [0, 0, 0.04]),
  hipRot: rot(S.hipRot, [2, -6, 0]),
  chest: rot(S.chest, [4, -12, 0]),
  head: rot(S.head, [2, 10, 0]),
  handL: L([0.04, 1.43, 0.7], [0.4, -0.4, 0]),
  wristL: -5,
  shrugL: 14,
});
const jab = once([[0, S], [0.42, jabOut], [0.6, jabOut], [1, S]], 0.42);

// cross: rear hand, hips and shoulders turn square, rear heel up
const crossOut = st({
  hip: add(S.hip, [0, 0, 0.07]),
  hipRot: rot(S.hipRot, [4, 34, 0]),
  chest: rot(S.chest, [6, 12, 0]),
  head: rot(S.head, [4, -26, 0]),
  handR: L([0.02, 1.43, 0.74], [-0.4, -0.4, 0]),
  handL: L([0.07, 1.4, 0.24], ELBOW_IN_L()),
  wristR: -5,
  toeR: [34, 20],
  footR: L(add(S.footR.p, [0, 0.02, 0.04]), S.footR.pole),
  shrugR: 14,
});
const cross = once([[0, S], [0.45, crossOut], [0.6, crossOut], [1, S]], 0.45);
function ELBOW_IN_L(): V3 {
  return [0.5, -1, -0.1];
}

// lead hook: elbow up level with the fist, hips turn hard to the right
const hookLWind = st({ hipRot: rot(S.hipRot, [0, 10, 0]), handL: L([0.3, 1.38, 0.3], [1, 0.3, -0.4]), chest: rot(S.chest, [0, 8, 0]) });
const hookLOut = st({
  hipRot: rot(S.hipRot, [3, -24, 0]),
  chest: rot(S.chest, [6, -30, 0]),
  head: rot(S.head, [0, 22, 0]),
  handL: L([-0.04, 1.42, 0.52], [1, 0.55, -0.2]),
  wristL: -10,
  toeL: [20, -40],
  shrugL: 10,
});
const hookL = once([[0, S], [0.22, hookLWind], [0.48, hookLOut], [0.62, hookLOut], [1, S]], 0.48);

// rear hook
const hookRWind = st({ hipRot: rot(S.hipRot, [0, -6, 0]), handR: L([-0.32, 1.38, 0.18], [-1, 0.3, -0.4]) });
const hookROut = st({
  hipRot: rot(S.hipRot, [3, 40, 0]),
  chest: rot(S.chest, [6, 26, 0]),
  head: rot(S.head, [0, -22, 0]),
  handR: L([0.12, 1.4, 0.56], [-1, 0.2, -0.35]),
  handL: L([0.08, 1.4, 0.22], ELBOW_IN_L()),
  wristR: -10,
  toeR: [34, 10],
  shrugR: 10,
});
const hookR = once([[0, S], [0.22, hookRWind], [0.5, hookROut], [0.62, hookROut], [1, S]], 0.5);

// rear uppercut: dip, then drive up through the chin
const upperDip = st({ hip: add(S.hip, [0, -0.07, 0]), hipRot: rot(S.hipRot, [6, -6, 0]), chest: rot(S.chest, [10, -10, -8]), handR: L([-0.1, 1.12, 0.24], [-0.3, -1, -0.2]) });
const upperOut = st({
  hip: add(S.hip, [0, 0.03, 0.05]),
  hipRot: rot(S.hipRot, [-2, 28, 0]),
  chest: rot(S.chest, [-4, 18, 0]),
  head: rot(S.head, [-2, -20, 0]),
  handR: L([0.03, 1.46, 0.56], [-0.3, -1, 0]),
  wristR: 90,
  toeR: [30, 20],
});
const uppercut = once([[0, S], [0.28, upperDip], [0.5, upperOut], [0.62, upperOut], [1, S]], 0.5);

// lead hook to the body: drop the level, dig under the elbow
const bodyOut = st({
  hip: add(S.hip, [0.04, -0.13, 0.05]),
  hipRot: rot(S.hipRot, [10, -16, 0]),
  chest: rot(S.chest, [14, -26, -12]),
  head: rot(S.head, [-10, 18, 0]),
  handL: L([0.0, 1.06, 0.5], [1, 0.25, -0.3]),
  // the rear glove stays on the (lowered) cheek
  handR: L([-0.1, 1.22, 0.3], ELBOW_R()),
  wristL: 10,
});
const bodyShot = once([[0, S], [0.47, bodyOut], [0.6, bodyOut], [1, S]], 0.47);
function ELBOW_R(): V3 {
  return [-0.6, -1, -0.15];
}

// rear low kick: pivot on the lead foot, the shin swings into the thigh
const lowChamber = st({ hipRot: rot(S.hipRot, [0, 20, 0]), footR: L([-0.08, 0.42, 0.02], [0, 0.4, 1]), toeL: [0, -40], toeR: [30, 30], handR: L([-0.28, 1.1, 0.0], [-0.5, -1, 0]) });
const lowOut = st({
  hip: add(S.hip, [0, 0.02, 0.06]),
  hipRot: [-6, 38, 6],
  chest: [6, 0, -8],
  head: [0, -18, 0],
  footR: L([0.22, 0.42, 0.52], [0.3, 0.4, 1]),
  footL: L(S.footL.p, [0.1, 0, 1]),
  toeL: [0, -70],
  toeR: [40, 60],
  handR: L([-0.38, 1.05, -0.12], [-0.4, -1, 0]),
  handL: L([0.1, 1.42, 0.3], [0.6, -1, -0.1]),
});
const lowKick = once([[0, S], [0.3, lowChamber], [0.5, lowOut], [0.62, lowOut], [1, S]], 0.5);

const bodyChamber = st({ hipRot: rot(S.hipRot, [0, 30, -6]), footR: L([-0.06, 0.55, 0.1], [0, 0.7, 1]), toeL: [0, -45], toeR: [30, 40] });
const bodyKickOut = st({
  hip: add(S.hip, [0, 0.04, 0.03]),
  hipRot: [-14, 62, 18],
  chest: [-4, -6, -14],
  head: [4, -40, 10],
  footR: L([0.16, 0.98, 0.66], [0, 1, 0.3]),
  footL: L(S.footL.p, [0.2, 0, 1]),
  toeL: [0, -90],
  toeR: [50, 70],
  handR: L([-0.42, 1.0, -0.1], [-0.4, -1, 0]),
  handL: L([0.06, 1.46, 0.24], [0.6, -1, -0.1]),
});
const bodyKick = once([[0, S], [0.32, bodyChamber], [0.5, bodyKickOut], [0.64, bodyKickOut], [1, S]], 0.5);

const headChamber = st({ hipRot: rot(S.hipRot, [-6, 34, -8]), footR: L([-0.04, 0.7, 0.12], [0, 1, 0.6]), toeL: [0, -50], toeR: [30, 40] });
const headKickOut = st({
  hip: add(S.hip, [0, 0.05, 0.0]),
  hipRot: [-28, 74, 30],
  chest: [-14, -8, -18],
  head: [10, -48, 16],
  footR: L([0.1, 1.5, 0.62], [0, 1, 0]),
  footL: L(S.footL.p, [0.2, 0, 1]),
  toeL: [0, -100],
  toeR: [55, 70],
  handR: L([-0.46, 0.98, -0.16], [-0.4, -1, 0]),
  handL: L([0.04, 1.5, 0.18], [0.6, -1, -0.1]),
});
const headKick = once([[0, S], [0.36, headChamber], [0.55, headKickOut], [0.68, headKickOut], [1, S]], 0.55);

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
const superman = once([[0, S], [0.42, supermanHop], [0.62, supermanOut], [0.72, supermanOut], [1, S]], 0.62);

// flying knee: jump off the lead leg, drive the rear knee up into the head, hands pull down
const kneeJump = st({ hip: add(S.hip, [0, 0.18, 0.08]), footL: L([0.12, 0.25, 0.18], S.footL.pole), footR: L([-0.1, 0.4, -0.3], [0, 0, 1]), hipRot: rot(S.hipRot, [0, 20, 0]) });
const kneeOut = st({
  hip: add(S.hip, [0, 0.3, 0.14]),
  hipRot: [-6, 20, 0],
  chest: [-6, 0, 0],
  head: [8, -10, 0],
  footR: L([-0.04, 0.85, 0.12], [0, 0.6, 1]),
  footL: L([0.14, 0.35, -0.2], [0, -0.2, 1]),
  handL: L([0.08, 1.52, 0.52], [0.6, -0.6, 0]),
  handR: L([-0.08, 1.52, 0.52], [-0.6, -0.6, 0]),
  toeR: [50, 0],
  toeL: [40, 0],
});
const flyingKnee = once([[0, S], [0.45, kneeJump], [0.66, kneeOut], [0.76, kneeOut], [1, S]], 0.66);

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
const spinBackfist = once([[0, S], [0.3, spinHalf], [0.55, spinOut], [0.66, spinOut], [1, edit(S, { hipRot: [S.hipRot[0], S.hipRot[1] - 360, 0] })]], 0.55);

// defence
const blockPose = st({
  hip: add(S.hip, [0, -0.02, -0.02]),
  chest: rot(S.chest, [8, 0, 0]),
  head: [14, 14, 0],
  handL: L([0.09, 1.43, 0.23], [0.4, -1, 0.2]),
  handR: L([-0.05, 1.44, 0.17], [-0.4, -1, 0.2]),
  wristL: 85,
  wristR: 85,
  shrugL: 14,
  shrugR: 14,
});
const block = loop(1.2, [
  [0, blockPose],
  [0.5, edit(blockPose, { hip: add(blockPose.hip, [0, 0.01, 0]) })],
  [1, blockPose],
], 0.06);
const blockHitPose = edit(blockPose, { hip: add(blockPose.hip, [0, -0.02, -0.08]), chest: rot(blockPose.chest, [-8, 0, 0]), head: rot(blockPose.head, [-8, 0, 0]) });
const blockHit = once([[0, blockPose], [0.25, blockHitPose], [1, blockPose]], undefined, 0.03);

const slipLPose = st({ hip: add(S.hip, [0.07, -0.09, 0]), hipRot: rot(S.hipRot, [6, 0, 6]), chest: rot(S.chest, [12, 4, 20]), head: rot(S.head, [4, 0, 10]) });
const slipL = once([[0, S], [0.35, slipLPose], [0.6, slipLPose], [1, S]], undefined, 0.04);
const slipRPose = st({ hip: add(S.hip, [-0.07, -0.09, 0]), hipRot: rot(S.hipRot, [6, 0, -6]), chest: rot(S.chest, [12, -4, -20]), head: rot(S.head, [4, 0, -10]) });
const slipR = once([[0, S], [0.35, slipRPose], [0.6, slipRPose], [1, S]], undefined, 0.04);
const swayPose = st({ hip: add(S.hip, [0, -0.02, -0.12]), chest: rot(S.chest, [-26, 0, 0]), head: rot(S.head, [-6, 0, 0]), footL: L(add(S.footL.p, [0, 0, -0.06]), S.footL.pole) });
const swayBack = once([[0, S], [0.35, swayPose], [0.6, swayPose], [1, S]], undefined, 0.04);

// getting hit
const snapL = st({ chest: rot(S.chest, [-6, 18, 10]), head: [-14, 46, 22], hip: add(S.hip, [0, -0.02, -0.04]), handR: L([-0.16, 1.3, 0.1], ELBOW_R()), handL: L([0.24, 1.3, 0.26], [0.6, -1, 0]) });
const hitHeadL = once([[0, S], [0.18, snapL], [1, S]], undefined, 0.02);
const snapR = st({ chest: rot(S.chest, [-6, -18, -10]), head: [-14, -24, -22], hip: add(S.hip, [0, -0.02, -0.04]), handL: L([0.26, 1.28, 0.24], [0.6, -1, 0]) });
const hitHeadR = once([[0, S], [0.18, snapR], [1, S]], undefined, 0.02);
const rocked = st({
  hip: add(S.hip, [0, -0.08, -0.12]),
  hipRot: rot(S.hipRot, [-12, 0, 6]),
  chest: rot(S.chest, [-24, 10, 8]),
  head: [-34, 30, 18],
  handL: L([0.36, 1.18, 0.14], [0.6, -1, -0.4]),
  handR: L([-0.36, 1.12, 0.06], [-0.6, -1, -0.4]),
  fist: 0.4,
  toeL: [18, -12],
});
const hitHeadHeavy = once([[0, S], [0.18, rocked], [0.55, edit(rocked, { head: [-10, 16, 8] })], [1, S]], undefined, 0.02);
const fold = st({ hip: add(S.hip, [0, -0.06, -0.08]), chest: rot(S.chest, [28, 0, 0]), head: rot(S.head, [10, 0, 0]), handL: L([0.1, 1.15, 0.22], [0.6, -1, 0]), handR: L([-0.1, 1.15, 0.18], [-0.6, -1, 0]) });
const hitBody = once([[0, S], [0.2, fold], [0.5, fold], [1, S]], undefined, 0.02);
const buckle = st({ hip: add(S.hip, [0.04, -0.1, -0.02]), hipRot: rot(S.hipRot, [0, 0, 10]), footL: L(add(S.footL.p, [-0.06, 0.08, -0.04]), [-0.6, 0, 1]), toeL: [20, 10], chest: rot(S.chest, [6, 0, 6]) });
const hitLeg = once([[0, S], [0.2, buckle], [0.55, buckle], [1, S]], undefined, 0.02);

const woozy = st({ hip: add(S.hip, [0, -0.05, -0.03]), chest: rot(S.chest, [4, 0, 6]), head: [16, 10, 14], handL: L([0.2, 1.24, 0.22], [0.6, -1, 0]), handR: L([-0.16, 1.22, 0.14], ELBOW_R()), fist: 0.6 });
const stunned = loop(1.6, [
  [0, woozy],
  [0.5, edit(woozy, { chest: rot(woozy.chest, [0, 0, -12]), head: [20, 0, -16], hip: add(woozy.hip, [-0.04, -0.02, 0]) })],
  [1, woozy],
], 0.1);

// on the canvas, face up
const LYING: Pose = {
  hip: [0, -0.8, -0.05],
  hipRot: [-88, 0, 0],
  chest: [0, 0, 0],
  head: [8, 20, 0],
  handL: L([0.48, 0.08, -0.25], [1, 0.2, 0]),
  handR: L([-0.46, 0.08, -0.35], [-1, 0.2, 0]),
  wristL: 60,
  wristR: 60,
  footL: L([0.2, 0.09, 0.8], [0.2, 1, 0]),
  footR: L([-0.16, 0.09, 0.78], [-0.2, 1, 0]),
  toeL: [-60, 10],
  toeR: [-60, -10],
  fist: 0.2,
  shrugL: 0,
  shrugR: 0,
};
const falling = edit(rocked, { hip: [0, -0.42, -0.18], hipRot: [-40, 0, 10], chest: [-30, 10, 8], head: [-30, 20, 0], handL: L([0.5, 0.9, -0.1], [1, 0, 0]), handR: L([-0.5, 0.9, -0.15], [-1, 0, 0]), footL: L([0.15, 0.1, 0.35], [0.2, 0.5, 1]), footR: L([-0.15, 0.1, 0.3], [-0.2, 0.5, 1]), fist: 0.2 });
const knockdown = once([[0, rocked], [0.4, falling], [0.8, LYING], [1, LYING]], undefined, 0.03);
const downed = loop(2.4, [
  [0, LYING],
  [0.5, edit(LYING, { head: [2, 10, 0], hip: [0, -0.79, -0.05], handR: L([-0.4, 0.1, -0.2], [-1, 0.2, 0]) })],
  [1, LYING],
], 0.2);
const SITTING: Pose = edit(LYING, { hip: [0, -0.78, 0.0], hipRot: [-20, 0, 0], chest: [10, 0, 0], head: [10, 0, 0], handL: L([0.32, 0.12, -0.25], [1, 0.5, 0]), handR: L([-0.32, 0.12, -0.25], [-1, 0.5, 0]), footL: L([0.2, 0.08, 0.55], [0.2, 1, 0.3]), footR: L([-0.2, 0.08, 0.5], [-0.2, 1, 0.3]) });
const CROUCH: Pose = st({ hip: [0, -0.42, -0.05], hipRot: [30, -10, 0], chest: [30, 0, 0], head: [-20, 0, 0], handL: L([0.25, 0.5, 0.4], [1, 0, 0]), handR: L([-0.22, 0.5, 0.35], [-1, 0, 0]), footL: L([0.16, 0.08, 0.28], [0.2, 0.3, 1]), footR: L([-0.17, 0.08, -0.2], [-0.1, 0.3, 1]), toeR: [30, 30] });
const getUp = once([[0, LYING], [0.3, SITTING], [0.65, CROUCH], [1, S]], undefined, 0.1);

// takedown shot and the sprawl
const shootDip = st({ hip: [0, -0.32, 0.05], hipRot: [30, -15, 0], chest: [30, 5, 0], head: [-30, 5, 0], handL: L([0.2, 0.88, 0.55], [1, -0.5, 0]), handR: L([-0.2, 0.88, 0.5], [-1, -0.5, 0]), footL: L([0.13, 0.08, 0.45], [0.2, 0, 1]), footR: L([-0.17, 0.1, -0.35], [-0.1, 0, 1]), toeR: [40, 20], fist: 0.3 });
const shootDrive = edit(shootDip, { hip: [0, -0.4, 0.28], hipRot: [45, -5, 0], chest: [30, 0, 0], head: [-35, 0, 0], handL: L([0.24, 0.72, 0.85], [1, 0, 0]), handR: L([-0.24, 0.72, 0.85], [-1, 0, 0]), footL: L([0.14, 0.08, 0.25], [0.2, -0.5, 1]), footR: L([-0.18, 0.1, -0.5], [0, -0.5, 1]) });
const shoot = once([[0, S], [0.35, shootDip], [0.7, shootDrive], [1, shootDrive]], 0.7, 0.05);
const sprawlDown = st({ hip: [0, -0.62, -0.32], hipRot: [70, 0, 0], chest: [10, 0, 0], head: [-50, 0, 0], handL: L([0.24, 0.5, 0.42], [1, 0.4, 0]), handR: L([-0.24, 0.5, 0.42], [-1, 0.4, 0]), footL: L([0.22, 0.1, -0.95], [0, -1, 0]), footR: L([-0.22, 0.1, -1.0], [0, -1, 0]), toeL: [-10, 0], toeR: [-10, 0] });
const sprawl = once([[0, S], [0.25, sprawlDown], [0.7, sprawlDown], [1, S]], undefined, 0.04);

const taunt = once([
  [0, S],
  [0.2, edit(RELAXED, { hip: [0, -0.03, 0], handL: L([0.5, 1.1, 0.12], [1, -0.2, -1]), handR: L([-0.5, 1.1, 0.12], [-1, -0.2, -1]), head: [-14, 0, 0], chest: [-6, 0, 0], fist: 0.3 })],
  [0.5, edit(RELAXED, { hip: [0, 0.0, 0], handL: L([0.52, 1.16, 0.14], [1, -0.2, -1]), handR: L([-0.52, 1.16, 0.14], [-1, -0.2, -1]), head: [-18, 10, 0], chest: [-8, 0, 0], fist: 0.3 })],
  [0.8, edit(RELAXED, { hip: [0, -0.03, 0], handL: L([0.5, 1.1, 0.12], [1, -0.2, -1]), handR: L([-0.5, 1.1, 0.12], [-1, -0.2, -1]), head: [-14, -10, 0], chest: [-6, 0, 0], fist: 0.3 })],
  [1, S],
], undefined, 0.12);
const arms = edit(RELAXED, { handL: L([0.26, 2.0, 0.08], [1, 0, -0.3]), handR: L([-0.26, 2.0, 0.08], [-1, 0, -0.3]), head: [-18, 0, 0], chest: [-8, 0, 0], fist: 0.9, wristL: 90, wristR: 90 });
const victory = loop(1.4, [
  [0, arms],
  [0.5, edit(arms, { hip: [0, 0.03, 0], handL: L([0.3, 2.05, 0.05], [1, 0, -0.3]), handR: L([-0.3, 2.05, 0.05], [-1, 0, -0.3]) })],
  [1, arms],
], 0.3);
const slump = edit(RELAXED, { head: [28, 0, 0], chest: [10, 0, 0], handL: L([0.2, 1.0, 0.06], [0.4, 0, -1]), handR: L([-0.2, 1.0, 0.06], [-0.4, 0, -1]), shrugL: -6, shrugR: -6 });
const defeat = loop(3, [
  [0, slump],
  [0.5, edit(slump, { head: [24, -10, 0] })],
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

const GUARD_BOTTOM: Pose = edit(LYING, {
  hip: [0, -0.8, 0],
  hipRot: [-80, 0, 0],
  chest: [-10, 0, 0],
  head: [30, 0, 0],
  footL: L([0.3, 0.45, 0.62], [1, 0.6, 0]),
  footR: L([-0.3, 0.45, 0.62], [-1, 0.6, 0]),
  handL: L([0.14, 0.62, 0.32], [1, -0.2, 0]),
  handR: L([-0.14, 0.62, 0.32], [-1, -0.2, 0]),
  toeL: [40, -40],
  toeR: [40, 40],
  fist: 0.4,
});
const GUARD_TOP: Pose = st({
  hip: [0, -0.4, -0.48],
  hipRot: [24, 0, 0],
  chest: [22, 0, 0],
  head: [-30, 0, 0],
  handL: L([0.18, 0.5, 0.12], [1, 0, -0.5]),
  handR: L([-0.18, 0.5, 0.12], [-1, 0, -0.5]),
  footL: L([0.2, 0.08, -0.82], [0.2, 0, 1]),
  footR: L([-0.2, 0.08, -0.82], [-0.2, 0, 1]),
  toeL: [-70, 0],
  toeR: [-70, 0],
  wristL: 60,
  wristR: 60,
});
const MOUNT_BOTTOM: Pose = edit(LYING, { hip: [0, -0.8, 0], hipRot: [-86, 0, 0], head: [20, 0, 0], footL: L([0.22, 0.1, 0.55], [0.4, 1, 0.2]), footR: L([-0.22, 0.1, 0.55], [-0.4, 1, 0.2]), handL: L([0.12, 0.42, -0.42], [1, 0, 0]), handR: L([-0.12, 0.42, -0.42], [-1, 0, 0]), fist: 0.5 });
const MOUNT_TOP: Pose = st({
  hip: [0, -0.5, 0.12],
  hipRot: [10, 0, 0],
  chest: [14, 0, 0],
  head: [-20, 0, 0],
  handL: L([0.2, 0.6, 0.45], [1, 0, -0.3]),
  handR: L([-0.2, 0.62, 0.42], [-1, 0, -0.3]),
  footL: L([0.38, 0.08, -0.25], [1, 0.2, 0.3]),
  footR: L([-0.38, 0.08, -0.25], [-1, 0.2, 0.3]),
  toeL: [-70, 30],
  toeR: [-70, -30],
});
const gndGuardTop = loop(2.2, [[0, GUARD_TOP], [0.5, edit(GUARD_TOP, { chest: [26, 0, 0] })], [1, GUARD_TOP]], 0.25);
const gndGuardBottom = loop(2.2, [[0, GUARD_BOTTOM], [0.5, edit(GUARD_BOTTOM, { chest: [-14, 0, 0] })], [1, GUARD_BOTTOM]], 0.25);
const gndMountTop = loop(2.0, [[0, MOUNT_TOP], [0.5, edit(MOUNT_TOP, { chest: [18, 0, 0] })], [1, MOUNT_TOP]], 0.25);
const gndMountBottom = loop(2.0, [[0, MOUNT_BOTTOM], [0.5, edit(MOUNT_BOTTOM, { head: [24, 6, 0] })], [1, MOUNT_BOTTOM]], 0.25);
const poundCock = edit(MOUNT_TOP, { chest: [6, -20, 0], handR: L([-0.28, 1.15, 0.0], [-1, 0.3, -0.5]) });
const poundDown = edit(MOUNT_TOP, { chest: [34, 16, 0], hip: [0, -0.52, 0.18], handR: L([0.0, 0.32, 0.62], [-1, 0.3, 0]) });
const gndPound = once([[0, MOUNT_TOP], [0.25, poundCock], [0.42, poundDown], [0.6, poundDown], [1, MOUNT_TOP]], 0.42, 0.05);
const gndPoundHit = once([[0, MOUNT_BOTTOM], [0.25, edit(MOUNT_BOTTOM, { head: [30, 34, 20] })], [1, MOUNT_BOTTOM]], undefined, 0.03);
const GND_BLOCK = edit(MOUNT_BOTTOM, { handL: L([0.06, 0.48, -0.5], [1, 0.4, 0]), handR: L([-0.06, 0.5, -0.48], [-1, 0.4, 0]), head: [32, 0, 0] });
const gndBlock = loop(1.0, [[0, GND_BLOCK], [1, GND_BLOCK]], 0.06);
const gndAdvance = once([[0, GUARD_TOP], [0.5, edit(MOUNT_TOP, { hip: [0, -0.3, -0.1], hipRot: [30, 20, 0] })], [1, MOUNT_TOP]]);
const gndEscape = once([[0, MOUNT_BOTTOM], [0.5, edit(GUARD_BOTTOM, { hipRot: [-80, 30, 20] })], [1, GUARD_BOTTOM]]);
const gndStandUp = once([[0, GUARD_TOP], [0.5, CROUCH], [1, S]], undefined, 0.15);
const ARMBAR_ATK: Pose = edit(GUARD_BOTTOM, { hip: [0, -0.72, 0.1], hipRot: [-95, 30, 0], footL: L([0.25, 0.8, 0.4], [1, 1, 0]), footR: L([-0.32, 0.5, 0.62], [-1, 1, 0]), handL: L([0.08, 0.55, 0.15], [1, 0, 0]), handR: L([-0.04, 0.6, 0.12], [-1, 0, 0]), head: [20, -10, 0] });
const ARMBAR_DEF: Pose = edit(GUARD_TOP, { chest: [40, -10, 10], head: [-20, 20, 0], handR: L([0.0, 0.62, 0.55], [-1, 0, 0]), handL: L([0.3, 0.3, 0.1], [1, 0, 0]) });
const subArmbarAtk = loop(0.5, [[0, ARMBAR_ATK], [0.5, edit(ARMBAR_ATK, { hip: [0, -0.68, 0.1] })], [1, ARMBAR_ATK]], 0.2);
const subArmbarDef = loop(0.5, [[0, ARMBAR_DEF], [0.5, edit(ARMBAR_DEF, { chest: [36, -14, 12] })], [1, ARMBAR_DEF]], 0.2);
const CHOKE_ATK: Pose = edit(GUARD_TOP, { hip: [0, -0.55, -0.2], chest: [55, 10, 0], head: [10, 20, 0], handL: L([0.06, 0.25, 0.45], [1, 0.5, 0]), handR: L([-0.12, 0.22, 0.5], [-1, 0.5, 0]) });
const CHOKE_DEF: Pose = edit(GUARD_BOTTOM, { head: [40, -20, 0], handL: L([0.08, 0.4, -0.2], [1, 0, 0]), handR: L([-0.1, 0.45, -0.1], [-1, 0, 0]) });
const subChokeAtk = loop(0.6, [[0, CHOKE_ATK], [0.5, edit(CHOKE_ATK, { chest: [58, 12, 0] })], [1, CHOKE_ATK]], 0.2);
const subChokeDef = loop(0.6, [[0, CHOKE_DEF], [0.5, edit(CHOKE_DEF, { head: [44, -24, 0] })], [1, CHOKE_DEF]], 0.2);
const TAP_UP = edit(CHOKE_DEF, { handL: L([0.5, 0.35, 0.0], [1, 0.4, 0]) });
const TAP_DOWN = edit(CHOKE_DEF, { handL: L([0.52, 0.06, 0.0], [1, 0.4, 0]) });
const tapOut = loop(0.36, [[0, TAP_UP], [0.5, TAP_DOWN], [1, TAP_UP]], 0.1);

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
  knockdown,
  downed,
  getUp,
  shoot,
  sprawl,
  takedownTop: once([[0, shootDrive], [0.5, edit(GUARD_TOP, { hip: [0, -0.2, -0.2], chest: [50, 0, 0] })], [1, GUARD_TOP]]),
  takedownBottom: once([[0, rocked], [0.45, falling], [1, GUARD_BOTTOM]]),
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
};

/** Sample a clip at normalised time u (0..1); loops wrap. */
export function sampleClip(c: Clip, u: number, out: Pose, mix: (a: Pose, b: Pose, t: number, out?: Pose) => Pose): Pose {
  const k = c.keys;
  if (c.loop > 0) u = u - Math.floor(u);
  else u = Math.min(1, Math.max(0, u));
  if (u <= k[0][0]) return mix(k[0][1], k[0][1], 0, out);
  for (let i = 1; i < k.length; i++) {
    if (u <= k[i][0]) {
      const [t0, p0] = k[i - 1];
      const [t1, p1] = k[i];
      const t = (u - t0) / Math.max(1e-6, t1 - t0);
      // ease in-out between keys for weight
      const e = t * t * (3 - 2 * t);
      return mix(p0, p1, e, out);
    }
  }
  return mix(k[k.length - 1][1], k[k.length - 1][1], 0, out);
}
