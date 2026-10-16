import { describe, expect, it } from 'vitest';
import { AutoQuality, RES_FLOOR, type AutoTier } from '../src/render/autoQuality';

function run(q: AutoQuality, fps: number, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / fps) q.frame(1 / fps);
}

describe('auto quality', () => {
  it('steps resolution down on a slow phone, then scene detail', () => {
    const tier: AutoTier = { q: '', res: 1 };
    let changes = 0;
    const q = new AutoQuality(() => tier, () => changes++);
    run(q, 25, 7);
    expect(tier.res).toBeCloseTo(0.85);
    run(q, 25, 60);
    expect(tier.res).toBe(RES_FLOOR);
    expect(tier.q).toBe('low');
    const n = changes;
    run(q, 25, 30);
    expect(changes).toBe(n); // nothing left to lower
  });

  it('leaves a fast phone alone and ignores hitches', () => {
    const tier: AutoTier = { q: '', res: 1 };
    const q = new AutoQuality(() => tier, () => {});
    run(q, 60, 120);
    expect(tier).toEqual({ q: '', res: 1 });
    // one app switch (a 2 s frame) inside otherwise smooth play
    for (let i = 0; i < 5; i++) {
      q.frame(2);
      run(q, 60, 3);
    }
    expect(tier).toEqual({ q: '', res: 1 });
  });

  it('gives resolution back after a long fast stretch, but not in the session it was lowered', () => {
    const tier: AutoTier = { q: '', res: 0.7 };
    const q = new AutoQuality(() => tier, () => {});
    run(q, 60, 40);
    expect(tier.res).toBeCloseTo(0.8);
    const tier2: AutoTier = { q: '', res: 1 };
    const q2 = new AutoQuality(() => tier2, () => {});
    run(q2, 25, 7);
    run(q2, 60, 200);
    expect(tier2.res).toBeCloseTo(0.85);
  });
});
