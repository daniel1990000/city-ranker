// The App: renderer, main loop, navigation between menus and fights. The 3D backdrop of every menu is a live AI
// sparring session in a random venue; a fight replaces it while it runs.

import * as THREE from 'three';
import { FightSession, type FightOutcome } from './app/fightSession';
import { Game, type FightRewards, type TourFightDone } from './app/game';
import { stepFight } from './game/fight';
import { __test as simTest } from './game/fight/sim';
import { NO_INPUT, type DivisionId, type FighterSpec } from './game/fight/types';
import type { CareerStep } from './meta/career';
import type { TourStep } from './meta/tournament';
import { tournamentScreen } from './ui/tournament';
import { DIVISION_IDS, division } from './meta/divisions';
import { generateName } from './meta/names';
import { baseStats, rosterOf } from './meta/roster';
import { lookFromSeed } from './render/fighter/look';
import { loadFighterBodies } from './render/fighter/fighterView';
import { setPortraitRenderer } from './render/portraits';
import { VENUE_IDS, type VenueId } from './render/arena/venues';
import { careerScreen, dailyModal, fighterScreen, fightersScreen, hubScreen, packsScreen, revealModal, seasonScreen, settingsScreen, shopScreen, type MenuCtx, type Route } from './ui/menus';
import { buildSettings } from './ui/settings';
import { achievementsScreen, earnedMessages } from './ui/achievements';
import { missionsPanel } from './ui/missions';
import { practiceScreen, PracticeHud } from './ui/practice';
import { buildMoveList } from './ui/fight/movelist';
import { PracticeRoom, PRACTICE_RULES, practicePartner, type PracticeOptions } from './app/practice';
import { DUMMY_LABEL } from './app/dummy';
import { effectiveDifficulty } from './meta/difficulty';
import { sound } from './audio/sound';
import { AutoQuality } from './render/autoQuality';
import { Post } from './render/post/post';
import { setEnvRenderer } from './render/env';
import { requestReminderPermission } from './platform/notify';
import { priceOf, storeAvailable } from './platform/iap';
import { PRODUCTS } from './meta/products';
import { TUNING } from './meta/tuning';
import { showBoards } from './platform/games';
import { cloudSync, type ServiceHooks } from './app/services';
import { haptic, isNative, keepAwake, requestReview } from './platform/platform';
import type { SaveData } from './meta/save';

const ARCHS = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'] as const;

