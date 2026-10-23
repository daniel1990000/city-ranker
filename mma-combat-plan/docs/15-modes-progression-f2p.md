# 15 · Game modes, progression, and the free-to-play layer

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/abilities.js` (optional),
`reference/src/meta/progression.js` (belts, rating points). Tests: `reference/test/abilities.test.js`.

## 1. Modes visible in the reference **[DATA]**

| Mode | Evidence |
|---|---|
| **Career / tournament** | `career_tuf_phase ∈ {preliminary, elimination, quarter_finals, semi_finals, finals, complete}`; fight-card reveal; weight classes (bantam, feather, fly, light, welter, middle, light-heavy, heavy, women's) |
| **Fighter challenges / training** | `challenge_result ∈ {white, blue, purple, brown, black belt}` (+ result mode `combos` or `score`); stats `training_belt_threshold_*`, `training_num_{success,total}_combos`, `training_score`, `training_time`, `training_was_skipped`; sub-steps `combo` / `timed`; failure behaviours `ignore, repeat_current_step, reset, skip_to_next_step`; move difficulty `easy/medium/hard` |
| **Home gym** | stations: octagon, mats, thai pads, heavy bag, weights, hall of fame, "wandering"; challenges: `standup_{blocking,movement,advanced}`, `clinch_{control,striking,advanced}`, `ground_{wrestling,bjj,advanced}`, `thai_pads`, `heavy_bag`, `initial_experience` |
| **Trainer / corner coach** | triggers `TRAINER_*`, `INXP_TRAINER_*` (in-experience tutorials), between-round huddle |
| **Online** | Blaze game reporting `UFCF2PSoloReport`, modes `ufcF2PH2H`, `ufcF2PSolo`; live events (`UltEvents`) |
| **Fight selection UI** | fighter carousel by weight class, VS screen, "tale of the tape" intro |

## 2. Free-to-play layer **[DATA]** — document, then decide what to keep

* **Energy** (`EnergyMax`, `EnergyPeriodSeconds`, `EnergyRefills`, `NextEnergyUTC`, `FullEnergyUTC`), **coins**, **gems/tiers**
  (emerald / gold / sapphire "hit" HUD events), **packs & boosters**, mystery boxes, **quests** with reroll, chain
  lock/unlock, store, ads (interstitial/banner/video; session gating), push notifications.
* **Cards / abilities (the part that touches combat)**:
  * Cards are *abilities with cooldowns* shown as HUD buttons: `BE_HUD_F2P_ABILITY_{READY,PRESS,SUCCESS,FAIL}`, battle-text
    pop-ups for `damage`, `health`, `cooldown`.
  * Parameters seen: `COOLDOWN_COUNT/MAX`, `MaxCoolDownInSecs`, `ActivationEnergyThreshold`, `CoolingEnergyTolerance`,
    `ProcChance`, `CARDDAMAGESCALE`, per-card **class** flags, `Card_{Enable,Disable}`, `Card_DisabledActionsMask`,
    `Card_FilteredActionsMask`, `Card_Timer_Expired`. FX: blizzard, bubbles, sparkle, storm.
  * Abilities are grouped by phase: **stand-up, takedown, submission** (stats `Fighter_Card_{Standup,Takedown,Submission}_Actions_{Played,Landed,Damage}`).
  * Using a card can start a **UI-hosted minigame**: `circular_golf_meter` (swing meter) or `mash_meter`; the UI reports
    back `fail | success | perfect` (`minigame_result`). Result tier scales the effect (§3).
  * **AI cards**: `Cards_EnableCardsAI`, `card_ai_params.xml`; `ForceCardGoal(CardConsumed, ProcChance, Random, Card0..3Req,
    ForceBool0..3In) → ForceBool0..3Out` — after a card is consumed the AI is *forced* (with probability `ProcChance`) to pursue
    the card's goal. **[CODE signature; semantics ARCH]**
* **Service contracts (UI ↔ gameplay)** **[DATA]**: HUD messages `health-update`, `stamina-update`, `critical-damage-update`,
  `fight-event-update`, `game-clock-update`, `submission-stage-update`, `submission-status-update`; card service `get`,
  `activate-card`, `register-card-updates-listener`, `set-battletext-handler`, `set-minigame-handler`,
  `minigame-golf-meter-score`, `minigame-mash-success`. → Model these as a typed **event bus between sim and UI** (`17`).

## 3. Recommended adoption for our MMA game **[REC]**

**Keep (core value)**: tournament/career structure, training challenges with belt tiers, home-gym drills (they double as
tutorials and as automated combat tests), ability cards *as an optional rule-set*.

**Optional / product decision**: energy, packs, ads, quests, live events — none are required for the combat, and the
service contracts above are small enough to bolt on later.

**Ability system (starter)**
```
Ability { id, phase: standup|takedown|submission, cooldownSecs, minigame: none|golf|mash|snake|snipe,
          effect: {damageScale, critBonus, stunBonus, guaranteeNext?}, aiGoal?, classTags[] }
