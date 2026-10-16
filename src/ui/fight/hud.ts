// The fight HUD (DOM). Reads the simulation state each frame and updates only what changed; events drive banners
// and pop-ups. Fighter 0 is always on the left plate.

import type { FightEvent, FightState, FighterSpec, GroundDir, Side } from '../../game/fight/types';
import { METER_MAX } from '../../game/fight/types';
import './hud.css';

const ARROW: Record<GroundDir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const MOVE_NAME: Record<string, string> = {
  jab: 'Jab',
  cross: 'Cross',
  hookL: 'Left hook',
  hookR: 'Right hook',
  uppercut: 'Uppercut',
  bodyShot: 'Body shot',
  lowKick: 'Leg kick',
  bodyKick: 'Body kick',
  headKick: 'Head kick',
  superman: 'Superman punch',
  flyingKnee: 'Flying knee',
  spinBackfist: 'Spinning back fist',
  pound: 'Ground and pound',
  legs: 'Leg kicks',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

interface PlateEls {
  stamina: HTMLElement;
  cap: HTMLElement;
  special: HTMLElement;
  specialMeter: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  legs: HTMLElement;
  gassed: HTMLElement;
}

/** Damage colour: grey -> amber -> red. */
function hurtColor(v: number): string {
  const t = Math.min(1, v / METER_MAX);
  if (t < 0.05) return '#3a3f4a';
  const r = Math.round(120 + 135 * t);
  const g = Math.round(150 - 120 * t);
  return `rgb(${r},${g},40)`;
}

export class FightHud {
  readonly root: HTMLElement;
  private plates: [PlateEls, PlateEls];
  private clockT: HTMLElement;
  private clockR: HTMLElement;
  private banner: HTMLElement;
  private prompt: HTMLElement;
  private promptLabel: HTMLElement;
  private promptArrow: HTMLElement;
  private promptTimer: HTMLElement;
  private tug: HTMLElement;
  private tugFill: HTMLElement;
  private cache = new Map<string, string | number | boolean>();
  /** Which side the player controls (prompts are for them). */
  player: Side = 0;

  constructor(parent: HTMLElement, specs: [FighterSpec, FighterSpec]) {
    this.root = el('div', 'hud', parent);
    const mk = (side: Side): PlateEls => {
      const p = el('div', `plate ${side === 0 ? 'left' : 'right'}`, this.root);
      el('div', 'name', p, specs[side].name);
      el('div', 'nick', p, specs[side].nickname ? `“${specs[side].nickname}”` : '');
      const bars = el('div', 'bars', p);
      const body = el('div', 'body', bars);
      const head = el('span', 'h', body);
      const bd = el('span', 'b', body);
      const legs = el('span', 'l', body);
      const col = el('div', '', bars);
      col.style.flex = '1';
      const m = el('div', 'meter cap', col);
      const stamina = el('i', '', m);
      const cap = el('b', '', m);
      const sm = el('div', 'meter special', col);
      const special = el('i', '', sm);
      const gassed = el('div', 'gassed', col, 'GASSED');
      return { stamina, cap, special, specialMeter: sm, head, body: bd, legs, gassed };
    };
    this.plates = [mk(0), mk(1)];
    const clock = el('div', 'clock', this.root);
    this.clockR = el('div', 'rd', clock, 'ROUND 1');
    this.clockT = el('div', 't', clock, '1:30');
    this.banner = el('div', 'banner', this.root);
    this.prompt = el('div', 'prompt', this.root);
    this.promptArrow = el('div', 'arrow', this.prompt);
    this.promptLabel = el('div', 'label', this.prompt);
    const timer = el('div', 'timer', this.prompt);
    this.promptTimer = el('i', '', timer);
    this.tug = el('div', 'tug', this.prompt);
    this.tugFill = el('i', '', this.tug);
    el('b', '', this.tug);
  }

  private set(key: string, v: string | number | boolean, apply: () => void): void {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    apply();
  }

  /** Big centre banner. `hold` keeps it up (the result). */
  showBanner(text: string, sub = '', color: '' | 'red' | 'gold' = '', hold = false): void {
    const b = this.banner;
    b.className = 'banner';
    b.innerHTML = '';
    b.append(document.createTextNode(text));
    if (sub) el('small', '', b, sub);
    void b.offsetWidth;
    b.className = `banner ${color} ${hold ? 'hold' : 'show'}`;
  }

  hideBanner(): void {
    this.banner.className = 'banner';
  }

  private pop(text: string, side: Side): void {
    const p = el('div', 'pop', this.root, text);
    p.style.left = side === 0 ? '30%' : '70%';
    p.style.top = '24%';
    setTimeout(() => p.remove(), 950);
  }

  onEvents(events: FightEvent[], specs: [FighterSpec, FighterSpec]): void {
    for (const e of events) {
      switch (e.type) {
        case 'roundStart':
          this.showBanner(`Round ${e.round}`, 'Fight!', 'gold');
          break;
        case 'knockdown':
          this.showBanner('Knockdown!', '', 'red');
          break;
        case 'counter':
          this.pop('Counter!', e.side);
          break;
        case 'hit':
          if (e.chain >= 2 && !e.blocked) this.pop(`${e.chain + 1}-hit combo`, e.side);
          break;
        case 'evade':
          if (e.perfect) this.pop('Perfect slip', e.side);
          break;
        case 'stun':
          this.pop('Rocked!', e.side === 0 ? 1 : 0);
          break;
        case 'special':
          this.pop(MOVE_NAME[e.move] ?? 'Special', e.side);
          break;
        case 'takedown':
          this.pop('Takedown', e.side);
          break;
        case 'sprawl':
          if (e.success) this.pop('Sprawl!', e.side);
          break;
        case 'guardBreak':
          this.pop('Guard broken', e.side === 0 ? 1 : 0);
          break;
        case 'roundEnd':
          this.showBanner(`End of round ${e.round}`);
          break;
        case 'fightEnd': {
          const r = e.result;
          const who = r.winner === null ? '' : specs[r.winner].name;
          const by = r.by ? MOVE_NAME[r.by] ?? '' : '';
          const big = r.method === 'KO' ? 'K.O.!' : r.method === 'TKO' ? 'T.K.O.' : r.method === 'SUB' ? 'Submission' : r.winner === null ? 'Draw' : 'Decision';
          const sub = r.winner === null ? 'The judges score it even' : r.method === 'DEC' ? `${who} wins by ${r.decision} decision` : `${who} wins${by ? ' · ' + by : ''}${r.sub ? ' · ' + (r.sub === 'armbar' ? 'Armbar' : 'Choke') : ''}`;
          this.showBanner(big, sub, r.winner === this.player ? 'gold' : 'red', true);
          break;
        }
        default:
          break;
      }
    }
  }

  update(s: FightState, rounds: number): void {
    for (const i of [0, 1] as const) {
      const f = s.fighters[i];
      const p = this.plates[i];
      const st = Math.round((f.stamina / METER_MAX) * 200) / 200;
      this.set(`st${i}`, st, () => (p.stamina.style.transform = `scaleX(${st})`));
      const cap = Math.round((1 - f.staminaCap / METER_MAX) * 200) / 200;
      this.set(`cap${i}`, cap, () => (p.cap.style.transform = `scaleX(${cap})`));
      p.cap.style.width = '100%';
      const sp = Math.round((f.special / METER_MAX) * 100) / 100;
      this.set(`sp${i}`, sp, () => {
        p.special.style.transform = `scaleX(${sp})`;
        p.specialMeter.classList.toggle('ready', sp >= 1);
      });
      this.set(`h${i}`, Math.round(f.head / 500), () => (p.head.style.background = hurtColor(f.head * 2)));
      this.set(`b${i}`, Math.round(f.body / 500), () => (p.body.style.background = hurtColor(f.body * 1.4)));
      this.set(`l${i}`, Math.round(f.legs / 500), () => (p.legs.style.background = hurtColor(f.legs * 1.4)));
      this.set(`g${i}`, f.gassed, () => p.gassed.classList.toggle('on', f.gassed));
    }
    const secs = Math.max(0, Math.ceil(s.clock / 60));
    const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.set('clock', t, () => (this.clockT.textContent = t));
    this.set('round', s.round, () => (this.clockR.textContent = `ROUND ${s.round} / ${rounds}`));

    // the player's prompt
    const me = s.fighters[this.player];
    const pr = me.prompt;
    const g = s.ground;
    const key = pr ? `${pr.kind}${pr.dir ?? ''}${pr.attacking}` : 'none';
    this.set('prompt', key, () => {
      this.prompt.classList.toggle('on', !!pr);
      if (!pr) return;
      this.promptArrow.style.display = pr.kind === 'scramble' ? 'flex' : 'none';
      this.promptArrow.textContent = pr.dir ? ARROW[pr.dir] : '';
      this.tug.style.display = pr.kind === 'mash' ? 'block' : 'none';
      this.promptLabel.textContent =
        pr.kind === 'sprawl'
          ? pr.attacking
            ? 'Drive!'
            : 'Sprawl! Swipe down'
          : pr.kind === 'scramble'
            ? 'Swipe!'
            : pr.kind === 'mash'
              ? pr.attacking
                ? 'Tap to finish it!'
                : 'Tap to escape!'
              : 'Tap to get up!';
    });
    if (pr) {
      const left = pr.window > 0 ? Math.max(0, pr.ticksLeft / pr.window) : 0;
      this.promptTimer.style.transform = `scaleX(${left.toFixed(3)})`;
      if (pr.kind === 'mash' && g?.sub) {
        // the bar shows the attacker's progress; for the defender it reads as danger
        this.tugFill.style.transform = `scaleX(${(g.sub.progress / METER_MAX).toFixed(3)})`;
      }
    }
  }

  private coachEl: HTMLElement | null = null;

  /** The tutorial coach card (null hides it). */
  coach(step: { title: string; text: string } | null, index: number, total: number, onSkip: () => void): void {
    if (!step) {
      this.coachEl?.remove();
      this.coachEl = null;
      if (index >= total) this.showBanner('Now win the fight!', '', 'gold');
      return;
    }
    if (!this.coachEl) {
      this.coachEl = el('div', 'coach', this.root.parentElement ?? document.body);
    }
    this.coachEl.innerHTML = `<div class="n">Lesson ${index + 1} / ${total}</div><b>${step.title}</b><div>${step.text}</div><button>Skip lesson</button>`;
    this.coachEl.querySelector('button')?.addEventListener('pointerdown', e => {
      e.stopPropagation();
      onSkip();
    });
    if (index > 0) this.pop('Nice!', this.player);
  }

  dispose(): void {
    this.coachEl?.remove();
    this.root.remove();
  }
}
