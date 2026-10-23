# 18 · Data schemas (the content packs)

Tags: **[ARCH]** observed pattern · **[REC]** our decision. Everything here is **[REC]** except where a vocabulary is marked **[DATA]**.
The packs in `data/` are *generated* from the JS sources by `cd reference && npm run build-data` and a test
(`reference/test/data.test.js`) fails if the committed JSON and the sources disagree. When the next agent moves to a real engine
the JSON becomes the source of truth and the generator can be deleted; the loaders and validators below are what to port.

## 0. Conventions

| Topic | Rule |
|---|---|
| File header | `{ "schema": "mma.<name>", "version": <int>, … }`. Bump `version` when a field changes meaning; a loader rejects an unknown version |
| Ids | `snake_case`, unique within a pack, never reused. Fighters in the bundled pack are `f_*` |
| Time | **ticks at 60 Hz** inside the sim (`TICK_HZ`, `toTicks(seconds)`); tunables that are naturally seconds say `…Seconds` and are converted on use |
| Distance | metres. Reaches are **centre to centre**; clinch / shot ranges are **edge to edge** (`World.gap`) |
| Angles | degrees in data (`wedgeDeg`), radians in code |
| Ratings | integers 0–100, 50 = average. 25 of them (`taxonomy.ratings`) |
| Probabilities | 0–1. Stamina is 0–100 (`stamina.max`); pools are in "damage points" |
| Randomness | none in data. Anything random in the sim comes from the named seeded streams (`17` §3) |
| Real people | **none.** The bundled fighters are fictional archetype labels (`02` §5) |

## 1. `data/moves.json` — `mma.moves` v1 (37 original moves: 24 stand-up, 7 clinch, 6 ground)

```json
{ "id": "lead_jab_head", "label": "Jab", "mode": "standup", "limb": "punch", "side": "lead", "slot": "basic", "target": "head",
  "type": "straight", "kind": "punch", "contact": "fist", "power": "light",
  "frames": { "startup": 5, "active": 2, "recovery": 9 }, "reach": 1.05, "wedgeDeg": 22, "advance": 0,
  "damage": { "base": 3.4, "range": 1.2 }, "stamina": 1.6, "eventMult": 0.7, "critChance": 0.02, "blockHeight": "high",
  "tags": ["jab", "punch"], "cancel": { "out": [[7, 11]], "into": ["cross", "hook", "uppercut", "legkick", "bodykick", "overhand", "jab"] } }
```

| Field | Type / values | Meaning and who reads it |
|---|---|---|
| `id`, `label` | string | unique id; display name |
| `mode` | `standup` \| `clinch` \| `ground` | which bout may use it. Clinch / ground moves are picked by **tag** (`knee`, `elbow`, `uppercut`, `hook`, `shoulder`, `stomp`; `hammer`, `straight`, …), not by id |
| `limb` / `side` | `punch`\|`kick` / `lead`\|`back` | the strike grid axes **[DATA]** (`04` §1). Lead/back resolves to the left/right limb through the stance |
| `slot` | `basic fwd bwd sig sig_fwd sig_bwd tech tech_fwd tech_bwd tech_sig` **[DATA]** | the strike-grid slot. `MoveBook.select` relaxes slot → target → side when an exact cell is empty |
| `target` | `head`\|`body`\|`leg` | which pool is hit; also decides the guard height needed (legs = low) |
| `type`, `kind` | strings | `type` is free text for audio/animation (`hook`, `roundhouse`, `teep`, `flying_knee`); `kind` is the stats bucket (`punch`, `kick`, `knee`, `elbow`, `hammer`, …) |
| `contact` | `fist elbow foot_shin knee shoulder none` **[DATA]** | cut/swelling model (`injury.contactMult`), audio, the clinch/ground moves' block rules |
| `power` | `light`\|`medium`\|`heavy` | pierce rule for heavy kicks (`05`), the AI's strike choice, the `significant` flag, `10-8` criteria |
| `frames` | `{startup, active, recovery}` ticks, each ≥ 1 | the action lifecycle (`04` §2); scaled per fighter by speed rating, gassing and hands-down |
| `reach` / `minReach` | metres | centre-to-centre hit range, multiplied by the attacker's `reachFactor`; `minReach` is optional (elbows, knees) |
| `wedgeDeg` | degrees | half-angle of the hit wedge in front of the attacker |
| `advance` | metres | distance the fighter slides forward during startup (lunges, superman, flying knee) |
| `damage` | `{base, range}` | `base + U(0,1)·range`, then the pipeline of `04` §5 |
| `stamina` | number | cost before `stamina.costScale` and the `marathoner` skill |
| `eventMult` | number | multiplies the health-event probability (`06` §4); heads kicks 1.6, jabs 0.7 |
| `critChance` | 0–1 | head strikes only |
| `blockHeight` | `high`\|`low` | the guard height that blocks it strongly |
| `tags` | strings | **the first tag is the family tag.** Tags drive combo chaining (`cancel.into`), parry eligibility (`punch` or `teep`), AI preferences, and clinch/ground lookup |
| `cancel.out` | `[[from, to), …]` in ticks since the action started | when the move may be cancelled into another. **Must start at or after `startup + active`** (the cancel-window lesson, `04` §2) |
| `cancel.into` | tags | which following moves are allowed (a move is chainable if it carries one of these tags) |

