// The fight screen's full-screen layers (TV captions and plates, the practice bar, the HUD) must let touches through
// to the controls: `#ui > *` makes every top-level layer touchable, so each of these needs its own exception.
// (0.4.0 shipped with the TV layer swallowing every touch: no strikes, no pause.)
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

describe('fight overlays', () => {
  it('let touches through to the controls', () => {
    const css = fs.readFileSync('src/ui/styles.css', 'utf8').replace(/\s+/g, ' ');
    const rule = /#ui > \.bc, #ui > \.practice-hud, #ui > \.hud \{ pointer-events: none; \}/;
    expect(css).toMatch(rule);
    expect(css.indexOf('#ui > * { pointer-events: auto; }')).toBeLessThan(css.search(rule));
  });
});
