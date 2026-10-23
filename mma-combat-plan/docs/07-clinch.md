# 07 · Clinch

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/clinch.js`.
Tests: `reference/test/clinch.test.js`.

## 1. What the reference exposes

**Positions [DATA]** (`clinch_positions`): `over_under, double_under, single_collar, thai (plum), back_clinch`, plus the
leg-grab entries `single_leg`, `double_leg` and `none`.

**Roles [DATA/ARCH]**: every clinch has a **dominant (dom)** and **submissive (sub)** fighter. Assets
`DomClinchRatingAsset`, `SubClinchRatingAsset`, `ClinchRatingSpread` (rating difference), `ClinchPositionValueAsset`
(value of each position), `DomLocoAllowed`, `SubLocoAllowed`, `SubControlsLoco`, `DomLStickAngle/Mag`,
`SubLStickAngle/Mag`, and `ClinchLocoController` ⇒ **movement inside a clinch is a negotiated pair-locomotion**: the
dominant fighter's stick drives the pair; the sub may or may not be allowed to influence it.

**Entry outcomes [DATA]** (`audio_event_tracking_types_clinch_*`): `successful`, `denied`, `missed`, `transition`
(position change inside a clinch). Entry types can be enabled per fighter: `clinch_attempt_enable_{double_under,
over_under, thai}` and `thai_whip_attempt_enable` (the Thai whip kick as an entry).

**Transition style [DATA]** (`clinch_transition_style`): `none`, `pummel` (fight for underhooks), `whizzer`.

**Strikes inside the clinch [DATA]**: `clinch_elbow, clinch_hook, clinch_knee, clinch_shoulder, clinch_stomp,
clinch_uppercut` (+ stats thrown/landed/blocked, "clinch strikes landed high").

**Cage interaction [DATA]**: `fence_dominance`, `back_against_cage`, `fence_strikes_{thrown,landed}`; the
clinch-takedown table has dedicated **`cage minor`** variants; cage-assisted strikes.

**Referee [DATA]**: `REFEREE_BREAK_RESET_TO_MIDDLE` (break the clinch, restart centre-octagon), `REFEREE_LOW_ACTION`,
`ref_stoppage_fighters_idle`. Judges score `clinch_dominance`.

**Stats [DATA]**: `CLINCH_CONTROL_PERCENTAGE`, `TIME_SPENT_IN_CLINCH_{CURRENT,ROUND}`, `CLINCH_TYPE_CURRENT`,
`TIME_BETWEEN_CLINCH_{ACTIONS,TYPES}`; training challenges `clinch_control`, `clinch_striking`, `clinch_advanced`; coach
prompts `CLINCH_{GOT,BROKE,SUGGEST_BREAK,ENCOURAGE}`.

## 2. Takedowns available from the clinch — observed matrix **[DATA]**

Key = `clinch_takedown_type_<position>_<role>_<direction fwd|bwd>_<size major|minor|cage-minor>_<move>`.
88 distinct entries; the **moves available per (position, role)**:

| Position | Role | Moves |
|---|---|---|
| over-under | dom | hip throw (high/low), judo throw, double-leg (high/low), single-leg (high/low), low throw |
| over-under | sub | hip throw, judo throw, inside trip (L/R), outside trip, double/single-leg, throw (L/R) |
| double-under (bodylock) | dom | bodylock throw (high/low), double/single-leg (high/low), low throw |
| single-collar (collar tie) | dom | inside trip (L/R), outside trip, leg grab, double/single-leg |
| single-collar | sub | outside trip (L/R), leg grab, double/single-leg |
| thai (plum) | dom | inside trip, outside trip |
| back-clinch | dom | suplex (high/low) |

Notes: (i) the *sub* has fewer, more desperate options; (ii) back-clinch and plum exist only as dominant positions;
(iii) `fwd` vs `bwd` is the direction the pair travels during the throw; (iv) `major` vs `minor` is **[ARCH]**: read as full
takedown (ends in a dominant ground position) vs. partial (scramble / half guard); it mirrors the stand-up table
(`standuptakedowntype{fwd,bwd}{major,minor}` → single-leg-high/low, double-leg-high/low) and the engine has an
`OutputMinorTakedownAsset`.

## 3. Recommended mechanics **[REC]** (as implemented in `reference/src/combat/clinch.js`; all numbers are `clinch.*` tunables)

### 3.1 Entry
```
canAttempt(A,B)   = both standing ∧ A not busy (mid-action, holding a caught leg, trapped) ∧ A's clinch cooldown (30 ticks) elapsed
                    → otherwise the call is ILLEGAL: nothing happens, no event, no stamina
missed            : edge-to-edge gap > clinch.range (0.30 m)                          → CLINCH_ATTEMPT {outcome:'missed'}
rating            : clinchRating(X) = clinchcontrol + skills (iron_clinch +8)
p_success         = clamp( 0.45 + 0.004·(rating(A) − rating(B)) − 0.15·[B mid-strike] − 0.10·[B guard high] , 0.10, 0.90 )   (B helpless: 1)
denied            : A takes +8 recovery, B gets a counter window (18 ticks)           → CLINCH_ATTEMPT {outcome:'denied'}
roles             : p(A is dom) = clamp(0.5 + 0.005·(rating(A) − rating(B)), 0.15, 0.85)   # the spread decides, not who initiated
type              : allowed per fighter — over_under and single_collar for everyone; double_under for wrestlers / judo /
                    jiu-jitsu (or bjj_fighter, rounded_clincher tendency); thai (plum) for muay thai, kickboxers and
                    thai_clincher. A requested type is honoured only if allowed; default = plum for Thai styles,
                    double_under for grapplers, else over_under
