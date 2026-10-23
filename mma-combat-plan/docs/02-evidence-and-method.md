# 02 · Evidence and method

This file exists so the next agent can **trust, check, or extend** every claim in the plan.

## 1. What was analysed

| Artifact | SHA-256 |
|---|---|
| `com.ea.game.easportsufc_row_1.9.3786573-66` APK | `cb3d3a1e0549184f8c22ede5f19cc17c9a5fb25eaa14ca724082130f0fc6d042` |
| `lib/armeabi-v7a/libufcandroidzf.so` | `9ea9f3e25475617672048763df32e2b1b1ea874b354a56508bac15bed20d5c65` |
| `lib/x86/libufcandroidzf.so` | `06066e1b76a15513deea8824f70aaeca4d413ae3099400af80dd6f446e9c73d7` |
| `classes.dex` | `4afb15a6dff0dbc15db9cbe7b4378436309b70fb6ebec5673268dee27de0ea93` |

Only the APK was available. The expansion file (OBB) with the authored content was **not** available.

## 2. Method

1. Extracted the APK (multi-volume RAR → APK → ZIP) into scratch directories; nothing from it is stored in this repo.
2. Decoded the manifest (androguard) and decompiled the DEX (jadx 1.5.6). Result: Java is a thin bridge (see `01`).
3. Inventoried `assets/` — flow-engine statecharts (`*.nav`), Lua statechart library, configs, shaders, fonts.
4. Mined the native library's `.rodata` for **identifier families** (`basetypes_*`, `standup_*`, `strike_*`,
   `submission_*`, `story_*`, `ai_*`, `fighter_skills_*`, `FIGHTER_*`, `gtrigger_*`, `aggression_factors_*` …) and
   for **class/asset type names** (1,598 CamelCase names) — a near-complete vocabulary of the game's systems.
5. Used the **x86 build** (unambiguous instruction decoding, `.eh_frame_hdr` gives 121,348 function boundaries) to:
   * resolve `lea r32,[ebx+disp]` string references (PIC) → which function uses which name;
   * find the registry block (function `0x173f50`) that calls `fn_19b9b90(dest, &msMethod, EVAL_FN, 0, 0)` for every
     *Ant expression* and therefore gives each expression's **evaluator address**;
   * recover each expression's exact **parameter/result/state list** from its descriptor functions (jump tables);
   * disassemble the evaluators of the gameplay-relevant expressions and translate them to formulas.
6. Read float/double constants from `.rodata` to turn disassembly into exact numbers.
7. Cross-checked semantics against the vocabulary (e.g. a function's parameter names vs. the formula's structure).

No code was executed from the APK and no dynamic analysis was done.

## 3. Confidence legend

| Tag | Meaning | How much to trust |
|---|---|---|
| **[CODE]** | Algorithm read from instructions; constants read from data | High. Re-derive with `tools/apk-analysis` if in doubt |
| **[DATA]** | Name/enum/config exists in the shipped files | High that it exists; *semantics* may be inferred |
| **[ARCH]** | Inferred from class/asset-type names and their grouping | Medium. Plausible design, not proven |
| **[REC]** | Our design decision | It is ours: change freely |
| **[GAP]** | Not recoverable from the APK (lives in the OBB / server) | Do not guess; see `20` |

## 4. Register of decoded native functions (x86 build virtual addresses)

All are *Ant expressions*: `evaluate(State** st, Outputs** out, Inputs** in)`; each argument is an array of pointers.

| Expression | Evaluator | Signature source | What it is | Spec |
|---|---|---|---|---|
| `HealthEventProbability` | `0x11c7df0` | 18 in / 1 out | Probability that a landed strike causes a stun/knockdown-class event | `06` |
| `SwitchHealthEvent` | `0x11c8440` | 5 in / 1 out / 4 state | Seeded dice: decides whether to *switch* to a new health event | `06` |
| `ButtonSnipe` | `0x11c6c10` | 14 in / 5 out / 3 state | Reaction-time minigame (press the prompted button) | `10` |
| `UTSubmissionMinigame` | `0x11c72d0` | 22 in / 6 out / 7 state | Submission "snipe chain": count-up then countdown | `10` |
| `SnakeMeter` | `0x11c5b00` | 14 in / 19 out / 18 state | Two-sided needle/zone timing meter | `10`, `08`, `09` |
| `ForceCardGoal` | `0x11c8920` | 11 in / 4 out | Forces AI card goals after a card is consumed (signature only) | `15` |
| `LocoSpeedByAngle` | `0x11c32e0` | 9 in / 1 out | 8-direction speed table, linear interpolation over angle | `11` |
| `DeadZoneFilter` | `0x11c4b40` | 3 in / 1 out / 2 state | "Leash" filter for a vector input | `11`, `14` |
| `ApproachFilter` | `0x11c5790` | 6 in / 2 out | Eased chase with decel and snap distance | `11` |
| `GreaterThanWithHysteresis` / `LessThanWithHysteresis` | `0x11beca0` / `0x11beed0` | 4 in / 1 out | Schmitt-trigger comparator | `05`, `13` |
| `RangeToRatio` | `0x11c0750` | 3 in / 1 out | Inverse-lerp with epsilon guard | all |
| registry init | `0x173f50` | — | Registers all of the above by name | — |

