// Keyboard controls for desktop and web testing. Keys are matched by physical position (KeyboardEvent.code), so
// they sit in the same place on QWERTY, AZERTY and QWERTZ keyboards. The full table is in docs/notes/controls.md.
//
//   Left hand (defence and footwork)        Right hand (offence)
//   A / D or ← / →  step left / right       J  jab            U  lead hook      I  rear hook
//   S or ↓ (hold)   block                   K  cross          O  uppercut       L  body shot
//   Q / E           slip left / right       N  low kick       M  body kick      ,  head kick
//   W               sway back               H  special        Space  takedown (sprawl when they shoot)
//   Ground: arrows or W/A/S/D answer the prompts, J / K / Space strike (ground-and-pound), Shift blocks.
//   Submission: any of J, K, L, F, Space, Enter mashes.
//   Esc / P pauses (handled by the UI, not here).

import type { Evade, GroundDir, Strike } from '../fight/types';

/** What a key does while standing. */
export type StandKey =
  | { k: 'strike'; strike: Strike }
  | { k: 'special' }
  | { k: 'shoot' }
  | { k: 'evade'; evade: Evade }
  | { k: 'block' }
  /** Screen direction: -1 left, +1 right (converted to toward/away from the opponent). */
  | { k: 'move'; x: -1 | 1 };

export const STAND_KEYS: Readonly<Record<string, StandKey>> = Object.freeze({
  KeyJ: { k: 'strike', strike: 'jab' },
  KeyK: { k: 'strike', strike: 'cross' },
  KeyU: { k: 'strike', strike: 'hookL' },
  KeyI: { k: 'strike', strike: 'hookR' },
  KeyO: { k: 'strike', strike: 'uppercut' },
  KeyL: { k: 'strike', strike: 'bodyShot' },
  KeyN: { k: 'strike', strike: 'lowKick' },
  KeyM: { k: 'strike', strike: 'bodyKick' },
  Comma: { k: 'strike', strike: 'headKick' },
  KeyH: { k: 'special' },
  Space: { k: 'shoot' },
  KeyQ: { k: 'evade', evade: 'left' },
  KeyE: { k: 'evade', evade: 'right' },
  KeyW: { k: 'evade', evade: 'back' },
  KeyS: { k: 'block' },
  ArrowDown: { k: 'block' },
  ShiftLeft: { k: 'block' },
  ShiftRight: { k: 'block' },
  KeyA: { k: 'move', x: -1 },
  ArrowLeft: { k: 'move', x: -1 },
  KeyD: { k: 'move', x: 1 },
  ArrowRight: { k: 'move', x: 1 },
} satisfies Record<string, StandKey>);

/** What a key does on the ground. */
export type GroundKey = { k: 'ground'; dir: GroundDir } | { k: 'tap' } | { k: 'block' };

export const GROUND_KEYS: Readonly<Record<string, GroundKey>> = Object.freeze({
  ArrowUp: { k: 'ground', dir: 'up' },
  ArrowDown: { k: 'ground', dir: 'down' },
  ArrowLeft: { k: 'ground', dir: 'left' },
  ArrowRight: { k: 'ground', dir: 'right' },
  KeyW: { k: 'ground', dir: 'up' },
  KeyS: { k: 'ground', dir: 'down' },
  KeyA: { k: 'ground', dir: 'left' },
  KeyD: { k: 'ground', dir: 'right' },
  KeyJ: { k: 'tap' },
  KeyK: { k: 'tap' },
  Space: { k: 'tap' },
  ShiftLeft: { k: 'block' },
  ShiftRight: { k: 'block' },
} satisfies Record<string, GroundKey>);

/** Keys that mash in a submission. */
export const SUB_KEYS: ReadonlySet<string> = new Set(['KeyJ', 'KeyK', 'KeyL', 'KeyF', 'Space', 'Enter', 'NumpadEnter']);

/** Every code the controls use (the DOM layer calls preventDefault only for these, so browser shortcuts still work). */
export function isGameKey(code: string): boolean {
  return code in STAND_KEYS || code in GROUND_KEYS || SUB_KEYS.has(code);
}
