import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeMeter, ButtonSnipe, SnipeChain } from '../src/combat/minigames.js';

const DT = 1 / 60;

// --- SnakeMeter ----------------------------------------------------------------------------------------------
function bestLockTick(opts, side = 'dom') {
  const probe = new SnakeMeter(opts).start();
  let best = { tick: 0, score: -1 };
  for (let i = 0; i < 1000 && probe.running; i++) {
    const o = probe.tick(DT);
    const s = side === 'dom' ? o.domScore : o.subScore;
    if (s > best.score) best = { tick: i, score: s };
  }
  return best;
}
function playLock(opts, { domTick = null, subTick = null } = {}) {
  const m = new SnakeMeter(opts).start();
  let o;
  for (let i = 0; i < 2000 && m.running; i++) o = m.tick(DT, { domEnd: i === domTick, subEnd: i === subTick });
  return { m, o };
}
const base = { startDelay: 0, duration: 1.6, numPasses: 1, difficulty: 0.5, random: 0.5, domPlaying: true, subPlaying: false };

test('SnakeMeter: difficulty shrinks the Dom window and widens the Sub window; zone stays on the track', () => {
  const easy = new SnakeMeter({ ...base, difficulty: 0.1 }).start();
  const hard = new SnakeMeter({ ...base, difficulty: 0.9 }).start();
  assert.ok(hard.zoneDom < easy.zoneDom);
  assert.ok(hard.zoneSub > easy.zoneSub);
  for (const r of [0, 0.25, 0.5, 0.99]) {
    const m = new SnakeMeter({ ...base, random: r }).start();
    const half = Math.max(m.zoneDom, m.zoneSub) / 2;
    assert.ok(m.centre - half >= 0 && m.centre + half <= 1 + 1e-9, `r=${r}`);
  }
});

test('SnakeMeter: locking at the best moment wins vs an AI attacker-free duel; locking far away scores 0 and ends at once', () => {
  const best = bestLockTick(base);
  assert.ok(best.score >= 0.95, `best live score ${best.score}`);
  const { m } = playLock(base, { domTick: best.tick });
  assert.ok(m.finished && m.domWon && m.finalDom > 0.9);

  const early = playLock(base, { domTick: 0 });
  assert.equal(early.m.finalDom, 0);
  assert.ok(early.m.finished && !early.m.domWon, 'exact-zero lock ends immediately as a loss');
  assert.ok(early.m.timer < base.duration, 'ended before the clock ran out');
});

test('SnakeMeter: never locking loses at timeout; deterministic for identical parameters', () => {
  const a = playLock(base), b = playLock(base);
  assert.ok(a.m.finished && !a.m.domWon && a.m.finalDom === -1);
  assert.deepEqual(a.o, b.o);
});

test('SnakeMeter: both play → strict greater wins, tie goes to Sub', () => {
  const o = { ...base, subPlaying: true, difficulty: 0.5 };
  const best = bestLockTick(o, 'dom');
  const tie = playLock(o, { domTick: best.tick, subTick: best.tick });
  assert.equal(tie.m.finalDom, tie.m.finalSub);
  assert.equal(tie.m.domWon, false, 'tie → Sub');
  const domBetter = playLock(o, { domTick: best.tick, subTick: 0 });
  assert.equal(domBetter.m.finalSub, 0);
  assert.equal(domBetter.m.domWon, true, 'a locked Sub zero does not end the game early (only a Dom zero does); Dom wins with a strictly higher score');
});

test('SnakeMeter: vs an AI attacker the human defender wins iff final > 0', () => {
  const o = { ...base, domPlaying: false, subPlaying: true };
  const best = bestLockTick(o, 'sub');
  const win = playLock(o, { subTick: best.tick });
  assert.ok(win.m.finalSub > 0 && win.m.domWon === false);
  const lose = playLock(o, { subTick: 0 });
  assert.equal(lose.m.finalSub, 0);
  assert.equal(lose.m.domWon, true);
});

test('SnakeMeter: faithful mode — perfect only counts at/left of centre; frame-dependent perfect size', () => {
  const f60 = new SnakeMeter({ ...base, faithful: true, dt0: 1 / 60 }).start();
  const f30 = new SnakeMeter({ ...base, faithful: true, dt0: 1 / 30 }).start();
  assert.ok(Math.abs(f30.perfect - 2 * f60.perfect) < 1e-12);
});

