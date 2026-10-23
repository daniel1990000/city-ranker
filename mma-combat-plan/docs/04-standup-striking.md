# 04 · Stand-up striking

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/strike.js`, `moves.js`,
`damage.js` (tests: `reference/test/strike.test.js`, `reference/test/defense.test.js`); move data: `data/moves.json`
(37 original moves: 24 stand-up, 7 clinch, 6 ground).

## 1. The strike grid **[DATA]**

A strike request is the triple **(side, slot, target)** — the reference literally names its lookup order
`strike_state_set_order = side → slot → target`.

| Axis | Values |
|---|---|
| **side** | `lead`, `back` (rear); also `left`/`right` for stats and for stance-independent bookkeeping |
| **limb family** | punch (hand, incl. elbow/hammerfist/backfist) · kick (leg, incl. knees) |
| **slot** | `basic`, `fwd`, `bwd`, `sig` (signature), `sig_fwd`, `sig_bwd`, `tech` (technical), `tech_fwd`, `tech_bwd`, `tech_sig` |
| **target** | `head`, `body`, `leg` |

So each of the 4 limb cells (lead/back × punch/kick) exposes ≈ **15 named variants**
(`base, body, body_fwd/bwd/sig/tech, fwd, bwd, sig, sig_fwd/bwd, tech, tech_fwd/bwd, tech_sig`), ≈ 60 grid cells in total.
Each cell resolves to a **strike type** drawn from the fighter's loadout:

* `fwd` / `bwd` = executed while stepping forward / backward (different animation + displacement; `action_lunge`,
  `action_lean` exist as actions).
* `sig` = the fighter's flashy/signature strike (per-fighter, e.g. spinning or aerial).
* `tech` = the "technical" variant (set-up, accuracy-oriented). **[ARCH]** semantics are inferred from naming and from
  `ai_special_strikes_*_tech_*`.
* Per limb cell a fighter owns two loadout *tiers* (`…_hi_…`, `…_lo_…`) with a list of allowed strike types each
  (ambiguous: leg kicks appear in the `hi` tier, so tier ≠ target) **[ARCH]**.

### Strike types (generic taxonomy; athlete-named variants are omitted)
* **Punches**: straight (jab/cross), power straight, hook, power hook, overhand/overhead hook, power overhead hook,
  uppercut, power uppercut, hook-uppercut ("hookercut"), spinning backfist, superman punch, hammerfist, elbow (straight,
  spinning, overhand), flashy/pawing jab.
* **Kicks**: roundhouse, leg kick (outside/inside/oblique, Muay Thai), switch roundhouse/leg kick, front kick,
  teep, side kick, spinning side kick, spinning heel kick, spinning back kick, axe kick, crane kick, heel stomp,
  ducking roundhouse, jumping/aerial kicks (switch, 540, inverted, capoeira, cartwheel).
* **Knees**: standing knee, lunging knee, flying knee (head/body variants).
* **Cage strikes**: cage-assisted knee, roundhouse, spinning kick, superman; metadata `direction ∈ {parallel,
  perpendicular}` to the wall (strikes that launch off the fence).
* **Contact surface**: `fist, elbow, foot_shin, knee, shoulder` (+`none`) → drives audio, damage type, cut chance
  (elbow/shin cut; fist bruise).
* Audio-side movement tags for flashy moves: `none, spinning, flying, diving, flying_off_cage`.

## 2. Strike lifecycle and chaining

`ingame_actiontype` gives the action vocabulary **[DATA]**:
`strike, block, lean, lunge, whip, switch_stance, clinch, takedown_{start,ready,finish,cancel},
transition_{start,ready,finish,cancel}, submission_{start,ready,finish,cancel}, denial, escape, getup`.
Strikes have no start/ready/finish stage — they are single actions with internal windows.

**Branch windows [ARCH]**: assets `BranchInWindowType`, `BranchOutTagCollection`, `BranchTuner`, `SignalBranchTuner`
implement *combo chaining*: each move exposes tagged windows where it may **branch out**, and each move declares which
tags it can **branch in** from. A "tuner" scales the windows (rating/difficulty).

**[REC] frame model (60 Hz ticks)** — implemented in `reference/src/combat/strike.js` (`actionPhase`, `startStrike`)
```
startup  → active (hitbox live) → recovery
cancel:  window [startup+active, startup+active+floor(recovery*0.55))  ∩  next.tags ∈ current.cancel.into
         → skip the remaining recovery (stamina ×1.1, combo++)