Validation (`validateMove`): required id; `limb`, `side`, `slot`, `target`, `power`, `contact` from their enums; frames ≥ 1; `reach > 0`;
`damage.base > 0`; `blockHeight` ∈ {high, low}; every cancel window inside `[0, startup+active+recovery]` and non-empty.

**Extension points (not wired in the reference):** `animEvents` (`impact`, `branchOut`, `footPlant` frame events so an animation can drive
timing instead of the numbers above — keep exactly one source of truth), a per-fighter loadout (`MoveBook.select({allowed})` already
filters by a set of ids; the fighter spec just has no field for it yet), range/angle bands for context-matched selection (`17` §6).

## 2. `data/fighters.json` — `mma.fighters` v1 (8 fictional fighters)

```json
{ "id": "f_striker", "name": "Striker Prime", "stance": "orthodox", "style": "kickboxer", "tendency": "striking_purist",
  "difficulty": "pro", "physique": { "heightCm": 182, "reachCm": 188, "weightKg": 77 }, "skills": ["vicious_kicks", "marathoner"],
  "ratings": { "lefthandpower": 66, "righthandpower": 70, "…": "all 25, 0–100" } }
```

| Field | Values | Notes |
|---|---|---|
| `id`, `name` | string | `id` must differ between the two fighters of a fight |
| `stance` | `orthodox`\|`southpaw` | orthodox lead = left limbs |
| `style` | 10 fighting styles **[DATA]** | gates catches (`05`), clinch entry types (`07`), takedown style bonus (`08`) |
| `tendency` | 12 archetypes **[DATA]** | AI profile (`13`) |
| `difficulty` | `beginner`\|`pro`\|`champion` | AI reaction / read / mistake profile (`13` §2.3) |
| `handsDown` | boolean, optional | −1 startup tick, +0.04 head crit, `defend` −0.10 (`05`) |
| `physique` | `heightCm`, `reachCm`, `weightKg` | `reachFactor = clamp(1 + 0.12·(reachCm − 180)/20, 0.9, 1.12)` scales every strike's reach |
| `skills` | ids from `combat/skills.js` | up to 10 slots in the reference **[DATA]**; 10 of the 45 names have effects (`03` §5) |
| `ratings` | the 25 ratings | missing ones default to 50 |
| `abilities` | ids from `combat/abilities.js`, optional | builds the fighter's ability bar (`15`) |
| `groundFlags` | `stack`, `rubber`, `crucifix`, `sidesaddle`, optional | which optional ground transitions the fighter owns; omitted → everything if `groundcontrol ≥ 60` (`09`) |
| `human` | boolean, optional | marks a human-controlled fighter: minigame modes and the AI-never-presses rule key off it |

Derived at load (`combat/fighter.js`, `pools.*` tunables): head pool `= headBase + headPerChin·((1−mix)·chinhealth + mix·toughness)`, body and
leg pools the same with `bodyhealth` / `leghealth`, `mix = pools.toughnessMix (0.4)`; stamina max `stamina.max`. A default fighter has
head ≈ 870, body ≈ 530, each leg ≈ 435.

## 3. `data/tunables.json` — `mma.tunables` v1

One tree, 16 sections, every leaf read by the sim (a test fails on dead knobs). An override is a *partial* tree deep-merged over the
defaults (`mergeTunables`; arrays are replaced, not merged). Overrides travel with replays (`replay.tunables`) and the calibration
CLI (`--set path=value`, `--tunables '<json>'`).

