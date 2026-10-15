// Direction maths for gestures. No trigonometry at run time: a direction is classified by comparing |dx| and |dy|
// against the precomputed tangent of the straight-sector half-angle, which is exact and cheap.

import type { GroundDir } from '../fight/types';
import type { Dir8, Rect } from './types';

/**
 * Classify a screen movement (dx right, dy DOWN, in px) into eight directions relative to the opponent.
 * `forward` is +1 when the opponent is to the right. Straight sectors are 2 x the half-angle wide (`straightTan` =
 * tan(half-angle)); the diagonals take the rest. Returns null for no movement.
 */
export function dir8(dx: number, dy: number, forward: 1 | -1, straightTan: number): Dir8 | null {
  const f = dx * forward; // + toward the opponent
  const u = -dy; // + up the screen
  const af = Math.abs(f);
  const au = Math.abs(u);
  if (af === 0 && au === 0) return null;
  if (au <= af * straightTan) return f > 0 ? 'F' : 'B';
  if (af <= au * straightTan) return u > 0 ? 'U' : 'D';
  if (u > 0) return f > 0 ? 'UF' : 'UB';
  return f > 0 ? 'DF' : 'DB';
}

/** Four screen directions for the ground scramble (the prompt arrows are drawn in screen space). */
export function dir4(dx: number, dy: number): GroundDir | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Is the direction one of the three downward ones? */
export function isDown(d: Dir8): boolean {
  return d === 'D' || d === 'DF' || d === 'DB';
}

/** Is the direction one of the three upward ones? */
export function isUp(d: Dir8): boolean {
  return d === 'U' || d === 'UF' || d === 'UB';
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Grow a rectangle by `p` on every side. */
export function pad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p };
}

export function dist(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0);
}
