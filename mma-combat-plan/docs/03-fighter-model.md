# 03 · Fighter model

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`).

## 1. Health is regional, not a single bar **[DATA]**

The reference tracks four independent pools per fighter, each with a current and a max value:

| Pool | Stat names seen | Fails into |
|---|---|---|
| Head | `health_head`, `max_health_head`, `FIGHTER_HEAD_HEALTH`, rating `chinhealth` | stun → knockdown → KO |
| Body | `health_body`, `max_health_body`, rating `bodyhealth` | liver/body shot → wobble, gassing |
| Left leg | `health_left_leg`, `max_health_left_leg`, rating `leghealth` | limp, buckle, leg-kick TKO |
| Right leg | `health_right_leg` … | same |

plus `FIGHTER_OVERALL_HEALTH` (derived) and per-fighter `INJURY_SEVERITY` (cuts/swelling, see §6).
Stamina has `stamina` / `max_stamina` / rating `stamina` (and per-action `StaminaCostPerSecond`, see `04`, `07`).

**[REC] design**: keep the four pools. Derive `overall = weighted mean (head 0.5, body 0.3, legs 0.2 split)` only for
UI. The pool that is hit decides which *outcome ladder* is used (head → KO ladder; body → liver/wobble; legs → limp/buckle).

## 2. The 25 ratings **[DATA]**, 0–100 integers **[CODE]** (the event-probability code divides `FighterAttribute` by 100)

```
STRIKING  lefthandpower righthandpower leftlegpower rightlegpower punchspeed kickspeed
DEFENCE   blocking  toughness  chinhealth  bodyhealth  leghealth  cuts
MOVEMENT  movement  stamina
CLINCH    clinchcontrol clinchpassing clinchthrows
TAKEDOWN  takedown takedowndefense
GROUND    groundcontrol groundpassing
SUBS      chokesubmission jointsubmission chokedefense jointdefense
```

Separate left/right power ratings (hands and legs) matter: **power is per limb**, and stats later split by left/right.

Suggested consumers **[ARCH/REC]** — the reference data wiring is in the OBB:

| Rating | Primary consumer in our implementation |
|---|---|
| `*handpower`, `*legpower` | strike base damage multiplier (`04`), crit chance, stun power |
| `punchspeed`, `kickspeed` | startup/recovery frame scaling (`04`) |
| `blocking` | block mitigation + chance of a *strong* block; parry window width (`05`) |
| `toughness` | `FighterAttribute` input to health-event probability for body/leg events (`06`) |
| `chinhealth` | head pool max; `FighterAttribute` for head events |
| `bodyhealth`, `leghealth` | pool maxes |
| `cuts` | cut/swelling susceptibility (`06`) |
| `movement` | locomotion speed table scale, footwork/evade success |
| `stamina` | `max_stamina`, regen rate |
| `clinchcontrol` / `clinchpassing` / `clinchthrows` | dominance contest, clinch transitions, clinch-takedown success (`07`) |
| `takedown` / `takedowndefense` | takedown contest (`08`) |
| `groundcontrol` / `groundpassing` | holding position / passing guard / escapes (`09`) |
| `chokesubmission` / `jointsubmission` | submission minigame difficulty and stage progression (`10`) |
| `chokedefense` / `jointdefense` | submission escape ability |

## 3. Identity and physique **[DATA]**
`height`, `reach`, `weight`, `weight_class` (bantam, feather, fly, light, welter, middle, light-heavy, heavy, plus a
women's class), `age`, `stance` (traditional/orthodox vs southpaw; `FIGHTER_STANCE_CURRENT`, switch count),
`switch_stance_tendency`, `close_to_retirement`, record fields (wins/losses/draws/no-contests, title history).

Reach/height are inputs to range and to **relative IK scaling** — two bodies of different size are made to interlock
by scaling effectors (`InteractionScale*`, `RelativeIk*`, `NonUniformScaling*`) **[ARCH]**. For a 2D/simple 3D game the
equivalent is `range = base + reach_delta`, and per-position "size mismatch" offsets.

## 4. Personality and archetypes **[DATA]**

* `aggression_type`, `ai_type`, `demeanor`, `dynamicity`, `reactiveness` — AI personality knobs (values in the OBB).
* **12 tendency archetypes** (the AI's top-level behaviour profile): `adaptive_finisher`, `attrition_specialist`,
  `bjj_fighter`, `brawler`, `chess_master`, `damage_specialist`, `dirty_boxer`, `dominance_specialist`,
  `off_the_back_specialist`, `rounded_clincher`, `striking_purist`, `thai_clincher`. Each has a generic AI tunable set
  and optional per-fighter overrides (see `13`).
* **10 fighting styles**: boxer, freestyle wrestler, greco-roman wrestler, jeet kune do, jiu-jitsu, judo, karate,
  kickboxer, muay thai, tae kwon do. Style gates *movesets* (e.g. judo throws, wrestler shots) rather than stats.

## 5. Skills (perks), 10 slots **[DATA]**
`skill_slot_0 … skill_slot_9` hold up to ten of 45 named skills. Names (a design vocabulary, not behaviour):

`answering, attacking_the_base, bobble_head, caged_highlights, carved_of_wood, chess_master, crushing_blows,
crushing_presence, desperate_measures, escape_artist, explosive, fight_dirty, fluidity, force_of_nature, heavy_handed,
higher_altitude, infinite_core, iron_clinch, just_a_minute, killer_instinct, last_stand, marathoner,
negative_reinforcement, opportunist, overpower, phenomenal, pushing_the_pace, rampage, razor_wired,
relentless_assault, scrambler, sinister_gates, stop_hitter, survivalist, swing_for_the_fence, targeted_cruelty,
unstoppable_force, untouchable, vengeful, vicious_kicks, wakeup_call, warrior_of_attrition, weathering_storms, work_horse`

The `HealthEventProbability` expression has two skill inputs, **`SkillsProbMod` and `SkillsMetaMod`** (both multiplicative,
`06`) — so skills act as **multipliers on event probability** at minimum **[CODE]**. A skill also feeds the
`StrikeDamage` pipeline via a "card/skill bonus" term **[DATA: debug string `[Base][Range][Card Bonus][Crit Chance][Crit Damage]`]**.

**[REC]** Model a skill as `{id, triggers[], modifiers[]}` where a modifier is `{stat, op, value, condition}`.
Reference implementation: `reference/src/combat/skills.js` (6 example skills).

## 6. Injuries and cosmetic damage **[DATA]**

* Strike impact regions that can be cut or swollen (L/R): `brow, cheek, eye, nose, lip, lower_jaw, chest, abs, side, back,
  arm, thigh, shin` (plus `forehead` and `above_eye` in story events).
* Staged: **cut → worse → critical** per region (`story_round_cut_*`, `cut_worse_*`, `cut_critical_*`); **swelling →
  worse** for eye / both eyes / face / forehead. `post_fight_doctor_stoppage_cut` ends fights.
* `FIGHTER_INJURY_SEVERITY` aggregates. Blood is rendered via `blood_transfer_region_*` (arms, fists, shins, shoulders,
  hips, back, upper legs, butt) so blood carries onto the opponent through contact.
* **[REC]** Implement injury as a small state machine per region `{none, swollen, cut, worse, critical}` driven by
  accumulated impact on that region × `cuts` rating; critical cut can trigger a doctor check between rounds or on stoppage
  (`12`).

## 7. Situational flags the sim tracks per fighter **[DATA: `FIGHTER_*`]**
`back_against_cage`, `facing_cage`, `back_exposed`, `fence_dominance`, `hands_down`, `is_circling`, `is_stunned`,
`flat_on_mat`, `has_back_on_ground`, `ground_posture`, `leg_hooks_in`, `in_dominant_status`, `in_submission_attempt`,
`idle_time`, `proximity_time`, `trip_count`, `user_controlled`, `time_since_last_{stun,knockdown,takedown_landed}`,
`time_between_{clinch_actions,combo_types,knockdowns,…}`.

These double as **AI inputs and commentary inputs**; model them as a read-only `FighterSituation` struct refreshed each
tick (reference: `reference/src/core/situation.js`).

## 8. Reference data in this repo
* `data/fighters.json` — 8 original fictional fighters, one per archetype family, using the schema in `18`.
* `data/taxonomy.json` — all enumerations above in machine-readable form.