feint:   abort during startup ticks 0..5; costs 0.8 stamina; provokes the opponent's reaction
```
**Lesson (cost us a failing test):** a cancel window that opens *before* the active frames lets a buffered jab→jab skip the
hit entirely, so no strike ever lands. Windows must start after `startup+active`. `validateMove` only checks that a window
lies inside the move; keeping it behind the active frames is a data-authoring rule.

Shipped starting values (`startup/active/recovery`; original, tune in playtests): jab 5/2/9 · cross 8/3/14 · lead hook
10/3/18 · overhand 13/3/24 · lead leg kick 11/4/22 · rear leg kick 13/4/26 · body kick 14/4/28 · head kick 17/4/34 ·
teep 10/3/20 · flying knee 16/3/32 · spinning heel kick 20/4/40. Per-fighter frame scaling (`Fighter.scaledFrames`):
`sp = 0.9 + 0.2·speedRating/100` (punchspeed / kickspeed) divides startup and recovery, gassed fighters are 8 % slower,
hands-down fighters start 1 tick faster. A charged strike (`chargeTicks` 15…48) adds up to +4 startup ticks and up to
×1.6 damage (`strike.minChargeTicks / maxChargeTicks / maxChargeMult`).

**Hit-stop is presentation only.** `strike.hitStopTicks` (light 2 / medium 4 / heavy 6) is data for the renderer and the
camera; the simulation never pauses, which keeps replays and netcode trivial. Impact tiers *light / medium / heavy* are
defined in §5.

## 3. Hit detection **[ARCH] + [REC]**

Names in the engine: `StrikeJointPositionAsset`, **`StrikePredictionPositionAsset`**, `HitDirectionProcessor`,
`ImpactInfoProcessor`, `PieWedgeQueryFilter` (angular wedge in front of the fighter), `RayCast*`, `CollisionVolume`,
`CollisionProximityProcessor`, `ContactPoint/Plane`, `Magnet*` (point/line/plane/volume/rotational attractors),
`TwoBoneIK`, `RelativeIk*`. Physical contact is typed per body part:
`bodyfall, cage, elbow, face, foot, hand, head, knee, leg, lowerbody, mat, shoulder, upperbody`.

Reading: strikes are authored animations with an *impact window*; limb colliders are tested against the opponent's body
volumes; **predicted impact position** + **magnets/relative IK** bend the limb so a strike that is *close enough*
connects; the contact becomes an *impact record* (body part, direction, surface, magnitude) that feeds reaction
selection and damage.

**[REC] 2D/ground-plane implementation** (used by the reference code, `strike.js: hitTest / applyAimAssist`):
```
for each tick where attacker.action.phase == active and the action is not yet resolved:
  gap      = distance(A.pos, B.pos)                         # centre to centre (move.reach is quoted the same way)
  reachEff = move.reach * A.reachFactor                     # reachFactor = clamp(1 + 0.12*(reachCm-180)/20, 0.9, 1.12)
  angle    = |angleDiff(direction A→B, A.facing)|
  hit      = move.minReach <= gap <= reachEff && angle <= move.wedgeDeg
  aimAssist (magnet): during startup rotate A.facing toward B by ≤ strike.aimAssistDegPerTick (6°)
                      if gap <= reachEff * strike.aimAssistReachMult (1.4)
```
The defender must be *strikable*: standing, or the attacker of a takedown in its approach phase (that is how a well-timed
strike stops a shot, `08`). A strike whose active frames end without contact emits a `STRIKE` event with
`outcome:'whiff'`.

Then run defence resolution (`05`) → damage (`06`). Hit resolution is **two-pass** (`FightSim.#resolveContacts`): every
contact of the tick is *decided* (guard / parry / slip / catch, counter-hit flag) against the state *before* any damage is
applied, and only then applied. Simultaneous hits are therefore true **trades** whatever the processing order
(`rp_combo_trade_*` replay groups confirm the reference supports trades).

