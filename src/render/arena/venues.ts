/**
 * The six venues as data (plan §6: back-street gym, county fair, nightclub, stadium, beach, rooftop). They all
 * share the same cage; a preset only sets the lighting rig, colours, backdrop, crowd and colour grade, so a new
 * venue is a new entry here plus (optionally) a backdrop builder in backdrop.ts.
 *
 * Colours are hex numbers in sRGB, like CSS. Light intensities are three.js units with no distance falloff
 * (decay 0): about 3 makes a white surface facing the light fully white before tone mapping.
 */
import type { Grade } from '../post/grade';
import type { SeatSection } from './layout';

export type VenueId = 'gym' | 'fair' | 'nightclub' | 'stadium' | 'beach' | 'rooftop';

export const VENUE_IDS: readonly VenueId[] = ['gym', 'fair', 'nightclub', 'stadium', 'beach', 'rooftop'];

export type CrowdPalette = 'casual' | 'night' | 'summer' | 'fair' | 'fans';

export interface SpotSpec {
  color: number;
  intensity: number;
}

export interface AccentSpec extends SpotSpec {
  /** Where the light hangs (it points at the cage centre). */
  pos: readonly [number, number, number];
}

/** A crowd painted onto the far tiers (one textured surface instead of thousands of people). */
export interface PaintedTier {
  r0: number;
  r1: number;
  y0: number;
  y1: number;
  shape: number;
  stretchX: number;
}

export interface VenuePreset {
  id: VenueId;
  /** Shown in menus. */
  name: string;
  seed: number;
  outdoor: boolean;
  /** Canvas colours of the mat and the cage padding. */
  mat: { base: number; print: number; accent: number; wear: number };
  apron: number;
  pad: number;
  /** Side of the raised platform (carries the LED sponsor boards). */
  skirt: number;
  floor: number;
  rig: {
    /** Height of the lighting grid above the mat. */
    trussHeight: number;
    /** Half-width of the square grid. */
    trussSize: number;
    style: 'grid' | 'pipes' | 'ring';
    /** Spot cans hanging on the truss, each with a visible beam. */
    fixtures: number;
    /** Straight down, casts the fighters' shadows onto the mat. */
    key: SpotSpec & { angle: number };
    /** From the camera side, lights the fighters' faces. */
    front: SpotSpec;
    /** From behind, separates the fighters from the dark crowd. */
    rim: SpotSpec;
    accents: readonly AccentSpec[];
    fill: { sky: number; ground: number; intensity: number };
    beam: { color: number; opacity: number };
    /** 0..1 how much smoky haze hangs in the light. */
    haze: number;
    hazeColor: number;
  };
  fog: { color: number; density: number };
  background: number;
  sky?: { top: number; horizon: number; bottom: number; sun?: { dir: readonly [number, number, number]; color: number; size: number } };
  crowd: {
    sections: readonly SeatSection[];
    painted?: readonly PaintedTier[];
    /** Light falling on the crowd (0 = black silhouettes, 1 = as lit as the cage). */
    light: number;
    lightColor: number;
    palette: CrowdPalette;
    /** Camera flashes per second at full excitement. */
    flashRate: number;
  };
  /** Giant name screens: hanging four-sided board over the cage, screens on the walls, both, or neither. */
  screens: { jumbotron: boolean; wall: boolean };
  grade: Grade;
}

const FLOOR_Y = -1.0;

