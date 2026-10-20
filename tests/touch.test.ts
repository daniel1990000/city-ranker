// The touch controls in the moments the owner's playtest hit: the submission tap battle and getting up.
import { describe, expect, it } from 'vitest';
import { InputRecognizer } from '../src/game/touch/recognizer';
import { computeTouchLayout } from '../src/game/touch/layout';
import type { TouchContext } from '../src/game/touch/types';

const layout = computeTouchLayout(844, 390, undefined, { pxPerDp: 1 });
const sub: TouchContext = { mode: 'sub', forward: 1, sprawl: false, specialReady: false };

describe('touch: tap battles', () => {
  it('every finger that lands in a submission is a tap, wherever it lands, one per tick', () => {
    const r = new InputRecognizer({ layout, pxPerDp: 1 });
    r.tick(0, sub);
    let taps = 0;
    let t = 0;
    // 7 taps a second for 3 seconds, alternating thumbs on both halves of the screen
    for (let i = 0; i < 21; i++) {
      const x = i % 2 ? 700 : 150;
      r.pointerDown(i, x, 250, t);
      r.pointerUp(i, x, 250, t + 40);
      for (let k = 0; k < 9; k++) {
        t += 1000 / 60;
        if (r.tick(t, sub).tap) taps++;
      }
    }
    expect(taps).toBe(21);
  });

  it('a thumb already down when the submission starts does not count, the next tap does', () => {
    const r = new InputRecognizer({ layout, pxPerDp: 1 });
    r.pointerDown(1, 150, 250, 0);
    r.tick(16, { ...sub, mode: 'ground' });
    expect(r.tick(33, sub).tap).toBe(false);
    r.pointerDown(2, 700, 250, 40);
    expect(r.tick(50, sub).tap).toBe(true);
  });
});
