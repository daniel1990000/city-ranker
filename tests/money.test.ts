// Launch-critical rules: purchases (grant once, refunds revoke, the bundle fighter), restores (save codes and the
// cloud never carry paid items), the reward clock, ad pacing, the cloud save's read-before-write rule, leaderboards.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPurchase, keepEntitlements, reconcile, type Amounts, type Purchase } from '../src/meta/entitlements';
import { freshSave, sanitize, type SaveData } from '../src/meta/save';
import { BUNDLE_FIGHTERS, giveCard, sanitizeFighters, syncBundles } from '../src/meta/fighters';
import { fightScore, recordFight, freshRecord, sanitizeRecord } from '../src/meta/record';
import { seasonId } from '../src/meta/season';
import { bindClock, keepClock, rewardTime } from '../src/meta/clock';
import { adShown, countFight, interstitialDue } from '../src/meta/adpacing';
import { rosterFighter } from '../src/meta/roster';
import '../src/meta/career';
import '../src/meta/packs';

const AMOUNTS: Amounts = { gemPacks: { gems_1: 100, gems_2: 550 }, starterGems: 500, starterCash: 10000, bundleGems: { bundle_champion: 300 } };
const NOW = Date.UTC(2026, 9, 16, 12);
const buy = (productId: string, token: string, extra: Partial<Purchase> = {}): Purchase => ({ productId, token, state: 'purchased', acknowledged: false, time: NOW, ...extra });

function save(): SaveData {
  return sanitize(freshSave());
}

describe('purchases', () => {
  it('grants a gem pack once per token, and only when purchased', () => {
    const s = save();
    expect(applyPurchase(s, buy('gems_1', 'a', { state: 'pending' }), AMOUNTS, NOW).granted).toBe(false);
    expect(s.gems).toBe(0);
    const r = applyPurchase(s, buy('gems_1', 'a'), AMOUNTS, NOW);
    expect(r.granted).toBe(true);
    expect(r.action?.kind).toBe('consume');
    expect(s.gems).toBe(100);
    expect(applyPurchase(s, buy('gems_1', 'a'), AMOUNTS, NOW).granted).toBe(false);
    expect(s.gems).toBe(100);
    expect(applyPurchase(s, buy('not_a_product', 'b'), AMOUNTS, NOW).granted).toBe(false);
  });

  it('Starter Pack: No Ads, this month\'s pass, gems and cash; a refund takes No Ads back', () => {
    const s = save();
    const r = reconcile(s, [buy('starter_pack', 't1')], AMOUNTS, NOW);
    expect(r.granted).toEqual(['starter_pack']);
    expect(r.actions).toEqual([{ kind: 'ack', token: 't1', productId: 'starter_pack' }]);
    expect(s.flags.noAds && s.flags.starterPack).toBe(true);
    expect(s.seasonPass).toBe(seasonId(NOW));
    expect(s.gems).toBe(500);
    expect(s.cash).toBe(10000);
    const gone = reconcile(s, [], AMOUNTS, NOW);
    expect(gone.revoked).toEqual(['starter_pack', 'no_ads']);
    expect(s.flags.noAds).toBe(false);
  });

  it('an old Starter Pack seen on a new phone restores No Ads but pays no gems again', () => {
    const s = save();
    reconcile(s, [buy('starter_pack', 't1', { time: NOW - 30 * 86400000, acknowledged: true })], AMOUNTS, NOW);
    expect(s.flags.noAds).toBe(true);
    expect(s.gems).toBe(0);
  });
});

describe('Champion Bundle fighter', () => {
  const id = BUNDLE_FIGHTERS.bundle_champion;

  it('names a real epic roster fighter', () => {
    expect(rosterFighter(id)?.rarity).toBe('epic');
  });

  it('gives the fighter while Play reports the bundle, and a refund takes it back', () => {
    const s = save();
    reconcile(s, [buy('bundle_champion', 'b1')], AMOUNTS, NOW);
    expect(s.gems).toBe(300);
    const f = s.progress.fighters;
    expect(syncBundles(f, s.paidBundles).given[0]).toMatchObject({ id, isNew: true });
    expect(f.owned[id]).toBeTruthy();
    expect(syncBundles(f, s.paidBundles).given).toEqual([]); // once
    reconcile(s, [], AMOUNTS, NOW);
    expect(syncBundles(f, s.paidBundles).taken).toEqual([id]);
    expect(f.owned[id]).toBeUndefined();
    expect(Object.values(f.picked)).not.toContain(id);
  });

  it('keeps a fighter the player already owned or earned again from a pack', () => {
    const s = save();
    const f = s.progress.fighters;
    syncBundles(f, ['bundle_champion']);
    giveCard(f, id); // a pack duplicate: now the player's own
    expect(f.bundle.bundle_champion).toBe('kept');
    syncBundles(f, []);
    expect(f.owned[id]).toBeTruthy();
    const s2 = save();
    giveCard(s2.progress.fighters, id);
    const r = syncBundles(s2.progress.fighters, ['bundle_champion']);
    expect(r.given[0].isNew).toBe(false);
    expect(r.given[0].shards).toBeGreaterThan(0);
  });

  it('the save sanitiser drops unknown bundle records', () => {
    const f = sanitizeFighters({ owned: {}, picked: {}, bundle: { bundle_champion: 'card', fake: 'card', x: 3 } });
    expect(f.bundle).toEqual({ bundle_champion: 'card' });
    expect(sanitizeFighters({}).bundle).toEqual({});
  });
});

