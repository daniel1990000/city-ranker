/**
 * Google Play product ids (Play Console > Monetize > Products > In-app products). They must match exactly.
 * What each one grants is decided in meta/entitlements.ts; the amounts live in meta/tuning.ts.
 *
 * - `no_ads`: one-time. Switches off interstitials (rewarded videos stay, they are opt-in).
 * - `starter_pack`: one-time. No Ads + this month's Season Pass + gems and cash (a fresh sale only).
 * - `season_pass`: consumable, bought again each month. Unlocks the current month's premium track.
 * - `gems_1`..`gems_5`: consumable gem bundles (gems are the real-money step for fighter packs).
 * - `bundle_champion`: one-time, fixed price. A set of fighters (decided by the content code from
 *   `save.paidBundles`) plus some gems.
 */
export const PRODUCTS = {
  noAds: 'no_ads',
  starter: 'starter_pack',
  seasonPass: 'season_pass',
  gems1: 'gems_1',
  gems2: 'gems_2',
  gems3: 'gems_3',
  gems4: 'gems_4',
  gems5: 'gems_5',
  bundleChampion: 'bundle_champion',
} as const;

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS];

export const GEM_PACKS: readonly ProductId[] = [PRODUCTS.gems1, PRODUCTS.gems2, PRODUCTS.gems3, PRODUCTS.gems4, PRODUCTS.gems5];
/** fixed-price fighter bundles: one-time products whose fighters the content code unlocks while Play reports them */
export const BUNDLES: readonly ProductId[] = [PRODUCTS.bundleChampion];
export const ONE_TIME: readonly ProductId[] = [PRODUCTS.noAds, PRODUCTS.starter, ...BUNDLES];
export const REPEATABLE: readonly ProductId[] = [PRODUCTS.seasonPass, ...GEM_PACKS];
export const ALL_PRODUCTS: readonly ProductId[] = [...ONE_TIME, ...REPEATABLE];

export function isProduct(id: string): id is ProductId {
  return (ALL_PRODUCTS as readonly string[]).includes(id);
}
