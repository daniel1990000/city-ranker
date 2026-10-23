// The pose library: key poses for an orthodox MMA fighter, authored in character space for the 1.747 m base male
// (x = the fighter's left, y = up, z = toward the opponent). Clips (clips.ts) blend between these.

import type { LimbTarget, Pose, Rot, V3 } from './rig';

const L = (p: V3, pole: V3): LimbTarget => ({ p, pole });

/** Elbows down and slightly out: the guard. */
const ELBOW_L: V3 = [0.6, -1, -0.15];
const ELBOW_R: V3 = [-0.6, -1, -0.15];
const KNEE_L: V3 = [0.25, 0, 1];
const KNEE_R: V3 = [-0.1, 0, 1];

/** Fighting stance: left foot forward, hips bladed, chin down, hands up. */
export const STANCE: Pose = {
  hip: [0, -0.075, 0],
  hipRot: [6, -32, 0],
  chest: [12, 14, 0],
  head: [-6, 16, 0],
  handL: L([0.13, 1.36, 0.33], ELBOW_L),
  handR: L([-0.03, 1.37, 0.19], ELBOW_R),
  wristL: 20,
  wristR: 35,
  footL: L([0.13, 0.075, 0.27], KNEE_L),
  footR: L([-0.17, 0.075, -0.26], KNEE_R),
  toeL: [0, -12],
  toeR: [6, 38],
  fist: 0.9,
  shrugL: 6,
  shrugR: 6,
};

/** Standing relaxed (walkout, between rounds, the lab). */
export const RELAXED: Pose = {
  hip: [0, -0.01, 0],
  hipRot: [0, 0, 0],
  chest: [0, 0, 0],
  head: [0, 0, 0],
  handL: L([0.24, 1.0, 0.04], [0.3, 0, -1]),
  handR: L([-0.24, 1.0, 0.04], [-0.3, 0, -1]),
  wristL: 70,
  wristR: 70,
  footL: L([0.13, 0.075, 0.02], [0.1, 0, 1]),
  footR: L([-0.13, 0.075, 0.0], [-0.1, 0, 1]),
  toeL: [0, 8],
  toeR: [0, -8],
  fist: 0.35,
  shrugL: 0,
  shrugR: 0,
};

/** A deep copy whose arrays the caller owns (an `out` buffer for mixPose). */
export function clonePose(p: Pose): Pose {
  const lt = (x: LimbTarget): LimbTarget => ({ p: [x.p[0], x.p[1], x.p[2]], pole: [x.pole[0], x.pole[1], x.pole[2]] });
  return {
    hip: [p.hip[0], p.hip[1], p.hip[2]],
    hipRot: [p.hipRot[0], p.hipRot[1], p.hipRot[2]],
    chest: [p.chest[0], p.chest[1], p.chest[2]],
    head: [p.head[0], p.head[1], p.head[2]],
    handL: lt(p.handL),
    handR: lt(p.handR),
    wristL: p.wristL,
    wristR: p.wristR,
    footL: lt(p.footL),
    footR: lt(p.footR),
    toeL: [p.toeL[0], p.toeL[1]],
    toeR: [p.toeR[0], p.toeR[1]],
    fist: p.fist,
    shrugL: p.shrugL,
    shrugR: p.shrugR,
  };
}

/** Angle blend the short way round (a spin that ends at -392 blends into a stance at -32 without unwinding). */
function mixAngle(x: number, y: number, t: number): number {
  let d = (y - x) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return x + d * t;
}

type W = number[];
function mix3(o: V3, x: V3, y: V3, t: number): void {
  const w = o as unknown as W;
  w[0] = x[0] + (y[0] - x[0]) * t;
  w[1] = x[1] + (y[1] - x[1]) * t;
  w[2] = x[2] + (y[2] - x[2]) * t;
}
function mixRot(o: Rot, x: Rot, y: Rot, t: number): void {
  const w = o as unknown as W;
  w[0] = mixAngle(x[0], y[0], t);
  w[1] = mixAngle(x[1], y[1], t);
  w[2] = mixAngle(x[2], y[2], t);
}
function mix2(o: readonly [number, number], x: readonly [number, number], y: readonly [number, number], t: number): void {
  const w = o as unknown as W;
  w[0] = x[0] + (y[0] - x[0]) * t;
  w[1] = x[1] + (y[1] - x[1]) * t;
}

/**
 * Blend of two poses (t = 0 gives a; t outside 0..1 extrapolates). With `out` the result is written into out's own
 * arrays (no allocation; out must come from clonePose, never a shared key pose); out may be a or b.
 */
export function mixPose(a: Pose, b: Pose, t: number, out?: Pose): Pose {
  const o = out ?? clonePose(a);
  const m = (x: number, y: number) => x + (y - x) * t;
  mix3(o.hip, a.hip, b.hip, t);
  mixRot(o.hipRot, a.hipRot, b.hipRot, t);
  mixRot(o.chest, a.chest, b.chest, t);
  mixRot(o.head, a.head, b.head, t);
  mix3(o.handL.p, a.handL.p, b.handL.p, t);
  mix3(o.handL.pole, a.handL.pole, b.handL.pole, t);
  mix3(o.handR.p, a.handR.p, b.handR.p, t);
  mix3(o.handR.pole, a.handR.pole, b.handR.pole, t);
  mix3(o.footL.p, a.footL.p, b.footL.p, t);
  mix3(o.footL.pole, a.footL.pole, b.footL.pole, t);
  mix3(o.footR.p, a.footR.p, b.footR.p, t);
  mix3(o.footR.pole, a.footR.pole, b.footR.pole, t);
  mix2(o.toeL, a.toeL, b.toeL, t);
  mix2(o.toeR, a.toeR, b.toeR, t);
  const wl = m(a.wristL, b.wristL);
  const wr = m(a.wristR, b.wristR);
  const f = m(a.fist, b.fist);
  const sl = m(a.shrugL, b.shrugL);
  const sr = m(a.shrugR, b.shrugR);
  (o as { wristL: number }).wristL = wl;
  (o as { wristR: number }).wristR = wr;
  (o as { fist: number }).fist = Math.min(1, Math.max(0, f));
  (o as { shrugL: number }).shrugL = sl;
  (o as { shrugR: number }).shrugR = sr;
  return o;
}

/** A pose with some fields changed (for authoring clips as edits of the stance). */
export function edit(base: Pose, changes: Partial<Pose>): Pose {
  return { ...base, ...changes };
}
