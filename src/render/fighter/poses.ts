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

/** Linear blend of two poses (t = 0 gives a). */
export function mixPose(a: Pose, b: Pose, t: number, out?: Pose): Pose {
  const m = (x: number, y: number) => x + (y - x) * t;
  const v = (x: V3, y: V3): V3 => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  // angles take the short way round (a spin that ends at -392 blends into a stance at -32 without unwinding)
  const ma = (x: number, y: number) => {
    let d = (y - x) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return x + d * t;
  };
  const r = (x: Rot, y: Rot): Rot => [ma(x[0], y[0]), ma(x[1], y[1]), ma(x[2], y[2])];
  const lt = (x: LimbTarget, y: LimbTarget): LimbTarget => ({ p: v(x.p, y.p), pole: v(x.pole, y.pole) });
  const o: Pose = {
    hip: v(a.hip, b.hip),
    hipRot: r(a.hipRot, b.hipRot),
    chest: r(a.chest, b.chest),
    head: r(a.head, b.head),
    handL: lt(a.handL, b.handL),
    handR: lt(a.handR, b.handR),
    wristL: m(a.wristL, b.wristL),
    wristR: m(a.wristR, b.wristR),
    footL: lt(a.footL, b.footL),
    footR: lt(a.footR, b.footR),
    toeL: [m(a.toeL[0], b.toeL[0]), m(a.toeL[1], b.toeL[1])],
    toeR: [m(a.toeR[0], b.toeR[0]), m(a.toeR[1], b.toeR[1])],
    fist: m(a.fist, b.fist),
    shrugL: m(a.shrugL, b.shrugL),
    shrugR: m(a.shrugR, b.shrugR),
  };
  if (out) Object.assign(out, o);
  return o;
}

/** A pose with some fields changed (for authoring clips as edits of the stance). */
export function edit(base: Pose, changes: Partial<Pose>): Pose {
  return { ...base, ...changes };
}
