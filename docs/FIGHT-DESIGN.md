# Fight design

How a Cage Kings fight works and why the numbers are what they are. Code: `src/game/fight/` (`moves.ts` frame data,
`sim.ts` standing, `ground.ts` takedowns and the ground, `judges.ts` scoring, `ai.ts` the opponent). Tests:
`tests/fight-sim.test.ts`. Balance report: `OUT=/tmp/q/balance.md RUNS=30 npx vitest run --config /dev/null
scripts/qa/fight-balance.test.ts`.

## Principles
- **Deterministic**: 60 ticks a second, integer maths only, one seeded RNG in the state. Same seed + inputs = same
  fight on every phone (needed for replays, the weekly tournament and later online play). A tick costs ~0.002 ms.
- **Readable**: every attack has a wind-up (startup) you can see and react to, a short active window and a recovery
  you can punish. Clip name = action id, so what you see is exactly what the simulation is doing.
- **Rock-paper-scissors with skill on top**: block beats punches but not low kicks; slips beat straights and the
  hook from the far side; a sway beats head shots but not lunges; a perfect evade opens a counter window
  (+60 % damage); takedowns beat strikers who throw kicks carelessly; sprawls beat lazy shots.

## Frame data (ticks at 60 Hz; damage before power, stamina and chin)
| move | startup | active | recovery | reach mm | damage | zone | beaten by |
|---|---|---|---|---|---|---|---|
| jab | 6 | 3 | 10 | 1150 | 330 | head | block, slips, sway |
| cross | 10 | 3 | 15 | 1200 | 760 | head | block, slips, sway |
| hookL / hookR | 11 / 12 | 3 | 16 / 17 | 960 | 860 / 960 | head | block, slip right / left, sway |
| uppercut | 12 | 3 | 19 | 820 | 1000 | head | block, sway |
| bodyShot | 10 | 3 | 15 | 900 | 880 | body | block |
| lowKick | 12 | 3 | 17 | 1250 | 780 | legs | stepping back (unblockable) |
| bodyKick | 15 | 4 | 21 | 1320 | 1250 | body | block |
| headKick | 20 | 4 | 25 | 1360 | 1600 | head | block, sway |
| superman (special) | 16 | 4 | 22 | 1250 + 520 lunge | 1600 | head | block, slips |
| flyingKnee (special) | 18 | 4 | 24 | 1050 + 640 lunge | 2000 | head | block |
| spinBackfist (special) | 15 | 4 | 22 | 1150 | 1500 | head | block, sway |

Combos: a strike that hits or is blocked can be cancelled 4 ticks into its recovery; each link is 2 ticks faster
(minimum 4) and +5 % damage, up to 4 links.

## Damage model (meters 0..10000)
- **Head**: a quarter of each head hit stays as lasting damage (KO risk, swelling on the face); 1.5x goes into
  **hurt**, a short-term wobble that drains. Full hurt = **stunned** (slow, weak guard). A heavy shot on a
  stunned fighter, or a big clean shot (chance), is a **knockdown**: severity = lasting head damage + previous
  knockdowns + counter bonus + luck; 100+ = **KO**, otherwise they get up (tap to rise sooner), unless the
  attacker jumps on them (ground-and-pound from mount). Third knockdown = TKO.
- **Body**: drains stamina now and lowers the stamina ceiling for the rest of the fight.
- **Legs**: slow footwork; the leg giving out is a knockdown, the second time a TKO.
- **Referee**: 8 unanswered strikes on a stunned fighter, or 7 unanswered ground strikes on a hurt one = TKO.
- **Chin** scales head damage 70 %..130 %; **power** and the move's skill stat scale damage; low stamina weakens
  strikes to 60 %.

## Takedowns and the ground
Shoot (14-tick drive) -> a 20-tick sprawl window: pressing sprawl is a real contest (wrestling, defense, stamina,
timing); not pressing it mostly lets them in. A kick in the air can be caught. On the ground: **guard** and
**mount**. Top: tap = ground-and-pound, swipe up = pass to mount (scramble), swipe down = submission. Bottom:
hold = block, swipe up = escape / stand up (scramble), swipe down from guard = armbar. **Scramble**: an arrow
appears for both; the first to swipe it wins (better grapplers get a few ticks' head start; a wrong swipe locks you
out). **Submission**: a tug-of-war of taps; submissions vs grappling and stamina weight each tap; 10 s limit, then
they escape. The referee stands an idle ground fight up after 10 s.

## Judging
Three judges, 10-point must, each with a seeded lean toward striking or grappling: power strikes 30, other
landed 12, damage, knockdowns 420, takedowns 120, control time, submission attempts. Close rounds follow the
judge's lean. Unanimous / split / majority / draw.

## Balance (scripts/qa/fight-balance.test.ts, AI difficulty 600, equal stats, 15 October 2026)
Archetypes vs the field: brawler 40 %, boxer 39 %, kicker 42 %, wrestler 58 %, grappler 62 %. Finishes: decision
~60 %, KO ~12 %, TKO ~10 %, submission ~12 %; average fight ~3 min 50 s (3 x 90 s rounds). +10 on every stat wins
~75 %, +20 ~100 %: opponent stats are the main difficulty lever in the career, AI difficulty the second.
Open: the difficulty curve against the human-like bot is shallow (49 % -> 35 %); real touch play will be tuned
from phone tests.
