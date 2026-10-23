// The menus: hub, career, fighters (+ detail with training and stars), packs (+ reveal), shop, season pass and
// settings. Each screen is a function that builds its DOM from the Game; actions go through Game methods.

import type { DivisionId, FighterStats, Rarity } from '../game/fight/types';
import type { Game } from '../app/game';
import { DAILY_REWARDS } from '../app/game';
import { FIGHTS_PER_TIER, TIER_NAMES, TIERS, careerProgress } from '../meta/career';
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
  | { s: 'practice' };

export interface MenuCtx {
  game: Game;
  nav(r: Route): void;
  back(): void;
  toast(msg: string): void;
  startCareer(div: DivisionId): void;
  startQuick(div: DivisionId): void;
  /** Training Room: a practice fight (ui/practice.ts). */
  startPractice(o: PracticeOptions): void;
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
  void portrait(full).then(url => (el.style.backgroundImage = `url(${url})`));
}

function topbar(ctx: MenuCtx, title: string, back = true): HTMLElement {
  const t = h('div', 'topbar');
  if (back) {
    const b = h('button', 'back', '‹');
    b.setAttribute('aria-label', 'Back');
    on(b, () => ctx.back());
    t.appendChild(b);
  }
  t.appendChild(h('h1', '', esc(title)));
  const w = h('div', 'wallet');
  w.innerHTML = `<div class="pill" data-a="cash"><i class="ico cash"></i><span>${fmt(ctx.game.cash)}</span></div><div class="pill" data-a="gems"><i class="ico gem"></i><span>${fmt(ctx.game.gems)}</span></div>`;
  on(w.querySelector('[data-a=gems]'), () => ctx.nav({ s: 'shop' }));
  t.appendChild(w);
  const g = h('button', 'gear', '⚙');
  g.setAttribute('aria-label', 'Settings');
  on(g, () => ctx.nav({ s: 'settings' }));
  t.appendChild(g);
  return t;
}

/** A fighter card (portrait, overall, name). */
export function fighterCard(f: RosterFighter, owned: boolean, stars = 0, ovr?: number): HTMLElement {
  const c = h('button', `fcard ${f.rarity}${owned ? '' : ' locked'}`);
  c.innerHTML = `<div class="por"></div><div class="ovr">${ovr ?? overall(f.stats)}</div><div class="div">${division(f.division).short}</div>
    <div class="nm"><b>${esc(f.name)}</b><small>${f.archetype} · ${RARITY_LABEL[f.rarity]}</small>${stars ? `<div class="stars">${'★'.repeat(stars)}</div>` : ''}</div>`;
  setPortrait(c.querySelector('.por') as HTMLElement, f);
  return c;
}

// ---- hub -------------------------------------------------------------------------------------------------------

