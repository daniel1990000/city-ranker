// Fighter packs. Odds are shown before every purchase (Google Play rule), the pity counters are visible, duplicates
// become shards, and paid packs (bought with gems, the real-money currency) are switched off in countries that ban
// paid random items (region.ts / tuning.ts). Rolls are pure functions of (pack, pity, seed), so a server could run
// them later. Saved in the 'packs' progress slot.

import type { Rarity } from '../game/fight/types';
import { int, obj } from './sanitize';
import { registerProgressSlot } from './save';
import { ROSTER } from './roster';

export type PackId = 'standard' | 'premium' | 'elite';

export interface PackDef {
  id: PackId;
  name: string;
  blurb: string;
  /** Price in cash or gems (one of them). */
  cash: number;
  gems: number;
  /** Bought with gems = a paid random item (gated by country). Earned copies are never gated. */
  paid: boolean;
  /** Fighter cards per pack. */
  cards: number;
  /** Odds per mille, per card. */
  odds: Record<Rarity, number>;
  /** Guarantee: at least this rarity within `within` packs (the counter shows on the pack). */
  pity: { at: Rarity; within: number } | null;
}

export const PACKS: Record<PackId, PackDef> = {
  standard: {
    id: 'standard',
    name: 'Standard Pack',
    blurb: '2 fighter cards',
    cash: 3000,
    gems: 0,
    paid: false,
    cards: 2,
    odds: { common: 800, rare: 170, epic: 27, legend: 3 },
    pity: null,
  },
  premium: {
    id: 'premium',
    name: 'Premium Pack',
    blurb: '3 fighter cards, better odds',
    cash: 0,
    gems: 160,
    paid: true,
    cards: 3,
    odds: { common: 520, rare: 360, epic: 100, legend: 20 },
    pity: { at: 'epic', within: 10 },
  },
  elite: {
    id: 'elite',
    name: 'Elite Pack',
    blurb: '3 cards, rare or better',
    cash: 0,
    gems: 480,
    paid: true,
    cards: 3,
    odds: { common: 0, rare: 640, epic: 300, legend: 60 },
    pity: { at: 'legend', within: 25 },
  },
};

export const PACK_IDS: readonly PackId[] = ['standard', 'premium', 'elite'];
const RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legend: 3 };
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legend'];

export interface PacksState {
  v: 1;
  /** Packs opened since the last guaranteed-or-better card, per pack with a pity rule. */
  pity: Record<PackId, number>;
  opened: Record<PackId, number>;
  /** Earned packs waiting to be opened. */
  unopened: Record<PackId, number>;
  /** Reward day the free daily pack (watch an ad) was last claimed. */
  freeDay: number;
}

declare module './save' {
  interface ProgressSlots {
    packs: PacksState;
  }
}

export function freshPacks(): PacksState {
  return { v: 1, pity: { standard: 0, premium: 0, elite: 0 }, opened: { standard: 0, premium: 0, elite: 0 }, unopened: { standard: 1, premium: 0, elite: 0 }, freeDay: -1 };
}

export function sanitizePacks(raw: unknown): PacksState {
  const o = obj(raw);
  const out = freshPacks();
  for (const id of PACK_IDS) {
    out.pity[id] = int(obj(o.pity)[id], 0, 0, 1000);
    out.opened[id] = int(obj(o.opened)[id], 0, 0, 1e7);
    out.unopened[id] = int(obj(o.unopened)[id], id === 'standard' && o.unopened === undefined ? 1 : 0, 0, 999);
  }
  out.freeDay = int(o.freeDay, -1, -1, 1e7);
  return out;
}

registerProgressSlot('packs', { fresh: freshPacks, sanitize: sanitizePacks });

// ---- rolling ------------------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PackResult {
  pack: PackId;
  cards: { id: string; rarity: Rarity }[];
  /** True when the pity guarantee produced (or upgraded to) a card. */
  pityHit: boolean;
}

/**
 * Open one pack. Mutates `state` (pity, opened). Pure otherwise: same pity + seed = same cards.
 * Pity: if no card in the pack reaches the guaranteed rarity and this is the last pack of the window, the best card
 * is upgraded to the guaranteed rarity; any card at or above it resets the counter.
 */
export function rollPack(state: PacksState, id: PackId, seed: number): PackResult {
  const def = PACKS[id];
  const r = rng(seed);
  const cards: { id: string; rarity: Rarity }[] = [];
  for (let i = 0; i < def.cards; i++) {
    let x = r() * 1000;
    let rarity: Rarity = 'common';
    for (const rr of RARITIES) {
      if (x < def.odds[rr]) {
        rarity = rr;
        break;
      }
      x -= def.odds[rr];
    }
    cards.push({ id: pickFighter(rarity, r), rarity });
  }
  let pityHit = false;
  if (def.pity) {
    const hit = cards.some(c => RANK[c.rarity] >= RANK[def.pity!.at]);
    state.pity[id]++;
    if (hit) state.pity[id] = 0;
    else if (state.pity[id] >= def.pity.within) {
      // upgrade the best card to the guaranteed rarity
      let best = 0;
      for (let i = 1; i < cards.length; i++) if (RANK[cards[i].rarity] > RANK[cards[best].rarity]) best = i;
      cards[best] = { id: pickFighter(def.pity.at, r), rarity: def.pity.at };
      state.pity[id] = 0;
      pityHit = true;
    }
  }
  state.opened[id]++;
  return { pack: id, cards, pityHit };
}

function pickFighter(rarity: Rarity, r: () => number): string {
  const pool = ROSTER.filter(f => f.rarity === rarity);
  return pool[Math.floor(r() * pool.length) % pool.length].id;
}

/** Packs left before the guarantee kicks in (null if the pack has none). */
export function pityLeft(state: PacksState, id: PackId): number | null {
  const p = PACKS[id].pity;
  return p ? Math.max(1, p.within - state.pity[id]) : null;
}

/** The odds as text for the pack screen (shown before buying). */
export function oddsText(id: PackId): string[] {
  const def = PACKS[id];
  const lines = RARITIES.filter(r => def.odds[r] > 0).map(r => `${r[0].toUpperCase() + r.slice(1)}: ${(def.odds[r] / 10).toFixed(1)}% per card`);
  if (def.pity) lines.push(`Guaranteed ${def.pity.at} or better within ${def.pity.within} packs`);
  lines.push('Duplicates become shards that power up the fighter.');
  return lines;
}
