// The fight HUD (DOM). Reads the simulation state each frame and updates only what changed; events drive banners
// and pop-ups. Fighter 0 is always on the left plate.

import type { FightEvent, FightState, FighterSpec, GroundDir, Side } from '../../game/fight/types';
import { METER_MAX } from '../../game/fight/types';
import './hud.css';

const ARROW: Record<GroundDir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
/** The prompt arrow as a drawn shape (an arrow character may be missing from the phone's fonts). */
const ARROW_DEG: Record<GroundDir, number> = { right: 0, down: 90, left: 180, up: -90 };
const arrowSvg = (d: GroundDir) =>
  `<svg viewBox="0 0 24 24" aria-label="${ARROW[d]}" style="width:62%;height:62%;transform:rotate(${ARROW_DEG[d]}deg)"><path d="M3.5 12h15M12.5 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
  private ghint: HTMLElement;
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
    this.ghint = el('div', 'ghint', this.root);
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

  /** Live pop words per side: a new one goes below the ones still showing (never on top of them). */
  private pops: [HTMLElement[], HTMLElement[]] = [[], []];

  private pop(text: string, side: Side, key = ''): void {
    const live = this.pops[side];
    // a counting pop (the combo) replaces its last number instead of stacking under it
    if (key) {
      const old = live.find(x => x.dataset.key === key);
      if (old) {
        old.remove();
        live.splice(live.indexOf(old), 1);
      }
    }
    if (live.length >= 3) live.shift()?.remove();
    const p = el('div', 'pop', this.root, text);
    if (key) p.dataset.key = key;
    p.style.left = side === 0 ? '30%' : '70%';
    p.style.top = `${24 + live.length * 7}%`;
    live.push(p);
    setTimeout(() => {
      p.remove();
      const i = live.indexOf(p);
      if (i >= 0) live.splice(i, 1);
    }, 950);
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
          if (e.chain >= 2 && !e.blocked) this.pop(`${e.chain + 1}-hit combo`, e.side, 'combo');
          break;
        case 'evade':
          if (e.perfect) this.pop('Perfect slip', e.side);
          break;
        case 'stun':
          // a health event: big, and it tells the player what to do about it
          if (e.side === this.player) this.showBanner('Rocked!', 'Cover up and get out of range', 'red');
          else this.showBanner('Rocked!', 'Go for the finish', 'gold');
          break;
        case 'hurt':
          if (e.zone === 'body') this.showBanner('Hurt to the body', e.side === this.player ? 'Breathe: back off and cover up' : 'Keep working the body', e.side === this.player ? 'red' : 'gold');
          else this.pop(e.side === this.player ? 'Your leg is hurt' : 'Leg is hurt!', e.side);
          break;
        case 'recover':
          this.pop('Recovered', e.side);
          break;
        case 'predictable':
          if (e.side === this.player) this.pop('Predictable: mix it up!', e.side);
          break;
        case 'parry':
          this.pop('Parry!', e.side);
          break;
        case 'check':
          this.pop('Checked!', e.side);
          break;
        case 'cover':
          if (e.side !== this.player) this.pop('Covering up', e.side);
          break;
        case 'special':
          this.pop(MOVE_NAME[e.move] ?? 'Special', e.side);
          break;
        case 'takedown':
          this.pop('Takedown', e.side);
          break;
        case 'shoot':
          // warn as the shot starts: a sprawl pressed this early works best
          if (e.side !== this.player) this.pop('Swipe down to sprawl!', this.player);
          break;
        case 'standUp':
          if (e.reason === 'ref') this.pop('Referee stands them up', this.player);
          break;
        case 'sprawl':
          if (e.success) this.pop('Sprawl!', e.side);
          break;
        case 'clinchStart':
          this.pop(e.wall ? 'On the cage' : 'Clinch!', e.side);
          break;
        case 'clinchMiss':
          this.pop('Shrugged off', e.side);
          break;
        case 'clinchContestEnd':
          if (e.success) this.pop(e.purpose === 'reverse' ? 'Reversed!' : 'Broke free', e.side);
          break;
        case 'clinchTrip':
          if (e.side !== this.player) this.pop('Swipe down to fight the trip!', this.player);
          break;
        case 'clinchTripEnd':
          if (!e.success) this.pop('Trip stuffed', e.side === 0 ? 1 : 0);
          break;
        case 'clinchBreak':
          if (e.reason === 'ref') this.pop('Referee breaks them', this.player);
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
          const sub = r.stoppage === 'forfeit' ? `${who} wins · the other corner retired` : r.winner === null ? 'The judges score it even' : r.method === 'DEC' ? `${who} wins by ${r.decision} decision` : `${who} wins${by ? ' · ' + by : ''}${r.sub ? ' · ' + (r.sub === 'armbar' ? 'Armbar' : 'Choke') : ''}`;
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

    // rocked: a pulsing red edge while the player is wobbled, gold while the opponent is
    const rocked = (i: 0 | 1) => s.fighters[i].stunTicks > 0 && (s.fighters[i].hurtFlags & 4) !== 0;
    const meRocked = rocked(this.player);
    const themRocked = rocked(this.player === 0 ? 1 : 0);
    this.set('rockedMe', meRocked, () => this.root.classList.toggle('rocked-me', meRocked));
    this.set('rockedThem', themRocked, () => this.root.classList.toggle('rocked-them', themRocked));

    // on the ground: what the player can do from here (bottom players kept asking how to get up)
    let gh = '';
    if (s.ground && !s.ground.scramble && !s.ground.sub && !s.result) {
      const top = s.ground.top === this.player;
      gh = top
        ? s.ground.pos === 'guard'
          ? 'Tap to strike · Swipe up to pass to mount · Swipe down for a choke'
          : 'Tap to strike · Swipe down for an armbar'
        : s.ground.pos === 'mount'
          ? 'Swipe up to escape the mount · Hold to cover up'
          : 'Swipe up to get back up · Swipe down for an armbar · Hold to cover up';
    }
    // in the clinch: what the gestures do in here
    const c = s.clinch;
    if (c && !c.contest && !c.trip && !s.result) {
      gh =
        c.ctl === this.player
          ? 'Tap: knees · Swipe: elbows, uppercuts · TAKEDOWN: trip · Step back: let go'
          : 'Flick on the defence side to break free · TAKEDOWN to turn it · Hold to cover up';
    }
    this.set('ghint', gh, () => {
      this.ghint.textContent = gh;
      this.ghint.classList.toggle('on', gh !== '');
    });

    // the player's prompt
    const me = s.fighters[this.player];
    const pr = me.prompt;
    const g = s.ground;
    const key = pr ? `${pr.kind}${pr.dir ?? ''}${pr.attacking}` : 'none';
    this.set('prompt', key, () => {
      this.prompt.classList.toggle('on', !!pr);
      if (!pr) return;
      this.promptArrow.style.display = pr.kind === 'scramble' || pr.kind === 'clinch' ? 'flex' : 'none';
      this.promptArrow.innerHTML = pr.dir ? arrowSvg(pr.dir) : '';
      this.tug.style.display = pr.kind === 'mash' ? 'block' : 'none';
      // gold when the player is the one applying the hold, red when they are caught in it
      this.tug.classList.toggle('attack', pr.kind === 'mash' && pr.attacking);
      this.promptLabel.textContent =
        pr.kind === 'sprawl'
          ? pr.attacking
            ? s.clinch
              ? 'Trip!'
              : 'Drive!'
            : s.clinch
              ? 'Fight the trip! Swipe down'
              : 'Sprawl! Swipe down'
          : pr.kind === 'scramble'
            ? 'Swipe!'
            : pr.kind === 'clinch'
              ? pr.attacking
                ? 'Flick the arrow first!'
                : 'Flick to keep hold!'
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

  /** The player tapped in the submission battle: thump the bar. */
  tapPulse(): void {
    this.tug.classList.remove('pulse');
    void this.tug.offsetWidth;
    this.tug.classList.add('pulse');
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
