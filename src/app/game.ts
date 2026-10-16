// The game's state and rules in one place for the menus: the save, the player's fighters, the career, packs,
// rewards after a fight, purchases (Google Play) and ads. Screens call these methods; nothing in the UI changes the
// save directly. Every change is followed by persist().

import type { DivisionId, FighterSpec, FightResult } from '../game/fight/types';
import { applyCareerResult, careerReward, nextStep, type CareerReward, type CareerStep } from '../meta/career';
import { claimDaily, dailyStatus } from '../meta/daily';
import { dayNumber } from '../meta/days';
import { DIVISION_IDS } from '../meta/divisions';
import { applyPurchase, keepEntitlements, reconcile, type Amounts } from '../meta/entitlements';
import { addXp, canStarUp, giveCard, starUp, STARTER_ID, syncBundles, toFightSpec, trainCost, trainMinutes, type CardResult } from '../meta/fighters';
import { PACKS, rollPack, type PackId, type PackResult } from '../meta/packs';
import { bindClock, keepClock, rewardTime, settleClock, unlock as unlockClock } from '../meta/clock';
import { overall, ROSTER, rosterFighter, type RosterFighter } from '../meta/roster';
import { recordFight } from '../meta/record';
import { addSeasonXp, claimTier, ensureSeason, fightXp, type SeasonReward } from '../meta/season';
import { ensureProgress, flush, loadSave, writeSave, type SaveData } from '../meta/save';
import { startTimer, timerLeft, clearTimer } from '../meta/timers';
import { TUNING } from '../meta/tuning';
import { addCash, addGems, spendCash, spendGems } from '../meta/wallet';
import { countFight, interstitialDue, adShown } from '../meta/adpacing';
import { ensureWeek } from '../meta/weekly';
import { paidPacksStatus } from '../platform/country';
import { buy, finish, queryPurchases } from '../platform/iap';
import { interstitialReady, rewardedAvailable, showInterstitial, showRewarded } from '../platform/ads';
import { isNative } from '../platform/platform';
import { submitScore } from '../platform/games';
import type { FighterStats } from '../game/fight/types';

/** What the daily login pays, by day of the 7-day cycle. */
export const DAILY_REWARDS: { cash: number; gems: number; pack?: PackId }[] = [
  { cash: 500, gems: 0 },
  { cash: 800, gems: 0 },
  { cash: 0, gems: 15 },
  { cash: 1200, gems: 0 },
  { cash: 0, gems: 0, pack: 'standard' },
  { cash: 1500, gems: 10 },
  { cash: 0, gems: 40, pack: 'premium' },
];

export interface FightRewards {
  cash: number;
  xp: number;
  gems: number;
  levels: number;
  seasonXp: number;
  pack: PackId | null;
  belt: boolean;
  /** "Watch ad: double cash" is offered for this much extra. */
  doubleOffer: number;
  /** This win's leaderboard score (0 for a loss or draw), and whether it is the player's best. */
  score: number;
  best: boolean;
}

export type BuyPackResult = { ok: true; result: PackResult; cards: CardResult[] } | { ok: false; reason: 'funds' | 'blocked' };

const amounts = (): Amounts => ({ gemPacks: TUNING.gemPacks, starterGems: TUNING.starterGems, starterCash: TUNING.starterCash, bundleGems: TUNING.bundleGems });

export class Game {
  save: SaveData;
  /** Listeners for wallet / progress changes (top bar). */
  private listeners: (() => void)[] = [];

  constructor() {
    this.save = loadSave();
    bindClock(this.save);
    settleClock(this.save, Date.now(), dayNumber);
    ensureProgress(this.save);
    this.firstRun();
    ensureSeason(this.save);
    ensureWeek(this.save);
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    this.persist();
  }

  /** Back in the app: a phone clock that was moved back is believed again after 7 days (meta/clock.ts). */
  resumed(): void {
    if (settleClock(this.save, Date.now(), dayNumber)) this.persist();
  }

