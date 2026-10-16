// Fight balance simulation: AI-vs-AI fights headless. Reports archetype win rates, finish mix, fight length, the
// effect of stat gaps and the difficulty curve against a human-like player bot.
// Run: OUT=/tmp/q/balance.md RUNS=30 npx vitest run --config /dev/null scripts/qa/fight-balance.test.ts
import { expect, test } from 'vitest';
import * as fs from 'node:fs';
import { AIController, humanLikeBot, runFight } from '../../src/game/fight';
import { ARCHETYPES, testFighter } from '../../tests/fight-helpers';

const RUNS = Number(process.env.RUNS ?? 12);

test('fight balance', () => {
  const lines: string[] = ['# Fight balance', '', `RUNS=${RUNS} fights per matchup / setting`, ''];
  const methods: Record<string, number> = {};
  const wins: Record<string, number> = {};
  let ticks = 0;
  let n = 0;
  const matrix: Record<string, Record<string, number>> = {};
  for (const a of ARCHETYPES) {
    matrix[a] = {};
    for (const b of ARCHETYPES) {
      let w = 0;
      for (let s = 0; s < RUNS; s++) {
        const { result } = runFight(s * 7919 + a.length * 31 + b.length * 7, testFighter(a), testFighter(b, 0, 'b'), new AIController({ difficulty: 600, seed: s }), new AIController({ difficulty: 600, seed: s + 99 }));
        methods[result.method] = (methods[result.method] ?? 0) + 1;
        if (result.winner === 0) w++;
        else if (result.winner === null) w += 0.5;
        ticks += result.totalTicks;
        n++;
      }
      matrix[a][b] = w / RUNS;
      wins[a] = (wins[a] ?? 0) + w / RUNS / ARCHETYPES.length;
    }
  }
  lines.push('## Archetypes (row beats column, %)', '', '| | ' + ARCHETYPES.join(' | ') + ' | vs field |', '|' + '---|'.repeat(ARCHETYPES.length + 2));
  for (const a of ARCHETYPES) lines.push(`| ${a} | ` + ARCHETYPES.map(b => Math.round(matrix[a][b] * 100)).join(' | ') + ` | **${Math.round(wins[a] * 100)}** |`);
  lines.push('', '## Finishes', '');
  for (const [k, v] of Object.entries(methods)) lines.push(`- ${k}: ${Math.round((v / n) * 100)} %`);
  lines.push(`- average fight: ${Math.round(ticks / n / 60)} s`, '');

  lines.push('## Difficulty curve (human-like bot win %)', '');
  const curve: number[] = [];
  for (const d of [0, 250, 500, 750, 1000]) {
    let w = 0;
    const N = RUNS * 3;
    for (let s = 0; s < N; s++) {
      const a = ARCHETYPES[s % 5];
      const b = ARCHETYPES[(s * 3 + 1) % 5];
      const { result } = runFight(s * 131 + d, testFighter(a), testFighter(b), humanLikeBot(s, a), new AIController({ difficulty: d, seed: s + 7 }));
      if (result.winner === 0) w++;
      else if (result.winner === null) w += 0.5;
    }
    curve.push(w / N);
    lines.push(`- difficulty ${d}: ${Math.round((w / N) * 100)} %`);
  }
  lines.push('', '## Stat gaps (equal AI, +N on every stat)', '');
  const gaps: number[] = [];
  for (const bonus of [10, 20]) {
    let w = 0;
    const N = RUNS * 3;
    for (let s = 0; s < N; s++) {
      const a = ARCHETYPES[s % 5];
      const b = ARCHETYPES[(s * 3 + 1) % 5];
      const { result } = runFight(s * 17 + bonus, testFighter(a, bonus), testFighter(b), new AIController({ difficulty: 600, seed: s }), new AIController({ difficulty: 600, seed: s + 7 }));
      if (result.winner === 0) w++;
      else if (result.winner === null) w += 0.5;
    }
    gaps.push(w / N);
    lines.push(`- +${bonus}: ${Math.round((w / N) * 100)} %`);
  }
  const report = lines.join('\n') + '\n';
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, report);
  else console.log(report);

  // broad guard rails (tight targets are in docs/FIGHT-DESIGN.md; small RUNS are noisy)
  for (const a of ARCHETYPES) expect(wins[a], a).toBeGreaterThan(0.25);
  for (const a of ARCHETYPES) expect(wins[a], a).toBeLessThan(0.75);
  expect((methods.DEC ?? 0) / n).toBeGreaterThan(0.25);
  expect((methods.DEC ?? 0) / n).toBeLessThan(0.75);
  expect(curve[0]).toBeGreaterThan(curve[4]);
  expect(gaps[1]).toBeGreaterThan(0.7);
}, 600000);