export function hubScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const m = h('div', 'menu');
  m.appendChild(topbar(ctx, '', false));
  const body = h('div', 'body');
  const left = h('div', 'hub-left');
  const div = g.mainDivision();
  const me = g.pickedFor(div);
  const logo = h('div', 'logo', 'Cage <b>Kings</b>');
  logo.style.fontSize = 'clamp(30px, 9vh, 52px)';
  left.appendChild(logo);
  if (me) {
    const spec = g.spec(me.id);
    const c = g.save.progress.career.div[div];
    const fe = h('div', 'featured panel');
    fe.innerHTML = `<div class="por"></div><div class="who"><b>${esc(me.name)}</b><span class="muted">${division(div).name} · OVR ${spec ? overall(spec.stats) : ''}</span>
      <div class="muted" style="font-size:12px;margin-top:4px">${c.belt ? 'Champion 🏆' : TIER_NAMES[Math.min(c.tier, TIERS - 1)]} · ${c.wins}-${c.losses}${c.draws ? '-' + c.draws : ''}</div>
      <div class="progress"><i style="width:${Math.round(careerProgress(c) * 100)}%"></i></div></div>`;
    setPortrait(fe.querySelector('.por') as HTMLElement, me);
    on(fe, () => ctx.nav({ s: 'fighter', id: me.id }));
    left.appendChild(fe);
  }
  const boards = h('button', 'btn ghost boards', 'Leaderboards');
  on(boards, () => ctx.boards());
  left.appendChild(boards);
  body.appendChild(left);
  const right = h('div', 'hub-right');
  const unopened = PACK_IDS.reduce((a, id) => a + g.save.progress.packs.unopened[id], 0);
  const tiles: [string, string, string, () => void, number?][] = [
    ['primary', 'Career', me ? `${division(div).name}: next fight` : 'Start your career', () => ctx.nav({ s: 'career', div })],
    ['', 'Quick fight', 'Any fighter, any opponent', () => ctx.startQuick(div)],
    ['', 'Fighters', `${Object.keys(g.save.progress.fighters.owned).length} / ${ROSTER.length} owned`, () => ctx.nav({ s: 'fighters' })],
    ['', 'Packs', g.freePackAvailable() ? 'Free pack today!' : 'Collect fighters', () => ctx.nav({ s: 'packs' }), unopened + (g.freePackAvailable() ? 1 : 0)],
    ['', 'Season', `${seasonName()} · ${seasonDaysLeft()}d left`, () => ctx.nav({ s: 'season' })],
    ['', 'Shop', 'Gems, offers, No Ads', () => ctx.nav({ s: 'shop' })],
  ];
  for (const [cls, title, sub, fn, badge] of tiles) {
    const t = h('button', `tile ${cls}`);
    t.innerHTML = `<b>${title}</b><small>${esc(sub)}</small>${badge ? `<span class="badge">${badge}</span>` : ''}`;
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
  const back = h('div', 'modal-back');
  const card = h('div', 'modal panel');
  card.innerHTML = `<h2>Daily reward</h2><p class="muted">Come back every day: the rewards grow for 7 days in a row.</p><div class="row" style="flex-wrap:wrap;gap:6px;margin:10px 0">${DAILY_REWARDS.map(
    (r, i) => `<div class="rw" style="flex:0 0 66px;min-height:66px"><b>Day ${i + 1}</b>${r.cash ? `<span>${fmt(r.cash)}</span>` : ''}${r.gems ? `<span>${r.gems} gems</span>` : ''}${r.pack ? `<span>${PACKS[r.pack].name}</span>` : ''}</div>`,
  ).join('')}</div><button class="btn" data-a="claim">Claim</button>`;
  on(card.querySelector('[data-a=claim]'), () => {
    const r = g.claimDaily();
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
  return t;
}

export function careerScreen(ctx: MenuCtx, div: DivisionId): HTMLElement {
  const g = ctx.game;
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, 'Career'));
  m.appendChild(divTabs(div, d => ctx.nav({ s: 'career', div: d as DivisionId })));
  const c = g.save.progress.career.div[div];
  const lad = h('div', 'ladder');
  for (let t = 0; t < TIERS; t++) {
    const tier = h('div', `tier${t === c.tier ? ' now' : t < c.tier ? ' done' : ''}`);
    let dots = '';
    for (let f = 0; f < FIGHTS_PER_TIER; f++) {
      const won = t < c.tier || (t === c.tier && f < c.fight);
      const next = t === c.tier && f === c.fight;
      dots += `<i class="${f === FIGHTS_PER_TIER - 1 ? 'boss ' : ''}${won ? 'w' : next ? 'n' : ''}"></i>`;
    }
    tier.innerHTML = `<b>${TIER_NAMES[t]}</b><div class="dots">${dots}</div>`;
    lad.appendChild(tier);
  }
  const title = h('div', `tier${c.tier >= TIERS ? ' now' : ''}`);
  title.innerHTML = `<b>${c.belt ? `Champion · ${c.defenses} def.` : 'Title'}</b><div class="dots"><i class="${c.belt ? 'w' : c.tier >= TIERS ? 'n' : ''}"></i></div>`;
  lad.appendChild(title);
  m.appendChild(lad);
  const me = g.pickedFor(div);
  if (!me) {
    const empty = h('div', 'vs');
    empty.innerHTML = `<div class="panel" style="padding:18px;text-align:center;max-width:420px"><h2 style="font-family:var(--display);text-transform:uppercase;margin:0 0 6px">No ${esc(division(div).name)} yet</h2><p class="muted">Get a fighter in this division from a pack to start this career.</p><button class="btn" data-a="packs">Get packs</button></div>`;
    on(empty.querySelector('[data-a=packs]'), () => ctx.nav({ s: 'packs' }));
    m.appendChild(empty);
    return m;
  }
  const step = g.careerStep(div);
  if (!step) return m;
  const spec = g.spec(me.id);
  const vs = h('div', 'vs');
  const opp = step.opponent;
  vs.innerHTML = `<div class="side"><div class="por p1"></div><div class="nm">${esc(me.name)}</div><div class="muted">OVR ${spec ? overall(spec.stats) : '?'} · ${me.archetype}</div><button class="btn ghost" data-a="change" style="margin-top:6px;padding:6px 12px;font-size:13px">Change</button></div>
    <div class="mid"><div class="x">VS</div><div class="muted">${esc(step.label)}</div><div class="muted" style="font-size:12px">${step.rules.rounds ?? 3} rounds</div><button class="btn red" data-a="fight" style="margin-top:12px">Fight</button></div>
    <div class="side"><div class="por p2"></div><div class="nm">${esc(opp.name)}</div><div class="muted">${opp.nickname ? `“${esc(opp.nickname)}” · ` : ''}OVR ${overall(opp.stats)} · ${opp.archetype}</div></div>`;
  setPortrait(vs.querySelector('.p1') as HTMLElement, me);
  setPortrait(vs.querySelector('.p2') as HTMLElement, opp as RosterFighter);
  on(vs.querySelector('[data-a=fight]'), () => ctx.startCareer(div));
  on(vs.querySelector('[data-a=change]'), () => ctx.nav({ s: 'fighters', div }));
  m.appendChild(vs);
  return m;
}