| Section | Controls | Doc |
|---|---|---|
| `fighter` | radius, speed, speed table `loco` (D1…D8), turn rate, limp / gassed multipliers, reach reference | `11` |
| `stamina` | max, cost scale, regeneration (rating, guarding, acting, paired), gassing, between-round recovery | `04` `12` |
| `pools` | pool sizes from ratings | `03` |
| `damage` | attribute scaling, crit / counter / stunned multipliers, region multipliers, impact tiers, skill cap | `04` `06` |
| `injury` | cut / swelling stage thresholds, contact multipliers | `03` §6 |
| `defense` | block / parry / slip / catch numbers, counter windows | `05` |
| `strike` | aim assist, hit-stop (presentation), charge | `04` |
| `healthEvents` | ladders, the 9 probability profiles, effect table, recovery | `06` |
| `clinch` `takedown` `ground` `submission` | the four paired states | `07`–`10` |
| `referee` | idle timers, TKO rules, doctor, round / rest length | `06` `12` |
| `recovery` | between-round healing and the cutman | `12` |
| `scoring` | component weights, event values, 10-point-must margins, judge jitter | `12` |
| `ai` | aggression weights, difficulty profiles, cadence, card proc chance | `13` |

## 4. `data/taxonomy.json` — `mma.taxonomy` v1

Machine-readable vocabularies (the lists in docs 03–13): `ratings`, `tendencies`, `fightingStyles`, `weightClasses`, `slots`, `limbs`, `sides`,
`targets`, `contacts`, `healthEvents`, `regions`, `clinchPositions`, `clinchStrikes`, `clinchTakedowns` (position → role → moves, the observed
88-entry matrix collapsed to move names), `standupTakedowns`, `takedownDenials`, `groundPositions` (13 observed + our `downed`),
`floorPostures`, `groundStrikes`, `submissions` (technique → category + `from: {position: role}`), `judgeComponents` (12), `aggressionFactors` (21),
`goalTypes`, `resultTypes`. UI localisation keys should be derived from these ids so a new move or position cannot ship without a string.

## 5. Replays — `mma.replay` v1 (`data/replays/golden-1.json`)

```json
{ "schema": "mma.replay", "version": 1, "seed": 77, "tunables": {}, "fighters": [ /* full fighter specs */ ],
  "rounds": 1, "roundSeconds": 120, "restSeconds": 60,
  "log": [ { "tick": 1, "id": "f_grappler", "intent": { "move": { "x": 1, "y": 0 } } }, … ],
  "checkpoints": [ { "tick": 30, "hash": 1976767373 }, … ],
  "result": { "result": "unanimous_decision", "method": "decision", "winner": "f_thai", "…": "…" }, "ticks": 7301 }
```
`log` is **run-length**: an entry appears only when a fighter's frame *changes*; `intent` is the compact frame (only non-default fields,
`compactIntent` / `expandIntent`). `checkpoints` are state hashes every 30 ticks (`17` §7). Viewing = `playReplay(data, {upTo})`.

## 6. Other contracts documented elsewhere

* **Intent frame** (controller → sim): `14` §2 · `reference/src/input/intent.js`.
* **Event vocabulary** (sim → presentation, stats, referee, story): `16` §1 · `reference/src/sim/events.js`.
* **Stats keys** (dotted counters, per fight and per round): `16` §2 · `reference/src/sim/stats.js`.
* **Bout interface**: `17` §5.

## 7. Optional: style-imitation table — `mma.style` v1 **[REC, not implemented]**
For the "learn from the player" idea of `13` §2.6 (the reference ships `RealAI-{DPs,FVs,MFD,PFD,SHs,STATs}` files for this; their format is
**[GAP]**). A minimal design that fits our intent currency:
```json
{ "schema": "mma.style", "version": 1, "fighter": "f_striker",
  "rows": [ { "bucket": "standup|r2|a1|c0|opp:recovering|s2", "action": { "kind": "strike", "moveId": "back_cross_head" }, "n": 12, "score": 7.5 } ] }
```
* `bucket` = `(mode, range band 0–3, bearing band 0–2, cage flag, opponent state ∈ {idle, attacking, recovering, helpless}, stamina band 0–2)`
  built from the `FighterSituation` (`reference/src/core/situation.js`), so the same function buckets live play and training data.
* `n` = times the human chose this action there, `score` = outcome-weighted sum (landed +1, damage dealt, was countered −1 …).
* At decision time the brain samples a row with probability ∝ `score`, with probability `imitation ∈ [0,1]` (linked to difficulty),
  otherwise it uses the archetype model. Rows are tiny; a fighter's table stays under a few hundred KB.

## 8. Validation checklist for a new pack
1. Every id unique; every cross-reference (skill, ability, tendency, style) exists.
2. Moves: the `validateMove` rules, plus *at least one* move for every limb × side × target cell the AI may ask for, and cancel windows that start after the active frames.
3. Fighters: all 25 ratings present or defaulted, in 0–100; `reachCm` and `heightCm` plausible.
4. Tunables: no unknown keys (the dead-knob test), probabilities in 0–1, `Init < base` in every health-event profile (`06` lessons).
5. Run `npm test` and `npm run calibrate` — a new content pack that breaks the finish-rate envelope (`19`) needs rebalancing before anything else.
