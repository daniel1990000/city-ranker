// The menus: hub, career, fighters (+ detail with training and stars), packs (+ reveal), shop, season pass and
// settings. Each screen is a function that builds its DOM from the Game; actions go through Game methods.
// The look is a fight broadcast: slanted name plates, red and blue corners, metallic rarity frames, foil packs.
// Every list that can be longer than a phone screen scrolls inside its own scroller, never the page.

import type { DivisionId, FighterStats, Rarity } from '../game/fight/types';
import type { Game } from '../app/game';
import { DAILY_REWARDS } from '../app/game';
import { FIGHTS_PER_TIER, TIER_NAMES, TIERS, careerProgress } from '../meta/career';
import { dailyStatus } from '../meta/daily';
import { DIVISIONS, division } from '../meta/divisions';
import { MAX_LEVEL, STAR_COST, STAT_KEYS, TRAIN_CAP, trainCost, trainMinutes, xpToNext } from '../meta/fighters';
import { PACKS, PACK_IDS, oddsText, pityLeft, type PackId } from '../meta/packs';
import { overall, ROSTER, rosterFighter, type RosterFighter } from '../meta/roster';
import { TIERS as SEASON_TIERS, TIER_XP, freeReward, premiumReward, isPremium, seasonDaysLeft, seasonName, tierOf, seasonId } from '../meta/season';
import { PRODUCTS } from '../meta/products';
import { TUNING } from '../meta/tuning';
import { priceOf, storeAvailable } from '../platform/iap';
import { isNative } from '../platform/platform';
import { portrait } from '../render/portraits';
import type { CardResult } from '../meta/fighters';
import type { PackResult } from '../meta/packs';
import type { PracticeOptions } from '../app/practice';
import { sound } from '../audio/sound';
import { championPanel } from './champion';
import { ACHIEVEMENTS } from '../meta/achievements';
import { weekDaysLeft } from '../meta/weekly';
import { CASH_ICON, GEM_ICON, gemArt, icon, packArt, type IconName } from './icons';
import './menus.css';

export type Route =
  | { s: 'hub' }
  | { s: 'career'; div?: DivisionId }
  | { s: 'fighters'; div?: DivisionId | 'all' }
  | { s: 'fighter'; id: string }
  | { s: 'packs' }
  | { s: 'shop' }
  | { s: 'season' }
  | { s: 'settings' }
  | { s: 'achievements' }
  | { s: 'practice' }
  | { s: 'tournament' };

export interface MenuCtx {
  game: Game;
  nav(r: Route): void;
  back(): void;
  toast(msg: string): void;
  startCareer(div: DivisionId): void;
  startQuick(div: DivisionId): void;
  /** Training Room: a practice fight (ui/practice.ts). */
  startPractice(o: PracticeOptions): void;
  /** Today's daily missions (a card over the current screen). */
  showMissions(): void;
  /** Fight the weekly tournament run's next round. */
  startTournament(): void;
  settings(): HTMLElement;
  /** Open the Play Games leaderboards (signs in if needed). */
  boards(): void;
  /** Offer opt-in reminders once (after the first free pack). */
  offerReminders(): void;
}

