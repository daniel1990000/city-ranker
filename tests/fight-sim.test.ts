// The fight simulation: determinism, snapshots, replays and the core mechanics.
import { describe, expect, it } from 'vitest';
import {
  AIController,
  createFight,
  drainEvents,
  hashState,
  restore,
  runFight,
  runReplay,
  ReplayRecorder,
  snapshot,
  stepFight,
  viewFor,
  decodeInput,
  encodeInput,
  type Fight,
  type FightEvent,
  type FightInput,
  NO_INPUT,
} from '../src/game/fight';
import { __test } from '../src/game/fight/sim';
import { MIN_GAP } from '../src/game/fight/core';
import { GROUND } from '../src/game/fight/ground';
import { ARCHETYPES, Masher, SpamBot, testFighter } from './fight-helpers';
import * as fs from 'node:fs';
import * as path from 'node:path';

const I = (p: Partial<FightInput> = {}): FightInput => ({ ...NO_INPUT, ...p });

function aiFight(seed: number, rules = {}) {
  const f = createFight({ seed, a: testFighter('boxer'), b: testFighter('wrestler'), rules });
  const ca = new AIController({ difficulty: 700, seed: seed + 1 });
  const cb = new AIController({ difficulty: 500, seed: seed + 2 });
  return { f, ca, cb };
}

/** Skip the intro so the round is live. */
function live(f: Fight): void {
  while (f.state.phase === 'intro') stepFight(f, [I(), I()]);
  drainEvents(f);
}

function stepN(f: Fight, n: number, a: Partial<FightInput> = {}, b: Partial<FightInput> = {}): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < n; i++) {
    stepFight(f, [I(a), I(b)]);
    out.push(...drainEvents(f));
  }
  return out;
}

describe('determinism', () => {
  it('the same seed and inputs give the same state at every tick', () => {
    const runs = [0, 1].map(() => {
      const { f, ca, cb } = aiFight(42);
      const hashes: number[] = [];
      for (let t = 0; t < 21000 && !f.state.result; t++) {
        stepFight(f, [ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)]);
        hashes.push(hashState(f.state));
      }
      return hashes;
    });
    expect(runs[0].length).toBeGreaterThan(1000);
    expect(runs[0]).toEqual(runs[1]);
  });

  it('the state is plain JSON of integers', () => {
    const { f, ca, cb } = aiFight(7);
    for (let t = 0; t < 4000; t++) stepFight(f, [ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)]);
    const json = JSON.stringify(f.state);
    expect(JSON.parse(json)).toEqual(f.state);
    const nonInt: string[] = [];
    const walk = (v: unknown, p: string) => {
      if (typeof v === 'number' && !Number.isInteger(v)) nonInt.push(p);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    };
    walk(f.state, 'state');
    expect(nonInt).toEqual([]);
  });

  it('the simulation never uses engine-dependent maths or the clock', () => {
    const dir = path.join(__dirname, '../src/game/fight');
    for (const file of fs.readdirSync(dir)) {
      if (file === 'ai.ts' || !file.endsWith('.ts')) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/Math\.(random|sin|cos|tan|exp|pow|log|sqrt|atan)|Date\.|performance\./);
    }
  });

  it('snapshot -> restore -> continue equals running straight through', () => {
    const a = aiFight(99);
    const b = aiFight(99);
    const inputsA: [FightInput, FightInput][] = [];
    for (let t = 0; t < 3000; t++) {
      const inp: [FightInput, FightInput] = [a.ca.next(viewFor(a.f, 0), 0), a.cb.next(viewFor(a.f, 1), 1)];
      inputsA.push(inp);
      stepFight(a.f, inp);
    }
    // b: run to 1500, snapshot, wander off for 300 ticks, restore, then replay the same inputs
    for (let t = 0; t < 1500; t++) stepFight(b.f, inputsA[t]);
    const snap = snapshot(b.f);
    for (let t = 0; t < 300; t++) stepFight(b.f, [I({ strike: 'jab' }), I({ shoot: true })]);
    restore(b.f, snap);
    for (let t = 1500; t < 3000; t++) stepFight(b.f, inputsA[t]);
    expect(hashState(b.f.state)).toBe(hashState(a.f.state));
  });

  it('a recorded replay reproduces the fight exactly', () => {
    const { f, ca, cb } = aiFight(5, { roundTicks: 60 * 40 });
    const rec = new ReplayRecorder(f);
    while (!f.state.result) {
      const inp: [FightInput, FightInput] = [ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)];
      rec.record(inp);
      stepFight(f, inp);
    }
    const r = rec.finish();
    const again = runReplay(JSON.parse(JSON.stringify(r)));
    expect(hashState(again.state)).toBe(r.hash);
    expect(again.state.result).toEqual(f.state.result);
    expect(r.inputs[0].length).toBeLessThan(r.ticks * 2);
  });

  it('inputs survive encoding', () => {
    const samples: FightInput[] = [
      I(),
      I({ strike: 'headKick', block: true, move: -1 }),
      I({ special: true, evade: 'back', ground: 'right', tap: true, taunt: true, shoot: true, move: 1 }),
    ];
    for (const s of samples) expect(decodeInput(encodeInput(s))).toEqual({ ...s, taunt: !!s.taunt });
  });
});

