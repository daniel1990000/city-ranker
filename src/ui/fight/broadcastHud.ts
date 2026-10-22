// The TV-broadcast layer on top of the fight HUD (DOM only): walkout name plates, commentary captions, the
// between-round corner screen and the finish replay's overlay (letterbox, "Replay" bug, tap to skip). The rules for
// what it says live in broadcast.ts; FightSession decides when each part shows.

import type { CornerReport, PlateInfo } from './broadcast';
import { mmss } from './broadcast';
import './broadcast.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Real seconds the walkout plates take (both in, a beat to read, out). */
export const PLATES_SECONDS = 4.6;
/** Longest the corner screen stays up on its own (real seconds). */
export const CORNER_SECONDS = 9;

export class BroadcastHud {
  readonly root: HTMLElement;
  private caption: HTMLElement;
  private captionText: HTMLElement;
  private captionTimer = 0;
  private plates: HTMLElement | null = null;
  private corner: HTMLElement | null = null;
  private cornerBar: HTMLElement | null = null;
  private replayEl: HTMLElement | null = null;
  private finishEl: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly reduced: boolean,
  ) {
    this.root = el('div', `bc${reduced ? ' reduced' : ''}`, parent);
    this.caption = el('div', 'bc-caption', this.root);
    el('i', '', this.caption);
    this.captionText = el('span', '', this.caption);
  }

  // ---- captions -------------------------------------------------------------------------------------------------

  /** Show a commentary line in the lower third for a few seconds. */
  say(text: string): void {
    this.captionText.textContent = text;
    this.caption.classList.remove('on');
    void this.caption.offsetWidth;
    this.caption.classList.add('on');
    this.captionTimer = 2.8;
  }

  hideCaption(): void {
    this.caption.classList.remove('on');
    this.captionTimer = 0;
  }

  /** Real time passes (seconds). */
  tick(dt: number): void {
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0) this.caption.classList.remove('on');
    }
  }

  // ---- a full-screen tap catcher (above the touch controls) ------------------------------------------------------

  private catchTap(onTap: () => void): void {
    this.catcher?.remove();
    const c = el('div', 'bc-catch', this.root);
    c.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      onTap();
    });
    this.catcher = c;
  }

  private releaseTap(): void {
    this.catcher?.remove();
    this.catcher = null;
  }

  // ---- walkout name plates --------------------------------------------------------------------------------------

  /** Both fighters' plates slide in (red corner first, then blue). Tap skips. */
  showPlates(info: [PlateInfo, PlateInfo], onSkip: () => void): void {
    this.hidePlates();
    const wrap = el('div', 'bc-plates', this.root);
    info.forEach((p, i) => {
      const card = el('div', `bc-plate ${i === 0 ? 'red' : 'blue'}`, wrap);
      card.style.animationDelay = `${i === 0 ? 0.15 : 0.95}s`;
      el('div', 'corner', card, i === 0 ? 'Red corner' : 'Blue corner');
      el('div', 'nm', card, p.name);
      if (p.nickname) el('div', 'nk', card, `“${p.nickname}”`);
      const row = el('div', 'facts', card);
      const fact = (label: string, value: string) => {
        const f = el('span', '', row);
        el('b', '', f, value);
        el('small', '', f, label);
      };
      fact('Record', p.record);
      fact('Overall', String(p.ovr));
      fact('Fights out of', p.hometown);
    });
    el('div', 'bc-skip', wrap, 'Tap to skip');
    this.plates = wrap;
    this.catchTap(onSkip);
  }

  hidePlates(): void {
    if (!this.plates) return;
    const p = this.plates;
    this.plates = null;
    this.releaseTap();
    p.classList.add('out');
    setTimeout(() => p.remove(), this.reduced ? 10 : 380);
  }

  get platesOn(): boolean {
    return this.plates !== null;
  }

  // ---- the corner screen ----------------------------------------------------------------------------------------

  /** The between-round panel: the round's numbers for both, an obvious-round hint, the corner's advice. Tap closes. */
  showCorner(r: CornerReport, names: [string, string], player: 0 | 1, onClose: () => void): void {
    this.hideCorner();
    const box = el('div', 'bc-corner', this.root);
    const panel = el('div', 'panel', box);
    const head = el('div', 'hd', panel);
    el('span', 'tag', head, 'Corner');
    el('span', 'rd', head, `End of round ${r.round}`);
    const t = el('table', 'st', panel);
    const tr = (label: string, a: string, b: string, lead: 0 | 1 | null = null) => {
      const row = el('tr', '', t);
      el('td', `a${lead === 0 ? ' lead' : ''}`, row, a);
      el('th', '', row, label);
      el('td', `b${lead === 1 ? ' lead' : ''}`, row, b);
    };
    const lead = (x: [number, number]): 0 | 1 | null => (x[0] > x[1] ? 0 : x[1] > x[0] ? 1 : null);
    const hr = el('tr', 'names', t);
    el('td', 'a', hr, names[0]);
    el('th', '', hr, '');
    el('td', 'b', hr, names[1]);
    tr('Strikes landed', `${r.landed[0]} / ${r.thrown[0]}`, `${r.landed[1]} / ${r.thrown[1]}`, lead(r.landed));
    tr('Power shots', String(r.power[0]), String(r.power[1]), lead(r.power));
    tr('Takedowns', `${r.takedowns[0]} / ${r.tdAttempts[0]}`, `${r.takedowns[1]} / ${r.tdAttempts[1]}`, lead(r.takedowns));
    tr('Control time', mmss(r.control[0]), mmss(r.control[1]), lead(r.control));
    if (r.knockdowns[0] + r.knockdowns[1] > 0) tr('Knockdowns', String(r.knockdowns[0]), String(r.knockdowns[1]), lead(r.knockdowns));
    if (r.clearWinner !== null) {
      const mine = r.clearWinner === player;
      el('div', `verdict ${mine ? 'good' : 'bad'}`, panel, mine ? `The judges should have that round for you.` : `That round looks like it went to ${names[r.clearWinner]}.`);
    }
    const adv = el('div', 'adv', panel);
    for (const line of r.advice) el('p', '', adv, line);
    const foot = el('div', 'ft', panel);
    el('span', '', foot, 'Tap to continue');
    const bar = el('i', '', el('div', 'bar', foot));
    this.cornerBar = bar;
    this.corner = box;
    this.catchTap(onClose);
  }

  /** The corner screen's countdown bar (1 = full, 0 = closing). */
  cornerProgress(left: number): void {
    if (this.cornerBar) this.cornerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, left)).toFixed(3)})`;
  }

  hideCorner(): void {
    if (!this.corner) return;
    const c = this.corner;
    this.corner = null;
    this.cornerBar = null;
    this.releaseTap();
    c.classList.add('out');
    setTimeout(() => c.remove(), this.reduced ? 10 : 260);
  }

  get cornerOn(): boolean {
    return this.corner !== null;
  }

  // ---- the finish: "Watch replay", then the replay overlay --------------------------------------------------------

  /** After a KO / TKO / submission: a "Watch replay" button under the result banner. */
  offerReplay(onWatch: () => void): void {
    this.finishEl?.remove();
    const b = el('button', 'bc-watch', this.root);
    b.innerHTML = '<i></i>Watch replay';
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      this.hideOffer();
      onWatch();
    });
    this.finishEl = b;
  }

  hideOffer(): void {
    this.finishEl?.remove();
    this.finishEl = null;
  }

  /** Letterbox, the replay bug and tap-to-skip. `parent` gets `bc-replay` (hides the HUD, controls and result card). */
  showReplay(onSkip: () => void): void {
    this.hideReplay();
    this.hideCaption();
    this.parent.classList.add('bc-replay');
    const r = el('div', 'bc-replayov', this.root);
    el('div', 'lb top', r);
    el('div', 'lb bot', r);
    const bug = el('div', 'bug', r);
    el('i', '', bug);
    bug.append(document.createTextNode('Replay'));
    el('div', 'skip', r, 'Tap to skip');
    this.replayEl = r;
    this.catchTap(onSkip);
  }

  hideReplay(): void {
    this.parent.classList.remove('bc-replay');
    if (!this.replayEl) return;
    this.replayEl.remove();
    this.replayEl = null;
    this.releaseTap();
  }

  dispose(): void {
    this.parent.classList.remove('bc-replay');
    this.root.remove();
  }
}
