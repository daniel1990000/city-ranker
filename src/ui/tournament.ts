// The weekly tournament screen: the week's 8-fighter bracket, today's entries ("Watch ad: extra entry"), the next
// fight of the run, the week's best score and the prize tiers to claim. Rules: src/meta/tournament.ts, game rules:
// Game.tournament() and friends in src/app/game.ts.

import type { MenuCtx } from './menus';
import type { TournamentView } from '../app/game';
import { division } from '../meta/divisions';
import { PACKS } from '../meta/packs';
import { overall, rosterFighter } from '../meta/roster';
import { ROUND_NAMES, ROUNDS, opponentSlot } from '../meta/tournament';
import { isNative } from '../platform/platform';
import { portrait } from '../render/portraits';
import type { FighterSpec } from '../game/fight/types';
import './tournament.css';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fmt = (n: number) => n.toLocaleString('en-US');
const last = (name: string) => name.split(' ').pop() ?? name;

function on(el: Element | null, fn: () => void): void {
  el?.addEventListener('click', e => {
    e.stopPropagation();
    fn();
  });
}

function setPortrait(el: HTMLElement | null, f: FighterSpec): void {
  if (!el) return;
  void portrait(rosterFighter(f.id) ?? f).then(url => (el.style.backgroundImage = `url(${url})`));
}

function topbar(ctx: MenuCtx, title: string): HTMLElement {
  const t = h('div', 'topbar');
  const b = h('button', 'back', '‹');
  b.setAttribute('aria-label', 'Back');
  on(b, () => ctx.back());
  t.appendChild(b);
  t.appendChild(h('h1', '', esc(title)));
  const w = h('div', 'wallet');
  w.innerHTML = `<div class="pill"><i class="ico cash"></i><span>${fmt(ctx.game.cash)}</span></div><div class="pill" data-a="gems"><i class="ico gem"></i><span>${fmt(ctx.game.gems)}</span></div>`;
  on(w.querySelector('[data-a=gems]'), () => ctx.nav({ s: 'shop' }));
  t.appendChild(w);
  return t;
}

/** The bracket: quarter-finals, semi-finals, final. Other results show once the player's run has reached that round. */
function bracketEl(v: TournamentView): HTMLElement {
  const b = v.bracket;
  const run = v.t.run;
  const name = (slot: number) => (slot === 0 ? v.fighter.name : b.field[slot - 1].name);
  // the player's result in each round: 'W', 'L', 'D' or '' (not fought)
  const res = (round: number) => run?.fights[round]?.r ?? '';
  const seen = (round: number) => !!run && run.fights.length > round;
  // who came out of the player's match in a round (the player, the opponent, or not known yet)
  const ours = (round: number) => (res(round) === 'W' ? 0 : res(round) ? opponentSlot(b, round) : -1);
  const cell = (slot: number, win: boolean | null, me = false) =>
    `<div class="tb-f${me ? ' me' : ''}${win === true ? ' w' : win === false ? ' l' : ''}">${slot < 0 ? '?' : esc(last(name(slot)))}</div>`;
  const col = (title: string, matches: string[]) => `<div class="tb-col"><b>${title}</b>${matches.map(m => `<div class="tb-m">${m}</div>`).join('')}</div>`;
  const qf = b.winners.qf;
  const known = (r: number) => seen(r);
  const qfs = [
    cell(0, res(0) ? res(0) === 'W' : null, true) + cell(1, res(0) ? res(0) !== 'W' : null),
    cell(2, known(0) ? qf[0] === 2 : null) + cell(3, known(0) ? qf[0] === 3 : null),
    cell(4, known(0) ? qf[1] === 4 : null) + cell(5, known(0) ? qf[1] === 5 : null),
    cell(6, known(0) ? qf[2] === 6 : null) + cell(7, known(0) ? qf[2] === 7 : null),
  ];
  const top = ours(0);
  const sfs = [
    cell(top, top >= 0 && res(1) ? (top === 0) === (res(1) === 'W') : null, top === 0) + cell(known(0) ? qf[0] : -1, top >= 0 && res(1) ? (top === 0) !== (res(1) === 'W') : null),
    cell(known(0) ? qf[1] : -1, known(1) ? b.winners.sf === qf[1] : null) + cell(known(0) ? qf[2] : -1, known(1) ? b.winners.sf === qf[2] : null),
  ];
  const fin = top === 0 ? ours(1) : -1;
  const finals = [cell(fin, fin === 0 && res(2) ? res(2) === 'W' : null, fin === 0) + cell(known(1) ? b.winners.sf : -1, fin === 0 && res(2) ? res(2) !== 'W' : null)];
  const el = h('div', 'tb panel');
  el.innerHTML = col('Quarter-finals', qfs) + col('Semi-finals', sfs) + col('Final', finals);
  return el;
}

