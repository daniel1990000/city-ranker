# 09 · Ground game (positions, transitions, ground-and-pound, escapes, get-ups)

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/ground.js`.
Tests: `reference/test/ground.test.js`. Submissions from these positions: `10`.

## 1. What the reference exposes

* **Ground positions [DATA]** (13): `none, guard, halfguard, stacked_guard, rubber_guard, sidecontrol, sidesaddle,
  northsouth, crucifix, fullmount, backmount, back_sidemount, sprawl`.
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

## 3. Mechanics **[REC]**

### 3.1 Transitions (the contest)
```
p(top improves)  = clamp( 0.45 + 0.004·(top.groundpassing − bottom.groundcontrol)   # passes
                             + 0.20·[hooks not in] − 0.10·bottom.activeDefence − 0.002·stamina deficit , 0.05, 0.92 )
p(bottom escapes/reverses) = clamp( 0.30 + 0.004·(bottom.groundcontrol − top.groundcontrol)
                             + 0.003·bottom.movement − positionHold[pos] , 0.05, 0.85 )
positionHold     : guard 0.0 · half 0.05 · side 0.15 · north 0.18 · mount 0.25 · crucifix 0.30 · back 0.28
cost             : stamina 4 per attempt; failed attempt gives the opponent 10 ticks of free action
cadence          : at most one transition attempt per 90 ticks per fighter (avoid spam)
```
Input-driven alternative (mobile): a short timing meter per attempt (`10` SnakeMeter). The meter's `difficulty` is derived
from the same ratings delta (see `08` §3.2).

### 3.2 Ground strikes
* Types: hammer/straight/hook (hands), elbow (close), knee (side control/north-south), diving punch (from standing over).
* Damage uses the common pipeline (`04` §5): base × position multiplier × posture multiplier (`upright` 1.0, `broken` 0.5)
  × limb power. Targets: head/body.
* **Defence**: bottom may *cover* (block, 40 % mitigation, stamina cost), *control posture* (pull top down → `broken` for
  45 ticks; contest `groundcontrol`) or *turtle up* (changes floor posture, exposes back).
* Strike stats go to `strikes_ground_*`; ground strikes drive `knockdown`/`TKO` follow-ups (`06` §6).
* Referee protection: unanswered heavy GnP ⇒ TKO rule in `06`.

### 3.3 Get-ups and stand-up
* `getup` attempt (bottom): `p = 0.25 + 0.004·(bottom.movement − top.groundcontrol) + 0.15·[top posture broken] + 0.20·[against cage wall-walk]`
  — success returns both to stand-up at `gap = 0.7 m` (bottom may arrive with a `stance_switch`).
* Referee stand-up on no meaningful activity (no strike/transition/submission attempt) for **10 s** (`fighters_idle`).
* Knocked-down fighter (`floor posture`: back / turtle / fetal / butt-scoot) must first resolve the health event timer (`06`) before attempts.

### 3.4 Ground dominance metrics
`groundDominancePct = topTime / groundTime`; `inDominantStatus` = holds a position with hold ≥ 0.15; counts for the
judge component `ground_dominance` (`12`).

## 4. Acceptance tests (`reference/test/ground.test.js`)
1. Every non-`none` position has ≥ 1 top option, ≥ 1 bottom option, and a defined GnP multiplier.
2. Transition graph is closed (all targets exist) and reaches `fullmount` and `backmount` from `guard` for the top fighter.
3. Success probabilities are bounded and monotone in the rating delta.
4. A broken-posture top strikes at ≤ 0.5× damage.
5. 10 s idle ⇒ `referee_stand_up` event; 3 unanswered heavy strikes ⇒ TKO event (with `06` rules).
6. Stats: `passes_successful` increments only on top-improving transitions; `ground_dominance` computed from time.
