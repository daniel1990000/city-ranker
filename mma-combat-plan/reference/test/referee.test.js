import test from 'node:test';
import assert from 'node:assert/strict';
import { Referee } from '../src/combat/referee.js';
import { Mode } from '../src/core/taxonomy.js';
import { makeWorld, eventsOf, faceOff } from '../src/testing/helpers.js';

const groundStrike = (w, o = {}) => w.emit('strike', { attacker: 'a', defender: 'b', moveId: 'x', limb: 'punch', kind: 'punch', side: 'back', target: 'head', mode: 'ground', outcome: 'hit', taken: 8, blocked: 0, tier: 'heavy', crit: false, significant: true, ...o });
const advance = (w, ref, n) => { for (let i = 0; i < n; i++) { w.tick += 1; ref.update(); } };

test('knockout health event ends the fight; winner is the other fighter; describes the finishing strike', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  groundStrike(w, { mode: 'standup', kind: 'punch', target: 'head', tier: 'light' });
  w.fighters[1].status.event = 'knockout';
  const s = ref.update();
  assert.deepEqual([s.type, s.winner, s.loser, s.how], ['ko', 'a', 'b', 'punch_head']);
  assert.equal(eventsOf(w, 'stoppage').length, 1);
  assert.equal(eventsOf(w, 'stoppage')[0].kind, 'ko'); assert.equal(eventsOf(w, 'stoppage')[0].type, 'stoppage', 'the envelope type is not shadowed');
  assert.equal(ref.update(), s, 'idempotent');
  assert.equal(eventsOf(w, 'stoppage').length, 1);
});

test('double knockout: the less hurt fighter wins; an exact tie is a no contest', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  w.fighters.forEach((f) => (f.status.event = 'knockout'));
  w.fighters[0].pools.head.cur = 50;
  const s = ref.update();
  assert.deepEqual([s.type, s.how], ['ko', 'double_ko']);
  assert.equal(s.winner, 'b');                       // a has the emptier head pool
  const w2 = makeWorld(); const ref2 = new Referee(w2);
  w2.fighters.forEach((f) => (f.status.event = 'knockout'));
  assert.equal(ref2.update().winner, null);
});

test('rule 2: three heavy unanswered ground strikes within 3 s stop the fight; so do enough light ones', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  for (let i = 0; i < 2; i++) { w.tick += 20; groundStrike(w); }
  assert.equal(ref.stoppage, null);
  w.tick += 20; groundStrike(w);
  assert.deepEqual([ref.stoppage.type, ref.stoppage.how, ref.stoppage.winner], ['tko', 'ground_and_pound', 'a']);

  const w2 = makeWorld(); const r2 = new Referee(w2);
  const any = w2.tun.referee.tkoUnansweredAny;
  for (let i = 0; i < any - 1; i++) { w2.tick += 10; groundStrike(w2, { tier: 'light' }); }
  assert.equal(r2.stoppage, null);
  w2.tick += 10; groundStrike(w2, { tier: 'light' });
  assert.equal(r2.stoppage.type, 'tko');
});

test('rule 2: intelligent defence, spread-out strikes, or blocked strikes keep the fight going', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  const b = w.fighters[1];
  for (let i = 0; i < 12; i++) { w.tick += 30; b.activeDefenceTick = w.tick - 10; groundStrike(w); }
  assert.equal(ref.stoppage, null, 'defending (posture/cover/turtle/escape attempts)');
  for (let i = 0; i < 12; i++) { w.tick += 200; groundStrike(w); }
  assert.equal(ref.stoppage, null, 'strikes more than 3 s apart never accumulate');
  const w3 = makeWorld(); const r3 = new Referee(w3);
  w3.tick += 20; groundStrike(w3); w3.tick += 20; groundStrike(w3);
  w3.tick += 5; groundStrike(w3, { outcome: 'blocked', taken: 1 });
  w3.tick += 20; groundStrike(w3);
  assert.equal(r3.stoppage, null, 'a block resets the count');
});

