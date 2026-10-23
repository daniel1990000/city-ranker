// The synthesised sound bank: every sound renders to finite samples that never clip (no AudioContext needed).
import { describe, expect, it } from 'vitest';
import { sfxSound, type SfxId } from '../src/audio/sfx';
import { crowdSound } from '../src/audio/crowd';

const peak = (ch: Float32Array[]) => ch.reduce((a, c) => c.reduce((b, x) => (Number.isFinite(x) ? Math.max(b, Math.abs(x)) : Infinity), a), 0);

describe('sound bank', () => {
  it('fight and menu sounds are finite and below full scale', () => {
    const ids: SfxId[] = ['jab', 'power', 'body', 'legKick', 'blocked', 'whoosh', 'click', 'claim', 'tap'];
    for (const id of ids) {
      const p = sfxSound(id, 1);
      expect(p.ch[0].length, id).toBeGreaterThan(100);
      const pk = peak(p.ch);
      expect(pk, id).toBeLessThanOrEqual(1);
      expect(pk, id).toBeGreaterThan(0.05);
    }
  });

  it('variants differ, the same variant is the same every time', () => {
    const a = sfxSound('jab', 0).ch[0];
    expect(sfxSound('jab', 0).ch[0]).toEqual(a);
    expect(sfxSound('jab', 1).ch[0]).not.toEqual(a);
  });

  it('a crowd reaction renders', () => {
    const p = crowdSound('boo', 0);
    expect(peak(p.ch)).toBeLessThanOrEqual(1);
    expect(p.ch[0].length / p.sr).toBeGreaterThan(1);
  });
});
