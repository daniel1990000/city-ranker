import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchRecognizer, gestureToIntent, TOUCH } from '../src/input/recognizer.js';
import { GamepadMapper, keyboardToPadState } from '../src/input/mapping.js';
import { InputBuffer, STRIKE_BUFFER_TICKS } from '../src/input/buffer.js';
import { emptyIntent, compactIntent, expandIntent, quantizeIntent, isIdle } from '../src/input/intent.js';
import { Slot } from '../src/core/taxonomy.js';
import { FightSim } from '../src/sim/fight-sim.js';
import { spec } from '../src/testing/helpers.js';

// A 1280x720 screen; action zone = x >= 512. Helper: perform one touch in the action zone and return the first gesture.
function touch(rec, { x0 = 900, y0 = 200, dx = 0, dy = 0, ms = 100, id = 1, t0 = 1000 } = {}) {
  rec.handle({ type: 'down', id, x: x0, y: y0, t: t0 });
  rec.handle({ type: 'move', id, x: x0 + dx / 2, y: y0 + dy / 2, t: t0 + ms / 2 });
  rec.handle({ type: 'up', id, x: x0 + dx, y: y0 + dy, t: t0 + ms });
  return rec.take();
}

test('tap: quick press with little drift; boundary values and DPI scaling', () => {
  const r = new TouchRecognizer({ density: 1 });
  assert.equal(touch(r, { ms: 100, dx: 11 })[0].kind, 'tap');
  assert.equal(touch(r, { ms: 179, dx: 0, t0: 5000 })[0].late, false);
  assert.equal(touch(r, { ms: 181, dx: 0, t0: 9000 })[0].late, true, 'late taps still count');
  assert.deepEqual(touch(r, { ms: 100, dx: 18, t0: 20000 }), [], 'between the tap slop (12 dp) and the swipe minimum (24 dp) → nothing');
  // density 2: 12 dp = 24 px. 20 px of drift is a tap on a dense screen, dead zone on a 1x screen
  const r2 = new TouchRecognizer({ density: 2 });
  assert.equal(touch(r2, { ms: 100, dx: 20 })[0].kind, 'tap');
  assert.equal(touch(r2, { ms: 100, dx: 47, t0: 5000 }).length, 0, '47 px = 23.5 dp < 24 dp swipe minimum');
  assert.equal(touch(r2, { ms: 80, dx: 48, t0: 9000 })[0].kind, 'swipe', '48 px = 24 dp in 80 ms = 600 px/s');
});

test('swipe: direction by dominant axis, minimum length and speed, medium at 90 dp', () => {
  const r = new TouchRecognizer();
  const dirs = { left: [-60, 0], right: [60, 0], up: [0, -60], down: [0, 60] };
  for (const [name, [dx, dy]] of Object.entries(dirs)) {
    const g = touch(r, { dx, dy, ms: 100, t0: 1000 + 1000 * Object.keys(dirs).indexOf(name) })[0];
    assert.equal(g.kind, 'swipe'); assert.equal(g.dir, name); assert.equal(g.medium, false);
  }
  assert.equal(touch(r, { dx: 89, ms: 100, t0: 10000 })[0].medium, false);
  assert.equal(touch(r, { dx: 90, ms: 100, t0: 12000 })[0].medium, true);
  assert.deepEqual(touch(r, { dx: 40, ms: 200, t0: 15000 }), [], '200 px/s is a drag, not a flick');
  assert.equal(touch(r, { dx: 25, ms: 62, t0: 18000 })[0].kind, 'swipe', '~403 px/s');
  assert.deepEqual(touch(r, { dx: 25, ms: 63, t0: 20000 }), [], '~397 px/s is too slow');
});

test('hold: 250 ms threshold, charge ramps to 1 at 800 ms and clamps; loaded swipe keeps the charge', () => {
  const r = new TouchRecognizer();
  assert.equal(touch(r, { ms: 249 })[0].kind, 'tap');
  const h0 = touch(r, { ms: 250, t0: 5000 })[0];
  assert.deepEqual([h0.kind, h0.charge], ['hold', 0]);
  const hm = touch(r, { ms: 525, t0: 9000 })[0];
  assert.ok(Math.abs(hm.charge - 0.5) < 0.01);
  assert.equal(touch(r, { ms: 800, t0: 13000 })[0].charge, 1);
  assert.equal(touch(r, { ms: 2000, t0: 17000 })[0].charge, 1);
  const loaded = touch(r, { ms: 600, dx: 70, t0: 21000 })[0];
  assert.deepEqual([loaded.kind, loaded.loaded, loaded.dir], ['swipe', true, 'right']);
  assert.ok(loaded.charge > 0.5);
});

