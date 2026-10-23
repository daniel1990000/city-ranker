// The Training Room: the menu screen that sets up a practice fight (your fighter, what the sparring partner does,
// or a drill), and the in-fight practice layer (the drill checklist and the MOVES button). Practice pays nothing and
// saves nothing; the rules live in app/practice.ts and app/dummy.ts.

import { menu, topbar, type MenuCtx } from './menus';
import { DRILLS, DEFAULT_PRACTICE, GROUND_STARTS, type DrillRun, type GroundStartId, type PracticeOptions } from '../app/practice';
import { DUMMY_LABEL, DUMMY_MODES, type DummyMode } from '../app/dummy';
import { division } from '../meta/divisions';
import { overall, ROSTER, type RosterFighter } from '../meta/roster';
import { portrait } from '../render/portraits';
import './practice.css';

const DUMMY_HINT: Record<DummyMode, string> = {
  stand: 'Takes your shots. Practise combos and kicks.',
  block: 'Keeps a high guard. Find the leg kicks and body shots.',
  light: 'Throws one light shot at a time. Block, slip and counter.',
  shoot: 'Shoots for your legs every few seconds. Sprawl!',
  ground: 'Starts on the mat. Practise the ground game.',
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** What the player last chose (this launch only). */
let last: PracticeOptions = { ...DEFAULT_PRACTICE };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function tap(e: Element | null, fn: () => void): void {
  e?.addEventListener('click', ev => {
    ev.stopPropagation();
    fn();
  });
}

export function practiceScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const owned: RosterFighter[] = ROSTER.filter(f => g.owned(f.id));
  const main = g.pickedFor(g.mainDivision());
  if (!last.fighterId || !g.owned(last.fighterId)) last.fighterId = main?.id ?? owned[0]?.id;
  const opts: PracticeOptions = { ...last, drill: null, drillStep: 0 };

  const m = menu(ctx, 'solid practice-screen');
  const top = topbar(ctx, 'Training Room');
  top.insertBefore(el('span', 'pr-free muted', 'No rewards · nothing saved · no clock'), top.querySelector('.wallet'));
  m.appendChild(top);

  const body = el('div', 'pr-body');
  // ---- left: fighter, partner, start
  const left = el('div', 'pr-col pr-setup');
  left.appendChild(el('div', 'pr-label', 'Your fighter'));
  const roster = el('div', 'pr-fighters');
  for (const f of owned) {
    const spec = g.spec(f.id);
    const b = el('button', `pr-fighter ${f.rarity}${f.id === opts.fighterId ? ' on' : ''}`, `<i class="por"></i><b>${esc(f.name.split(' ').pop() ?? f.name)}</b><small>${division(f.division).short} · ${spec ? overall(spec.stats) : overall(f.stats)}</small>`);
    b.dataset.id = f.id;
    void portrait(f).then(url => ((b.querySelector('.por') as HTMLElement).style.backgroundImage = `url(${url})`));
    tap(b, () => {
      opts.fighterId = f.id;
      roster.querySelectorAll('.pr-fighter').forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.id === f.id));
    });
    roster.appendChild(b);
  }
  left.appendChild(roster);

  left.appendChild(el('div', 'pr-label', 'Sparring partner'));
  const modes = el('div', 'pr-seg');
  const hint = el('div', 'pr-hint muted');
  const grounds = el('div', 'pr-seg pr-ground');
  const paint = () => {
    modes.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === opts.mode));
    grounds.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === opts.ground));
    grounds.hidden = opts.mode !== 'ground';
    hint.textContent = DUMMY_HINT[opts.mode];
  };
  for (const md of DUMMY_MODES) {
    const b = el('button', '', esc(DUMMY_LABEL[md]));
    b.dataset.m = md;
    tap(b, () => {
      opts.mode = md;
      paint();
    });
    modes.appendChild(b);
  }
  for (const [id, gs] of Object.entries(GROUND_STARTS) as [GroundStartId, (typeof GROUND_STARTS)[GroundStartId]][]) {
    const b = el('button', '', esc(gs.label));
    b.dataset.g = id;
    tap(b, () => {
      opts.ground = id;
      paint();
    });
    grounds.appendChild(b);
  }
  left.append(modes, grounds, hint);

  const foot = el('div', 'pr-foot');
  const sp = el('label', 'pr-check', `<input type="checkbox"${opts.fullSpecial ? ' checked' : ''}/> Special meter always full`);
  sp.querySelector('input')?.addEventListener('change', e => (opts.fullSpecial = (e.target as HTMLInputElement).checked));
  const go = el('button', 'btn red', 'Practise');
  go.disabled = !opts.fighterId;
  tap(go, () => {
    last = { ...opts, drill: null, drillStep: 0 };
    ctx.startPractice(last);
  });
  foot.append(sp, go);
  left.appendChild(foot);
  paint();

  // ---- right: drills
  const right = el('div', 'pr-col pr-drills');
  right.appendChild(el('div', 'pr-label', 'Drills <small>step by step, they tick off as you go</small>'));
  const list = el('div', 'pr-drill-list');
  for (const d of DRILLS) {
    const b = el('button', 'pr-drill panel', `<b>${esc(d.title)}</b><small>${esc(d.blurb)}</small><ol>${d.steps.map(s => `<li>${esc(s.goal)}</li>`).join('')}</ol><span class="go">Start ›</span>`);
    tap(b, () => {
      if (!opts.fighterId) return;
      last = { ...opts, drill: d.id, drillStep: 0 };
      ctx.startPractice(last);
    });
    list.appendChild(b);
  }
  right.appendChild(list);
  body.append(left, right);
  m.appendChild(body);
  if (!owned.length) right.appendChild(el('p', 'muted', 'Get a fighter first.'));
  return m;
}

