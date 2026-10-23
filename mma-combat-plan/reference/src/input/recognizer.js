// Touch recognizer (docs/14 §2.2): raw pointer events → gestures → Intent fragments.
//   left 40 % of the screen = floating virtual stick (leash-filtered), right 60 % = action zone.
// Action-zone gestures: tap (light), swipe (head/body target, hook/cross by direction, length → medium),
// press-and-hold-then-release (heavy, charge scales damage), loaded swipe (hold, then swipe), double-tap (stance/catch),
// two-finger tap (takedown shot). Guard is a button: hold = block, quick tap = parry.
// All distances are in dp and scaled by `density`; all times are ms.

import { LeashFilter, clamp } from '../core/math.js';
import { emptyIntent } from './intent.js';

export const TOUCH = Object.freeze({
  TAP_MS: 180, TAP_SLOP_DP: 12, SWIPE_MIN_DP: 24, SWIPE_MIN_SPEED: 400, SWIPE_MEDIUM_DP: 90,
  HOLD_MS: 250, CHARGE_MAX_MS: 800, DOUBLE_TAP_MS: 260, TWO_FINGER_MS: 120,
  STICK_ZONE: 0.4, STICK_RADIUS_DP: 60, LEASH_DP: 14,
});

export class TouchRecognizer {
  /** @param o {width, height (px), density (px per dp)} */
  constructor({ width = 1280, height = 720, density = 1 } = {}) {
    this.w = width; this.h = height; this.density = density;
    this.touches = new Map();          // id → {zone, x0, y0, t0, x, y, t, held}
    this.stickTouch = null;
    this.leash = new LeashFilter();
    this.stick = { x: 0, y: 0 };
    this.lastTap = null;               // {t}
    this.multiPending = new Map();     // first release of a two-finger pair → waits for its partner
    this.events = [];
    this.guard = { down: false, t: 0 };
  }

  px(dp) { return dp * this.density; }
  zoneOf(x) { return x < this.w * TOUCH.STICK_ZONE ? 'stick' : 'action'; }

  handle(ev) {
    const { type, id, x, y, t } = ev;
    if (type === 'down') {
      const zone = this.zoneOf(x);
      const tc = { zone, id, x0: x, y0: y, t0: t, x, y, t, multi: false, partner: null };
      this.touches.set(id, tc);
      if (zone === 'action') {                                  // a second finger landing within 120 ms of the first makes a two-finger pair
        for (const o of this.touches.values()) {
          if (o !== tc && o.zone === 'action' && !o.multi && t - o.t0 <= TOUCH.TWO_FINGER_MS) { tc.multi = o.multi = true; tc.partner = o.id; o.partner = id; }
        }
      }
      if (zone === 'stick' && this.stickTouch === null) { this.stickTouch = id; this.leash.update({ x, y }, 0, true); }
    } else if (type === 'move') {
      const tc = this.touches.get(id);
      if (!tc) return;
      tc.x = x; tc.y = y; tc.t = t;
      if (id === this.stickTouch) this.#updateStick(tc);
    } else if (type === 'up' || type === 'cancel') {
      const tc = this.touches.get(id);
      if (!tc) return;
      tc.x = x ?? tc.x; tc.y = y ?? tc.y; tc.t = t;
      this.touches.delete(id);
      if (id === this.stickTouch) { this.stickTouch = null; this.stick = { x: 0, y: 0 }; return; }
      if (type === 'up' && tc.zone === 'action') this.#classify(tc, t);
    }
  }

