// The fighter clips: every action has a clip, sampling never changes the shared key poses (the bug that bent the
// fighting stance in the first animation rewrite), and the animator picks ground variants and scales hit reactions.
import { describe, expect, it } from 'vitest';
import { CLIPS, pickClip, sampleClip, VARIANT_CLIPS } from '../src/render/fighter/clips';
import { clonePose, mixPose, STANCE } from '../src/render/fighter/poses';
import { FighterAnimator } from '../src/render/fighter/animator';

const snapshot = () => JSON.stringify(STANCE);

describe('fighter animation', () => {
  it('sampling every clip at every time leaves the stance and the key poses untouched', () => {
    const before = snapshot();
    const keysBefore = JSON.stringify(Object.values(CLIPS).map(c => c.keys));
    const out = clonePose(STANCE);
    for (const c of [...Object.values(CLIPS), ...Object.values(VARIANT_CLIPS)]) for (let u = 0; u <= 1.001; u += 0.05) sampleClip(c, u, out, mixPose);
    expect(snapshot()).toBe(before);
    expect(JSON.stringify(Object.values(CLIPS).map(c => c.keys))).toBe(keysBefore);
  });

  it('every pose is finite', () => {
    const out = clonePose(STANCE);
    for (const [id, c] of Object.entries(CLIPS)) {
      for (let u = 0; u <= 1.001; u += 0.1) {
        const p = sampleClip(c, u, out, mixPose);
        expect(JSON.stringify(p).includes('null'), id).toBe(false);
      }
    }
  });

  it('the animator picks the guard variant of a ground punch, and a bigger hit swings further', () => {
    expect(pickClip('gndPound', 'gndGuardTop', 'guardTop')).toBe(VARIANT_CLIPS.gndPoundGuard);
    expect(pickClip('gndPound', 'gndMountTop', 'mountTop')).toBe(CLIPS.gndPound);
    const swing = (len: number) => {
      const a = new FighterAnimator();
      let p = a.update('idle', 0, 0, -1, 1);
      for (let t = 0; t <= 4; t++) p = a.update('hitHeadHeavy', t, len, -1, 0.5);
      return Math.abs(p.head[1] - STANCE.head[1]) + Math.abs(p.head[0] - STANCE.head[0]);
    };
    expect(swing(42)).toBeGreaterThan(swing(18));
  });
});