describe('standing mechanics', () => {
  function closeFight(a = testFighter('boxer'), b = testFighter('boxer')) {
    const f = createFight({ seed: 1, a, b });
    live(f);
    f.state.fighters[0].x = -450;
    f.state.fighters[1].x = 450;
    return f;
  }

  it('a jab in range lands on an idle opponent', () => {
    const f = closeFight();
    const ev = stepN(f, 1, { strike: 'jab' }).concat(stepN(f, 20));
    const hit = ev.find(e => e.type === 'hit');
    expect(hit && hit.type === 'hit' && !hit.blocked).toBe(true);
    expect(f.state.fighters[1].head).toBeGreaterThan(0);
  });

  it('out of range it whiffs', () => {
    const f = closeFight();
    f.state.fighters[0].x = -2000;
    f.state.fighters[1].x = 2000;
    const ev = stepN(f, 1, { strike: 'jab' }).concat(stepN(f, 20));
    expect(ev.some(e => e.type === 'miss')).toBe(true);
  });

  it('a held guard blocks punches and checks low kicks (the kicker shin takes it)', () => {
    const f = closeFight();
    let ev = stepN(f, 1, { strike: 'cross' }, { block: true }).concat(stepN(f, 25, {}, { block: true }));
    const blocked = ev.find(e => e.type === 'hit');
    expect(blocked && blocked.type === 'hit' && blocked.blocked).toBe(true);
    ev = stepN(f, 1, { strike: 'lowKick' }, { block: true }).concat(stepN(f, 30, {}, { block: true }));
    expect(ev.some(e => e.type === 'check' && e.side === 1)).toBe(true);
    expect(f.state.fighters[0].legs).toBeGreaterThan(f.state.fighters[1].legs);
    // an open stance takes the kick
    ev = stepN(f, 60).concat(stepN(f, 1, { strike: 'lowKick' }), stepN(f, 30));
    const leg = ev.find(e => e.type === 'hit' && e.move === 'lowKick');
    expect(leg && leg.type === 'hit' && !leg.blocked).toBe(true);
  });

  it('a well-timed slip makes a straight punch miss and opens a counter window', () => {
    const f = closeFight();
    stepN(f, 1, { strike: 'cross' });
    // the cross becomes active on its startup tick; slip so it arrives early in the slip
    const startup = f.state.fighters[0].moveStartup;
    stepN(f, startup - 4);
    const ev = stepN(f, 1, {}, { evade: 'left' }).concat(stepN(f, 12));
    const evade = ev.find(e => e.type === 'evade');
    expect(evade && evade.type === 'evade' && evade.perfect).toBe(true);
    expect(f.state.fighters[1].counterTicks).toBeGreaterThan(0);
  });

  it('hooks catch a slip to the wrong side', () => {
    const f = closeFight();
    stepN(f, 1, { strike: 'hookL' });
    const startup = f.state.fighters[0].moveStartup;
    stepN(f, startup - 4);
    const ev = stepN(f, 1, {}, { evade: 'left' }).concat(stepN(f, 12));
    expect(ev.some(e => e.type === 'hit' && !e.blocked)).toBe(true);
  });

  it('enough head damage stuns, and a heavy shot on a stunned fighter drops them', () => {
    const f = closeFight(testFighter('brawler', 20), testFighter('boxer', -20));
    f.state.fighters[1].hurt = 9900;
    let ev = stepN(f, 1, { strike: 'cross' }).concat(stepN(f, 30));
    expect(ev.some(e => e.type === 'stun')).toBe(true);
    f.state.fighters[0].x = -450;
    f.state.fighters[1].x = 450;
    ev = stepN(f, 1, { strike: 'headKick' }).concat(stepN(f, 40));
    expect(ev.some(e => e.type === 'knockdown')).toBe(true);
  });

  it('a heavily damaged fighter gets knocked out', () => {
    const f = closeFight(testFighter('brawler', 20), testFighter('boxer', -20));
    const v = f.state.fighters[1];
    v.head = 10000;
    v.hurt = 9900;
    v.stunTicks = 100;
    stepN(f, 1, { strike: 'headKick' });
    stepN(f, 60);
    expect(f.state.result?.method).toBe('KO');
    expect(f.state.result?.winner).toBe(0);
  });

  it('unanswered strikes on a wobbled fighter bring the referee in', () => {
    const f = closeFight(testFighter('boxer', 10), testFighter('boxer', -30));
    for (let i = 0; i < 40 && !f.state.result; i++) {
      const me = f.state.fighters[1];
      me.stunTicks = 200;
      me.hurt = 5000;
      me.head = 0;
      f.state.fighters[0].x = me.x - 500;
      stepN(f, 1, { strike: 'jab' });
      stepN(f, 20);
    }
    expect(f.state.result?.method).toBe('TKO');
  });

  it('stamina drains with work and comes back with rest', () => {
    const f = closeFight();
    for (let i = 0; i < 12; i++) stepN(f, 1, { strike: 'cross' }).concat(stepN(f, 26));
    const tired = f.state.fighters[0].stamina;
    expect(tired).toBeLessThan(8000);
    stepN(f, 300);
    expect(f.state.fighters[0].stamina).toBeGreaterThan(tired);
  });

  it('a full special meter throws the signature special', () => {
    const f = closeFight();
    f.state.fighters[0].special = 10000;
    const ev = stepN(f, 1, { special: true }).concat(stepN(f, 40));
    expect(ev.some(e => e.type === 'special')).toBe(true);
    expect(f.state.fighters[0].special).toBeLessThan(10000);
  });

  it('fighters never pass through each other or the cage', () => {
    const { f, ca, cb } = aiFight(3);
    for (let t = 0; t < 6000 && !f.state.result; t++) {
      stepFight(f, [ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)]);
      const [a, b] = f.state.fighters;
      expect(a.x).toBeGreaterThanOrEqual(-3600);
      expect(b.x).toBeLessThanOrEqual(3600);
      if (!f.state.ground) expect(b.x - a.x).toBeGreaterThanOrEqual(500);
    }
  });
});

