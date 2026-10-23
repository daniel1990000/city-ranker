// The game's state and rules in one place for the menus: the save, the player's fighters, the career, packs,
// rewards after a fight, purchases (Google Play) and ads. Screens call these methods; nothing in the UI changes the
// save directly. Every change is followed by persist().

import type { DivisionId, FighterSpec, FightResult } from '../game/fight/types';
import { applyCareerResult, canPrestige, careerReward, LEGACY, legacyRank, MAX_PRESTIGE, moveDivision, neighbourDivisions, nextStep, prestigeUp, weightClassStats, type CareerReward, type CareerStep } from '../meta/career';
import { claimDaily, dailyStatus } from '../meta/daily';
import { dayNumber } from '../meta/days';
import { DIVISION_IDS } from '../meta/divisions';
import { applyPurchase, keepEntitlements, reconcile, type Amounts } from '../meta/entitlements';
import { addXp, canStarUp, giveCard, starUp, STARTER_ID, syncBundles, toFightSpec, trainCost, trainMinutes, type CardResult } from '../meta/fighters';
import { PACKS, rollPack, type PackId, type PackResult } from '../meta/packs';
import { bindClock, keepClock, rewardTime, settleClock, unlock as unlockClock } from '../meta/clock';
import { overall, ROSTER, rosterFighter, type RosterFighter } from '../meta/roster';
import { boardCounts, recordFight } from '../meta/record';
import { winCash, winXp } from '../meta/difficulty';
import { addSeasonXp, claimTier, ensureSeason, fightXp, type SeasonReward } from '../meta/season';
import { ensureProgress, flush, loadSave, writeSave, type SaveData } from '../meta/save';
import { startTimer, timerLeft, clearTimer } from '../meta/timers';
import { TUNING } from '../meta/tuning';
import { addCash, addGems, spendCash, spendGems } from '../meta/wallet';
import { countFight, interstitialDue, adShown } from '../meta/adpacing';
import { ensureWeek, weekDaysLeft } from '../meta/weekly';
import {
  adEntryOffered, applyTourResult, bracket, claimTourTier, enterTournament, entriesLeft, grantAdEntry, loanerFor, markLive, nextTourStep, runActive, syncTournament, tierReached, tourTiers,
  type Bracket, type TournamentState, type TourOutcome, type TourStep, type TourTier,
} from '../meta/tournament';
import { paidPacksStatus } from '../platform/country';
import { buy, finish, queryPurchases } from '../platform/iap';
import { interstitialReady, rewardedAvailable, showInterstitial, showRewarded } from '../platform/ads';
import { isNative } from '../platform/platform';
import { submitScore, syncAchievements } from '../platform/games';
import { track } from '../platform/telemetry';
import type { FighterStats, RoundStats } from '../game/fight/types';
import { earnAchievements, fightFacts, type AchievementDef } from '../meta/achievements';
import { missionsView, progressMissions, type MissionEvent, type MissionPayout, type MissionView } from '../meta/missions';

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
  /** achievements and missions this fight completed (already paid; also sent to `onEarned` listeners) */
  earned: Earned;
  /** Legacy ranks reached in this fight (names), for the result screen. */
  legacy: string[];
  /** A weekly tournament fight's points and where the run stands (null for other fights). */
  tournament: TourOutcome | null;
}

/** A finished weekly tournament fight, for Game.finishFight. */
export interface TourFightDone {
  step: TourStep;
  /** fight length and its longest possible length, in simulation ticks */
  ticks: number;
  maxTicks: number;
  /** damage the player took */
  damageTaken: number;
}

/** What the tournament screen shows. */
export interface TournamentView {
  t: TournamentState;
  bracket: Bracket;
  /** the next fight of the run under way, or null */
  step: TourStep | null;
  /** who fights: the run's fighter, else the player's fighter for the week's division, else the loaner */
  fighter: FighterSpec;
  loaner: boolean;
  entriesLeft: number;
  adEntry: boolean;
  active: boolean;
  best: number;
  daysLeft: number;
  tiers: (TourTier & { reached: boolean; claimed: boolean })[];
}

