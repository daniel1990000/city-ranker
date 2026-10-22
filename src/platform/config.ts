import { PRODUCTS } from '../meta/products';

/**
 * Store, ads and services configuration.
 *
 * The defaults are Google's official AdMob TEST ids, so debug and CI builds never serve real ads. A production build
 * sets them at build time, e.g.
 *   VITE_ADMOB_REWARDED=ca-app-pub-xxx/yyy VITE_ADMOB_INTERSTITIAL=ca-app-pub-xxx/zzz VITE_ADMOB_TESTING=false npm run build
 * (CI does this from the ADMOB_* repository secrets; see docs/RELEASE.md). The AdMob *app* id lives in
 * android/app/src/main/res/values/strings.xml.
 */
const env = import.meta.env as Record<string, string | undefined>;

/** A JSON object of string ids from an env var, e.g. VITE_PGS_ACHIEVEMENTS='{"firstWin":"CgkI..."}'. Bad JSON = {}. */
function idMap(name: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(env[name] || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, id] of Object.entries(v as Record<string, unknown>)) if (typeof id === 'string' && id) out[k] = id;
    return out;
  } catch {
    return {};
  }
}

/**
 * Leaderboards the game posts to. The keys are the game's; the Play Games ids come from
 * VITE_PGS_LEADERBOARDS='{"weekly":"CgkI...","wins":"CgkI...","knockouts":"CgkI...","tournament":"CgkI..."}' (secret
 * PGS_LEADERBOARDS). A key missing from BoardId is dropped.
 * - weekly: "Best win": the best single-win score (meta/record.ts fightScore); Play Games shows today's, this
 *   week's and the all-time best, so it works as the weekly ranking
 * - wins: fights won, all modes
 * - knockouts: KO and TKO wins
 * - tournament: "Weekly tournament": a weekly tournament run's points (meta/tournament.ts); set it up in Play Console
 *   to reset weekly (placeholder until the owner creates it)
 */
export type BoardId = 'weekly' | 'wins' | 'knockouts' | 'tournament';
export const BOARD_IDS: readonly BoardId[] = ['weekly', 'wins', 'knockouts', 'tournament'];

const boards = idMap('VITE_PGS_LEADERBOARDS');
const leaderboards: Partial<Record<BoardId, string>> = {};
for (const k of BOARD_IDS) if (boards[k]) leaderboards[k] = boards[k];

const APP_ID = 'com.danielspurr.cagekings';
const STORE_URL = `https://play.google.com/store/apps/details?id=${APP_ID}`;

export const CONFIG = {
  appId: APP_ID,
  admob: {
    rewarded: env.VITE_ADMOB_REWARDED || 'ca-app-pub-3940256099942544/5224354917',
    interstitial: env.VITE_ADMOB_INTERSTITIAL || 'ca-app-pub-3940256099942544/1033173712',
    testing: (env.VITE_ADMOB_TESTING ?? 'true') !== 'false',
  },
  /** Play Console product ids (meta/products.ts; what each one grants is in meta/entitlements.ts). */
  iap: PRODUCTS,
  playStoreUrl: STORE_URL,
  shareUrl: env.VITE_SHARE_URL || STORE_URL,
  privacyUrl: env.VITE_PRIVACY_URL || 'privacy.html',
  supportEmail: env.VITE_SUPPORT_EMAIL || 'danielspurr68@gmail.com',
  /**
   * Google Play Games ids from Play Console (Play Games Services > Leaderboards / Achievements). Empty = not used.
   * The Play Games project id itself goes in android/app/src/main/res/values/strings.xml (game_services_project_id).
   */
  games: {
    leaderboards,
    /** in-game achievement id -> Play Games achievement id */
    achievements: idMap('VITE_PGS_ACHIEVEMENTS'),
  },
};
