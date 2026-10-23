# 06 · Damage, health events (stun → knockdown → KO)

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/damage.js`,
`health-events.js`, `rng.js`. Tests: `reference/test/health-events.test.js`.

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

```
onStrikeLanded(A, D, strike, region):
  raw → taken            (see 04 §5, 05 §3)
  D.pool[region] -= taken
  injury(D, region, strike.contact, taken)                    # cuts / swelling (03 §6)
  A.stats.landed++, D.stats.absorbed++ ; D.strikesReceivedThisRound++
  seed = rng.nextInt()                                        # one seed per strike
  for event in ladder(region) from most severe:
       p = HealthEventProbability(profile[event](region), attr = vulnerability(D, region), taken, D.pool[region],
                                  A.stamina, A.maxStamina, D.strikesReceivedThisRound, skills…)
       if SwitchHealthEvent(p, seed, NONE, event, D.currentEvent): apply(event); break
  if D.pool[head] <= 0 → force `knockout` eligibility (still goes through a roll with p=1)   [guard rail]
```
`vulnerability(D, region)`: head → `100 − chinhealth` blended with `100 − toughness`; body → `100 − bodyhealth`;
legs → `100 − leghealth` (direction chosen so higher rating = harder to hurt) — the reference direction is **[GAP]**.

### Starting profiles (original numbers; tune with `demo/calibrate.js`)
| Event | Pmin | Pmax | Low | High | DmgMod | StaminaMod | SPL/SPH | Init | Growth | Effect |
|---|---|---|---|---|---|---|---|---|---|---|
| wobbled_shot | 0.10 | 0.60 | 0.02 | 0.12 | 2.0 | 0.6 | 0.2/0.8 | 0.50 | 6 | stagger 1.2 s, movement −50 %, guard −50 % |
| stun | 0.05 | 0.45 | 0.04 | 0.16 | 2.2 | 0.5 | 0.2/0.8 | 0.40 | 6 | helpless 2.5 s then 1.5 s recovery |
| critical_stun | 0.02 | 0.30 | 0.06 | 0.22 | 2.5 | 0.5 | 0.2/0.8 | 0.30 | 8 | helpless 3.5 s; next heavy hit → knockdown p +0.25 |
| knockdown | 0.010 | 0.22 | 0.08 | 0.30 | 3.0 | 0.5 | 0.2/0.8 | 0.25 | 8 | to floor; get-up ≥ 2 s; ref monitors (§6) |
| knockout | 0.002 | 0.12 | 0.10 | 0.40 | 3.5 | 0.4 | 0.2/0.8 | 0.20 | 10 | fight over (KO) |
| liver_shot (body) | 0.04 | 0.40 | 0.05 | 0.20 | 2.5 | 0.5 | 0.2/0.8 | 0.30 | 5 | doubled over 2.5 s, stamina −25 % |
| limping (leg) | 0.08 | 0.50 | 0.03 | 0.18 | 2.2 | 0.6 | 0.2/0.8 | 0.30 | 4 | movement −35 % 10 s, that-leg kicks −30 % |

## 5. Recovery and "state of the fighter" effects **[REC]**
* `stun_recovery` trigger exists in the reference (`STUN_RECOVERY`, `_ANALYSIS`): recovery speed depends on
  `toughness` and, for human players, optional recovery input (mash/tap) shortening the stun by ≤ 30 %.
* Events set `currentEvent` and a timer; during `stun`/`critical_stun`: no guard, damage taken ×1.25, crit +0.05.
* **Legs**: cumulative leg-pool damage lowers `locomotion` speed (`11`), lowers kick power on that leg, and raises
  `limping` probability (`FIGHTER_INJURY_SEVERITY`). A leg pool at 0 = guaranteed buckle (knockdown).
* **Body**: low body pool raises gassing (stamina regen −40 %) and the chance of `liver_shot`.

## 6. Knockdown, KO and referee stoppage **[DATA] + [REC]**
Win states: `ko`, `referee_stoppage` (TKO), `submission`, decisions. Ref-stoppage types: `fighters_idle`, `ko`,
`round_end`, `submission_win`, `tko` (+ doctor stoppage). Post-fight story keys show TKO flavours: after knockdown or
stun by punch/kick/knee/elbow to head or body, ground-and-pound TKOs (side-control knees, "up-down"), leg-kick injury TKO,
doctor stoppage (cut).

**[REC] rules**
1. `knockout` event → immediate **KO**.
2. After a `knockdown`, a ground exchange begins (`09`). The referee watches *intelligent defence*: if the downed fighter
   absorbs `N = 3` heavy unanswered ground strikes (or 6 any) without a defensive action (posture/cover/turtle/escape
   attempt) within `T = 3 s`, **TKO**.
3. Head pool < 8 % + `stun` active + new heavy head strike → referee stop (TKO).
4. Leg pool = 0 and fighter cannot stand after two get-up attempts → TKO (leg-kick injury).
5. Critical cut + doctor check between rounds (`p = 0.5·cutSeverity`) → doctor stoppage.

## 7. Determinism and testing
* All randomness goes through named streams (`rng.stream('hit')`, `('event')`, `('ai')`, `('minigame')`); one seed
  drives a whole fight, so replays are exact. Constants for the LCG above are exported as `LCG_A`, `LCG_C`.
* Tests: (a) the worked example reproduces 0.4867 ± 1e-4; (b) monotonicity in damage ratio, in strikes received, in
  attacker stamina; (c) 100 k Monte-Carlo of `SwitchHealthEvent`: pass-rate ≈ `P` when `CurrentEvent == None`, ≈ `0.5·P`
  otherwise; (d) same seed ⇒ same outcome across runs and across different call counts.
