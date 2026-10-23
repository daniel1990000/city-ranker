// Default gesture thresholds and their scaling to screen pixels. The numbers were tuned with the synthetic traces in
// tests/touch-recognizer.test.ts and the Playwright touch runs in the HUD lab (docs/notes/controls.md has the
// reasoning). They are in dp so a fast flick feels the same on a 5-inch phone and a 7-inch tablet.

import type { TouchConfig } from './types';

export const DEFAULT_TOUCH_CONFIG: Readonly<TouchConfig> = Object.freeze({
  tapSlopDp: 14,
  tapMaxMs: 280,
  swipeWindowMs: 220,
  swipeMinDp: 24,
  commitDp: 42,
  flickDp: 30,
  takedownDp: 130,
  takedownMaxFrac: 0.36,
  downSettleMs: 90,
  twoFingerMs: 140,
  grabHoldMs: 300,
  straightHalfAngleDeg: 24,
  settleMs: 70,
  moveDeadDp: 10,
  moveMaxDp: 56,
  blockDelayMs: 0,
  bufferMs: 200,
  maxTouches: 6,
});

/** Thresholds after scaling to CSS pixels: distances in px, times in ms, plus precomputed constants. */
export interface ScaledConfig {
  tapSlop: number;
  tapMaxMs: number;
  swipeWindowMs: number;
  swipeMin: number;
  commit: number;
  flick: number;
  takedown: number;
  downSettleMs: number;
  twoFingerMs: number;
  grabHoldMs: number;
  /** tan(straight half-angle): |minor| <= |major| * this means a straight (non-diagonal) direction. */
  straightTan: number;
  settleMs: number;
  moveDead: number;
  moveMax: number;
  blockDelayMs: number;
  bufferMs: number;
  maxTouches: number;
}

/**
 * Scale the dp thresholds for a screen. `pxPerDp` is CSS pixels per dp: 1 in an Android WebView (its CSS pixel is
 * the dp), about 0.6 on a desktop monitor (96 CSS px per inch vs 160 dp per inch) where a mouse makes smaller swipes.
 * `screenHeight` (CSS px) caps the takedown swipe so it always fits on short landscape screens.
 */
export function scaleConfig(cfg: Readonly<TouchConfig>, pxPerDp: number, screenHeight: number): ScaledConfig {
  const k = pxPerDp > 0 && Number.isFinite(pxPerDp) ? pxPerDp : 1;
  const h = screenHeight > 0 && Number.isFinite(screenHeight) ? screenHeight : 390;
  const commit = cfg.commitDp * k;
  return {
    tapSlop: cfg.tapSlopDp * k,
    tapMaxMs: cfg.tapMaxMs,
    swipeWindowMs: cfg.swipeWindowMs,
    swipeMin: cfg.swipeMinDp * k,
    commit,
    flick: cfg.flickDp * k,
    // never shorter than a comfortable body shot plus a margin, never taller than the screen allows
    takedown: Math.max(commit * 1.6, Math.min(cfg.takedownDp * k, h * cfg.takedownMaxFrac)),
    downSettleMs: cfg.downSettleMs,
    twoFingerMs: cfg.twoFingerMs,
    // a grab is never a slow tap
    grabHoldMs: Math.max(cfg.grabHoldMs, cfg.tapMaxMs + 20),
    straightTan: Math.tan((Math.min(44, Math.max(10, cfg.straightHalfAngleDeg)) * Math.PI) / 180),
    settleMs: cfg.settleMs,
    moveDead: cfg.moveDeadDp * k,
    moveMax: Math.max(cfg.moveMaxDp, cfg.moveDeadDp * 2) * k,
    blockDelayMs: cfg.blockDelayMs,
    bufferMs: cfg.bufferMs,
    maxTouches: Math.max(1, Math.floor(cfg.maxTouches)),
  };
}

/**
 * CSS pixels per dp for this device, from what the browser reports. Coarse pointers (touch screens) use 1: Android
 * WebView and mobile browsers lay out in dp. Fine pointers (mouse) use 0.75 so mouse drags need less travel.
 */
export function pxPerDpFor(coarsePointer: boolean): number {
  return coarsePointer ? 1 : 0.75;
}
