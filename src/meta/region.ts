import { TUNING } from './tuning';

/**
 * Where paid random items (fighter packs bought with gems) may be sold. Some countries ban them (Belgium today);
 * the list is remote-tunable (`paidPacksBlockedCountries`, meta/tuning.ts) so the game can follow a new law without
 * an update. Earned packs (from fights, the season track, rewarded videos) stay available everywhere.
 *
 * The deciding country is the player's Google Play country (Play Billing's billing config, platform/country.ts):
 * that is where the purchase is made. When it can't be read (no Play Store, billing down, the web build), the phone's
 * language regions and time zone are checked instead, and any hint of a blocked country switches paid packs off.
 * Pure function: unit-tested in tests/region.test.ts.
 */
export interface RegionHints {
  /** ISO 3166-1 alpha-2 country of the Play account, or null/'' when unknown */
  storeCountry: string | null;
  /** the phone's languages, e.g. navigator.languages: ['nl-BE', 'en'] */
  locales: readonly string[];
  /** e.g. Intl.DateTimeFormat().resolvedOptions().timeZone: 'Europe/Brussels' */
  timeZone: string;
}

export interface PaidPacksDecision {
  allowed: boolean;
  /** the country the decision was based on, if any */
  country: string | null;
  /** 'store': the Play country; 'device': language or time zone hints; 'none': nothing pointed at a blocked country */
  source: 'store' | 'device' | 'none';
}

/** Time zones of countries that are (or may become) blocked: enough for the fallback. */
const ZONES: Record<string, string> = {
  'Europe/Brussels': 'BE', 'Europe/Amsterdam': 'NL', 'Europe/Luxembourg': 'LU', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
  'Europe/Busingen': 'DE', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES',
  'Atlantic/Canary': 'ES', 'Europe/Lisbon': 'PT', 'Europe/Dublin': 'IE', 'Europe/London': 'GB', 'Europe/Copenhagen': 'DK',
  'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Bratislava': 'SK', 'Europe/Budapest': 'HU', 'Europe/Ljubljana': 'SI', 'Europe/Zagreb': 'HR', 'Europe/Athens': 'GR',
  'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT',
  'Asia/Nicosia': 'CY', 'Europe/Malta': 'MT', 'Atlantic/Reykjavik': 'IS', 'Asia/Shanghai': 'CN', 'Asia/Seoul': 'KR',
  'Asia/Tokyo': 'JP', 'Australia/Sydney': 'AU', 'America/Sao_Paulo': 'BR',
};

function code(v: string | null | undefined): string | null {
  return typeof v === 'string' && /^[a-zA-Z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null;
}

/** The region part of a language tag: 'nl-BE' -> 'BE', 'zh-Hant-TW' -> 'TW', 'en' -> null. */
export function localeRegion(tag: string): string | null {
  for (const part of tag.split(/[-_]/).slice(1)) if (/^[a-zA-Z]{2}$/.test(part)) return part.toUpperCase();
  return null;
}

export function paidPacksDecision(h: RegionHints, blocked: readonly string[] = TUNING.paidPacksBlockedCountries): PaidPacksDecision {
  const list = new Set(blocked.map((c) => c.toUpperCase()));
  const store = code(h.storeCountry);
  if (store) return { allowed: !list.has(store), country: store, source: 'store' };
  const hints = [...h.locales.map(localeRegion), ZONES[h.timeZone] ?? null].filter((c): c is string => !!c);
  const hit = hints.find((c) => list.has(c));
  if (hit) return { allowed: false, country: hit, source: 'device' };
  return { allowed: true, country: null, source: 'none' };
}