test('double tap, two-finger tap and the parry button', () => {
  const r = new TouchRecognizer();
  assert.equal(touch(r, { ms: 60, t0: 1000 })[0].kind, 'tap');
  assert.equal(touch(r, { ms: 60, t0: 1200 })[0].kind, 'doubleTap', 'second tap within 260 ms');
  assert.equal(touch(r, { ms: 60, t0: 2000 })[0].kind, 'tap');
  assert.equal(touch(r, { ms: 60, t0: 2300 })[0].kind, 'tap', 'second tap too late');
  // two fingers
  const r2 = new TouchRecognizer();
  r2.handle({ type: 'down', id: 1, x: 800, y: 200, t: 100 }); r2.handle({ type: 'down', id: 2, x: 900, y: 300, t: 105 });
  r2.handle({ type: 'up', id: 1, x: 800, y: 200, t: 150 }); r2.handle({ type: 'up', id: 2, x: 900, y: 300, t: 160 });
  const ev = r2.take();
  assert.ok(ev.some((e) => e.kind === 'twoFingerTap'), JSON.stringify(ev));
  assert.ok(!ev.some((e) => e.kind === 'tap' || e.kind === 'doubleTap'));
  // guard button: quick press → parry, hold → no parry
  const r3 = new TouchRecognizer();
  r3.button('guard', true, 0); r3.button('guard', false, 120);
  assert.equal(r3.take()[0].kind, 'parry');
  r3.button('guard', true, 1000); r3.button('guard', false, 1400);
  assert.deepEqual(r3.take(), []);
});

test('gestures → intents: zone picks punch/kick, swipe picks target / side / power', () => {
  const i = (g) => gestureToIntent({ zone: 'upper', ...g }).strike;
  assert.deepEqual(i({ kind: 'tap' }), { limb: 'punch', side: 'lead', slot: 'basic', target: 'head', power: 'light' });
  assert.equal(gestureToIntent({ kind: 'tap', zone: 'lower' }).strike.limb, 'kick');
  assert.deepEqual([i({ kind: 'swipe', dir: 'down', medium: true, charge: 0 }).target, i({ kind: 'swipe', dir: 'down', medium: true, charge: 0 }).power], ['body', 'medium']);
  assert.equal(gestureToIntent({ kind: 'swipe', dir: 'down', zone: 'lower', medium: false, charge: 0 }).strike.target, 'leg');
  assert.equal(i({ kind: 'swipe', dir: 'right', medium: false, charge: 0 }).side, 'back');
  assert.equal(i({ kind: 'swipe', dir: 'left', medium: false, charge: 0 }).slot, 'tech');
  assert.equal(i({ kind: 'swipe', dir: 'up', loaded: true, charge: 1 }).power, 'heavy');
  assert.equal(i({ kind: 'hold', charge: 0.5 }).power, 'heavy');
  assert.ok(i({ kind: 'hold', charge: 0.5 }).chargeTicks > 0);
  assert.equal(gestureToIntent({ kind: 'doubleTap', zone: 'upper' }).switchStance, true);
  assert.equal(gestureToIntent({ kind: 'doubleTap', zone: 'upper' }, { catchReady: true }).catch, true);
  assert.deepEqual(gestureToIntent({ kind: 'twoFingerTap' }).takedown, { dir: 'fwd', size: 'major' });
});

test('virtual stick: floating origin, magnitude <= 1, jitter inside the leash is ignored, release returns zero', () => {
  const r = new TouchRecognizer({ density: 1 });
  r.handle({ type: 'down', id: 7, x: 150, y: 500, t: 0 });
  assert.deepEqual(r.stick, { x: 0, y: 0 });
  r.handle({ type: 'move', id: 7, x: 150 + 8, y: 500, t: 10 });
  assert.deepEqual(r.stick, { x: 0, y: 0 }, '8 dp of jitter is inside the 14 dp leash');
  r.handle({ type: 'move', id: 7, x: 150 + 74, y: 500, t: 20 });
  assert.ok(Math.abs(r.stick.x - (74 - 14) / 60) < 1e-9 || Math.abs(r.stick.x - 1) < 1e-9, `${r.stick.x}`);
  for (let k = 0; k < 400; k++) {
    r.handle({ type: 'move', id: 7, x: 150 + 300 * Math.sin(k), y: 500 + 300 * Math.cos(k * 1.3), t: 30 + k });
    assert.ok(Math.hypot(r.stick.x, r.stick.y) <= 1 + 1e-9);
  }
  r.handle({ type: 'up', id: 7, x: 0, y: 0, t: 5000 });
  assert.deepEqual(r.stick, { x: 0, y: 0 });
  assert.deepEqual(r.take(), [], 'stick touches are never gestures');
});

