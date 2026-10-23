// Fixes from the money / save bug hunt (October 2026). Each test failed before its fix.
import { describe, expect, it } from 'vitest';
import { applyPurchase, type Amounts, type Purchase } from '../src/meta/entitlements';
import { freshSave, sanitize } from '../src/meta/save';
import { bindClock, rewardTime, settleClock, unlock } from '../src/meta/clock';
import { dayNumber } from '../src/meta/days';
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

  it('a few days borrowed on the clock are not forgiven a week later', () => {
    const s = sanitize(freshSave());
    bindClock(s);
    settleClock(s, NOW, dayNumber);
    rewardTime(NOW + 6 * DAY); // stepped ahead six days
    rewardTime(NOW); // and back
    expect(settleClock(s, NOW + 8 * DAY, dayNumber)).toBe(false);
    expect(rewardTime(NOW + 8 * DAY)).toBeGreaterThanOrEqual(NOW + 14 * DAY - 1000);
    bindClock(null);
  });

  it('a clock fixed after running ahead does not lock the free pack', () => {
    const s = sanitize(freshSave());
    const today = dayNumber(NOW);
    s.progress.packs.freeDay = today + 25;
    s.offerDay = today + 25;
    unlock(s, NOW, dayNumber);
    expect(s.progress.packs.freeDay).toBe(today);
    expect(s.offerDay).toBe(today);
  });
});
