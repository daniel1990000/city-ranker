import type { SaveData } from './save';
import { seasonId } from './season';
import { addCash, addGems } from './wallet';
import { ALL_PRODUCTS, BUNDLES, GEM_PACKS, ONE_TIME, PRODUCTS, isProduct, type ProductId } from './products';

/**
 * What a Google Play purchase gives the player, granted exactly once per purchase token.
 *
 * The rules (Play Billing integration guide):
 * - only a PURCHASED purchase grants anything; PENDING ones wait until they complete;
 * - every purchase is acknowledged (one-time items) or consumed (repeatable items) after its grant is saved, or Google
 *   refunds it after 3 days; the App saves first, then calls platform/iap.ts `finish`;
 * - purchases that complete while the game is closed, or whose acknowledgement failed, are picked up again at the
 *   next launch or resume (`reconcile`);
 * - one-time entitlements (No Ads, Starter Pack, fighter bundles) come from Play, never from a save file, and go away
 *   if Play no longer reports them (refunded or revoked).
 * Pure functions of the save and the purchase list, so they are unit-tested without a phone (tests/money.test.ts).
 */
export { PRODUCTS, ALL_PRODUCTS, ONE_TIME, REPEATABLE, GEM_PACKS, BUNDLES, type ProductId } from './products';

export interface Purchase {
  productId: string;
  /** Play purchase token: unique per purchase */
  token: string;
  state: 'purchased' | 'pending' | 'other';
  acknowledged: boolean;
  orderId?: string;
  /** when it was bought (ms), 0 if unknown. The plugin formats it in the phone's local time, so allow a day either way. */
  time?: number;
}

/** A one-time pack seen more than this long after it was bought is a restore (new phone, cleared data), not a sale. */
const FRESH_MS = 3 * 86400000;

/** What still has to be told to Play for a purchase. */
export interface StoreAction {
  kind: 'ack' | 'consume';
  token: string;
  productId: string;
}

/** Amounts in force (meta/tuning.ts; the App passes TUNING's values). */
export interface Amounts {
  gemPacks: Readonly<Record<string, number>>;
  starterGems: number;
  starterCash: number;
  bundleGems: Readonly<Record<string, number>>;
}

/** What a newly seen purchase paid out. */
export interface Grant {
  gems: number;
  cash: number;
}

/**
 * How many purchase tokens are remembered. Consumed tokens never come back from Play and an old one-time pack pays
 * nothing again (FRESH_MS), so the recent ones are enough; it also keeps save codes small.
 */
const LEDGER_MAX = 100;
/** currency grants remembered per token, so a restore can give back what was bought on this phone (keepEntitlements) */
const PAID_MAX = 50;

function remember(save: SaveData, token: string, g: Grant): void {
  save.iap.tokens.push(token);
  if (save.iap.tokens.length > LEDGER_MAX) save.iap.tokens.splice(0, save.iap.tokens.length - LEDGER_MAX);
  if (g.gems > 0 || g.cash > 0) {
    save.iap.paid.push({ t: token, g: g.gems, c: g.cash });
    if (save.iap.paid.length > PAID_MAX) save.iap.paid.splice(0, save.iap.paid.length - PAID_MAX);
  }
}

/** The one-time effects of a newly seen purchase. */
function grantNew(save: SaveData, p: Purchase, amounts: Amounts, now: number): Grant {
  const id = p.productId;
  // a purchase Play still holds as unacknowledged was never finished anywhere: it is a new sale, however long ago it
  // was ordered (a slow pending payment that cleared days later still brings its gems and cash)
  const fresh = !p.time || now - p.time <= FRESH_MS || !p.acknowledged;
  const g: Grant = { gems: 0, cash: 0 };
  if (id === PRODUCTS.starter) {
    // the Starter Pack's gems, cash and season pass come with the sale. Seen again long after (a new phone, cleared
    // data) it only restores what it unlocks for good (applyOwned).
    if (fresh) {
      g.gems = amounts.starterGems;
      g.cash = amounts.starterCash;
      save.seasonPass = seasonId(now);
    }
  } else if (id === PRODUCTS.seasonPass) {
    save.seasonPass = seasonId(now);
  } else if ((GEM_PACKS as readonly string[]).includes(id)) {
    g.gems = amounts.gemPacks[id] ?? 0;
  } else if ((BUNDLES as readonly string[]).includes(id)) {
    if (fresh) g.gems = amounts.bundleGems[id] ?? 0;
  }
  g.gems = addGems(save, g.gems);
  g.cash = addCash(save, g.cash);
  return g;
}

/** Lasting effects of the one-time products the player owns (and only those). */
function applyOwned(save: SaveData, owned: Set<string>): void {
  const starter = owned.has(PRODUCTS.starter);
  save.flags.starterPack = starter;
  save.flags.noAds = starter || owned.has(PRODUCTS.noAds);
  save.paidBundles = BUNDLES.filter((b) => owned.has(b));
}

