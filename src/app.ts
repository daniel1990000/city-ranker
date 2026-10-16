// The App: renderer, main loop and screens. Screens are small classes with show()/hide(); the App owns the one
// WebGL renderer and whichever 3D scene is live (the title attract fight, or the player's fight).

import * as THREE from 'three';
import { FightSession, type FightOutcome } from './app/fightSession';
import type { Archetype, DivisionId, FighterSpec, FighterStats } from './game/fight/types';
import { lookFromSeed } from './render/fighter/look';
import { loadFighterBodies } from './render/fighter/fighterView';
import { VENUE_IDS, type VenueId } from './render/arena/venues';
import { generateName } from './meta/names';

const ARCHETYPES: Archetype[] = ['brawler', 'boxer', 'kicker', 'wrestler', 'grappler'];
const BASE: Record<Archetype, FighterStats> = {
  brawler: { power: 72, speed: 52, chin: 66, cardio: 52, striking: 62, kicking: 40, wrestling: 42, grappling: 40, submissions: 34, defense: 45 },
  boxer: { power: 58, speed: 70, chin: 55, cardio: 60, striking: 74, kicking: 36, wrestling: 40, grappling: 38, submissions: 32, defense: 62 },
  kicker: { power: 58, speed: 64, chin: 52, cardio: 60, striking: 52, kicking: 76, wrestling: 40, grappling: 42, submissions: 38, defense: 56 },
  wrestler: { power: 56, speed: 56, chin: 60, cardio: 70, striking: 48, kicking: 38, wrestling: 78, grappling: 62, submissions: 46, defense: 52 },
  grappler: { power: 50, speed: 56, chin: 58, cardio: 66, striking: 46, kicking: 42, wrestling: 66, grappling: 76, submissions: 78, defense: 50 },
};

/** A quick-fight opponent or player: original name, archetype stats, a look. */
export function quickFighter(seed: number, division: DivisionId, bonus = 0): FighterSpec {
  const r = (n: number) => (((seed * 2654435761 + n * 40503) >>> 0) % 1000) / 1000;
  const archetype = ARCHETYPES[Math.floor(r(1) * 5)];
  const sex = division.startsWith('w') ? 'f' : 'm';
  const { name, nickname } = generateName(seed, sex);
  const stats = { ...BASE[archetype] };
  for (const k of Object.keys(stats) as (keyof FighterStats)[]) stats[k] = Math.max(1, Math.min(100, stats[k] + bonus + Math.round((r(k.length) - 0.5) * 8)));
  const skins = ['light', 'tan', 'brown', 'dark'] as const;
  return {
    id: `q${seed}`,
    name,
    nickname,
    division,
    archetype,
    rarity: 'common',
    stats,
    lookSeed: seed,
    lookHints: { sex, skin: skins[Math.floor(r(9) * 4)], beard: r(11) < 0.4, tattoos: r(12) < 0.4 },
  };
}

type Screen = 'boot' | 'title' | 'fight' | 'result';