describe('takedowns and the ground', () => {
  function shotFight() {
    const f = createFight({ seed: 11, a: testFighter('wrestler'), b: testFighter('boxer') });
    live(f);
    f.state.fighters[0].x = -500;
    f.state.fighters[1].x = 500;
    return f;
  }

  it('an unanswered shot usually takes them down; the bottom fighter can escape by answering the arrow', () => {
    let downs = 0;
    for (let seed = 0; seed < 20; seed++) {
      const f = createFight({ seed, a: testFighter('wrestler'), b: testFighter('boxer') });
      live(f);
      f.state.fighters[0].x = -500;
      f.state.fighters[1].x = 500;
      stepN(f, 1, { shoot: true });
      // startup + the whole sprawl window
      stepN(f, GROUND.shootStartup + GROUND.sprawlWindow + 4);
      if (f.state.ground) downs++;
    }
    expect(downs).toBeGreaterThan(12);
  });

  it('a pressed sprawl stops many shots', () => {
    let stuffed = 0;
    for (let seed = 0; seed < 20; seed++) {
      const f = createFight({ seed, a: testFighter('boxer'), b: testFighter('wrestler') });
      live(f);
      f.state.fighters[0].x = -500;
      f.state.fighters[1].x = 500;
      stepN(f, 1, { shoot: true });
      stepN(f, 15);
      stepN(f, 1, {}, { shoot: true });
      stepN(f, 30);
      if (!f.state.ground) stuffed++;
    }
    expect(stuffed).toBeGreaterThan(10);
  });

  it('ground scramble: answering the arrow first wins it', () => {
    const f = shotFight();
    __test.enterGround(f, 0, 'guard');
    stepN(f, 2);
    stepN(f, 1, { ground: 'up' });
    const dir = f.state.ground?.scramble?.dir;
    expect(dir).toBeTruthy();
    const ev = stepN(f, 1, { ground: dir }).concat(stepN(f, 60));
    const end = ev.find(e => e.type === 'scrambleEnd');
    expect(end && end.type === 'scrambleEnd' && end.success).toBe(true);
    expect(f.state.ground?.pos).toBe('mount');
  });

  it('submission: out-mashing the defender makes them tap', () => {
    const f = createFight({ seed: 2, a: testFighter('grappler'), b: testFighter('boxer') });
    live(f);
    __test.enterGround(f, 0, 'mount');
    stepN(f, 2);
    stepN(f, 1, { ground: 'down' });
    expect(f.state.ground?.sub).toBeTruthy();
    for (let t = 0; t < 700 && !f.state.result; t++) stepN(f, 1, { tap: t % 6 === 0 }, { tap: t % 14 === 0 });
    expect(f.state.result?.method).toBe('SUB');
    expect(f.state.result?.winner).toBe(0);
  });

  it('submission: a defender who out-mashes escapes', () => {
    const f = createFight({ seed: 2, a: testFighter('boxer'), b: testFighter('grappler') });
    live(f);
    __test.enterGround(f, 0, 'mount');
    stepN(f, 2);
    stepN(f, 1, { ground: 'down' });
    for (let t = 0; t < 700 && f.state.ground; t++) stepN(f, 1, { tap: t % 14 === 0 }, { tap: t % 5 === 0 });
    expect(f.state.result).toBeNull();
    expect(f.state.ground).toBeNull();
  });

  it('ground-and-pound on a hurt fighter ends in a TKO', () => {
    const f = createFight({ seed: 4, a: testFighter('wrestler', 20), b: testFighter('boxer', -20) });
    live(f);
    __test.enterGround(f, 0, 'mount');
    for (let t = 0; t < 1200 && !f.state.result; t++) {
      f.state.fighters[1].hurt = 9000;
      stepN(f, 1, { tap: t % 3 === 0 });
    }
    expect(f.state.result?.method).toBe('TKO');
    expect(f.state.result?.stoppage).toBe('ground');
  });

  it('the referee stands up a stalled ground fight', () => {
    const f = shotFight();
    __test.enterGround(f, 0, 'guard');
    const ev = stepN(f, 700);
    expect(ev.some(e => e.type === 'standUp' && e.reason === 'ref')).toBe(true);
  });
});

