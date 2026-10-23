# 06 · Damage, health events (stun → knockdown → KO)

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/damage.js`,
`health-events.js`, `impact.js`, `referee.js`, `rng.js`. Tests: `reference/test/health-events.test.js`,
`reference/test/referee.test.js`.

This is the most valuable decoded part of the reference: the **exact structure** of the function that turns a landed
strike into a stun/knockdown/KO chance, and the dice that apply it. Everything numeric that feeds it (the per-event
tunables) lives in the OBB **[GAP]** — our starting values are **[REC]**.

## 1. Event ladder **[DATA]**
`health_events ∈ { none, wobbled_shot, stun, critical_stun, knockdown, knockout, liver_shot, limping }`.
Head-region ladder: `wobbled_shot < stun < critical_stun < knockdown < knockout`. Body region adds `liver_shot`;
leg region adds `limping` (and can escalate to `knockdown` by buckling). Judges score "health events" (`12`).
Stats split KOs/stuns/staggers **by strike type** (hook, uppercut, body kick, signature kick, roundhouse-against-block…).

## 2. `HealthEventProbability` — decoded **[CODE]** (`0x11c7df0`)

18 inputs → 1 output `Probability` (float).

| # | Input | Type | Role |
|---|---|---|---|
| 0 | `ProbabilityMin` | f | probability at attribute 0 |
| 1 | `ProbabilityMax` | f | probability at attribute 100 |
| 2 | `FighterAttribute` | int 0–100 | rating that interpolates min↔max (direction decided by data) |
| 3 | `SkillsProbMod` | f | multiplicative modifier from skills |
| 4 | `SkillsMetaMod` | f | second multiplicative modifier (meta/situational) |
| 5 | `DamageHealthRatioMod` | f | factor reached at full damage ratio |
| 6 | `StrikeDamage` | f | damage taken by this strike (post-block) |
| 7 | `CurrentHealth` | f | defender's current pool value |
| 8 | `DamageToHealthRatioLow` | f | ratio where the damage effect starts |
| 9 | `DamageToHealthRatioHigh` | f | ratio where it saturates |
| 10 | `StaminaMod` | f | factor applied when the attacker is exhausted |
| 11 | `OpponentCurrentStamina` | f | attacker stamina (the "opponent" of the defender) |
| 12 | `OpponentMaxStamina` | f | attacker max stamina |
| 13 | `StaminaPercentageLow` | f | fraction of max below which `StaminaMod` fully applies |
| 14 | `StaminaPercentageHigh` | f | fraction above which stamina has no effect |
| 15 | `ProbabilityInit` | f | base probability at the **start of the round** |
| 16 | `GrowthNumStrikes` | int | strikes received (this round) needed to reach full base |
| 17 | `NumStrikesReceivedCurrentRound` | int | counter, reset each round |

```
ε = 1.1920929e-7 (FLT_EPSILON)
Pbase  = Pmin + (Pmax − Pmin) · (FighterAttribute / 100)
g      = GrowthNumStrikes ≠ 0 ? min(NumStrikesReceivedCurrentRound / GrowthNumStrikes, 1) : 1
Pgrow  = ProbabilityInit + (Pbase − ProbabilityInit) · g              # fresh round → Init, battered → Base
ratio  = StrikeDamage / max(CurrentHealth, 0.001)
rd     = |High − Low| > ε ? clamp((ratio − Low) / (High − Low), 0, 1) : 0
f1     = 1 + (DamageHealthRatioMod − 1) · rd                          # bigger hits relative to remaining health
S      = OppMax · (SPH − SPL)
rs     = |S| > ε ? clamp((OppCurrent − OppMax·SPL) / S, 0, 1) : 0
f2     = StaminaMod + (1 − StaminaMod) · rs                           # gassed attackers hit softer
P      = SkillsMetaMod · SkillsProbMod · f1 · f2 · Pgrow
```
Output is **not clamped** in the original; callers compare against a [0,1) die. We clamp to [0,1] **[REC]**.

Design consequences:
1. **Damage relative to remaining health**, not absolute, drives knockdowns — a fresh fighter shrugs off what a damaged one cannot.
2. **Accumulation inside a round** (`Init → Base` over `GrowthNumStrikes` received strikes) — early-round flurries are
   less likely to finish; sustained pressure ramps up (and the counter resets each round).
3. **Attacker stamina** modulates finishing power linearly between two stamina thresholds.
4. Skills are multiplicative.

### Worked example (use as a unit test)
`Pmin 0.05, Pmax 0.45, attr 70 → Pbase 0.33`; `GrowthNumStrikes 6, received 3 → g 0.5`; `Init 0.40 → Pgrow 0.365`;
`damage/health 0.10, Low 0.04, High 0.16 → rd 0.5; DamageHealthRatioMod 2.2 → f1 1.6`;
`attacker stamina 60/100, SPL 0.2, SPH 0.8 → rs 0.667; StaminaMod 0.5 → f2 0.833`; skills 1.0/1.0 →
**P = 1.6 · 0.833 · 0.365 = 0.4867**.

## 3. `SwitchHealthEvent` — decoded **[CODE]** (`0x11c8440`)

Inputs `NewProbability(f), RandomSeed(i), NoneEnumHealthEvent(i), NewEvent(i), CurrentEvent(i)` → `DoSwitch(bool)`;
state `Initialized, StateSeed1, StateSeed2, OrgSeed`.

```
if !Initialized or OrgSeed ≠ RandomSeed:
    Initialized = true; OrgSeed = RandomSeed
    Seed1 = NewEvent · RandomSeed ;  Seed2 = RandomSeed / (NewEvent + 1)      # integer arithmetic
