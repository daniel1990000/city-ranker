// The TV-broadcast layer's pure rules: walkout plates, corner advice and the obvious-round hint, commentary lines and
// their rate limit, and the finish replay (a snapshot plus the recorded inputs re-runs the finish exactly).
import { describe, expect, it } from 'vitest';
import { AIController, createFight, decodeInput, encodeInput, hashState, restore, snapshot, stepFight, viewFor } from '../src/game/fight';
import type { Fight } from '../src/game/fight';
import type { FightEvent, FightResult, FightState, FighterSpec, RoundStats } from '../src/game/fight/types';
import { ROSTER, overall } from '../src/meta/roster';
import {
  CAPTION_CUT_IN,
  CAPTION_GAP,
  Commentary,
  REPLAY_BEFORE,
  callName,
  clearRoundWinner,
  cornerAdvice,
  cornerReport,
  mmss,
  plateInfo,
  replaySpeed,
  replayable,
} from '../src/ui/fight/broadcast';
import { ARCHETYPES, testFighter } from './fight-helpers';

function named(spec: FighterSpec, name: string, sex: 'm' | 'f' = 'm'): FighterSpec {
  return { ...spec, name, lookHints: { ...spec.lookHints, sex } };
}

/** A fight just after round 1, with the round's stats and the fighters' meters set by the test. */
function afterRound(opts: { mine?: Partial<RoundStats>; theirs?: Partial<RoundStats>; me?: Partial<FightState['fighters'][0]>; them?: Partial<FightState['fighters'][0]> } = {}): Fight {
  const f = createFight({ seed: 7, a: testFighter('boxer'), b: testFighter('wrestler') });
  const s = f.state;
  s.phase = 'break';
  const base: Partial<RoundStats> = { thrown: 60, landed: 30, power: 20 };
  Object.assign(s.stats[0][0], base, opts.mine);
  Object.assign(s.stats[0][1], base, opts.theirs);
  Object.assign(s.fighters[0], opts.me);
  Object.assign(s.fighters[1], opts.them);
  return f;
}

describe('walkout plates', () => {
  it('shows the roster hometown, the overall rating and a stable record', () => {
    const r = ROSTER[0];
    const p = plateInfo(r);
    expect(p.name).toBe(r.name);
    expect(p.nickname).toBe(r.nickname);
    expect(p.hometown).toBe(r.hometown);
    expect(p.ovr).toBe(overall(r.stats));
    expect(p.record).toMatch(/^\d+-\d+(-\d+)?$/);
    expect(plateInfo(r)).toEqual(p);
  });
  it('gives fighters who are not on the roster a hometown too', () => {
    const p = plateInfo({ ...testFighter('kicker'), id: 'qf-12345' });
    expect(p.hometown.length).toBeGreaterThan(3);
  });
  it('legends have longer records than commons', () => {
    const wins = (rarity: FighterSpec['rarity']) => Number(plateInfo({ ...testFighter('boxer'), id: 'x1', rarity }).record.split('-')[0]);
    expect(wins('legend')).toBeGreaterThan(wins('common'));
  });
  it('commentators use the surname', () => {
    expect(callName(named(testFighter('boxer'), 'Dante Okafor'))).toBe('Okafor');
  });
});

