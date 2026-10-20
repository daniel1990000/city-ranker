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
- **Rocked** (a health event): full hurt, or one clean heavy shot / counter on the button (chance from damage,
  lasting head damage and chin). Banner + slow motion + a pulsing screen edge; the rocked fighter wobbles, walks at
  half speed, starts strikes slower and their guard drains twice as fast. Coming through it = "Recovered".
- **Hurt to the body**: a strong body shot (or counter) on a body over 55 % doubles the fighter over for ~1 s (no
  attacks, no guard) and takes 15 % stamina; once a round. Over 90 % a heavy one is a knockdown.
- **Leg hurt**: over 60 % leg damage the fighter limps (slower footwork); at 100 % the leg gives out.
- **Pressure** (anti-mash): the first three clean hits of a string lock the target in place; after that the hit
  reactions get shorter (82 %, 62 %, 48 %, 38 %), and after the 4th the target shells up for 0.6 s (punches land on
  the guard unless they are busy). A blocked strike can be followed up only once and costs 3 extra recovery
  ticks, so the defender gets the next move. An exhausted (gassed) fighter's punches stun 40 % less.
- **Referee**: 8 unanswered strikes on a stunned fighter, or 7 unanswered ground strikes on a hurt one = TKO.
- **Chin** scales head damage 70 %..130 %; **power** and the move's skill stat scale damage; low stamina weakens
  strikes to 60 %.

## Takedowns and the ground
Shoot (14-tick drive) -> a 30-tick sprawl window: pressing sprawl is a real contest (wrestling, defense, stamina,
timing); not pressing it mostly lets them in. Sprawling while the shot is still coming in counts as the earliest
possible sprawl (any downward swipe works from the moment the shot starts). A kick in the air can be caught
(35 % base). On the ground: **guard** and
**mount**. Top: tap = ground-and-pound, swipe up = pass to mount (scramble), swipe down = submission. Bottom:
hold = block, swipe up = escape / stand up (scramble), swipe down from guard = armbar. **Scramble**: an arrow
appears for both (1 s window); the first to swipe it wins (better grapplers get a few ticks' head start; a wrong
swipe locks you out). The AI reads the arrow at a person's speed (0.4 s champion .. 0.7 s beginner).
**Submission**: a tug-of-war of taps starting at 45 %; each tap is worth 380 + the skill (submissions for the
attacker, grappling for the defender), scaled by stamina; 10 s limit, then they escape. The AI taps 4.3 (beginner)
to 7.5 (champion) times a second; a person on a phone manages 6..8. The referee stands the fighters up after 8 s
without progress, and after 20 s on the ground in any case.

## Judging
Three judges, 10-point must, each with a seeded lean toward striking or grappling: power strikes 30, other
landed 12, damage, knockdowns 420, takedowns 100, control time (1 point per 10 ticks), submission attempts. Close rounds follow the
judge's lean. Unanimous / split / majority / draw.

## Balance (scripts/qa/fight-balance.test.ts, AI difficulty 600, equal stats, 20 October 2026)
Archetypes vs the field: brawler 47 %, boxer 37 %, kicker 42 %, wrestler 59 %, grappler 53 %. Finishes: decision
~39 %, KO ~24 %, TKO ~17 %, submission ~20 %; average fight ~3 min 15 s. Human-like bot vs AI difficulty 0 / 250 /
500 / 750 / 1000: 71 / 62 / 47 / 41 / 22 %. +10 on every stat wins ~80 %, +20 ~97 %.

AI rules from the owner's first phone playtest (0.2.0): it covers up under a barrage (once per incoming punch,
beginner 12 % .. champion 50 %, then holds the guard ~0.5 s) and hits back after blocking; it rests 9-14 s between
takedown attempts (11-16 s after a spell on the ground); it jumps on a knocked-down opponent by style (grapplers
and wrestlers 80 %, brawlers 55 %, the rest 25 %). A button-masher (power punches nonstop, no defence) beats a
beginner ~85 % and a champion ~25 % (tests/fight-sim.test.ts pins both ends).