export function tournamentScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const v = g.tournament();
  const m = h('div', 'menu solid tour');
  m.appendChild(topbar(ctx, 'Weekly tournament'));
  const info = h('div', 'tour-info muted');
  info.innerHTML = `<span>${esc(division(v.bracket.div).name)} · ${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left</span><span>Best this week: <b>${fmt(v.best)}</b> points</span>`;
  const boards = h('button', 'btn ghost', 'Leaderboard');
  on(boards, () => ctx.boards());
  info.appendChild(boards);
  m.appendChild(info);

  const body = h('div', 'tour-body');
  body.appendChild(bracketEl(v));

  const run = v.t.run;
  const main = h('div', 'tour-main');
  if (v.active && v.step) {
    const opp = v.step.opponent;
    const vs = h('div', 'vs');
    vs.innerHTML = `<div class="side"><div class="por p1"></div><div class="nm">${esc(v.fighter.name)}</div><div class="muted">OVR ${overall(v.fighter.stats)}${v.loaner ? ' · loaner' : ''}</div></div>
      <div class="mid"><div class="x">VS</div><div class="muted">${ROUND_NAMES[v.step.round]}</div><div class="muted" style="font-size:12px">${v.step.rules.rounds ?? 3} rounds · run ${fmt(run?.score ?? 0)} pts</div><button class="btn red" data-a="fight" style="margin-top:10px">Fight</button></div>
      <div class="side"><div class="por p2"></div><div class="nm">${esc(opp.name)}</div><div class="muted">${opp.nickname ? `“${esc(opp.nickname)}” · ` : ''}OVR ${overall(opp.stats)} · ${opp.archetype}</div></div>`;
    setPortrait(vs.querySelector('.p1'), v.fighter);
    setPortrait(vs.querySelector('.p2'), opp);
    on(vs.querySelector('[data-a=fight]'), () => ctx.startTournament());
    main.appendChild(vs);
  } else {
    const card = h('div', 'panel tour-entry');
    const ended = run ? (run.round >= ROUNDS ? `Tournament champion! ${fmt(run.score)} points.` : `Knocked out in the ${ROUND_NAMES[Math.min(ROUNDS - 1, run.fights.length - 1)].toLowerCase()} · ${fmt(run.score)} points.`) : '';
    card.innerHTML = `${ended ? `<p><b>${ended}</b></p>` : ''}<p class="muted">Three fights, same bracket for everyone this week. Points for each win, finishes, speed and damage avoided.</p>
      <p class="muted" style="font-size:12px">${v.loaner ? `No ${esc(division(v.bracket.div).name)} fighter yet: you fight as ${esc(v.fighter.name)} (loaner, OVR ${overall(v.fighter.stats)}).` : `Your fighter: ${esc(v.fighter.name)} (OVR ${overall(v.fighter.stats)}).`}</p>
      <div class="row">${v.entriesLeft > 0 ? `<button class="btn red" data-a="enter">Enter (${v.entriesLeft} left today)</button>` : `<span class="muted">No entries left today. New entry tomorrow.</span>`}
      ${v.adEntry ? `<button class="btn ghost" data-a="ad">${isNative ? 'Watch ad: extra entry' : 'Extra entry'}</button>` : ''}</div>`;
    on(card.querySelector('[data-a=enter]'), () => {
      if (!g.enterTournament()) ctx.toast('Could not enter right now');
      ctx.nav({ s: 'tournament' });
    });
    on(card.querySelector('[data-a=ad]'), () => {
      void g.tournamentAdEntry().then(ok => {
        if (!ok) ctx.toast('No ad available right now');
        ctx.nav({ s: 'tournament' });
      });
    });
    main.appendChild(card);
  }

  const tiers = h('div', 'tour-tiers');
  for (const t of v.tiers) {
    const prize = [t.cash ? `${fmt(t.cash)} cash` : '', t.gems ? `${t.gems} gems` : '', t.pack ? PACKS[t.pack].name : ''].filter(Boolean).join(' + ');
    const d = h('div', `rw${t.claimed ? ' done' : t.reached ? ' ready' : ''}`);
    d.innerHTML = `<b>${esc(t.name)}</b><span>${t.points ? `${fmt(t.points)}+ pts` : 'Enter once'}</span><span>${prize}</span>`;
    if (t.claimed) d.appendChild(h('small', 'muted', 'Claimed'));
    else if (t.reached) {
      const btn = h('button', 'btn', 'Claim');
      on(btn, () => {
        const r = g.claimTournamentTier(t.tier);
        ctx.toast(r ? `${r.name}: ${prize}` : 'Already claimed');
        ctx.nav({ s: 'tournament' });
      });
      d.appendChild(btn);
    }
    tiers.appendChild(d);
  }
  main.appendChild(tiers);
  body.appendChild(main);
  m.appendChild(body);
  return m;
}
