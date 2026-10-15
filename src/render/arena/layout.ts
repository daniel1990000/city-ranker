/**
 * Where things are in the arena: the cage's shape, the corners, the gates, and where every spectator sits or
 * stands. Pure maths (no three.js, no DOM), so the tests can check that nobody is placed inside the cage, that
 * a venue fits the phone budget, and that the same venue always looks the same.
 *
 * World space for the whole renderer: metres, y up, the mat surface at y = 0, the cage centre at the origin.
 * The fight line runs along x (the simulation's one axis); the broadcast camera sits on the +z side.
 */
import { Rand, hash01 } from './rand';

/** The cage (all venues share it). Real cages are 7.6 m (25 ft) or 9.1 m (30 ft) across; ours is in between. */
export const CAGE = {
  sides: 8,
  /** Centre to the middle of a fence panel (m): 8.5 m across the flats. */
  apothem: 4.25,
  /** Mat to the bottom of the chain-link (the bottom pad covers the gap). */
  fenceBottom: 0.16,
  /** Mat to the top of the chain-link (the padded top rail sits on it). */
  fenceTop: 1.74,
  /** Centre line of the padded top rail. */
  railY: 1.8,
  railRadius: 0.075,
  /** Posts at the eight corners: steel core and the foam pad wrapped round it. */
  postHeight: 1.86,
  postRadius: 0.07,
  padRadius: 0.15,
  /** Mat outside the fence, where the cornermen stand between rounds. */
  apron: 0.95,
  /** The mat is raised above the arena floor on a platform (the floor is at -platformHeight). */
  platformHeight: 1.0,
} as const;

/** How far a fighter's centre is from the fence when their back is against it. */
export const FENCE_CONTACT_GAP = 0.32;

export interface XZ {
  x: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Corner (post) k of an octagon with the given apothem. Flats face +x, +z, -x and -z. */
export function cageVertex(k: number, apothem: number = CAGE.apothem): XZ {
  const r = apothem / Math.cos(Math.PI / 8);
  const a = (k - 0.5) * 45 * DEG;
  return { x: r * Math.cos(a), z: r * Math.sin(a) };
}

/** Middle of fence panel k (between corners k and k+1) and the panel's outward normal. */
export function panelCentre(k: number, apothem: number = CAGE.apothem): XZ & { nx: number; nz: number } {
  const a = k * 45 * DEG;
  const nx = Math.cos(a), nz = Math.sin(a);
  return { x: nx * apothem, z: nz * apothem, nx, nz };
}

/** Width of one fence panel (corner to corner). */
export function panelWidth(apothem: number = CAGE.apothem): number {
  return 2 * apothem * Math.tan(Math.PI / 8);
}

/**
 * Distance from the cage centre measured the octagon's way: the largest projection onto a panel normal.
 * A point is inside the cage when this is below the apothem.
 */
export function octagonRadius(x: number, z: number): number {
  let m = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * 45 * DEG;
    const d = x * Math.cos(a) + z * Math.sin(a);
    if (d > m) m = d;
  }
  return m;
}

/** The red corner (fighter 0 starts on -x) is the near-left post; the blue corner is diagonally opposite. */
export const RED_CORNER_POST = 4;
export const BLUE_CORNER_POST = 0;
/** The two gates are the panels next to the corners (near-left and far-right). */
export const GATE_PANELS: readonly number[] = [3, 7];

/** Edge of the raised platform, measured like octagonRadius. */
export const PLATFORM_APOTHEM = CAGE.apothem + CAGE.apron;

/**
 * Optional mapping from the simulation's x (millimetres, the wall at |x| = 3600) to world x (metres).
 * 1:1 in the middle of the cage; over the last 0.6 m it eases outwards so that a fighter the simulation has
 * pinned against the wall stands with their back to the fence instead of 0.3 m short of it.
 */
export function simToWorldX(mm: number): number {
  const x = mm / 1000;
  const ax = Math.abs(x);
  const knee = 3.0, simWall = 3.6;
  const worldWall = CAGE.apothem - FENCE_CONTACT_GAP;
  if (ax <= knee) return x;
  const k = (worldWall - simWall) / ((simWall - knee) * (simWall - knee));
  const d = Math.min(ax, simWall) - knee;
  const out = Math.min(ax, simWall) + k * d * d + Math.max(0, ax - simWall);
  return Math.sign(x) * out;
}

// ------------------------------------------------------------------------------------------- seating

/** Ranges of the compass (degrees, 0 = +x, 90 = +z toward the camera) where a section has people. */
export type Arc = readonly [number, number];

