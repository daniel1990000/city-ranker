// Records the "golden replay": a short, varied fight (clinch, takedown, ground transitions, submission attempt, health events, a knockdown and a stoppage)
// that the test-suite re-simulates and compares hash-for-hash. Any change to the sim, tunables or AI changes the fight —
// re-record deliberately with `npm run golden` and review the diff of the coverage report.
//   node demo/record-golden.js [--out ../data/replays/golden-1.json]

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FightSim, DEFAULT_FIGHTERS, playReplay } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : resolve(here, '../../data/replays/golden-1.json');

const WANT = ['clinch_start', 'takedown', 'ground_position', 'submission', 'health_event', 'injury', 'catch', 'ability', 'pass', 'get_up', 'referee', 'knockdown', 'stoppage', 'combo'];
const withAbilities = (f, k) => ({ ...f, abilities: k % 2 ? ['iron_fist', 'level_change'] : ['flurry', 'iron_grip'] });

let best = null;
for (let seed = 1; seed <= 80; seed++) {
  for (const [i, j] of [[2, 4], [4, 5], [6, 3], [2, 5], [0, 6]]) {
    const sim = new FightSim({ seed, rounds: 1, roundSeconds: 120, fighters: [withAbilities(DEFAULT_FIGHTERS[i], 1), withAbilities(DEFAULT_FIGHTERS[j], 0)], record: true, replay: true });
    sim.run();
    const kinds = new Set(sim.world.bus.log.map((e) => e.type));
    const score = WANT.filter((k) => kinds.has(k)).length * 10 + (sim.result.stoppage === 'decision' ? 5 : 0) - Math.abs(sim.world.tick - 7200) / 1000;
    if (!best || score > best.score) best = { score, seed, pair: [i, j], sim, kinds };
  }
}
const data = best.sim.recorder.export();
data.note = `golden replay: seed ${best.seed}, fighters ${DEFAULT_FIGHTERS[best.pair[0]].id} vs ${DEFAULT_FIGHTERS[best.pair[1]].id}; regenerate with npm run golden`;
const check = playReplay(JSON.parse(JSON.stringify(data)));
if (!check.ok) throw new Error(`replay does not reproduce: ${JSON.stringify(check.mismatch)}`);
writeFileSync(out, JSON.stringify(data));
console.log(`wrote ${out}: ${data.note}`);
console.log(`  ${data.ticks} ticks, ${data.log.length} intent changes, ${data.checkpoints.length} checkpoints, result ${data.result.result}/${data.result.method}`);
console.log(`  covers: ${WANT.filter((k) => best.kinds.has(k)).join(', ')}`);
console.log(`  missing: ${WANT.filter((k) => !best.kinds.has(k)).join(', ') || 'nothing'}`);
