// The Game class end to end on a stub storage: launches are counted (the ad pacing needs them), the first launch gets
// the starter fighter, and a save code can't bring paid items.
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { Game } = await import('../src/app/game');
const { exportCode, importCode } = await import('../src/meta/save');
const { STARTER_ID } = await import('../src/meta/fighters');

describe('Game', () => {
  beforeEach(() => store.clear());

  it('counts every launch, so interstitials can start from the second session', () => {
    const a = new Game();
    expect(a.save.ads.sessions).toBe(1);
    a.flush();
    const b = new Game();
    expect(b.save.ads.sessions).toBe(2);
  });

  it('gives the starter fighter on the first launch only', () => {
    const g = new Game();
    expect(Object.keys(g.save.progress.fighters.owned)).toEqual([STARTER_ID]);
  });

  it('loading a save code keeps this phone\'s paid items and settings', () => {
    const g = new Game();
    const other = new Game().save;
    other.flags.noAds = true;
    other.seasonPass = '2099-01';
    other.fights = 20;
    other.wins = 12;
    other.settings.music = 0.1;
    const code = importCode(exportCode(other));
    expect(code).not.toBeNull();
    g.save.settings.music = 0.5;
    g.replaceSave(code!, false);
    expect(g.save.wins).toBe(12);
    expect(g.save.flags.noAds).toBe(false);
    expect(g.save.seasonPass).toBe('');
    expect(g.save.settings.music).toBe(0.5);
  });

  it('offers the Starter Pack by itself at most once a day, after 3 fights, only when it can be bought', () => {
    const g = new Game();
    expect(g.starterOfferDue(true)).toBe(false);
    g.save.fights = 3;
    expect(g.starterOfferDue(false)).toBe(false);
    expect(g.starterOfferDue(true)).toBe(true);
    expect(g.starterOfferDue(true)).toBe(false);
    g.save.offerDay = -1;
    g.save.flags.starterPack = true;
    expect(g.starterOfferDue(true)).toBe(false);
  });
});
