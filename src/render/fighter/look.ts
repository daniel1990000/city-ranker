// A fighter's appearance as plain JSON, generated from a seed + hints so the roster needs no hand-made art
// (docs/ARCHITECTURE.md, contract 2). The body is one MPFB base mesh per sex; the look picks morph weights (build,
// ethnic facial structure, face shape), a skin texture and tone, hair, brows, eyes, stubble, shorts, gloves and
// tattoos. Deterministic: the same seed and hints always give the same fighter.

import type { DivisionId, LookHints } from '../../game/fight/types';

export type Race = 'caucasian' | 'african' | 'asian';
export type ShortsStyle = 'plain' | 'side' | 'split' | 'trim';
export type TattooId = 'sleeveL' | 'sleeveR' | 'chest' | 'back' | 'ribs' | 'forearmL' | 'forearmR' | 'calf';

export interface FighterLook {
  sex: 'm' | 'f';
  /** Total standing height (m). */
  height: number;
  /** Morph weights 0..1 (names from fighters.json). */
  morphs: Record<string, number>;
  /** Which skin texture set, and a tone multiplier on top (1 = as painted). */
  race: Race;
  tone: number;
  /** Warmth of the skin tint, -1 (cool) .. 1 (warm). */
  warmth: number;
  hair: string;
  /** Hair colour (sRGB hex). */
  hairColor: number;
  brow: string;
  eyes: string;
  /** Stubble / beard density 0..1 (men). */
  beard: number;
  shorts: ShortsStyle;
  shortsColor: number;
  shortsTrim: number;
  gloveColor: number;
  topColor: number;
  tattoos: TattooId[];
  tattooInk: number;
}

/** Small seeded RNG (mulberry32) for looks; floats are fine here (rendering only, never the simulation). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

export const HAIR_M = ['short01', 'short02', 'short03', 'short04', 'afro01', 'braid01', 'bald'] as const;
export const HAIR_F = ['ponytail01', 'braid01', 'bob01', 'short02', 'afro01', 'long01'] as const;
export const BROWS_M = ['eyebrow001', 'eyebrow004', 'eyebrow007'] as const;
export const BROWS_F = ['eyebrow002', 'eyebrow005', 'eyebrow010'] as const;
const EYES = ['brown', 'brown', 'brown', 'brownlight', 'blue', 'green', 'grey', 'deepblue'] as const;

const HAIR_COLORS = {
  dark: [0x15100c, 0x1c1410, 0x22180f, 0x0d0b0a],
  brown: [0x3b2414, 0x4a2f1a, 0x5a3a22],
  light: [0x8a6a3e, 0xa98450, 0xc8a46a],
  red: [0x6e2f14, 0x8c3b18],
};

const SHORTS_COLORS = [0x111111, 0x1b1b1f, 0xb3121c, 0x0f2f6b, 0xf2f2f2, 0x1d5c2a, 0xd4a64a, 0x5a1a6e, 0x2c2c2c, 0x0a5c7a, 0xc8520e];
const TRIM_COLORS = [0xd4a64a, 0xffffff, 0xd33333, 0x1a1a1a, 0x2a7fff, 0x39b54a];
const GLOVE_COLORS = [0x111111, 0x111111, 0x1a1a1a, 0xa01018, 0x0e2a66, 0xf0f0f0];

/** Typical height (m) per division and sex. */
const HEIGHT: Record<DivisionId, number> = {
  mLight: 1.75,
  mWelter: 1.8,
  mMiddle: 1.84,
  mHeavy: 1.91,
  wStraw: 1.6,
  wBantam: 1.68,
};

/** How heavy the division makes a body (0 = lean .. 1 = big). */
const MASS: Record<DivisionId, number> = { mLight: 0.15, mWelter: 0.35, mMiddle: 0.55, mHeavy: 0.9, wStraw: 0.15, wBantam: 0.45 };

