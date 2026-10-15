import { AdMob, AdmobConsentStatus, MaxAdContentRating, RewardAdPluginEvents, InterstitialAdPluginEvents } from '@capacitor-community/admob';
import type { AdMobRevenueData } from '@capacitor-community/admob';
import { isNative } from './platform';
import { CONFIG } from './config';

/**
 * Rewarded and interstitial ads through AdMob (Android). The web build has no ads: rewarded offers are simply not
 * shown, so nothing is gated behind them.
 *
 * Order at start-up follows Google's UMP guide: consent first (the consent form where the law requires it), then
 * the Mobile Ads SDK, and no ad requests unless the consent SDK says `canRequestAds`. Ad content is capped at Teen
 * (T), matching the game's own rating (PEGI 12 / ESRB Teen: realistic combat, blood off).
 * When to show an interstitial is decided by the game (meta/adpacing.ts); this module only shows it. Until the
 * owner's real ad unit ids are set at build time, Google's test ids are used (platform/config.ts).
 */
let ready = false;
let rewardedLoaded = false;
let interLoaded = false;
let noAds = false;
/** whether this player must be able to reopen the consent choices (UMP: show the entry point only then) */
let privacyRequired = false;

export interface AdRevenue {
  format: 'rewarded' | 'interstitial';
  /** in the currency's units (micros / 1e6) */
  value: number;
  currency: string;
  /** 0 unknown, 1 estimated, 2 publisher provided, 3 precise (Google's AdValue precision) */
  precision: number;
}
export interface AdHooks {
  /** a full-screen ad opened / closed: duck and restore the game's sound */
  onOpen?: () => void;
  onClose?: () => void;
  onShown?: (format: 'rewarded' | 'interstitial') => void;
  onRevenue?: (r: AdRevenue) => void;
}
let listeners: AdHooks = {};
const retry = { rewarded: 30000, interstitial: 45000 };
/** settles the rewarded promise when the player closes the ad (with or without the reward) */
let rewardSettle: ((earned: boolean) => void) | null = null;
/** settles the interstitial promise when the ad is closed (true) or could not be shown (false) */
let interSettle: ((shown: boolean) => void) | null = null;
let rewardEarned = false;

export function setAdHooks(h: AdHooks): void {
  listeners = h;
}

export async function initAds(opts: { noAds: boolean }): Promise<void> {
  noAds = opts.noAds;
  if (!isNative) return;
  try {
    let canRequest = true;
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.isConsentFormAvailable && info.status === AdmobConsentStatus.REQUIRED) info = await AdMob.showConsentForm();
      canRequest = info.canRequestAds !== false;
      privacyRequired = String(info.privacyOptionsRequirementStatus) === 'REQUIRED';
    } catch {
      // the consent SDK falls back to the previous session's answer; ask it again rather than assume
      try {
        const info = await AdMob.requestConsentInfo();
        canRequest = info.canRequestAds !== false;
        privacyRequired = String(info.privacyOptionsRequirementStatus) === 'REQUIRED';
      } catch {
        canRequest = false;
      }
    }
    if (!canRequest) return;
    await AdMob.initialize({ initializeForTesting: CONFIG.admob.testing, maxAdContentRating: MaxAdContentRating.Teen });
    void AdMob.addListener(RewardAdPluginEvents.Showed, () => {
      rewardEarned = false;
      listeners.onOpen?.();
      listeners.onShown?.('rewarded');
    });
    void AdMob.addListener(RewardAdPluginEvents.Rewarded, () => (rewardEarned = true));
    void AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
      listeners.onClose?.();
      rewardedLoaded = false;
      // closed early: no reward, but the game must not wait forever
      rewardSettle?.(rewardEarned);
      rewardSettle = null;
      loadRewarded();
    });
    void AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
      rewardSettle?.(false);
      rewardSettle = null;
      rewardedLoaded = false;
      loadRewarded();
    });
    // impression-level revenue (Google's paid event), so earnings per player can be measured, not just impressions
    const revenue = (format: AdRevenue['format']) => (d: AdMobRevenueData) => {
      if (!d || !Number.isFinite(d.valueMicros)) return;
      listeners.onRevenue?.({ format, value: d.valueMicros / 1e6, currency: d.currencyCode || '', precision: Number(d.precision) || 0 });
    };
    void AdMob.addListener(RewardAdPluginEvents.AdImpression, revenue('rewarded'));
    void AdMob.addListener(InterstitialAdPluginEvents.AdImpression, revenue('interstitial'));
    void AdMob.addListener(InterstitialAdPluginEvents.Showed, () => {
      listeners.onOpen?.();
      listeners.onShown?.('interstitial');
    });
    void AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
      listeners.onClose?.();
      interLoaded = false;
      interSettle?.(true);
      interSettle = null;
      loadInterstitial();
    });
    void AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => {
      interLoaded = false;
      interSettle?.(false);
      interSettle = null;
      loadInterstitial();
    });
    ready = true;
    loadRewarded();
    loadInterstitial();
  } catch (e) {
    console.warn('Ads unavailable', e);
  }
}

