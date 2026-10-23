import test from 'node:test';
import assert from 'node:assert/strict';
import { healthEventProbability, switchHealthEvent, evaluateLadder, vulnerability, applyHealthEvent, tickStatus } from '../src/combat/health-events.js';
import { Rng } from '../src/core/rng.js';
import { Fighter } from '../src/combat/fighter.js';
import { mergeTunables } from '../src/core/tunables.js';
import { buildDefaultMoves } from '../src/data/default-moves.js';

const base = {
  probabilityMin: 0.05, probabilityMax: 0.45, fighterAttribute: 70, skillsProbMod: 1, skillsMetaMod: 1,
  damageHealthRatioMod: 2.2, strikeDamage: 10, currentHealth: 100, damageToHealthRatioLow: 0.04, damageToHealthRatioHigh: 0.16,
  staminaMod: 0.5, opponentCurrentStamina: 60, opponentMaxStamina: 100, staminaPercentageLow: 0.2, staminaPercentageHigh: 0.8,
  probabilityInit: 0.4, growthNumStrikes: 6, numStrikesReceivedCurrentRound: 3,
};

test('HealthEventProbability reproduces the worked example in docs/06 (0.4867)', () => {
  const p = healthEventProbability(base);
  assert.ok(Math.abs(p - 0.486667) < 1e-4, `got ${p}`);
});

test('HealthEventProbability: monotone in damage ratio, strikes received, attacker stamina, attribute', () => {
  const f = (o) => healthEventProbability({ ...base, ...o });
  assert.ok(f({ strikeDamage: 4 }) < f({ strikeDamage: 10 }));
  assert.ok(f({ strikeDamage: 10 }) < f({ strikeDamage: 16 }));
  assert.ok(f({ strikeDamage: 30 }) === f({ strikeDamage: 16 }), 'ratio saturates at High');
  // base (0.33) < init (0.40) here, so probability FALLS toward base as strikes accumulate; flip init to test growth
  const lowInit = { probabilityInit: 0.1 };
  assert.ok(f({ ...lowInit, numStrikesReceivedCurrentRound: 0 }) < f({ ...lowInit, numStrikesReceivedCurrentRound: 3 }));
  assert.ok(f({ ...lowInit, numStrikesReceivedCurrentRound: 3 }) < f({ ...lowInit, numStrikesReceivedCurrentRound: 6 }));
  assert.equal(f({ ...lowInit, numStrikesReceivedCurrentRound: 6 }), f({ ...lowInit, numStrikesReceivedCurrentRound: 60 }));
  assert.ok(f({ opponentCurrentStamina: 10 }) < f({ opponentCurrentStamina: 50 }));
  assert.ok(f({ opponentCurrentStamina: 50 }) < f({ opponentCurrentStamina: 100 }));
  assert.ok(f({ fighterAttribute: 20 }) < f({ fighterAttribute: 90 }));
  assert.equal(f({ growthNumStrikes: 0 }), healthEventProbability({ ...base, growthNumStrikes: 0, numStrikesReceivedCurrentRound: 99 }), 'growth 0 → g=1');
});

test('HealthEventProbability guards degenerate ranges and tiny health', () => {
  const p1 = healthEventProbability({ ...base, damageToHealthRatioHigh: base.damageToHealthRatioLow });
  assert.ok(Number.isFinite(p1));
  const p2 = healthEventProbability({ ...base, currentHealth: 0 });
  assert.ok(Number.isFinite(p2) && p2 > 0, 'health floor 0.001 prevents division by zero');
  const p3 = healthEventProbability({ ...base, staminaPercentageHigh: base.staminaPercentageLow });
  assert.ok(Number.isFinite(p3));
});

