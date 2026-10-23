// Batch runner for calibration and statistical tests: simulate many bot-vs-bot fights and summarise what a viewer would see
// (finish mix, strike volume and accuracy, grappling usage). Pairings cycle through the roster so every style meets every other.

import { FightSim } from './fight-sim.js';
import { DEFAULT_FIGHTERS } from '../data/default-fighters.js';
import { TICK_HZ } from '../core/taxonomy.js';

/** Fight `index` (0-based) of a batch: deterministic pairing and seed. */
export function pairing(roster, index) {
  const n = roster.length;
  const a = index % n;
  const step = 1 + (Math.floor(index / n) % (n - 1));
  return [roster[a], roster[(a + step) % n]];
}

export function runOne({ index, seed = 1, rounds = 3, tunables = {}, roster = DEFAULT_FIGHTERS, debug = false }) {
  const [fa, fb] = pairing(roster, index);
  const sim = new FightSim({ seed: seed * 100003 + index, fighters: [fa, fb], rounds, tunables, debug });
  const result = sim.run();
  const st = sim.world.stats;
  const per = {};
  for (const f of sim.world.fighters) {
    const g = (k) => st.get(f.id, k);
    per[f.id] = {
      thrown: g('strikes.thrown'), landed: g('strikes.landed'), blocked: g('strikes.blocked'), sig: g('strikes.sig.landed'), head: g('strikes.landed.head'),
      kd: g('knockdowns.against'), tdAtt: g('takedowns.attempted'), tdLand: g('takedowns.landed'), clinch: g('clinch.success'),
      subAtt: g('subs.attempted'), subLocked: g('subs.locked'), subEsc: g('subs.escaped'),
      tStand: g('time.standup'), tClinch: g('time.clinch.dom') + g('time.clinch.sub'), tGround: g('time.ground.top') + g('time.ground.bottom'), tSub: g('time.submission.attacker') + g('time.submission.defender'), tDown: g('time.down'),
    };
  }
  return { index, ids: [fa.id, fb.id], result, ticks: sim.world.tick, violations: sim.violations.length, per, rounds: sim.match.round };
}

export function summarize(rows, { rounds = 3 } = {}) {
  const n = rows.length;
  const res = { ko: 0, tko: 0, submission: 0, decision: 0, draw: 0 };
  let ticks = 0, fighterRounds = 0;
  const sum = { thrown: 0, landed: 0, sig: 0, tdAtt: 0, tdLand: 0, clinch: 0, subAtt: 0, subLocked: 0, kd: 0, tStand: 0, tClinch: 0, tGround: 0, tSub: 0, tDown: 0 };
  for (const r of rows) {
    const k = r.result.result;
    if (k === 'ko') res.ko++; else if (k === 'tko') res.tko++; else if (k === 'submission') res.submission++;
    else if (k.includes('draw')) res.draw++; else res.decision++;
    ticks += r.ticks;
    fighterRounds += 2 * ((r.result.stoppage === 'decision' ? rounds : (r.result.clock / (5 * 60 * TICK_HZ)) + (r.result.round - 1)));
    for (const p of Object.values(r.per)) for (const key of Object.keys(sum)) sum[key] += p[key] ?? 0;
  }
  const pct = (x) => +(100 * x / n).toFixed(1);
  const timeTotal = sum.tStand + sum.tClinch + sum.tGround + sum.tSub + sum.tDown || 1;
  return {
    fights: n,
    finish: { ko: pct(res.ko), tko: pct(res.tko), submission: pct(res.submission), decision: pct(res.decision), draw: pct(res.draw), koTko: pct(res.ko + res.tko) },
    avgFightSeconds: +(ticks / n / TICK_HZ).toFixed(0),
    perFighterRound: {
      thrown: +(sum.thrown / fighterRounds).toFixed(1), landed: +(sum.landed / fighterRounds).toFixed(1), sigLanded: +(sum.sig / fighterRounds).toFixed(1),
      accuracy: +(100 * sum.landed / Math.max(1, sum.thrown)).toFixed(1),
    },
    perFighterFight: { takedownAttempts: +(sum.tdAtt / (2 * n)).toFixed(2), takedownAccuracy: +(100 * sum.tdLand / Math.max(1, sum.tdAtt)).toFixed(1), clinches: +(sum.clinch / (2 * n)).toFixed(2), submissionAttempts: +(sum.subAtt / (2 * n)).toFixed(2), knockdownsAgainst: +(sum.kd / (2 * n)).toFixed(2) },
    timeShare: { standup: +(100 * sum.tStand / timeTotal).toFixed(1), clinch: +(100 * sum.tClinch / timeTotal).toFixed(1), ground: +(100 * sum.tGround / timeTotal).toFixed(1), submission: +(100 * sum.tSub / timeTotal).toFixed(1), down: +(100 * sum.tDown / timeTotal).toFixed(1) },
    msPerTick: null,
    violations: rows.reduce((s, r) => s + r.violations, 0),
  };
}

export function runBatch({ fights = 40, ...opts } = {}) {
  const t0 = performance.now();
  const rows = [];
  for (let i = 0; i < fights; i++) rows.push(runOne({ index: i, ...opts }));
  const out = summarize(rows, opts);
  const ticks = rows.reduce((s, r) => s + r.ticks, 0);
  out.msPerTick = +((performance.now() - t0) / ticks).toFixed(4);
  return { summary: out, rows };
}

/** Targets a plausible MMA sim should land near (design targets, not extracted data). */
export const TARGETS = Object.freeze({
  finish: { koTko: [25, 35], submission: [8, 14], decision: [52, 66], draw: [0, 4] },
  perFighterRound: { thrown: [40, 80], accuracy: [30, 45], sigLanded: [12, 30] },
  perFighterFight: { takedownAttempts: [1.5, 7], takedownAccuracy: [30, 55], submissionAttempts: [1, 4], knockdownsAgainst: [0.1, 0.6] },
  timeShare: { ground: [8, 25], clinch: [4, 15] },
});