export class App {
  readonly renderer: THREE.WebGLRenderer;
  private ui: HTMLElement;
  private session: FightSession | null = null;
  private attract: FightSession | null = null;
  private screen: Screen = 'boot';
  private last = performance.now();
  private panel: HTMLElement | null = null;
  private quality: 'low' | 'high';
  private fightCount = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.ui = ui;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const lowEnd = (navigator.hardwareConcurrency ?? 4) <= 4 && Math.min(screen.width, screen.height) * devicePixelRatio < 900;
    this.quality = lowEnd ? 'low' : 'high';
    this.renderer.setPixelRatio(Math.min(this.quality === 'low' ? 1.5 : 2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
    addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(t => this.loop(t));
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
  }

  async boot(progress: (p: number) => void): Promise<void> {
    progress(0.2);
    await loadFighterBodies();
    progress(0.7);
    await this.startAttract();
    progress(1);
    this.showTitle();
  }

  /** The title screen backdrop: two AI fighters sparring in a random venue. */
  private async startAttract(): Promise<void> {
    const seed = (Date.now() / 1000) | 0;
    const div: DivisionId = (['mLight', 'mWelter', 'mMiddle', 'mHeavy', 'wBantam'] as DivisionId[])[seed % 5];
    const a = quickFighter(seed, div, 10);
    const b = quickFighter(seed + 1, div, 10);
    const ui = document.createElement('div');
    ui.style.display = 'none';
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
        rules: { roundTicks: 60 * 60 * 10 },
      },
      ui,
    );
    this.attract.resize(innerWidth, innerHeight);
  }

  private clearPanel(): void {
    this.panel?.remove();
    this.panel = null;
  }

  private showTitle(): void {
    this.screen = 'title';
    this.clearPanel();
    const p = document.createElement('div');
    p.className = 'screen title-screen';
    p.innerHTML = `
      <div class="title-top"><div class="logo">Cage <b>Kings</b></div><div class="tag muted">Fight your way to the belt</div></div>
      <div class="title-actions">
        <button class="btn" data-a="fight">Quick fight</button>
      </div>`;
    p.querySelector<HTMLButtonElement>('[data-a=fight]')?.addEventListener('click', () => void this.startFight());
    this.ui.appendChild(p);
    this.panel = p;
  }

  async startFight(): Promise<void> {
    this.clearPanel();
    this.screen = 'fight';
    const seed = ((Date.now() / 1000) | 0) + this.fightCount * 101;
    this.fightCount++;
    const div: DivisionId = 'mWelter';
    const me = quickFighter(seed, div, 6);
    const them = quickFighter(seed + 7, div, 4);
    const venue: VenueId = VENUE_IDS[(seed >> 3) % VENUE_IDS.length];
    const session = await FightSession.start(
      {
        seed,
        player: me,
        opponent: them,
        looks: [lookFromSeed(me.lookSeed, me.lookHints, div), lookFromSeed(them.lookSeed, them.lookHints, div)],
        venue,
        difficulty: 400,
        quality: this.quality,
        showHints: this.fightCount <= 2,
      },
      this.ui,
    );
    session.resize(innerWidth, innerHeight);
    session.onEnd = o => this.showResult(o);
    session.onPause = () => this.showPause();
    this.attract?.dispose();
    this.attract = null;
    session.speed = this.qaSpeedValue;
    this.session = session;
  }

  private showPause(): void {
    if (!this.session || this.panel) return;
    this.session.setPaused(true);
    const p = document.createElement('div');
    p.className = 'modal-back';
    p.innerHTML = `<div class="modal panel"><h2>Paused</h2><div class="row"><button class="btn" data-a="resume">Resume</button><button class="btn ghost" data-a="quit">Quit fight</button></div></div>`;
    p.querySelector('[data-a=resume]')?.addEventListener('click', () => {
      this.clearPanel();
      this.session?.setPaused(false);
    });
    p.querySelector('[data-a=quit]')?.addEventListener('click', () => {
      this.clearPanel();
      this.endSession();
      void this.startAttract().then(() => this.showTitle());
    });
    this.ui.appendChild(p);
    this.panel = p;
  }

  private endSession(): void {
    this.session?.dispose();
    this.session = null;
  }

  private showResult(o: FightOutcome): void {
    this.screen = 'result';
    const won = o.result.winner === 0;
    const p = document.createElement('div');
    p.className = 'screen result-screen';
    const t = o.totals;
    const method = o.result.method === 'DEC' ? `${o.result.decision ?? ''} decision` : o.result.method;
    p.innerHTML = `
      <div class="result-card panel">
        <div class="result-head ${won ? 'win' : 'loss'}">${won ? 'Victory' : o.result.winner === null ? 'Draw' : 'Defeat'}</div>
        <div class="muted">${method} · round ${o.result.round}</div>
        <table class="stats">
          <tr><td>${t.landed[0]} / ${t.thrown[0]}</td><th>Strikes landed</th><td>${t.landed[1]} / ${t.thrown[1]}</td></tr>
          <tr><td>${t.knockdowns[0]}</td><th>Knockdowns</th><td>${t.knockdowns[1]}</td></tr>
          <tr><td>${t.takedowns[0]}</td><th>Takedowns</th><td>${t.takedowns[1]}</td></tr>
        </table>
        <div class="row"><button class="btn" data-a="again">Fight again</button><button class="btn ghost" data-a="menu">Menu</button></div>
      </div>`;
    p.querySelector('[data-a=again]')?.addEventListener('click', () => {
      this.clearPanel();
      this.endSession();
      void this.startFight();
    });
    p.querySelector('[data-a=menu]')?.addEventListener('click', () => {
      this.clearPanel();
      this.endSession();
      void this.startAttract().then(() => this.showTitle());
    });
    this.ui.appendChild(p);
    this.panel = p;
  }

  /** QA hook (build:qa only). */
  /** QA hook (build:qa only): simulation speed multiplier for the current and future fights. */
  qaSpeed(x: number): void {
    this.qaSpeedValue = x;
    if (this.session) this.session.speed = x;
    if (this.attract) this.attract.speed = x;
  }
  private qaSpeedValue = 1;

  debugState(): unknown {
    return { screen: this.screen, fight: this.session?.fight.state ?? null };
  }
}
