// Regenerates ../../data/*.json from the JS sources (single source of truth = src/).
// usage: node demo/build-data.js          (a test asserts the committed JSON equals this output)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefaultMoves } from '../src/data/default-moves.js';
import { DEFAULT_FIGHTERS } from '../src/data/default-fighters.js';
import { DEFAULT_TUNABLES } from '../src/core/tunables.js';
import { taxonomySnapshot } from '../src/core/taxonomy.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../data');
mkdirSync(dataDir, { recursive: true });

export function buildAll() {
  return {
    'moves.json': { schema: 'mma.moves', version: 1, moves: buildDefaultMoves() },
    'fighters.json': { schema: 'mma.fighters', version: 1, fighters: DEFAULT_FIGHTERS },
    'tunables.json': { schema: 'mma.tunables', version: 1, tunables: DEFAULT_TUNABLES },
    'taxonomy.json': taxonomySnapshot(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, obj] of Object.entries(buildAll())) {
    writeFileSync(resolve(dataDir, name), JSON.stringify(obj, null, 2) + '\n');
    console.log('wrote', name);
  }
}