const STAT_LABEL: Record<keyof FighterStats, string> = {
  power: 'Power', speed: 'Speed', chin: 'Chin', cardio: 'Cardio', striking: 'Boxing', kicking: 'Kicking',
  wrestling: 'Wrestling', grappling: 'Grappling', submissions: 'Submissions', defense: 'Defence',
};
const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legend: 'Legend' };

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fmt = (n: number) => n.toLocaleString('en-US');
const mins = (ms: number) => {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
/** "Owen Brennan" -> first name small, last name big (cards and plates). */
const splitName = (n: string): [string, string] => {
  const i = n.lastIndexOf(' ');
  return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : ['', n];
};
const nameHtml = (n: string) => {
  const [a, b] = splitName(n);
  return `${a ? `<small class="fn">${esc(a)}</small>` : ''}<b class="ln">${esc(b)}</b>`;
};

function on(el: Element | null, fn: () => void): void {
  el?.addEventListener('click', e => {
    e.stopPropagation();
    fn();
  });
}

/** Lazy portrait into an element's background. */
function setPortrait(el: HTMLElement, f: RosterFighter | { id: string }): void {
  const full = rosterFighter(f.id) ?? (f as RosterFighter);
  if (!('lookSeed' in full)) return;
  void portrait(full).then(url => {
    el.style.backgroundImage = `url(${url})`;
    el.classList.add('ready');
  });
}

/** A menu root; the player's "Reduced motion" setting also calms the menu animations. */
export function menu(ctx: MenuCtx, cls: string): HTMLElement {
  const m = h('div', `menu ${cls}`);
  if (ctx.game.save.settings.reducedMotion) m.classList.add('calm');
  m.appendChild(h('div', 'menu-bg'));
  return m;
}

export function topbar(ctx: MenuCtx, title: string, back = true): HTMLElement {
  const t = h('div', 'topbar');
  if (back) {
    const b = h('button', 'back', icon('back'));
    b.setAttribute('aria-label', 'Back');
    on(b, () => ctx.back());
    t.appendChild(b);
  }
  if (title) t.appendChild(h('h1', '', `<span>${esc(title)}</span>`));
  else t.appendChild(h('div', 'logo hub-logo', `${icon('crown', 'crown')}<span>Cage <b>Kings</b></span>`));
  const w = h('div', 'wallet');
  // App.refreshWallet updates the first two <span>s: cash, then gems
  w.innerHTML = `<div class="pill" data-a="cash">${CASH_ICON}<span>${fmt(ctx.game.cash)}</span></div><div class="pill" data-a="gems">${GEM_ICON}<span>${fmt(ctx.game.gems)}</span><i class="plus">+</i></div>`;
  on(w.querySelector('[data-a=gems]'), () => ctx.nav({ s: 'shop' }));
  t.appendChild(w);
  const g = h('button', 'gear', icon('gear'));
  g.setAttribute('aria-label', 'Settings');
  on(g, () => ctx.nav({ s: 'settings' }));
  t.appendChild(g);
  return t;
}

/** A fighter card (portrait, overall, name) in a metallic frame for its rarity. */
export function fighterCard(f: RosterFighter, owned: boolean, stars = 0, ovr?: number): HTMLElement {
  const c = h('button', `fcard ${f.rarity}${owned ? '' : ' locked'}`);
  c.setAttribute('aria-label', `${f.name}, ${RARITY_LABEL[f.rarity]}`);
  c.innerHTML = `<div class="frame"><div class="por"></div><div class="ovr"><b>${ovr ?? overall(f.stats)}</b><small>OVR</small></div><div class="div">${division(f.division).short}</div>
    ${owned ? '' : `<div class="lockmark">${icon('lock')}</div>`}
    <div class="nm">${nameHtml(f.name)}<div class="meta"><span>${f.archetype}</span><i class="gemr"></i><span>${RARITY_LABEL[f.rarity]}</span></div>${stars ? `<div class="stars">${'★'.repeat(stars)}</div>` : ''}</div></div>`;
  setPortrait(c.querySelector('.por') as HTMLElement, f);
  return c;
}

// ---- hub -------------------------------------------------------------------------------------------------------

const TILE_SHORT: Record<string, string> = { Tournament: 'Weekly', 'Quick fight': 'Quick' };

export function hubScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'hub');
  m.appendChild(topbar(ctx, '', false));
  const body = h('div', 'body hub-body');
  const left = h('div', 'hub-left');
  const div = g.mainDivision();
  const me = g.pickedFor(div);
  if (me) {
    const spec = g.spec(me.id);
    const c = g.save.progress.career.div[div];
    const fe = h('button', `featured ${me.rarity}`);
    const stage = c.belt ? 'Champion' : TIER_NAMES[Math.min(c.tier, TIERS - 1)];
    fe.innerHTML = `<div class="por"></div><div class="glow"></div>
      <div class="tagline">${icon('star')}<span>Your fighter</span></div>
      <div class="ovr"><b>${spec ? overall(spec.stats) : ''}</b><small>OVR</small></div>
      <div class="who"><div class="name">${nameHtml(me.name)}</div>
        <div class="line"><span>${division(div).name}</span><span class="rec">${c.wins}-${c.losses}${c.draws ? '-' + c.draws : ''}</span></div>
        <div class="line sub"><span>${c.belt ? `${icon('crown')} Champion` : esc(stage)}</span><span>${Math.round(careerProgress(c) * 100)}%</span></div>
        <div class="progress"><i style="width:${Math.round(careerProgress(c) * 100)}%"></i></div></div>`;
    setPortrait(fe.querySelector('.por') as HTMLElement, me);
    on(fe, () => ctx.nav({ s: 'fighter', id: me.id }));
    left.appendChild(fe);
  } else {
    const fe = h('button', 'featured empty');
    fe.innerHTML = `<div class="who">${icon('packs', 'big')}<div class="name"><b class="ln">No fighter yet</b></div><div class="line sub"><span>Open a pack to get your first fighter</span></div></div>`;
    on(fe, () => ctx.nav({ s: 'packs' }));
    left.appendChild(fe);
  }
  const row = h('div', 'hub-row');
  const ms = g.missions();
  const mDone = ms.list.filter(x => x.done).length;
  const missions = h('button', 'btn ghost boards', `${icon('list')}<span>Missions ${mDone}/${ms.list.length}</span>${mDone < ms.list.length ? '<i class="dot"></i>' : ''}`);
  on(missions, () => ctx.showMissions());
  const boards = h('button', 'btn ghost boards', `${icon('boards')}<span>Ranks</span>`);
  boards.setAttribute('aria-label', 'Leaderboards');
  on(boards, () => ctx.boards());
  row.append(missions, boards);
  left.appendChild(row);
  body.appendChild(left);
  const right = h('div', 'hub-grid');
  const unopened = PACK_IDS.reduce((a, id) => a + g.save.progress.packs.unopened[id], 0);
  const free = g.freePackAvailable();
  const tour = g.tournament();
  const tiles: [string, IconName, string, string, () => void, (number | string)?][] = [
    ['career', 'career', 'Career', me ? `${division(div).name}: next fight` : 'Start your career', () => ctx.nav({ s: 'career', div })],
    ['quick', 'glove', 'Quick fight', 'Any fighter, any opponent', () => ctx.startQuick(div)],
    ['tour', 'bracket', 'Tournament', `Weekly bracket · ${weekDaysLeft()}d left`, () => ctx.nav({ s: 'tournament' }), tour.active ? '!' : tour.entriesLeft || undefined],
    ['fighters', 'fighters', 'Fighters', `${Object.keys(g.save.progress.fighters.owned).length} / ${ROSTER.length} owned`, () => ctx.nav({ s: 'fighters' })],
    ['train', 'target', 'Training', 'Practice, drills, moves', () => ctx.nav({ s: 'practice' })],
    ['packs', 'packs', 'Packs', free ? 'Free pack today!' : 'Collect fighters', () => ctx.nav({ s: 'packs' }), unopened + (free ? 1 : 0)],
    ['season', 'season', 'Season', `${seasonName()} · ${seasonDaysLeft()}d left`, () => ctx.nav({ s: 'season' })],
    ['shop', 'shop', 'Shop', 'Gems, offers, No Ads', () => ctx.nav({ s: 'shop' })],
    ['ach', 'medal', 'Awards', `${Object.keys(g.save.achievements).length} / ${ACHIEVEMENTS.length} earned`, () => ctx.nav({ s: 'achievements' })],
  ];
  for (const [cls, ic, title, sub, fn, badge] of tiles) {
    const t = h('button', `tile t-${cls}`);
    const cta = cls === 'career' ? `<span class="cta">${me ? 'Next fight' : 'Start'} ${icon('back', 'fwd')}</span>` : '';
    // a long title gets a short form for narrow phones (CSS picks)
    const short = TILE_SHORT[title];
    const tt = short ? `<span class="long">${title}</span><span class="short">${short}</span>` : title;
    t.innerHTML = `<span class="wm">${icon(ic)}</span><span class="ti">${icon(ic)}</span><span class="tx"><b>${tt}</b><small>${esc(sub)}</small></span>${cta}${badge ? `<span class="badge">${badge}</span>` : ''}`;
    on(t, fn);
    right.appendChild(t);
  }
  body.appendChild(right);
  m.appendChild(body);
  return m;
}

