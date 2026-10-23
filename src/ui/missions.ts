// The daily missions panel for the hub: today's three missions with progress, what each pays, the all-three bonus
// and when a new set starts. Missions pay by themselves when done (Game.onEarned tells the App, for a toast).

import { MISSION_TUNING } from '../meta/missions';
import { msUntilTomorrow } from '../meta/days';
import type { MenuCtx } from './menus';
import './achievements.css';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fmt = (n: number) => n.toLocaleString('en-US');
const left = (ms: number) => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** A panel element (class "panel missions"); re-create it after a fight or any action to refresh it. */
export function missionsPanel(ctx: MenuCtx): HTMLElement {
  const v = ctx.game.missions();
  const el = document.createElement('div');
  el.className = 'panel missions';
  const done = v.list.filter(m => m.done).length;
  const bonusGems = Math.round(MISSION_TUNING.missionBonusGems);
  const bonusXp = Math.round(MISSION_TUNING.missionBonusXp);
  const bonusText = [bonusGems ? `${bonusGems} gems` : '', bonusXp ? `${bonusXp} season xp` : ''].filter(Boolean).join(' + ');
  el.innerHTML = `<h3>Daily missions <small class="muted">${done} / ${v.list.length} · new in ${left(msUntilTomorrow())}</small></h3>
    ${v.list
      .map(
        m => `<div class="mission${m.done ? ' done' : ''}"><span>${esc(m.def.text)}${m.def.target > 1 && !m.done ? ` <small class="muted">${fmt(m.prog)} / ${fmt(m.def.target)}</small>` : ''}</span><span class="mrw">${m.done ? 'Done ✓' : `+${fmt(m.cash)} cash`}</span>
      ${m.def.target > 1 && !m.done ? `<div class="progress" title="${m.prog} / ${m.def.target}"><i style="width:${Math.round((m.prog / m.def.target) * 100)}%"></i></div>` : ''}</div>`,
      )
      .join('')}
    ${bonusText ? `<div class="bonus${v.bonus ? ' got' : ' muted'}">${v.bonus ? `All done: +${bonusText} paid` : `Finish all three: +${bonusText}`}</div>` : ''}`;
  return el;
}
