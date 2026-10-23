# 04 · Stand-up striking

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/strike.js`, `moves.js`,
`damage.js`.

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

**[REC] frame model (60 Hz ticks)**
```
startup  → active (hitbox live) → recovery
cancel:  branchOut window [a,b] ∩ target.branchIn tags  → skip remaining recovery (stamina cost, combo++)
feint:   cancel allowed in startup[0..f]; cheap; provokes opponent flinch/guard reaction
```
Typical starting values (original, tune in playtests): jab startup 5–6 / active 2–3 / recovery 10; cross 8/3/16;
hook 10/3/20; leg kick 12/4/26; head kick 16/4/34; teep 10/3/20; spinning moves +6 startup, −recovery on hit.
Hit-stop on connect (2–5 ticks) and "impact scale" tiers *light / medium / heavy* (see §5).

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

**[REC] 2D/ground-plane implementation** (used by the reference code):
```
for each tick where attacker.action.phase == active:
  gap   = distance(A,B) - (A.radius + B.radius)
  reachEff = move.reach + (A.reachRating - 1) * 0.15      # metres
  angle = |relativeAngle(A.facing → B)|
  hit  = gap <= reachEff && angle <= move.wedgeDeg
  aimAssist (magnet): during startup rotate A.facing toward B ≤ magnetDegPerTick if gap <= move.reach * 1.4
  target validity: leg strikes need B not sprawled; head strikes need B.height ≥ crouch limit; etc.
```
Then run defence resolution (`05`) → damage (`06`). Keep **hit-resolution order** deterministic: process both fighters'
actions in a fixed order (e.g. lower id first) but resolve simultaneous hits as a *trade* (`rp_combo_trade_*` replay
groups confirm the reference supports trades).

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

**[REC] formula** (see `06` for the health-event side):
```
raw      = base + rng()*range
power    = limbPowerRating/100   (hand or leg, left/right specific)
attrFac  = 0.6 + 0.8*power
speedFac = 0.9 + 0.2*(speedRating/100)  (affects frame scaling, not damage, unless charged)
crit     = rng() < critChance  → ×critMult (default 1.5, head only, higher on counter)
strike   = raw*attrFac*scale*(crit?critMult:1)*skillMods
blocked  = defence.resolve(...) fraction (`05`)
taken    = strike*(1-blocked)
```
Tiers by `taken / targetPoolMax`: light < 3 %, medium 3–7 %, heavy ≥ 7 % (tune) → crowd/replay/camera feedback.

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