/** No Ads bought (or refunded): stop or start loading interstitials. Rewarded videos stay, they are opt-in. */
export function setNoAds(v: boolean): void {
  const was = noAds;
  noAds = v;
  if (was && !v) loadInterstitial();
}

function loadRewarded(): void {
  if (!ready) return;
  AdMob.prepareRewardVideoAd({ adId: CONFIG.admob.rewarded, isTesting: CONFIG.admob.testing, immersiveMode: true })
    .then(() => {
      rewardedLoaded = true;
      retry.rewarded = 30000;
    })
    .catch(() => {
      // back off when there's no fill or no network (30 s, 60 s, ... up to 10 min)
      setTimeout(loadRewarded, retry.rewarded);
      retry.rewarded = Math.min(600000, retry.rewarded * 2);
    });
}

function loadInterstitial(): void {
  if (!ready || noAds) return;
  AdMob.prepareInterstitial({ adId: CONFIG.admob.interstitial, isTesting: CONFIG.admob.testing, immersiveMode: true })
    .then(() => {
      interLoaded = true;
      retry.interstitial = 45000;
    })
    .catch(() => {
      setTimeout(loadInterstitial, retry.interstitial);
      retry.interstitial = Math.min(900000, retry.interstitial * 2);
    });
}

/** Rewarded ads remain available with No Ads (they are opt-in bonuses, labelled "Watch ad: ..."). */
export function rewardedAvailable(): boolean {
  return ready && rewardedLoaded;
}

/** Show a rewarded video. Resolves true only when the player earned the reward; false if it was closed early or failed. */
export function showRewarded(): Promise<boolean> {
  if (!rewardedAvailable()) return Promise.resolve(false);
  rewardSettle?.(false);
  rewardEarned = false;
  // settled by the Dismissed event (with whether the reward was earned) or by a failure to show
  const settled = new Promise<boolean>((resolve) => (rewardSettle = resolve));
  AdMob.showRewardVideoAd()
    .then(() => (rewardEarned = true))
    .catch(() => {
      rewardedLoaded = false;
      loadRewarded();
      rewardSettle?.(false);
      rewardSettle = null;
    });
  return settled;
}

/** Whether an interstitial is loaded and allowed (the game decides whether it is due). */
export function interstitialReady(): boolean {
  return ready && !noAds && interLoaded;
}

/**
 * Show an interstitial at a natural break (after a fight, behind the "Ad break" card). Resolves when it is closed
 * (true), or false if it could not be shown. The plugin's own promise resolves when the ad opens, so the game waits
 * for the Dismissed event.
 */
export function showInterstitial(): Promise<boolean> {
  if (!interstitialReady()) return Promise.resolve(false);
  interSettle?.(false);
  const settled = new Promise<boolean>((resolve) => {
    interSettle = resolve;
    // never leave the player on the "Ad break" card if no event arrives
    setTimeout(() => {
      if (interSettle === resolve) {
        interSettle = null;
        resolve(false);
      }
    }, 90000);
  });
  AdMob.showInterstitial().catch(() => {
    interLoaded = false;
    loadInterstitial();
    interSettle?.(false);
    interSettle = null;
  });
  return settled;
}

/** Whether Settings shows "Ad choices" (only where the consent rules require a way back to the choices). */
export function adChoicesRequired(): boolean {
  return privacyRequired;
}

/** The consent form again (Settings > Ad choices). */
export async function showAdChoices(): Promise<boolean> {
  if (!isNative) return false;
  try {
    await AdMob.showPrivacyOptionsForm();
    return true;
  } catch {
    return false;
  }
}