/** The champion's options after a title (career screen). */
export interface ChampionOptions {
  prestige: number;
  canPrestige: boolean;
  maxPrestige: number;
  /** neighbouring weight classes the champion can move to */
  moves: DivisionId[];
  legacyRank: number;
  legacyName: string;
  /** next Legacy rank: name and defences needed (null at the top) */
  legacyNext: { name: string; at: number } | null;
  defenses: number;
  reign: number;
  supers: number;
  /** a fighter from another division fights this career (moved up or down) */
  guest: string;
}

/** Achievements awarded and missions finished by one action (already paid), for toasts. */
export interface Earned {
  achievements: AchievementDef[];
  /** null when the action can't move a mission on */
  missions: MissionPayout | null;
}

export type BuyPackResult = { ok: true; result: PackResult; cards: CardResult[]; earned: Earned } | { ok: false; reason: 'funds' | 'blocked' };

const amounts = (): Amounts => ({ gemPacks: TUNING.gemPacks, starterGems: TUNING.starterGems, starterCash: TUNING.starterCash, bundleGems: TUNING.bundleGems });

export class Game {
  save: SaveData;
  /** Listeners for wallet / progress changes (top bar). */
  private listeners: (() => void)[] = [];
  private earnedListeners: ((e: Earned) => void)[] = [];
  /** earned before anyone listened (achievements awarded for progress made before they existed, at launch) */
  private earnedPending: Earned[] = [];

  /** When the loaded save was last written (before this launch touched it), for the native-copy check. */
  readonly loadedSavedAt: number;
  /** The player has changed something since launch (then a native copy is never swapped in under them). */
  changedSinceLaunch = false;
  private booted = false;

  constructor() {
    this.save = loadSave();
    this.loadedSavedAt = this.save.savedAt;
    bindClock(this.save);
    settleClock(this.save, Date.now(), dayNumber);
    ensureProgress(this.save);
    this.firstRun();
    ensureSeason(this.save);
    ensureWeek(this.save);
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    this.save.ads.sessions++;
    this.checkEarned();
    this.persist();
    this.booted = true;
  }