else: advance Seed1 and Seed2 one LCG step
LCG:  s' = s · 1103515245 + 12345   (64-bit product, output = bits 16..47, scaled by 2⁻³² → [0,1))
r1 = rand(Seed1) ; r2 = rand(Seed2)
DoSwitch = (r1 ≤ NewProbability) AND ( CurrentEvent == None  OR  r2 < 0.5 )
```
Meaning: roll against `P`; **if the fighter already has an active health event, a second 50 % roll must also pass**
before the new event replaces it. Because both draws are a pure function of `(RandomSeed, NewEvent)`, the same strike
evaluated for different candidate events decorrelates, and **replays/lock-step netcode are deterministic** if
`RandomSeed` comes from the game's seeded RNG per strike.

### Evaluation order **[ARCH]**
`NewEvent` is an input and seeds the dice, which strongly suggests the game evaluates **a ladder of candidate events per
landed strike**, each with its own `HealthEventProbability` parameter set, from most to least severe, first success wins.
Our implementation does exactly that (`evaluateLadder`).

## 4. Damage → pool → ladder (full pipeline) **[REC]**

One function does this for every strike in every mode — `reference/src/combat/impact.js: applyImpact` — so stand-up,
clinch and ground strikes cannot drift apart:

```
applyImpact(A, D, move, defense, {mode, ctx}):
  region = move.target (leg strikes pick the lead leg 70 % of the time)
  dmg    = resolveDamage(...)                         # raw → crit → multipliers → blocked / chip / taken   (04 §5, 05 §3)
  D.pool[region] -= taken ; stamina -= 0.5·blocked
  head & unblocked → injury(D, face region, contact, taken)           # cuts / swelling (03 §6)
  emit STRIKE {outcome, taken, blocked, tier, crit, counter, counterHit, significant, region, mode, ...}
  if taken > 0:
     seed = rng('event').nextInt32()                                  # ONE seed per strike
     for event in ladder(group) from most severe:                     # head: KO, KD, critical stun, stun, wobble
          if severity(event) < severity(D.currentEvent): continue     # never downgrade an active event
          p = HealthEventProbability(profile[group.event], attr = vulnerability(D, group), taken,
                                     poolAfter = D.pool[region], A.stamina, A.maxStamina,
                                     strikesReceivedThisRound, skills…) (+ bonuses)
          if SwitchHealthEvent(p, seed, NONE, event, D.currentEvent): applyHealthEvent(event); break
