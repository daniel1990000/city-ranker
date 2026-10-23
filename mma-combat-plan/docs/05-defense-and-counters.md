# 05 · Defence and counters

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/defense.js`.

## 1. What the reference exposes **[DATA]**

| Concept | Evidence |
|---|---|
| Rating `blocking` | `basetypes_fighter_rating_blocking`, `FIGHTER_BLOCKING_RATING` |
| Block strength classes | enum values `WeakBlock`, `StrongBlockHigh`, `StrongBlockLow` |
| Defensive action types | audio/stat enum `counter_type ∈ {block, caught_kick, caught_punch, slip, step_back}` |
| Parry | FTUE steps `ftue_parry`, `ult_parry`; commentary trigger `PARRY`; judging component `blocks_and_parries` |
| Slip | trigger `SLIP`; stat "defense_slips_good"; replay `counter_after_slip` |
| Catch (kick/punch) | triggers `CATCH`, `CATCH_RELEASE`; replay `knockdown_counter_caught_kick`, `stun_counter_kick` |
| Feint | trigger `FEINT`; replay `feint_and_attack`, `takedown_after_feint` |
| Hands down | per-fighter flag `FIGHTER_HANDS_DOWN` |
| Block stats | `strikes_blocked`, `knees_blocked_detailed`, `kicks_against_high_block_{left,right}`, `kicks_through_guard_{left,right}`, `strikes_clinch_blocked`, `strikes_ground_blocked` |
| Block-beating KOs | stat `kos_by_kick_roundhouse_against_block_{left,right}` → a heavy roundhouse **can KO through a block** |
| Counters | `counters_landed`, `counters_after_blocks`, `counters_after_slips`, `counters_with_kicks`, procedural action `counter_punch` |
| Damage split | debug `[Damage Blocked] / [Damage Taken]` → blocking mitigates a *fraction*, it does not nullify |
| AI "defense" signal | `aggression_factors_in_hit_reaction`, `opp_in_hit_reaction` |

## 2. Reading of the design **[ARCH]**

* Block is a **held state** with a *height* (`High` guards head+body, `Low` guards legs). Match → *strong*; mismatch or
  late guard → *weak*. (Names `StrongBlockHigh/StrongBlockLow/WeakBlock`.)
* Parry is a **timed** variant of block (FTUE teaches block and parry as separate steps; commentary has its own trigger).
* Slip / step-back are **movement-based evades** (the stat families "avoided" exist and `step_back` is a counter type).
* Catch is a **special block outcome vs kicks** (and some punches) that moves into a *held-leg* state which later
  releases (`CATCH_RELEASE`) — the doorway to sweeps, takedowns and counter strikes.
* A defensive success opens a **counter window** (stats are split "counters after blocks / after slips").

## 3. Recommended mechanics **[REC]** (values are starting points, all data-driven)

```
guard.state      : none | high | low           (held input; cannot be held while striking, stunned or on the floor)
guard.timeUp     : ticks since raised (resets when the state changes)
strong block     : guard matches strike height (legs need LOW, everything else HIGH) AND timeUp >= 3
weak block       : otherwise (late or wrong height)
mitigation(strong)=0.70 + 0.25*blocking/100 ; mitigation(weak)=0.30 + 0.20*blocking/100   (clamped to 0..0.95)
pierce           : heavy KICK → mitigation -= 0.15 (roundhouse-through-block)
chip             : 10 % of the blocked damage reaches the pool anyway ; the defender loses 0.5 stamina per blocked point
parry            : a timed press; the impact must land within 7 + floor(blocking/25) ticks after it. Punches and teeps only.
                   Result: damage 0, attacker +10 recovery, defender gets counterWindow (18 ticks). Presses are locked out
                   for 20 ticks (anti-spam) and cost 0.5 stamina
slip             : a timed press (6 ticks); only head punches; roll p = 0.25 + 0.5*movement/100 → miss + counterWindow (14).
                   Costs 1 stamina
step back        : no special rule. Retreating out of reach before the active frames makes the strike whiff (the hit test
                   fails) — the evade IS the movement; the whiff is reported as outcome:'whiff'
catch (kick)     : needs a catching style (judo, muay thai, wrestlers, jiu-jitsu, jeet kune do) or the `catch_kick` skill;
                   a press arms it for 6 ticks; only against body / head kicks; p = 0.5 + 0.2*blocking/100.
                   Success: the defender holds the leg for up to 180 ticks (3 s) and the KICKER is trapped (cannot move or
                   act) for as long; the holder may punch or let go (`grapple.release`); counterWindow >= 30. A sweep or
                   takedown out of the catch is NOT implemented (roadmap item in `19`).
                   Failure: a full hit with crit +0.05
hands down       : fighters flagged handsDown: strike startup −1, head crits +0.04
counter window   : next strike by the defender while the window is open: damage ×1.20, crit +0.05, `counter:true` in the event
                   (a successful block opens a shorter one: 60 % of 18 ticks)
counter hit      : any hit landed while the victim is in strike startup/active or committed to a shot (not guarding):
                   damage ×1.15, `counterHit:true` — the "caught coming in" bonus
```

### Interaction with health events
Blocked damage never reaches the event-probability formula's `StrikeDamage` input; **taken** damage does (`06`). A
`pierce`d heavy kick therefore has both a large taken fraction and a high health-event probability — this gives the
"KO through a block" behaviour the stat list implies.

## 4. AI and difficulty
* `blocking` rating and difficulty set the AI's **reaction delay curve** (`StepDelayDifficultyCurve`, see `13`): a
  beginner AI raises guard late; a champion AI parries on read.
* AI tendency archetypes weigh defence differently (`chess_master`: counters; `brawler`: low guard).

## 5. Acceptance tests (see `reference/test/defense.test.js`, all passing)
1. Strong high block on a head punch blocks ≥ 70 %; blocking skill adds up to 25 points.
2. Wrong-height block is weak.
3. Parry inside window: 0 damage, attacker recovery extended, defender counter window opened; the window grows with `blocking`.
4. Late guard (timeUp < 3): weak block.
5. Heavy kick vs strong block still produces damage taken > 0 and a higher event probability than a punch of equal raw damage.
6. A strike landed during victim's startup grants the counter-hit multiplier exactly once.
7. Catch states time out and release deterministically; the kicker is freed when the hold ends or the holder goes down.
8. Hands-down fighters start strikes a tick faster and take extra head crits; guard cannot be raised while helpless.
9. Damage identity `taken = strike − blocked + chip` holds for every outcome.

## 6. What this reference does *not* do (decisions for the product team) **[REC]**
* **No stamina cost for movement**, so footwork evasion is free; if kiting becomes dominant add a per-second cost in
  `locomotion.js` (the reference had an unused `stepBackStaminaCost` knob and we removed it rather than leave it dead).
* **No feint-triggered reactions** beyond the cheap abort (`FEINT` event); the AI does not flinch to feints yet.
* **Block height is binary** (high / low). The reference shows `StrongBlockHigh / StrongBlockLow / WeakBlock`, which maps to
  exactly this; a body-only block would need a third height.
