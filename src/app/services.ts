// Platform services, started after the first screen is up so the game never waits on them: remote tuning, the native
// save mirror, Google Play purchases (reconciled at launch and on resume), ads (consent first), Play Games and
// opt-in analytics. Each one fails quietly: the game is fully playable offline and in a plain browser.

import type { Game } from './game';
import { initRemoteTuning } from '../platform/remote';
import { installSaveMirror } from '../platform/storage';
import { initIap } from '../platform/iap';
import { initAds, setAdHooks, setNoAds } from '../platform/ads';
import { initGames, cloudSave, gamesSignedIn } from '../platform/games';
import { initTelemetry, track } from '../platform/telemetry';
import { refreshPaidPacks } from '../platform/country';
import { initLifecycle, hideSplash, isNative } from '../platform/platform';
import { sound } from '../audio/sound';

export async function startServices(game: Game, onBack: () => void): Promise<void> {
  hideSplash();
  initRemoteTuning();
  installSaveMirror();
  initTelemetry({ version: __APP_VERSION__, allowed: game.save.settings.analytics });
  track('app_open', { fights: game.save.fights });
  void refreshPaidPacks();
  initLifecycle({
    onPause: () => {
      game.flush();
      sound.setMuted(true);
    },
    onResume: () => {
      sound.setMuted(false);
      void game.syncPurchases();
    },
    onBack,
  });
  setAdHooks({
    onOpen: () => sound.setMuted(true),
    onClose: () => sound.setMuted(false),
  });
  if (!isNative) return;
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
    // back up to Play Games after progress changes (throttled)
    let last = 0;
    game.onChange(() => {
      const now = Date.now();
      if (!gamesSignedIn() || now - last < 120_000) return;
      last = now;
      void cloudSave(game.save);
    });
  } catch (e) {
    console.warn('games', e);
  }
}
