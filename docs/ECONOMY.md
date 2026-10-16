# Economy

How Cage Kings earns, spends and paces progress. Code: `src/meta/` (career.ts rewards, fighters.ts levels /
training / stars, packs.ts packs, app/game.ts daily rewards and quick fights) and `src/meta/tuning.ts` (remote-tunable
gem amounts). Simulation: `OUT=/tmp/q/econ.md npx vitest run --config /dev/null scripts/qa/econ-sim.test.ts`.

## Currencies
- **Cash** (soft): fights, daily login, season track. Spent on training and Standard Packs.
- **Gems** (hard): gem bundles (real money), small amounts from bosses, the first title, daily login day 3/6/7, the
  season track. Spent on Premium / Elite packs and on skipping training timers.

## Earning
| source | cash | gems | other |
|---|---|---|---|
| career fight (win) | 150 + 90 per tier, x1.5 for a finish | | 90-215 xp |
| career fight (loss) | 30 % of the win | | half xp |
| boss win | + 300 | 15 + 10 per tier | Standard Pack (Premium from tier 4) |
| first title in a division | + 2000 | 150 | Elite Pack, the belt |
| title won back after losing it | + 500 | 30 | Standard Pack |
| title defence | + 600 | 15 | |
| quick fight | 250 win (375 finish), 100 loss | | 60 / 30 xp |
| daily login (7-day cycle) | 500, 800, -, 1200, -, 1500, - | -, -, 15, -, -, 10, 40 | day 5 Standard, day 7 Premium |
| free daily pack | | | Standard Pack for one rewarded ad a day |
| "Watch ad: double cash" | up to the fight's cash (cap 5000) | | |

## Spending
- Training: `400 * (points + 1)^1.5` cash per point (rounded to 10); timer from the 3rd point (5 min x points², max 4 h),
  skippable with gems (1 gem per 3 minutes, minimum 5) or a rewarded ad.
- Packs: Standard 7,500 cash (2 cards), Premium 160 gems (3 cards, epic+ within 10), Elite 480 gems (3 cards rare+,
  legend within 25). Odds on the pack screen and in `oddsText`.
- Stars: duplicates give shards (10 / 20 / 40 / 80 by rarity); stars 2-5 cost 30 / 60 / 120 / 240 shards.
- Gem bundles: 100 / 550 / 1,200 / 2,600 / 7,000 gems at $0.99 / $4.99 / $9.99 / $19.99 / $49.99 (Play prices are the
  owner's; amounts are remote-tunable).

## Pacing targets and results (15 October 2026, 60 simulated days, 3 seeds)
| player | first title | fighters owned | packs opened |
|---|---|---|---|
| free, casual (6 fights a day) | day ~35 | ~42 of 48 | ~110 |
| free, keen (12 fights a day) | day ~14 | ~44 | ~220 |
| light spender ($5 a week) | day ~20 | ~45 | ~170 |

Targets: a keen free player wins a first belt in 2-5 weeks, a casual one in 5-8; nobody is ever hard-walled (every
fighter can be earned); cash never goes negative; collecting continues through stars (450 shards per fighter to max).

Open: the simulation's win-probability model is a guess (fit to AI-vs-AI balance, not humans). Real win rates by
tier come from the closed test (telemetry `fight_end` with tier and result) and tune `TIER_OFFSET` / AI difficulty.
