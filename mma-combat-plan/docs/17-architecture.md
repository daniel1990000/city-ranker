# 17 · Architecture for our MMA game (engine-agnostic)

Tags: **[ARCH]** = pattern observed in the reference · **[REC]** = our decision. Reference code mirrors this layout in
`reference/src/` (JS ES modules, no dependencies).

## 1. Principles (each one is justified by something the reference does)

1. **Deterministic fixed-step simulation, separate from presentation** — the reference runs a *SimThread* and a
   *RenderThread* with message queues, records input/state for replays, and ships `SyncInput`/`SavedInput` assets.
2. **Everything is data** — moves, ratings, tunables, AI profiles, camera rigs, minigame parameters live in data assets
   (Ant assets, Attrib DB, ContextDB, XML/JSON); code is a generic interpreter. We mirror that: JSON packs + validators.
3. **One intent interface for human and AI** (`AIRequestedActionSlot`).
4. **Event bus feeds presentation** (commentary triggers, HUD services, crowd, replay tags).
5. **Paired states are first-class** (clinch, takedown, ground, submission): `InteractionManager`, roles, slots,
   alignment and size-compensation exist as engine concepts.
6. **Statecharts for flow and modes** — module loading and match flow are hierarchical statecharts (SCXML-style).
7. **Low-spec fallbacks everywhere** (`*_low` shaders, `lowspec` tunables, memory budgets per phase).

## 2. Layers

