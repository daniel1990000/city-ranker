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
| daily missions (3 a day) | 300-500 each | | 50 season xp each |
| all three missions done | | 10 | 100 season xp |
| achievements (21, once each) | 32,000 in all | 545 in all | 2 Premium Packs |

## Daily missions
Code: `src/meta/missions.ts`. Three a day from a pool of 12, one each from three of four groups (finish, win, volume,
packs / training), the same three for every player on the same calendar day. They pay the moment they are done, and
a new set starts at local midnight on the reward clock (a phone clock moved back can't reopen a day). Season xp from
missions is a bonus outside the daily fight cap. Completing all three is worth about 1,200 cash + 10 gems + 250 season
xp a day: roughly a third more cash for a casual player and half again their daily gems, keeping a Premium Pack about
5-6 days away instead of 8. No mission needs an ad or money ("Open a pack" is met by any earned or cash pack).
Remote-tunable: `missionCashPct`, `missionXp`, `missionBonusGems`, `missionBonusXp` (docs/REMOTE-TUNING.md).

## Achievements
Code: `src/meta/achievements.ts` (mirrored to Play Games; ids in `PGS_ACHIEVEMENTS`). Each pays once, on top of
whatever the moment itself pays. Sizes (remote-tunable together with `achievementPct`):
- 7 easy, 500 cash + 5 gems: first win, first KO/TKO, first submission, first decision, 5 wins, 10 packs opened, a
  7-day login streak.
- 8 medium, 1,500 cash + 20 gems: head-kick finish, a flawless round (10+ strikes landed, no damage taken), win after
  being knocked down, 25 wins, 10 KO/TKO wins, 10 fighters, season tier 10, a first title.
- 6 hard, 2,500 cash + 50 gems: 3 title defences, a win in every division, 25 fighters, a 5-star fighter, 100 wins
  (+ a Premium Pack); all 48 fighters: 4,000 cash + 100 gems + a Premium Pack.
- In all 32,000 cash + 545 gems + 2 Premium Packs (a test keeps gems at 600 or less): about ten casual days of cash
  and three Premium Packs of gems, front-loaded into the first weeks. A fighter only a paid bundle gave doesn't count
  toward the collection goals.

The economy simulation below does not include missions or achievements yet; with them a casual player's first title
should come a few days earlier (still inside the 5-8 week target).

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
