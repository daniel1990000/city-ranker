import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { StatusBar } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { CONFIG } from './config';

/**
 * The phone around the game: native or web, haptics, sharing, the app lifecycle (pause, resume, back button),
 * screen wake lock, audio focus and renderer-crash counts (android/.../GameSystemPlugin.java).
 */
export const isNative = Capacitor.isNativePlatform();
export const platformName = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

let hapticsOn = true;
export function setHaptics(on: boolean): void {
  hapticsOn = on;
}

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning';
export function haptic(kind: HapticKind): void {
  if (!hapticsOn) return;
  if (isNative) {
    const p =
      kind === 'success' ? Haptics.notification({ type: NotificationType.Success })
      : kind === 'warning' ? Haptics.notification({ type: NotificationType.Warning })
      : Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    p.catch(() => {});
  } else if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(kind === 'heavy' ? 60 : kind === 'medium' ? 25 : kind === 'success' ? [15, 40, 25] : 10);
    } catch {
      /* ignore */
    }
  }
}

/** Share a line of text with the store link (the system share sheet, or the clipboard on desktop browsers). */
export async function shareText(title: string, text: string): Promise<boolean> {
  const url = isNative ? CONFIG.shareUrl : location.origin + location.pathname;
  try {
    if (isNative) {
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    await navigator.clipboard?.writeText(`${text} ${url}`);
    return true;
  } catch {
    return false;
  }
}

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

export function rateApp(): void {
  openExternal(isNative ? `market://details?id=${CONFIG.appId}` : CONFIG.playStoreUrl);
}

/**
 * Google Play's in-app review card (no custom "rate 5 stars?" question first, as Play's guidelines ask). Play decides
 * whether the card actually shows, and limits how often.
 */
export function requestReview(): void {
  if (!isNative) return;
  import('@capacitor-community/in-app-review').then(({ InAppReview }) => InAppReview.requestReview()).catch(() => {});
}

/** Pause/resume + Android back button wiring. */
export function initLifecycle(h: { onPause: () => void; onResume: () => void; onBack: () => void }): void {
  // several events report the same switch (blur + visibilitychange + the app's pause): run each handler once
  let away = false;
  const pause = () => {
    if (away) return;
    away = true;
    h.onPause();
  };
  const resume = () => {
    if (!away) return;
    away = false;
    h.onResume();
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
  window.addEventListener('blur', pause);
  window.addEventListener('focus', resume);
  if (isNative) {
    void App.addListener('pause', pause);
    void App.addListener('resume', resume);
    void App.addListener('backButton', h.onBack);
    StatusBar.hide().catch(() => {});
  }
}

/** Back on the title screen: send the app to the background (like any Android app) instead of killing it. */
export function exitApp(): void {
  if (isNative) App.minimizeApp().catch(() => App.exitApp());
}

/** Native helpers in android/.../GameSystemPlugin.java. */
interface GameSystemPlugin {
  keepAwake(o: { on: boolean }): Promise<void>;
  requestAudioFocus(): Promise<{ granted: boolean }>;
  abandonAudioFocus(): Promise<void>;
  takeRendererCrashes(): Promise<{ count: number }>;
  addListener(event: 'audioFocus', fn: (e: { state: AudioFocusState }) => void): Promise<unknown>;
}
export type AudioFocusState = 'gain' | 'duck' | 'pause' | 'loss';
const GameSystem = registerPlugin<GameSystemPlugin>('GameSystem');

let awake = false;
/** Keep the screen on (during fights only; menus let the phone sleep). */
export function keepAwake(on: boolean): void {
  if (!isNative || on === awake) return;
  awake = on;
  GameSystem.keepAwake({ on }).catch(() => {});
}

/** Ask for audio focus; `onChange` hears when a call or another app takes it ('duck', 'pause', 'loss') and gives it back. */
export function initAudioFocus(onChange: (state: AudioFocusState) => void): void {
  if (!isNative) return;
  GameSystem.addListener('audioFocus', (e) => onChange(e.state)).catch(() => {});
  GameSystem.requestAudioFocus().catch(() => {});
}
/** Ask for audio focus again (back from the background). Resolves whether the game has it. */
export async function regainAudioFocus(): Promise<boolean> {
  if (!isNative) return true;
  try {
    return (await GameSystem.requestAudioFocus()).granted;
  } catch {
    return true;
  }
}

/** WebView renderer crashes since the last launch (the activity restarted itself), for crash reporting. */
export async function rendererCrashes(): Promise<number> {
  if (!isNative) return 0;
  try {
    return (await GameSystem.takeRendererCrashes()).count;
  } catch {
    return 0;
  }
}

export function hideSplash(): void {
  if (isNative) SplashScreen.hide().catch(() => {});
}
