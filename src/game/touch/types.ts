// Types for the touch and keyboard controls (src/game/touch). Everything here is plain data: the recogniser is a pure,
// deterministic state machine (touch points with timestamps in, one FightInput per simulation tick out), so it runs
// the same in a unit test, the HUD lab and the game. The DOM wiring lives in src/ui/fight/touch-overlay.ts.

import type { Evade, GroundDir, Strike } from '../fight/types';

/** An axis-aligned rectangle in CSS pixels (top-left origin, like the screen). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Safe-area insets in CSS pixels (notches, rounded corners, the Android navigation bar). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Where a touch started. A gesture belongs to the zone it started in for its whole life, so a swipe that starts on the
 * right (offence) and ends on the left is still a strike.
 */
export type Zone = 'offence' | 'defence' | 'move' | 'kick' | 'shoot' | 'special' | 'ignore';

/**
 * The control layout on screen: one source of truth for both the drawn buttons (src/ui/fight/touch-overlay.ts
 * positions them from these rectangles) and the recogniser's hit zones, so what you see is what you press.
 * `*Zone` rectangles are the generous touch areas; the plain ones are the drawn shapes.
 */
export interface TouchLayout {
  width: number;
  height: number;
  /** Left-handed layout: offence on the left half, defence on the right. */
  mirrored: boolean;
  /** x where the defence half ends and the offence half begins (or the other way round when mirrored). */
  splitX: number;
  /** The footwork pad as drawn, and the larger corner area that drives it. */
  movePad: Rect;
  moveZone: Rect;
  kick: Rect;
  kickZone: Rect;
  shoot: Rect;
  shootZone: Rect;
  special: Rect;
  specialZone: Rect;
  /** The pause button: touches here are never fight input. */
  pause: Rect;
  /** Pixels per dp the thresholds were scaled with (kept for the overlay's drawing). */
  pxPerDp: number;
}

/**
 * What the fight is doing right now, from the controlled fighter's point of view. The game derives it from the
 * simulation's state each tick (see docs/notes/controls.md, "Wiring").
 *  - stand:  normal striking.
 *  - ground: the ground scramble: swipes answer the direction prompts, taps are ground-and-pound, hold blocks.
 *  - sub:    a submission tug-of-war: every touch anywhere is a mash tap.
 *  - locked: banners, knockdown counts, replays: touches are tracked but produce no input.
 */
export type FightMode = 'stand' | 'ground' | 'sub' | 'locked';

export interface TouchContext {
  mode: FightMode;
  /** The screen x direction that points at the opponent: +1 when the opponent is to the right. */
  forward: 1 | -1;
  /** The opponent is shooting a takedown: any downward swipe, and the TAKEDOWN button, sprawl. */
  sprawl: boolean;
  /** The special meter is full: the SPECIAL button is live (otherwise its area is ordinary offence). */
  specialReady: boolean;
}

export const DEFAULT_CONTEXT: Readonly<TouchContext> = Object.freeze({
  mode: 'stand',
  forward: 1,
  sprawl: false,
  specialReady: false,
});

/**
 * Eight swipe directions relative to the opponent: F = toward them, B = away, U = up, D = down, and the diagonals.
 * Screen up is always U; F flips with `TouchContext.forward`.
 */
export type Dir8 = 'F' | 'UF' | 'U' | 'UB' | 'B' | 'DB' | 'D' | 'DF';

/** One recognised action waiting for a simulation tick. */
export type Action =
  | { k: 'strike'; strike: Strike }
  | { k: 'special' }
  | { k: 'shoot' }
  | { k: 'evade'; evade: Evade }
  | { k: 'ground'; dir: GroundDir }
  | { k: 'tap' }
  /** A grab: a clinch attempt standing at close range (FightInput.clinch). */
  | { k: 'clinch' };

/** How a gesture was made (for feedback and the HUD lab readout). */
export type GestureKind = 'tap' | 'swipe' | 'twoFinger' | 'kickMod' | 'button' | 'flick' | 'mash' | 'key' | 'hold';

/** A recognised gesture, for on-screen feedback (swipe streaks, labels) and the lab readout. Not fight input. */
export interface GestureEvent {
  action: Action;
  gesture: GestureKind;
  zone: Zone;
  /** The swipe direction when there was one. */
  dir: Dir8 | null;
  /** Where it started and ended (CSS px). Keyboard actions use -1. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Timestamp (ms) of the event that completed it. */
  t: number;
}

/** A touch that is currently down, for drawing (pressed buttons, the move pad knob, the block glow). */
export interface ActiveTouch {
  id: number;
  zone: Zone;
  x: number;
  y: number;
  /** For the move pad: the floating origin the knob is measured from. */
  ox: number;
  /** True while this touch holds the guard up. */
  blocking: boolean;
  /** -1/0/+1 in SCREEN terms (move pad only). */
  moveX: -1 | 0 | 1;
}

/**
 * Gesture thresholds, in dp (density-independent pixels: 1 dp is 1/160 inch; in an Android WebView 1 CSS px is 1 dp)
 * and milliseconds. Scaled to CSS pixels by `pxPerDp` when the recogniser is created.
 */
export interface TouchConfig {
  /** A tap may move at most this far... */
  tapSlopDp: number;
  /** ...and last at most this long; a longer still press on the offence side is a rest, not a jab. */
  tapMaxMs: number;
  /** A swipe is measured over the most recent window of movement, so a resting thumb can still swipe. */
  swipeWindowMs: number;
  /** A release with at least this much recent movement is a swipe. */
  swipeMinDp: number;
  /** A swipe fires as soon as it covers this much, before the finger lifts (lower latency). */
  commitDp: number;
  /** A defence flick needs this much movement within the window (slow drags keep blocking). */
  flickDp: number;
  /** An offence swipe down at least this long is a takedown... */
  takedownDp: number;
  /** ...capped to this fraction of the screen height so it always fits. */
  takedownMaxFrac: number;
  /** A body shot (a short swipe down) fires on release, or when the finger stops for this long. */
  downSettleMs: number;
  /** A second offence finger landing within this time of the first makes a two-finger kick. */
  twoFingerMs: number;
  /** One offence finger held still this long is a grab (a clinch attempt); must be longer than tapMaxMs. */
  grabHoldMs: number;
  /** Half-width of the straight (non-diagonal) direction sectors, in degrees: wider = fewer accidental hooks. */
  straightHalfAngleDeg: number;
  /** A finger that has fired a swipe re-arms once it has stayed within the tap slop for this long. */
  settleMs: number;
  /** Move pad: dead zone, and how far the knob can go before the origin follows the thumb. */
  moveDeadDp: number;
  moveMaxDp: number;
  /** A held defence touch starts blocking after this long (0 = at once). */
  blockDelayMs: number;
  /** Actions waiting longer than this for a tick are dropped (a paused game must not fire old taps). */
  bufferMs: number;
  /** At most this many fingers are tracked (a palm on the glass is not ten jabs). */
  maxTouches: number;
}
