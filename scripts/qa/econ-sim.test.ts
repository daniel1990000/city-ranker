// Economy simulation: a free player and a light spender over 60 days. Reports time to each career milestone,
// roster collected and currency balances, and checks the targets in docs/ECONOMY.md.
// Run: OUT=/tmp/q/econ.md npx vitest run --config /dev/null scripts/qa/econ-sim.test.ts
import { expect, test } from 'vitest';
import * as fs from 'node:fs';
import { applyCareerResult, careerReward, freshCareer, nextStep, TIERS } from '../../src/meta/career';
import { addXp, freshFighters, giveCard, STARTER_ID, STAT_KEYS, toFightSpec, trainCost, TRAIN_CAP, canStarUp, starUp } from '../../src/meta/fighters';
import { freshPacks, PACKS, rollPack } from '../../src/meta/packs';
import { overall, rosterFighter } from '../../src/meta/roster';
import { DAILY_REWARDS } from '../../src/app/game';
import type { DivisionId } from '../../src/game/fight/types';

interface Player {
  name: string;
  fightsPerDay: number;
  gemsPerWeek: number;
  skill: number; // the player's own edge in OVR points
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Win chance from the overall gap (fit to scripts/qa/fight-balance: +10 overall ~ 75 %). */
const winChance = (gap: number, difficulty: number) => 1 / (1 + Math.exp(-(gap * 0.11 - (difficulty - 500) / 450)));

function simulate(p: Player, days: number, seed: number) {
  const r = rng(seed);
  const fighters = freshFighters();
  const career = freshCareer();
  const packs = freshPacks();
  giveCard(fighters, STARTER_ID);
  let cash = 500;
  let gems = 0;
  const div: DivisionId = 'mLight';
  const out = { titleDay: -1, tierDays: [] as number[], owned: 0, cash: 0, gems: 0, packsOpened: 0, minCash: Infinity, fights: 0, wins: 0 };
  for (let day = 1; day <= days; day++) {
    const d = DAILY_REWARDS[(day - 1) % 7];
    cash += d.cash;
    gems += d.gems + (day % 7 === 0 ? p.gemsPerWeek : 0);
    // free daily pack (rewarded ad) + earned packs
    packs.unopened.standard += 1 + (d.pack === 'standard' ? 1 : 0);
    if (d.pack === 'premium') packs.unopened.premium++;
    for (const id of ['standard', 'premium', 'elite'] as const) {
      while (packs.unopened[id] > 0) {
        packs.unopened[id]--;
        for (const c of rollPack(packs, id, Math.floor(r() * 1e9)).cards) giveCard(fighters, c.id);
        out.packsOpened++;
      }
    }
    for (let f = 0; f < p.fightsPerDay; f++) {
      // best owned lightweight fights
      const mine = Object.keys(fighters.owned).filter(id => rosterFighter(id)?.division === div);
      const best = mine.map(id => toFightSpec(fighters.owned[id], rosterFighter(id)!)).sort((a, b) => overall(b.stats) - overall(a.stats))[0];
      const step = nextStep(career, div, best.id);
      const gap = overall(best.stats) - overall(step.opponent.stats) + p.skill;
      const won = r() < winChance(gap, step.difficulty);
      const method = won && r() < 0.4 ? 'KO' : 'DEC';
      const rw = careerReward(step, won, false, method);
      applyCareerResult(career, step, won, false, method);
      cash += rw.cash;
      gems += rw.gems;
      if (rw.pack) packs.unopened[rw.pack]++;
      addXp(fighters.owned[best.id], rw.xp);
      out.fights++;
      if (won) out.wins++;
      const c = career.div[div];
      if (c.tier > out.tierDays.length && c.tier <= TIERS) out.tierDays.push(day);
      if (c.belt && out.titleDay < 0) out.titleDay = day;
      // spend: train the best fighter's weakest trainable stat, star up, then standard packs, premium packs with gems
      const o = fighters.owned[best.id];
      const base = rosterFighter(best.id)!;
      if (canStarUp(o)) starUp(o);
      const stats = toFightSpec(o, base).stats;
      const k = [...STAT_KEYS].filter(s => (o.train[s] ?? 0) < TRAIN_CAP[base.rarity] && stats[s] < 100).sort((a, b) => stats[a] - stats[b])[0];
      if (k && cash >= trainCost(o.train[k] ?? 0)) {
        cash -= trainCost(o.train[k] ?? 0);
        o.train[k] = (o.train[k] ?? 0) + 1;
      } else if (cash >= PACKS.standard.cash + 3000) {
        cash -= PACKS.standard.cash;
        packs.unopened.standard++;
      }
      if (gems >= PACKS.premium.gems + 50) {
        gems -= PACKS.premium.gems;
        packs.unopened.premium++;
      }
      out.minCash = Math.min(out.minCash, cash);
    }
  }
  out.owned = Object.keys(fighters.owned).length;
  out.cash = cash;
  out.gems = gems;
  return out;
}

test('economy', () => {
  const players: Player[] = [
    { name: 'free, casual (6 fights/day)', fightsPerDay: 6, gemsPerWeek: 0, skill: 0 },
    { name: 'free, keen (12 fights/day)', fightsPerDay: 12, gemsPerWeek: 0, skill: 3 },
    { name: 'light spender (8/day, $5 a week)', fightsPerDay: 8, gemsPerWeek: 550, skill: 1 },
  ];
  const lines = ['# Economy simulation', '', '| player | first title (day) | tier days | fighters owned (of 48) | cash / gems day 60 | packs opened | win % |', '|---|---|---|---|---|---|---|'];
  const res = players.map(p => {
    const runs = [1, 2, 3].map(s => simulate(p, 60, s * 101));
    const avg = (f: (x: (typeof runs)[0]) => number) => Math.round(runs.reduce((a, x) => a + f(x), 0) / runs.length);
    const title = avg(x => (x.titleDay < 0 ? 999 : x.titleDay));
    lines.push(`| ${p.name} | ${title === 999 ? 'not in 60 days' : title} | ${runs[0].tierDays.join(', ')} | ${avg(x => x.owned)} | ${avg(x => x.cash)} / ${avg(x => x.gems)} | ${avg(x => x.packsOpened)} | ${avg(x => (x.wins / x.fights) * 100)} |`);
    return { p, title, minCash: Math.min(...runs.map(x => x.minCash)), owned: avg(x => x.owned) };
  });
  const report = lines.join('\n') + '\n';
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, report);
  else console.log(report);
  // targets: a keen free player wins the first title in ~3-5 weeks; nobody goes negative; collecting continues
  expect(res[1].title).toBeGreaterThanOrEqual(14);
  expect(res[1].title).toBeLessThanOrEqual(42);
  for (const x of res) expect(x.minCash).toBeGreaterThanOrEqual(0);
  for (const x of res) expect(x.owned).toBeGreaterThan(12);
}, 120000);