  /**
   * Replace the progress with a restored save (a save code, or the Play Games cloud copy). Settings stay this phone's,
   * paid items stay what Play says this phone owns (a cloud copy keeps this month's Season Pass: it was paid for and
   * Play can't return a consumed pass), and the reward clock never goes back.
   */
  replaceSave(next: SaveData, fromCloud: boolean): void {
    next.settings = this.save.settings;
    keepEntitlements(next, this.save, { restore: true, trustPass: fromCloud });
    if (this.save.firstAt && (!next.firstAt || this.save.firstAt < next.firstAt)) next.firstAt = this.save.firstAt;
    keepClock(next, this.save);
    this.save = next;
    bindClock(this.save);
    // a save from another phone may hold rewards dated ahead of this phone's clock
    unlockClock(this.save, rewardTime(), dayNumber);
    ensureProgress(this.save);
    this.firstRun();
    ensureSeason(this.save);
    ensureWeek(this.save);
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    flush();
    this.persist(true);
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  persist(immediate = false): void {
    writeSave(this.save, immediate);
    for (const l of this.listeners) l();
  }

  flush(): void {
    flush();
  }

  private firstRun(): void {
    const f = this.save.progress.fighters;
    if (Object.keys(f.owned).length === 0) {
      giveCard(f, STARTER_ID);
      f.picked.mLight = STARTER_ID;
    }
  }

  // ---- fighters --------------------------------------------------------------------------------------------------

  owned(id: string): boolean {
    return !!this.save.progress.fighters.owned[id];
  }

  ownedIn(div: DivisionId): RosterFighter[] {
    return ROSTER.filter(f => f.division === div && this.owned(f.id));
  }

  /** The player's fighter for a division (their pick, or their best owned). */
  pickedFor(div: DivisionId): RosterFighter | null {
    const id = this.save.progress.fighters.picked[div];
    if (id && this.owned(id)) return rosterFighter(id) ?? null;
    const list = this.ownedIn(div);
    return list.length ? list[list.length - 1] : null;
  }

  pick(id: string): void {
    const f = rosterFighter(id);
    if (!f || !this.owned(id)) return;
    this.save.progress.fighters.picked[f.division] = id;
    this.persist();
  }

  spec(id: string): FighterSpec | null {
    const base = rosterFighter(id);
    const o = this.save.progress.fighters.owned[id];
    return base && o ? toFightSpec(o, base) : null;
  }

  /** The division the player has most recently been fighting in (the hub's featured fighter). */
  mainDivision(): DivisionId {
    for (const d of DIVISION_IDS) if (this.save.progress.fighters.picked[d] && this.save.progress.career.div[d].tier > 0) return d;
    for (const d of DIVISION_IDS) if (this.pickedFor(d)) return d;
    return 'mLight';
  }

  train(id: string, stat: keyof FighterStats): { ok: boolean; reason?: 'funds' | 'cap' | 'busy' } {
    const o = this.save.progress.fighters.owned[id];
    const base = rosterFighter(id);
    if (!o || !base) return { ok: false, reason: 'cap' };
    if (this.trainingLeft(id) !== null) return { ok: false, reason: 'busy' };
    const pts = o.train[stat] ?? 0;
    const capStat = toFightSpec(o, base).stats[stat] >= 100;
    if (capStat || pts >= { common: 8, rare: 10, epic: 12, legend: 14 }[base.rarity]) return { ok: false, reason: 'cap' };
    if (!spendCash(this.save, trainCost(pts))) return { ok: false, reason: 'funds' };
    o.train[stat] = pts + 1;
    const mins = trainMinutes(pts);
    if (mins > 0) startTimer(this.save, `train:${id}`, mins * 60_000);
    this.persist();
    return { ok: true };
  }

  /** Training cooldown left (ms) for a fighter, or null when free. */
  trainingLeft(id: string): number | null {
    const left = timerLeft(this.save, `train:${id}`);
    return left !== null && left > 0 ? left : null;
  }

  skipTrainingWithGems(id: string): boolean {
    const left = this.trainingLeft(id);
    if (left === null) return true;
    const cost = Math.max(5, Math.ceil(left / 60_000 / 3));
    if (!spendGems(this.save, cost)) return false;
    clearTimer(this.save, `train:${id}`);
    this.persist();
    return true;
  }

  async skipTrainingWithAd(id: string): Promise<boolean> {
    if (!(await showRewarded())) return false;
    clearTimer(this.save, `train:${id}`);
    this.persist();
    return true;
  }

  starUp(id: string): boolean {
    const o = this.save.progress.fighters.owned[id];
    if (!o || !canStarUp(o)) return false;
    starUp(o);
    this.persist();
    return true;
  }

  // ---- career ----------------------------------------------------------------------------------------------------

  careerStep(div: DivisionId): CareerStep | null {
    const me = this.pickedFor(div);
    return me ? nextStep(this.save.progress.career, div, me.id) : null;
  }

  // ---- after a fight -----------------------------------------------------------------------------------------------

  /** Pay out a finished fight. `step` for career fights; null for quick fights (smaller rewards, no ladder move). */
  finishFight(fighterId: string, result: FightResult, seconds: number, step: CareerStep | null, opp: FighterSpec, difficulty: number): FightRewards {
    const won = result.winner === 0;
    const draw = result.winner === null;
    const method = result.method;
    let r: CareerReward;
    if (step) {
      r = careerReward(step, won, draw, method);
      applyCareerResult(this.save.progress.career, step, won, draw, method);
    } else {
      const cash = won ? (method === 'DEC' ? 250 : 375) : 100;
      r = { cash, xp: won ? 60 : 30, gems: 0, pack: null, belt: false };
    }
    addCash(this.save, r.cash);
    addGems(this.save, r.gems);
    const o = this.save.progress.fighters.owned[fighterId];
    const levels = o ? addXp(o, r.xp) : 0;
    if (r.pack) this.save.progress.packs.unopened[r.pack]++;
    const seasonXp = addSeasonXp(this.save, fightXp(won ? 120 : 60), Date.now(), 'fight');
    this.save.fights++;
    if (won) this.save.wins++;
    this.save.fightLog.push({ t: Date.now(), k: step ? 'career' : 'quick', o: step?.opponent.id ?? 'quick', r: won ? 'W' : draw ? 'D' : 'L', m: method, s: Math.round(seconds) });
    if (this.save.fightLog.length > 50) this.save.fightLog.splice(0, this.save.fightLog.length - 50);
    countFight(this.save.ads, seconds);
    const rec = this.save.progress.record;
    const before = rec.best;
    const score = recordFight(rec, result, seconds, overall(opp.stats), difficulty);
    this.persist(true);
    // Play Games keeps each player's best, so posting every time is safe
    submitScore('wins', this.save.wins);
    submitScore('knockouts', rec.kos);
    if (score > 0) submitScore('weekly', score);
    return { cash: r.cash, xp: r.xp, gems: r.gems, levels, seasonXp, pack: r.pack, belt: r.belt, doubleOffer: Math.min(TUNING.doubleCashCap, r.cash), score, best: score > before };
  }

  /** "Watch ad: double cash" after a fight. */
  async doubleCash(amount: number): Promise<boolean> {
    if (!(await showRewarded())) return false;
    addCash(this.save, Math.min(TUNING.doubleCashCap, amount));
    this.persist();
    return true;
  }

  /** Show an interstitial if the pacing rules allow (behind an "Ad break" card in the UI). */
  interstitialDue(): boolean {
    return interstitialReady() && interstitialDue(this.save.ads, { now: Date.now(), noAds: this.save.flags.noAds, highlight: false });
  }

  async showInterstitial(): Promise<void> {
    const shown = await showInterstitial();
    if (shown) {
      adShown(this.save.ads, Date.now(), true);
      this.persist();
    }
  }

  rewardedReady(): boolean {
    return rewardedAvailable();
  }

  // ---- packs -------------------------------------------------------------------------------------------------------

  paidPacksAllowed(): boolean {
    return paidPacksStatus().allowed;
  }

  private open(id: PackId): { result: PackResult; cards: CardResult[] } {
    const seed = (Date.now() ^ (this.save.progress.packs.opened[id] * 7919) ^ (this.save.fights * 31)) >>> 0;
    const result = rollPack(this.save.progress.packs, id, seed);
    const cards = result.cards.map(c => giveCard(this.save.progress.fighters, c.id));
    return { result, cards };
  }

  buyPack(id: PackId): BuyPackResult {
    const def = PACKS[id];
    if (def.paid && !this.paidPacksAllowed()) return { ok: false, reason: 'blocked' };
    if (def.gems > 0 ? !spendGems(this.save, def.gems) : !spendCash(this.save, def.cash)) return { ok: false, reason: 'funds' };
    const r = this.open(id);
    this.persist(true);
    return { ok: true, ...r };
  }

  /** Open an earned pack (never gated: it was not bought). */
  openEarned(id: PackId): BuyPackResult {
    if (this.save.progress.packs.unopened[id] <= 0) return { ok: false, reason: 'funds' };
    this.save.progress.packs.unopened[id]--;
    const r = this.open(id);
    this.persist(true);
    return { ok: true, ...r };
  }

  freePackAvailable(): boolean {
    return this.save.progress.packs.freeDay < dayNumber(rewardTime());
  }

  /** The free daily pack: watch an ad, get a Standard Pack to open. */
  async claimFreePack(): Promise<boolean> {
    if (!this.freePackAvailable()) return false;
    if (!(await showRewarded())) return false;
    this.save.progress.packs.freeDay = dayNumber(rewardTime());
    this.save.progress.packs.unopened.standard++;
    this.persist(true);
    return true;
  }

  // ---- daily login and season ----------------------------------------------------------------------------------

  dailyAvailable(): boolean {
    return dailyStatus(this.save).available;
  }

  claimDaily(): { day: number; cash: number; gems: number; pack?: PackId } | null {
    const day = claimDaily(this.save);
    if (!day) return null;
    const r = DAILY_REWARDS[day - 1];
    addCash(this.save, r.cash);
    addGems(this.save, r.gems);
    if (r.pack) this.save.progress.packs.unopened[r.pack]++;
    this.persist(true);
    return { day, ...r };
  }

  claimSeason(track: 'free' | 'prem', tier: number): SeasonReward | null {
    const r = claimTier(this.save, track, tier);
    if (r) this.persist(true);
    return r;
  }

  // ---- purchases -------------------------------------------------------------------------------------------------

  /** Buy a Play product: grant first, persist, then acknowledge / consume. */
  async buyProduct(id: string): Promise<'purchased' | 'pending' | 'cancelled' | 'failed' | 'unavailable'> {
    if (!isNative) return 'unavailable';
    const r = await buy(id);
    if (r.status !== 'purchased') return r.status === 'owned' || r.status === 'busy' ? 'failed' : r.status;
    const g = applyPurchase(this.save, r.purchase, amounts());
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    this.persist(true);
    if (g.action) await finish(g.action);
    return 'purchased';
  }

  /** Restore / reconcile with Play (launch, resume, the Restore button). Never called with a failed query. */
  async syncPurchases(): Promise<{ granted: string[]; revoked: string[] } | null> {
    const list = await queryPurchases();
    if (!list) return null;
    const r = reconcile(this.save, list, amounts());
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    this.persist(true);
    for (const a of r.actions) await finish(a);
    return { granted: r.granted, revoked: r.revoked };
  }

  get cash(): number {
    return this.save.cash;
  }
  get gems(): number {
    return this.save.gems;
  }
}

/** All 48 fighters with ownership, for the roster screen. */
export function rosterView(game: Game): { f: RosterFighter; owned: boolean }[] {
  return ROSTER.map(f => ({ f, owned: game.owned(f.id) }));
}
