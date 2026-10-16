// The touch layer over the fight: catches every pointer (multi-touch) and key, feeds the gesture recogniser, and draws
// the KICK / TAKEDOWN / SPECIAL buttons and the move pad at the same rectangles the recogniser uses as hit zones.

import { InputRecognizer } from '../../game/touch/recognizer';
import { computeTouchLayout } from '../../game/touch/layout';
import { isGameKey } from '../../game/touch/keyboard';
import type { TouchContext, TouchLayout, Rect } from '../../game/touch/types';
import type { FightInput } from '../../game/fight/types';
import './touch.css';

function place(e: HTMLElement, r: Rect): void {
  e.style.left = `${r.x}px`;
  e.style.top = `${r.y}px`;
  e.style.width = `${r.w}px`;
  e.style.height = `${r.h}px`;
}

function readInsets(): { top: number; right: number; bottom: number; left: number } {
  const cs = getComputedStyle(document.documentElement);
  const n = (v: string) => parseFloat(cs.getPropertyValue(v)) || 0;
  return { top: n('--safe-t'), right: n('--safe-r'), bottom: n('--safe-b'), left: n('--safe-l') };
}

export class TouchOverlay {
  readonly root: HTMLElement;
  readonly recognizer: InputRecognizer;
  private kick: HTMLElement;
  private shoot: HTMLElement;
  private special: HTMLElement;
  private pad: HTMLElement;
  private knob: HTMLElement;
  private pauseBtn: HTMLElement;
  private hint: HTMLElement;
  private layout: TouchLayout;
  private onPause: () => void;
  private detach: (() => void)[] = [];
  private t0 = performance.now();

  constructor(parent: HTMLElement, onPause: () => void, showHints: boolean) {
    this.onPause = onPause;
    this.root = document.createElement('div');
    this.root.className = 'touch';
    parent.appendChild(this.root);
    const mk = (cls: string, label: string) => {
      const e = document.createElement('div');
      e.className = `tbtn ${cls}`;
      e.innerHTML = `<span>${label}</span>`;
      this.root.appendChild(e);
      return e;
    };
    this.kick = mk('kick', 'Kick');
    this.shoot = mk('shoot', 'Takedown');
    this.special = mk('special', 'Special');
    this.pad = document.createElement('div');
    this.pad.className = 'tpad';
    this.knob = document.createElement('i');
    this.pad.appendChild(this.knob);
    this.root.appendChild(this.pad);
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'tpause';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.innerHTML = '<i></i><i></i>';
    this.root.appendChild(this.pauseBtn);
    this.hint = document.createElement('div');
    this.hint.className = 'thint';
    this.hint.innerHTML =
      '<div class="l"><b>Defend</b>Hold = block · Flick = dodge<br/>Drag the pad to move</div><div class="r"><b>Attack</b>Tap = jab · Swipe = power punches<br/>Kick button + swipe = kicks</div>';
    if (showHints) this.root.appendChild(this.hint);
    this.layout = computeTouchLayout(innerWidth, innerHeight, readInsets(), { pxPerDp: 1 });
    this.recognizer = new InputRecognizer({ layout: this.layout, pxPerDp: 1 });
    this.relayout();
    this.listen();
  }

  private now(): number {
    return performance.now() - this.t0;
  }

  relayout(): void {
    this.layout = computeTouchLayout(innerWidth, innerHeight, readInsets(), { pxPerDp: 1 });
    this.recognizer.setLayout(this.layout);
    place(this.kick, this.layout.kick);
    place(this.shoot, this.layout.shoot);
    place(this.special, this.layout.special);
    place(this.pad, this.layout.movePad);
    place(this.pauseBtn, this.layout.pause);
  }

  private listen(): void {
    const el = this.root;
    const down = (e: PointerEvent) => {
      const p = this.layout.pause;
      if (e.clientX >= p.x && e.clientX <= p.x + p.w && e.clientY >= p.y && e.clientY <= p.y + p.h) {
        this.onPause();
        return;
      }
      el.setPointerCapture?.(e.pointerId);
      this.recognizer.pointerDown(e.pointerId, e.clientX, e.clientY, this.now());
      e.preventDefault();
    };
    const move = (e: PointerEvent) => this.recognizer.pointerMove(e.pointerId, e.clientX, e.clientY, this.now());
    const up = (e: PointerEvent) => this.recognizer.pointerUp(e.pointerId, e.clientX, e.clientY, this.now());
    const cancel = (e: PointerEvent) => this.recognizer.pointerCancel(e.pointerId, this.now());
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause();
        return;
      }
      if (!isGameKey(e.code) || e.repeat) return;
      this.recognizer.keyDown(e.code, this.now());
      e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => {
      if (isGameKey(e.code)) this.recognizer.keyUp(e.code, this.now());
    };
    const blur = () => this.recognizer.cancelAll(this.now());
    const resize = () => this.relayout();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    this.detach.push(
      () => el.removeEventListener('pointerdown', down),
      () => el.removeEventListener('pointermove', move),
      () => el.removeEventListener('pointerup', up),
      () => el.removeEventListener('pointercancel', cancel),
      () => window.removeEventListener('keydown', kd),
      () => window.removeEventListener('keyup', ku),
      () => window.removeEventListener('blur', blur),
      () => window.removeEventListener('resize', resize),
    );
  }

  /** One simulation tick of input. */
  tick(ctx: TouchContext): FightInput {
    const input = this.recognizer.tick(this.now(), ctx);
    // draw: pressed buttons, the knob, the special glow, the ground / sub modes
    const touches = this.recognizer.touches();
    let kick = false;
    let shoot = false;
    let spec = false;
    let knob = 0;
    for (const t of touches) {
      if (t.zone === 'kick') kick = true;
      if (t.zone === 'shoot') shoot = true;
      if (t.zone === 'special') spec = true;
      if (t.zone === 'move') knob = t.moveX;
    }
    this.kick.classList.toggle('down', kick);
    this.shoot.classList.toggle('down', shoot);
    this.special.classList.toggle('down', spec);
    this.special.classList.toggle('ready', ctx.specialReady);
    this.shoot.classList.toggle('sprawl', ctx.sprawl);
    this.root.dataset.mode = ctx.mode;
    this.knob.style.transform = `translateX(${knob * 40}%)`;
    return input;
  }

  hideHints(): void {
    this.hint.remove();
  }

  dispose(): void {
    for (const d of this.detach) d();
    this.root.remove();
  }
}