test('intent frames: compact ↔ expand round trip, quantisation, idle detection', () => {
  const i = emptyIntent();
  assert.ok(isIdle(i));
  i.move = { x: 0.123456, y: -0.5 }; i.guard = 'high'; i.strike = { limb: 'punch', side: 'lead', slot: 'basic', target: 'head' }; i.parry = true;
  const c = compactIntent(i);
  assert.deepEqual(Object.keys(c).sort(), ['guard', 'move', 'parry', 'strike']);
  const back = expandIntent(c);
  assert.equal(back.guard, 'high'); assert.equal(back.parry, true); assert.equal(back.catch, false); assert.equal(back.move.x, 0.123);
  assert.deepEqual(quantizeIntent(i).move, { x: 0.123, y: -0.5 });
  assert.ok(!isIdle(i));
});

test('buffer: a strike pressed during recovery fires exactly when the cancel window opens; stale presses are dropped', () => {
  const buf = new InputBuffer();
  buf.push(10, 'strike', { id: 'x' });
  assert.deepEqual(buf.latest('strike', 10 + STRIKE_BUFFER_TICKS, STRIKE_BUFFER_TICKS).payload, { id: 'x' });
  assert.equal(buf.latest('strike', 10 + STRIKE_BUFFER_TICKS + 1, STRIKE_BUFFER_TICKS), null, 'older than 6 ticks');
  buf.push(20, 'strike', { id: 'a' }); buf.push(21, 'strike', { id: 'b' });
  assert.deepEqual(buf.consume('strike', 22, 6), { id: 'b' }, 'newest wins, duplicates are cleared');
  assert.equal(buf.latest('strike', 22, 6), null);
  buf.push(100, 'parry');
  assert.equal(buf.size, 30);
  buf.push(131, 'x');
  assert.equal(buf.latest('parry', 131, 40), null, 'ring keeps 30 ticks');

  // in the sim: jab, then request a cross while the jab is still in startup → it starts at the first cancel tick
  const sim = new FightSim({ seed: 3, fighters: [spec('a'), spec('b')], controllers: { a: false, b: false }, record: true });
  const jab = { moveId: 'lead_jab_head', limb: 'punch', side: 'lead', slot: 'basic', target: 'head' };
  const cross = { moveId: 'back_cross_head', limb: 'punch', side: 'back', slot: 'basic', target: 'head' };
  sim.step({ a: { ...emptyIntent(), strike: jab } });
  const A = sim.world.fighters[0];
  assert.equal(A.action.move.id, 'lead_jab_head');
  const startupTick = sim.world.tick;
  sim.step({ a: { ...emptyIntent(), strike: cross } });
  const requestTick = sim.world.tick;
  assert.equal(A.action.move.id, 'lead_jab_head', 'jab startup is not cancellable');
  let fired = null;
  for (let k = 0; k < 12 && !fired; k++) { sim.step({ a: emptyIntent() }); if (A.action?.move.id === 'back_cross_head') fired = sim.world.tick; }
  const jabMove = sim.world.moveBook.get('lead_jab_head');
  assert.ok(fired !== null && fired - requestTick <= STRIKE_BUFFER_TICKS, `fired ${fired - requestTick} ticks after the press`);
  assert.equal(fired - startupTick, jabMove.cancel.out[0][0], 'exactly when the cancel window opens (after the active frames)');
  // a request for a move the current one cannot cancel into is never started (and expires) — it must not fire after the jab ends
  const sim2 = new FightSim({ seed: 3, fighters: [spec('a'), spec('b')], controllers: { a: false, b: false }, record: true });
  const B = sim2.world.fighters[0];
  sim2.step({ a: { ...emptyIntent(), strike: jab } });
  const notChainable = { moveId: 'back_spinheel_head', limb: 'kick', side: 'back', slot: 'sig', target: 'head' };
  sim2.step({ a: { ...emptyIntent(), strike: notChainable } });
  for (let k = 0; k < 4 * STRIKE_BUFFER_TICKS; k++) sim2.step({ a: emptyIntent() });
  assert.notEqual(B.action?.move.id, 'back_spinheel_head', 'a stale buffered request never starts late');
});