/** A quick-fight opponent: an original journeyman near the player's level. */
function quickOpponent(seed: number, div: DivisionId, level: number): FighterSpec {
  const arch = ARCHS[seed % ARCHS.length];
  const s = baseStats(arch, 'common', div, seed);
  for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] = Math.max(1, Math.min(99, Math.round(s[k] + level)));
  const sex = division(div).sex;
  const n = generateName(seed, sex);
  return { id: `qf-${seed}`, name: n.name, nickname: n.nickname, division: div, archetype: arch, rarity: 'common', stats: s, lookSeed: seed % 100000, lookHints: { sex, beard: seed % 3 === 0, tattoos: seed % 4 === 1 } };
}

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly game: Game;
  private ui: HTMLElement;
  private session: FightSession | null = null;
  private attract: FightSession | null = null;
  private last = performance.now();
  private screenEl: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private quality: 'low' | 'high' = 'high';
  private post: Post;
  private autoQ: AutoQuality;
  private route: Route = { s: 'hub' };
  private history: Route[] = [];
  private qaSpeedValue = 1;
  private ctx: MenuCtx;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.game = new Game();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.post = new Post(this.renderer, 'off');
    setEnvRenderer(this.renderer);
    this.autoQ = new AutoQuality(() => this.game.save.settings.autoTier, () => {
      this.game.persist();
      this.applyQuality();
    });
    this.applyQuality();
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setPortraitRenderer(this.renderer);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(t => this.loop(t));
    this.ctx = {
      game: this.game,
      nav: r => this.nav(r),
      back: () => this.back(),
      toast: m => this.toast(m),
      startCareer: d => void this.startCareer(d),
      startQuick: d => void this.startQuick(d),
      startPractice: o => void this.startPractice(o),
      startTournament: () => void this.startTournament(),
      settings: () => buildSettings(this.game, m => this.toast(m)),
      boards: () => void this.openBoards(),
      offerReminders: () => this.offerReminders(),
      showMissions: () => this.showMissions(),
    };
    // an achievement or a finished mission (already paid): a toast each, one after the other
    this.game.onEarned(e => {
      const msgs = earnedMessages(e);
      if (!msgs.length) return;
      sound.play(e.achievements.length ? 'achievement' : 'mission', { bus: 'music' });
      msgs.forEach((m, i) => setTimeout(() => this.toast(m), i * 1500));
    });
    this.game.onChange(() => {
      this.refreshWallet();
      this.applyVolumes();
    });
    // every menu button clicks
    ui.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('button')) sound.play('click', { gain: 0.6 });
    });
  }

  /** Scene detail and render resolution from the setting (Auto: from the device, then from measured frame rate).
   *  Resolution applies at once; scene detail from the next fight. */
  private applyQuality(): void {
    const st = this.game.save.settings;
    const auto = st.quality === 'auto';
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4 && Math.min(screen.width, screen.height) * devicePixelRatio < 900;
    const tier = auto ? st.autoTier.q || (lowEnd ? 'low' : 'high') : st.quality;
    this.quality = tier === 'low' ? 'low' : 'high';
    const cap = tier === 'low' ? 1.25 : tier === 'medium' ? 1.5 : 2;
    const ratio = Math.min(cap, devicePixelRatio) * (auto ? st.autoTier.res : 1);
    // the broadcast finish: none on low, grade + smoothing on medium, + glow and multisampling on high (a phone
    // that auto quality had to slow down gets medium)
    const postTier = tier === 'low' ? 'off' : tier === 'medium' || (auto && st.autoTier.res < 0.9) ? 'medium' : 'high';
    if (postTier !== this.post.tier) {
      this.post.setTier(postTier);
      this.resize();
    }
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 1e-3) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
  }

  private async openBoards(): Promise<void> {
    if (!isNative) {
      this.toast('Leaderboards are in the Android app');
      return;
    }
    if (await showBoards()) void cloudSync()?.start();
    else this.toast('Could not open Google Play Games');
  }

  /** Once, on the phone: "remind me when tomorrow's free pack is ready?" (opt-in; Android asks for permission). */
  private offerReminders(): void {
    const f = this.game.save.flags;
    if (!isNative || f.remindAsked || this.game.save.settings.reminders) return;
    f.remindAsked = true;
    this.game.persist();
    const p = document.createElement('div');
    p.className = 'modal-back';
    p.innerHTML = `<div class="modal panel"><h2>Get a reminder?</h2><p class="muted">We can let you know when tomorrow's free pack is ready and when training finishes. You can turn this off in Settings.</p>
      <div class="row"><button class="btn" data-a="yes">Remind me</button><button class="btn ghost" data-a="no">No thanks</button></div></div>`;
    p.querySelector('[data-a=no]')?.addEventListener('click', () => p.remove());
    p.querySelector('[data-a=yes]')?.addEventListener('click', () => {
      p.remove();
      void requestReminderPermission().then(ok => {
        this.game.save.settings.reminders = ok;
        this.game.persist();
        this.toast(ok ? 'Reminders on' : 'Notifications are off for Cage Kings in your phone settings');
      });
    });
    this.ui.appendChild(p);
  }

  /** "Load your cloud progress?" when the Play Games copy holds more than this phone. */
  askCloudRestore(cloud: SaveData, local: SaveData): Promise<boolean> {
    return new Promise(resolve => {
      const p = document.createElement('div');
      p.className = 'modal-back';
      p.dataset.sticky = '1';
      const line = (d: SaveData) => `${d.fights.toLocaleString('en-US')} fights · ${d.wins.toLocaleString('en-US')} wins · ${Object.keys(d.progress.fighters.owned).length} fighters`;
      p.innerHTML = `<div class="modal panel"><h2>Saved progress found</h2><p class="muted">Your Google Play Games account has progress from another phone.</p>
        <p><b>Cloud:</b> ${line(cloud)}<br><b>This phone:</b> ${line(local)}</p>
        <div class="row"><button class="btn" data-a="yes">Load cloud progress</button><button class="btn ghost" data-a="no">Keep this phone's</button></div></div>`;
      const done = (yes: boolean) => {
        p.remove();
        resolve(yes);
        if (yes) {
          // the cloud save is in place once the promise has been handled
          setTimeout(() => {
            if (!this.session) this.render();
            this.toast('Cloud progress loaded');
          }, 0);
        }
      };
      p.querySelector('[data-a=yes]')?.addEventListener('click', () => done(true));
      p.querySelector('[data-a=no]')?.addEventListener('click', () => done(false));
      this.ui.appendChild(p);
    });
  }

  private applyVolumes(): void {
    const s = this.game.save.settings;
    sound.setVolume('sfx', s.sfx);
    sound.setVolume('music', s.music);
    sound.setVolume('crowd', s.sfx * 0.8);
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.session?.resize(innerWidth, innerHeight);
    this.attract?.resize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight);
  }

  private loop(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const s = this.session ?? this.attract;
    if (!s) return;
    s.frame(dt);
    this.post.render(s.threeScene, s.camera, dt);
    if (this.session?.live && this.game.save.settings.quality === 'auto' && !document.hidden) this.autoQ.frame(dt);
  }

  async boot(progress: (p: number) => void): Promise<void> {
    progress(0.1);
    await sound.init().catch(() => {});
    this.applyVolumes();
    progress(0.2);
    await loadFighterBodies();
    progress(0.6);
    await this.startAttract();
    progress(1);
    this.render();
    const daily = dailyModal(this.ctx, () => this.render());
    if (daily) this.ui.appendChild(daily);
  }

  // ---- menus --------------------------------------------------------------------------------------------------------

  private nav(r: Route): void {
    // re-rendering the same screen (after an action) does not add to the history
    if (r.s !== this.route.s) this.history.push(this.route);
    this.route = r;
    sound.setMusic(true);
    this.render();
  }

  private back(): void {
    this.route = this.history.pop() ?? { s: 'hub' };
    this.render();
    this.maybeOffer();
  }

  private render(): void {
    this.screenEl?.remove();
    const r = this.route;
    const g = this.game;
    let el: HTMLElement;
    switch (r.s) {
      case 'hub':
        el = hubScreen(this.ctx);
        this.history = [];
        break;
      case 'career':
        el = careerScreen(this.ctx, r.div ?? g.mainDivision());
        break;
      case 'fighters':
        el = fightersScreen(this.ctx, r.div ?? 'all');
        break;
      case 'fighter':
        el = fighterScreen(this.ctx, r.id);
        break;
      case 'packs':
        el = packsScreen(this.ctx, this.ui);
        break;
      case 'shop':
        el = shopScreen(this.ctx);
        break;
      case 'season':
        el = seasonScreen(this.ctx);
        break;
      case 'settings':
        el = settingsScreen(this.ctx);
        break;
      case 'achievements':
        el = achievementsScreen(this.ctx);
        break;
      case 'practice':
        el = practiceScreen(this.ctx);
        break;
      case 'tournament':
        el = tournamentScreen(this.ctx);
        break;
    }
    this.screenEl = el;
    this.ui.appendChild(el);
  }

  private refreshWallet(): void {
    const w = this.screenEl?.querySelector('.wallet');
    if (!w) return;
    const [c, gm] = w.querySelectorAll('span');
    if (c) c.textContent = this.game.cash.toLocaleString('en-US');
    if (gm) gm.textContent = this.game.gems.toLocaleString('en-US');
  }

  /** Today's daily missions as a card over the current screen. */
  private showMissions(): void {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const card = document.createElement('div');
    card.className = 'modal missions-modal';
    card.appendChild(missionsPanel(this.ctx));
    const ok = document.createElement('button');
    ok.className = 'btn';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => back.remove());
    card.appendChild(ok);
    back.appendChild(card);
    back.addEventListener('click', e => {
      if (e.target === back) back.remove();
    });
    this.ui.appendChild(back);
  }

  toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }

  // ---- the backdrop -----------------------------------------------------------------------------------------------

  private async startAttract(): Promise<void> {
    const seed = (Date.now() / 1000) | 0;
    const div = DIVISION_IDS[seed % 4];
    const pool = rosterOf(div);
    const a = pool[seed % pool.length];
    const b = pool[(seed + 3) % pool.length];
    const ui = document.createElement('div');
    this.attract = await FightSession.start(
      {
        seed,
        player: a,
        opponent: b,
        looks: [lookFromSeed(a.lookSeed, a.lookHints, div), lookFromSeed(b.lookSeed, b.lookHints, div)],
        venue: VENUE_IDS[seed % VENUE_IDS.length],
        difficulty: 700,
        quality: this.quality,
        showHints: false,
        autoplay: true,
        rules: { roundTicks: 60 * 60 * 30, introTicks: 1 },
        silent: true,
      },
      ui,
    );
    this.attract.speed = this.qaSpeedValue;
    this.attract.resize(innerWidth, innerHeight);
  }

  // ---- fights ----------------------------------------------------------------------------------------------------

  private async startCareer(div: DivisionId): Promise<void> {
    const me = this.game.careerFighter(div);
    const step = this.game.careerStep(div);
    if (!me || !step) return;
    const spec = this.game.careerSpec(div) as FighterSpec;
    const venue: VenueId = VENUE_IDS[Math.min(VENUE_IDS.length - 1, step.tier + (step.kind === 'title' || step.kind === 'defense' || step.kind === 'super' ? 1 : 0))];
    const difficulty = effectiveDifficulty(step.difficulty, this.game.save.settings.difficulty);
    await this.startFight(spec, step.opponent, step.seed ^ Math.imul(this.game.save.fights + 1, 2654435761), venue, difficulty, step.rules, step, !this.game.save.flags.tutorialDone);
  }

  private async startQuick(div: DivisionId): Promise<void> {
    const me = this.game.pickedFor(div) ?? this.game.pickedFor(this.game.mainDivision());
    if (!me) return;
    const spec = this.game.spec(me.id) as FighterSpec;
    const seed = (((Date.now() / 1000) | 0) ^ Math.imul(this.game.save.fights + 1, 7919)) >>> 0;
    const o = this.game.save.progress.fighters.owned[me.id];
    const opp = quickOpponent(seed, me.division, (o?.level ?? 1) / 3 - 2);
    const difficulty = effectiveDifficulty(380 + Math.min(400, this.game.save.wins * 8), this.game.save.settings.difficulty);
    await this.startFight(spec, opp, seed, VENUE_IDS[seed % VENUE_IDS.length], difficulty, { rounds: 3, roundTicks: 75 * 60 }, null);
  }

  /** Training Room: the player's fighter against the sparring partner. No rewards, nothing saved. */
  private async startPractice(o: PracticeOptions): Promise<void> {
    const pick = (o.fighterId && this.game.owned(o.fighterId) ? o.fighterId : null) ?? this.game.pickedFor(this.game.mainDivision())?.id;
    const spec = pick ? this.game.spec(pick) : null;
    if (!spec) return;
    const room = new PracticeRoom(o);
    const seed = ((Date.now() / 1000) | 0) >>> 0;
    await this.startFight(spec, practicePartner(spec.division), seed, 'gym', 0, PRACTICE_RULES, null, false, room);
  }

  /** The weekly tournament run's next round (the fight counts as lost if the app is closed before the result). */
  private async startTournament(): Promise<void> {
    const t = this.game.startTournamentFight();
    if (!t) return;
    this.pendingTour = t.step;
    // the bracket's venues: a bigger arena each round
    const venue = VENUE_IDS[Math.min(VENUE_IDS.length - 1, 2 + t.step.round)];
    await this.startFight(t.me, t.step.opponent, t.step.seed, venue, t.step.difficulty, t.step.rules, null);
  }
  /** Set by startTournament for the fight startFight is about to start. */
  private pendingTour: TourStep | null = null;

  private async startFight(me: FighterSpec, opp: FighterSpec, seed: number, venue: VenueId, difficulty: number, rules: CareerStep['rules'], step: CareerStep | null, tutorial = false, practice: PracticeRoom | null = null): Promise<void> {
    sound.setMusic(false);
    this.screenEl?.remove();
    this.screenEl = null;
    this.applyQuality();
    this.autoQ.reset();
    const loading = document.createElement('div');
    loading.className = 'modal-back';
    loading.innerHTML = `<div class="logo" style="font-size:30px">${(me.name.split(' ').pop() ?? '').toUpperCase()} <b>vs</b> ${(opp.name.split(' ').pop() ?? '').toUpperCase()}</div>`;
    this.ui.appendChild(loading);
    const session = await FightSession.start(
      {
        seed: seed >>> 0,
        player: me,
        opponent: opp,
        looks: [lookFromSeed(me.lookSeed, me.lookHints, me.division), lookFromSeed(opp.lookSeed, opp.lookHints, opp.division)],
        venue,
        difficulty,
        rules,
        quality: this.quality,
        showHints: !practice && this.game.save.fights < 2,
        tutorial: tutorial && !practice,
        practice: practice ?? undefined,
        leftHanded: this.game.save.settings.leftHanded,
        reducedMotion: this.game.save.settings.reducedMotion,
        commentary: this.game.save.settings.commentary,
      },
      this.ui,
    );
    session.onTutorialDone = () => {
      this.game.save.flags.tutorialDone = true;
      this.game.persist();
    };
    loading.remove();
    session.resize(innerWidth, innerHeight);
    session.speed = this.qaSpeedValue;
    if (this.qaAuto) session.setAutoplay(true);
    const tour = this.pendingTour;
    this.pendingTour = null;
    session.onEnd = o => (practice ? this.practiceEnd(o, practice) : this.afterFight(me, opp, difficulty, o, step, tour));
    if (practice) {
      const hud = new PracticeHud(this.ui, practice.run, DUMMY_LABEL[practice.mode], () => this.toggleMoveList());
      practice.onChange = kind => {
        hud.update(kind);
        hud.setMode(DUMMY_LABEL[practice.mode]);
      };
      this.practiceHud = hud;
    }
    this.practice = practice;
    session.onPause = () => this.showPause();
    session.onEvents = (ev, crowd) => {
      sound.onFightEvents(ev);
      sound.setCrowd(0.25 + crowd * 0.65);
      for (const e of ev) {
        if (e.type === 'knockdown') {
          haptic('heavy');
          if (!this.game.save.settings.reducedMotion) this.post.kick(0.35);
        }
        else if (e.type === 'hit' && !e.blocked && e.strength === 'heavy') haptic(e.side === 0 ? 'light' : 'medium');
        else if (e.type === 'fightEnd' && e.result.winner === 0) haptic('success');
      }
    };
    this.attract?.dispose();
    this.attract = null;
    this.session = session;
    keepAwake(true);
  }

  private showPause(): void {
    if (!this.session || this.overlay) return;
    this.session.setPaused(true);
    const p = document.createElement('div');
    p.className = 'modal-back';
    const quit = this.practice ? 'Leave practice' : 'Retire (counts as a loss)';
    p.innerHTML = `<div class="modal panel"><h2>${this.practice ? 'Practice paused' : 'Paused'}</h2><div class="row" style="flex-wrap:wrap"><button class="btn" data-a="resume">Resume</button><button class="btn ghost" data-a="moves">Move list</button><button class="btn ghost" data-a="quit">${quit}</button></div></div>`;
    p.querySelector('[data-a=moves]')?.addEventListener('click', () => {
      p.hidden = true;
      this.openMoveList(() => (p.hidden = false));
    });
    p.querySelector('[data-a=resume]')?.addEventListener('click', () => {
      p.remove();
      this.overlay = null;
      this.session?.setPaused(false);
    });
    p.querySelector('[data-a=quit]')?.addEventListener('click', () => {
      p.remove();
      this.overlay = null;
      // retiring is a loss (otherwise a losing title defence could be quit to keep the belt); practice just ends
      if (this.practice) void this.leaveFight();
      else if (this.session && !this.session.fight.state.result) this.session.forfeit();
      else void this.leaveFight();
    });
    this.ui.appendChild(p);
    this.overlay = p;
  }

  private async leaveFight(): Promise<void> {
    this.endSession();
    keepAwake(false);
    await this.startAttract();
    this.render();
  }

  /** Tear down the running fight (and its practice layer). */
  private endSession(): void {
    this.moveList?.remove();
    this.moveList = null;
    this.practiceHud?.dispose();
    this.practiceHud = null;
    this.practice = null;
    sound.setCrowd(0);
    this.session?.dispose();
    this.session = null;
  }

  private practice: PracticeRoom | null = null;
  private practiceHud: PracticeHud | null = null;
  private moveList: HTMLElement | null = null;

  /** The move list over the fight (the fight stays paused while it is open). */
  private openMoveList(onClose: () => void = () => {}): void {
    if (!this.session || this.moveList) return;
    const wasPaused = !!this.overlay;
    this.session.setPaused(true);
    const spec = this.session.setup.player;
    const list = buildMoveList({ leftHanded: this.game.save.settings.leftHanded, fighter: spec, keys: matchMedia('(pointer: fine)').matches }, () => {
      this.moveList = null;
      if (!wasPaused && !this.overlay) this.session?.setPaused(false);
      onClose();
    });
    this.moveList = list;
    this.ui.appendChild(list);
  }

  /** The MOVES button in practice: open or close the list. */
  private toggleMoveList(): void {
    if (this.moveList) (this.moveList.querySelector('[data-a=close]') as HTMLButtonElement | null)?.click();
    else if (!this.overlay) this.openMoveList();
  }

  /** A practice fight ended (a knockout or a submission): go again from the same drill step, or leave. */
  private practiceEnd(o: FightOutcome, room: PracticeRoom): void {
    const r = o.result;
    const won = r.winner === 0;
    const what = r.method === 'SUB' ? 'Submission' : r.method === 'DEC' ? 'Time' : r.method === 'KO' ? 'Knockout' : 'Stoppage';
    const p = document.createElement('div');
    p.className = 'modal-back';
    p.dataset.sticky = '1';
    const drillDone = room.run?.done;
    p.innerHTML = `<div class="modal panel" style="text-align:center"><h2>${what}${won ? '!' : ''}</h2>
      <p class="muted">${drillDone ? 'Drill complete. ' : ''}${won ? 'You finished the sparring partner.' : 'The sparring partner got you.'} It's only practice: nothing is saved.</p>
      <div class="row" style="justify-content:center"><button class="btn" data-a="again">Go again</button><button class="btn ghost" data-a="leave">Leave</button></div></div>`;
    const opts: PracticeOptions = { ...room.options, drillStep: room.run && !room.run.done ? room.run.step : 0 };
    p.querySelector('[data-a=again]')?.addEventListener('click', () => {
      p.remove();
      // straight into the next one (no menu backdrop in between)
      this.endSession();
      void this.startPractice(opts);
    });
    p.querySelector('[data-a=leave]')?.addEventListener('click', () => {
      p.remove();
      void this.leaveFight();
    });
    this.ui.appendChild(p);
  }

  /** Coming back to the home screen from another menu: the Starter Pack offer may show (once a day at most). */
  private maybeOffer(): void {
    if (this.route.s === 'hub' && !this.session && !this.ui.querySelector('.modal-back') && this.game.starterOfferDue(storeAvailable())) this.showStarterOffer();
  }

  /** The Starter Pack offer card (once a day at most, never in a fight). */
  private showStarterOffer(): void {
    const p = document.createElement('div');
    p.className = 'modal-back';
    const price = priceOf(PRODUCTS.starter) ?? '';
    p.innerHTML = `<div class="modal panel"><h2>Starter Pack</h2><p class="muted">One time only</p>
      <ul style="text-align:left;margin:6px 0 12px"><li>No more ad breaks</li><li>This month's Season Pass</li><li>${TUNING.starterGems} gems and ${TUNING.starterCash.toLocaleString('en-US')} cash</li></ul>
      <div class="row"><button class="btn" data-a="buy">${price || 'Buy'}</button><button class="btn ghost" data-a="no">Not now</button></div></div>`;
    p.querySelector('[data-a=no]')?.addEventListener('click', () => p.remove());
    p.querySelector('[data-a=buy]')?.addEventListener('click', () => {
      p.remove();
      void this.game.buyProduct(PRODUCTS.starter).then(r => {
        if (r === 'purchased') sound.play('buy');
        this.toast(r === 'purchased' ? 'Thank you! Your purchase is ready.' : r === 'pending' ? 'Payment pending: it arrives when Google Play confirms it.' : r === 'cancelled' ? 'Purchase cancelled' : 'The purchase did not go through');
        this.render();
      });
    });
    this.ui.appendChild(p);
  }

  private afterFight(me: FighterSpec, opp: FighterSpec, difficulty: number, o: FightOutcome, step: CareerStep | null, tourStep: TourStep | null = null): void {
    const seconds = o.result.totalTicks / 60;
    const tour: TourFightDone | null = tourStep
      ? { step: tourStep, ticks: o.result.totalTicks, maxTicks: (tourStep.rules.rounds ?? 3) * (tourStep.rules.roundTicks ?? 75 * 60), damageTaken: o.totals.damage[1] }
      : null;
    const rewards = this.game.finishFight(me.id, o.result, seconds, step, opp, difficulty, o.rounds, tour);
    // Google Play's review card after a high point (a title, or the 5th win), once; Play decides if it shows
    const f = this.game.save.flags;
    if (o.result.winner === 0 && !f.ratePrompted && (rewards.belt || this.game.save.wins >= 5)) {
      f.ratePrompted = true;
      this.game.persist();
      setTimeout(() => requestReview(), 1500);
    }
    this.showRewards(o, rewards, step);
  }

  private showRewards(o: FightOutcome, r: FightRewards, step: CareerStep | null): void {
    const won = o.result.winner === 0;
    sound.play(r.belt || r.tournament?.champion ? 'trophy' : won ? 'win' : 'lose', { bus: 'music', gain: 0.8 });
    const t = o.totals;
    const p = document.createElement('div');
    p.className = 'screen result-screen';
    const method = o.result.method === 'DEC' ? `${o.result.decision ?? ''} decision` : o.result.method === 'SUB' ? 'submission' : o.result.method;
    p.innerHTML = `
      <div class="result-card panel">
        <div class="result-head ${won ? 'win' : 'loss'}">${r.belt ? 'New champion!' : won ? 'Victory' : o.result.winner === null ? 'Draw' : 'Defeat'}</div>
        <div class="muted">${method} · round ${o.result.round}${step ? ` · ${step.label}` : ''}</div>
        <table class="stats">
          <tr><td>${t.landed[0]} / ${t.thrown[0]}</td><th>Strikes landed</th><td>${t.landed[1]} / ${t.thrown[1]}</td></tr>
          <tr><td>${t.knockdowns[0]}</td><th>Knockdowns</th><td>${t.knockdowns[1]}</td></tr>
          <tr><td>${t.takedowns[0]}</td><th>Takedowns</th><td>${t.takedowns[1]}</td></tr>
        </table>
        <div class="row" style="justify-content:center;gap:14px;margin-bottom:12px;flex-wrap:wrap">
          <span class="pill"><i class="ico cash"></i>+${r.cash.toLocaleString('en-US')}</span>
          ${r.gems ? `<span class="pill"><i class="ico gem"></i>+${r.gems}</span>` : ''}
          <span class="pill">+${r.xp} xp${r.levels ? ` · level up!` : ''}</span>
          ${r.pack ? `<span class="pill">+1 ${r.pack} pack</span>` : ''}
          ${r.score ? `<span class="pill">Fight score ${r.score.toLocaleString('en-US')}${r.best ? ' · new best!' : ''}</span>` : ''}
          ${r.legacy.map(l => `<span class="pill">Legacy: ${l}</span>`).join('')}
          ${r.tournament ? `<span class="pill">Tournament +${r.tournament.score.toLocaleString('en-US')} pts · run ${r.tournament.total.toLocaleString('en-US')}${r.tournament.champion ? ' · champion!' : r.tournament.out ? ' · out' : ''}</span>` : ''}
        </div>
        <div class="row">
          ${r.doubleOffer > 0 && this.game.rewardedReady() ? `<button class="btn ghost" data-a="double">Watch ad: +${r.doubleOffer.toLocaleString('en-US')} cash</button>` : ''}
          <button class="btn" data-a="next">Continue</button>
        </div>
      </div>`;
    p.querySelector('[data-a=double]')?.addEventListener('click', e => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      void this.game.doubleCash(r.doubleOffer).then(ok => {
        this.toast(ok ? `+${r.doubleOffer.toLocaleString('en-US')} cash` : 'No ad available right now');
        if (ok) b.remove();
        else b.disabled = false;
      });
    });
    p.querySelector('[data-a=next]')?.addEventListener('click', () => {
      p.remove();
      void this.adBreakThen(async () => {
        await this.leaveFight();
        if (r.pack) this.nav({ s: 'packs' });
        else if (step) this.nav({ s: 'career', div: step.div });
        else if (r.tournament) this.nav({ s: 'tournament' });
      });
    });
    this.ui.appendChild(p);
  }

  /** Interstitial pacing: when one is due, an "Ad break" card counts down first. */
  private async adBreakThen(next: () => Promise<void>): Promise<void> {
    if (!this.game.interstitialDue()) {
      await next();
      return;
    }
    const card = document.createElement('div');
    card.className = 'modal-back';
    card.dataset.sticky = '1';
    card.innerHTML = `<div class="modal panel adcard"><h2>Ad break</h2><div class="count">3</div><div class="muted">Thanks for playing for free. Get No Ads in the shop.</div></div>`;
    this.ui.appendChild(card);
    for (let i = 3; i > 0; i--) {
      (card.querySelector('.count') as HTMLElement).textContent = String(i);
      await new Promise(res => setTimeout(res, 800));
    }
    card.remove();
    await this.game.showInterstitial();
    await next();
  }

  /** What the platform services call back into (app/services.ts). */
  serviceHooks(): ServiceHooks {
    return {
      onBack: () => this.backButton(),
      onInterrupt: () => {
        if (this.session && !this.session.fight.state.result) this.showPause();
      },
      askRestore: (c, l) => this.askCloudRestore(c, l),
      refresh: () => {
        if (!this.session) this.render();
      },
      toast: m => this.toast(m),
    };
  }

  /** Android back button: pause a fight, close a modal, go back a screen. */
  backButton(): void {
    if (this.moveList) {
      this.toggleMoveList();
      return;
    }
    if (this.session) {
      this.showPause();
      return;
    }
    // the cloud question and the ad break must be answered / run out, not dismissed
    const modal = this.ui.querySelector('.modal-back:not([data-sticky]), .reveal');
    if (modal) {
      modal.remove();
      return;
    }
    if (this.route.s !== 'hub') this.back();
  }

  // ---- QA hooks (build:qa / dev only) --------------------------------------------------------------------------

  qaSpeed(x: number): void {
    this.qaSpeedValue = x;
    if (this.session) this.session.speed = x;
    if (this.attract) this.attract.speed = x;
  }

  qaGround(pos: 'guard' | 'mount', top: 0 | 1 = 0, sub?: 'armbar' | 'choke'): void {
    const f = this.session?.fight ?? this.attract?.fight;
    if (!f) return;
    while (f.state.phase === 'intro') stepFight(f, [{ ...NO_INPUT }, { ...NO_INPUT }]);
    simTest.enterGround(f, top, pos);
    if (sub && f.state.ground) {
      f.state.ground.sub = { atk: top, kind: sub, progress: 5000, tick: 0, peak: 5000 };
      f.state.fighters[top].action = sub === 'armbar' ? 'subArmbarAtk' : 'subChokeAtk';
      f.state.fighters[top === 0 ? 1 : 0].action = sub === 'armbar' ? 'subArmbarDef' : 'subChokeDef';
    }
  }

  /** QA: try the look live (post tier, environment light strength, exposure). */
  /** QA: how far the full sound bank has got. */
  qaSound(): { built: number; beds: boolean; music: boolean; state: string } {
    return sound.debug();
  }

  qaLook(o: { tier?: 'off' | 'medium' | 'high'; env?: number; bloomK?: number; thresholdK?: number; noGrade?: boolean; noFxaa?: boolean }): void {
    if (o.tier) this.post.setTier(o.tier);
    this.post.debugNoGrade = !!o.noGrade;
    this.post.debugNoFxaa = !!o.noFxaa;
    if (o.bloomK !== undefined) this.post.bloomK = o.bloomK;
    if (o.thresholdK !== undefined) this.post.thresholdK = o.thresholdK;
    this.post.retune();
    this.resize();
    const s = this.session ?? this.attract;
    if (s && o.env !== undefined) s.threeScene.environmentIntensity = o.env;
  }

  qaAutoplay(on: boolean): void {
    this.qaAuto = on;
    this.session?.setAutoplay(on);
  }
  private qaAuto = false;

  qaNav(r: Route): void {
    this.nav(r);
  }

  qaReveal(): void {
    const r = this.game.openEarned('standard');
    if (r.ok) this.ui.appendChild(revealModal(this.ctx, r.result, r.cards, () => this.render()));
  }

  debugState(): unknown {
    return { route: this.route, fight: this.session?.fight.state ?? null, save: this.game.save };
  }
}
