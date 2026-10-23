# 20 · Gaps, and the data to request next

Tags: **[GAP]** = not recoverable from the APK. Everything in this plan tagged **[REC]** is an original value standing in for something in this file.

## 1. The gap in one paragraph

The APK is a thin Java shell (`com.ea.blast.*` bridge, Google Play services, ads, Firebase) around one stripped native library, `libufcandroidzf.so`, which
contains the *engine* — the animation/gameplay graph runtime ("Ant"), the data bus ("Noa"), the Lua statechart flow engine, Scaleform UI, Blaze online. The
authored **fight content** — animations, per-event probability tunables, per-fighter attributes, AI state machines, card definitions, audio banks — is not
in the APK. It ships in the **expansion file (OBB)**, a ZIP named `main.66.com.ea.game.easportsufc_row.obb` that the game's `TCDownloaderService`
fetches and `CoreFileSystemObbZip` mounts; the game refuses to start without it (`01` §3, §5). That file was not available, so:

* **Exact** (decoded from machine code): the *structure* of `HealthEventProbability`, `SwitchHealthEvent`, `SnakeMeter`, `ButtonSnipe`, `UTSubmissionMinigame`,
  `LocoSpeedByAngle`, `DeadZoneFilter`, `ApproachFilter`, hysteresis, `RangeToRatio` — and the constants inside them (`02` §4).
* **Observed** (identifiers present in the binary): the vocabulary — strike grid, ratings, positions, submissions, judge components, AI factors, stories (`02` §5).
* **Original** (ours): every number that decides *how often* and *how hard* — all of `data/tunables.json`, `moves.json`, `fighters.json`.

## 2. What the missing data would settle