cost              : 2 stamina for the attempt, whatever the outcome
```
Order matters for observers: `CLINCH_ATTEMPT` is emitted *before* the bout is constructed, so the log reads
attempt → `CLINCH_START` (a bug in the first draft emitted them the other way round).

### 3.2 State inside the clinch
* The pair shares a centre and an axis (dom → sub); each fighter's facing follows the axis. The **dom stick drives pair
  translation** at `0.40 × baseSpeed × dom.moveSpeedMult`; the sub resists: effective pair velocity =
  `dom·(1 − k) + sub·k` with `k = clinch.resistK (0.3)` if the sub's rating ≥ dom − 10, else `k = 0`. Lateral input rotates
  the axis by ≤ 1.2°/tick (circling).
* Stamina per second (charged directly, not through `stamina.costScale`): dom 0.6, sub 0.9 (resisting), plum dom 0.8.
  Paired regen is also reduced (`stamina.pairedRegenMult`).
* **Cage pin**: when the pair centre is within `cagePinDistance` (0.6 m) of the wall, the dom pushes into it for more
  than 10 ticks, `dom.fenceDominance = true`, `sub.backAgainstCage = true` and the axis turns the sub's back to the fence;
  it releases once the centre is farther than 1.4 × the pin distance. While pinned: cage-minor takedowns
  (+`cageTakedownBonus 0.06`) and the sub's escape chance `−0.25` (`cageEscapePenalty`).
* Positions where **only the dom** may strike or attempt takedowns: `thai` and `back_clinch` (the sub is controlled).

### 3.3 Actions (each is a normal action with frames, cost, cooldown 30 ticks, and stats)
| Action | Notes |
|---|---|
| Strikes: knee (body/head), elbow, uppercut, hook, shoulder, stomp | 7 bundled clinch moves (`data/moves.json`, `mode:'clinch'`). Damage × position (`thai 1.25, over_under 0.8, double_under 0.8, single_collar 0.9, back_clinch 0.85`) × 0.85 for the sub; plum head knees × `plumHeadKneeMult 1.3` and a +0.04 stun chance. The target may block with strength `0.5 × (0.8 + 0.4·blocking/100)` (never strong) |
| Pummel (transition) | Contest `p = clamp(0.40 + 0.004·(score(me) − score(them)), 0.1, 0.9)`, `score = clinchRating + 0.5·movement`. If the **sub** wins, **roles swap**; if the **dom** wins, the **position changes** along the graph `over_under → {double_under, single_collar}`, `double_under → {over_under, back_clinch}`, `single_collar → {over_under, thai}`, `thai → {single_collar}`, `back_clinch → {double_under}` |
| Whizzer | Sub only (not in the plum): for 90 ticks the dom's clinch throws suffer `whizzerPenalty 0.12` |
| Takedown | Table in §2 (`getAvailableTakedowns(position, role)`); hands the pair to a `TakedownBout` (`08`) with `origin:'clinch'`. A stuffed throw returns the pair to the same clinch |
| Break / escape | dom: always succeeds (`released`); sub: `p = clamp(0.35 + 0.004·(sub − dom), 0.05, 0.95) − 0.25·[pinned]` (`escaped`). On a break both reset to `breakGap = 0.9 m` apart, standing, with a 30-tick cooldown |
| Plum knees | In `thai`: head knees × 1.3 damage and +4 % stun chance (included above) |

### 3.4 Time limits and referee
* **No *significant* action for 5 s → `low_action` warning; 8 s → referee break** ("reset to the clinch's break gap"), per
  `clinch.lowActionWarnSeconds / breakSeconds`. Only significant strikes (`STRIKE.significant`), pummel attempts and
  entering the clinch reset the timer. (First draft: 6 s / 12 s — too long; stalled clinches dominated the time-share.)
* Round end with both clinched → break at the bell (`FightSim.#endAllBouts('bell')`).
* All clinch time accumulates into `time.clinch.dom` / `time.clinch.sub` (one bucket per fighter-tick, booked by the sim
  through `timeKeys`).
* The AI releases a clinch only after it has overstayed its time budget (`13`); never merely because it is tired — an
  early version released at 0 stamina and produced endless clinch/break loops.

### 3.5 Scoring hooks (`12`)
`clinch_dominance` raw value = `dom seconds + 2 × clinch strikes landed`; the judge turns the two fighters' raw values into
a share (`12` §4).

## 4. Acceptance tests (`reference/test/clinch.test.js`, all passing)
1. Entry probability rises with `clinchcontrol` spread, falls with striking / high guard; bounds hold; the observed entry
   rate follows the formula.
2. Roles are assigned by spread (statistically), not by who initiated.
3. `getAvailableTakedowns('over_under','sub')` equals the table in §2; `thai`/`dom` returns only trips; dom-only positions
   have no sub options.
4. Attempt outcomes: missed out of range; *illegal* (null) when busy or cooling down; denied gives the defender a counter window.
5. Break resets distance, clears roles and flags, restores modes; stamina drains faster for the sub, plum costs the dom more.
6. Warning then break after the tunable idle times; a significant strike resets the clock.
7. Cage pin sets fence dominance and unlocks the cage bonus; a pinned sub escapes 25 points less often; a takedown hands off to a `TakedownBout`.
8. Plum knees beat over-under knees; the plum sub cannot strike back; pummel swaps roles / moves along the graph.
9. `legalActions` are all executable and deterministic under a fixed seed.