  #updateStick(tc) {
    const p = this.leash.update({ x: tc.x, y: tc.y }, this.px(TOUCH.LEASH_DP));
    const r = this.px(TOUCH.STICK_RADIUS_DP);
    const v = { x: (p.x - tc.x0) / r, y: (p.y - tc.y0) / r };
    const m = Math.hypot(v.x, v.y);
    this.stick = m > 1 ? { x: v.x / m, y: v.y / m } : v;
  }

  #classify(tc, t) {
    const dx = tc.x - tc.x0, dy = tc.y - tc.y0, dist = Math.hypot(dx, dy), dur = Math.max(1, t - tc.t0);
    const slop = this.px(TOUCH.TAP_SLOP_DP), zone = tc.y0 < this.h / 2 ? 'upper' : 'lower';
    const held = dur >= TOUCH.HOLD_MS;
    const charge = clamp((dur - TOUCH.HOLD_MS) / (TOUCH.CHARGE_MAX_MS - TOUCH.HOLD_MS), 0, 1);
    const short = dur <= TOUCH.TAP_MS && dist <= slop;
    if (tc.multi) {                                            // two-finger tap: both fingers short, no tap events for either
      const pend = this.multiPending.get(tc.partner);
      if (pend) { this.multiPending.delete(tc.partner); if (short && pend.short) { this.lastTap = null; this.events.push({ kind: 'twoFingerTap', t }); } return; }
      this.multiPending.set(tc.id, { short });
      return;
    }
    const farEnough = dist >= this.px(TOUCH.SWIPE_MIN_DP);
    if (farEnough && (dist / (dur / 1000) >= TOUCH.SWIPE_MIN_SPEED || held)) {          // a fast flick, or a loaded swipe after a hold
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      this.events.push({ kind: 'swipe', dir, medium: dist >= this.px(TOUCH.SWIPE_MEDIUM_DP), loaded: held, charge: held ? charge : 0, zone, t });
      return;
    }
    if (dist <= slop && held) { this.events.push({ kind: 'hold', charge, zone, t }); return; }
    if (dist <= slop && dur < TOUCH.HOLD_MS) {                                           // a quick press; > TAP_MS is flagged `late`
      if (this.lastTap && t - this.lastTap.t <= TOUCH.DOUBLE_TAP_MS) { this.lastTap = null; this.events.push({ kind: 'doubleTap', zone, t }); return; }
      this.lastTap = { t };
      this.events.push({ kind: 'tap', zone, late: dur > TOUCH.TAP_MS, t });
    }
  }

  /** Guard button (UI): hold = block, a quick press-release = parry. */
  button(id, down, t) {
    if (id !== 'guard') return;
    if (down) this.guard = { down: true, t };
    else { if (t - this.guard.t <= TOUCH.TAP_MS) this.events.push({ kind: 'parry', t }); this.guard = { down: false, t }; }
  }

  /** Drain the gesture events recognised since the last call. */
  take() { const e = this.events; this.events = []; return e; }
}

/** Map one gesture to a strike request (or other intent fragment). `ctx.catchReady` turns a double-tap into a catch. */
export function gestureToIntent(g, ctx = {}) {
  const i = emptyIntent();
  const punch = g.zone === 'upper';
  switch (g.kind) {
    case 'tap':
      i.strike = punch ? { limb: 'punch', side: 'lead', slot: 'basic', target: 'head', power: 'light' } : { limb: 'kick', side: 'lead', slot: 'basic', target: 'body', power: 'light' };
      break;
    case 'swipe': {
      const target = g.dir === 'down' ? (punch ? 'body' : 'leg') : 'head';
      const power = g.loaded ? 'heavy' : g.medium ? 'medium' : 'light';
      const side = g.dir === 'left' ? 'lead' : g.dir === 'right' ? 'back' : (ctx.lastSide ?? 'lead');
      const hook = g.dir === 'left' || g.dir === 'right';
      i.strike = { limb: punch ? 'punch' : 'kick', side, slot: punch && hook && g.dir === 'left' ? 'tech' : 'basic', target, power, chargeTicks: Math.round(g.charge * 30) };
      break;
    }
    case 'hold':
      i.strike = punch ? { limb: 'punch', side: 'back', slot: 'tech', target: 'head', power: 'heavy', chargeTicks: Math.round(g.charge * 48) } : { limb: 'kick', side: 'back', slot: 'basic', target: 'head', power: 'heavy', chargeTicks: Math.round(g.charge * 48) };
      break;
    case 'doubleTap': if (ctx.catchReady) i.catch = true; else i.switchStance = true; break;
    case 'twoFingerTap': i.takedown = { dir: 'fwd', size: 'major' }; break;
    case 'parry': i.parry = true; break;
    default: break;
  }
  return i;
}