  /** The phone's native copy of this same save is newer than the WebView's (a lost write): take it as it is. */
  adoptMirror(d: SaveData): void {
    d.settings = this.save.settings;
    d.ads.sessions = Math.max(d.ads.sessions, this.save.ads.sessions);
    keepClock(d, this.save);
    this.save = d;
    bindClock(this.save);
    ensureProgress(this.save);
    this.firstRun();
    ensureSeason(this.save);
    ensureWeek(this.save);
    syncBundles(this.save.progress.fighters, this.save.paidBundles);
    this.checkEarned();
    this.persist(true);
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
    this.checkEarned();
    flush();
    this.persist(true);
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  persist(immediate = false): void {
    if (this.booted) this.changedSinceLaunch = true;
    writeSave(this.save, immediate);
    for (const l of this.listeners) l();
  }

  flush(): void {
    flush();
  }

  // ---- achievements and daily missions ------------------------------------------------------------------------

  /**
   * Hear every achievement awarded and mission finished (already paid), to show a toast. What was earned before the
   * first listener (at launch, or by a restored save) is delivered to it at once.
   */
  onEarned(fn: (e: Earned) => void): void {
    this.earnedListeners.push(fn);
    const pending = this.earnedPending.splice(0);
    for (const e of pending) fn(e);
  }

  /** Pay a meta event (a pack opened, a stat trained, ...) into the missions and check the achievements. */
  private earn(ev: MissionEvent | null, ctx: Parameters<typeof earnAchievements>[1] = {}): Earned {
    const missions = ev ? progressMissions(this.save, ev) : null;
    const achievements = earnAchievements(this.save, ctx);
    const e: Earned = { achievements, missions };
    if (achievements.length) syncAchievements(this.save);
    if (achievements.length || missions?.done.length) {
      if (this.earnedListeners.length) for (const l of this.earnedListeners) l(e);
      else if (this.earnedPending.length < 20) this.earnedPending.push(e);
    }
    return e;
  }

  /** Award anything the save already qualifies for (launch, restores, the daily login, the season track). */
  private checkEarned(): Earned {
    return this.earn(null);
  }

  /** Today's three missions (a new set after midnight on the reward clock) and whether the all-done bonus is paid. */
  missions(): { list: MissionView[]; bonus: boolean } {
    const day = this.save.progress.missions.day;
    const v = missionsView(this.save);
    if (this.save.progress.missions.day !== day) this.persist();
    return v;
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
    // picking one of the division's own fighters ends a moved-in champion's stay
    this.save.progress.career.div[f.division].guest = '';
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
    this.earn({ kind: 'train' });
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

  /** An opt-in reward video. It also restarts the interstitial spacing, so an ad never follows another at once. */
  private async rewarded(kind: string): Promise<boolean> {
    const ok = await showRewarded();
    if (ok) {
      adShown(this.save.ads, Date.now(), false);
      track('ad_shown', { format: 'rewarded', kind });
    }
    return ok;
  }

  async skipTrainingWithAd(id: string): Promise<boolean> {
    if (!(await this.rewarded('train'))) return false;
    clearTimer(this.save, `train:${id}`);
    this.persist();
    return true;
  }

  starUp(id: string): boolean {
    const o = this.save.progress.fighters.owned[id];
    if (!o || !canStarUp(o)) return false;
    starUp(o);
    this.checkEarned();
    this.persist();
    return true;
  }

  // ---- career ----------------------------------------------------------------------------------------------------

  /** Who fights this division's career: a champion who moved in from a neighbouring class, else the pick. */
  careerFighter(div: DivisionId): RosterFighter | null {
    const guest = this.save.progress.career.div[div].guest;
    if (guest && this.owned(guest)) return rosterFighter(guest) ?? null;
    return this.pickedFor(div);
  }

  /** The career fighter's spec for this division (a moved-in champion's stats change with the weight class). */
  careerSpec(div: DivisionId): FighterSpec | null {
    const me = this.careerFighter(div);
    const spec = me ? this.spec(me.id) : null;
    if (!spec) return null;
    return spec.division === div ? spec : { ...spec, stats: weightClassStats(spec.stats, spec.division, div) };
  }

  careerStep(div: DivisionId): CareerStep | null {
    const me = this.careerFighter(div);
    return me ? nextStep(this.save.progress.career, div, me.id, dayNumber(rewardTime())) : null;
  }

  /** The champion's options and Legacy (null before the first title in this division). */
  championOptions(div: DivisionId): ChampionOptions | null {
    const c = this.save.progress.career.div[div];
    if (!c.belt && c.titles === 0) return null;
    const me = this.careerFighter(div);
    const rank = legacyRank(c.defenses);
    const next = LEGACY[rank];
    return {
      prestige: c.prestige,
      canPrestige: canPrestige(c),
      maxPrestige: MAX_PRESTIGE,
      moves: c.belt && me && me.division === div ? neighbourDivisions(div) : [],
      legacyRank: rank,
      legacyName: rank > 0 ? LEGACY[rank - 1].name : '',
      legacyNext: next ? { name: next.name, at: next.at } : null,
      defenses: c.defenses,
      reign: c.reign,
      supers: c.supers,
      guest: c.guest,
    };
  }

  /** Vacate the belt and run the ladder again at the next Prestige. */
  prestige(div: DivisionId): boolean {
    if (!prestigeUp(this.save.progress.career, div)) return false;
    track('career_prestige', { div, prestige: this.save.progress.career.div[div].prestige });
    this.persist(true);
    return true;
  }

  /** The champion of `from` moves up or down to `to` (keeps the belt in `from`). */
  moveDivision(from: DivisionId, to: DivisionId): boolean {
    const me = this.careerFighter(from);
    if (!me || !moveDivision(this.save.progress.career, from, to, me.id)) return false;
    track('career_move', { from, to });
    this.persist(true);
    return true;
  }

  // ---- weekly tournament -----------------------------------------------------------------------------------------

  private tourDay(): number {
    return dayNumber(rewardTime());
  }

  /** The week's tournament for the screen (brings the week, the day's entries and an abandoned fight up to date). */
  tournament(): TournamentView {
    const t = syncTournament(this.save, this.tourDay());
    this.persist();
    const who = this.tourFighter(t);
    return {
      t,
      bracket: bracket(t.week),
      step: nextTourStep(t),
      fighter: who.spec,
      loaner: who.loaner,
      entriesLeft: entriesLeft(t),
      adEntry: adEntryOffered(t),
      active: runActive(t),
      best: this.save.weekly.best,
      daysLeft: weekDaysLeft(),
      tiers: tourTiers().map(x => ({ ...x, reached: tierReached(this.save, x), claimed: this.save.weekly.claimed.includes(x.tier) })),
    };
  }

  /** The run's fighter; with no run, the player's fighter for the week's division, else the week's loaner. */
  private tourFighter(t: TournamentState): { spec: FighterSpec; loaner: boolean } {
    const div = bracket(t.week).div;
    const id = t.run ? (t.run.loaner ? null : t.run.fighter) : (this.pickedFor(div)?.id ?? null);
    const s = id ? this.spec(id) : null;
    if (s && s.division === div) return { spec: s, loaner: false };
    return { spec: loanerFor(t.week), loaner: true };
  }

  /** Use one of today's entries (free, or the extra one from the video). */
  enterTournament(): boolean {
    const t = syncTournament(this.save, this.tourDay());
    const who = this.tourFighter({ ...t, run: null });
    if (!enterTournament(this.save, who.spec.id, who.loaner)) return false;
    track('tournament_enter', { week: t.week, loaner: who.loaner });
    this.persist(true);
    return true;
  }

  /** "Watch ad: extra entry": one more entry today (the browser version has no ads: it is simply given there). */
  async tournamentAdEntry(): Promise<boolean> {
    if (!adEntryOffered(syncTournament(this.save, this.tourDay()))) return false;
    if (isNative && !(await this.rewarded('tourentry'))) return false;
    grantAdEntry(syncTournament(this.save, this.tourDay()));
    this.persist(true);
    return true;
  }

  /** The run's next fight is starting: the fighter and the step. From now until its result, closing the app loses it. */
  startTournamentFight(): { me: FighterSpec; step: TourStep } | null {
    const t = syncTournament(this.save, this.tourDay());
    const step = nextTourStep(t);
    if (!step) return null;
    const me = this.tourFighter(t).spec;
    markLive(t);
    this.persist(true);
    return { me, step };
  }

  /** Claim a weekly prize tier (once a week each). */
  claimTournamentTier(tier: number): TourTier | null {
    syncTournament(this.save, this.tourDay());
    const r = claimTourTier(this.save, tier);
    if (!r) return null;
    addCash(this.save, r.cash);
    addGems(this.save, r.gems);
    if (r.pack) this.save.progress.packs.unopened[r.pack]++;
    this.persist(true);
    return r;
  }

  // ---- after a fight -----------------------------------------------------------------------------------------------

  /**
   * Pay out a finished fight. `step` for career fights; null for quick fights and weekly tournament fights (`tour`):
   * smaller rewards, no ladder move. `rounds` is the fight's per-round stats (FightState.stats, [player, opponent])
   * for missions and achievements.
   */
  finishFight(fighterId: string, result: FightResult, seconds: number, step: CareerStep | null, opp: FighterSpec, difficulty: number, rounds?: readonly (readonly [RoundStats, RoundStats])[], tour: TourFightDone | null = null): FightRewards {
    const won = result.winner === 0;
    const draw = result.winner === null;
    const method = result.method;
    let r: CareerReward;
    if (step) {
      r = careerReward(step, won, draw, method);
      applyCareerResult(this.save.progress.career, step, won, draw, method);
    } else {
      const cash = won ? (method === 'DEC' ? 250 : 375) : 100;
      r = { cash, xp: won ? 60 : 30, gems: 0, pack: null, belt: false, legacy: [] };
    }
    // the difficulty setting: harder pays more per win, Easy less (meta/difficulty.ts)
    if (won) r = { ...r, cash: winCash(r.cash, this.save.settings.difficulty), xp: winXp(r.xp, this.save.settings.difficulty) };
    const tournament = !step && tour ? applyTourResult(this.save, tour.step, { won, method, ticks: tour.ticks, maxTicks: tour.maxTicks, damageTaken: tour.damageTaken }, draw) : null;
    const mode = step ? 'career' : tour ? 'tournament' : 'quick';
    addCash(this.save, r.cash);
    addGems(this.save, r.gems);
    const o = this.save.progress.fighters.owned[fighterId];
    const levels = o ? addXp(o, r.xp) : 0;
    if (r.pack) this.save.progress.packs.unopened[r.pack]++;
    const seasonXp = addSeasonXp(this.save, fightXp(won ? 120 : 60), Date.now(), 'fight');
    this.save.fights++;
    if (won) this.save.wins++;
    this.save.fightLog.push({ t: Date.now(), k: mode, o: step?.opponent.id ?? (tour ? tour.step.opponent.id.slice(0, 40) : 'quick'), r: won ? 'W' : draw ? 'D' : 'L', m: method, s: Math.round(seconds) });
    if (this.save.fightLog.length > 50) this.save.fightLog.splice(0, this.save.fightLog.length - 50);
    countFight(this.save.ads, seconds);
    const rec = this.save.progress.record;
    const before = rec.best;
    const score = recordFight(rec, result, seconds, overall(opp.stats), difficulty, this.save.settings.difficulty);
    const facts = fightFacts(result, rounds, rosterFighter(fighterId)?.division ?? opp.division, !!step);
    const earned = this.earn({ kind: 'fight', fight: facts }, { fight: facts });
    this.persist(true);
    // Play Games keeps each player's best, so posting every time is safe (Easy wins don't count on the boards)
    const boards = boardCounts(rec, this.save.wins);
    submitScore('wins', boards.wins);
    submitScore('knockouts', boards.knockouts);
    if (score > 0) submitScore('weekly', score);
    if (tournament && tournament.total > 0) submitScore('tournament', tournament.total);
    track('fight_end', { mode, tier: step?.tier ?? -1, result: won ? 'W' : draw ? 'D' : 'L', method, secs: Math.round(seconds), fights: this.save.fights });
    return { cash: r.cash, xp: r.xp, gems: r.gems, levels, seasonXp, pack: r.pack, belt: r.belt, doubleOffer: Math.min(TUNING.doubleCashCap, r.cash), score, best: score > before, legacy: r.legacy.map(i => LEGACY[i]?.name ?? '').filter(Boolean), tournament, earned };
  }

  /**
   * Show the Starter Pack offer by itself? At most once a day, after the player has had a few fights, only while it
   * can be bought and isn't owned. Marks today as shown when it says yes.
   */
  starterOfferDue(storeOpen: boolean): boolean {
    const today = dayNumber(rewardTime());
    if (!storeOpen || this.save.flags.starterPack || this.save.fights < 3 || this.save.offerDay >= today) return false;
    this.save.offerDay = today;
    this.persist();
    return true;
  }

  /** "Watch ad: double cash" after a fight. */
  async doubleCash(amount: number): Promise<boolean> {
    if (!(await this.rewarded('double'))) return false;
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
      track('ad_shown', { format: 'interstitial' });
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
    const earned = this.earn({ kind: 'pack', count: 1 });
    this.persist(true);
    return { ok: true, ...r, earned };
  }

  /** Open an earned pack (never gated: it was not bought). */
  openEarned(id: PackId): BuyPackResult {
    if (this.save.progress.packs.unopened[id] <= 0) return { ok: false, reason: 'funds' };
    this.save.progress.packs.unopened[id]--;
    const r = this.open(id);
    const earned = this.earn({ kind: 'pack', count: 1 });
    this.persist(true);
    return { ok: true, ...r, earned };
  }

  freePackAvailable(): boolean {
    return this.save.progress.packs.freeDay < dayNumber(rewardTime());
  }

  /** The free daily pack: watch an ad, get a Standard Pack to open. */
  async claimFreePack(): Promise<boolean> {
    if (!this.freePackAvailable()) return false;
    // the browser version has no ads: the daily pack is simply free there
    if (isNative && !(await this.rewarded('freepack'))) return false;
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
    this.checkEarned();
    this.persist(true);
    return { day, ...r };
  }

  claimSeason(track: 'free' | 'prem', tier: number): SeasonReward | null {
    const r = claimTier(this.save, track, tier);
    if (r) {
      this.checkEarned();
      this.persist(true);
    }
    return r;
  }

  // ---- purchases -------------------------------------------------------------------------------------------------

  /** Buy a Play product: grant first, persist, then acknowledge / consume. */
  async buyProduct(id: string): Promise<'purchased' | 'pending' | 'cancelled' | 'failed' | 'unavailable'> {
    if (!isNative) return 'unavailable';
    const r = await buy(id);
    if (r.status !== 'purchased') return r.status === 'owned' || r.status === 'busy' ? 'failed' : r.status;
    const g = applyPurchase(this.save, r.purchase, amounts());
    if (g.granted) track('purchase', { id, fights: this.save.fights });
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
