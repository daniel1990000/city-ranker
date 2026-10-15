import type { SaveData } from './save';

/**
 * The two currencies. Every change goes through here so balances stay whole, non-negative numbers and the lifetime
 * counters (which decide which of two save copies holds more progress) only ever go up.
 *
 * - cash: soft currency, earned by fighting; spent on training, gear, fighter upgrades.
 * - gems: premium currency, bought with gem bundles (the real-money step for fighter packs) and earned in small
 *   amounts (season track, events, achievements).
 */
const MAX = 1e9;

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Add cash (negative or broken amounts add nothing). Returns what was added. */
export function addCash(save: SaveData, amount: number): number {
  const n = Math.min(whole(amount), MAX - save.cash);
  save.cash += n;
  save.lifetimeCash += n;
  return n;
}

/** Add gems. Returns what was added. */
export function addGems(save: SaveData, amount: number): number {
  const n = Math.min(whole(amount), MAX - save.gems);
  save.gems += n;
  save.lifetimeGems += n;
  return n;
}

/** Spend cash if the player has enough. Returns whether it was spent. */
export function spendCash(save: SaveData, amount: number): boolean {
  const n = whole(amount);
  if (n !== amount || save.cash < n) return false;
  save.cash -= n;
  return true;
}

/** Spend gems if the player has enough. Returns whether they were spent. */
export function spendGems(save: SaveData, amount: number): boolean {
  const n = whole(amount);
  if (n !== amount || save.gems < n) return false;
  save.gems -= n;
  return true;
}