```
┌ Platform adapter ─ raw input, audio, render, storage, net ───────────────────────────────┐
├ Input layer      ─ buffer → recognizers → Intents                                  (14)  │
├ Sim core (60 Hz) ─ World{cage, fighters[2], referee, clock, rng streams}                  │
│    systems in fixed order: see §3                                                         │
│    Bout (paired state) {mode, roles, shared transform, timers}                    (§5)    │
├ Content          ─ packs: fighters, moves, tunables, taxonomy; loader + validator   (18)  │
├ Event bus        ─ typed events → HUD · camera · audio/haptics · commentary/story ·  (16) │
│                    replay recorder · stats · telemetry                                   │
└ Meta             ─ match flow statechart (12) · modes/progression (15) · services          │
```
Module contract: `init(ctx) / update(dt) / dispose()` + declared dependencies; module sets are loaded/unloaded by the match
flow statechart (the reference's `loadModules/unloadModules` actions). The reference implementation keeps it simpler: plain ES
modules, one `World` object passed around, no framework.

### Module map of `reference/src/` (≈ 5 700 lines, 216 tests; import everything from `src/index.js`)
| Folder | Files | Responsibility |
|---|---|---|
| `core/` | `taxonomy` `tunables` `rng` `math` `statechart` `situation` | observed vocabularies (enums, tables), every number in one tunable tree, seeded named RNG streams and the decoded dice, math + decoded filters, hierarchical statechart engine, the read-only `FighterSituation` perception struct |
| `combat/` | `fighter` `moves` `skills` `stamina` `strike` `defense` `damage` `injuries` `health-events` `impact` | one fighter's state, the move book and selection, perks, the stand-up action lifecycle, guard / parry / slip / catch, the damage pipeline, cuts and swelling, the decoded health-event formula + ladder, and `applyImpact` — the single place a landed strike becomes consequences |
| | `clinch` `takedown` `ground` `submission` `minigames` | the four paired states as **Bouts**, and the three decoded minigames |
| | `referee` `scoring` `abilities` | stoppages and idle rules, judging, ability cards |
| `ai/` | `brain` `aggression` `tendencies` `difficulty` `legality` | perception → aggression → goal draw → plan → intents; archetype data; difficulty curve; the intent legality checker |
| `input/` | `intent` `buffer` `recognizer` `mapping` | the intent frame and quantiser, the input buffer, touch gestures, gamepad / keyboard |
| `sim/` | `world` `fight-sim` `match` `events` `stats` `cage` `locomotion` `replay` `replayer` `story` `batch` | the container, the 60 Hz step, match statechart, event bus, stats, octagon, movement, record / replay, stories, batch runner |
| `data/` `meta/` `testing/` | `default-moves` `default-fighters` · `progression` · `helpers` | bundled original content, belts and rating points, test helpers |

Dependency direction: `core ← combat ← ai/input ← sim`. `combat/*` modules know the `World` (to emit events, read tunables, draw
named RNG streams) but never the `FightSim`; the paired-state modules are therefore unit-testable by building a `World`, putting two
fighters in a state and calling the module (`reference/src/testing/helpers.js`).

## 3. Tick order (one 1/60 s step) **[REC]** — as implemented in `FightSim.step()`

```
0  match gate        between rounds → tick the rest timer ; post-fight → nothing ; stopped (referee) → nothing
                     (a stop *for a knockdown* keeps the sim running — only the round clock stands still)
   world.tick += 1
1  collect intents   external (replay / human / netplay) else controller.think(ctx) → quantizeIntent → replay recorder
2  apply intents     ability bars tick; fighters in an ALTERNATING order (tick parity, so simultaneous clinch / shot attempts are
                     not biased toward fighter 0): defensive/cooldown timers, ability, stand-up intents (buffer, guard, parry/slip/
                     catch, stance, feint, strike start, clinch, shot) or bout.applyIntent, catch release, knockdown follow-up
3  locomotion        stand-up movement (speed table, locks, lunges), disc separation, cage clamp
4  actions           advance each fighter's action (startup/active/recovery); aim assist; hit test → contacts;
                     bout-owned actions (clinch / ground strikes) call bout.resolveAction
5  contacts          TWO PASSES: decide every contact (guard / parry / slip / catch, counter-hit flag) against the pre-tick state,
                     then apply each one with applyImpact: damage → pools → injuries → STRIKE event → health-event ladder
6  modes             bouts update (each once); status timers (stun / wobble / limp, with mash + toughness recovery); leg buckle;
                     knockdown → floor / get-ups; stamina regeneration
7  referee           KO · TKO rules · leg injury · stand-up idle timers → finish the fight
8  bookkeeping       one time bucket per fighter-tick; knockdown stop / resume of the clock; round clock and bell;
                     state hash every 30 ticks (also the replay checkpoint)
```
Rules: iterate fighters in **stable id order** (except step 2, above); never read wall-clock time in the sim; all randomness from named seeded
streams (`rng.js`: `hit`, `defense`, `event`, `injury`, `clinch`, `takedown`, `ground`, `submission`, `minigame`, `referee`, `judges`,
`cut`, plus controller-private `ai.*`); no floating-point iteration order dependence (don't iterate hash maps); do not draw from a stream
conditionally on presentation state.

## 4. Fighter state machine **[REC]**

```
Standup ──clinchEntry──▶ Clinch ──takedown──▶ TakedownPhase{I,II,III} ──▶ Ground ──submissionStart──▶ Submission
   ▲   └──shot──────────▶ TakedownPhase{I…}         │                         │                        │
   └──────────────── getUp / refStandUp / break ◀───┴───── escape ◀───────────┴──────── escape/tap ────┘
Any ──knockdown event──▶ Down (floor posture, timer) ──getUp──▶ Standup | Ground(if attacker follows)
Any ──knockout event──▶ Finished
```
Each state owns: allowed intents, locomotion rule, damage multipliers, camera hint, audio set, referee timers.
Per-state **action runner** executes data-defined actions with frame windows, costs, cancels, and emits events.

## 5. Paired interactions ("Bout") **[ARCH→REC]**
A `Bout` is created when two fighters must move/animate together (clinch, takedown contest, ground, submission). It owns:
* roles `dom`/`sub` (or attacker/defender, top/bottom), position id, timers, hold values;
* a **shared transform** (centre + heading); each fighter has an offset/anchor per role/position;
* alignment (smoothly snap fighters to anchors — `AlignmentDriver`/`DoAlignment`) and **size compensation**
  (height/reach difference → offset scale — `InteractionScale*`, `RelativeIk*`);
* the rule table for that mode (available actions, contests, transitions, subs).
While a Bout is active, normal locomotion is replaced by the Bout's rules (`ClinchLocoController`, `DomLocoAllowed`,
`SubLocoAllowed`). Ending a Bout releases both fighters back to Standup/Down with a placement rule.

**The interface every Bout implements** (so the sim, the AI, the UI, the legality checker and the state hash treat them alike):
```
kind:'clinch'|'takedown'|'ground'|'submission'      finished:boolean      fighters:[a,b]      other(f)
applyIntent(f, intent) → boolean      every tick for each fighter in the bout: the fighter's frame (move, guard, grapple, prompt)
resolveAction(f)                      called by the sim when a bout-owned action (a clinch / ground strike) reaches its active frame
update() → null | {ended, reason}     once per tick (the sim de-duplicates the two fighters' references): timers, contests, referee idle rules
legalActions(f) → [{kind,…}]          everything the fighter may do right now — the AI, the gamepad mapper and the checker all read this
end(reason, opts)                     external abort (bell, knockdown, stoppage); MUST leave the stat invariants intact
release({restore, gap})               hand the fighters back to stand-up, or (restore:false) to the next bout, which sets modes itself
timeKeys(f) → [statKey]               which time bucket(s) this fighter-tick is booked to (exactly one bucket set per tick)
hashNumbers() → number[]              contributes to the state hash (so a replay notices a diverging bout)
```
Hand-offs are explicit and local: `ClinchBout.takedown()` → `TakedownBout` → `GroundBout` (or back to a clinch / stand-up);
`GroundBout.startSubmission()` → `SubmissionBout` → `GroundBout`; a stuffed clinch throw rebuilds the clinch silently. One fighter is
in **at most one bout**; the invariant test (`fight-sim.test.js`) checks it every tick.

## 6. Content pipeline **[REC]**
* **Packs** are folders of JSON: `fighters/`, `moves/`, `tunables/`, `ai/`, `venues/`, `taxonomy.json`; each file declares
  `schema` + `version`. Validator = JSON-schema + semantic checks (e.g. every move referenced exists; ratings 0–100;
  frames sum > 0; cancel windows inside the move).
* **Animation hook**: moves carry `frames` for the sim and optional `animEvents` (`impact`, `branchOut`, `footPlant`) so a
  3D/2D animation can drive timing *or* the sim drives the animation (pick one, keep one source of truth).
* **Context-matched selection** (ContextDB-style) for choosing among variants: filter by `(mode, side, slot, target,
  range band, angle band, stance, cage flags)` then score; implemented as `moves.select()`.
* **Hot reload** in dev; a **calibration CLI** runs N bot-vs-bot fights to print KO/TKO/Sub/decision rates and strikes/round.

## 7. Determinism, replays, netcode **[REC]**
* Sim state hash (FNV over positions, facing, stamina, the four pools, action / status / mode / guard / combo state, the bout's own
  numbers and the sim-owned RNG stream states) every 30 ticks → desync detection. **Controller-private streams (`ai.*`) are left out**:
  a replay feeds recorded intents and never runs the brains, so including them would diverge at the first checkpoint (we hit exactly
  that at tick 30).
* Replay = `{seed, tunables overrides, fighter specs, clock settings, run-length intent log, hash checkpoints, result}`; viewing
  re-simulates from tick 0 (`playReplay`, with `upTo` to scrub); highlight selection uses event markers (`16`). No keyframes
  are needed because a full fight simulates in well under a second.
* Lock-step netplay is straightforward: exchange intents with a 3–6 tick input delay and call `FightSim.step({a: intentA, b: intentB})`;
  rollback optional (state snapshots are small: two fighters + bout + rng states). The reference's `OnlineStartFrame/EndFrame`
  modules and Blaze reporting show online play was a design target. *Not built here:* snapshot / restore of a whole `FightSim`
  (the RNG streams already snapshot / restore; the fighters and bouts do not yet).
* Cross-engine ports must reproduce: LCG constants (`06`), integer tick math, iteration order, rounding of ticks from seconds,
  the movement quantiser, and JS number semantics where they matter (the reference uses doubles everywhere; a port to single-precision
  floats will not match bit-for-bit — pick one numeric type and re-record the golden replay).

## 8. Performance and platform budgets **[ARCH]**
Reference budgets (useful as proportions): in-game **FE 20 MB**, **Render 40 MB**, **Replay 30 MB**, NaturalInput 0 MB;
front-end 50/20/20/3 MB. Sim must stay well under 1 ms/tick on a mid phone; presentation owns the rest of the 16.6 ms.
Provide `lowspec` switches: fewer crowd members, simpler shaders, no cloth, 30 Hz render with 60 Hz sim.
**Measured for the reference sim** (JS on a server-class CPU, two AI brains, debug checks on): ≈ 0.012 ms per tick, i.e. a full 3 × 5 min
fight in ≈ 0.7 s — about 1 400× real time and < 0.1 % of a 16.6 ms frame, so the simulation is never the performance problem.

## 9. Testing **[REC]** — what the reference does (`cd reference && npm test`, ≈ 10 s, Node ≥ 20, no dependencies)
* **Unit tests per module** — the acceptance lists in docs `04–16` are the test plans; each doc names its test file.
* **Statistical tests** with fixed seeds and tolerances: decoded dice pass-rate ≈ `P` (100 k seeds), entry/takedown/escape rates track their
  formulas, goal draws converge to the tendency tables (±3 %), human-vs-AI meter duels (800 each).
* **Invariants over whole fights** (`fight-sim.test.js`): no negative stamina or pools, one bout per fighter, consistent modes, fighters stay in
  the cage; stats reconcile (`landed + blocked + avoided = thrown`; `attempted == landed + denied + missed`).
* **Legality**: the AI must never emit an illegal intent — all 12 tendencies × 3 difficulties, full fights, checked every tick.
* **Golden replay** (`data/replays/golden-1.json`): re-simulated bit-identically; re-record deliberately with `npm run golden`.
* **Calibration CLI** (`npm run calibrate`): N bot-vs-bot fights against design bands (`19`).
* **Documentation consistency** (`data.test.js`): committed JSON packs equal what the sources generate; every tunable key is read somewhere
  (no dead knobs); every tunable path named in the docs exists; every `reference/…` file named in the docs exists.
Still worth adding: UI snapshot of the HUD contracts, fuzzing the touch recognizer with random event streams, a CI job that fails when the
finish-rate envelope drifts.

## 10. Porting map
| Concept | JS reference | Unity | Godot | Unreal |
|---|---|---|---|---|
| Sim tick | `FightSim.step()` | `FixedUpdate` (0.016667) | `_physics_process` @60 | `Tick` with fixed sub-step |
| Data packs | JSON | ScriptableObject import | Resource (.tres) import | DataTable/DataAsset |
| Event bus | `EventBus` | C# events / UnityEvent | signals | delegates |
| Statechart | `Statechart` | Animator/custom | StateChart addon | StateTree |
| Intents | `Intent` objects | struct | Dictionary/class | USTRUCT |
