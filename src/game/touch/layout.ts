// Where the on-screen controls sit, computed from the screen size and safe-area insets. Pure maths, no DOM: the touch
// overlay draws the buttons at these rectangles and the recogniser uses the same rectangles as hit zones.
//
// Landscape, right-handed (the default):
//   left half  = DEFENCE: hold anywhere to block, flick to dodge; the MOVE pad sits in the bottom-left corner.
//   right half = OFFENCE: tap = jab, swipe = power shots; KICK, TAKEDOWN and SPECIAL sit in an arc around the
//                bottom-right corner, where the right thumb rests.
// Left-handed mirrors it. The pause button stays top-right either way.

import { pad } from './geometry';
import type { Insets, Rect, TouchLayout } from './types';

export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export interface LayoutOptions {
  mirrored?: boolean;
  /** CSS px per dp (see scaleConfig). */
  pxPerDp?: number;
}

/** Sizes in dp at a 390 dp tall screen; shorter screens shrink them a little. */
const SIZE = {
  margin: 16,
  kick: 76,
  shoot: 60,
  special: 66,
  moveW: 156,
  moveH: 60,
  pause: 40,
  /** Extra touch slack around the drawn buttons. */
  slack: 10,
} as const;

function circle(cx: number, cy: number, d: number): Rect {
  return { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
}

export function computeTouchLayout(width: number, height: number, insets: Insets = NO_INSETS, opts: LayoutOptions = {}): TouchLayout {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const mirrored = !!opts.mirrored;
  const k = (opts.pxPerDp && opts.pxPerDp > 0 ? opts.pxPerDp : 1) * Math.min(1, Math.max(0.72, H / 390));
  const m = SIZE.margin * k;
  const L = Math.max(0, insets.left);
  const R = Math.max(0, insets.right);
  const T = Math.max(0, insets.top);
  const B = Math.max(0, insets.bottom);
  const splitX = W / 2;

  // Offence buttons, laid out for the right edge, then mirrored if needed.
  const kickD = SIZE.kick * k;
  const shootD = SIZE.shoot * k;
  const specD = SIZE.special * k;
  // distances measured from the screen's right edge so mirroring is a simple flip
  const kickCxR = R + m + kickD / 2;
  const kickCy = H - B - m - kickD / 2;
  const shootCxR = kickCxR + kickD / 2 + shootD / 2 + 18 * k;
  const shootCy = kickCy + (kickD - shootD) / 2; // bottoms aligned
  const specCxR = kickCxR + 4 * k;
  const specCy = kickCy - kickD / 2 - specD / 2 - 16 * k;
  const fromRight = (cxR: number) => (mirrored ? cxR : W - cxR);

  const kick = circle(fromRight(kickCxR), kickCy, kickD);
  const shoot = circle(fromRight(shootCxR), shootCy, shootD);
  const special = circle(fromRight(specCxR), specCy, specD);

  // Move pad, laid out for the left edge, mirrored if needed.
  const mw = SIZE.moveW * k;
  const mh = SIZE.moveH * k;
  const padXL = L + m;
  const padY = H - B - m - mh;
  const movePad: Rect = { x: mirrored ? W - padXL - mw : padXL, y: padY, w: mw, h: mh };
  // the corner area that drives footwork: generous, but never past the middle of the screen
  const zoneTop = padY - 30 * k;
  const zoneW = Math.min(splitX - 8 * k, Math.max(padXL + mw + 36 * k, W * 0.3));
  const moveZone: Rect = mirrored ? { x: W - zoneW, y: zoneTop, w: zoneW, h: H - zoneTop } : { x: 0, y: zoneTop, w: zoneW, h: H - zoneTop };

  const pd = SIZE.pause * k;
  const pause: Rect = { x: W - R - 10 * k - pd, y: T + 8 * k, w: pd, h: pd };

  const s = SIZE.slack * k;
  return {
    width: W,
    height: H,
    mirrored,
    splitX,
    movePad,
    moveZone,
    kick,
    kickZone: pad(kick, s),
    shoot,
    shootZone: pad(shoot, s * 0.6),
    special,
    specialZone: pad(special, s * 0.6),
    pause: pad(pause, 6 * k),
    pxPerDp: opts.pxPerDp && opts.pxPerDp > 0 ? opts.pxPerDp : 1,
  };
}
