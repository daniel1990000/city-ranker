// Automatic graphics quality ("Auto" in settings). Watches frame times during fights: if the phone can't keep up,
// first the render resolution steps down (applies at once), and when that is already at its floor the scene detail
// drops to low (applies from the next fight). A phone that runs comfortably fast for a long stretch gets resolution
// back, one step at a time. The choice is remembered in the save (settings.autoTier).

export interface AutoTier {
  q: '' | 'low' | 'medium' | 'high';
  res: number;
}

export const RES_FLOOR = 0.6;
const RES_STEP = 0.15;
/** One measuring window, in seconds of real play. */
const WINDOW = 3;
/** Below this average fps a window counts as slow. */
const SLOW_FPS = 40;
/** Above this average fps a window counts as fast. */
const FAST_FPS = 57;
/** Slow windows in a row before stepping down; fast windows in a row before stepping up. */
const SLOW_STREAK = 2;
const FAST_STREAK = 12;
/** A frame this long is a hitch from outside the game (app switch, GC pause): the window is thrown away. */
const HITCH = 0.25;

export class AutoQuality {
  private time = 0;
  private frames = 0;
  private spoiled = false;
  private slow = 0;
  private fast = 0;
  /** Stepped down in this session: don't step back up until the next one (no see-sawing). */
  private lowered = false;

  constructor(
    /** The saved tier (a getter: the save can be replaced by a restore). */
    private readonly get: () => AutoTier,
    /** The tier changed: save it, and apply the resolution. */
    private readonly onChange: (t: AutoTier) => void,
  ) {}

  /** Start of a fight: drop the partial window (loading makes the first frames slow). */
  reset(): void {
    this.time = 0;
    this.frames = 0;
    this.spoiled = false;
  }

  /** One rendered frame of live play, `dt` in seconds. */
  frame(dt: number): void {
    if (dt > HITCH) this.spoiled = true;
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW) return;
    const fps = this.frames / this.time;
    const spoiled = this.spoiled;
    this.reset();
    if (spoiled) return;
    if (fps < SLOW_FPS) {
      this.fast = 0;
      if (++this.slow >= SLOW_STREAK) {
        this.slow = 0;
        this.stepDown();
      }
    } else if (fps > FAST_FPS) {
      this.slow = 0;
      if (++this.fast >= FAST_STREAK) {
        this.fast = 0;
        this.stepUp();
      }
    } else {
      this.slow = 0;
      this.fast = 0;
    }
  }

  private stepDown(): void {
    this.lowered = true;
    const t = this.get();
    if (t.res > RES_FLOOR + 1e-6) {
      t.res = Math.max(RES_FLOOR, Math.round((t.res - RES_STEP) * 100) / 100);
    } else if (t.q !== 'low') {
      t.q = 'low';
    } else {
      return;
    }
    this.onChange(t);
  }

  private stepUp(): void {
    const t = this.get();
    if (this.lowered || t.res >= 1) return;
    t.res = Math.min(1, Math.round((t.res + 0.1) * 100) / 100);
    this.onChange(t);
  }
}