// ---- daily reward -------------------------------------------------------------------------------------------------

export function dailyModal(ctx: MenuCtx, onClose: () => void): HTMLElement | null {
  const g = ctx.game;
  if (!g.dailyAvailable()) return null;
  const today = dailyStatus(g.save).day;
  const back = h('div', 'modal-back');
  const card = h('div', 'modal panel daily');
  const days = DAILY_REWARDS.map((r, i) => {
    const d = i + 1;
    const state = d < today ? 'past' : d === today ? 'today' : '';
    const art = r.pack ? `<span class="mini-pack ${r.pack}">${icon('packs')}</span>` : r.gems ? GEM_ICON : CASH_ICON;
    return `<div class="day ${state}"><b>Day ${d}</b><span class="art">${art}</span>${r.cash ? `<span>${fmt(r.cash)}</span>` : ''}${r.gems ? `<span>${r.gems} gems</span>` : ''}${r.pack ? `<span>${PACKS[r.pack].name}</span>` : ''}${d < today ? `<i class="done">${icon('check')}</i>` : ''}</div>`;
  }).join('');
  card.innerHTML = `<div class="mhead">${icon('gift')}<h2>Daily reward</h2></div><p class="muted">Come back every day: the rewards grow for 7 days in a row.</p><div class="days">${days}</div><button class="btn" data-a="claim">Claim</button>`;
  on(card.querySelector('[data-a=claim]'), () => {
    const r = g.claimDaily();
    if (r) sound.play('claim', { bus: 'music' });
    back.remove();
    if (r) ctx.toast(`Day ${r.day}: ${[r.cash ? `${fmt(r.cash)} cash` : '', r.gems ? `${r.gems} gems` : '', r.pack ? PACKS[r.pack].name : ''].filter(Boolean).join(' + ')}`);
    onClose();
  });
  back.appendChild(card);
  return back;
}

// ---- career -----------------------------------------------------------------------------------------------------

