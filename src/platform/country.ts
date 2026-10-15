import { storeCountry } from './iap';
import { paidPacksDecision, type PaidPacksDecision } from '../meta/region';

/**
 * Whether paid random items (fighter packs bought with gems) may be offered on this phone: the Google Play country
 * against the remote-tunable blocked list (meta/region.ts, meta/tuning.ts `paidPacksBlockedCountries`).
 *
 * Order of evidence: the Play country read now; else the last Play country this phone reported (cached, so a
 * Belgian player who opens the shop offline still sees no paid packs); else the phone's languages and time zone.
 */
const CACHE = 'cagekings.country';

function cached(): string | null {
  try {
    const v = localStorage.getItem(CACHE);
    return v && /^[A-Z]{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

function deviceHints(): { locales: string[]; timeZone: string } {
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* very old WebView */
  }
  const locales = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language].filter((l): l is string => typeof l === 'string') : [];
  return { locales, timeZone };
}

let last: PaidPacksDecision | null = null;

/** Ask Play for the country and decide (call at start-up, on resume and before opening the pack shop). */
export async function refreshPaidPacks(): Promise<PaidPacksDecision> {
  const live = await storeCountry();
  if (live) {
    try {
      localStorage.setItem(CACHE, live);
    } catch {
      /* ignore */
    }
  }
  last = paidPacksDecision({ storeCountry: live ?? cached(), ...deviceHints() });
  return last;
}

/**
 * The latest decision without waiting (before the first refresh: from the cached country and device hints).
 * Re-evaluated against the current blocked list every call, so a remote tuning change applies at once.
 */
export function paidPacksStatus(): PaidPacksDecision {
  const country = last?.source === 'store' ? last.country : cached();
  return paidPacksDecision({ storeCountry: country, ...deviceHints() });
}