use(ability): if !ready → fail ; start minigame (if any) → result ∈ {fail, success, perfect} →
              effectScale = {fail:0, success:1, perfect:1.5}[result] ; cooldown starts ; emit HUD events
```
Reference module (`abilities.js`) implements the cooldown state machine, result scaling (`fail 0 · success 1 · perfect 1.5`; `damageScale`
scales around 1, everything else linearly), per-phase counters (`played / landed / damage`) and the `ForceCardGoal` equivalent
(`forceGoal = consumed ∧ random < procChance`, `ai.cardProcChance = 0.6`). Five **original** example abilities ship:
`iron_fist` (stand-up, golf meter, damage ×1.5, crit +0.10), `flurry` (stand-up, mash, ×1.25, stun +0.08), `second_wind` (stand-up, no
minigame, +25 stamina), `level_change` (takedown, snake meter, +0.20 landing chance), `iron_grip` (submission, snipe, +0.20 lock/stage chance).

**How the sim consumes them** (`FightSim.#useAbility`): the intent frame carries `ability:{slot, result}`; the slot's cooldown starts, an
`ABILITY` event is emitted and the effect is *armed for the next relevant action*: damage / crit / stun effects ride on the fighter's next
stand-up strike (`f.mods.strike`), the takedown bonus on the next shot, the submission bonus on the next lock attempt; a stamina restore is
immediate. Each bonus is spent once. For an AI brain the press is a 1 %-per-tick roll while a ready ability matches the current phase,
the quality following difficulty (champion 25 % perfect, pro 12 %, beginner 5 %; 10 % fail), and the AI side of the opponent may be
forced toward the card's goal by the `ForceCardGoal` roll.

**Progression (minimal; `meta/progression.js`)**: training belts white → blue → purple → brown → black from either a *score* (strictly
ascending thresholds) or a *combo* count (fractions of the combos landed, default 25/50/75/100 %); `spendRatingPoints(ratings,
allocation, points, cap)` for fighter XP → rating points with a per-rating cap. Not implemented (product decisions): unlocking moves per
style, weight-class ladders, fight-card generation, career tournament flow.

## 4. Acceptance tests (`reference/test/abilities.test.js`, all passing)
1. Ability cooldown never negative; `ready` flips exactly when the timer hits 0; a disabled phase blocks use.
2. `perfect` > `success` > `fail` strictly scales the effect.
3. Per-phase counters; `ForceCardGoal`: forced only after consumption, empirical rate ≈ `procChance`.
4. Training belts: thresholds must be strictly ascending; score mode and combo mode both give a monotone tier; `spendRatingPoints` respects the cap and the budget.
5. (Same file) `FighterSituation` — the read-only perception struct the AI consumes: geometry, cage flags, health, tempo and context pass-through.