// ---- in the fight -------------------------------------------------------------------------------------------------

/** The practice layer over the fight: a PRACTICE tag with the partner's job, the MOVES button and the drill card. */
export class PracticeHud {
  readonly root: HTMLElement;
  private card: HTMLElement | null = null;
  private flashT: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly run: DrillRun | null,
    modeLabel: string,
    onMoves: () => void,
  ) {
    this.root = el('div', 'practice-hud');
    const bar = el('div', 'pr-bar', `<span class="tag">Practice</span><span class="mode">${esc(modeLabel)}</span>`);
    const moves = el('button', 'pr-moves', 'Moves');
    moves.setAttribute('aria-label', 'Move list');
    // never a fight input
    moves.addEventListener('pointerdown', e => e.stopPropagation());
    tap(moves, onMoves);
    bar.appendChild(moves);
    this.root.appendChild(bar);
    if (run) {
      this.card = el('div', 'pr-card');
      this.root.appendChild(this.card);
    }
    parent.appendChild(this.root);
    this.update();
  }

  /** The partner's job changed (a new drill step). */
  setMode(label: string): void {
    const m = this.root.querySelector('.mode');
    if (m) m.textContent = label;
  }

  /** Redraw the drill card; `kind` 'step' flashes "Nice!", 'progress' bumps the counter. */
  update(kind: 'progress' | 'step' | null = null): void {
    const run = this.run;
    const c = this.card;
    if (!run || !c) return;
    const d = run.drill;
    const cur = run.current;
    const steps = d.steps
      .map((s, i) => {
        const state = i < run.step ? 'done' : i === run.step ? 'now' : '';
        const count = i === run.step && s.count > 1 ? ` <em>${run.count}/${s.count}</em>` : '';
        return `<li class="${state}"><i></i>${esc(s.goal)}${count}</li>`;
      })
      .join('');
    c.innerHTML = `<div class="n">${esc(d.title)} · ${Math.min(run.step + 1, d.steps.length)} / ${d.steps.length}</div><ol>${steps}</ol>${cur ? `<div class="how">${esc(cur.how)}</div>` : '<div class="how done">Drill complete! Keep practising, or pause to leave.</div>'}`;
    if (kind) {
      c.classList.remove('bump', 'nice');
      void c.offsetWidth;
      c.classList.add(kind === 'step' ? 'nice' : 'bump');
      if (kind === 'step') this.flash(run.done ? 'Drill complete!' : 'Nice!');
    }
  }

  private flash(text: string): void {
    this.root.querySelector('.pr-flash')?.remove();
    const f = el('div', 'pr-flash', esc(text));
    this.root.appendChild(f);
    if (this.flashT) clearTimeout(this.flashT);
    this.flashT = setTimeout(() => f.remove(), 1400);
  }

  dispose(): void {
    if (this.flashT) clearTimeout(this.flashT);
    this.root.remove();
  }
}
