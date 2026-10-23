// The clinch (src/game/fight/clinch.ts): deterministic and restorable like the rest of the fight, a punch beats a
// grab, the referee separates a stalled clinch, a trip goes to the ground, and clinch spam never beats a champion.
import { describe, expect, it } from 'vitest';
import { AIController, createFight, drainEvents, hashState, restore, snapshot, stepFight, viewFor, type Fight, type FightEvent, type FightInput, NO_INPUT } from '../src/game/fight';
import { CLINCH } from '../src/game/fight/clinch';
import { ARCHETYPES, ClinchSpamBot, testFighter } from './fight-helpers';

const I = (p: Partial<FightInput> = {}): FightInput => ({ ...NO_INPUT, ...p });

function live(f: Fight): void {
  while (f.state.phase === 'intro') stepFight(f, [I(), I()]);
}

/** Two fighters close together, round live. */
function close(seed = 1, a = testFighter('wrestler', 30), b = testFighter('boxer', -30)): Fight {
  const f = createFight({ seed, a, b });
  live(f);
  f.state.fighters[0].x = -400;
  f.state.fighters[1].x = 400;
  return f;
}

function step(f: Fight, n: number, a: Partial<FightInput> = {}, b: Partial<FightInput> = {}): FightEvent[] {
  const ev: FightEvent[] = [];
  for (let i = 0; i < n && !f.state.result; i++) {
    stepFight(f, [I(i === 0 ? a : {}), I(i === 0 ? b : {})]);
    ev.push(...drainEvents(f));
  }
  return ev;
}

/** Grab until a clinch starts (a strong wrestler on a weak boxer gets there in a try or two). */
function clinched(seed = 1): Fight {
  for (let s = seed; s < seed + 40; s++) {
    const f = close(s);
    const ev = step(f, 40, { clinch: true });
    if (ev.some(e => e.type === 'clinchStart') && f.state.clinch) return f;
  }
  throw new Error('no clinch');
}

describe('the clinch', () => {
  it('a grab at close range ties them up with the grabber in control', () => {
    const f = clinched();
    expect(f.state.clinch?.ctl).toBe(0);
    expect(f.state.fighters[0].action).toBe('clinchHold');
    expect(f.state.fighters[1].action).toBe('clinchHeld');
  });

  it('a grab from across the cage does nothing', () => {
    const f = createFight({ seed: 2, a: testFighter('wrestler'), b: testFighter('boxer') });
    live(f);
    const ev = step(f, 30, { clinch: true });
    expect(ev.some(e => e.type === 'clinchAttempt')).toBe(false);
  });

  it('a punch beats a grab: reaching in gets countered', () => {
    let countered = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const f = close(seed, testFighter('wrestler'), testFighter('boxer'));
      const ev = step(f, 40, { clinch: true }, { strike: 'jab' });
      if (ev.some(e => e.type === 'hit' && e.side === 1 && e.counter)) countered++;
      expect(f.state.clinch).toBeNull();
    }
    expect(countered).toBeGreaterThanOrEqual(8);
  });

  it('in the clinch a tap is a knee to the body', () => {
    const f = clinched();
    const ev = step(f, 30, { strike: 'jab' });
    expect(ev.some(e => e.type === 'hit' && e.side === 0 && e.move === 'clinchKnee')).toBe(true);
  });

  it('the referee separates a clinch where nobody works', () => {
    const f = clinched();
    const ev = step(f, CLINCH.refIdle + 5);
    expect(ev.some(e => e.type === 'clinchBreak' && e.reason === 'ref')).toBe(true);
    expect(f.state.clinch).toBeNull();
  });

  it('a trip pressed the moment the grab lands does nothing: it needs a set-up', () => {
    const f = clinched();
    const ev = step(f, 4, { shoot: true });
    expect(ev.some(e => e.type === 'clinchTrip')).toBe(false);
  });

  it('a trip nobody fights goes to the ground often; fought early it mostly fails', () => {
    let free = 0;
    let fought = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const f = clinched(seed * 3);
      step(f, CLINCH.tripSetup);
      const ev = step(f, CLINCH.tripTicks + 10, { shoot: true });
      if (ev.some(e => e.type === 'clinchTripEnd' && e.success)) free++;
      const g = clinched(seed * 3);
      step(g, CLINCH.tripSetup);
      const ev2: FightEvent[] = [];
      stepFight(g, [I({ shoot: true }), I()]);
      ev2.push(...drainEvents(g));
      stepFight(g, [I(), I({ shoot: true })]);
      ev2.push(...step(g, CLINCH.tripTicks + 10));
      if (ev2.some(e => e.type === 'clinchTripEnd' && e.success)) fought++;
    }
    expect(free).toBeGreaterThan(fought);
  });

  it('is deterministic, and a snapshot taken in the clinch restores exactly', () => {
    const run = () => {
      const f = clinched(5);
      const ai = [new AIController({ difficulty: 600, seed: 3 }), new AIController({ difficulty: 600, seed: 4 })];
      for (let t = 0; t < 600; t++) stepFight(f, [ai[0].next(viewFor(f, 0), 0), ai[1].next(viewFor(f, 1), 1)]);
      return f;
    };
    expect(hashState(run().state)).toBe(hashState(run().state));
    const f = clinched(7);
    const snap = snapshot(f);
    const inputs: [FightInput, FightInput][] = Array.from({ length: 200 }, (_, i) => [I({ strike: i % 25 === 0 ? 'jab' : null, shoot: i === 90 }), I({ evade: i === 40 ? 'back' : null })]);
    for (const p of inputs) stepFight(f, p);
    const end = hashState(f.state);
    restore(f, snap);
    for (const p of inputs) stepFight(f, p);
    expect(hashState(f.state)).toBe(end);
  });

  for (const mode of ['knee', 'trip', 'elbow'] as const) {
    it(`clinch spam (${mode}) loses to a champion`, () => {
      let wins = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const f = createFight({ seed, a: testFighter('wrestler'), b: testFighter(ARCHETYPES[seed % 5]) });
        const a = new ClinchSpamBot(mode);
        const b = new AIController({ difficulty: 950, seed: seed * 7 });
        for (let t = 0; t < 30000 && !f.state.result; t++) {
          stepFight(f, [a.next(viewFor(f, 0), 0), b.next(viewFor(f, 1), 1)]);
          drainEvents(f);
        }
        if (f.state.result?.winner === 0) wins++;
      }
      expect(wins).toBeLessThanOrEqual(2);
    });
  }
});