describe('corner screen', () => {
  const opp = named(testFighter('wrestler'), 'Tariq Haddad');

  it('tells the player to check leg kicks with the real control (hold block on the defence side)', () => {
    const f = afterRound({ theirs: { legDmg: 2600 }, me: { legs: 3500 } });
    const lines = cornerAdvice(f.state, 0, opp);
    expect(lines[0]).toMatch(/legs/i);
    expect(lines[0]).toMatch(/holding block/);
    expect(lines[0]).toMatch(/left side/);
    // left-handed players defend on the right
    expect(cornerAdvice(f.state, 0, opp, true)[0]).toMatch(/right side/);
  });

  it('tells the player to sprawl when they keep getting taken down', () => {
    const f = afterRound({ theirs: { takedowns: 2, tdAttempts: 3, controlTicks: 1500 } });
    expect(cornerAdvice(f.state, 0, opp).join(' ')).toMatch(/sprawl/i);
    expect(cornerAdvice(f.state, 0, opp).join(' ')).toMatch(/swipe down/i);
  });

  it('spots a tiring opponent', () => {
    const f = afterRound({ them: { staminaCap: 6500, stamina: 2000, gassed: true } });
    expect(cornerAdvice(f.state, 0, opp).join(' ')).toMatch(/push the pace/);
  });

  it('uses her for a woman opponent', () => {
    const f = afterRound({ them: { staminaCap: 6500, stamina: 2000 } });
    expect(cornerAdvice(f.state, 0, named(opp, 'Ana Ruiz', 'f')).join(' ')).toMatch(/She's tiring/);
  });

  it('gives at most two lines, and a default when nothing stands out', () => {
    const busy = afterRound({ theirs: { legDmg: 3000, takedowns: 2, power: 40, landed: 60 }, me: { legs: 4000, head: 8000, body: 7000, staminaCap: 6000, gassed: true } });
    expect(cornerAdvice(busy.state, 0, opp).length).toBe(2);
    const quiet = afterRound();
    const lines = cornerAdvice(quiet.state, 0, opp);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/Good round/);
  });

  it('only calls the round when it is obvious', () => {
    const judges = [
      { striking: 900, grappling: 1100, nudge: 1 },
      { striking: 1100, grappling: 900, nudge: -1 },
      { striking: 1000, grappling: 1000, nudge: 0 },
    ];
    const r = (p: Partial<RoundStats>): RoundStats => ({ thrown: 50, landed: 25, power: 15, defended: 10, headDmg: 5000, bodyDmg: 1000, legDmg: 500, knockdowns: 0, takedowns: 0, tdAttempts: 0, controlTicks: 0, subAttempts: 0, ...p });
    expect(clearRoundWinner([r({ power: 35, landed: 50, headDmg: 14000, knockdowns: 1 }), r({})], judges)).toBe(0);
    expect(clearRoundWinner([r({}), r({ power: 30, landed: 45, headDmg: 12000 })], judges)).toBe(1);
    expect(clearRoundWinner([r({ power: 16, landed: 26 }), r({})], judges)).toBeNull();
  });

  it('reports the round for both fighters', () => {
    const f = afterRound({ mine: { landed: 33, thrown: 70, takedowns: 1, tdAttempts: 2, controlTicks: 65 * 60 / 2 } });
    const rep = cornerReport(f.state, 0, opp);
    expect(rep.round).toBe(1);
    expect(rep.landed[0]).toBe(33);
    expect(rep.thrown[0]).toBe(70);
    expect(rep.takedowns).toEqual([1, 0]);
    expect(mmss(rep.control[0])).toBe('0:33');
    expect(rep.advice.length).toBeGreaterThan(0);
  });
});

describe('commentary', () => {
  const specs: [FighterSpec, FighterSpec] = [named(testFighter('boxer'), 'Dante Okafor'), named(testFighter('kicker', 0, 'k'), 'Kenji Takeda')];
  const state = createFight({ seed: 1, a: specs[0], b: specs[1] }).state;
  const heavy = (tick: number, side: 0 | 1 = 0, extra: Partial<Extract<FightEvent, { type: 'hit' }>> = {}): FightEvent => ({
    type: 'hit',
    tick,
    side,
    move: 'cross',
    zone: 'head',
    dmg: 900,
    strength: 'heavy',
    counter: false,
    blocked: false,
    chain: 0,
    ...extra,
  });

  it('calls big moments with the fighters names', () => {
    const c = new Commentary(specs);
    expect(c.feed([heavy(100)], state)).toMatch(/Okafor|right hand|clean/);
    const kd = new Commentary(specs).feed([{ type: 'knockdown', tick: 100, side: 1, by: 'hookL', severity: 2 }], state);
    expect(kd).toMatch(/Takeda/);
  });

  it('says nothing about blocked or light shots', () => {
    const c = new Commentary(specs);
    expect(c.feed([heavy(100, 0, { blocked: true })], state)).toBeNull();
    expect(c.feed([heavy(100, 0, { strength: 'light' })], state)).toBeNull();
  });

  it('is rate limited, but a knockdown can cut in', () => {
    const c = new Commentary(specs);
    expect(c.feed([heavy(1000)], state)).not.toBeNull();
    expect(c.feed([heavy(1000 + CAPTION_GAP - 10, 1)], state)).toBeNull();
    expect(c.feed([{ type: 'knockdown', tick: 1000 + CAPTION_CUT_IN + 2, side: 1, by: 'cross', severity: 2 }], state)).not.toBeNull();
  });

  it('does not repeat the same kind of line too soon', () => {
    const c = new Commentary(specs);
    expect(c.feed([{ type: 'takedown', tick: 100, side: 0, caughtKick: false }], state)).not.toBeNull();
    expect(c.feed([{ type: 'takedown', tick: 100 + CAPTION_GAP + 5, side: 0, caughtKick: false }], state)).toBeNull();
  });

  it('picks the most important line from one tick', () => {
    const c = new Commentary(specs);
    const line = c.feed([heavy(500), { type: 'stun', tick: 500, side: 1 }], state);
    expect(line).toMatch(/Takeda/);
    expect(line).toMatch(/rocked|trouble|shaky/);
  });

  it('notices a comeback', () => {
    const c = new Commentary(specs);
    c.feed([{ type: 'knockdown', tick: 100, side: 0, by: 'cross', severity: 2 }], state);
    const line = c.feed([{ type: 'knockdown', tick: 2000, side: 1, by: 'hookR', severity: 2 }], state);
    expect(line).toMatch(/comeback|was in trouble/i);
  });

  it('calls the finish', () => {
    const c = new Commentary(specs);
    const result: FightResult = { winner: 0, method: 'KO', by: 'hookL', stoppage: null, sub: null, decision: null, round: 2, roundTick: 600, totalTicks: 9000, cards: [] };
    expect(c.feed([{ type: 'fightEnd', tick: 9000, result }], state)).toMatch(/Okafor/);
  });

  it('keeps every line original and plain (no organisation or real names)', () => {
    const c = new Commentary(specs);
    const all: FightEvent[] = [
      heavy(1),
      { type: 'knockdown', tick: 1, side: 1, by: 'legs', severity: 1 },
      { type: 'subStart', tick: 1, side: 0, sub: 'armbar' },
      { type: 'subEscape', tick: 1, side: 1, sub: 'armbar' },
      { type: 'takedown', tick: 1, side: 0, caughtKick: true },
      { type: 'roundEnd', tick: 1, round: 1 },
    ];
    for (const e of all) {
      const l = c.lineFor(e);
      expect(l?.text ?? '').not.toMatch(/UFC|Octagon/i);
    }
  });
});

