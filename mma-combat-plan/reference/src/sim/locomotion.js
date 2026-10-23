// Locomotion: direction-dependent speed table, turning toward the opponent, collision (docs/11 §1).

import { DT } from '../core/taxonomy.js';
import { vLen, vAngle, vSub, wrapPi, clamp, rad, locoSpeedByAngle, vDist, vNorm } from '../core/math.js';

/**
 * Move a standing fighter by intent.move (world-space unit-ish vector). Facing tracks the opponent at a limited turn rate.
 * Returns the displacement actually applied (before cage clamp).
 */
export function stepLocomotion(f, opp, moveVec, tun, { locked = false, speedMult = 1 } = {}) {
  // turning
  const want = vAngle(vSub(opp.pos, f.pos));
  const turn = rad(tun.fighter.turnRateDegPerTick);
  f.facing = wrapPi(f.facing + clamp(wrapPi(want - f.facing), -turn, turn));

  const mag = Math.min(1, vLen(moveVec));
  if (locked || mag < 1e-3 || f.isHelpless()) { f.vel = { x: 0, y: 0 }; return { x: 0, y: 0 }; }
  const dir = vNorm(moveVec);
  const rel = wrapPi(vAngle(dir) - f.facing);
  const table = tun.fighter.loco;
  const speed = tun.fighter.baseSpeed * locoSpeedByAngle(rel, table) * f.moveSpeedMult() * mag * speedMult;
  const d = { x: dir.x * speed * DT, y: dir.y * speed * DT };
  f.vel = { x: d.x / DT, y: d.y / DT };
  f.pos = { x: f.pos.x + d.x, y: f.pos.y + d.y };
  return d;
}

/** Resolve overlap between two discs (push apart equally) */
export function separate(a, b) {
  const d = vDist(a.pos, b.pos);
  const min = a.radius + b.radius;
  if (d >= min || d < 1e-6) return;
  const push = (min - d) / 2;
  const n = vNorm(vSub(a.pos, b.pos));
  a.pos = { x: a.pos.x + n.x * push, y: a.pos.y + n.y * push };
  b.pos = { x: b.pos.x - n.x * push, y: b.pos.y - n.y * push };
}