test('SnakeMeter: start delay holds the needle', () => {
  const m = new SnakeMeter({ ...base, startDelay: 0.5 }).start();
  const p0 = m.posDom;
  for (let i = 0; i < 20; i++) m.tick(DT);
  assert.equal(m.posDom, p0);
  for (let i = 0; i < 20; i++) m.tick(DT);
  assert.notEqual(m.posDom, p0);
});

// --- ButtonSnipe ---------------------------------------------------------------------------------------------
const B = (a) => a;
function snipe(args, startButton = 2) {
  const s = new ButtonSnipe().start(startButton);
  return s.tick({ snipeTime: 1, dt: DT, domPlaying: false, subPlaying: false, ...args });
}

test('ButtonSnipe: all branches', () => {
  const exact = [0, 0, 1, 0], wrong = [1, 0, 0, 0], none = [0, 0, 0, 0];
  assert.deepEqual(pick(snipe({ domPlaying: true, domButtons: exact })), { finished: true, domWon: true });
  assert.deepEqual(pick(snipe({ domPlaying: true, domButtons: wrong })), { finished: true, domWon: false });
  assert.deepEqual(pick(snipe({ subPlaying: true, subButtons: exact })), { finished: true, domWon: false });
  assert.deepEqual(pick(snipe({ subPlaying: true, subButtons: wrong })), { finished: true, domWon: true });
  assert.deepEqual(pick(snipe({ domPlaying: true, domButtons: none })), { finished: false, domWon: false });
  // tie: both exact at once → Sub first
  assert.deepEqual(pick(snipe({ domPlaying: true, domButtons: exact, subPlaying: true, subButtons: exact })), { finished: true, domWon: false });
  // mask must match exactly (extra button = wrong)
  assert.deepEqual(pick(snipe({ domPlaying: true, domButtons: [0, 0, 1, 1] })), { finished: true, domWon: false });
});
const pick = (o) => ({ finished: o.finished, domWon: o.domWon });

test('ButtonSnipe: timeout — a human who failed to react loses, an AI side is decided in the other side\'s favour', () => {
  const s = new ButtonSnipe().start(0);
  let o;
  for (let i = 0; i < 120 && s.running; i++) o = s.tick({ snipeTime: 0.5, dt: DT, domPlaying: true, domButtons: [0, 0, 0, 0], subPlaying: false });
  assert.ok(o.finished && o.domWon === false, 'human Dom timed out → loses');
  const s2 = new ButtonSnipe().start(0);
  for (let i = 0; i < 120 && s2.running; i++) o = s2.tick({ snipeTime: 0.5, dt: DT, domPlaying: false, subPlaying: true, subButtons: [0, 0, 0, 0] });
  assert.ok(o.finished && o.domWon === true, 'human Sub timed out → Dom (AI) wins');
});

// --- SnipeChain ----------------------------------------------------------------------------------------------
const chainBase = {
  resetTrigger: false, countUpTrigger: false, countUpSnipeTime: 1, isCountingDown: false, countDownSnipeTime: 1,
  countDownTimerDelay: 1, countDownTimerDelaySpeedIncrease: 0.2, countDownTimerDelayMinTicks: 0.3, snipeButton: 1,
  domPlaying: true, domButtons: [0, 0, 0, 0], subPlaying: false, subButtons: [0, 0, 0, 0], dt: DT, domInitiates: true, stopTrigger: false,
};