test('SwitchHealthEvent: pass-rate ≈ P without an active event, ≈ P/2 with one (100k seeds)', () => {
  const rng = new Rng(2024);
  const P = 0.3, N = 100000;
  let none = 0, active = 0;
  for (let i = 0; i < N; i++) {
    const seed = rng.nextInt32();
    if (switchHealthEvent({ newProbability: P, randomSeed: seed, newEvent: 'knockdown', currentEvent: 'none' })) none++;
    if (switchHealthEvent({ newProbability: P, randomSeed: seed, newEvent: 'knockdown', currentEvent: 'stun' })) active++;
  }
  assert.ok(Math.abs(none / N - P) < 0.01, `none ${none / N}`);
  assert.ok(Math.abs(active / N - P / 2) < 0.01, `active ${active / N}`);
});

test('SwitchHealthEvent is deterministic per (seed,event) and edge probabilities behave', () => {
  const args = { newProbability: 0.5, randomSeed: 987654, newEvent: 'stun', currentEvent: 'none' };
  const first = switchHealthEvent(args);
  for (let i = 0; i < 50; i++) assert.equal(switchHealthEvent(args), first);
  assert.equal(switchHealthEvent({ ...args, newProbability: 0 }), false);
  assert.equal(switchHealthEvent({ ...args, newProbability: 1 }), true);
  assert.equal(switchHealthEvent({ ...args, newProbability: 1, currentEvent: 'stun' }) in { true: 1, false: 1 }, true);
});

function mk(over = {}, tun = mergeTunables()) { return new Fighter({ id: over.id ?? 'x', ...over }, tun); }

test('ladder: severe events are rarer than mild ones; never downgrades an active event', () => {
  const tun = mergeTunables();
  const att = mk({ id: 'a' }, tun), def = mk({ id: 'd' }, tun);
  const move = buildDefaultMoves().find((m) => m.id === 'back_overhand_head');
  const rng = new Rng(11);
  const counts = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const r = evaluateLadder({ attacker: att, defender: def, region: 'head', move, taken: 12, poolCurAfter: 60, seed: rng.nextInt32(), tun, strikesReceivedRound: 8 });
    counts[r.event] = (counts[r.event] ?? 0) + 1;
  }
  assert.ok((counts.knockout ?? 0) <= (counts.knockdown ?? 0) + 50, JSON.stringify(counts));
  assert.ok((counts.none ?? 0) < N, 'something happens sometimes');
  def.status.event = 'critical_stun'; def.status.ticks = 100;
  for (let i = 0; i < 2000; i++) {
    const r = evaluateLadder({ attacker: att, defender: def, region: 'head', move, taken: 12, poolCurAfter: 60, seed: rng.nextInt32(), tun, strikesReceivedRound: 8 });
    assert.ok(!['wobbled_shot', 'stun'].includes(r.event), `downgrade to ${r.event}`);
  }
});

test('vulnerability: better chin/toughness → lower; per-region groups', () => {
  const glass = mk({ ratings: { chinhealth: 20, toughness: 20, bodyhealth: 90, leghealth: 90 } });
  const rock = mk({ ratings: { chinhealth: 90, toughness: 90 } });
  assert.ok(vulnerability(glass, 'head') > vulnerability(rock, 'head'));
  assert.ok(vulnerability(glass, 'body') < vulnerability(glass, 'head'));
});

test('applyHealthEvent / tickStatus lifecycle: stun → recovered → cleared', () => {
  const tun = mergeTunables();
  const f = mk({}, tun);
  applyHealthEvent(f, 'stun', 'head', tun);
  assert.ok(f.isHelpless());
  let recovered = false, cleared = false;
  for (let i = 0; i < 1000; i++) {
    const r = tickStatus(f);
    if (r === 'recovered') { recovered = true; assert.ok(!f.isHelpless()); }
    if (r === 'cleared') { cleared = true; break; }
  }
  assert.ok(recovered && cleared);
  assert.equal(f.status.event, 'none');
  // limping is a timed movement penalty, not helplessness
  applyHealthEvent(f, 'limping', 'legL', tun);
  assert.ok(!f.isHelpless() && f.status.limpTicks > 0 && f.status.limpLeg === 'legL');
  assert.ok(f.moveSpeedMult() < 0.9);
});