| If we had… | We could replace / verify | Where it lands in our code |
|---|---|---|
| the **health-event parameter sets** (per event: `ProbabilityMin/Max/Init`, `GrowthNumStrikes`, damage-ratio and stamina knots, the attribute direction) | our 9 invented profiles; whether `FighterAttribute` rises or falls with chin | `healthEvents.profiles`, `health-events.js: vulnerability` (`06`) |
| **`tunables_global.xml` and the per-weight-class files** (`tunables_flyweight/lightweight/middleweight/heavyweight.xml` — all named in the binary) | the real gameplay constants and how they scale by weight class; speeds, stamina, damage scaling | `fighter`, `stamina`, `damage`, `defense`, `clinch`, `takedown`, `ground`, `submission` sections; a per-weight-class override layer |
| **`tunables_performance.xml`, `android_lowspec_devicelist.json`** | the real low-spec switches and device list | `17` §8 |
| **strike data**: frame counts, reach, damage base / range per `(side, slot, target)`, branch windows (`BranchTuner`, `BranchOutTagCollection`) | `moves.json` frames, cancel windows, damage; whether `tech`/`sig` mean what we inferred | `moves.json`, `04` §1–2 |
| **`Player_Attributes.xml` / the Attrib database / `ufcroster.bin`** | the 25 rating scales and distributions, physique ranges, per-fighter skill slots | `fighters.json`, `03` |
| **`ai_tunables_<archetype>` assets, `ai_statconverter.xml`, `ai_styleconverter.xml`, `RealAI-*` files, the `realai_f2p` state machines** | the 12 archetype tables, aggression curves, desirability / interest tables, difficulty curves, the learning format | `ai/tendencies.js`, `ai/aggression.js`, `ai/difficulty.js`, `13`, `18` §7 |
| **`card_definitions.xml`, `card_mechanics.xml`, `card_params.xml`, `card_ai_params.xml`** | ability cooldowns, energy thresholds, proc chances, `ForceCardGoal` semantics | `combat/abilities.js`, `15` |
| **minigame parameters** (golf-meter / snake-meter durations and zone sizes, snipe times) and the **callers of the three decoded expressions** | which feature uses `SnakeMeter` with what numbers | `submission.meter`, `takedown.meter`, `10` |
| **`ftue_{blue,red}_corner_fight1..4.xml`** | the scripted tutorial opponents | `ScriptedBrain` scripts, `13` §2.7 |
| **animation clip lists / event tracks** (impact frames, branch-out windows, alignment anchors per position) | `animEvents`, the position anchors and size-compensation offsets | `18` §1 extension points, `17` §5 |
| **Flow-engine statecharts** (`ufcf2p/data/common/flowengine/*.nav` + Lua — present in the APK's `assets/`, already catalogued) | modes and menus; not combat | `15` |
| **Referee / commentary / crowd / replay rule tables** (`replay_group_*` selection rules, story thresholds) | story significance thresholds, replay group scoring | `16` |
| **locomotion data**: the eight speeds `D1…D8` per fighter / weight class and blend-space tables | the real locomotion feel | `fighter.loco`, `11` |

Names above that end in `.xml` / `.json` / `.ini` / `.bin` are file names found in the native library's string table (so they exist), not a promise that they are
in the OBB rather than downloaded at run time from EA's servers (the game also fetches `staticdatacache.json` / `motd.json` and a remote JSON config).

## 3. How to get the OBB (for the person who owns the game)

1. On a device that has the game installed and launched once: `adb pull /sdcard/Android/obb/com.ea.game.easportsufc_row/ ./obb/` (the folder holds
   `main.66.com.ea.game.easportsufc_row.obb`; the number is the `versionCode`). The game's own data folder
   (`/sdcard/Android/data/com.ea.game.easportsufc_row/files/`) may hold downloaded updates and caches as well — send a listing of it.
2. The OBB is a ZIP: `unzip -l main.66.com.ea.game.easportsufc_row.obb > obb-listing.txt`. **Send the listing first** — it is small, and it lets us pick files instead of
   moving gigabytes.
3. Then send, in this order of value (paths are the ones the APK's configs mention, `01` §5):
   * `ufcf2p/data/common/manifests/` — **`allschemas.schema`** and `f2p.manifest` (the *schemas* of the attribute database: even without the values they tell us every field and its type);
   * `ufcf2p/data/android/database/attrib/` (the attribute DB: tunables, ratings) and anything matching `*tunables*`, `Player_Attributes*`, `*roster*`;
   * `ufcf2p/data/common/card_f2p/` (`card_definitions.xml`, `card_mechanics.xml`, `card_params.xml`, `card_ai_params.xml`, the `ftue_*` files);
   * `ufcf2p/data/common/realai_f2p` and `*ai_*`, `*RealAI*` (the AI state machines and tunables);
   * `ufcf2p/data/common/noa/configs`, and the fighter bundle `ufc_f2p_fighters_common.cba` (a binary — send it, but expect a decoding pass);
   * any other `.xml` / `.json` / `.ini` / `.lua` / `.csv` under `ufcf2p/data/common/`; and, if you can, the remote configs the game fetches from
     `https://config.easports.com/ufcf2p/android/<name>.json` (they are plain JSON).
   Skip textures, audio banks, video and the `anim/` clip data for now (we only need the *event tracks* from it later, if at all).
4. Put them in their own empty folder and tell the next agent the path; they will analyse them in a sandbox, read-only, and never run anything found inside.

**What happens next:** the next agent maps each file onto the tunable / pack it settles (table in §2), replaces the original value, re-runs `npm run calibrate`, re-records the
golden replay, and updates the **[GAP]** tags in the docs to **[DATA]**. Binary formats (the Attrib database, `.bin` files) need a short reverse-engineering pass first;
the tools in `tools/apk-analysis/` are the starting point.

## 4. Legal and provenance note
* This repository contains **no decompiled source, no extracted assets, no animations, no audio, no textures and no real athlete names.** It contains
  (a) written descriptions of mechanics, (b) identifiers used as *vocabulary* (enum names, event names — facts about how a program is organised),
  (c) algorithms re-derived from the machine code and re-implemented from scratch in original code, with original constants where the original's were data,
  and (d) wholly original numbers and fictional fighters.
* Only analyse files you are entitled to examine (your own copy of the game, for interoperability / research). Do not redistribute the OBB or anything extracted from it;
  the plan is designed so that *nothing in this repository depends on doing so*.
* If the project is ever to ship, treat the observed vocabulary as inspiration and rename freely (the data packs are the only place names live), and have a lawyer look at
  anything derived from a competitor's product before release.

## 5. What can still be decoded from the APK alone (no OBB needed)
In order of value (from `02` §7): (1) the `UFCOctagonProximitySceneOp` evaluator (cage-awareness math), (2) the camera expressions `RevolveOctagon` / `RevolveOctagon2` /
`FramePoints` / `AvoidCylinder`, (3) the `Counter*` family and `ReplayChoice`, (4) the rest of the Ant-expression registry at `0x173f50` (the names are
known, most bodies are not), (5) the Lua flow-engine statecharts (`assets/*.nav`, `lua/`) for the exact menu / mode transitions. Use `tools/apk-analysis/` (`README.md` there).

## 6. What the next agent can do without any of it
Everything in `19` §3. The design is data-driven precisely so that the real numbers can be dropped in later without touching code; the calibration CLI and the
finish-rate envelope are how a *different* set of numbers (ours, the original's, or a tuned blend) gets validated. Treat the OBB as an optional accuracy upgrade,
not a dependency.