// ---- fighters --------------------------------------------------------------------------------------------------

export function fightersScreen(ctx: MenuCtx, div: DivisionId | 'all'): HTMLElement {
  const g = ctx.game;
  const m = h('div', 'menu solid');
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

export function fighterScreen(ctx: MenuCtx, id: string): HTMLElement {
  const g = ctx.game;
  const f = rosterFighter(id) as RosterFighter;
  const o = g.save.progress.fighters.owned[id];
  const spec = o ? g.spec(id) : null;
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, f.name));
  const d = h('div', 'detail');
  const side = h('div', 'side');
  side.innerHTML = `<div class="por"></div><div><b style="font-family:var(--display);font-size:20px;text-transform:uppercase">${esc(f.name)}</b>${f.nickname ? `<div class="muted">“${esc(f.nickname)}”</div>` : ''}<div class="muted" style="font-size:12px">${esc(f.hometown)} · ${division(f.division).name}</div><div class="muted" style="font-size:12px">${RARITY_LABEL[f.rarity]} ${f.archetype}</div></div>
    <p class="muted" style="font-size:12px;margin:0">${esc(f.bio)}</p>`;
  setPortrait(side.querySelector('.por') as HTMLElement, f);
  if (o) {
    const xpPct = o.level >= MAX_LEVEL ? 100 : Math.round((o.xp / xpToNext(o.level)) * 100);
    const lv = h('div', '');
    lv.innerHTML = `<div class="row" style="justify-content:space-between"><span>Level ${o.level}</span><span class="stars">${'★'.repeat(o.stars)}${'☆'.repeat(5 - o.stars)}</span></div><div class="progress"><i style="width:${xpPct}%"></i></div>
      <div class="muted" style="font-size:12px;margin-top:4px">Shards ${o.shards}${o.stars < 5 ? ` / ${STAR_COST[o.stars + 1]} for the next star` : ''}</div>`;
    side.appendChild(lv);
    const row = h('div', 'row');
    const pickBtn = h('button', 'btn ghost', g.pickedFor(f.division)?.id === id ? 'Selected' : 'Use in career');
    on(pickBtn, () => {
      g.pick(id);
      ctx.toast(`${f.name} will fight in ${division(f.division).name}`);
      ctx.nav({ s: 'fighter', id });
    });
    row.appendChild(pickBtn);
    if (o.stars < 5) {
      const sb = h('button', 'btn', 'Star up');
      if (o.shards < STAR_COST[o.stars + 1]) sb.setAttribute('disabled', '');
      on(sb, () => {
        if (g.starUp(id)) ctx.toast(`${f.name} is now ${o.stars}★`);
        ctx.nav({ s: 'fighter', id });
      });
      row.appendChild(sb);
    }
    side.appendChild(row);
  } else {
    side.appendChild(h('div', 'muted', 'Not in your camp yet. Find this fighter in packs.'));
  }
  d.appendChild(side);
  const stats = h('div', 'scroll');
  stats.style.flex = '1';
  const busy = g.trainingLeft(id);
  if (o && busy !== null) {
    const bar = h('div', 'panel');
    bar.style.cssText = 'padding:8px 10px;margin-bottom:6px;display:flex;align-items:center;gap:8px;justify-content:space-between';
    bar.innerHTML = `<span>Training… ${mins(busy)} left</span><span class="row"><button class="btn ghost" data-a="ad" style="padding:6px 10px;font-size:12px">Watch ad: finish now</button><button class="btn" data-a="gems" style="padding:6px 10px;font-size:12px">${Math.max(5, Math.ceil(busy / 60000 / 3))} gems</button></span>`;
    on(bar.querySelector('[data-a=ad]'), () => void g.skipTrainingWithAd(id).then(ok => (ok ? ctx.nav({ s: 'fighter', id }) : ctx.toast('No ad available right now'))));
    on(bar.querySelector('[data-a=gems]'), () => (g.skipTrainingWithGems(id) ? ctx.nav({ s: 'fighter', id }) : ctx.toast('Not enough gems')));
    stats.appendChild(bar);
  }
  const s = spec?.stats ?? f.stats;
  for (const k of STAT_KEYS) {
    const row = h('div', 'statrow');
    const pts = o?.train[k] ?? 0;
    const cap = TRAIN_CAP[f.rarity];
    row.innerHTML = `<span>${STAT_LABEL[k]}</span><div class="bar"><i style="width:${s[k]}%"></i></div><span class="v">${s[k]}</span>`;
    if (o) {
      const b = h('button', 'btn ghost', pts >= cap || s[k] >= 100 ? 'Maxed' : `Train ${fmt(trainCost(pts))}${trainMinutes(pts) ? ` · ${trainMinutes(pts)}m` : ''}`);
      if (pts >= cap || s[k] >= 100 || busy !== null) b.setAttribute('disabled', '');
      on(b, () => {
        const r = g.train(id, k);
        if (!r.ok) ctx.toast(r.reason === 'funds' ? 'Not enough cash' : r.reason === 'busy' ? 'Already training' : 'This stat is maxed');
        ctx.nav({ s: 'fighter', id });
      });
      row.appendChild(b);
    } else row.appendChild(h('span', ''));
    stats.appendChild(row);
  }
  d.appendChild(stats);
  m.appendChild(d);
  return m;
}