describe('restores never carry paid items', () => {
  it('a save code with No Ads and a Season Pass gets this phone\'s entitlements instead', () => {
    const phone = save();
    const code = save();
    code.flags.noAds = true;
    code.flags.starterPack = true;
    code.paidBundles = ['bundle_champion'];
    code.seasonPass = seasonId(NOW);
    code.wins = 40;
    keepEntitlements(code, phone, { restore: true, trustPass: false, now: NOW });
    expect(code.flags.noAds).toBe(false);
    expect(code.flags.starterPack).toBe(false);
    expect(code.paidBundles).toEqual([]);
    expect(code.seasonPass).toBe('');
    expect(code.wins).toBe(40);
  });

  it('a cloud copy keeps this month\'s Season Pass (consumed, so Play cannot return it)', () => {
    const phone = save();
    const cloud = save();
    cloud.seasonPass = seasonId(NOW);
    keepEntitlements(cloud, phone, { restore: true, trustPass: true, now: NOW });
    expect(cloud.seasonPass).toBe(seasonId(NOW));
  });

  it('gems bought on this phone survive loading an older save', () => {
    const phone = save();
    applyPurchase(phone, buy('gems_2', 'g'), AMOUNTS, NOW);
    const old = save();
    keepEntitlements(old, phone, { restore: true, now: NOW });
    expect(old.gems).toBe(550);
    expect(old.iap.tokens).toContain('g');
    // and the purchase is not granted a second time afterwards
    expect(applyPurchase(old, buy('gems_2', 'g'), AMOUNTS, NOW).granted).toBe(false);
  });
});

describe('reward clock', () => {
  it('never goes back when the phone clock is moved back', () => {
    const s = save();
    bindClock(s);
    const t1 = rewardTime(NOW);
    expect(rewardTime(NOW - 5 * 86400000)).toBeGreaterThanOrEqual(t1);
    bindClock(null);
  });

  it('a restored save keeps the later of the two clocks', () => {
    const phone = save();
    phone.clock.high = NOW;
    const other = save();
    other.clock.high = NOW - 1000;
    keepClock(other, phone);
    expect(other.clock.high).toBe(NOW);
  });
});

describe('ad pacing', () => {
  it('no interstitial in the first session or first 10 minutes, then every 3rd fight, 4 minutes apart', () => {
    const p = { fightsSince: 0, lastAt: 0, playSec: 0, sessions: 1 };
    for (let i = 0; i < 10; i++) countFight(p, 240);
    expect(interstitialDue(p, { now: NOW, noAds: false, highlight: false })).toBe(false); // first session
    p.sessions = 2;
    expect(interstitialDue(p, { now: NOW, noAds: false, highlight: false })).toBe(true);
    expect(interstitialDue(p, { now: NOW, noAds: true, highlight: false })).toBe(false);
    expect(interstitialDue(p, { now: NOW, noAds: false, highlight: true })).toBe(false);
    adShown(p, NOW, true);
    countFight(p, 60);
    countFight(p, 60);
    countFight(p, 60);
    expect(interstitialDue(p, { now: NOW + 60_000, noAds: false, highlight: false })).toBe(false); // too soon
    expect(interstitialDue(p, { now: NOW + 240_000, noAds: false, highlight: false })).toBe(true);
    const fresh = { fightsSince: 5, lastAt: 0, playSec: 300, sessions: 3 };
    expect(interstitialDue(fresh, { now: NOW, noAds: false, highlight: false })).toBe(false); // under 10 minutes
  });
});