function divTabs(active: DivisionId | 'all', pick: (d: DivisionId | 'all') => void, withAll = false): HTMLElement {
  const t = h('div', 'tabs');
  const list: (DivisionId | 'all')[] = withAll ? ['all', ...DIVISIONS.map(d => d.id)] : DIVISIONS.map(d => d.id);
  for (const d of list) {
    const b = h('button', `tab${d === active ? ' on' : ''}`, d === 'all' ? 'All' : division(d).name.replace("Women's ", 'W. '));
    on(b, () => pick(d));
    t.appendChild(b);
  }
  // keep the chosen tab in view on a narrow screen
  requestAnimationFrame(() => t.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
  return t;
}

export function careerScreen(ctx: MenuCtx, div: DivisionId): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'solid career');
  m.appendChild(topbar(ctx, 'Career'));
  m.appendChild(divTabs(div, d => ctx.nav({ s: 'career', div: d as DivisionId })));
  const c = g.save.progress.career.div[div];
  const body = h('div', 'body career-body');
  // the road to the title, climbing from the bottom
  const lad = h('div', 'ladder scroll');
  for (let t = 0; t < TIERS; t++) {
    const tier = h('div', `tier${t === c.tier ? ' now' : t < c.tier ? ' done' : ''}`);
    let dots = '';
    for (let f = 0; f < FIGHTS_PER_TIER; f++) {
      const won = t < c.tier || (t === c.tier && f < c.fight);
      const next = t === c.tier && f === c.fight;
      dots += `<i class="${f === FIGHTS_PER_TIER - 1 ? 'boss ' : ''}${won ? 'w' : next ? 'n' : ''}"></i>`;
    }
    tier.innerHTML = `<span class="no">${t < c.tier ? icon('check') : t + 1}</span><div class="tt"><b>${TIER_NAMES[t]}</b><div class="dots">${dots}</div></div>`;
    lad.appendChild(tier);
  }
  const title = h('div', `tier title${c.tier >= TIERS ? ' now' : ''}${c.belt ? ' belt' : ''}`);
  title.innerHTML = `<span class="no">${icon('crown')}</span><div class="tt"><b>${c.belt ? `Champion · ${c.defenses} def.` : 'Title'}</b><div class="dots"><i class="${c.belt ? 'w' : c.tier >= TIERS ? 'n' : ''}"></i></div></div>`;
  lad.appendChild(title);
  body.appendChild(lad);
  m.appendChild(body);
  const champ = championPanel(ctx, div);
  if (champ) lad.appendChild(champ);
  const me = g.careerFighter(div);
  if (!me) {
    const empty = h('div', 'vs');
    empty.innerHTML = `<div class="panel empty-card">${icon('packs', 'big')}<h2>No ${esc(division(div).name)} yet</h2><p class="muted">Get a fighter in this division from a pack to start this career.</p><button class="btn" data-a="packs">Get packs</button></div>`;
    on(empty.querySelector('[data-a=packs]'), () => ctx.nav({ s: 'packs' }));
    body.appendChild(empty);
    return m;
  }
  const step = g.careerStep(div);
  if (!step) return m;
  const spec = g.careerSpec(div);
  const vs = h('div', 'vs');
  const opp = step.opponent;
  vs.innerHTML = `<div class="corner red"><div class="por p1 ${me.rarity}"><span class="ovr"><b>${spec ? overall(spec.stats) : '?'}</b><small>OVR</small></span><span class="cn">Red corner</span></div>
      <div class="plate"><div class="name">${nameHtml(me.name)}</div><div class="meta">${me.archetype} · ${division(div).short}</div></div></div>
    <div class="mid"><div class="x">VS</div><div class="stage">${esc(step.label)}</div><div class="rounds">${icon('clock')}${step.rules.rounds ?? 3} rounds</div>
      <button class="btn red fight" data-a="fight">Fight</button><button class="btn ghost small" data-a="change">Change</button></div>
    <div class="corner blue"><div class="por p2 ${opp.rarity}"><span class="ovr"><b>${overall(opp.stats)}</b><small>OVR</small></span><span class="cn">Blue corner</span></div>
      <div class="plate"><div class="name">${nameHtml(opp.name)}</div><div class="meta">${opp.nickname ? `“${esc(opp.nickname)}” · ` : ''}${opp.archetype}</div></div></div>`;
  setPortrait(vs.querySelector('.p1') as HTMLElement, me);
  setPortrait(vs.querySelector('.p2') as HTMLElement, opp as RosterFighter);
  on(vs.querySelector('[data-a=fight]'), () => ctx.startCareer(div));
  on(vs.querySelector('[data-a=change]'), () => ctx.nav({ s: 'fighters', div }));
  body.appendChild(vs);
  return m;
}

// ---- fighters --------------------------------------------------------------------------------------------------

export function fightersScreen(ctx: MenuCtx, div: DivisionId | 'all'): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'solid fighters');
  m.appendChild(topbar(ctx, 'Fighters'));
  m.appendChild(divTabs(div, d => ctx.nav({ s: 'fighters', div: d }), true));
  const grid = h('div', 'cards scroll');
  const list = ROSTER.filter(f => div === 'all' || f.division === div).sort((a, b) => Number(g.owned(b.id)) - Number(g.owned(a.id)) || overall(b.stats) - overall(a.stats));
  for (const f of list) {
    const o = g.save.progress.fighters.owned[f.id];
    const spec = o ? g.spec(f.id) : null;
    const c = fighterCard(f, !!o, o?.stars ?? 0, spec ? overall(spec.stats) : undefined);
    on(c, () => ctx.nav({ s: 'fighter', id: f.id }));
    grid.appendChild(c);
  }
  m.appendChild(grid);
  return m;
}