/** A ring of tiered rows round the cage (an arena bowl or floor seats). */
export interface RingSection {
  kind: 'ring';
  /** Radius of the first row (measured like octagonRadius when shape is 8, else a superellipse radius). */
  r0: number;
  rows: number;
  rowDepth: number;
  /** Each row is this much higher than the one in front. */
  rowRise: number;
  /** Floor height of the first row (the arena floor is at -CAGE.platformHeight). */
  y0: number;
  /** Seat to seat along a row (m). */
  spacing: number;
  /** 2 = circle, 4..8 = a rounded rectangle; 'oct' follows the cage. */
  shape: number | 'oct';
  /** Wider along x than along z (stadium bowls are oval). */
  stretchX?: number;
  arcs?: readonly Arc[];
  /** Leave a gap (an aisle) every n seats. */
  aisleEvery?: number;
  seated: boolean;
  /** Fraction of seats taken. */
  density: number;
}

/** A straight bleacher facing the cage. */
export interface BlockSection {
  kind: 'block';
  /** Middle of the front row. */
  cx: number;
  cz: number;
  width: number;
  rows: number;
  rowDepth: number;
  rowRise: number;
  y0: number;
  spacing: number;
  seated: boolean;
  density: number;
}

/** A standing crowd on flat ground (clubs, gyms, rooftops). */
export interface FloorSection {
  kind: 'floor';
  r0: number;
  r1: number;
  y: number;
  spacing: number;
  shape: number | 'oct';
  stretchX?: number;
  arcs?: readonly Arc[];
  density: number;
}

export type SeatSection = RingSection | BlockSection | FloorSection;

/** One spectator: where their feet (or seat) are, which way they face, and how far back they are. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  /** Unit vector they face (toward the cage). */
  fx: number;
  fz: number;
  seated: boolean;
  /** 0 = front row of their section. */
  row: number;
}

function inArcs(x: number, z: number, arcs: readonly Arc[] | undefined): boolean {
  if (!arcs || arcs.length === 0) return true;
  let a = Math.atan2(z, x) / DEG;
  if (a < 0) a += 360;
  for (const [from, to] of arcs) {
    const f = ((from % 360) + 360) % 360;
    const t = ((to % 360) + 360) % 360;
    if (f <= t ? a >= f && a <= t : a >= f || a <= t) return true;
  }
  return false;
}

/** A point on a closed curve of "radius" r at angle t (radians). */
function curvePoint(shape: number | 'oct', r: number, stretchX: number, t: number, out: XZ): XZ {
  const c = Math.cos(t), s = Math.sin(t);
  if (shape === 'oct') {
    // scale the direction so that its octagon radius is r
    const k = r / Math.max(1e-6, octagonRadius(c, s));
    out.x = c * k * stretchX;
    out.z = s * k;
  } else {
    const e = 2 / shape;
    out.x = Math.sign(c) * Math.pow(Math.abs(c), e) * r * stretchX;
    out.z = Math.sign(s) * Math.pow(Math.abs(s), e) * r;
  }
  return out;
}

/** "Radius" of a point measured by the section's own curve (inverse of curvePoint). */
export function curveRadius(shape: number | 'oct', stretchX: number, x: number, z: number): number {
  const xs = x / stretchX;
  if (shape === 'oct') return octagonRadius(xs, z);
  return Math.pow(Math.pow(Math.abs(xs), shape) + Math.pow(Math.abs(z), shape), 1 / shape);
}

const CURVE_SAMPLES = 1440;

function facing(x: number, z: number, spot: Spot): void {
  const l = Math.hypot(x, z) || 1;
  spot.fx = -x / l;
  spot.fz = -z / l;
}

function ringSpots(sec: RingSection, rng: Rand, out: Spot[]): void {
  const sx = sec.stretchX ?? 1;
  const p = { x: 0, z: 0 }, q = { x: 0, z: 0 };
  for (let row = 0; row < sec.rows; row++) {
    const r = sec.r0 + row * sec.rowDepth + sec.rowDepth * 0.5;
    const y = sec.y0 + row * sec.rowRise;
    // walk the curve by arc length and drop a seat every `spacing` metres
    curvePoint(sec.shape, r, sx, 0, q);
    let walked = sec.spacing * rng.next();
    let seat = 0;
    for (let i = 1; i <= CURVE_SAMPLES; i++) {
      curvePoint(sec.shape, r, sx, (i / CURVE_SAMPLES) * Math.PI * 2, p);
      walked += Math.hypot(p.x - q.x, p.z - q.z);
      q.x = p.x;
      q.z = p.z;
      while (walked >= sec.spacing) {
        walked -= sec.spacing;
        seat++;
        if (sec.aisleEvery && seat % sec.aisleEvery === 0) continue;
        if (!inArcs(p.x, p.z, sec.arcs) || !rng.chance(sec.density)) continue;
        const jx = rng.range(-0.06, 0.06), jz = rng.range(-0.06, 0.06);
        const s: Spot = { x: p.x + jx, y, z: p.z + jz, fx: 0, fz: 0, seated: sec.seated, row };
        facing(s.x, s.z, s);
        out.push(s);
      }
    }
  }
}

