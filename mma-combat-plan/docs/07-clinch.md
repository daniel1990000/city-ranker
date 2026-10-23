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

## 3. Recommended mechanics **[REC]**

### 3.1 Entry
```
canAttempt(A,B)   = gap ≤ clinchRange(0.30 m) ∧ A not in strike recovery ∧ A.mode == standup ∧ B not already grappled
type              = fighter-enabled and facing-dependent: plum (thai) if style=muay_thai ∧ B.head forward ;
                    double_under if style ∈ wrestler ; else over_under ; single_collar after a collar tie input
p_success         = clamp( 0.45 + 0.004·(A.clinchcontrol − B.clinchcontrol) − 0.15·[B is striking] − 0.10·[B guarding high] , 0.10, 0.90 )
outcomes          = success | denied (B pushes off / counter-strikes A with a hit chance) | missed (out of range, A in recovery)
roles             = spread = A.clinchcontrol − B.clinchcontrol ; p(A dom) = clamp(0.5 + spread/200, 0.15, 0.85)
```
### 3.2 State inside the clinch
* The pair shares a centre; each fighter keeps a facing; the **dom stick drives pair translation** at `0.40 × walkSpeed`;
  the sub may resist: effective pair velocity = `dom·(1 − k) + sub·k` with `k = 0.3` if `SubControlsLoco`
  (sub clinchcontrol ≥ dom − 10), else 0.
* Stamina: `StaminaCostPerSecond` dom 1.0, sub 1.4 (resisting), plum 1.3.
* **Cage pin**: if pair centre is within 0.6 m of the wall and dom pushes into it, flags flip:
  `dom.fenceDominance = true`, `sub.backAgainstCage = true`; cage-minor takedowns and cage strikes unlock; sub's escape
  chance −25 %.

### 3.3 Actions (each is a normal action with frames, cost, and stats)
| Action | Notes |
|---|---|
| Strikes: knee (body/head), elbow, uppercut, hook, shoulder, stomp | Damage scaled by position (plum: knees ×1.25; over-under: ×0.8); the sub can block only with `clinch_block` (strength 0.5) |
| Pummel / whizzer (transition) | Contest `clinchcontrol`+movement; success swaps role or changes position (over-under ⇄ double-under ⇄ collar) |
| Takedown | Table in §2; success `p = base[move] + 0.004·(takedown − takedowndefense) + 0.003·(clinchthrows − …)`; defender may counter (`08` §4) |
| Break / escape | `p = 0.35 + 0.004·(B.clinchcontrol − A.clinchcontrol)`, dom may release voluntarily; on break both reset to `gap = 0.9 m` |
| Plum knees | In `thai`: head knees ×1.3 damage, extra stun chance (+4 %) |

### 3.4 Time limits and referee
* No damaging action for 6 s → `low_action` warning; 12 s → referee break ("reset to middle").
* Round-end with both clinched → break at bell.
* All clinch time accumulates `clinchControlPct` per fighter (dom time / total) for stats and scoring.

### 3.5 Scoring hooks (`12`)
`clinch_dominance` = (dom seconds − sub seconds)/clinch seconds, weighted by effective strikes/takedown attempts from clinch.

## 4. Acceptance tests (`reference/test/clinch.test.js`)
1. Entry probability rises with `clinchcontrol` spread; bounds hold.
2. Roles are assigned by spread (statistically) not by who initiated.
3. `getAvailableTakedowns('overunder','sub')` equals the table in §2; `thai`/`dom` returns only trips.
4. Break resets distance and clears roles; stamina drains faster for sub.
5. 12 s of no damaging action triggers a referee break event; cage pin unlocks cage-minor takedowns.
6. Deterministic under a fixed seed.