/** A stat's colour band: the bar is grey-blue, blue, green or gold as the number climbs. */
const band = (v: number) => (v >= 85 ? 'b4' : v >= 70 ? 'b3' : v >= 50 ? 'b2' : 'b1');

export function fighterScreen(ctx: MenuCtx, id: string): HTMLElement {
  const g = ctx.game;
  const f = rosterFighter(id) as RosterFighter;
  const o = g.save.progress.fighters.owned[id];
  const spec = o ? g.spec(id) : null;
  const m = menu(ctx, 'solid fighter');
  m.appendChild(topbar(ctx, f.name));
  const d = h('div', 'detail');
  const side = h('div', 'side scroll');
  const s = spec?.stats ?? f.stats;
  side.innerHTML = `<div class="por ${f.rarity}${o ? '' : ' locked'}"><span class="ovr"><b>${overall(s)}</b><small>OVR</small></span><span class="rar">${RARITY_LABEL[f.rarity]}</span></div>
    <div class="ident"><div class="name">${nameHtml(f.name)}</div>${f.nickname ? `<div class="nick">“${esc(f.nickname)}”</div>` : ''}
      <div class="chips"><span>${division(f.division).name}</span><span>${f.archetype}</span><span class="r ${f.rarity}">${RARITY_LABEL[f.rarity]}</span></div>
      <div class="muted home">${esc(f.hometown)}</div></div>`;
  setPortrait(side.querySelector('.por') as HTMLElement, f);
  if (o) {
    const xpPct = o.level >= MAX_LEVEL ? 100 : Math.round((o.xp / xpToNext(o.level)) * 100);
    const lv = h('div', 'lvl');
    lv.innerHTML = `<div class="row" style="justify-content:space-between"><span class="lv">Level <b>${o.level}</b></span><span class="stars">${'★'.repeat(o.stars)}<i>${'☆'.repeat(5 - o.stars)}</i></span></div><div class="progress"><i style="width:${xpPct}%"></i></div>
      <div class="muted small">Shards ${o.shards}${o.stars < 5 ? ` / ${STAR_COST[o.stars + 1]} for the next star` : ''}</div>`;
    side.appendChild(lv);
    const row = h('div', 'row acts');
    const picked = g.pickedFor(f.division)?.id === id;
    const pickBtn = h('button', `btn ghost${picked ? ' picked' : ''}`, picked ? `${icon('check')}Selected` : 'Use in career');
    on(pickBtn, () => {
      g.pick(id);
      ctx.toast(`${f.name} will fight in ${division(f.division).name}`);
      ctx.nav({ s: 'fighter', id });
    });
    row.appendChild(pickBtn);
    if (o.stars < 5) {
      const sb = h('button', 'btn', `${icon('star')}Star up`);
      if (o.shards < STAR_COST[o.stars + 1]) sb.setAttribute('disabled', '');
      on(sb, () => {
        if (g.starUp(id)) {
          sound.play('starUp', { bus: 'music' });
          ctx.toast(`${f.name} is now ${o.stars}★`);
        }
        ctx.nav({ s: 'fighter', id });
      });
      row.appendChild(sb);
    }
    side.appendChild(row);
  } else {
    side.appendChild(h('div', 'notice', `${icon('lock')}<span>Not in your camp yet. Find this fighter in packs.</span>`));
  }
  side.appendChild(h('p', 'bio', esc(f.bio)));
  d.appendChild(side);
  const stats = h('div', 'stats scroll');
  const busy = g.trainingLeft(id);
  if (o && busy !== null) {
    const bar = h('div', 'training');
    bar.innerHTML = `<span class="tl">${icon('clock')}Training… ${mins(busy)} left</span><span class="row"><button class="btn ghost small" data-a="ad">Watch ad: finish now</button><button class="btn small" data-a="gems">${GEM_ICON}${Math.max(5, Math.ceil(busy / 60000 / 3))} gems</button></span>`;
    on(bar.querySelector('[data-a=ad]'), () => void g.skipTrainingWithAd(id).then(ok => (ok ? ctx.nav({ s: 'fighter', id }) : ctx.toast('No ad available right now'))));
    on(bar.querySelector('[data-a=gems]'), () => (g.skipTrainingWithGems(id) ? ctx.nav({ s: 'fighter', id }) : ctx.toast('Not enough gems')));
    stats.appendChild(bar);
  }
  stats.appendChild(h('div', 'stats-head', `<span>Attributes</span>${o ? '<span>Training</span>' : ''}`));
  for (const k of STAT_KEYS) {
    const row = h('div', `statrow${o ? '' : ' ro'}`);
    const pts = o?.train[k] ?? 0;
    const cap = TRAIN_CAP[f.rarity];
    row.innerHTML = `<span class="k">${STAT_LABEL[k]}</span><div class="bar ${band(s[k])}"><i style="width:${s[k]}%"></i></div><span class="v">${s[k]}</span>`;
    if (o) {
      const maxed = pts >= cap || s[k] >= 100;
      const b = h('button', 'btn ghost train', maxed ? 'Maxed' : `<span>Train</span> ${CASH_ICON}<span>${fmt(trainCost(pts))}</span>${trainMinutes(pts) ? `<small>${trainMinutes(pts)}m</small>` : ''}`);
      if (maxed || busy !== null) b.setAttribute('disabled', '');
      on(b, () => {
        const r = g.train(id, k);
        if (!r.ok) ctx.toast(r.reason === 'funds' ? 'Not enough cash' : r.reason === 'busy' ? 'Already training' : 'This stat is maxed');
        ctx.nav({ s: 'fighter', id });
      });
      row.appendChild(b);
    }
    stats.appendChild(row);
  }
  d.appendChild(stats);
  m.appendChild(d);
  return m;
}

