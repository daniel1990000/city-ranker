import { TUNING } from './tuning';

/** What the interstitial pacing looks at (kept in the save as `save.ads`). */
export interface AdPacing {
  /** fights since the last interstitial */
  fightsSince: number;
  /** when the last full-screen ad (interstitial or rewarded video) was shown (ms) */
  lastAt: number;
  /** seconds of fighting, all sessions */
  playSec: number;
  /** app launches so far, this one included */
  sessions: number;
}

/**
 * Is an interstitial due at the end of this fight? Never in a new player's first session or first 10 minutes of
 * play, then at most every 3rd fight and 4 minutes apart (remote-tunable), and never right after a highlight the
 * player earned (a title win, a tier or level up: those moments belong to the player). No Ads or the Starter Pack
 * switch interstitials off entirely. The App shows an "Ad break" card first, so an ad never comes as a surprise.
 */
export function interstitialDue(p: AdPacing, ctx: { now: number; noAds: boolean; highlight: boolean }): boolean {
  if (ctx.noAds || ctx.highlight) return false;
  if (TUNING.adSkipFirstSession && p.sessions <= 1) return false;
  if (p.playSec < TUNING.adMinPlaySec) return false;
  if (p.fightsSince < TUNING.adEveryFights) return false;
  return ctx.now - p.lastAt >= TUNING.adCooldownSec * 1000;
}

/** Count a finished fight toward the pacing. */
export function countFight(p: AdPacing, seconds: number): void {
  p.fightsSince++;
  p.playSec += Math.max(0, Math.min(3600, Number.isFinite(seconds) ? seconds : 0));
}

/** An interstitial (or any full-screen video) was shown: restart the spacing. */
export function adShown(p: AdPacing, now: number, interstitial: boolean): void {
  p.lastAt = now;
  if (interstitial) p.fightsSince = 0;
}