describe('rounds and judging', () => {
  it('a fight with no action goes the distance and is scored', () => {
    const f = createFight({ seed: 9, a: testFighter('boxer'), b: testFighter('boxer'), rules: { roundTicks: 600, breakTicks: 60 } });
    const ev: FightEvent[] = [];
    for (let t = 0; t < 5000 && !f.state.result; t++) {
      stepFight(f, [I(), I()]);
      ev.push(...drainEvents(f));
    }
    expect(ev.filter(e => e.type === 'roundStart').length).toBe(3);
    expect(f.state.result?.method).toBe('DEC');
    expect(f.state.result?.cards).toHaveLength(3);
    expect(f.state.result?.cards[0].rounds).toHaveLength(3);
  });

  it('the busier, harder-hitting fighter wins the decision', () => {
    let wins = 0;
    for (let seed = 0; seed < 10; seed++) {
      const { result } = runFight(seed, testFighter('boxer', 15), testFighter('boxer', -15), new AIController({ difficulty: 900, seed }), new AIController({ difficulty: 100, seed: seed + 50 }), { roundTicks: 1800 });
      if (result.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(8);
  });

  it('title fights have five rounds', () => {
    const f = createFight({ seed: 1, a: testFighter('boxer'), b: testFighter('boxer'), rules: { title: true } });
    expect(f.rules.rounds).toBe(5);
  });

  it('every AI-vs-AI fight ends with a sane result', () => {
    for (let s = 0; s < 25; s++) {
      const a = ARCHETYPES[s % 5];
      const b = ARCHETYPES[(s * 2 + 1) % 5];
      const { result } = runFight(s, testFighter(a), testFighter(b), new AIController({ difficulty: s * 40, seed: s }), new AIController({ difficulty: 1000 - s * 40, seed: s + 1 }));
      expect(['KO', 'TKO', 'SUB', 'DEC']).toContain(result.method);
      if (result.method !== 'DEC') expect(result.winner).not.toBeNull();
      expect(result.totalTicks).toBeGreaterThan(0);
    }
  });
});

describe('performance', () => {
  it('a tick costs far less than a frame (rollback-ready)', () => {
    const { f, ca, cb } = aiFight(77);
    const inputs: [FightInput, FightInput][] = [];
    for (let t = 0; t < 5000; t++) inputs.push([ca.next(viewFor(f, 0), 0), cb.next(viewFor(f, 1), 1)]);
    const g = aiFight(77).f;
    const t0 = performance.now();
    for (const inp of inputs) stepFight(g, inp);
    const per = (performance.now() - t0) / inputs.length;
    expect(per).toBeLessThan(0.05);
  });
});

describe('positions', () => {
  it('fighter 0 always stays on the left: the fighters never pass through each other', () => {
    let worst = Infinity;
    for (let seed = 1; seed <= 24; seed++) {
      const a = ARCHETYPES[seed % ARCHETYPES.length];
      const b = ARCHETYPES[(seed * 3 + 1) % ARCHETYPES.length];
      runFight(seed, testFighter(a), testFighter(b), new AIController({ difficulty: 800, seed }), new AIController({ difficulty: 600, seed: seed + 9 }), {}, f => {
        // on the ground (and in a takedown) both share the ground position; standing, they must stay apart
        if (!f.state.ground && !f.state.takedown) worst = Math.min(worst, f.state.fighters[1].x - f.state.fighters[0].x);
      });
    }
    expect(worst).toBeGreaterThanOrEqual(MIN_GAP - 1);
  });
});

describe('owner playtest (October 2026): mashing, rocked moments, takedowns, submissions', () => {
  function vsAI(difficulty: number, n: number, opp: (seed: number) => ReturnType<typeof testFighter> = s => testFighter(ARCHETYPES[s % 5])) {
    let wins = 0;
    const events: FightEvent[] = [];
    for (let seed = 1; seed <= n; seed++) {
      const f = createFight({ seed, a: testFighter('boxer'), b: opp(seed) });
      const a = new Masher();
      const b = new AIController({ difficulty, seed: seed * 7 });
      for (let t = 0; t < 30000 && !f.state.result; t++) {
        stepFight(f, [a.next(viewFor(f, 0), 0), b.next(viewFor(f, 1), 1)]);
        events.push(...drainEvents(f));
      }
      if (f.state.result?.winner === 0) wins++;
    }
    return { wins, events };
  }

  it('mashing punches beats a beginner but loses to a good opponent', () => {
    expect(vsAI(100, 20).wins).toBeGreaterThanOrEqual(12);
    expect(vsAI(950, 20).wins).toBeLessThanOrEqual(8);
  });

  it('a long string of clean punches makes the target shell up: the next one lands on the guard', () => {
    const f = createFight({ seed: 3, a: testFighter('brawler', 20), b: testFighter('boxer', -20) });
    live(f);
    f.state.fighters[0].x = -450;
    f.state.fighters[1].x = 450;
    const ev: FightEvent[] = [];
    for (let i = 0; i < 240 && !ev.some(e => e.type === 'cover'); i++) {
      stepFight(f, [I({ strike: i % 2 ? 'cross' : 'jab' }), I()]);
      ev.push(...drainEvents(f));
    }
    expect(ev.some(e => e.type === 'cover')).toBe(true);
    const after = stepN(f, 40, { strike: 'jab' });
    expect(after.some(e => e.type === 'hit' && e.side === 0 && e.blocked)).toBe(true);
  });

  it('fights have rocked moments, body and leg hurts, and fighters recover from being rocked', () => {
    const { events } = vsAI(600, 10);
    const n = (t: FightEvent['type']) => events.filter(e => e.type === t).length;
    expect(n('stun')).toBeGreaterThan(10);
    expect(n('recover')).toBeGreaterThan(3);
    expect(events.some(e => e.type === 'hurt' && e.zone === 'body')).toBe(true);
  });

  it('a heavy shot to a worn body doubles the fighter over', () => {
    const f = createFight({ seed: 5, a: testFighter('brawler', 20), b: testFighter('boxer') });
    live(f);
    f.state.fighters[0].x = -420;
    f.state.fighters[1].x = 420;
    f.state.fighters[1].body = 7000;
    let ev: FightEvent[] = [];
    for (let i = 0; i < 6 && !ev.some(e => e.type === 'hurt'); i++) ev = ev.concat(stepN(f, 1, { strike: 'bodyShot' }), stepN(f, 40));
    expect(ev.some(e => e.type === 'hurt' && e.side === 1 && e.zone === 'body')).toBe(true);
  });

  it('nobody is held down forever: the referee stands them up', () => {
    const f = createFight({ seed: 8, a: testFighter('wrestler'), b: testFighter('boxer') });
    live(f);
    __test.enterGround(f, 0, 'guard');
    let up = false;
    for (let i = 0; i < GROUND.refMax + 60 && !f.state.result; i++) {
      const ev = stepN(f, 1, { tap: i % 30 === 0 }, { block: true });
      if (ev.some(e => e.type === 'standUp')) {
        up = true;
        break;
      }
    }
    expect(up || !!f.state.result).toBe(true);
  });

  it('a sprawl pressed early (while the shot is coming) stops more shots than no sprawl', () => {
    const run = (early: boolean) => {
      let stuffed = 0;
      for (let seed = 0; seed < 30; seed++) {
        const f = createFight({ seed, a: testFighter('wrestler'), b: testFighter('boxer') });
        live(f);
        f.state.fighters[0].x = -500;
        f.state.fighters[1].x = 500;
        stepN(f, 1, { shoot: true });
        if (early) stepN(f, 4, {}, { shoot: true });
        stepN(f, GROUND.shootStartup + GROUND.sprawlWindow + 4);
        if (!f.state.ground) stuffed++;
      }
      return stuffed;
    };
    expect(run(true)).toBeGreaterThan(run(false) + 8);
  });

  it('a person-paced bottom player gets up against a medium opponent, and the AI mashes at a human pace', () => {
    const { events } = vsAI(500, 20, s => testFighter(s % 2 ? 'wrestler' : 'grappler'));
    const mine = events.filter(e => e.type === 'scrambleEnd' && e.side === 0);
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.filter(e => e.type === 'scrambleEnd' && e.success).length * 100).toBeGreaterThan(mine.length * 35);
  });

  it('submission: a person tapping 6.7 times a second can finish an even opponent the AI defends', () => {
    let taps = 0;
    for (let seed = 0; seed < 10; seed++) {
      const f = createFight({ seed, a: testFighter('grappler'), b: testFighter('grappler') });
      live(f);
      __test.enterGround(f, 0, 'mount');
      const ai = new AIController({ difficulty: 500, seed });
      stepN(f, 2);
      stepFight(f, [I({ ground: 'down' }), I()]);
      drainEvents(f);
      for (let t = 0; t < GROUND.subTimeLimit + 10 && f.state.ground?.sub; t++) {
        stepFight(f, [I({ tap: t % 9 === 0 }), ai.next(viewFor(f, 1), 1)]);
        if (drainEvents(f).some(e => e.type === 'tapOut')) taps++;
      }
    }
    expect(taps).toBeGreaterThanOrEqual(6);
  });
});

describe('audit 2 (October 2026): one-move spam never beats a strong opponent', () => {
  function closeFight() {
    const f = createFight({ seed: 1, a: testFighter('boxer'), b: testFighter('boxer') });
    live(f);
    f.state.fighters[0].x = -450;
    f.state.fighters[1].x = 450;
    return f;
  }

  for (const [strike, range] of [['lowKick', 1200], ['headKick', 1300], ['uppercut', 800], ['cross', 1050]] as const) {
    it(`${strike} spam loses to a champion`, () => {
      let wins = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const f = createFight({ seed, a: testFighter('boxer'), b: testFighter(ARCHETYPES[seed % 5]) });
        const a = new SpamBot(strike, range);
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

  it('repeating a strike makes it predictable (slower), a different one resets it', () => {
    const f = closeFight();
    const startups: number[] = [];
    for (let i = 0; i < 4; i++) {
      stepN(f, 1, { strike: 'cross' });
      startups.push(f.state.fighters[0].moveStartup);
      stepN(f, 60);
    }
    expect(startups[3]).toBeGreaterThan(startups[0]);
    stepN(f, 1, { strike: 'hookL' });
    stepN(f, 60);
    stepN(f, 1, { strike: 'cross' });
    expect(f.state.fighters[0].moveStartup).toBe(startups[0]);
  });

  it('a guard raised just before a punch lands parries it: nothing gets through and a counter window opens', () => {
    const f = closeFight();
    stepN(f, 1, { strike: 'cross' });
    const startup = f.state.fighters[0].moveStartup;
    stepN(f, startup - 3);
    const ev = stepN(f, 8, {}, { block: true });
    expect(ev.some(e => e.type === 'parry' && e.side === 1)).toBe(true);
    expect(f.state.fighters[1].counterTicks).toBeGreaterThan(0);
  });
});
