import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from '../demo/build-data.js';
import { MoveBook, validateMove } from '../src/combat/moves.js';
import { RATINGS, TENDENCIES, FIGHTING_STYLES, WEIGHT_CLASSES, Slot, GroundPosition, SUBMISSIONS } from '../src/core/taxonomy.js';
import { DEFAULT_TUNABLES } from '../src/core/tunables.js';
import { playReplay } from '../src/sim/replayer.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');                 // mma-combat-plan/
const read = (rel) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

test('committed data/*.json equals what the sources generate (run `npm run build-data` after editing src/)', () => {
  for (const [name, expected] of Object.entries(buildAll())) assert.deepEqual(read(`data/${name}`), JSON.parse(JSON.stringify(expected)), name);
});

test('moves.json: schema header, unique ids, every move valid, loadable by the MoveBook', () => {
  const d = read('data/moves.json');
  assert.deepEqual([d.schema, d.version], ['mma.moves', 1]);
  assert.equal(new Set(d.moves.map((m) => m.id)).size, d.moves.length);
  for (const m of d.moves) assert.deepEqual(validateMove(m), [], m.id);
  assert.doesNotThrow(() => new MoveBook(d.moves));
});

test('fighters.json: eight fictional fighters with all 25 ratings in 0–100 and valid style / tendency / stance', () => {
  const d = read('data/fighters.json');
  assert.equal(d.fighters.length, 8);
  assert.equal(new Set(d.fighters.map((f) => f.id)).size, 8);
  for (const f of d.fighters) {
    assert.deepEqual(Object.keys(f.ratings).sort(), [...RATINGS].sort(), f.id);
    for (const v of Object.values(f.ratings)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${f.id} ${v}`);
    assert.ok(FIGHTING_STYLES.includes(f.style) && TENDENCIES.includes(f.tendency) && ['orthodox', 'southpaw'].includes(f.stance));
    assert.ok(f.physique.reachCm > 150 && f.physique.heightCm > 150);
  }
  assert.equal(new Set(d.fighters.map((f) => f.tendency)).size, 8, 'one archetype family each');
});

test('taxonomy.json carries the observed vocabulary counts', () => {
  const t = read('data/taxonomy.json');
  assert.equal(t.ratings.length, 25); assert.equal(t.tendencies.length, 12); assert.equal(t.fightingStyles.length, 10); assert.equal(t.weightClasses.length, WEIGHT_CLASSES.length);
  assert.deepEqual(t.slots, Object.values(Slot)); assert.equal(t.slots.length, 10);
  assert.equal(t.groundPositions.length, Object.keys(GroundPosition).length);
  assert.equal(t.judgeComponents.length, 12); assert.equal(t.aggressionFactors.length, 21);
  assert.equal(Object.keys(t.submissions).length, Object.keys(SUBMISSIONS).length);
  assert.equal(t.healthEvents.length, 8);
  const total = Object.values(t.clinchTakedowns).reduce((s, byRole) => s + byRole.dom.length + byRole.sub.length, 0);
  assert.ok(total >= 40, `clinch takedown table has ${total} entries`);
});

test('tunables.json mirrors DEFAULT_TUNABLES; every documented section exists', () => {
  const d = read('data/tunables.json');
  assert.deepEqual(d.tunables, JSON.parse(JSON.stringify(DEFAULT_TUNABLES)));
  for (const s of ['fighter', 'stamina', 'pools', 'damage', 'defense', 'strike', 'healthEvents', 'clinch', 'takedown', 'ground', 'submission', 'referee', 'recovery', 'scoring', 'ai']) assert.ok(d.tunables[s], s);
});

// A knob nothing reads is a trap for the next person who tunes it. Presentation-only values and per-id tables that are looked up
// with a computed key are listed here on purpose.
const NOT_READ_BY_NAME = [/^strike\.hitStopTicks/, /^healthEvents\.profiles\./];
function leafPaths(o, prefix = '') {
  return Object.entries(o).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? [p, ...leafPaths(v, p)] : [p];
  });
}
function sourceText(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = resolve(dir, n);
    if (statSync(p).isDirectory()) return [sourceText(p)];
    return p.endsWith('.js') && !p.endsWith('core/tunables.js') ? [readFileSync(p, 'utf8')] : [];
  }).join('\n');
}

test('every tunable key is read somewhere in src/ (no dead knobs)', () => {
  const text = sourceText(resolve(here, '../src'));
  const dead = leafPaths(DEFAULT_TUNABLES).filter((p) => !NOT_READ_BY_NAME.some((re) => re.test(p)) && !new RegExp(`\\b${p.split('.').pop()}\\b`).test(text));
  assert.deepEqual(dead, []);
});

test('golden replay still re-simulates bit-identically (re-record deliberately with `npm run golden` if the sim changed on purpose)', () => {
  const data = read('data/replays/golden-1.json');
  const r = playReplay(data);
  assert.ok(r.ok, `diverged at ${JSON.stringify(r.mismatch)} — the sim, tunables or AI changed`);
  assert.equal(r.checked, data.checkpoints.length);
});

test('package scripts point at files that exist', () => {
  const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
  for (const cmd of Object.values(pkg.scripts)) {
    const m = cmd.match(/node (demo\/[\w-]+\.js)/);
    if (m) assert.ok(existsSync(resolve(here, '..', m[1])), cmd);
  }
});

// ---- documentation consistency -----------------------------------------------------------------------------------------
function expandBraces(p) {
  const m = p.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!m) return [p];
  return m[2].split(',').flatMap((alt) => expandBraces(`${m[1]}${alt}${m[3]}`));
}

test('every tunable path named in the docs (e.g. `clinch.range`) exists in DEFAULT_TUNABLES', () => {
  const sections = Object.keys(DEFAULT_TUNABLES).join('|');
  const re = new RegExp('`((?:' + sections + ')(?:\\.[A-Za-z][\\w]*)+)`', 'g');
  const known = new Set(leafPaths(DEFAULT_TUNABLES));
  const missing = [];
  for (const f of readdirSync(resolve(root, 'docs')).filter((n) => n.endsWith('.md'))) {
    for (const m of readFileSync(resolve(root, 'docs', f), 'utf8').matchAll(re)) {
      if (!/\.(js|json|md)$/.test(m[1]) && !known.has(m[1])) missing.push(`${f}: ${m[1]}`);     // `damage.js` is a file, not a tunable
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('every reference/ file named in the docs exists', () => {
  const docs = readdirSync(resolve(root, 'docs')).filter((f) => f.endsWith('.md'));
  assert.ok(docs.length >= 20, `docs found: ${docs.length}`);
  const missing = [];
  for (const f of ['README.md', ...docs.map((d) => `docs/${d}`)]) {
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/(?:reference\/)?((?:src|test|demo)\/[\w./{},-]+\.js)/g)) {
      for (const rel of expandBraces(m[1])) {
        if (!existsSync(resolve(root, 'reference', rel))) missing.push(`${f}: ${rel}`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('every data/ and tools/ file named in the docs and the README exists (top-level paths only, not src/data/)', () => {
  const missing = [];
  for (const f of ['README.md', ...readdirSync(resolve(root, 'docs')).filter((n) => n.endsWith('.md')).map((n) => `docs/${n}`)]) {
    const text = readFileSync(resolve(root, f), 'utf8');
    for (const m of text.matchAll(/(?<![\w./-])((?:data|tools)\/[\w./{},-]+\.(?:json|js|py|md))/g)) {
      for (const rel of expandBraces(m[1])) if (!existsSync(resolve(root, rel))) missing.push(`${f}: ${rel}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
