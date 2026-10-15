/**
 * The broadcast "look" of a venue as plain numbers: exposure, bloom, colour grade, vignette and film grain.
 * Each venue preset carries one; the post pass reads it, and the pure helpers here blend between looks (a
 * venue change, or the brief "impact frame" kick on a big hit) without touching three.js.
 */

export type RGB = readonly [number, number, number];

export interface Grade {
  /** Brightness before tone mapping (1 = neutral). */
  exposure: number;
  /** How much of the bright parts glow (0 = off). */
  bloom: number;
  /** Linear brightness above which things start to glow. */
  bloomThreshold: number;
  /** 1 = neutral, 0 = grey. */
  saturation: number;
  /** 1 = neutral; above 1 crushes the shadows and lifts the highlights around mid-grey. */
  contrast: number;
  /** Added to the shadows (colour tint of the dark parts), e.g. [0.01, 0.0, 0.02] for a cool cast. */
  lift: RGB;
  /** Multiplies the highlights, e.g. [1.04, 1.0, 0.95] for warm light. */
  gain: RGB;
  /** 0..1 darkening toward the screen corners. */
  vignette: number;
  /** 0..1 film grain (hides banding in the dark arena; keep it subtle). */
  grain: number;
}

export const NEUTRAL_GRADE: Readonly<Grade> = Object.freeze({
  exposure: 1,
  bloom: 0.6,
  bloomThreshold: 1.0,
  saturation: 1,
  contrast: 1,
  lift: [0, 0, 0] as RGB,
  gain: [1, 1, 1] as RGB,
  vignette: 0.35,
  grain: 0.04,
});

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Blend two looks (t = 0 gives a, 1 gives b). Pure; allocates a new object, so call it on changes only. */
export function mixGrade(a: Readonly<Grade>, b: Readonly<Grade>, t: number): Grade {
  return {
    exposure: mix(a.exposure, b.exposure, t),
    bloom: mix(a.bloom, b.bloom, t),
    bloomThreshold: mix(a.bloomThreshold, b.bloomThreshold, t),
    saturation: mix(a.saturation, b.saturation, t),
    contrast: mix(a.contrast, b.contrast, t),
    lift: mix3(a.lift, b.lift, t),
    gain: mix3(a.gain, b.gain, t),
    vignette: mix(a.vignette, b.vignette, t),
    grain: mix(a.grain, b.grain, t),
  };
}

/** Keep every field inside the range the shaders handle well (remote tuning or typos can't break the picture). */
export function sanitiseGrade(g: Readonly<Grade>): Grade {
  const c = (v: number, lo: number, hi: number, d: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const c3 = (v: RGB, lo: number, hi: number, d: number): RGB => [c(v[0], lo, hi, d), c(v[1], lo, hi, d), c(v[2], lo, hi, d)];
  return {
    exposure: c(g.exposure, 0.2, 4, 1),
    bloom: c(g.bloom, 0, 3, 0.6),
    bloomThreshold: c(g.bloomThreshold, 0.1, 8, 1),
    saturation: c(g.saturation, 0, 2, 1),
    contrast: c(g.contrast, 0.5, 2, 1),
    lift: c3(g.lift, -0.1, 0.1, 0),
    gain: c3(g.gain, 0.5, 1.5, 1),
    vignette: c(g.vignette, 0, 1, 0.35),
    grain: c(g.grain, 0, 0.3, 0.04),
  };
}

/**
 * The colour grade applied to one linear colour after tone mapping (the same maths the composite shader runs),
 * so the tests can pin what a grade does to a pixel.
 */
export function gradePixel(rgb: RGB, g: Readonly<Grade>): RGB {
  const out: number[] = [0, 0, 0];
  const luma = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  for (let i = 0; i < 3; i++) {
    let v = luma + (rgb[i] - luma) * g.saturation;
    v = (v - 0.18) * g.contrast + 0.18;
    v = v * g.gain[i] + g.lift[i] * (1 - Math.min(1, Math.max(0, v)));
    out[i] = Math.max(0, v);
  }
  return [out[0], out[1], out[2]];
}