export function lookFromSeed(seed: number, hints: LookHints, division: DivisionId): FighterLook {
  const r = rng(seed * 2654435761 + 12345);
  const sex = hints.sex;
  // ethnic facial structure and skin go together; tone varies inside each
  const race: Race =
    hints.skin === 'dark' ? 'african' : hints.skin === 'brown' ? pick(r, ['african', 'asian', 'caucasian'] as const) : hints.skin === 'tan' ? pick(r, ['asian', 'caucasian', 'caucasian'] as const) : hints.skin === 'light' ? pick(r, ['caucasian', 'caucasian', 'asian'] as const) : pick(r, ['caucasian', 'african', 'asian', 'caucasian'] as const);
  let tone = 1;
  if (hints.skin === 'brown' && race === 'caucasian') tone = 0.72;
  else if (hints.skin === 'tan') tone = 0.88;
  else if (hints.skin === 'dark') tone = 0.82 + r() * 0.2;
  else tone = 0.9 + r() * 0.16;
  const mass = MASS[division];
  const build = hints.build ?? pick(r, ['lean', 'athletic', 'athletic', 'muscular'] as const);
  const morphs: Record<string, number> = {
    heavy: Math.max(0, mass - 0.35) * 1.1 + (build === 'heavy' ? 0.45 : 0),
    thin: build === 'lean' ? 0.35 + r() * 0.2 : Math.max(0, 0.25 - mass) * 0.6,
    muscle: build === 'muscular' ? 0.7 + r() * 0.3 : build === 'athletic' ? 0.35 + r() * 0.25 : build === 'heavy' ? 0.3 : 0.15,
    soft: build === 'heavy' ? 0.4 + r() * 0.3 : 0,
    african: race === 'african' ? 0.75 + r() * 0.25 : race === 'asian' ? 0 : r() * 0.12,
    asian: race === 'asian' ? 0.7 + r() * 0.3 : race === 'african' ? 0 : r() * 0.12,
    faceSquare: r() * 0.7,
    faceOval: r() * 0.5,
    faceRound: r() * 0.3,
    noseBroad: r() * 0.6,
    older: r() * 0.45,
  };
  for (const k of Object.keys(morphs)) morphs[k] = Math.round(Math.min(1, morphs[k]) * 100) / 100;

  const hairList = sex === 'm' ? HAIR_M : HAIR_F;
  let hair: string = hints.hair && (hairList as readonly string[]).includes(hints.hair) ? hints.hair : pick(r, hairList);
  if (race !== 'african' && hair === 'afro01' && r() < 0.7) hair = sex === 'm' ? 'short02' : 'ponytail01';
  const colorSet = race === 'caucasian' ? pick(r, ['dark', 'brown', 'brown', 'light', 'red'] as const) : 'dark';
  const hairColor = pick(r, HAIR_COLORS[colorSet]);
  const tattoos: TattooId[] = [];
  if (hints.tattoos ?? r() < 0.45) {
    const all: TattooId[] = ['sleeveL', 'sleeveR', 'chest', 'back', 'ribs', 'forearmL', 'forearmR', 'calf'];
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const t = pick(r, all);
      if (!tattoos.includes(t)) tattoos.push(t);
    }
  }
  const shortsColor = pick(r, SHORTS_COLORS);
  let trim = pick(r, TRIM_COLORS);
  if (trim === shortsColor) trim = 0xffffff;
  return {
    sex,
    height: HEIGHT[division] + (r() - 0.5) * 0.08,
    morphs,
    race,
    tone: Math.round(tone * 100) / 100,
    warmth: Math.round((r() - 0.4) * 100) / 100,
    hair,
    hairColor,
    brow: pick(r, sex === 'm' ? BROWS_M : BROWS_F),
    eyes: race === 'caucasian' ? pick(r, EYES) : pick(r, ['brown', 'brown', 'brownlight'] as const),
    beard: sex === 'm' ? (hints.beard === true ? 0.6 + r() * 0.4 : hints.beard === false ? r() * 0.15 : r() < 0.5 ? r() * 0.9 : 0.05) : 0,
    shorts: pick(r, ['plain', 'side', 'split', 'trim'] as const),
    shortsColor,
    shortsTrim: trim,
    gloveColor: pick(r, GLOVE_COLORS),
    topColor: pick(r, [0x111111, shortsColor, 0x1b1b1f, trim]),
    tattoos,
    tattooInk: pick(r, [0x14181c, 0x14181c, 0x1a2230, 0x2a1414]),
  };
}
