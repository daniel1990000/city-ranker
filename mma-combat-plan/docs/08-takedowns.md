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

## 3. Recommended rules **[REC]** (as implemented in `reference/src/combat/takedown.js`; `takedown.*` tunables)

### 3.1 Entry (Phase I)
```
valid   : both standing ∧ A not busy (mid-action, holding a caught leg, trapped) ∧ shot cooldown (1500 ticks = 25 s) elapsed
          ∧ A.stamina ≥ 6 ∧ edge-to-edge gap ≤ shotRange (0.95 m)            → otherwise {ok:false, reason} and nothing happens
type    : (direction, size) ∈ {fwd,bwd}×{major,minor} via the observed STANDUP_TAKEDOWNS table
          (fwd/major = single-leg high, fwd/minor = single-leg low, bwd/major = double-leg high, bwd/minor = double-leg low;
           wrestlers' fwd/major becomes double-leg high)
frames  : startup 14 ticks. A is "committed": anything that lands on A counts as a counter-hit
cost    : stamina 5 on entry (×0.75 for a minor/low shot) + 1.0/s during the contest; both fighters pay the contest cost
closing : the shooter closes the gap by (shotRange + 0.10)/14 ≈ 0.075 m per tick (4.5 m/s)
```
**Emergent rule worth keeping:** because the closing speed is fixed, a defender who backs straight away from a *long*
shot makes it miss (the gap is still > `contactGap` 0.12 m when the startup ends) while one who waits for a point-blank
shot cannot evade it. Distance management is the defence; the miss costs the shooter `recoveryMiss` (10 ticks) of
helplessness and a push back to a 0.35 m neutral gap.

Defender options during Phase I (the defender is still *standing*, and a shooter in Phase I is a legal strike target):
**counter-strike** (any strike landing on the shooter → `denied`, denial = `countered_knee` / `countered_kick` /
`countered_punch` by the move that hit, and if the hit is *heavy* tier the shooter is also `wobbled_shot`),
**retreat** (shot misses, above), **sprawl** (a `grapple.sprawl` intent sets `sprawling` for the contest; without input
the defender sprawls automatically with `p = 0.35 + 0.003·takedowndefense`). The AI's reaction delay applies (`13`).

### 3.2 Contest (Phase II) — two interchangeable resolvers (`takedown.resolver`)
```
auto   : p_land = clamp( 0.50 + 0.004·(A.takedown(+skills) − D.takedowndefense)
                              + 0.10·[D pinned or with a wall behind] − 0.15·[D is sprawling]
                              + 0.06·[minor size] + 0.10·(A.stamina% − D.stamina%)
                              + styleBonus(A) − styleBonus(D) + ability bonus , 0.05, 0.95 )
         contest lasts 60 ticks (stand-up shot) / 36 ticks (clinch throw), then ONE die ('takedown' RNG stream)
clinch : p = takedownBase[family] + 0.004·(A − D) + 0.003·(A.clinchthrows − D.clinchthrows) − 0.08·[A is the sub]
           + 0.06·[cage] − 0.12·[defender is whizzering]  + the same stamina / style terms     (family bases 0.28–0.34)
meter  : SnakeMeter(Dom=A, Sub=D)  (see 10); difficulty d = clamp(0.5 + (D.takedowndefense − A.takedown)/200, 0.1, 0.9)
         # higher d shrinks the attacker's score window and grows the defender's (decoded behaviour)
         → outcome DomWon ⇒ land.  Used only when `resolver:'meter'` AND a human is in the pair; otherwise falls back to `auto`
```
`styleBonus`: freestyle wrestler +0.06, greco-roman +0.05, judo +0.04, jiu-jitsu +0.03, muay thai −0.02, boxer / karate /
kickboxer / tae kwon do −0.03. Pick the resolver per game mode (auto for AI-vs-AI and simulation, meter for human-controlled
mobile play).

### 3.3 Resolution (Phase III)
| Result | Ground outcome |
|---|---|
| **land (major)** | attacker on top. Hip / judo / bodylock throws, suplexes and plain throws → `side_control`; trips, double / single-leg and leg grabs → `half_guard` |
| **land (minor)** | scramble: `half_guard` (throws) or `guard` (trips / legs). The initiative roll `p = clamp(0.5 + (A.groundcontrol − D.groundcontrol)/200 + 0.10, 0.2, 0.85)` decides who ends on top |
| **denied: sprawl** | stand-up shot: the **defender is on top**, the shooter in the `sprawl` position (face-down). Clinch throw: the pair goes back to the same clinch (stuffed throw), cooldown applies |
| **denied: sprawl against cage** | pair ends in a `double_under` clinch against the fence with the **shooter** dominant (`fence_dominance`) — a cage battle (`07`) |
| **denied: countered strike** | the strike landed with the counter-hit multiplier; shooter staggered if heavy; pair back to stand-up |
| **denied: unknown** | the shot was aborted from outside (e.g. someone was knocked out mid-shot) — keeps the invariant below |
| **missed** | attacker whiffs, `recoveryMiss` 10 ticks (huge punish window) |

Impact: slams and suplexes (hip / judo / bodylock / suplex / throw families) deal `body` damage of 2–5 % of the pool
(`slamDamageFraction`) and run a body health-event roll with a heavy, ×0.8 event multiplier. Stats: `takedowns.attempted`
on Phase I; `landed` on landing; `denied` / `missed` on the respective result — **`attempted == landed + denied + missed`
always** (tested over 300 mixed fights).

## 5. AI **[DATA/ARCH]**
`RelativeTakedownInterestCollection` ⇒ AI interest in shooting is a function of the **relative** takedown vs defence
rating, modulated by tendency (wrestler/BJJ archetypes high). See `13` for the desirability model.

## 6. Acceptance tests (`reference/test/takedown.test.js`, all passing)
1. `p_land` is monotone in rating difference, increases with cage and stamina advantage, falls with sprawl input, bounded in [0.05, 0.95].
2. Shot legality: range, stamina, cooldown and mode checks each refuse with a reason.
3. A strike landing during Phase I yields `denied: countered_*`; a heavy one staggers the shooter.
4. A retreating defender makes the shot miss; the shooter eats the recovery penalty.
5. Sprawl denial puts the attacker in ground position `sprawl` with the defender on top; against the fence it becomes a cage clinch.
6. Landing: attacker on top at the table position (major); minor is a scramble either fighter can win.
7. Move families cover the whole clinch table; slams only for throws and suplexes.
8. `attempted == landed + denied + missed` over 300 mixed fights.
9. `auto` resolver: observed landing rate tracks `takedownProbability`; `meter` resolver: higher defender rating ⇒ lower attacker success over 800 duels each; with no human the sim falls back to the rating roll.
10. A stuffed clinch throw returns the pair to the same clinch; an abort keeps the invariant.
