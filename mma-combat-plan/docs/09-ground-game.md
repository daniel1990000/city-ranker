# 09 · Ground game (positions, transitions, ground-and-pound, escapes, get-ups)

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/ground.js`.
Tests: `reference/test/ground.test.js`. Submissions from these positions: `10`.

## 1. What the reference exposes

* **Ground positions [DATA]** (13): `none, guard, halfguard, stacked_guard, rubber_guard, sidecontrol, sidesaddle,
  northsouth, crucifix, fullmount, backmount, back_sidemount, sprawl`. **`downed` is ours** (a knocked-down fighter lying
  on the floor with the opponent standing over them — the follow-up position, see §3.3); the reference enum has 13, the
  reference code 14.
* **Floor posture of a downed fighter [DATA]**: `back, butt_scoot, face, left_fetal, right_fetal, turtle` (+ default).
* **Roles**: `dom` (top / controlling) and `sub` (bottom) — same vocabulary as the clinch. Transitions are named by role:
  * dom improvements (enable flags): `guard → stacked_guard`, `halfguard → fullmount`, `sidecontrol → crucifix`,
    `sidecontrol → sidesaddle`, plus movement into `backmount` and `rubber_guard` (flags `ground_transition_enable_*`).
  * sub escapes/reversals: `backmount → halfguard`, `fullmount → halfguard`, `northsouth → dom northsouth`,
    `sidecontrol → dom sidecontrol`.
* **Ground strikes [DATA]**: `ground_elbow, ground_hammer(fist), ground_hook, ground_knee, ground_straight`
  (`GroundStrikeController`), "up-down", side-control knees, diving punches, huge elbows. Defensive terms: *blocking*
  and **posture control** (`gnp_defense_good_blocking`, `…_good_posture_control`), flag `FIGHTER_GROUND_POSTURE`,
  `FIGHTER_LEG_HOOKS_IN`, `FLAT_ON_MAT`, `HAS_BACK_ON_GROUND`.
* **Actions [DATA]** (`procedural_action`): `passing`, `ground_escape`, `getup`, `submission`, `takedown`, `clinch_escape`.
  Triggers: `GROUND_POSITION`, `GROUND_MOVEMENT`, `GROUND_PASS_DENIED`, `GROUND_REVERSAL`, `GETS_UP`, `POSTURE`,
  `PROCEDURAL_FALL`.
* **Ratings [DATA]**: `groundcontrol`, `groundpassing` (+ submission/defence ratings).
* **Scoring/stats [DATA]**: `ground_dominance` and `passes_performed/denied` (judges), `GROUND_DOMINANCE_PERCENTAGE`,
  `IN_DOMINANT_STATUS`, passes successful/unsuccessful, sweeps (landed/attempted), "kept on ground" (story).
* **Camera/fight mode [DATA]**: `ground` (and `submission`) are separate camera/fight modes.
* **Training [DATA]**: `ground_bjj`, `ground_wrestling`, `ground_advanced`.

## 2. Position model **[REC]** (graph of what exists above plus the standard BJJ lattice)

State: `{ top, bottom, position, topPosture: 'upright'|'broken', hooksIn, ticksInPosition }`.

| Position | Top (dom) can… | Bottom (sub) can… | GnP power × | Submissions seen in the reference (see 10) |
|---|---|---|---|---|
| **downed** *(ours)* | strikes (×1.1), step in → `sidecontrol` / `fullmount` | stand up when the health event ends, or `recover` → `guard` | 1.10 | — |
| **sprawl** (top over a failed shot) | strikes, spin to `sidecontrol` / `backmount` (if bottom turtles), release | scramble to feet, turn → `guard`/`halfguard`, wall-walk if at cage | 0.7 | top: anaconda, Japanese necktie, Peruvian necktie |
| **guard** | posture up & strike, stack → `stacked_guard`, open guard → `halfguard` (pass) | close guard (control), sweep → reversal, `rubber_guard`, stand-up attempt | 0.55 | top: heel hook · bottom: armbar, triangle, omoplata, guillotine |
| **halfguard** | pass → `sidecontrol`, mount → `fullmount` (flag), crossface strikes | recover `guard`, sweep, underhook → get-up | 0.80 | top: arm-triangle, kneebar, D'Arce · bottom: kimura, twister |
| **stacked_guard** | pass → `sidecontrol`, hold, strikes | roll/escape → `guard` | 0.65 | top: heel hook, kneebar |
| **rubber_guard** | strikes at reduced power, break out to `guard` | controls head/posture | 0.40 | bottom: gogoplata, omoplata, armbar |
| **sidecontrol** | strikes, knees, → `fullmount`, `northsouth`, `crucifix`*, `sidesaddle`*, `backmount` (via turtle) | frame, shrimp → `halfguard`/`guard`, reverse → `dom sidecontrol` | 1.00 | top: Americana, kimura, inverted triangle · bottom: D'Arce |
| **sidesaddle*** | knee-on-belly style strikes, → `fullmount`, `sidecontrol` | escape → `halfguard`, reversal | 0.95 | top: arm-triangle |
| **northsouth** | knees/strikes, → `sidecontrol` | escape, reversal → `dom northsouth` | 1.00 | top: windshield choke |
| **fullmount** | GnP at max power, → `backmount`, subs | bridge, elbow-knee escape → `halfguard`/`guard` | 1.20 | top: armbar, gogoplata, triangle-armbar (+ a mobile-only "ground-and-pound finisher") |
| **crucifix*** | very high power (arms controlled), subs | limited: escape → `halfguard` | 1.30 | top: armbar |
| **backmount** | GnP (limited), RNC, hooks | escape → `halfguard`, defend neck | 0.90 | top: rear-naked choke, armbar |
| **back_sidemount** | transitions to back/side | escape | 0.9 | bottom: rolling kneebar |

Position-code legend used by the reference's submission names **[ARCH]**: `bm` back mount · `cr` crucifix · `fg` full guard ·
`fm` full mount · `hg` half guard · `ns` north-south · `rg` rubber guard · `sc` side control · `sg` stacked guard ·
`sp` sprawl · `ss` side saddle · `bs` back side-mount.

`*` = optional per-fighter "enable" flag (`ground_transition_enable_*`). Power multipliers are original starting values.

## 3. Mechanics **[REC]** (as implemented in `reference/src/combat/ground.js`; `ground.*` tunables)

### 3.1 Transitions (the contest)
```
p(top improves)  = clamp( 0.45 + 0.004·(top.groundpassing − bottom.groundcontrol)            # passes
                             + 0.20·[position has no closed legs]  (guard / rubber_guard have them)
                             − 0.10·[bottom defended actively in the last 40 ticks]
                             − 0.002·max(0, (bottom.stamina% − top.stamina%)·100) + skills.ground ,  0.05, 0.92 )