describe('leaderboard record', () => {
  it('scores wins only, finishes above decisions, quick above late', () => {
    expect(fightScore({ winner: 1, method: 'KO' }, 60, 70, 500)).toBe(0);
    expect(fightScore({ winner: null, method: 'DEC' }, 900, 70, 500)).toBe(0);
    const ko = fightScore({ winner: 0, method: 'KO' }, 60, 70, 500);
    const lateKo = fightScore({ winner: 0, method: 'KO' }, 500, 70, 500);
    const dec = fightScore({ winner: 0, method: 'DEC' }, 270, 70, 500);
    expect(ko).toBeGreaterThan(lateKo);
    expect(lateKo).toBeGreaterThan(dec);
    expect(Number.isInteger(ko)).toBe(true);
    expect(fightScore({ winner: 0, method: 'KO' }, 60, 90, 900)).toBeGreaterThan(ko);
  });

  it('counts knockouts and submissions, keeps the best score, sanitises', () => {
    const r = freshRecord();
    recordFight(r, { winner: 0, method: 'TKO' }, 100, 60, 400);
    recordFight(r, { winner: 0, method: 'SUB' }, 100, 60, 400);
    recordFight(r, { winner: 1, method: 'KO' }, 100, 60, 400);
    expect([r.kos, r.subs]).toEqual([1, 1]);
    expect(r.best).toBe(fightScore({ winner: 0, method: 'SUB' }, 100, 60, 400));
    expect(sanitizeRecord({ kos: -4, subs: 'x', best: 1e12 })).toEqual({ v: 1, kos: 0, subs: 0, best: 100_000, easyWins: 0, easyKos: 0 });
    expect(save().progress.record).toEqual(freshRecord());
  });
});

// ---- cloud save: read before write ---------------------------------------------------------------------------------

const pg = vi.hoisted(() => ({
  signedIn: true,
  load: { state: 'missing' } as { state: string; save?: unknown },
  saved: 0,
}));
vi.mock('../src/platform/games', () => ({
  gamesSignedIn: () => pg.signedIn,
  cloudLoad: () => Promise.resolve(pg.load),
  cloudSave: () => {
    pg.saved++;
    return Promise.resolve(true);
  },
  cloudAhead: (local: SaveData, cloud: SaveData) => cloud.fights > local.fights,
  syncAchievements: () => {},
}));
const { CloudSync } = await import('../src/app/cloud');

function fakeGame(s: SaveData) {
  const listeners: (() => void)[] = [];
  return {
    save: s,
    replaced: null as SaveData | null,
    onChange: (fn: () => void) => listeners.push(fn),
    change: () => listeners.forEach(l => l()),
    flush: () => {},
    replaceSave(next: SaveData) {
      this.replaced = next;
      this.save = next;
    },
  };
}

describe('cloud save', () => {
  beforeEach(() => {
    pg.signedIn = true;
    pg.saved = 0;
    pg.load = { state: 'missing' };
  });

  it('never uploads when the cloud copy could not be read', async () => {
    pg.load = { state: 'error' };
    const g = fakeGame(save());
    const c = new CloudSync(g as never, () => Promise.resolve(true));
    await c.start();
    g.change();
    expect(await c.push(true)).toBe(false);
    expect(pg.saved).toBe(0);
  });

  it('never overwrites a copy from a newer version', async () => {
    pg.load = { state: 'newer' };
    const c = new CloudSync(fakeGame(save()) as never, () => Promise.resolve(true));
    await c.start();
    expect(await c.push(true)).toBe(false);
    expect(pg.saved).toBe(0);
  });

  it('asks before replacing this phone\'s progress with a cloud copy that is ahead', async () => {
    const cloud = save();
    cloud.fights = 50;
    pg.load = { state: 'ok', save: cloud };
    const g = fakeGame(save());
    const ask = vi.fn(() => Promise.resolve(true));
    await new CloudSync(g as never, ask).start();
    expect(ask).toHaveBeenCalledOnce();
    expect(g.replaced).toBe(cloud);
    expect(pg.saved).toBe(1); // uploaded only after the answer
  });

  it('keeps this phone\'s progress when the player says no, and when the cloud is behind', async () => {
    const cloud = save();
    cloud.fights = 50;
    pg.load = { state: 'ok', save: cloud };
    const g = fakeGame(save());
    await new CloudSync(g as never, () => Promise.resolve(false)).start();
    expect(g.replaced).toBeNull();
    const local = save();
    local.fights = 99;
    const g2 = fakeGame(local);
    const ask = vi.fn(() => Promise.resolve(true));
    await new CloudSync(g2 as never, ask).start();
    expect(ask).not.toHaveBeenCalled();
  });
});