/** One-time products the save currently holds. */
function ownedOneTime(save: SaveData): string[] {
  const out: string[] = [...save.paidBundles];
  if (save.flags.starterPack) out.push(PRODUCTS.starter);
  if (save.flags.noAds && !save.flags.starterPack) out.push(PRODUCTS.noAds);
  return out;
}

/**
 * One purchase (right after buying it, or from a query). Returns whether it granted something new and what Play still
 * needs to hear about it. A token is granted once, however many times it is seen.
 */
export function applyPurchase(save: SaveData, p: Purchase, amounts: Amounts, now = Date.now()): { granted: boolean; gems: number; cash: number; action: StoreAction | null } {
  if (p.state !== 'purchased' || !isProduct(p.productId) || !p.token) return { granted: false, gems: 0, cash: 0, action: null };
  let granted = false;
  let g: Grant = { gems: 0, cash: 0 };
  if (!save.iap.tokens.includes(p.token)) {
    g = grantNew(save, p, amounts, now);
    remember(save, p.token, g);
    granted = true;
  }
  if ((ONE_TIME as readonly string[]).includes(p.productId)) {
    const owned = new Set(ownedOneTime(save));
    owned.add(p.productId);
    applyOwned(save, owned);
    return { granted, ...g, action: p.acknowledged ? null : { kind: 'ack', token: p.token, productId: p.productId } };
  }
  return { granted, ...g, action: { kind: 'consume', token: p.token, productId: p.productId } };
}

/**
 * The full purchase list from a successful Play query (at launch, on resume, after a purchase or Restore).
 * Grants anything not seen before, lists the acknowledgements and consumptions still owed, and drops one-time
 * entitlements Play no longer reports (refunds). Never call it with the result of a failed query.
 */
export function reconcile(save: SaveData, purchases: Purchase[], amounts: Amounts, now = Date.now()): { granted: string[]; gems: number; cash: number; actions: StoreAction[]; revoked: string[] } {
  const before = new Set(ownedOneTime(save));
  const granted: string[] = [];
  const actions: StoreAction[] = [];
  let gems = 0;
  let cash = 0;
  const owned = new Set<string>();
  for (const p of purchases) {
    if (p.state !== 'purchased' || !isProduct(p.productId)) continue;
    if ((ONE_TIME as readonly string[]).includes(p.productId)) owned.add(p.productId);
    const r = applyPurchase(save, p, amounts, now);
    if (r.granted) granted.push(p.productId);
    gems += r.gems;
    cash += r.cash;
    if (r.action) actions.push(r.action);
  }
  applyOwned(save, owned);
  const after = new Set(ownedOneTime(save));
  const revoked: string[] = [];
  // the Starter Pack includes No Ads: losing it reports both, keeping No Ads alone reports only the pack
  if (before.has(PRODUCTS.starter) && !after.has(PRODUCTS.starter)) revoked.push(PRODUCTS.starter);
  const hadNoAds = before.has(PRODUCTS.noAds) || before.has(PRODUCTS.starter);
  if (hadNoAds && !save.flags.noAds) revoked.push(PRODUCTS.noAds);
  for (const b of BUNDLES) if (before.has(b) && !after.has(b)) revoked.push(b);
  return { granted, gems, cash, actions, revoked };
}

/**
 * Restoring progress from a save code or the cloud, or resetting it: the progress comes from the file, but paid
 * entitlements stay this phone's (they come from Play).
 * - `restore`: the purchase lists of both saves are merged (an extra entry can only stop a grant, never cause one),
 *   and gems and cash bought on this phone that the restored save has not seen are added back.
 * - `trustPass`: the restored save's Season Pass for the current month is kept (a cloud save: the pass is consumed,
 *   so Play can never return it). A save code can be typed in, so it never carries one.
 */
export function keepEntitlements(incoming: SaveData, current: SaveData, opts: { restore?: boolean; trustPass?: boolean; now?: number } = {}): void {
  const now = opts.now ?? Date.now();
  incoming.flags.noAds = current.flags.noAds;
  incoming.flags.starterPack = current.flags.starterPack;
  incoming.paidBundles = [...current.paidBundles];
  const keepIncomingPass = opts.trustPass === true && incoming.seasonPass === seasonId(now) && current.seasonPass !== seasonId(now);
  if (!keepIncomingPass) incoming.seasonPass = current.seasonPass;
  if (opts.restore) {
    const seen = new Set(incoming.iap.tokens);
    for (const g of current.iap.paid) {
      if (seen.has(g.t)) continue;
      addGems(incoming, g.g);
      addCash(incoming, g.c);
    }
    const tokens = [...new Set([...incoming.iap.tokens, ...current.iap.tokens])].slice(-LEDGER_MAX);
    const paid = [...incoming.iap.paid, ...current.iap.paid.filter((g) => !seen.has(g.t))].slice(-PAID_MAX);
    incoming.iap = { tokens, paid };
  } else {
    incoming.iap = { tokens: [...current.iap.tokens], paid: current.iap.paid.map((g) => ({ ...g })) };
  }
}

/** Every product id the store is asked about (platform/iap.ts). */
export const STORE_PRODUCTS: readonly ProductId[] = ALL_PRODUCTS;