```
`vulnerability(D, group)` = `round(100 − (0.6·rating + 0.4·toughness))` with rating = `chinhealth` (head), `bodyhealth`
(body) or `leghealth` (legs) — higher rating = harder to hurt (the reference direction is **[GAP]**; this one is ours).
Bonuses added to `p` before clamping to [0,1]: critical-stun follow-up `+0.25` on a *heavy* knockdown roll, plum-clinch
knees `+0.04` stun, ability "stun bonus"; skills multiply (`eventProb` attacker, `eventResist` defender, counter-hit ×1.1,
per-move `eventMult`).

**There is deliberately no "pool at zero ⇒ forced KO" rule.** An earlier draft of this document had one. It is wrong for
this design: the pool only enters the formula through `CurrentHealth` (the strike's damage / remaining pool), so a nearly
empty head pool makes every further hit a large ratio and finishing very likely, but it stays a dice roll like the
original. The one pool-at-zero rule is for *legs* (§5): a zeroed leg pool is a guaranteed buckle. A head pool at 0 % is therefore "extremely vulnerable", not
"defeated": every landed head strike then rolls ≈ 15–22 % stun, 8–15 % critical stun, 2–3 % knockdown and 0.5–1 % KO. (A demo fight
can end with a fighter on 0 % head health who is still on their feet — that is working as intended.) **HUD advice:** present the head pool as
a danger state (colour / wobble / heavy breathing), not as a hit-point bar that must hit zero for the fight to end.

### Calibrated profiles (original numbers; tune with `demo/calibrate.js`)
These are the values in `data/tunables.json` after calibration (`healthEvents.profiles`). Columns are the
`HealthEventProbability` parameters of §2; `SPL/SPH` = 0.2/0.8 for every event.

| Event | Pmin | Pmax | Low | High | DmgMod | StaminaMod | Init | Growth | Effect |
|---|---|---|---|---|---|---|---|---|---|
| head.wobbled_shot | 0.030 | 0.22 | 0.03 | 0.15 | 3.0 | 0.6 | 0.040 | 5 | stagger 1.2 s, movement −50 %, guard −50 % |
| head.stun | 0.015 | 0.18 | 0.05 | 0.20 | 3.5 | 0.5 | 0.020 | 6 | helpless 2.5 s then 1.5 s recovery |
| head.critical_stun | 0.006 | 0.09 | 0.06 | 0.25 | 4.0 | 0.5 | 0.008 | 8 | helpless 3.5 s; next heavy knockdown roll +0.25 |
| head.knockdown | 0.0007 | 0.013 | 0.07 | 0.30 | 6.0 | 0.5 | 0.002 | 10 | to the floor, 2 s, referee monitors (§6) |
| head.knockout | 0.00018 | 0.0034 | 0.08 | 0.40 | 8.0 | 0.4 | 0.00032 | 12 | fight over (KO) |
| body.liver_shot | 0.010 | 0.12 | 0.04 | 0.20 | 4.0 | 0.5 | 0.012 | 6 | doubled over 2.5 s, stamina −25 % |
| body.stun | 0.010 | 0.10 | 0.05 | 0.22 | 3.0 | 0.5 | 0.010 | 6 | helpless 2.5 s |
| leg.limping | 0.020 | 0.20 | 0.03 | 0.18 | 3.0 | 0.6 | 0.030 | 4 | movement −35 % and that-leg kicks −30 % for 10 s |
| leg.knockdown | 0.001 | 0.03 | 0.08 | 0.35 | 8.0 | 0.5 | 0.002 | 8 | to the floor (a leg-kick knockdown) |

What this produces per **landed head strike** (default fighter on the receiving end, `vulnerability` 40, final event of
the ladder, attacker fresh; `received` = head strikes already taken this round):

| Defender head pool | Strikes received this round | wobble | stun | critical stun | knockdown | KO |
|---|---|---|---|---|---|---|
| 100 % | 3 | 6.7 % | 4.8 % | 2.0 % | 0.31 % | 0.06 % |
| 50 % | 8 | 8.4 % | 7.6 % | 4.0 % | 0.46 % | 0.12 % |
| 25 % | 14 | 10.6 % | 7.5 % | 4.0 % | 0.57 % | 0.15 % |
| 10 % | 20 | 15.8 % | 14.0 % | 6.9 % | 1.0 % | 0.24 % |
| 3 % | 24 | 16.4 % | 22.3 % | 15.0 % | 3.4 % | 1.0 % |

(`demo/calibrate.js` and the numbers above are reproducible: see `19` for the whole-fight results these produce.)

**Lessons from calibration** (so the next person does not repeat them):
* `Init` must be **well below** `Pbase` (we use Init ≈ ⅛–⅓ of the base-rate midpoint). With Init ≫ Pbase the first strikes of
  a round are the *most* dangerous and a KO lands 15 % of the time on a clean hit; the "ramp up under sustained pressure"
  design intent only holds when `Init < Pbase`.
* The head pool had to be enlarged (`pools.headBase 640 + 4.6/chin`) so that the *damage ratio* term stays in its
  informative range for most of a round instead of saturating after a handful of hits.
* KO/knockdown `Pmax` are one to two orders of magnitude below the stun-class events: the ladder is evaluated KO-first, so
  every hit pays the KO and knockdown dice before the cheaper events get their turn. They are also the knobs that set the
  finish rate: `head.knockout` `Pmax` went from 0.0075 to 0.0034 when the AI learned to pounce on knockdowns (the pounce alone
  moved ≈ 20 points of finishes from "decision" to "stoppage").
* **The dice must not double-count a finish.** A strike on a fighter who is already on the ground cannot roll `knockout`
  (`applyImpact` passes `exclude:['knockout']` for ground-mode strikes): a pounced-on fighter is stopped by the referee (TKO,
  rule 2 below), which is how real fights end and keeps the KO:TKO mix realistic. With the exclusion removed, 40 % of all
  fights ended in a "KO" and TKOs were 2 %.
* **Per-round recovery matters as much as per-hit odds.** With only 3 % of the head pool restored between rounds the
  per-round finish rate doubled by round 4 (head pool 85 % → 41 % at the start of rounds 2–5); `recovery.headFraction 0.14` and
  `bodyLegFraction 0.10` keep it flat at ≈ 16–18 % per round (`12`, `19`).

## 5. Recovery and "state of the fighter" effects **[REC]**
* `stun_recovery` trigger exists in the reference (`STUN_RECOVERY`, `_ANALYSIS`): recovery speed depends on
  `toughness` and, for human players, optional recovery input (mash/tap) shortening the stun by ≤ 30 %.
* Events set `currentEvent` and a timer; during `stun`/`critical_stun`/`liver_shot`/`knockdown`: no guard, no movement,
  damage taken ×1.25 (`damage.stunnedMult`), crit +0.05 (`damage.stunnedCritBonus`). After the helpless phase a 1.5 s
  recovery caps movement at 60 %.
* Recovery speed: `ticks -= 1 + mash + toughnessBonus` per tick where `mash = clamp(prompt.mash,0,1)·0.30`
  (`healthEvents.recoveryMashMaxReduction`) and `toughnessBonus = (toughness−50)/50 · 0.15`.
* **Legs**: a `limping` event slows movement (×0.65) and weakens kicks off that leg (×0.7) for 10 s; the damage ratio
  term raises `limping` / leg-knockdown probability as the leg pool drains. A leg pool at 0 is a **guaranteed buckle**
  (`FightSim.#buckle` fires a knockdown) and, if the fighter then cannot stand after two get-up attempts, a leg-injury TKO.
