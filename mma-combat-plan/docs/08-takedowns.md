# 08 · Takedowns (stand-up shots and transitions to the ground)

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/takedown.js`.
Tests: `reference/test/takedown.test.js`. Clinch-initiated takedowns: `07` §2.

## 1. What the reference exposes

| Topic | Evidence |
|---|---|
| **Three phases** | engine controllers `TakedownPhaseIController`, `TakedownPhaseIIController`, `TakedownPhaseIIIController` **[DATA]** |
| Action lifecycle | `takedown_start → takedown_ready → takedown_finish` or `takedown_cancel` (`ingame_actiontype`) **[DATA]** |
| Stand-up types | `standup_takedown_type_{fwd,bwd}_{major,minor}_*`: fwd-major = single-leg (high), fwd-minor = single-leg (low), bwd-major = double-leg (high), bwd-minor = double-leg (low) **[DATA]** |
| Master type list (30) | bodylock throw (hi/lo), double-leg (hi/lo/left/right), hip throw (hi/lo), inside trip (+L/R), judo throw, leg grab, outside trip (+L/R), scissor sweep, single-leg (hi/lo/left/right), suplex (hi/lo), throw (hi/lo/left/right), trip (hi/lo) **[DATA]** |
| Selection | `TakedownSelectionCollection`, `TakedownSelectionBool`, `TakedownTypeForSlot`, `RelativeTakedownInterestCollection` (AI interest relative to ratings), `OutputMinorTakedown` **[DATA]** |
| Audio/event outcomes | `attempt, denied, grapple, ground_contact, missed, success` **[DATA]** |
| **Denial types** | `defended_countered_{kick,knee,punch}`, `defended_sprawl`, `defended_sprawl_against_cage`, `defended_unknown` **[DATA]** |
| Replay groups | takedown after feint / after slip / after strikes · tackle · trip · throw · slam · suplex · defended (slam, suplex, throw, countered-strike) **[DATA]** |
| Ratings | `takedown`, `takedowndefense` (+ `clinchthrows`) **[DATA]** |
| Judges | `takedowns_performed`, `takedowns_denied` (12 scoring components) **[DATA]** |
| Stats | attempted / successful / denied, `trip_count`, time-since-last-landed, "big takedown", "kept on ground", accuracy, defense **[DATA]** |
| Mobile build | FTUE steps `takedown`, `takedown_meter`; ground game uses a **timing meter** (`SnakeMeter`, `10`) **[DATA/ARCH]**; cards have `Takedown_Actions_{Played,Landed,Damage}` stats **[DATA]** |
| Position after denial | ground position **`sprawl`** exists in the ground-position enum **[DATA]** |

## 2. Reading of the three phases **[ARCH]**

| Phase | Meaning (our reading) | What can interrupt it |
|---|---|---|
| **I – Entry / shot** | Level change or grab (`takedown_start`). Attacker is committed and exposed. | A strike that lands first (counter), a sprawl, a step-back (miss) |
| **II – Contest / grapple** | Both fighters are locked (`grapple`, `takedown_ready`). Resolved by ratings and/or a timing meter. | Defender escapes to feet, reverses, pins to cage, scramble |
| **III – Resolution** | Throw/drive and landing (`takedown_finish`, `ground_contact`) or stuff (`denied`). Chooses the ground position and impact damage. | — |

## 3. Recommended rules **[REC]**

### 3.1 Entry (Phase I)
```
valid   : A.mode=standup ∧ gap ≤ shotRange(0.95 m) ∧ A not in recovery ∧ A.stamina ≥ 8
type    : (direction, size) ∈ {fwd,bwd}×{major,minor} → move from A's takedown loadout
          (fwd=single-leg, bwd=double-leg by default; styles override: judo→hip throw/trip, wrestler→double high)
frames  : startup 14 (shot) · A is "committed": counter-hit multiplier applies to anything that lands on A
cost    : stamina 8 + 1.5/s during contest
```
Defender options during Phase I: **sprawl** (hold sprawl input or auto if `takedowndefense` roll), **counter-strike**
(knee/punch/kick that connects during the startup → `denied: countered_{knee,punch,kick}`), **step-back/circle**
(shot whiffs: `missed`). A reaction delay applies to AI (`13`).

### 3.2 Contest (Phase II) — two interchangeable resolvers
```
auto   : p_land = clamp( 0.50 + 0.004·(A.takedown − D.takedowndefense)
                              + 0.10·[D.backToCage] − 0.15·[D sprawl input]
                              + 0.10·(A.stamina% − D.stamina%) + styleBonus(A) − styleBonus(D) , 0.05, 0.95 )
meter  : SnakeMeter(Dom=A, Sub=D)  (see 10); difficulty d = clamp(0.5 + (D.takedowndefense − A.takedown)/200, 0.1, 0.9)
         # higher d shrinks the attacker's score window and grows the defender's (decoded behaviour)
         → outcome DomWon ⇒ land
```
Pick one per game mode (auto for AI-vs-AI, meter for human-controlled mobile play).

### 3.3 Resolution (Phase III)
| Result | Ground outcome |
|---|---|
| **land (major)** | attacker on top in `side_control` (hip throw, suplex, trip, double-leg-high) or `half_guard_top` (single-leg-high) or `guard` (trips onto the fighter's back) |
| **land (minor)** | scramble: both on the floor, neutral; first to act gets `top` (50/50 skewed by `groundcontrol`) |
| **denied: sprawl** | defender on top of the shooter: shooter in `sprawl` position (face-down). Defender may strike or release |
| **denied: sprawl against cage** | pair ends in a `single_leg`/`double_leg` clinch against the cage (cage battle; see `07`) |
| **denied: countered strike** | strike lands with counter bonus; attacker staggered if the hit is heavy |
| **missed** | attacker whiffs, recovery +10 ticks (huge punish window) |

Impact: slams and suplexes add `body` damage (2–5 % of pool) and a small stun chance; `ground_contact` triggers the
ground state (`09`). Stats: `attempted++` on Phase I; `successful++` on landing; `denied++` on any denial.

## 4. Defending a takedown from the clinch **[REC]**
Same three phases. Phase I is the throw attempt; defender options: `whizzer`, `sprawl-like hips back`, counter-throw
(`takedown`-rating vs `clinchthrows`), or striking the head if the thrower is bent over (knee). Landing position depends
on `(position, direction, size)` row of `07` §2.

## 5. AI **[DATA/ARCH]**
`RelativeTakedownInterestCollection` ⇒ AI interest in shooting is a function of the **relative** takedown vs defence
rating, modulated by tendency (wrestler/BJJ archetypes high). See `13` for the desirability model.

## 6. Acceptance tests (`reference/test/takedown.test.js`)
1. `p_land` is monotone in rating difference, increases with cage and stamina advantage, bounded in [0.05, 0.95].
2. A strike landing during Phase I yields `denied: countered_*` and applies the counter-hit multiplier.
3. Sprawl denial puts the attacker in ground position `sprawl` with the defender on top.
4. `attempted == successful + denied + missed` after N simulated attempts.
5. Meter mode: higher defender rating ⇒ lower attacker success rate over 2 000 runs.
