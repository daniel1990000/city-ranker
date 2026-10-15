/**
 * Numbers the business may want to change without shipping an update: ad pacing, gem and pack sizes, season
 * pacing, and the countries where paid random items (fighter packs bought with gems) are switched off. Defaults
 * are built in; `applyTuning` takes the owner's remote JSON (platform/remote.ts, docs/REMOTE-TUNING.md) and only
 * accepts known keys within safe ranges, so a typo on the server can never break the game or zero out something a
 * player paid or watched an ad for.
 *
 * Content code adds its own remote-tunable numbers with `defineTunables` (one flat JSON file for the owner).
 */
import { PRODUCTS } from './products';

export type GemPackId = (typeof PRODUCTS)['gems1' | 'gems2' | 'gems3' | 'gems4' | 'gems5'];

export interface Tuning {
  /** no interstitial until this much fight time (seconds, all sessions) */
  adMinPlaySec: number;
  /** ...and never in the first app session */
  adSkipFirstSession: boolean;
  /** minimum seconds between interstitials (any full-screen video starts the cooldown) */
  adCooldownSec: number;
  /** at most one interstitial every N fights */
  adEveryFights: number;
  /** most extra cash one "Watch ad: double cash" video can add */
  doubleCashCap: number;
  /** gems in each gem bundle */
  gemPacks: Record<GemPackId, number>;
  /** what a fresh Starter Pack sale adds on top of No Ads and this month's Season Pass */
  starterGems: number;
  starterCash: number;
  /** gems that come with each fixed-price fighter bundle (the fighters themselves are content's) */
  bundleGems: Record<string, number>;
  /** season xp from one fight, at most */
  seasonFightXpCap: number;
  /** season xp from fights per day, at most (daily rewards and events come on top) */
  seasonDayXpCap: number;
  /**
   * Play Store countries where paid random items are off (packs bought with gems). Earned packs stay. The legal
   * minimum (LEGAL_BLOCKED) is always included, whatever the remote file says.
   */
  paidPacksBlockedCountries: string[];
}

/** Countries whose law bans paid random items today (Belgium). Remote tuning can add countries, never remove these. */
export const LEGAL_BLOCKED: readonly string[] = ['BE'];

export const DEFAULT_TUNING: Tuning = {
  adMinPlaySec: 600,
  adSkipFirstSession: true,
  adCooldownSec: 240,
  adEveryFights: 3,
  doubleCashCap: 5000,
  gemPacks: { gems_1: 100, gems_2: 550, gems_3: 1200, gems_4: 2600, gems_5: 7000 },
  starterGems: 500,
  starterCash: 10000,
  bundleGems: { bundle_champion: 300 },
  seasonFightXpCap: 150,
  seasonDayXpCap: 600,
  paidPacksBlockedCountries: [...LEGAL_BLOCKED],
};

// JSON copy rather than structuredClone, which needs a newer WebView (Chrome 98)
const copy = (t: Tuning): Tuning => JSON.parse(JSON.stringify(t)) as Tuning;

export const TUNING: Tuning = copy(DEFAULT_TUNING);

type NumKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

const RANGES: Record<NumKey, [number, number]> = {
  adMinPlaySec: [0, 7200],
  adCooldownSec: [60, 3600],
  adEveryFights: [1, 20],
  // floors keep paid and watched-for rewards worth something whatever the remote file says
  doubleCashCap: [500, 1e7],
  starterGems: [100, 1e6],
  starterCash: [1000, 1e8],
  seasonFightXpCap: [10, 5000],
  seasonDayXpCap: [100, 1e5],
};

/** A gem bundle can be made bigger remotely, never smaller than half its launch size. */
const GEM_FLOOR = 0.5;
const GEM_CEIL = 100;

// ------------------------------------------------------------------ content tunables
interface ExtraSpec {
  def: number;
  min: number;
  max: number;
}
const extras = new Map<string, { spec: ExtraSpec; target: Record<string, number> }>();
let lastRemote: Record<string, unknown> = {};

/**
 * Remote-tunable numbers for another part of the game, e.g. in meta/packs.ts:
 *
 *   export const PACK_TUNING = defineTunables({ pityEpic: { def: 30, min: 10, max: 60 } });
 *   ...PACK_TUNING.pityEpic...
 *
 * The keys share the one flat remote JSON file with the core keys above, so each key must be unique (a clash throws
 * at start-up, in tests too). Values outside [min, max] are ignored. Register at module load (top level).
 */
export function defineTunables<K extends string>(spec: Record<K, ExtraSpec>): Readonly<Record<K, number>> {
  const target = {} as Record<K, number>;
  for (const [key, s] of Object.entries(spec) as [K, ExtraSpec][]) {
    if (key in DEFAULT_TUNING || extras.has(key)) throw new Error(`tunable '${key}' is defined twice`);
    if (!(s.min <= s.def && s.def <= s.max)) throw new Error(`tunable '${key}': default ${s.def} outside [${s.min}, ${s.max}]`);
    extras.set(key, { spec: s, target });
    target[key] = s.def;
    const v = lastRemote[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= s.min && v <= s.max) target[key] = v;
  }
  return target;
}

/** A clean country list: two-letter codes, upper case, the legal minimum always in. */
function countries(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = new Set<string>(LEGAL_BLOCKED);
  for (const c of v.slice(0, 250)) if (typeof c === 'string' && /^[a-zA-Z]{2}$/.test(c)) out.add(c.toUpperCase());
  return [...out];
}

/** Merge a remote tuning object over the defaults. Unknown keys and out-of-range values are ignored. */
export function applyTuning(raw: unknown): void {
  const next = copy(DEFAULT_TUNING);
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  lastRemote = r;
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [NumKey, [number, number]][]) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) next[k] = v;
  }
  if (typeof r.adSkipFirstSession === 'boolean') next.adSkipFirstSession = r.adSkipFirstSession;
  const packs = r.gemPacks && typeof r.gemPacks === 'object' ? (r.gemPacks as Record<string, unknown>) : {};
  for (const id of Object.keys(next.gemPacks) as GemPackId[]) {
    const v = packs[id];
    const d = DEFAULT_TUNING.gemPacks[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= d * GEM_FLOOR && v <= d * GEM_CEIL) next.gemPacks[id] = Math.round(v);
  }
  const bundles = r.bundleGems && typeof r.bundleGems === 'object' ? (r.bundleGems as Record<string, unknown>) : {};
  for (const id of Object.keys(next.bundleGems)) {
    const v = bundles[id];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6) next.bundleGems[id] = Math.round(v);
  }
  next.paidPacksBlockedCountries = countries(r.paidPacksBlockedCountries) ?? next.paidPacksBlockedCountries;
  Object.assign(TUNING, next);
  for (const [key, { spec, target }] of extras) {
    const v = r[key];
    target[key] = typeof v === 'number' && Number.isFinite(v) && v >= spec.min && v <= spec.max ? v : spec.def;
  }
}