// ---- packs ------------------------------------------------------------------------------------------------------

export function revealModal(ctx: MenuCtx, r: PackResult, cards: CardResult[], onClose: () => void): HTMLElement {
  const v = h('div', 'reveal');
  if (ctx.game.save.settings.reducedMotion) v.classList.add('calm');
  const best = Math.max(...r.cards.map(c => ['common', 'rare', 'epic', 'legend'].indexOf(c.rarity)));
  v.classList.add(`best${best}`);
  r.cards.forEach((_, i) => setTimeout(() => sound.play('cardFlip', { gain: 0.7 }), 250 + i * 450));
  setTimeout(() => sound.play(`reveal${best}`, { bus: 'music' }), 250 + (r.cards.length - 1) * 450 + 200);
  v.innerHTML = `<div class="rays"></div><div class="rhead"><span class="kick">${icon('packs')}Pack opened</span><div class="logo">${PACKS[r.pack].name}${r.pityHit ? ' · <b>Guarantee!</b>' : ''}</div></div>`;
  const row = h('div', 'row cardsrow');
  r.cards.forEach((c, i) => {
    const f = rosterFighter(c.id) as RosterFighter;
    const wrap = h('div', 'rcard');
    const card = fighterCard(f, true);
    card.style.animationDelay = `${0.25 + i * 0.45}s`;
    wrap.appendChild(card);
    wrap.appendChild(h('div', `tag${cards[i].isNew ? ' new' : ''}`, cards[i].isNew ? 'New fighter!' : `+${cards[i].shards} shards`));
    row.appendChild(wrap);
  });
  v.appendChild(row);
  const ok = h('button', 'btn', 'Nice');
  on(ok, () => {
    v.remove();
    onClose();
  });
  v.appendChild(ok);
  return v;
}

function oddsModal(id: PackId): HTMLElement {
  const back = h('div', 'modal-back');
  back.innerHTML = `<div class="modal panel odds"><div class="mhead">${icon('info')}<h2>${PACKS[id].name}: odds</h2></div><ul>${oddsText(id).map(l => `<li>${esc(l)}</li>`).join('')}</ul><button class="btn">OK</button></div>`;
  on(back.querySelector('.btn'), () => back.remove());
  return back;
}

export function packsScreen(ctx: MenuCtx, ui: HTMLElement): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'solid packs');
  m.appendChild(topbar(ctx, 'Packs'));
  const shelf = h('div', 'shelf');
  const paidOk = g.paidPacksAllowed();
  // the free daily pack
  if (g.freePackAvailable()) {
    const fp = h('div', 'pack free');
    fp.innerHTML = `<div class="foil">${packArt('free', 'Free pack', PACKS.standard.cards)}<span class="flag">${icon('gift')}Today</span></div><h3>Free pack</h3><div class="muted small">One Standard Pack a day</div><div class="grow"></div><button class="btn" data-a="free">${isNative ? 'Watch ad: free pack' : 'Claim free pack'}</button>`;
    on(fp.querySelector('[data-a=free]'), () =>
      void g.claimFreePack().then(ok => {
        ctx.toast(ok ? 'Free Standard Pack added' : 'No ad available right now');
        ctx.nav({ s: 'packs' });
        if (ok) ctx.offerReminders();
      }),
    );
    shelf.appendChild(fp);
  }
  for (const id of PACK_IDS) {
    const def = PACKS[id];
    const p = h('div', `pack ${id}`);
    const left = pityLeft(g.save.progress.packs, id);
    const have = g.save.progress.packs.unopened[id];
    const price = def.gems ? `${GEM_ICON}<span>${def.gems} gems</span>` : `${CASH_ICON}<span>${fmt(def.cash)} cash</span>`;
    const blocked = def.paid && !paidOk;
    const pity = left !== null && def.pity ? `<div class="pity"><span>Guaranteed ${def.pity.at} or better within ${left} pack${left === 1 ? '' : 's'}</span><div class="pbar"><i style="width:${Math.round(((def.pity.within - left) / def.pity.within) * 100)}%"></i></div></div>` : '';
    p.innerHTML = `<div class="foil">${packArt(id, def.name, def.cards)}${have > 0 ? `<span class="flag have">${have} to open</span>` : ''}<button class="odds-chip" data-a="odds">${icon('info')}See odds</button></div>
      <h3>${def.name}</h3><div class="muted small">${esc(def.blurb)}</div>${pity}<div class="grow"></div>
      ${have > 0 ? `<button class="btn" data-a="open">Open (${have})</button>` : ''}
      ${blocked ? `<div class="notice small">${icon('ban')}<span>Paid packs aren't available in your country. Earn them by playing.</span></div>` : `<button class="btn buy ${have > 0 ? 'ghost' : ''}" data-a="buy">Buy · ${price}</button>`}`;
    on(p.querySelector('[data-a=odds]'), () => ui.appendChild(oddsModal(id)));
    on(p.querySelector('[data-a=open]'), () => {
      const r = g.openEarned(id);
      if (r.ok) ui.appendChild(revealModal(ctx, r.result, r.cards, () => ctx.nav({ s: 'packs' })));
    });
    on(p.querySelector('[data-a=buy]'), () => {
      // odds are on the card and one tap away; buying is a second, explicit tap
      const r = g.buyPack(id);
      if (r.ok) ui.appendChild(revealModal(ctx, r.result, r.cards, () => ctx.nav({ s: 'packs' })));
      else if (r.reason === 'funds') {
        ctx.toast(def.gems ? 'Not enough gems' : 'Not enough cash');
        if (def.gems) ctx.nav({ s: 'shop' });
      } else ctx.toast("Paid packs aren't available in your country");
    });
    shelf.appendChild(p);
  }
  m.appendChild(shelf);
  return m;
}

