// Play Games cloud save. The rule that matters: this phone never uploads before it has read the cloud copy. A new
// phone (or a reinstall) starts with an empty save, and uploading that first would wipe the player's real progress.
// So: read first; if the cloud copy is ahead, ask the player whether to load it, and upload nothing until they
// answer; if the read fails, upload nothing and try again on the next return to the game. A copy made by a newer
// version of the game is never overwritten.

import type { SaveData } from '../meta/save';
import { cloudAhead, cloudLoad, cloudSave, gamesSignedIn, syncAchievements } from '../platform/games';
import type { Game } from './game';

/** Uploads at most this often (Play Games throttles snapshot writes). */
const MIN_GAP_MS = 120_000;

export class CloudSync {
  /** The cloud copy has been read (or is known not to exist): only then may this phone upload over it. */
  private ready = false;
  private starting = false;
  private busy = false;
  private dirty = false;
  private lastAt = 0;
  /** The cloud copy is from a newer version of the game: never overwrite it. */
  private newer = false;

  constructor(
    private readonly game: Game,
    /** Show "load your cloud progress?" and resolve with the player's answer. */
    private readonly ask: (cloud: SaveData, local: SaveData) => Promise<boolean>,
  ) {
    game.onChange(() => {
      this.dirty = true;
      void this.push();
    });
  }

  /** At launch and on every return to the game: read the cloud copy once, then upload when needed. */
  async start(): Promise<void> {
    if (!gamesSignedIn() || this.starting) return;
    if (this.ready) {
      await this.push(true);
      return;
    }
    this.starting = true;
    try {
      syncAchievements(this.game.save);
      const cloud = await cloudLoad();
      if (cloud.state === 'error') return;
      if (cloud.state === 'newer') {
        this.newer = true;
        return;
      }
      if (cloud.state === 'ok' && cloudAhead(this.game.save, cloud.save)) {
        const yes = await this.ask(cloud.save, this.game.save);
        if (yes) this.game.replaceSave(cloud.save, true);
      }
      this.ready = true;
      await this.push(true);
    } finally {
      this.starting = false;
    }
  }

  /** Upload the save (throttled unless forced). Resolves true only when the cloud copy was written. */
  async push(force = false): Promise<boolean> {
    if (!gamesSignedIn() || !this.ready || this.newer || this.busy) return false;
    if (!force && (!this.dirty || Date.now() - this.lastAt < MIN_GAP_MS)) return false;
    this.busy = true;
    this.lastAt = Date.now();
    try {
      this.game.flush();
      const ok = await cloudSave(this.game.save);
      if (ok) this.dirty = false;
      return ok;
    } finally {
      this.busy = false;
    }
  }
}
