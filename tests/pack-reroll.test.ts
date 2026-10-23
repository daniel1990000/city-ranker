// Packs can't be re-rolled by restoring an older save: the roll depends only on the save, not on the time.
import { describe, expect, it } from 'vitest';
import { exportCode, readCode } from '../src/meta/save';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

describe('pack rolls', () => {
  it('restoring a save code and opening again gives the same cards', async () => {
    const { Game } = await import('../src/app/game');
    const g = new Game();
    expect(g.save.firstAt).toBeGreaterThan(0);
    g.save.progress.packs.unopened.standard = 1;
    const code = exportCode(g.save);
    const a = g.openEarned('standard');
    expect(a.ok).toBe(true);
    const back = readCode(code);
    expect(back.ok).toBe(true);
    if (!back.ok || !a.ok) return;
    g.replaceSave(back.save, false);
    const b = g.openEarned('standard');
    expect(b.ok && b.result.cards.map(c => c.id)).toEqual(a.result.cards.map(c => c.id));
  });
});