const pad = (o = {}) => ({ lx: 0, ly: 0, lt: 0, rt: 0, buttons: {}, ...o });

test('gamepad: every strike slot is reachable, targets follow LT / stick-down, fwd/bwd follow the stick', () => {
  const slots = new Set();
  const press = (state, ctxOver = {}) => {
    const m = new GamepadMapper();
    let out = null;
    const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 0.6, clinchRange: 0.3, ...ctxOver };
    m.update(pad({ ...state, buttons: {} }), ctx);
    ctx.tick = 1;
    out = m.update(pad(state), ctx);
    return out;
  };
  for (const btn of ['X', 'Y', 'A', 'B']) for (const ly of [-1, 0, 1]) for (const lt of [0, 1]) {
    const o = press({ ly, lt, buttons: { [btn]: true } });
    assert.ok(o.strike, `${btn} ly=${ly} lt=${lt}`);
    slots.add(o.strike.slot);
  }
  // sig: hold RB then strike
  const holdRb = (extra, btn = 'X') => {
    const m = new GamepadMapper();
    const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 0.6, clinchRange: 0.3 };
    m.update(pad({ buttons: {} }), ctx);
    ctx.tick = 1; m.update(pad({ buttons: { RB: true } }), ctx);
    ctx.tick = 5; m.update(pad({ buttons: { RB: true } }), ctx);
    ctx.tick = 6; return m.update(pad({ ...extra, buttons: { RB: true, [btn]: true } }), ctx);
  };
  for (const ly of [-1, 0, 1]) slots.add(holdRb({ ly }).strike.slot);
  // tech: double-tap RB (tap, release, tap) then strike while in the pending/tap window; tech+sig: second press held
  const doubleRb = (hold) => {
    const m = new GamepadMapper();
    const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 0.6, clinchRange: 0.3 };
    m.update(pad({ buttons: {} }), ctx);
    ctx.tick = 1; m.update(pad({ buttons: { RB: true } }), ctx);
    ctx.tick = 3; m.update(pad({ buttons: {} }), ctx);
    ctx.tick = 6; m.update(pad({ buttons: { RB: true } }), ctx);
    if (hold) { ctx.tick = 10; m.update(pad({ buttons: { RB: true } }), ctx); } else { ctx.tick = 8; m.update(pad({ buttons: {} }), ctx); }
    ctx.tick = 11; return m.update(pad({ buttons: { ...(hold ? { RB: true } : {}), X: true } }), ctx);
  };
  slots.add(doubleRb(false).strike.slot);
  slots.add(doubleRb(true).strike.slot);
  for (const ly of [-1, 1]) { const m = doubleRb(false); void m; }
  const techFwd = (() => { const m = new GamepadMapper(); const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 } }; m.update(pad(), ctx); ctx.tick = 1; m.update(pad({ buttons: { RB: true } }), ctx); ctx.tick = 3; m.update(pad(), ctx); ctx.tick = 6; m.update(pad({ buttons: { RB: true } }), ctx); ctx.tick = 8; m.update(pad(), ctx); ctx.tick = 9; return m.update(pad({ ly: -1, buttons: { X: true } }), ctx); })();
  slots.add(techFwd.strike.slot);
  const techBwd = (() => { const m = new GamepadMapper(); const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 } }; m.update(pad(), ctx); ctx.tick = 1; m.update(pad({ buttons: { RB: true } }), ctx); ctx.tick = 3; m.update(pad(), ctx); ctx.tick = 6; m.update(pad({ buttons: { RB: true } }), ctx); ctx.tick = 8; m.update(pad(), ctx); ctx.tick = 9; return m.update(pad({ ly: 1, buttons: { X: true } }), ctx); })();
  slots.add(techBwd.strike.slot);
  assert.deepEqual([...slots].sort(), Object.values(Slot).sort(), `reachable: ${[...slots].sort().join(',')}`);

  assert.equal(press({ buttons: { X: true }, lt: 1 }).strike.target, 'body');
  assert.equal(press({ buttons: { A: true }, ly: 1 }).strike.target, 'leg', 'kick + stick down = leg kick');
  assert.equal(press({ buttons: { X: true } }).strike.target, 'head');
  assert.deepEqual([press({ buttons: { X: true } }).strike.side, press({ buttons: { Y: true } }).strike.side], ['lead', 'back']);
  assert.deepEqual([press({ buttons: { X: true } }).strike.limb, press({ buttons: { A: true } }).strike.limb], ['punch', 'kick']);
});