describe('finish replay', () => {
  it('only replays KOs, TKOs and submissions', () => {
    const r = (method: FightResult['method'], stoppage: FightResult['stoppage'] = null): FightResult => ({ winner: 0, method, by: null, stoppage, sub: null, decision: null, round: 1, roundTick: 1, totalTicks: 100, cards: [] });
    expect(replayable(r('KO'))).toBe(true);
    expect(replayable(r('SUB'))).toBe(true);
    expect(replayable(r('TKO'))).toBe(true);
    expect(replayable(r('TKO', 'forfeit'))).toBe(false);
    expect(replayable(r('DEC'))).toBe(false);
    expect(replayable(null)).toBe(false);
  });

  it('is slowest around the finish', () => {
    expect(replaySpeed(1000 - 20, 1000)).toBeLessThan(replaySpeed(1000 - 150, 1000));
    expect(replaySpeed(1000, 1000)).toBeLessThan(0.5);
  });

  it('a snapshot plus the recorded inputs re-runs the finish exactly (and leaves the real fight alone)', () => {
    // find a fight between two AIs that ends early (KO, TKO or submission)
    let done = false;
    for (let seed = 1; seed <= 40 && !done; seed++) {
      const a = testFighter(ARCHETYPES[seed % 5]);
      const b = testFighter(ARCHETYPES[(seed + 2) % 5], 0, 'b');
      const live = createFight({ seed, a, b });
      const ca = new AIController({ difficulty: 500, seed });
      const cb = new AIController({ difficulty: 600, seed: seed + 9 });
      const snaps: { tick: number; state: FightState }[] = [];
      const codes: [number[], number[]] = [[], []];
      while (!live.state.result && live.state.tick < 40000) {
        if (live.state.tick % 30 === 0) snaps.push({ tick: live.state.tick, state: snapshot(live) });
        const inputs = [ca.next(viewFor(live, 0), 0), cb.next(viewFor(live, 1), 1)] as const;
        codes[0][live.state.tick] = encodeInput(inputs[0]);
        codes[1][live.state.tick] = encodeInput(inputs[1]);
        stepFight(live, [inputs[0], inputs[1]]);
        live.events.length = 0;
      }
      const res = live.state.result;
      if (!res || !replayable(res)) continue;
      done = true;
      const liveHash = hashState(live.state);
      const start = res.totalTicks - REPLAY_BEFORE;
      let snap = snaps[0];
      for (const s of snaps) if (s.tick <= start) snap = s;
      const copy = createFight({ seed, a, b, rules: live.rules });
      restore(copy, snap.state);
      while (copy.state.tick < res.totalTicks) {
        const t = copy.state.tick;
        stepFight(copy, [decodeInput(codes[0][t]), decodeInput(codes[1][t])]);
      }
      expect(copy.state.result?.method).toBe(res.method);
      expect(copy.state.result?.winner).toBe(res.winner);
      expect(hashState(copy.state)).toBe(liveHash);
      // the real fight is untouched
      expect(hashState(live.state)).toBe(liveHash);
    }
    expect(done).toBe(true);
  });
});