export const VENUES: Readonly<Record<VenueId, VenuePreset>> = {
  // A cramped boxing gym after hours: bare bricks, strip lights, sweaty haze, people pressed round the cage.
  gym: {
    id: 'gym',
    name: 'Back-Street Gym',
    seed: 11,
    outdoor: false,
    mat: { base: 0x3a4250, print: 0xe8e4da, accent: 0xc8a050, wear: 0.75 },
    apron: 0x22262e,
    pad: 0x1b1d22,
    skirt: 0x16181c,
    floor: 0x2a2622,
    rig: {
      trussHeight: 5.0,
      trussSize: 3.6,
      style: 'pipes',
      fixtures: 6,
      key: { color: 0xffe2b8, intensity: 6.5, angle: 46 },
      front: { color: 0xfff0dc, intensity: 2.2 },
      rim: { color: 0xffb468, intensity: 3.0 },
      accents: [{ color: 0x9fc4ff, intensity: 1.0, pos: [-9, 4.5, -7] }],
      fill: { sky: 0x8a8a90, ground: 0x2a2018, intensity: 0.5 },
      beam: { color: 0xffe6c0, opacity: 0.16 },
      haze: 0.65,
      hazeColor: 0xb8a890,
    },
    fog: { color: 0x0d0b0a, density: 0.028 },
    background: 0x0a0908,
    crowd: {
      sections: [
        { kind: 'floor', r0: 6.9, r1: 9.4, y: FLOOR_Y, spacing: 0.62, shape: 6, stretchX: 1.3, arcs: [[300, 240]], density: 0.85 },
        { kind: 'block', cx: 0, cz: -8.0, width: 11, rows: 4, rowDepth: 0.72, rowRise: 0.42, y0: FLOOR_Y + 0.25, spacing: 0.56, seated: true, density: 0.9 },
      ],
      light: 0.42,
      lightColor: 0xffd6a8,
      palette: 'casual',
      flashRate: 1.5,
    },
    screens: { jumbotron: false, wall: true },
    grade: {
      exposure: 1.05,
      bloom: 0.55,
      bloomThreshold: 1.1,
      saturation: 0.88,
      contrast: 1.08,
      lift: [0.012, 0.008, 0.0],
      gain: [1.05, 1.0, 0.9],
      vignette: 0.5,
      grain: 0.07,
    },
  },

  // An open-sided show tent at the county fair: wooden bleachers, string lights, the fairground at night outside.
  fair: {
    id: 'fair',
    name: 'County Fair',
    seed: 23,
    outdoor: true,
    mat: { base: 0x6b5a44, print: 0xfff4dc, accent: 0xb8322a, wear: 0.6 },
    apron: 0x3a2a1e,
    pad: 0x7a1e1a,
    skirt: 0x5a1814,
    floor: 0x4a3a28,
    rig: {
      trussHeight: 6.4,
      trussSize: 4.0,
      style: 'grid',
      fixtures: 8,
      key: { color: 0xfff0d0, intensity: 6.0, angle: 44 },
      front: { color: 0xffe8c8, intensity: 2.0 },
      rim: { color: 0xffa040, intensity: 3.2 },
      accents: [{ color: 0xff7040, intensity: 1.2, pos: [9, 5, -9] }],
      fill: { sky: 0x4a5a80, ground: 0x3a2a18, intensity: 0.55 },
      beam: { color: 0xfff0d8, opacity: 0.12 },
      haze: 0.4,
      hazeColor: 0xc8b090,
    },
    fog: { color: 0x0c0d18, density: 0.016 },
    background: 0x0b0c18,
    sky: { top: 0x04060f, horizon: 0x1c2240, bottom: 0x0a0a12 },
    crowd: {
      sections: [
        { kind: 'block', cx: 0, cz: -8.2, width: 16, rows: 8, rowDepth: 0.75, rowRise: 0.4, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.9 },
        { kind: 'block', cx: -10.2, cz: 0, width: 12, rows: 7, rowDepth: 0.75, rowRise: 0.4, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.88 },
        { kind: 'block', cx: 10.2, cz: 0, width: 12, rows: 7, rowDepth: 0.75, rowRise: 0.4, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.88 },
        { kind: 'floor', r0: 6.9, r1: 8.0, y: FLOOR_Y, spacing: 0.66, shape: 6, stretchX: 1.15, arcs: [[20, 160]], density: 0.7 },
      ],
      light: 0.38,
      lightColor: 0xffd8a0,
      palette: 'fair',
      flashRate: 2,
    },
    screens: { jumbotron: false, wall: true },
    grade: {
      exposure: 1.05,
      bloom: 0.8,
      bloomThreshold: 0.9,
      saturation: 1.08,
      contrast: 1.05,
      lift: [0.008, 0.004, 0.012],
      gain: [1.06, 1.0, 0.9],
      vignette: 0.45,
      grain: 0.05,
    },
  },

  // A packed club: black walls, neon, an LED wall, lasers and thick haze over a standing crowd.
  nightclub: {
    id: 'nightclub',
    name: 'Neon Nightclub',
    seed: 37,
    outdoor: false,
    mat: { base: 0x17171d, print: 0xff4fb8, accent: 0x38e8ff, wear: 0.35 },
    apron: 0x101014,
    pad: 0x121216,
    skirt: 0x0c0c10,
    floor: 0x101016,
    rig: {
      trussHeight: 6.0,
      trussSize: 3.8,
      style: 'ring',
      fixtures: 10,
      key: { color: 0xf2f4ff, intensity: 6.2, angle: 44 },
      front: { color: 0xe8ecff, intensity: 1.8 },
      rim: { color: 0xff3fb0, intensity: 4.5 },
      accents: [
        { color: 0x28d8ff, intensity: 3.0, pos: [-8, 4, -6] },
        { color: 0x8a40ff, intensity: 2.2, pos: [8, 4, -6] },
      ],
      fill: { sky: 0x3a2850, ground: 0x0a0814, intensity: 0.45 },
      beam: { color: 0xf0e8ff, opacity: 0.2 },
      haze: 1.0,
      hazeColor: 0x8a70c0,
    },
    fog: { color: 0x0a0612, density: 0.03 },
    background: 0x050309,
    crowd: {
      sections: [
        { kind: 'floor', r0: 6.8, r1: 11.2, y: FLOOR_Y, spacing: 0.56, shape: 4, stretchX: 1.25, density: 0.9 },
        { kind: 'block', cx: 0, cz: -12.6, width: 16, rows: 2, rowDepth: 0.8, rowRise: 0.3, y0: 2.2, spacing: 0.6, seated: false, density: 0.85 },
      ],
      light: 0.3,
      lightColor: 0xd8a0ff,
      palette: 'night',
      flashRate: 3,
    },
    screens: { jumbotron: false, wall: true },
    grade: {
      exposure: 1.0,
      bloom: 1.05,
      bloomThreshold: 0.85,
      saturation: 1.15,
      contrast: 1.12,
      lift: [0.01, 0.0, 0.022],
      gain: [1.02, 0.97, 1.06],
      vignette: 0.55,
      grain: 0.05,
    },
  },

  // A sold-out stadium: a huge dark bowl, thousands of fans split by corner colour, a giant hanging screen.
  stadium: {
    id: 'stadium',
    name: 'Stadium',
    seed: 41,
    outdoor: false,
    mat: { base: 0x1c1d22, print: 0xf2f2f2, accent: 0xd4af37, wear: 0.4 },
    apron: 0x111216,
    pad: 0x0f1013,
    skirt: 0x0c0d10,
    floor: 0x15161a,
    rig: {
      trussHeight: 8.0,
      trussSize: 4.6,
      style: 'grid',
      fixtures: 16,
      key: { color: 0xf6f8ff, intensity: 8.0, angle: 36 },
      front: { color: 0xf4f6ff, intensity: 2.4 },
      rim: { color: 0x7fb0ff, intensity: 3.6 },
      accents: [{ color: 0xffffff, intensity: 1.2, pos: [0, 9, 9] }],
      fill: { sky: 0x404a60, ground: 0x0c0d12, intensity: 0.45 },
      beam: { color: 0xeef2ff, opacity: 0.11 },
      haze: 0.5,
      hazeColor: 0x9aa8c8,
    },
    fog: { color: 0x05060a, density: 0.012 },
    background: 0x030407,
    crowd: {
      sections: [
        { kind: 'ring', r0: 7.2, rows: 8, rowDepth: 0.9, rowRise: 0.06, y0: FLOOR_Y, spacing: 0.56, shape: 4, stretchX: 1.12, aisleEvery: 16, seated: true, density: 0.95, arcs: [[100, 80]] },
        { kind: 'ring', r0: 15.4, rows: 12, rowDepth: 0.85, rowRise: 0.45, y0: -0.4, spacing: 0.56, shape: 3, stretchX: 1.18, aisleEvery: 20, seated: true, density: 0.93 },
      ],
      painted: [{ r0: 25.6, r1: 46, y0: 5.0, y1: 21, shape: 3, stretchX: 1.18 }],
      light: 0.3,
      lightColor: 0xc8d4ff,
      palette: 'fans',
      flashRate: 7,
    },
    screens: { jumbotron: true, wall: false },
    grade: {
      exposure: 1.02,
      bloom: 0.75,
      bloomThreshold: 1.0,
      saturation: 1.02,
      contrast: 1.1,
      lift: [0.0, 0.004, 0.014],
      gain: [1.0, 1.0, 1.03],
      vignette: 0.45,
      grain: 0.035,
    },
  },

  // Sunset on the sand: bleachers either side, the sea and a low sun behind, tiki torches and palm trees.
  beach: {
    id: 'beach',
    name: 'Beach Bash',
    seed: 53,
    outdoor: true,
    mat: { base: 0x2a6f80, print: 0xfff6e0, accent: 0xffa040, wear: 0.45 },
    apron: 0x1d4a56,
    pad: 0x153c46,
    skirt: 0x12323a,
    floor: 0xc8a878,
    rig: {
      trussHeight: 6.4,
      trussSize: 4.0,
      style: 'grid',
      fixtures: 8,
      key: { color: 0xfff2e0, intensity: 5.0, angle: 44 },
      front: { color: 0xffe8d0, intensity: 1.6 },
      rim: { color: 0xff9050, intensity: 4.0 },
      accents: [{ color: 0xff8040, intensity: 2.0, pos: [0, 4, -16] }],
      fill: { sky: 0x8090c8, ground: 0x7a5a40, intensity: 1.0 },
      beam: { color: 0xfff0e0, opacity: 0.06 },
      haze: 0.2,
      hazeColor: 0xffc8a0,
    },
    fog: { color: 0x6a4a60, density: 0.006 },
    background: 0x6a4a60,
    sky: { top: 0x1a2350, horizon: 0xff8a50, bottom: 0x40304a, sun: { dir: [0.05, 0.06, -1], color: 0xffd090, size: 0.03 } },
    crowd: {
      sections: [
        { kind: 'block', cx: -10.4, cz: 0, width: 12, rows: 6, rowDepth: 0.75, rowRise: 0.45, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.88 },
        { kind: 'block', cx: 10.4, cz: 0, width: 12, rows: 6, rowDepth: 0.75, rowRise: 0.45, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.88 },
        { kind: 'block', cx: 0, cz: -9.4, width: 13, rows: 4, rowDepth: 0.75, rowRise: 0.45, y0: FLOOR_Y + 0.3, spacing: 0.56, seated: true, density: 0.86 },
        { kind: 'floor', r0: 6.9, r1: 8.4, y: FLOOR_Y, spacing: 0.66, shape: 6, stretchX: 1.1, arcs: [[15, 165], [200, 235], [305, 340]], density: 0.62 },
      ],
      light: 0.62,
      lightColor: 0xffc8a0,
      palette: 'summer',
      flashRate: 1.5,
    },
    screens: { jumbotron: false, wall: true },
    grade: {
      exposure: 1.0,
      bloom: 0.7,
      bloomThreshold: 1.0,
      saturation: 1.12,
      contrast: 1.02,
      lift: [0.01, 0.0, 0.02],
      gain: [1.06, 0.99, 0.92],
      vignette: 0.4,
      grain: 0.03,
    },
  },

  // A city rooftop at night: skyline all round, string lights, a small standing crowd at the railings.
  rooftop: {
    id: 'rooftop',
    name: 'Rooftop',
    seed: 67,
    outdoor: true,
    mat: { base: 0x22252c, print: 0xe8f0ff, accent: 0x4ad8c8, wear: 0.45 },
    apron: 0x16181d,
    pad: 0x14161a,
    skirt: 0x101215,
    floor: 0x2c2e33,
    rig: {
      trussHeight: 6.2,
      trussSize: 3.9,
      style: 'grid',
      fixtures: 8,
      key: { color: 0xf0f4ff, intensity: 6.2, angle: 44 },
      front: { color: 0xe8f0ff, intensity: 2.0 },
      rim: { color: 0x40d0ff, intensity: 3.6 },
      accents: [{ color: 0xff8a40, intensity: 1.4, pos: [-10, 3, -8] }],
      fill: { sky: 0x2a3a60, ground: 0x0e1018, intensity: 0.6 },
      beam: { color: 0xe8f0ff, opacity: 0.12 },
      haze: 0.35,
      hazeColor: 0x7088b0,
    },
    fog: { color: 0x0b1222, density: 0.0065 },
    background: 0x0a1020,
    sky: { top: 0x02040c, horizon: 0x1a2c50, bottom: 0x0a1020 },
    crowd: {
      sections: [
        { kind: 'floor', r0: 6.9, r1: 9.6, y: FLOOR_Y, spacing: 0.64, shape: 6, stretchX: 1.25, density: 0.74 },
        { kind: 'block', cx: 0, cz: -10.6, width: 12, rows: 2, rowDepth: 0.8, rowRise: 0.0, y0: FLOOR_Y, spacing: 0.6, seated: false, density: 0.8 },
      ],
      light: 0.38,
      lightColor: 0xc8dcff,
      palette: 'night',
      flashRate: 2.5,
    },
    screens: { jumbotron: false, wall: true },
    grade: {
      exposure: 1.05,
      bloom: 0.9,
      bloomThreshold: 0.9,
      saturation: 1.05,
      contrast: 1.08,
      lift: [0.0, 0.006, 0.02],
      gain: [1.04, 1.0, 0.96],
      vignette: 0.5,
      grain: 0.04,
    },
  },
};

export function getVenue(id: VenueId): VenuePreset {
  return VENUES[id];
}

/** Narrow an unknown string (a save field, a URL) to a venue id, falling back to the stadium. */
export function toVenueId(v: unknown): VenueId {
  return typeof v === 'string' && (VENUE_IDS as readonly string[]).includes(v) ? (v as VenueId) : 'stadium';
}