* **Body**: the body pool enters the `liver_shot` / body-stun ratio term the same way, and a body pool below 25 % cuts stamina
  regeneration to 60 % (`stamina.js: regenStamina`) — the "can't recover wind after body work" effect.

## 6. Knockdown, KO and referee stoppage **[DATA] + [REC]**
Win states: `ko`, `referee_stoppage` (TKO), `submission`, decisions. Ref-stoppage types: `fighters_idle`, `ko`,
`round_end`, `submission_win`, `tko` (+ doctor stoppage). Post-fight story keys show TKO flavours: after knockdown or
stun by punch/kick/knee/elbow to head or body, ground-and-pound TKOs (side-control knees, "up-down"), leg-kick injury TKO,
doctor stoppage (cut).

**[REC] rules** (implemented in `reference/src/combat/referee.js`; numbers are `referee.*` tunables)
1. `knockout` event → immediate **KO**. If both fighters are knocked out in the same tick the one with the healthier head
   pool wins; an exact tie is a no-contest.
2. After a `knockdown` the downed fighter lies on the floor for the event time and may then get up (`09`). The follow-up
   attacker may start ground-and-pound within 150 ticks while the opponent is still down (the AI does: `13` §2.4). The
   referee watches *intelligent defence*: if a ground victim absorbs **3 heavy or 5 any** unanswered ground strikes inside a
   **3 s** sliding window (`tkoUnansweredHeavy / tkoUnansweredAny / tkoWindowSeconds`) without an active defensive action or
   cover, **TKO** (`ground_and_pound`). A blocked strike clears the window. A fighter who is still helpless from the
   knockdown cannot answer anything, so a committed pounce ends the fight within ≈ 2 s of the first clean strike.
3. Stunned fighter with **head pool < 5 %** (`tkoHeadFraction`) hit by another *heavy* head strike → referee stop with
   probability **0.35** (`tkoStunnedChance`, discretion) → TKO (`stunned_and_hurt`).
4. A fighter with a zeroed leg pool who has failed **two** get-up attempts → TKO (`leg_injury`).
5. Critical cut + doctor check between rounds (`p = doctorChanceFactor (0.5) · injury severity`) → doctor stoppage.
6. Submission: tap → submission win; unanswered choke → `…_choke_out` (unconscious, counts as a submission win); an
   unanswered joint lock → `…_injury` TKO (`10`).

Idle rules: stand-up uses the referee's own clock (any thrown strike, shot, clinch or movement-to-contact resets it:
warning after 5 s, a break to the centre after 10 s). Inside a **clinch or on the ground only *significant* strikes
(`STRIKE.significant`) reset the bout's idle timer**, so a stream of feather-light body shots cannot keep a stalled
position alive forever (`07`, `09`).

## 7. Determinism and testing
* All randomness goes through named streams of the `World` (`rng('hit')`, `('event')`, `('defense')`, `('injury')`,
  `('referee')`, `('submission')`, `('judges')`, `('ai.*')` …); one seed drives a whole fight, so replays are exact.
  The dice of §3 are `healthEventDice(seed, eventId)` in `core/rng.js` (LCG constants `1103515245 / 12345`).
* Tests: (a) the worked example reproduces 0.4867 ± 1e-4; (b) monotonicity in damage ratio, in strikes received, in
  attacker stamina; (c) 100 k Monte-Carlo of `SwitchHealthEvent`: pass-rate ≈ `P` when `CurrentEvent == None`, ≈ `0.5·P`
  otherwise; (d) same seed ⇒ same outcome across runs and across different call counts.