## 4. Movement-linked variants and cage awareness

* `fwd`/`bwd` strikes add displacement along the facing (lunge / step-back counter).
* **Cage proximity** is computed as 8 wall normals relative to the fighter (front, back, left, right + 4 diagonals) and
  matching angles (`UFCOctagonProximitySceneOp`) **[ARCH]**; flags `back_against_cage`, `facing_cage`,
  `back_exposed`, `fence_dominance`, `FENCE_STRIKES_{THROWN,LANDED}` **[DATA]**.
* Cage strikes and wall-assisted moves are only valid when the proper wall relationship holds; some moves are blocked
  (e.g. kicks need room) **[REC]**.

## 5. Damage and impact tiers **[DATA] + [REC]**

Debug-string evidence of the pipeline: `[Base] [Range] [Card Bonus] [Crit Chance] [Crit Damage]` →
`[Strike Damage] [Damage Blocked] [Damage Taken]`, fields `ActionDamageBase`, `ActionDamageRange`,
`ActionDamageAttribute`, `DamageScale`. Crowd feedback tiers: `STRIKE_SUCCESS_{LOW,MED,HIGH}_DAMAGE`; replay tiers:
`rp_strike_gen`, `rp_strike_huge_gen`, `rp_strike_huge_against_cage`.

**[REC] formula** (`damage.js: rawStrikeDamage / resolveDamage`; see `06` for the health-event side):
```
raw      = base + rng()*range
power    = limbPowerRating/100           (hand or leg; lead/back resolved to left/right through the current stance)
attrFac  = 0.6 + 0.8*power
strike   = raw * attrFac * (gassed ? 0.85 : 1) * (1 + 0.6*chargeFrac) * (kick off a limping leg ? 0.7 : 1)
crit     : head strikes only; p = move.critChance + 0.04 hands-down + 0.05 victim helpless + 0.05 counter
                                   + 0.05 failed catch + ability bonus      → strike ×= 1.5
strike  *= regionMult{head .80, body .70, leg .65}  × (victim helpless ? 1.25)  × (counter ? 1.20)  × (counter-hit ? 1.15)
         × position multiplier (clinch / ground, `07` `09`) × skill multiplier clamped to [1/1.35, 1.35]
blocked  = strike * mitigation (`05`)       chip = 0.10 * blocked      taken = strike - blocked + chip
```
Tiers by `taken / targetPoolMax`: **light < 1.0 %, medium 1.0–2.2 %, heavy ≥ 2.2 %** (`damage.tiers`) → crowd / replay /
camera feedback and the `significant` flag. The pools are large (a default fighter has head ≈ 870, body ≈ 530, each leg
≈ 435), so these percentages are small: a clean jab is ≈ 0.4 % of the head pool, a cross ≈ 0.7 %, a rear leg kick ≈ 1.7 % of
the struck leg, a head kick ≈ 1.3 % (default ratings, before crits). On the head only a crit stacked with a counter, a
charge or a high power rating reaches *heavy*. Pool damage
itself rarely decides a fight — the health-event ladder (`06`) does — but it feeds the event probabilities, the
`damage` judging component and the AI's `opp_health_head` signal.

## 6. Stats the strike system must emit **[DATA]**
Thrown / landed / blocked / avoided per: hand-side (left/right), limb (punch, kick, knee, elbow), target (head, body, leg),
mode (stand-up / clinch / ground), type (jab-cross, hook, overhand, uppercut, …), "significant" flag, damage-per-type,
counter strikes, combos landed, KOs/stuns/staggers *by strike type*, "kicks through guard" and "kicks against high
block" (explicit stats in the reference). Reference implementation: `reference/src/sim/stats.js`.

## 7. Open design choices for the team **[REC]**
1. **Input granularity**: 4-button + modifiers (console) or light/medium/heavy gestures (mobile). `14` supports both.
2. **Animation-driven vs. simulation-driven** hitboxes (3D skinned vs 2D sprites): pick one early; the data schema in
   `18` supports both (`frames` + optional `animEvents`).
3. **Trades**: allow simultaneous hits (more drama) or enforce priority (clearer)? Reference shows trades exist.
