// Octagon geometry and wall awareness (docs/11 §3). Regular octagon, 30 ft across flats by default.

import { wrapPi, vFromAngle, vAngle } from '../core/math.js';

export const SECTORS = Object.freeze(['front', 'front_left', 'left', 'back_left', 'back', 'back_right', 'right', 'front_right']);

export class Octagon {
  /** @param {number} acrossFlats metres between opposite flat walls (UFC: 9.14 m) */
  constructor(acrossFlats = 9.14) {
    this.apothem = acrossFlats / 2;
    this.circumradius = this.apothem / Math.cos(Math.PI / 8);
    this.side = 2 * this.apothem * Math.tan(Math.PI / 8);
    /** outward wall normals at 22.5° + k·45° */
    this.normals = Array.from({ length: 8 }, (_, k) => vFromAngle(Math.PI / 8 + (k * Math.PI) / 4));
  }

  /** distance from point p to wall k (positive inside) */
  wallGap(p, k) { const n = this.normals[k]; return this.apothem - (p.x * n.x + p.y * n.y); }

  nearestWall(p) {
    let best = 0, gap = Infinity;
    for (let k = 0; k < 8; k++) { const g = this.wallGap(p, k); if (g < gap) { gap = g; best = k; } }
    return { index: best, gap, normalOut: this.normals[best] };
  }

  /** is a disc of radius r fully inside? */
  inside(p, r = 0) {
    for (let k = 0; k < 8; k++) if (this.wallGap(p, k) < r) return false;
    return true;
  }

  /** push a disc back inside; returns {pos, contact:boolean, wall:index|null} */
  clamp(p, r) {
    let x = p.x, y = p.y, contact = false, wall = null;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < 8; k++) {
        const n = this.normals[k];
        const gap = this.apothem - (x * n.x + y * n.y);
        if (gap < r) { const push = r - gap; x -= n.x * push; y -= n.y * push; contact = true; wall = k; }
      }
    }
    return { pos: { x, y }, contact, wall };
  }

  /**
   * Wall sensing for a fighter (facing in radians): nearest wall gap, whether pinned, and the inward normal expressed in the
   * fighter's frame as one of 8 sectors (where the wall is relative to the fighter).
   */
  sense(p, facing, r, pinMargin = 0.12) {
    const w = this.nearestWall(p);
    const toWall = vAngle(w.normalOut); // direction from the centre toward the wall
    const rel = wrapPi(toWall - facing);
    const idx = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
    const sector = SECTORS[idx];
    const pinned = w.gap < r + pinMargin;
    return {
      gap: w.gap, wall: w.index, sector, pinned,
      backAgainstCage: pinned && ['back', 'back_left', 'back_right'].includes(sector),
      facingCage: pinned && ['front', 'front_left', 'front_right'].includes(sector),
    };
  }
}
