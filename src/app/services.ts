// Platform services, started after the first screen is up so the game never waits on them: remote tuning, the native
// save mirror, Google Play purchases (reconciled at launch and on resume), ads (consent first), Play Games and
// opt-in analytics. Each one fails quietly: the game is fully playable offline and in a plain browser.

import type { Game } from './game';
import { initRemoteTuning } from '../platform/remote';
import { installSaveMirror } from '../platform/storage';
import { initIap } from '../platform/iap';
import { initAds, setAdHooks, setNoAds } from '../platform/ads';
import { initGames } from '../platform/games';
import type { SaveData } from '../meta/save';
import { CloudSync } from './cloud';
import { scheduleReminders } from '../platform/notify';
import './reminders';
import { flushTelemetry, initTelemetry, track } from '../platform/telemetry';
import { refreshPaidPacks } from '../platform/country';
import { initLifecycle, hideSplash, isNative, initAudioFocus, regainAudioFocus, rendererCrashes, setHaptics } from '../platform/platform';
import { installErrorLog } from '../platform/diag';
import { onSaveWriteFail } from '../meta/save';
import { newerMirror } from '../platform/storage';
import { sound } from '../audio/sound';

let cloud: CloudSync | null = null;

/** The cloud save sync (null in a browser, or before Play Games started). */
export function cloudSync(): CloudSync | null {
  return cloud;
}

export interface ServiceHooks {
  /** Android back button. */
  onBack(): void;
  /** The app went to the background, or a phone call took the sound: pause a running fight. */
  onInterrupt(): void;
  /** Ask "load your cloud progress?" (app/cloud.ts). */
  askRestore(cloud: SaveData, local: SaveData): Promise<boolean>;
  /** The menus must redraw (the save was replaced). */
  refresh(): void;
  toast(msg: string): void;
}

export async function startServices(game: Game, hooks: ServiceHooks): Promise<void> {
  hideSplash();
  installErrorLog();
  initRemoteTuning();
  installSaveMirror();
  setHaptics(game.save.settings.haptics);
  onSaveWriteFail(() => hooks.toast("Your phone's storage is full: progress can't be saved until you free some space."));
  initTelemetry({ version: __APP_VERSION__, allowed: game.save.settings.analytics });
  track('app_open', { fights: game.save.fights });
  void refreshPaidPacks();
  initLifecycle({
    onPause: () => {
      game.flush();
      sound.setMuted(true);
      hooks.onInterrupt();
      void flushTelemetry();
      // reminders are planned when the player leaves (opt-in; nothing is scheduled unless they turned them on)
      void scheduleReminders(game.save);
    },
    onResume: () => {
      void regainAudioFocus().then(ok => sound.setMuted(!ok));
      game.resumed();
      void game.syncPurchases();
      void cloud?.start();
    },
    onBack: () => hooks.onBack(),
  });
  // a phone call or another app's sound takes the audio: mute (and pause a fight) until it comes back
  initAudioFocus(st => {
    sound.setMuted(st !== 'gain' && st !== 'duck');
    if (st === 'pause' || st === 'loss') hooks.onInterrupt();
  });
  setAdHooks({
    onOpen: () => sound.setMuted(true),
    onClose: () => sound.setMuted(false),
  });
  if (!isNative) return;
  // the native copy of the save is newer (the WebView lost its last write): use it
  const mirror = await newerMirror({ ...game.save, savedAt: game.loadedSavedAt });
  if (mirror && !game.changedSinceLaunch) {
    game.adoptMirror(mirror);
    hooks.refresh();
  }
  // the graphics process crashed last time: drop to low detail so it doesn't happen again
  const crashes = await rendererCrashes();
  if (crashes > 0) {
    track('renderer_gone', { count: crashes });
    game.save.settings.autoTier = { q: 'low', res: Math.min(game.save.settings.autoTier.res, 0.75) };
    game.persist();
  }
  try {
    if (await initIap()) await game.syncPurchases();
  } catch (e) {
    console.warn('purchases', e);
  }
  setNoAds(game.save.flags.noAds);
  try {
    await initAds({ noAds: game.save.flags.noAds });
  } catch (e) {
    console.warn('ads', e);
  }
  try {
    await initGames();
    // backs up to Play Games after progress changes, but only once the cloud copy has been read (app/cloud.ts)
    cloud = new CloudSync(game, hooks.askRestore);
    await cloud.start();
  } catch (e) {
    console.warn('games', e);
  }
}
