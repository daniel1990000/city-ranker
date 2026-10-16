// The App: renderer, main loop, navigation between menus and fights. The 3D backdrop of every menu is a live AI
// sparring session in a random venue; a fight replaces it while it runs.

import * as THREE from 'three';
import { FightSession, type FightOutcome } from './app/fightSession';
import { Game, type FightRewards } from './app/game';
import { stepFight } from './game/fight';
import { __test as simTest } from './game/fight/sim';
import { NO_INPUT, type DivisionId, type FighterSpec } from './game/fight/types';
import type { CareerStep } from './meta/career';
import { DIVISION_IDS, division } from './meta/divisions';
import { generateName } from './meta/names';
import { baseStats, rosterOf } from './meta/roster';
import { lookFromSeed } from './render/fighter/look';
import { loadFighterBodies } from './render/fighter/fighterView';
import { setPortraitRenderer } from './render/portraits';
import { VENUE_IDS, type VenueId } from './render/arena/venues';
import { careerScreen, dailyModal, fighterScreen, fightersScreen, hubScreen, packsScreen, revealModal, seasonScreen, settingsScreen, shopScreen, type MenuCtx, type Route } from './ui/menus';
import { buildSettings } from './ui/settings';
import { sound } from './audio/sound';
import { AutoQuality } from './render/autoQuality';

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
  private autoQ: AutoQuality;
  private route: Route = { s: 'hub' };
  private history: Route[] = [];
  private qaSpeedValue = 1;
  private ctx: MenuCtx;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.game = new Game();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
      settings: () => buildSettings(this.game, m => this.toast(m)),
    };
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
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > 1e-3) {
      this.renderer.setPixelRatio(ratio);
      this.resize();
    }
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
  }

  private loop(t: number): void {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const s = this.session ?? this.attract;
    if (!s) return;
    s.frame(dt);
    this.renderer.render(s.threeScene, s.camera);
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
    this.render();
  }

  private back(): void {
    this.route = this.history.pop() ?? { s: 'hub' };
    this.render();
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
    const me = this.game.pickedFor(div);
    const step = this.game.careerStep(div);
    if (!me || !step) return;
    const spec = this.game.spec(me.id) as FighterSpec;
    const venue: VenueId = VENUE_IDS[Math.min(VENUE_IDS.length - 1, step.tier + (step.kind === 'title' || step.kind === 'defense' ? 1 : 0))];
    await this.startFight(spec, step.opponent, step.seed ^ Math.imul(this.game.save.fights + 1, 2654435761), venue, step.difficulty, step.rules, step, !this.game.save.flags.tutorialDone);
  }

  private async startQuick(div: DivisionId): Promise<void> {
    const me = this.game.pickedFor(div) ?? this.game.pickedFor(this.game.mainDivision());
    if (!me) return;
    const spec = this.game.spec(me.id) as FighterSpec;
    const seed = (((Date.now() / 1000) | 0) ^ Math.imul(this.game.save.fights + 1, 7919)) >>> 0;
    const o = this.game.save.progress.fighters.owned[me.id];
    const opp = quickOpponent(seed, me.division, (o?.level ?? 1) / 3 - 2);
    await this.startFight(spec, opp, seed, VENUE_IDS[seed % VENUE_IDS.length], 380 + Math.min(400, this.game.save.wins * 8), { rounds: 3, roundTicks: 75 * 60 }, null);
  }

  private async startFight(me: FighterSpec, opp: FighterSpec, seed: number, venue: VenueId, difficulty: number, rules: CareerStep['rules'], step: CareerStep | null, tutorial = false): Promise<void> {
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
        showHints: this.game.save.fights < 2,
        tutorial,
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
    session.onEnd = o => this.afterFight(me, o, step);
    session.onPause = () => this.showPause();
    session.onEvents = (ev, crowd) => {
      sound.onFightEvents(ev);
      sound.setCrowd(0.25 + crowd * 0.65);
    };
    this.attract?.dispose();
    this.attract = null;
    this.session = session;
  }

  private showPause(): void {
    if (!this.session || this.overlay) return;
    this.session.setPaused(true);
    const p = document.createElement('div');
    p.className = 'modal-back';
    p.innerHTML = `<div class="modal panel"><h2>Paused</h2><div class="row"><button class="btn" data-a="resume">Resume</button><button class="btn ghost" data-a="quit">Forfeit</button></div></div>`;
    p.querySelector('[data-a=resume]')?.addEventListener('click', () => {
      p.remove();
      this.overlay = null;
      this.session?.setPaused(false);
    });
    p.querySelector('[data-a=quit]')?.addEventListener('click', () => {
      p.remove();
      this.overlay = null;
      void this.leaveFight();
    });
    this.ui.appendChild(p);
    this.overlay = p;
  }

  private async leaveFight(): Promise<void> {
    sound.setCrowd(0);
    this.session?.dispose();
    this.session = null;
    await this.startAttract();
    this.render();
  }

  private afterFight(me: FighterSpec, o: FightOutcome, step: CareerStep | null): void {
    const seconds = o.result.totalTicks / 60;
    const rewards = this.game.finishFight(me.id, o.result, seconds, step);
    this.showRewards(o, rewards, step);
  }

  private showRewards(o: FightOutcome, r: FightRewards, step: CareerStep | null): void {
    const won = o.result.winner === 0;
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

  /** Android back button: pause a fight, close a modal, go back a screen. */
  backButton(): void {
    if (this.session) {
      this.showPause();
      return;
    }
    const modal = this.ui.querySelector('.modal-back, .reveal');
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
      f.state.ground.sub = { atk: top, kind: sub, progress: 5000, tick: 0 };
      f.state.fighters[top].action = sub === 'armbar' ? 'subArmbarAtk' : 'subChokeAtk';
      f.state.fighters[top === 0 ? 1 : 0].action = sub === 'armbar' ? 'subArmbarDef' : 'subChokeDef';
    }
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
