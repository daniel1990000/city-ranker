// Calibration CLI: run N bot-vs-bot fights and compare the result mix with design targets (docs/17 §6, docs/19).
//   node demo/calibrate.js [--fights 60] [--seed 1] [--rounds 3] [--set path=value ...] [--threads 4] [--json]
// Tunable overrides use dotted paths into DEFAULT_TUNABLES, e.g.  --set pools.headBase=260 --set ai.gapTicks.slow=300

import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { runOne, summarize, TARGETS } from '../src/sim/batch.js';

function parseArgs(argv) {
  const o = { fights: 60, seed: 1, rounds: 3, threads: Math.min(4, os.cpus().length), json: false, set: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fights') o.fights = +argv[++i];
    else if (a === '--seed') o.seed = +argv[++i];
    else if (a === '--rounds') o.rounds = +argv[++i];
    else if (a === '--threads') o.threads = +argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--set') {
      const [path, val] = argv[++i].split('=');
      let cur = o.set;
      const parts = path.split('.');
      for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {});
      cur[parts.at(-1)] = Number.isNaN(+val) ? val : +val;
    }
  }
  return o;
}

const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));

function report(summary, o) {
  console.log(`\nCalibration — ${summary.fights} fights, ${o.rounds} rounds, seed ${o.seed}${Object.keys(o.set).length ? `, overrides ${JSON.stringify(o.set)}` : ''}`);
  const rows = flat({ finish: summary.finish, perFighterRound: summary.perFighterRound, perFighterFight: summary.perFighterFight, timeShare: summary.timeShare });
  for (const [k, v] of rows) {
    const range = (() => { const path = k.split('.'); let cur = TARGETS; for (const p of path) cur = cur?.[p]; return Array.isArray(cur) ? cur : null; })();
    const flag = range ? (v >= range[0] && v <= range[1] ? '  ok' : '  <-- outside') : '';
    console.log(`  ${k.padEnd(34)} ${String(v).padStart(8)}${range ? `   target ${range[0]}–${range[1]}` : ''}${flag}`);
  }
  console.log(`  ${'avgFightSeconds'.padEnd(34)} ${String(summary.avgFightSeconds).padStart(8)}\n  ${'illegal AI intents'.padEnd(34)} ${String(summary.violations).padStart(8)}\n  ${'ms per tick'.padEnd(34)} ${String(summary.msPerTick).padStart(8)}`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const chunks = Array.from({ length: Math.max(1, o.threads) }, (_, k) => []);
  for (let i = 0; i < o.fights; i++) chunks[i % chunks.length].push(i);
  const rows = (await Promise.all(chunks.filter((c) => c.length).map((indices) => new Promise((resolve, reject) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { indices, seed: o.seed, rounds: o.rounds, tunables: o.set } });
    w.on('message', resolve); w.on('error', reject);
  })))).flat().sort((a, b) => a.index - b.index);
  const summary = summarize(rows, { rounds: o.rounds });
  summary.msPerTick = +((performance.now() - t0) * Math.max(1, Math.min(o.threads, o.fights)) / rows.reduce((s, r) => s + r.ticks, 0)).toFixed(4);
  if (o.json) console.log(JSON.stringify(summary, null, 2)); else report(summary, o);
}

if (isMainThread) await main();
else {
  const { indices, seed, rounds, tunables } = workerData;
  parentPort.postMessage(indices.map((index) => runOne({ index, seed, rounds, tunables, debug: true })));
}
