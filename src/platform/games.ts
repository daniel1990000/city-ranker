/**
 * Google Play Games: online leaderboards, achievements and cloud save, through the local PlayGames plugin
 * (android/.../PlayGamesPlugin.java). Everything here is a no-op on the web and on Android until a Play Games
 * project id is set (strings.xml) and the leaderboard / achievement ids are filled in (platform/config.ts).
 *
 * Cloud save rule: a failed read is never treated as "no cloud save". The App only uploads after the cloud copy was
 * read (or Play Games said there is none), and never over a cloud copy the player has not answered about.
 */
import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { CONFIG, type BoardId } from './config';
import type { SaveData } from '../meta/save';
import { exportCode, readCode } from '../meta/save';

interface PlayGamesPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  isAuthenticated(): Promise<{ authenticated: boolean }>;
  signIn(): Promise<{ authenticated: boolean }>;
  submitScore(o: { leaderboardId: string; score: number }): Promise<void>;
  showLeaderboards(o: { leaderboardId?: string }): Promise<void>;
  unlockAchievement(o: { achievementId: string }): Promise<void>;
  showAchievements(): Promise<void>;
  saveGame(o: { name: string; data: string; description: string }): Promise<void>;
  loadGame(o: { name: string }): Promise<{ data: string | null; missing?: boolean }>;
}

const PG = registerPlugin<PlayGamesPlugin>('PlayGames');
const SLOT = 'cagekings-save';

let available = false;
let signedIn = false;
const pushed = new Set<string>();

export async function initGames(): Promise<boolean> {
  if (!isNative) return false;
  try {
    available = (await PG.isAvailable()).available;
    if (available) signedIn = (await PG.isAuthenticated()).authenticated;
  } catch {
    available = false;
  }
  return signedIn;
}

export function gamesAvailable(): boolean {
  return available;
}
export function gamesSignedIn(): boolean {
  return signedIn;
}

export async function signInGames(): Promise<boolean> {
  if (!available) return false;
  try {
    signedIn = (await PG.signIn()).authenticated;
  } catch {
    signedIn = false;
  }
  return signedIn;
}

/** Post a score to a leaderboard (Play Games keeps each player's best). Ignored until that board's id is set. */
export function submitScore(board: BoardId, value: number): void {
  const id = CONFIG.games.leaderboards[board];
  if (!signedIn || !id || !Number.isFinite(value) || value <= 0) return;
  PG.submitScore({ leaderboardId: id, score: Math.floor(value) }).catch(() => {});
}

/** Unlock on Play Games every achievement already earned in the game (unlocking twice is harmless; once per session). */
export function syncAchievements(save: SaveData): void {
  if (!signedIn) return;
  for (const id of Object.keys(save.achievements)) {
    const pgs = CONFIG.games.achievements[id];
    if (!pgs || pushed.has(id)) continue;
    pushed.add(id);
    PG.unlockAchievement({ achievementId: pgs }).catch(() => pushed.delete(id));
  }
}

export async function showBoards(board?: BoardId): Promise<boolean> {
  if (!(signedIn || (await signInGames()))) return false;
  try {
    await PG.showLeaderboards(board && CONFIG.games.leaderboards[board] ? { leaderboardId: CONFIG.games.leaderboards[board] } : {});
    return true;
  } catch {
    return false;
  }
}

export async function showGameAchievements(): Promise<boolean> {
  if (!(signedIn || (await signInGames()))) return false;
  try {
    await PG.showAchievements();
    return true;
  } catch {
    return false;
  }
}

/** The line Play Games shows under the cloud save. */
export function cloudDescription(save: SaveData): string {
  return `${save.fights.toLocaleString('en-US')} fights · ${save.wins.toLocaleString('en-US')} wins`;
}

export async function cloudSave(save: SaveData): Promise<boolean> {
  if (!signedIn) return false;
  try {
    await PG.saveGame({ name: SLOT, data: exportCode(save), description: cloudDescription(save) });
    return true;
  } catch {
    return false;
  }
}

/**
 * 'newer': the cloud copy was made by a newer version of the game (on another phone): this phone must not overwrite
 * it, and the player is asked to update.
 */
export type CloudRead = { state: 'ok'; save: SaveData } | { state: 'missing' } | { state: 'error' } | { state: 'newer' };

/**
 * The cloud copy. 'missing' only when Play Games says there is no save yet; a read that failed, or a copy that
 * can't be parsed, is an 'error', and the caller must not upload over it.
 */
export async function cloudLoad(): Promise<CloudRead> {
  if (!signedIn) return { state: 'error' };
  try {
    const { data, missing } = await PG.loadGame({ name: SLOT });
    if (!data) return missing === true ? { state: 'missing' } : { state: 'error' };
    const r = readCode(data);
    if (r.ok) return { state: 'ok', save: r.save };
    return r.reason === 'newer' ? { state: 'newer' } : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

/** Does the cloud copy hold more progress than this phone? (cash earned only ever goes up, then fights, then gems) */
export function cloudAhead(local: SaveData, cloud: SaveData): boolean {
  if (cloud.lifetimeCash !== local.lifetimeCash) return cloud.lifetimeCash > local.lifetimeCash;
  if (cloud.fights !== local.fights) return cloud.fights > local.fights;
  return cloud.lifetimeGems > local.lifetimeGems;
}
