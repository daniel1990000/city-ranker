// Gamepad / keyboard mapping (docs/14 §2.1). The platform adapter delivers raw state; this turns it into Intent frames.
//   Left stick: move (relative to the opponent)      X / Y: lead / back punch      A / B: lead / back kick
//   LT (hold): body        RT: guard (stick down = low), quick tap = parry     RB: hold = sig, double-tap = tech, double-tap + hold = tech+sig
//   LB: tap = clinch (or shot when the stick points at the opponent)      R3: switch stance
// Stick forward/back with a strike picks the fwd/bwd slot variants; kick + stick down = leg kick.

import { greaterThanWithHysteresis } from '../core/math.js';
import { emptyIntent } from './intent.js';

export const RB_DOUBLE_TAP_TICKS = 16;       // ~260 ms
export const PARRY_TAP_TICKS = 11;           // ~180 ms
export const SHOT_HOLD_TICKS = 8;

export class GamepadMapper {
  constructor() {
    this.prev = {}; this.guardOn = false; this.rtDownTick = -99; this.lbDownTick = -99;
    this.rbLastPress = -99; this.rbMode = 'none'; this.rbHeldFrom = -99;
  }

  /**
   * @param s {lx, ly, rt, lt, buttons:{X,Y,A,B,LB,RB,R3}}  ly < 0 = stick up
   * @param ctx {tick, toOpponent:{x,y} (unit), range (edge gap), clinchRange, mode:'standup'|'clinch'|'ground', legal:[] (bout.legalActions)}
   */
  update(s, ctx) {
    const i = emptyIntent();
    const b = s.buttons ?? {}, p = this.prev, tick = ctx.tick;
    const pressed = (k) => !!b[k] && !p[k], released = (k) => !b[k] && !!p[k];
    const fwd = ctx.toOpponent ?? { x: 1, y: 0 }, side = { x: -fwd.y, y: fwd.x };
    // movement: stick up = toward the opponent
    const mx = fwd.x * -s.ly + side.x * s.lx, my = fwd.y * -s.ly + side.y * s.lx;
    const mag = Math.min(1, Math.hypot(mx, my));
    i.move = mag > 1e-3 ? { x: (mx / Math.hypot(mx, my)) * mag, y: (my / Math.hypot(mx, my)) * mag } : { x: 0, y: 0 };

    // guard (hysteresis) and parry
    const was = this.guardOn;
    this.guardOn = greaterThanWithHysteresis(s.rt ?? 0, 0.35, 0.25, was);
    if (this.guardOn && !was) this.rtDownTick = tick;
    if (!this.guardOn && was && tick - this.rtDownTick <= PARRY_TAP_TICKS) i.parry = true;
    else if (this.guardOn) i.guard = s.ly > 0.5 ? 'low' : 'high';

    // right bumper modifier state machine
    if (pressed('RB')) { this.rbMode = tick - this.rbLastPress <= RB_DOUBLE_TAP_TICKS ? 'techPending' : 'sigPending'; this.rbHeldFrom = tick; this.rbLastPress = tick; }
    if (b.RB && tick - this.rbHeldFrom >= 2) { if (this.rbMode === 'sigPending') this.rbMode = 'sig'; else if (this.rbMode === 'techPending') this.rbMode = 'techSig'; }
    if (released('RB')) { if (this.rbMode === 'techPending') this.rbMode = 'techTap'; else if (this.rbMode !== 'techTap') this.rbMode = 'none'; }
    if (this.rbMode === 'techTap' && tick - this.rbLastPress > RB_DOUBLE_TAP_TICKS + 4) this.rbMode = 'none';
    const mod = { none: '', sigPending: '', sig: 'sig', techPending: 'tech', techSig: 'tech_sig', techTap: 'tech' }[this.rbMode];

    if (ctx.mode === 'standup') this.#standup(i, s, ctx, pressed, mod, tick);
    else this.#paired(i, s, ctx, pressed);

    if (pressed('R3')) i.switchStance = true;
    this.prev = { ...b };
    return i;
  }

  #standup(i, s, ctx, pressed, mod, tick) {
    const b = s.buttons ?? {};
    for (const [btn, limb, side] of [['X', 'punch', 'lead'], ['Y', 'punch', 'back'], ['A', 'kick', 'lead'], ['B', 'kick', 'back']]) {
      if (!pressed(btn)) continue;
      const target = s.lt > 0.35 ? 'body' : (limb === 'kick' && s.ly > 0.5 && !mod) ? 'leg' : 'head';
      let slot = mod || 'basic';
      const dir = s.ly < -0.5 ? 'fwd' : s.ly > 0.5 && target !== 'leg' ? 'bwd' : '';
      if (dir) slot = slot === 'basic' ? dir : `${slot}_${dir}`;
      if (slot === 'tech_sig_fwd' || slot === 'tech_sig_bwd') slot = 'tech_sig';
      i.strike = { limb, side, slot, target };
    }
    if (pressed('LB')) this.lbDownTick = tick;
    if (b.LB && s.ly < -0.5 && tick - this.lbDownTick >= SHOT_HOLD_TICKS && (ctx.range ?? 0) > (ctx.clinchRange ?? 0.3)) i.takedown = { dir: 'fwd', size: 'major' };
    else if (!b.LB && this.prev.LB && tick - this.lbDownTick < SHOT_HOLD_TICKS) i.clinch = {};
  }

  /** In a clinch or on the ground the face buttons pick from what the bout says is legal. */
  #paired(i, s, ctx, pressed) {
    const legal = ctx.legal ?? [];
    const first = (pred) => legal.find(pred);
    const stickIndex = (n) => Math.min(n - 1, Math.max(0, Math.round(((s.lx + 1) / 2) * (n - 1))));
    if (pressed('X')) { const o = legal.filter((a) => a.kind === 'strike'); if (o.length) i.grapple = { ...o[stickIndex(o.length)] }; }
    if (pressed('Y')) { const a = first((x) => x.kind === 'strike' && (x.strike === 'elbow' || x.strike === 'hammer')); if (a) i.grapple = { ...a }; }
    if (pressed('A')) { const o = legal.filter((a) => a.kind === 'transition' || a.kind === 'pummel'); if (o.length) i.grapple = { ...o[stickIndex(o.length)] }; }
    if (pressed('B')) { const o = legal.filter((a) => a.kind === 'submission' || a.kind === 'takedown'); if (o.length) i.grapple = { ...o[stickIndex(o.length)] }; }
    if (pressed('LB')) { const a = first((x) => x.kind === 'getup' || x.kind === 'break'); if (a) i.grapple = { ...a }; }
    if (this.guardOn) i.guard = 'high';
    delete i.grapple?.edge; delete i.grapple?.moveId;
  }
}

/** Keyboard layout → the same state shape the GamepadMapper consumes. */
export function keyboardToPadState(keys) {
  const axis = (neg, pos) => (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0);
  return {
    lx: axis('a', 'd'), ly: axis('w', 's'), lt: keys.shift ? 1 : 0, rt: keys.space ? 1 : 0,
    buttons: { X: !!keys.j, Y: !!keys.k, A: !!keys.u, B: !!keys.i, LB: !!keys.e, RB: !!keys.q, R3: !!keys.tab },
  };
}
