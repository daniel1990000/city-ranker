import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import { isNative } from './platform';
import { STORE_PRODUCTS, REPEATABLE, type Purchase, type StoreAction } from '../meta/entitlements';

/**
 * Google Play Billing, as a thin port: list products, buy, query purchases, acknowledge/consume, the Play country.
 * The game decides what a purchase grants (meta/entitlements.ts) and grants it before telling Play it is done,
 * so a crash in between can't lose a paid item: the next query returns it again.
 */

export interface StoreProduct {
  id: string;
  title: string;
  price: string;
  /** price in micro-units and its currency, for analytics */
  micros: number;
  currency: string;
}

export type BuyResult = { status: 'purchased'; purchase: Purchase } | { status: 'pending' | 'cancelled' | 'owned' | 'busy' | 'failed' | 'unavailable' };

let supported = false;
let products: StoreProduct[] = [];

function toPurchase(t: Transaction): Purchase {
  const state = t.purchaseState === '1' ? 'purchased' : t.purchaseState === '2' ? 'pending' : 'other';
  return {
    productId: t.productIdentifier,
    token: t.purchaseToken ?? t.transactionId ?? '',
    state,
    acknowledged: !!t.isAcknowledged,
    orderId: t.orderId ?? undefined,
    time: Date.parse(t.purchaseDate ?? '') || 0,
  };
}

export async function initIap(): Promise<boolean> {
  if (!isNative) return false;
  try {
    // the game acknowledges and consumes every purchase itself, after the grant is saved: make sure the plugin's
    // recovery flows never do it first (older plugin builds without configure() already behave this way)
    await NativePurchases.configure({ autoFinishTransactions: false }).catch(() => {});
    supported = (await NativePurchases.isBillingSupported()).isBillingSupported;
    if (!supported) return false;
    const { products: list } = await NativePurchases.getProducts({ productIdentifiers: [...STORE_PRODUCTS], productType: PURCHASE_TYPE.INAPP });
    products = list.map((p) => ({ id: p.identifier, title: p.title, price: p.priceString, micros: Math.round((p.price ?? 0) * 1e6), currency: p.currencyCode ?? '' }));
    return true;
  } catch (e) {
    console.warn('Billing unavailable', e);
    supported = false;
    return false;
  }
}

export function storeAvailable(): boolean {
  return supported && products.length > 0;
}

export function priceOf(id: string): string | null {
  return products.find((p) => p.id === id)?.price ?? null;
}

export function productInfo(id: string): StoreProduct | null {
  return products.find((p) => p.id === id) ?? null;
}

/**
 * The country of the player's Google Play account (ISO alpha-2, e.g. "BE"), or null when Play can't say (no billing,
 * no network, the web build). Read live each time: a player can change their Play country.
 */
export async function storeCountry(): Promise<string | null> {
  if (!isNative) return null;
  try {
    const { countryCode } = await NativePurchases.getStorefront();
    return /^[A-Za-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Buy a product. Nothing is acknowledged or consumed here (the plugin would do it before the game had granted the
 * item); the caller grants, saves, and then calls `finish`.
 */
let buying = false;
export async function buy(id: string): Promise<BuyResult> {
  if (!supported) return { status: 'unavailable' };
  // one purchase at a time (a double tap would open two billing connections that close each other)
  if (buying) return { status: 'busy' };
  buying = true;
  try {
    // isConsumable:false + no auto-acknowledge: the plugin only reports the purchase, the game finishes it
    const t = await NativePurchases.purchaseProduct({ productIdentifier: id, productType: PURCHASE_TYPE.INAPP, isConsumable: false, autoAcknowledgePurchases: false });
    const p = t ? toPurchase(t) : null;
    if (p && p.state === 'purchased' && p.token) return { status: 'purchased', purchase: p };
    return { status: p?.state === 'pending' ? 'pending' : 'failed' };
  } catch (e) {
    // the plugin puts Play's response code (USER_CANCELED, ITEM_ALREADY_OWNED, ...) in `code`
    const err = e as { message?: string; code?: string };
    const code = String(err?.code ?? '').toUpperCase();
    const msg = String(err?.message ?? e).toLowerCase();
    if (code === 'USER_CANCELED' || msg.includes('cancel')) return { status: 'cancelled' };
    if (code === 'ITEM_ALREADY_OWNED') return { status: 'owned' };
    if (msg.includes('pending')) return { status: 'pending' };
    console.warn('Purchase failed', e);
    return { status: 'failed' };
  } finally {
    buying = false;
  }
}

/** Every in-app purchase Play knows for this account, or null when the query failed (never treat that as "none"). */
let querying: Promise<Purchase[] | null> | null = null;
export function queryPurchases(): Promise<Purchase[] | null> {
  if (!supported) return Promise.resolve(null);
  // resume fires several events at once: they share one query instead of racing on the billing connection
  querying ??= (async () => {
    try {
      const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
      return purchases.map(toPurchase);
    } catch (e) {
      console.warn('Purchase query failed', e);
      return null;
    } finally {
      querying = null;
    }
  })();
  return querying;
}

/** Tell Play a purchase is done: acknowledge one-time items, consume repeatable ones. Retries a couple of times. */
export async function finish(action: StoreAction): Promise<boolean> {
  if (!supported) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (action.kind === 'consume' || (REPEATABLE as readonly string[]).includes(action.productId)) await NativePurchases.consumePurchase({ purchaseToken: action.token });
      else await NativePurchases.acknowledgePurchase({ purchaseToken: action.token });
      return true;
    } catch (e) {
      console.warn('Finishing purchase failed', e);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  // still owed: the next launch or resume finds it in the purchase list and tries again
  return false;
}
