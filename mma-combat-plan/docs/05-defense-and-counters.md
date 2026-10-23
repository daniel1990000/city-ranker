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
guard.state      : none | high | low           (hold input; raising takes guardRaiseTicks = 4)
guard.timeUp     : ticks since raised (resets when released)
strong block     : guard matches strike height AND timeUp >= 3
weak block       : otherwise (late or wrong height)
mitigation(strong)=0.70 + 0.25*blocking/100 ; mitigation(weak)=0.30 + 0.20*blocking/100
pierce           : if strike.power tier == heavy AND strike is kick: mitigation -= 0.15 (roundhouse-through-block)
chip             : blocked damage * 0.10 goes to the pool anyway (health chip) ; stamina cost = 0.5 * blocked damage
parry            : window = 7 + floor(blocking/25) ticks ending at impact, punches/teeps only,
                   result: damage 0, attacker +10 recovery, defender gets counterWindow(18 ticks) and 0 stamina
slip             : requires lateral/back movement input active during strike 'active' start ±3 ticks and
                   movement rating roll p = 0.25 + 0.5*movement/100 → miss + counterWindow(14)
step back        : target out of reach when strike becomes active → whiff (no roll); costs stamina 1.5
catch (kick)     : guard high + catch input within 6 ticks before impact + style/skill allows → hold state
                   (3 s max) with options release/sweep/takedown/strike; failed catch = full hit, crit +0.05
hands down       : fighters flagged handsDown: auto-guard disabled, strike startup −1, headshots crit +0.04
counter window   : next strike by the defender while window is open: damage ×1.20, crit +0.05, stat counters++
counter hit      : any hit landed while the victim is in strike startup/active (not guarding): damage ×1.15,
                   stun probability input +10 % (the "caught coming in" bonus)
```

### Interaction with health events
Blocked damage never reaches the event-probability formula's `StrikeDamage` input; **taken** damage does (`06`). A
`pierce`d heavy kick therefore has both a large taken fraction and a high health-event probability — this gives the
"KO through a block" behaviour the stat list implies.

## 4. AI and difficulty
* `blocking` rating and difficulty set the AI's **reaction delay curve** (`StepDelayDifficultyCurve`, see `13`): a
  beginner AI raises guard late; a champion AI parries on read.
* AI tendency archetypes weigh defence differently (`chess_master`: counters; `brawler`: low guard).

## 5. Acceptance tests (see `reference/test/defense.test.js`)
1. Strong high block on a head punch blocks ≥ 70 %.
2. Wrong-height block is weak.
3. Parry inside window: 0 damage, attacker recovery extended, defender counter window opened.
4. Late guard (timeUp < 3): weak block.
5. Heavy kick vs strong block still produces damage taken > 0 and a higher event probability than a punch of equal raw damage.
6. A strike landed during victim's startup grants the counter-hit multiplier exactly once.
7. Catch states time out and release deterministically.