Scene ops whose **names/fields** were read but not decoded: `UFCOctagonProximitySceneOp` (8 relative wall normals +
8 angles), `UFCSpringUpdateSceneOp`, `UFCSetPartsFrictionSceneOp` (hand/forearm/foot friction), `UFCSubmissionGameSceneOp`.

### Constants read from data (so formulas above are exact)
`FLT_EPSILON = 1.1920929e-7` (zero guards) · `100.0` (rating divisor) · `0.001` (health floor) · `0.5` (event-chain
re-roll) · `2^-32` (RNG scale) · `1103515245`/`12345` (LCG) · `0.99` (partial-score cap) · `60.0` (speed→per-frame)
· angles `±π/4, ±π/2, ±3π/4, ±π`.

## 5. Identifier families (counts in the ARM string table) — where the vocabulary comes from

`basetypes_*` 373 · `standup_*` 118 · `strike_*` 143 · `submission_*` 81 · `clinch_takedown_*` 88 ·
`story_type_*` 244 · `Csis gtrigger_*` 247 · `replay_group_*` 80 · `overlay_type_*` 80 · `aggression_factors_*` 21 ·
`fighter_skills_*` 45 · `FIGHTER_*` ~150 · `assetlist_*/dynassetlist_*` 106 · CamelCase types 1,598.

Curated, de-personalised lists of these are inside the topical docs and in `data/taxonomy.json`.
Names of real athletes appear in the original data (per-fighter AI tunables, signature strikes). **We deliberately do not
reproduce them**; they are replaced with neutral archetype labels.

## 6. Known soft spots in the decode (read before relying on the number)

* `SnakeMeter` perfect-zone test is only evaluated when the needle is at or left of the zone centre (`diff <= 0`).
  Looks like an original quirk; our spec is **symmetric** **[REC]**.
* `SnakeMeter` ignores its `InPerfectZoneSize` input (the perfect size is computed as one frame of needle travel). We
  expose it as a designer parameter instead **[REC]**.
* `ButtonSnipe`: the state-descriptor order and the evaluator's array indexing for `Timer`/`SnipeButtonBitMask` differ;
  semantics (timer counts up; mask = `1 << button`) are unambiguous.
* `UTSubmissionMinigame` exposes `OutDomWon` but means *"the snipe initiator succeeded"* (it flips with `DomInitiates`).
* Parameter *units* (ticks vs seconds) are not stored in code. The code treats `DeltaTicks` as the unit of time of
  the inputs; `ApproachFilter` divides speed by 60, suggesting 60 Hz ticks **[ARCH]**.
* Strings alone prove existence, not behaviour. Every behavioural statement that is not **[CODE]** is tagged.

## 7. Reproducing / extending (see `tools/apk-analysis/README.md`)

```
x86tool.py  <lib> strx <string>      # who references this name?
x86tool.py  <lib> dis  <va>          # annotated disassembly of the function containing <va>
x86_sig.py  <scripts> <lib> <Name>   # exact parameter/result/state signature of an expression
x86_tu.py   <scripts> <lib> lo hi    # summarise a translation unit's functions
x86_floats.py <scripts> <lib> disp…  # read float constants at GOT-relative offsets
```
Python 3.13 + `pyelftools`, `capstone`. Run with `python -I` and keep the unpacked APK in its own directory.

### Next-most-valuable targets if more decoding is wanted
1. `UFCOctagonProximitySceneOp` evaluator (cage-awareness math).
2. `RevolveOctagon` / `RevolveOctagon2` / `FramePoints` / `AvoidCylinder` (camera framing rules).
3. The `Counter*` family and `ReplayChoice` (cheap; low value).
4. With the OBB: `card_mechanics.xml`, `card_params.xml`, AI tunables, `realai_f2p` state machines, strike frame data.