p(bottom escapes/reverses) = clamp( 0.30 + 0.004·(bottom.groundcontrol − top.groundcontrol)
                             + 0.003·bottom.movement − hold[position] + skills.ground ,  0.05, 0.85 )   (+0.08 if turtled)
sweep / reversal edges (those that swap roles):  p ×= sweepShare (0.35)      edges that need a turtled opponent: p += 0.25
hold[position]  : guard 0 · half 0.05 · stacked 0.05 · rubber 0.05 · side 0.15 · sidesaddle 0.15 · north 0.18 · mount 0.25
                  · crucifix 0.30 · back 0.28 · back_sidemount 0.20 · sprawl 0 · downed 0
cost             : stamina 3 per attempt; a FAILED attempt clears the opponent's ground cooldown (they may act immediately)
cadence          : 90 ticks between a fighter's transition attempts (+30 ticks on entering a bout)
```
The graph itself is data (`GROUND_GRAPH`): per position a list of **top** edges (passes / improvements, some behind a
per-fighter flag — `stack`, `rubber`, `crucifix`, `sidesaddle` — which good ground fighters (`groundcontrol` ≥ 60) have by
default, or behind `needs:'turtle'`) and **bottom** edges (escapes, recoveries, sweeps, reversals). `passes.landed` counts only
top-improving transitions: escapes and sweeps are not passes.
Input-driven alternative (mobile): a short timing meter per attempt (`10` SnakeMeter). The meter's `difficulty` is derived
from the same ratings delta (see `08` §3.2).

### 3.2 Ground strikes
* Six bundled ground moves (`data/moves.json`, `mode:'ground'`): hammerfist, straight, hook, elbow, knee, body punch.
  Only the **top** fighter strikes; a strike resolves at its active frame through the shared `applyImpact` (`06` §4).
* Damage = the common pipeline (`04` §5) × `gnpMult[position]` (guard 0.55 · half 0.80 · stacked 0.65 · rubber 0.40 ·
  side 1.0 · sidesaddle 0.95 · north-south 1.0 · mount 1.2 · crucifix 1.3 · back 0.9 · sprawl 0.7 · downed 1.1)
  × 0.5 while the top fighter's posture is **broken**. Targets: head/body.
* **Defence** (bottom fighter): *cover* (held guard input or the `cover` action: 40 % mitigation, `blocked` outcome),
  *posture control* (`p = clamp(0.4 + 0.004·(bottom.gc − top.gc), 0.1, 0.8)`: top posture `broken` for 45 ticks, 3 stamina)
  or *turtle up* (90 ticks: opens the "exposed back" edges and +0.08 escape chance). Any of these counts as an *active
  defence*, which also protects against the referee's unanswered-strike TKO rule (`06` §6).
* Strike stats go to `strikes.*.ground`; ground strikes drive `knockdown` / TKO follow-ups.

### 3.3 Knockdown follow-up, get-ups and stand-up
* A knocked-down fighter is in `Mode.DOWN` (not yet a ground bout). For 150 ticks (`downedFollowUpTicks`) an opponent within
  1.0 m may commit (`grapple.followUp`) → `GroundBout(position = downed)`; otherwise the downed fighter gets up when the
  event ends (unless their legs are gone, `06` §5). The AI pounces with probability `0.3 + 0.7·aggression`, closes in at once,
  swings every 6–15 ticks while the victim is helpless and does not let go (`13` §2.4).
* `getup` attempt (bottom): `p = clamp(0.40 + 0.004·(bottom.movement − top.groundcontrol) + 0.15·[top posture broken]
  + 0.20·[within 0.25 m of the wall] + 0.35·[sprawl position], 0.05, 0.9)` — success ends the bout and returns both to
  stand-up `0.7 m` apart (`getUpGap`); failure is counted (`failedGetups`, which feeds the leg-injury TKO).
* **Referee**: 5 s without a *significant* strike, transition, get-up or submission attempt → `low_action` warning; **10 s →
  `stand_up`**, both fighters reset to the middle `1.6 m` apart (`standUpGap`).

### 3.4 Ground dominance metrics
`time.ground.top` / `time.ground.bottom` per fighter-tick, plus `time.ground.dominant` when the top fighter holds a position
with hold ≥ 0.15 (side control and better — *not* guard). `dominant` seconds feed the judge component `ground_dominance`
(`12`), and 120 s of dominant time with ≥ 10 ground strikes is one of the 10-8 criteria.

## 4. Acceptance tests (`reference/test/ground.test.js`, all passing)
1. Every position has ≥ 1 top option, ≥ 1 bottom option, a hold value and a GnP multiplier; no dangling targets.
2. From `guard` the top fighter can reach side control, full mount and back mount.
3. Success probabilities are bounded and monotone in the rating delta.
4. A broken-posture top strikes at ≤ 0.5× damage (same dice); cover blocks 40 %; mount hits harder than guard.
5. Transitions change the position and count a pass; a failed attempt gives the opponent a free action.
6. `passes.landed` increments only on top-improving transitions (escapes and sweeps are not passes).
7. Optional transitions need the fighter flag; back mount from side control needs a turtled opponent.
8. Posture control breaks the top posture for 45 ticks, then it recovers.
9. Get-up success restores stand-up at the get-up gap; failure is counted.
10. 5 s without action warns, 10 s stands the fighters up in the middle; a strike or transition attempt resets the clock.
11. Dominance time accrues in held positions (hold ≥ 0.15) and not in guard; `legalActions` are consistent with the graph and respect position and role; a fixed seed gives an identical exchange.
