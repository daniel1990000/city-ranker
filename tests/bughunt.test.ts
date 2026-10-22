// Fixes from the money / save bug hunt (October 2026). Each test failed before its fix.
import { describe, expect, it } from 'vitest';
import { applyPurchase, type Amounts, type Purchase } from '../src/meta/entitlements';
import { freshSave, sanitize } from '../src/meta/save';
import '../src/meta/career';
import '../src/meta/packs';

const AMOUNTS: Amounts = { gemPacks: { gems_1: 100 }, starterGems: 500, starterCash: 10000, bundleGems: { bundle_champion: 300 } };
const NOW = Date.UTC(2026, 9, 22, 12);
const DAY = 86400000;
const buy = (productId: string, token: string, extra: Partial<Purchase> = {}): Purchase => ({ productId, token, state: 'purchased', acknowledged: false, time: NOW, ...extra });

describe('bug hunt', () => {
  it('a Starter Pack whose slow payment cleared days later still brings its gems and cash', () => {
    const s = sanitize(freshSave());
    applyPurchase(s, buy('starter_pack', 'slow', { time: NOW - 6 * DAY }), AMOUNTS, NOW);
    expect(s.gems).toBe(500);
    expect(s.cash).toBeGreaterThanOrEqual(10000);
    expect(s.flags.noAds).toBe(true);
  });

  it('an old, already finished Starter Pack seen on a new phone restores No Ads only', () => {
    const s = sanitize(freshSave());
    applyPurchase(s, buy('starter_pack', 'old', { time: NOW - 60 * DAY, acknowledged: true }), AMOUNTS, NOW);
    expect(s.gems).toBe(0);
    expect(s.flags.noAds).toBe(true);
  });
});