// ---- shop -------------------------------------------------------------------------------------------------------

const FALLBACK_PRICE: Record<string, string> = {
  gems_1: '$0.99', gems_2: '$4.99', gems_3: '$9.99', gems_4: '$19.99', gems_5: '$49.99',
  no_ads: '$3.99', starter_pack: '$4.99', season_pass: '$4.99', bundle_champion: '$9.99',
};

export function shopScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'solid shop');
  m.appendChild(topbar(ctx, 'Shop'));
  const shelf = h('div', 'shelf');
  const price = (id: string) => priceOf(id) ?? FALLBACK_PRICE[id] ?? '';
  const buy = (id: string) =>
    void g.buyProduct(id).then(r => {
      if (r === 'purchased') sound.play('buy');
      ctx.toast(r === 'purchased' ? 'Thank you! Your purchase is ready.' : r === 'pending' ? 'Payment pending: it arrives when Google Play confirms it.' : r === 'unavailable' ? 'Purchases work in the Android app.' : r === 'cancelled' ? 'Purchase cancelled' : 'The purchase did not go through');
      ctx.nav({ s: 'shop' });
    });
  type Offer = { id: string; title: string; kind: string; art: string; ribbon?: string; lines: string[]; amt?: string; hide?: boolean };
  const big = (n: IconName) => `<span class="oicon">${icon(n)}</span>`;
  const offers: Offer[] = [
    { id: PRODUCTS.starter, title: 'Starter Pack', kind: 'starter', art: big('gift'), ribbon: 'Hot', hide: g.save.flags.starterPack, amt: `${TUNING.starterGems} gems`, lines: ['No more ad breaks', `This month's Season Pass`, `${fmt(TUNING.starterCash)} cash`, 'One time only'] },
    { id: PRODUCTS.seasonPass, title: 'Season Pass', kind: 'pass', art: big('season'), hide: isPremium(g.save), lines: [`Unlocks the premium track of ${seasonName()}`, 'Double cash every tier, extra gems', 'Lasts this month'] },
    { id: PRODUCTS.noAds, title: 'No Ads', kind: 'noads', art: big('ban'), hide: g.save.flags.noAds, lines: ['Removes ad breaks between fights', 'Optional reward videos stay'] },
    { id: PRODUCTS.bundleChampion, title: 'Champion Bundle', kind: 'bundle', art: big('crown'), hide: g.save.paidBundles.includes(PRODUCTS.bundleChampion), amt: `${TUNING.bundleGems.bundle_champion ?? 0} gems`, lines: ['An epic fighter for your camp', 'Gems to open premium packs'] },
  ];
  for (const [i, id] of (['gems_1', 'gems_2', 'gems_3', 'gems_4', 'gems_5'] as const).entries()) {
    offers.push({ id, title: ['Pouch', 'Bag', 'Chest', 'Vault', 'Treasury'][i] + ' of gems', kind: 'gems', art: gemArt(i + 1), ribbon: i >= 2 ? 'Best value' : undefined, amt: `${fmt(TUNING.gemPacks[id])} gems`, lines: [] });
  }
  for (const o of offers) {
    if (o.hide) continue;
    const c = h('div', `offer k-${o.kind}${o.ribbon ? ' ribboned' : ''}${o.ribbon === 'Hot' ? ' hot' : ''}`);
    c.innerHTML = `${o.ribbon ? `<span class="ribbon">${o.ribbon === 'Hot' ? icon('bolt') : ''}${o.ribbon}</span>` : ''}<div class="oart">${o.art}</div><h3>${o.title}</h3>${o.amt ? `<div class="amt">${GEM_ICON}<span>${o.amt}</span></div>` : ''}${o.lines.length ? `<ul>${o.lines.map(l => `<li>${icon('check')}<span>${esc(l)}</span></li>`).join('')}</ul>` : '<div class="grow"></div>'}<button class="btn">${esc(price(o.id))}</button>`;
    on(c.querySelector('.btn'), () => buy(o.id));
    shelf.appendChild(c);
  }
  m.appendChild(shelf);
  const foot = h('div', 'row foot');
  foot.innerHTML = `<span class="muted small">${storeAvailable() ? 'Prices from Google Play.' : 'Store not connected: purchases work in the Android app.'} Gems are only used inside the game.</span><button class="btn ghost small" data-a="restore">${icon('restore')}Restore purchases</button>`;
  on(foot.querySelector('[data-a=restore]'), () => void g.syncPurchases().then(r => ctx.toast(r ? 'Purchases restored' : 'Could not reach Google Play')));
  m.appendChild(foot);
  return m;
}

