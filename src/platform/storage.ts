import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';
import { setSaveMirror, parseSave, type SaveData } from '../meta/save';

/**
 * On Android every save is also written to native key-value storage. The WebView's own storage can lag a second or
 * more behind a write, so a swipe-kill right after a purchase or a big fight could lose it; the native copy reaches
 * disk sooner. At launch the newer of the two copies wins.
 */
const KEY = 'cagekings.save';

export function installSaveMirror(): void {
  if (!isNative) return;
  setSaveMirror((txt) => {
    Preferences.set({ key: KEY, value: txt }).catch(() => {});
  });
}

/** The native copy, if it is newer than `current` (by more than a moment). */
export async function newerMirror(current: SaveData): Promise<SaveData | null> {
  if (!isNative) return null;
  try {
    const { value } = await Preferences.get({ key: KEY });
    const d = parseSave(value);
    return d && d.savedAt > current.savedAt + 2000 ? d : null;
  } catch {
    return null;
  }
}