function blockSpots(sec: BlockSection, rng: Rand, out: Spot[]): void {
  // the block faces the cage centre; rows step away from it
  const l = Math.hypot(sec.cx, sec.cz) || 1;
  const bx = sec.cx / l, bz = sec.cz / l; // backwards (away from the cage)
  const ax = -bz, az = bx; // along the row
  const n = Math.max(1, Math.floor(sec.width / sec.spacing));
  for (let row = 0; row < sec.rows; row++) {
    const back = row * sec.rowDepth + sec.rowDepth * 0.5;
    const y = sec.y0 + row * sec.rowRise;
    for (let i = 0; i < n; i++) {
      if (!rng.chance(sec.density)) continue;
      const along = (i + 0.5) * sec.spacing - n * sec.spacing * 0.5 + rng.range(-0.05, 0.05);
      const x = sec.cx + bx * back + ax * along;
      const z = sec.cz + bz * back + az * along;
      out.push({ x, y, z, fx: -bx, fz: -bz, seated: sec.seated, row });
    }
  }
}

function floorSpots(sec: FloorSection, rng: Rand, out: Spot[]): void {
  const sx = sec.stretchX ?? 1;
  const ext = sec.r1 * Math.max(1, sx) + sec.spacing;
  const s = sec.spacing;
  for (let gz = -ext; gz <= ext; gz += s) {
    for (let gx = -ext; gx <= ext; gx += s) {
      // a jittered grid reads as a loose standing crowd (and never stacks two people on one spot)
      const x = gx + rng.range(-0.3, 0.3) * s;
      const z = gz + rng.range(-0.3, 0.3) * s;
      const r = curveRadius(sec.shape, sx, x, z);
      if (r < sec.r0 || r > sec.r1 || !inArcs(x, z, sec.arcs) || !rng.chance(sec.density)) continue;
      const spot: Spot = { x, y: sec.y, z, fx: 0, fz: 0, seated: false, row: Math.floor((r - sec.r0) / s) };
      facing(x, z, spot);
      // people at the back of a crowd look about a bit
      const wob = rng.range(-0.35, 0.35);
      const c = Math.cos(wob), sn = Math.sin(wob);
      const fx = spot.fx * c - spot.fz * sn, fz = spot.fx * sn + spot.fz * c;
      spot.fx = fx;
      spot.fz = fz;
      out.push(spot);
    }
  }
}

/** Every spectator of a venue, in a stable order. */
export function layoutCrowd(sections: readonly SeatSection[], seed: number): Spot[] {
  const out: Spot[] = [];
  sections.forEach((sec, i) => {
    const rng = new Rand(seed * 977 + i * 7919 + 13);
    switch (sec.kind) {
      case 'ring':
        ringSpots(sec, rng, out);
        break;
      case 'block':
        blockSpots(sec, rng, out);
        break;
      case 'floor':
        floorSpots(sec, rng, out);
        break;
    }
  });
  return out;
}

/**
 * Thin a crowd for a cheaper quality level: keep about `keep` of the people, but keep the front rows (the ones
 * the camera sees up close) fuller, then cap the total. The same people stay whatever the cap, so switching
 * quality never reshuffles the crowd.
 */
export function thinCrowd(spots: readonly Spot[], keep: number, cap: number, seed: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    const k = s.row < 2 ? Math.min(1, keep * 1.6) : keep;
    if (hash01(i, seed) < k) out.push(s);
  }
  if (out.length <= cap) return out;
  // over the cap: drop the back rows first (deterministic)
  const order = out.map((s, i) => ({ s, w: s.row + hash01(i, seed + 1) }));
  order.sort((a, b) => a.w - b.w);
  return order.slice(0, cap).map((o) => o.s);
}

/** One step of a seating tier, for building the risers people sit on. */
export interface TierRow {
  r: number;
  y: number;
  depth: number;
}

/** The rows of a ring or block section (floor sections have none). */
export function tierRows(sec: SeatSection): TierRow[] {
  if (sec.kind === 'floor') return [];
  const rows: TierRow[] = [];
  for (let row = 0; row < sec.rows; row++) {
    const r = (sec.kind === 'ring' ? sec.r0 : 0) + row * sec.rowDepth;
    rows.push({ r, y: sec.y0 + row * sec.rowRise, depth: sec.rowDepth });
  }
  return rows;
}

/** Sample the closed curve of a ring section at radius r (for building tier geometry). */
export function ringOutline(sec: RingSection | FloorSection, r: number, samples: number): XZ[] {
  const sx = sec.stretchX ?? 1;
  const pts: XZ[] = [];
  for (let i = 0; i < samples; i++) pts.push(curvePoint(sec.shape, r, sx, (i / samples) * Math.PI * 2, { x: 0, z: 0 }));
  return pts;
}

/** Is this compass point inside the section's arcs (for skipping tier geometry in gaps)? */
export function inSectionArcs(sec: RingSection | FloorSection, x: number, z: number): boolean {
  return inArcs(x, z, sec.arcs);
}