// ---- season -----------------------------------------------------------------------------------------------------

export function seasonScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const m = menu(ctx, 'solid season');
  m.appendChild(topbar(ctx, `${seasonName()} · ${seasonDaysLeft()} days left`));
  const sid = seasonId();
  const tier = tierOf(g.save.season.xp);
  const prem = isPremium(g.save);
  const into = tier >= SEASON_TIERS ? TIER_XP : g.save.season.xp % TIER_XP;
  const info = h('div', 'season-info');
  info.innerHTML = `<div class="tierbadge"><small>Tier</small><b>${tier}</b><small>of ${SEASON_TIERS}</small></div>
    <div class="xp"><span>Tier ${tier} / ${SEASON_TIERS} · ${g.save.season.xp % TIER_XP} / ${TIER_XP} xp to the next</span><div class="progress"><i style="width:${Math.round((into / TIER_XP) * 100)}%"></i></div></div>
    ${prem ? `<span class="prem-on">${icon('check')}Premium track unlocked</span>` : '<button class="btn" data-a="pass">Get the Season Pass</button>'}`;
  on(info.querySelector('[data-a=pass]'), () => ctx.nav({ s: 'shop' }));
  m.appendChild(info);
  const track = h('div', 'track');
  const labels = h('div', 'tierbox labels');
  labels.innerHTML = `<div class="num"></div><div class="lab free">Free</div><div class="lab prem">${icon('crown')}Pass</div>`;
  track.appendChild(labels);
  const amounts = (r: { cash: number; gems: number }) =>
    [r.cash ? `<span class="amt">${CASH_ICON}<span>${fmt(r.cash)} cash</span></span>` : '', r.gems ? `<span class="amt">${GEM_ICON}<span>${r.gems} gems</span></span>` : ''].join('');
  let focus: HTMLElement | null = null;
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const box = h('div', `tierbox${t <= tier ? ' reached' : ''}${t === tier + 1 ? ' next' : ''}`);
    const fr = freeReward(t, sid);
    const pr = premiumReward(t, sid);
    const gotF = g.save.season.free.includes(t);
    const gotP = g.save.season.prem.includes(t);
    const canF = !gotF && t <= tier;
    const canP = !gotP && t <= tier && prem;
    box.innerHTML = `<div class="num${t <= tier ? ' on' : ''}"><span>${t}</span></div>
      <div class="rw${gotF ? ' got' : ''}${canF ? ' ready' : ''}">${amounts(fr)}${canF ? '<button class="btn" data-a="f">Claim</button>' : ''}${gotF ? `<i class="done">${icon('check')}</i>` : ''}</div>
      <div class="rw prem${gotP ? ' got' : ''}${canP ? ' ready' : ''}">${amounts(pr)}${canP ? '<button class="btn" data-a="p">Claim</button>' : !prem ? `<i class="lock">${icon('lock')}</i>` : ''}${gotP ? `<i class="done">${icon('check')}</i>` : ''}</div>`;
    if (!focus && (canF || canP || t === tier + 1)) focus = box;
    on(box.querySelector('[data-a=f]'), () => {
      if (g.claimSeason('free', t)) ctx.nav({ s: 'season' });
    });
    on(box.querySelector('[data-a=p]'), () => {
      if (g.claimSeason('prem', t)) ctx.nav({ s: 'season' });
    });
    track.appendChild(box);
  }
  // open the track at the first reward to claim (or the next tier)
  const f = focus as HTMLElement | null;
  if (f) requestAnimationFrame(() => (track.scrollLeft = Math.max(0, f.offsetLeft - 110)));
  m.appendChild(track);
  return m;
}

// ---- settings ----------------------------------------------------------------------------------------------------

export function settingsScreen(ctx: MenuCtx): HTMLElement {
  const m = menu(ctx, 'solid settings-screen');
  m.appendChild(topbar(ctx, 'Settings'));
  const body = h('div', 'scroll settings panel');
  body.appendChild(ctx.settings());
  m.appendChild(body);
  return m;
}
