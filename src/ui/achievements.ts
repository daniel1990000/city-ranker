// The achievements screen (every achievement, earned or not, with progress and reward), and the toast lines for
// what was just earned (Game.onEarned / FightRewards.earned / BuyPackResult.earned).

import type { Earned } from '../app/game';
import { ACHIEVEMENTS, achievementReward, type AchievementDef } from '../meta/achievements';
import { showGameAchievements } from '../platform/games';
import { isNative } from '../platform/platform';
import type { MenuCtx } from './menus';
import './achievements.css';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fmt = (n: number) => n.toLocaleString('en-US');

function on(el: Element | null, fn: () => void): void {
  el?.addEventListener('click', e => {
    e.stopPropagation();
    fn();
  });
}

function topbar(ctx: MenuCtx, title: string): HTMLElement {
  const t = h('div', 'topbar');
  const b = h('button', 'back', '‹');
  b.setAttribute('aria-label', 'Back');
  on(b, () => ctx.back());
  t.appendChild(b);
  t.appendChild(h('h1', '', esc(title)));
  const w = h('div', 'wallet');
  w.innerHTML = `<div class="pill" data-a="cash"><i class="ico cash"></i><span>${fmt(ctx.game.cash)}</span></div><div class="pill" data-a="gems"><i class="ico gem"></i><span>${fmt(ctx.game.gems)}</span></div>`;
  on(w.querySelector('[data-a=gems]'), () => ctx.nav({ s: 'shop' }));
  t.appendChild(w);
  return t;
}

/** "1,500 cash · 20 gems · Premium Pack" */
export function rewardText(a: AchievementDef): string {
  const r = achievementReward(a);
  return [r.cash ? `${fmt(r.cash)} cash` : '', r.gems ? `${r.gems} gems` : '', r.pack ? `${r.pack[0].toUpperCase()}${r.pack.slice(1)} Pack` : ''].filter(Boolean).join(' · ');
}

/** Short lines to toast for what was just earned (empty when nothing was). */
export function earnedMessages(e: Earned): string[] {
  const out = e.achievements.map(a => `Achievement: ${a.name} (+${rewardText(a)})`);
  for (const m of e.missions?.done ?? []) out.push(`Mission done: ${m.text}`);
  if (e.missions?.bonus) out.push('All daily missions done!');
  return out;
}

export function achievementsScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const got = ACHIEVEMENTS.filter(a => g.save.achievements[a.id]).length;
  const m = h('div', 'menu solid achievements');
  m.appendChild(topbar(ctx, 'Achievements'));
  const head = h('div', 'ach-head');
  head.innerHTML = `<span>${got} / ${ACHIEVEMENTS.length} earned</span><div class="progress"><i style="width:${Math.round((got / ACHIEVEMENTS.length) * 100)}%"></i></div>`;
  if (isNative) {
    const pg = h('button', 'btn ghost', 'Google Play Games');
    on(pg, () => {
      void showGameAchievements().then(ok => {
        if (!ok) ctx.toast('Could not open Google Play Games');
      });
    });
    head.appendChild(pg);
  }
  m.appendChild(head);
  const list = h('div', 'scroll ach-list');
  // still to earn first (in their own order), then the earned ones (newest first)
  const earned = ACHIEVEMENTS.filter(a => g.save.achievements[a.id]).sort((a, b) => g.save.achievements[b.id] - g.save.achievements[a.id]);
  const open = ACHIEVEMENTS.filter(a => !g.save.achievements[a.id]);
  for (const a of [...open, ...earned]) {
    const at = g.save.achievements[a.id];
    const row = h('div', `panel ach${at ? ' got' : ''}`);
    const p = !at && a.progress ? a.progress(g.save) : null;
    row.innerHTML = `<div class="ach-mark" aria-hidden="true">${at ? '✓' : ''}</div>
      <div class="ach-main"><b>${esc(a.name)}</b><span class="muted">${esc(a.text)}</span>
        ${p && p[1] > 1 ? `<div class="ach-prog"><div class="progress"><i style="width:${Math.round((p[0] / p[1]) * 100)}%"></i></div><small class="muted">${fmt(p[0])} / ${fmt(p[1])}</small></div>` : ''}</div>
      <div class="ach-reward">${at ? `<small class="muted">${new Date(at).toLocaleDateString()}</small>` : esc(rewardText(a))}</div>`;
    list.appendChild(row);
  }
  m.appendChild(list);
  return m;
}