// ---- packs ------------------------------------------------------------------------------------------------------

export function revealModal(ctx: MenuCtx, r: PackResult, cards: CardResult[], onClose: () => void): HTMLElement {
  const v = h('div', 'reveal');
  const best = Math.max(...r.cards.map(c => ['common', 'rare', 'epic', 'legend'].indexOf(c.rarity)));
  setTimeout(() => sound.play(`reveal${best}`), 250 + (r.cards.length - 1) * 450);
  v.innerHTML = `<div class="logo" style="font-size:28px">${PACKS[r.pack].name}${r.pityHit ? ' · <b>Guarantee!</b>' : ''}</div>`;
  const row = h('div', 'row');
  r.cards.forEach((c, i) => {
    const f = rosterFighter(c.id) as RosterFighter;
    const wrap = h('div', '');
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
  void ctx;
  return v;
}

function oddsModal(id: PackId): HTMLElement {
  const back = h('div', 'modal-back');
  back.innerHTML = `<div class="modal panel"><h2>${PACKS[id].name}: odds</h2><ul>${oddsText(id).map(l => `<li>${esc(l)}</li>`).join('')}</ul><button class="btn">OK</button></div>`;
  on(back.querySelector('.btn'), () => back.remove());
  return back;
}

export function packsScreen(ctx: MenuCtx, ui: HTMLElement): HTMLElement {
  const g = ctx.game;
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, 'Packs'));
  const shelf = h('div', 'shelf');
  const paidOk = g.paidPacksAllowed();
  // the free daily pack
  if (g.freePackAvailable()) {
    const fp = h('div', 'pack');
    fp.innerHTML = `<h3>Free pack</h3><div class="art">🎁</div><div class="muted" style="font-size:12px">One Standard Pack a day</div><button class="btn" data-a="free">${isNative ? 'Watch ad: free pack' : 'Claim free pack'}</button>`;
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
    const price = def.gems ? `${def.gems} gems` : `${fmt(def.cash)} cash`;
    const blocked = def.paid && !paidOk;
    p.innerHTML = `<h3>${def.name}</h3><div class="art">${def.cards}×</div><div class="muted" style="font-size:12px">${esc(def.blurb)}</div>
      ${left !== null ? `<div class="pity">Guaranteed ${def.pity?.at} or better within ${left} pack${left === 1 ? '' : 's'}</div>` : ''}
      <button class="link" data-a="odds">See odds</button>
      ${have > 0 ? `<button class="btn" data-a="open">Open (${have})</button>` : ''}
      ${blocked ? `<div class="muted" style="font-size:11px">Paid packs aren't available in your country. Earn them by playing.</div>` : `<button class="btn ${have > 0 ? 'ghost' : ''}" data-a="buy">Buy · ${price}</button>`}`;
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
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, 'Shop'));
  const shelf = h('div', 'shelf');
  const price = (id: string) => priceOf(id) ?? FALLBACK_PRICE[id] ?? '';
  const buy = (id: string) =>
    void g.buyProduct(id).then(r => {
      if (r === 'purchased') sound.play('buy');
      ctx.toast(r === 'purchased' ? 'Thank you! Your purchase is ready.' : r === 'pending' ? 'Payment pending: it arrives when Google Play confirms it.' : r === 'unavailable' ? 'Purchases work in the Android app.' : r === 'cancelled' ? 'Purchase cancelled' : 'The purchase did not go through');
      ctx.nav({ s: 'shop' });
    });
  const offers: { id: string; title: string; hot?: boolean; lines: string[]; amt?: string; hide?: boolean }[] = [
    { id: PRODUCTS.starter, title: 'Starter Pack', hot: true, hide: g.save.flags.starterPack, amt: `${TUNING.starterGems} gems`, lines: ['No more ad breaks', `This month's Season Pass`, `${fmt(TUNING.starterCash)} cash`, 'One time only'] },
    { id: PRODUCTS.seasonPass, title: 'Season Pass', hide: isPremium(g.save), lines: [`Unlocks the premium track of ${seasonName()}`, 'Double cash every tier, extra gems', 'Lasts this month'] },
    { id: PRODUCTS.noAds, title: 'No Ads', hide: g.save.flags.noAds, lines: ['Removes ad breaks between fights', 'Optional reward videos stay'] },
    { id: PRODUCTS.bundleChampion, title: 'Champion Bundle', hide: g.save.paidBundles.includes(PRODUCTS.bundleChampion), amt: `${TUNING.bundleGems.bundle_champion ?? 0} gems`, lines: ['An epic fighter for your camp', 'Gems to open premium packs'] },
  ];
  for (const [i, id] of (['gems_1', 'gems_2', 'gems_3', 'gems_4', 'gems_5'] as const).entries()) {
    offers.push({ id, title: ['Pouch', 'Bag', 'Chest', 'Vault', 'Treasury'][i] + ' of gems', amt: `${fmt(TUNING.gemPacks[id])} gems`, lines: i >= 2 ? ['Best value'] : [] });
  }
  for (const o of offers) {
    if (o.hide) continue;
    const c = h('div', `offer${o.hot ? ' hot' : ''}`);
    c.innerHTML = `<h3>${o.title}</h3>${o.amt ? `<div class="amt">${o.amt}</div>` : ''}<ul>${o.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul><button class="btn">${esc(price(o.id))}</button>`;
    on(c.querySelector('.btn'), () => buy(o.id));
    shelf.appendChild(c);
  }
  m.appendChild(shelf);
  const foot = h('div', 'row');
  foot.style.justifyContent = 'space-between';
  foot.innerHTML = `<span class="muted" style="font-size:11px">${storeAvailable() ? 'Prices from Google Play.' : 'Store not connected: purchases work in the Android app.'} Gems are only used inside the game.</span><button class="btn ghost" data-a="restore" style="padding:6px 12px;font-size:12px">Restore purchases</button>`;
  on(foot.querySelector('[data-a=restore]'), () => void g.syncPurchases().then(r => ctx.toast(r ? 'Purchases restored' : 'Could not reach Google Play')));
  m.appendChild(foot);
  return m;
}