test('rule 3: stunned, head nearly empty, another heavy head strike → stoppage (referee discretion = 1 here)', () => {
  const w = makeWorld({ tunables: { referee: { tkoStunnedChance: 1 } } });
  const ref = new Referee(w);
  const b = w.fighters[1];
  b.pools.head.cur = b.pools.head.max * w.tun.referee.tkoHeadFraction * 0.5;
  groundStrike(w, { mode: 'standup' });
  assert.equal(ref.stoppage, null, 'not stunned');
  b.status.event = 'stun'; b.status.ticks = 60; b.status.helpless = true;
  groundStrike(w, { mode: 'standup', tier: 'light' });
  assert.equal(ref.stoppage, null, 'not heavy');
  groundStrike(w, { mode: 'standup', target: 'body' });
  assert.equal(ref.stoppage, null, 'not the head');
  groundStrike(w, { mode: 'standup' });
  assert.deepEqual([ref.stoppage.type, ref.stoppage.how], ['tko', 'stunned_and_hurt']);
});

test('rule 4: leg pool gone and two failed get-ups → leg-injury TKO', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  const b = w.fighters[1];
  b.pools.legL.cur = 0; b.failedGetups = 1;
  assert.equal(ref.update(), null);
  b.failedGetups = 2;
  const s = ref.update();
  assert.deepEqual([s.type, s.how, s.winner, s.loser], ['tko', 'leg_injury', 'a', 'b']);
});

test('stand-up idle rule: warning at 5 s and a reset to the middle at 10 s, each exactly once per stall; activity resets it', () => {
  const w = makeWorld();
  const ref = new Referee(w);
  faceOff(w, 3); w.fighters[0].pos = { x: 3, y: 2 };
  advance(w, ref, 299); assert.equal(eventsOf(w, 'referee').length, 0);
  advance(w, ref, 1); assert.deepEqual(eventsOf(w, 'referee').map((e) => e.kind), ['low_action']);
  advance(w, ref, 299); assert.equal(eventsOf(w, 'referee').length, 1);
  advance(w, ref, 1);
  assert.deepEqual(eventsOf(w, 'referee').map((e) => e.kind), ['low_action', 'break']);
  assert.equal(w.fighters[0].pos.y, 0, 'reset to the middle');
  advance(w, ref, 299); assert.equal(eventsOf(w, 'referee').length, 2, 'clock restarted');
  // any strike resets the clock
  advance(w, ref, 100);
  w.emit('strike', { attacker: 'a', defender: 'b', moveId: 'j', limb: 'punch', kind: 'punch', side: 'lead', target: 'head', mode: 'standup', outcome: 'whiff', taken: 0, blocked: 0, tier: null });
  const n = eventsOf(w, 'referee').length;
  advance(w, ref, 290);
  assert.equal(eventsOf(w, 'referee').length, n);
  // not enforced while someone is in a clinch / on the ground (those bouts own their timers)
  w.fighters[0].mode = Mode.CLINCH;
  advance(w, ref, 2000);
  assert.equal(eventsOf(w, 'referee').length, n);
});

test('submissions: tap → submission win, choke-out → submission, lock injury → TKO', () => {
  const run = (result, name) => {
    const w = makeWorld(); const ref = new Referee(w);
    w.emit('submission', { attacker: 'a', defender: 'b', name, category: 'choke', stage: 5, result });
    return ref.stoppage;
  };
  assert.deepEqual(run('tap', 'armbar'), { type: 'submission', how: 'armbar', winner: 'a', loser: 'b' });
  assert.deepEqual(run('ko', 'rear_naked_choke'), { type: 'submission', how: 'rear_naked_choke_choke_out', winner: 'a', loser: 'b' });
  assert.deepEqual(run('injury', 'kimura'), { type: 'tko', how: 'kimura_injury', winner: 'a', loser: 'b' });
  assert.equal(run('stage', 'armbar'), null);
});

test('doctor: a critical cut can stop the fight between rounds; healthy fighters never are', () => {
  let stopped = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const w = makeWorld({ seed }); const ref = new Referee(w);
    w.fighters[1].injuries = { brow: { score: 2, stage: 4 } };
    if (ref.checkDoctor()) { stopped++; assert.deepEqual([ref.stoppage.type, ref.stoppage.winner], ['doctor', 'a']); }
  }
  assert.ok(stopped > 20 && stopped < 150, `${stopped}`);
  const w = makeWorld(); const ref = new Referee(w);
  assert.equal(ref.checkDoctor(), null);
});