test('gamepad: movement is relative to the opponent, guard has hysteresis and height, quick RT tap = parry, LB tap = clinch / hold = shot', () => {
  const m = new GamepadMapper();
  const ctx = { tick: 0, mode: 'standup', toOpponent: { x: 0, y: 1 }, range: 1.2, clinchRange: 0.3 };
  const toward = m.update(pad({ ly: -1 }), ctx).move;
  assert.ok(Math.abs(toward.x) < 1e-9 && Math.abs(toward.y - 1) < 1e-9, 'stick up = toward the opponent');
  const strafe = m.update(pad({ lx: 1 }), ctx).move;
  assert.ok(Math.abs(strafe.x + 1) < 1e-9 || Math.abs(strafe.x - 1) < 1e-9);
  assert.equal(Math.hypot(...Object.values(m.update(pad({ lx: 1, ly: -1 }), ctx).move)) <= 1 + 1e-9, true);

  const g = new GamepadMapper();
  const c = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 1, clinchRange: 0.3 };
  assert.equal(g.update(pad({ rt: 0.3 }), c).guard, 'none', 'below the on-threshold 0.35');
  c.tick = 1; assert.equal(g.update(pad({ rt: 0.4 }), c).guard, 'high');
  c.tick = 2; assert.equal(g.update(pad({ rt: 0.3 }), c).guard, 'high', 'stays on until it falls below 0.25');
  c.tick = 3; assert.equal(g.update(pad({ rt: 0.9, ly: 1 }), c).guard, 'low');
  c.tick = 4; const rel = g.update(pad({ rt: 0.1 }), c);
  assert.equal(rel.parry, true, 'released within 11 ticks of pressing');
  const g2 = new GamepadMapper();
  const c2 = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 1, clinchRange: 0.3 };
  g2.update(pad({ rt: 0.9 }), c2); c2.tick = 40;
  assert.equal(g2.update(pad({ rt: 0 }), c2).parry, false, 'a held guard is not a parry');

  const l = new GamepadMapper();
  const lc = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 0.2, clinchRange: 0.3 };
  l.update(pad({ buttons: { LB: true } }), lc); lc.tick = 3;
  assert.deepEqual(l.update(pad({ buttons: {} }), lc).clinch, {}, 'quick LB tap = clinch');
  const s = new GamepadMapper();
  const sc = { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 }, range: 1.0, clinchRange: 0.3 };
  s.update(pad({ ly: -1, buttons: { LB: true } }), sc); sc.tick = 12;
  assert.deepEqual(s.update(pad({ ly: -1, buttons: { LB: true } }), sc).takedown, { dir: 'fwd', size: 'major' });
  const st = new GamepadMapper();
  st.update(pad(), { tick: 0, mode: 'standup', toOpponent: { x: 1, y: 0 } });
  assert.equal(st.update(pad({ buttons: { R3: true } }), { tick: 1, mode: 'standup', toOpponent: { x: 1, y: 0 } }).switchStance, true);
});

test('gamepad in clinch / ground: face buttons pick from the legal actions; keyboard layout produces the same state shape', () => {
  const legal = [{ kind: 'strike', strike: 'knee', target: 'body' }, { kind: 'strike', strike: 'elbow', target: 'head' }, { kind: 'pummel', to: 'double_under' }, { kind: 'takedown', move: 'hip_throw_high' }, { kind: 'break' }];
  const m = new GamepadMapper();
  const ctx = { tick: 0, mode: 'clinch', toOpponent: { x: 1, y: 0 }, legal };
  m.update(pad(), ctx); ctx.tick = 1;
  assert.equal(m.update(pad({ buttons: { Y: true } }), ctx).grapple.strike, 'elbow');
  ctx.tick = 2; m.update(pad(), ctx); ctx.tick = 3;
  assert.equal(m.update(pad({ buttons: { A: true } }), ctx).grapple.kind, 'pummel');
  ctx.tick = 4; m.update(pad(), ctx); ctx.tick = 5;
  assert.equal(m.update(pad({ buttons: { LB: true } }), ctx).grapple.kind, 'break');
  const k = keyboardToPadState({ w: true, d: true, j: true, space: true });
  assert.deepEqual([k.lx, k.ly, k.rt, k.buttons.X], [1, -1, 1, true]);
});
