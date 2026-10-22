// The champion's strip on the career screen (after a first title in the division): Legacy rank, super fights, and
// the choices after a belt: vacate and run the ladder again at the next Prestige, or move up / down a weight class.
// Rules: src/meta/career.ts; game rules: Game.championOptions / prestige / moveDivision.

import type { MenuCtx } from './menus';
import type { DivisionId } from '../game/fight/types';
import { division } from '../meta/divisions';
import { rosterFighter } from '../meta/roster';
import './tournament.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Null before the first title in this division. */
export function championPanel(ctx: MenuCtx, div: DivisionId): HTMLElement | null {
  const g = ctx.game;
  const o = g.championOptions(div);
  if (!o) return null;
  const el = document.createElement('div');
  el.className = 'champ panel';
  const guest = o.guest ? rosterFighter(o.guest) : undefined;
  const legacy = o.legacyRank ? `Legacy: <b>${esc(o.legacyName)}</b>` : 'Legacy: defend the belt to start your legacy';
  const next = o.legacyNext ? ` · next: ${esc(o.legacyNext.name)} at ${o.legacyNext.at} defences` : '';
  const moves = o.moves.map(d => {
    const up = division(d).kg > division(div).kg;
    return `<button class="btn ghost" data-move="${d}">Move ${up ? 'up' : 'down'}: ${esc(division(d).name.replace("Women's ", 'W. '))}</button>`;
  });
  el.innerHTML = `<span>${legacy}${next}</span><span class="muted">${o.defenses} defences · ${o.supers} super fights${o.prestige ? ` · Prestige ${o.prestige}` : ''}${guest ? ` · ${esc(guest.name)} moved in` : ''}</span>
    <span class="row">${o.canPrestige ? `<button class="btn ghost" data-a="prestige">Prestige ${o.prestige + 1}: vacate and run it back</button>` : ''}${moves.join('')}</span>`;
  el.querySelector('[data-a=prestige]')?.addEventListener('click', e => {
    e.stopPropagation();
    const p = document.createElement('div');
    p.className = 'modal-back';
    p.innerHTML = `<div class="modal panel"><h2>Prestige ${o.prestige + 1}</h2><p class="muted">Vacate the ${esc(division(div).name)} belt and climb the ladder again: tougher opponents, purses +25 %, and a new title prize. Your record and Legacy stay.</p>
      <div class="row"><button class="btn" data-a="yes">Vacate and run it back</button><button class="btn ghost" data-a="no">Keep the belt</button></div></div>`;
    p.querySelector('[data-a=no]')?.addEventListener('click', () => p.remove());
    p.querySelector('[data-a=yes]')?.addEventListener('click', () => {
      p.remove();
      if (g.prestige(div)) ctx.toast(`Prestige ${o.prestige + 1}: the climb starts again`);
      ctx.nav({ s: 'career', div });
    });
    (el.closest('.menu')?.parentElement ?? document.body).appendChild(p);
  });
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-move]')) {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const to = b.dataset.move as DivisionId;
      if (g.moveDivision(div, to)) ctx.toast(`Off to ${division(to).name}: you keep your belt here`);
      ctx.nav({ s: 'career', div: to });
    });
  }
  return el;
}