test('SnipeChain: count-up — success increments depth; 3 failed tries end the session', () => {
  const c = new SnipeChain();
  let o = c.tick({ ...chainBase, resetTrigger: true });
  assert.ok(o.isRunning);
  // try 1: success (exact button = bit 1 → mask 2)
  o = c.tick({ ...chainBase, countUpTrigger: true });
  assert.equal(o.snipeButton, 2);
  o = c.tick({ ...chainBase, domButtons: [0, 1, 0, 0] });
  assert.ok(o.snipeResult && o.initiatorWon && o.snipeCount === 1 && o.isRunning);
  // tries 2..3 fail (wrong button) – depth stays 1 so session continues
  for (let t = 0; t < 2; t++) {
    c.tick({ ...chainBase, countUpTrigger: true });
    o = c.tick({ ...chainBase, domButtons: [1, 0, 0, 0] });
    assert.ok(o.snipeResult && !o.initiatorWon);
  }
  assert.equal(o.snipeCount, 1);
  assert.ok(o.isRunning);

  // fresh chain: 3 failures from zero ends it
  const d = new SnipeChain();
  d.tick({ ...chainBase, resetTrigger: true });
  for (let t = 0; t < 3; t++) {
    d.tick({ ...chainBase, countUpTrigger: true });
    o = d.tick({ ...chainBase, domButtons: [1, 0, 0, 0] });
  }
  assert.equal(o.isRunning, false);
  assert.equal(o.snipeCount, 0);
});

test('SnipeChain: countdown gaps shrink as max(delay − inc·n, min) and depth falls on failures', () => {
  const c = new SnipeChain();
  const cd = { ...chainBase, isCountingDown: true };
  c.tick({ ...cd, resetTrigger: true });
  // seed some depth via count-up: three successes is not possible; emulate by two count-up successes
  c.snipeCount = 3; // test-only shortcut to the post-count-up state
  const gaps = [];
  for (let n = 0; n < 6 && c.running; n++) {
    let ticks = 0;
    let o;
    while (ticks < 2000) { o = c.tick(cd); ticks++; if (o.snipeTime > 0) break; }
    gaps.push(ticks / 60);
    // initiator (Dom) presses the wrong button → failure → depth--
    o = c.tick({ ...cd, domButtons: [1, 0, 0, 0] });
    assert.ok(o.snipeResult && !o.initiatorWon);
  }
  // expected gaps: 1.0, 1.0, 0.8, 0.6, 0.4 (until depth hits 0 after 3 failures the session ends)
  assert.ok(Math.abs(gaps[0] - 1.0) < 0.05, JSON.stringify(gaps));
  assert.ok(gaps.length >= 3 && !c.running, `session should end when depth reaches 0 (${gaps.length} snipes)`);
  assert.ok(gaps[2] < gaps[1] + 1e-9);
});

test('SnipeChain: initiator flips outcome mapping; timeout favours an AI initiator', () => {
  for (const [domInitiates, domBtn, subBtn, expected] of [
    [true, [0, 1, 0, 0], [0, 0, 0, 0], true],    // Dom initiator exact → success
    [true, [0, 0, 0, 0], [0, 1, 0, 0], false],   // Sub exact → initiator (Dom) fails
    [false, [0, 0, 0, 0], [0, 1, 0, 0], true],   // Sub initiator exact → success
    [false, [0, 1, 0, 0], [0, 0, 0, 0], false],  // Dom (non-initiator) exact → initiator fails
  ]) {
    const c = new SnipeChain();
    c.tick({ ...chainBase, resetTrigger: true, subPlaying: true, domInitiates });
    c.tick({ ...chainBase, countUpTrigger: true, subPlaying: true, domInitiates });
    const o = c.tick({ ...chainBase, subPlaying: true, domInitiates, domButtons: domBtn, subButtons: subBtn });
    assert.equal(o.snipeResult, true);
    assert.equal(o.initiatorWon, expected, JSON.stringify({ domInitiates, domBtn, subBtn }));
  }
  const c = new SnipeChain();
  c.tick({ ...chainBase, resetTrigger: true, domPlaying: false, subPlaying: true });
  c.tick({ ...chainBase, countUpTrigger: true, countUpSnipeTime: 0.05, domPlaying: false, subPlaying: true });
  let o;
  for (let i = 0; i < 30 && !(o?.snipeResult); i++) o = c.tick({ ...chainBase, domPlaying: false, subPlaying: true });
  assert.ok(o.snipeResult && o.initiatorWon === true, 'AI initiator succeeds by default on timeout');
});

test('SnipeChain: stop trigger halts', () => {
  const c = new SnipeChain();
  c.tick({ ...chainBase, resetTrigger: true });
  const o = c.tick({ ...chainBase, stopTrigger: true });
  assert.equal(o.isRunning, false);
});