// ---- season -----------------------------------------------------------------------------------------------------

export function seasonScreen(ctx: MenuCtx): HTMLElement {
  const g = ctx.game;
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, `${seasonName()} · ${seasonDaysLeft()} days left`));
  const sid = seasonId();
  const tier = tierOf(g.save.season.xp);
  const prem = isPremium(g.save);
  const info = h('div', 'row');
  info.style.justifyContent = 'space-between';
  info.innerHTML = `<span>Tier ${tier} / ${SEASON_TIERS} · ${g.save.season.xp % TIER_XP} / ${TIER_XP} xp to the next</span>${prem ? '<span class="muted">Premium track unlocked</span>' : '<button class="btn" data-a="pass" style="padding:6px 14px;font-size:14px">Get the Season Pass</button>'}`;
  on(info.querySelector('[data-a=pass]'), () => ctx.nav({ s: 'shop' }));
  m.appendChild(info);
  const track = h('div', 'track');
  for (let t = 1; t <= SEASON_TIERS; t++) {
    const box = h('div', 'tierbox');
    const fr = freeReward(t, sid);
    const pr = premiumReward(t, sid);
    const gotF = g.save.season.free.includes(t);
    const gotP = g.save.season.prem.includes(t);
    const text = (r: { cash: number; gems: number }) => [r.cash ? `${fmt(r.cash)} cash` : '', r.gems ? `${r.gems} gems` : ''].filter(Boolean).join('<br/>');
    box.innerHTML = `<div class="num${t <= tier ? ' on' : ''}">${t}</div>
      <div class="rw${gotF ? ' got' : ''}">${text(fr)}${!gotF && t <= tier ? '<button class="btn" data-a="f">Claim</button>' : ''}</div>
      <div class="rw prem${gotP ? ' got' : ''}">${text(pr)}${!gotP && t <= tier && prem ? '<button class="btn" data-a="p">Claim</button>' : !prem ? '<span class="muted">🔒</span>' : ''}</div>`;
    on(box.querySelector('[data-a=f]'), () => {
      if (g.claimSeason('free', t)) ctx.nav({ s: 'season' });
    });
    on(box.querySelector('[data-a=p]'), () => {
      if (g.claimSeason('prem', t)) ctx.nav({ s: 'season' });
    });
    track.appendChild(box);
  }
  m.appendChild(track);
  return m;
}

// ---- settings ----------------------------------------------------------------------------------------------------

export function settingsScreen(ctx: MenuCtx): HTMLElement {
  const m = h('div', 'menu solid');
  m.appendChild(topbar(ctx, 'Settings'));
  const body = h('div', 'scroll settings');
  body.appendChild(ctx.settings());
  m.appendChild(body);
  return m;
}
