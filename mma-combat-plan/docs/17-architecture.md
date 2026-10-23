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
flow statechart (the reference's `loadModules/unloadModules` actions).

## 3. Tick order (one 1/60 s step) **[REC]**

```
1  collect Intents (human devices + AI brains), stamp with tick                      ← replay log records this
2  apply intents → per-fighter action requests (buffering/cancel windows)            (04, 14)
3  locomotion: velocity from move vector × speed table, wall collision, facing       (11)
4  action step: advance each fighter's current action (startup/active/recovery) in id order
5  hit detection for active actions → candidate contacts (symmetric: both evaluated before any damage)
6  defence resolution (guard/parry/slip/catch/step-back) → contact outcomes           (05)
7  damage + pools + injuries + stamina; trades resolved simultaneously                (04, 06)
8  health events ladder (seeded per strike)                                            (06)
9  mode transitions: clinch entry/break, takedown phases, ground transitions, submission sessions (07–10)
10 referee: idle timers, TKO/KO checks, bell, clock                                    (12)
11 stats + events flushed to the bus (deterministic order) ; state hash every 30 ticks
```
Rules: iterate fighters in **stable id order**; never read wall-clock time in the sim; all randomness from named seeded
streams (`rng.js`); no floating-point iteration order dependence (don't iterate hash maps).

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
* roles `dom`/`sub` (+ who initiated), position id, timers, hold values;
* a **shared transform** (centre + heading); each fighter has an offset/anchor per role/position;
* alignment (smoothly snap fighters to anchors — `AlignmentDriver`/`DoAlignment`) and **size compensation**
  (height/reach difference → offset scale — `InteractionScale*`, `RelativeIk*`);
* the rule table for that mode (available actions, contests, transitions, subs).
While a Bout is active, normal locomotion is replaced by the Bout's rules (`ClinchLocoController`, `DomLocoAllowed`,
`SubLocoAllowed`). Ending a Bout releases both fighters back to Standup/Down with a placement rule.

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
* Sim state hash (xxhash/FNV over key fields) every 30 ticks → desync detection.
* Replay = `{seed, packVersions, tick→intents, keyframes every 120 ticks}`; viewing re-simulates; highlight selection uses
  event markers (`16`).
* Lock-step netplay is straightforward: exchange intents with a 3–6 tick input delay; rollback optional (state snapshots
  are small: two fighters + bout + rng states). The reference's `OnlineStartFrame/EndFrame` modules and Blaze reporting show
  online play was a design target.
* Cross-engine ports must reproduce: LCG constants (`06`), integer tick math, iteration order, rounding of ticks from seconds.

## 8. Performance and platform budgets **[ARCH]**
Reference budgets (useful as proportions): in-game **FE 20 MB**, **Render 40 MB**, **Replay 30 MB**, NaturalInput 0 MB;
front-end 50/20/20/3 MB. Sim must stay well under 1 ms/tick on a mid phone; presentation owns the rest of the 16.6 ms.
Provide `lowspec` switches: fewer crowd members, simpler shaders, no cloth, 30 Hz render with 60 Hz sim.

## 9. Testing **[REC]**
Unit tests per module (acceptance lists in docs `04–16`) · statistical tests for probabilities (fixed seeds, tolerance) ·
golden replays (input log + expected state hash) · property tests (stamina never negative; pools never < 0; one bout per
fighter) · calibration sims in CI (finish-rate envelope) · UI snapshot of HUD contracts.

## 10. Porting map
| Concept | JS reference | Unity | Godot | Unreal |
|---|---|---|---|---|
| Sim tick | `FightSim.step()` | `FixedUpdate` (0.016667) | `_physics_process` @60 | `Tick` with fixed sub-step |
| Data packs | JSON | ScriptableObject import | Resource (.tres) import | DataTable/DataAsset |
| Event bus | `EventBus` | C# events / UnityEvent | signals | delegates |
| Statechart | `Statechart` | Animator/custom | StateChart addon | StateTree |
| Intents | `Intent` objects | struct | Dictionary/class | USTRUCT |
