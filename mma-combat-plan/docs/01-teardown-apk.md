# 01 · APK teardown — what the reference game ships, and what it does not

Provenance legend used across this plan: **[CODE]** decoded from machine code · **[DATA]** an identifier/enum/config
present in the binary or shipped files · **[ARCH]** inferred from class/asset names or structure · **[REC]** our own
recommendation · **[GAP]** not in the APK (see `20-gaps-and-next-data.md`). Details of how each tag was earned are in
`02-evidence-and-method.md`.

## 1. Subject

| Item | Value |
|---|---|
| Package | `com.ea.game.easportsufc_row` ("UFC", free-to-play mobile build of a console-class MMA game) |
| Version | `1.9.3786573`, versionCode `66`, minSdk 15, targetSdk 28 (compiled with SDK 28; file dates Sep 2019) |
| ABIs | `armeabi-v7a`, `x86` (no arm64) |
| APK size | 42,948,232 bytes · SHA-256 `cb3d3a1e…c6d042` |
| Game library | `lib/*/libufcandroidzf.so` — ARM 34.6 MB, x86 42.5 MB, **stripped** (no `.symtab`) but 5,030 exported dynamic symbols (engine/online only; no gameplay classes) |
| Other native | `libNimble.so` (EA Nimble SDK stub), `libc++_shared.so`, `gdbserver` (leftover NDK debug binary) |
| Toolchain marks | clang 5 / gcc 4.9 / gold 1.11, `-fno-rtti` (no RTTI names), libc++ (`std::__ndk1`) |

## 2. What is inside the APK

| Path | Size | Meaning |
|---|---|---|
| `classes.dex` | 10 MB | Thin Java shell. ~3,800 classes (5,699 decompiled source files, only 287 of them under `com/ea`), >90 % third-party (Google Play services, Firebase, ads, Facebook, Spring/JSON). EA code: `com.ea.blast.*` (platform bridge), `com.ea.nimble.*`, `com.ea.game.easportsufc_row.*` |
| `lib/` | 77 MB uncompressed | All gameplay, rendering, audio, UI runtime, online stack |
| `assets/ufcf2p/data/` | ~1 MB | Boot/flow `.nav` files + Lua statechart library, 56 compiled shader files (`.rsf`), 2 fonts, small config files, 10 loading-slideshow string DBs (T3db, compressed) |
| `res/` | 11 MB | Android UI for the downloader/loading screen (467 drawables), `bgm.mp3`, 4 short UI sounds, `ea.mp4` splash |

**No fight content is in the APK** **[GAP]**: no animations, no character models/textures, no strike/frame data,
no AI tunables, no card definitions, no arena meshes, no commentary audio. These live in a Google Play
*expansion file* (OBB, a ZIP) plus remote JSON config (see §5).

## 3. Java layer (decompiled with jadx)

* Entry: `samplegamezf extends samplegame extends com.ea.blast.MainActivity`; loads `c++_shared`, `Nimble`,
  `ufcandroidzf`.
* Content delivery: Google Play APK Expansion downloader (`TCDownloaderService`, `DownloaderClientMarshaller`);
  `CoreFileSystemObbZip` mounts the OBB ZIP and hands it to native code (`InitAssetManagerClassNativeImpl`).
  The game refuses to start without the OBB for the matching `versionCode` ("main.66…obb").
* Input bridge **[CODE-level facts, Java]**:
  * Touch → `TouchSurfaceAndroid.NativeOnPointerEvent(type, pointerId, ?, x, y)`; types are
    *RawPointerDown / Move / Up / Cancel*. Multi-touch capability is queried. **Every gesture decision is made
    natively**, not in Java.
  * Gamepad → `NativeOnJoystickEvent(device, stickId, x, y)` for two sticks (axes X/Y and Z/RZ) and
    `NativeOnKeyEvent(device, keycode, down, pressure)` for buttons and analog triggers (L2/R2 reported as keys 104/105).
    Moga controllers have their own adapter.
  * Also: accelerometer, vibrator (haptics), keyboard/mouse (desktop-style), NFC, location, battery, power manager.
* Everything else (ads, Facebook, Firebase push, HockeyApp updater, Playhaven, Supersonic) is monetisation/telemetry
  glue and irrelevant to combat.

## 4. Native engine stack (from exports, strings, class-name vocabulary)

| Layer | What we can say |
|---|---|
| **Ant** (`EA::Ant::*`, hundreds of `*Asset`/`*Controller`/`*SceneOp` types) | EA's data-driven animation + gameplay graph: controllers (clip, blend, blend-space, state-flow, mirror, layers, time-scale, IK), "scene ops" run each frame in a matrix, an *expression* VM (math/logic nodes registered in a registry), a *GameState* blackboard, a *ContextDatabase* (context-matched selection), a planner (`Plan*` goal/step assets), a *Lua* expression bridge. **[ARCH]** |
| **Noa** (`Noa*Asset`, `basetypes_*`, `ufc_gameplay.xml`) | Typed data/event bus between systems (fighter stats, health, results, training). Per-product configs (`F2P` vs `GEN4`). **[ARCH]** |
| **Attrib / AttribSys** | Binary attribute database (tunables, ratings). Located in `database/attrib/` inside the OBB **[GAP]** |
| **FlowEngine** (`flowengine/*.nav` + Lua) | Hierarchical statechart (SCXML-style, composite + parallel states) that *loads/unloads modules* per state. Defines the whole app lifecycle (below). **[DATA]** |
| **Scaleform GFx** | Flash/AS3 front-end and HUD (`ui_f2p/*.swf`, in OBB). **[ARCH]** |
| **Physics & collision** | RenderWare collision (`rw::collision`), `EA::Physics`, `EACollisionWorld`, ray-cast / pie-wedge / volume queries, active-ragdoll "muscle" blending, relative-IK, grab/hold physics. **[ARCH]** |
| **Audio** | EA Audio Core + AudioFramework: venue-specific modules for announcer, commentary, crowd, referee, trainers, SFX, music, replay "story". **[DATA]** |
| **Rendering** | Lynx (VFX), Cram (crowd/props), PowerRing, PostFx, GLES2. Shader families: `player_skin`, `player_fabric_doublesided`, `octagon_mat`, `cage_enviro_basic`, `crowd_basic`, `lynx*`. Low-spec variants exist for most. **[DATA]** |
| **Online** | Blaze (EA matchmaking/game reporting; "GameReporting::UFCF2PSoloReport"), Nimble, UltEvents (live events). **[DATA]** |

### Runtime composition (from `game.nav` / `backend.nav`)

```
Root → GameMain
  Startup → (advance) → Started
     Boot / InitialBoot → PostBoot
        Frontend   (menus: UIFE, audio menu music, OnlineFE)
        Backend    (a fight)
           BackendPreload → LoadToBackend → BackendMain → OnlineBlockLoadBE → BackendCommon → Backend
```

* **Two threads**: *SimThread* (anim, gameplay, audio, UI logic, online) and *RenderThread* (render, Lynx, Cram, PostFx);
  communication through message queues; a shared `Jobs` scheduler (all job classes alias one "GeneralScheduler",
  512-slot priority queue). **[DATA]**
* Modules loaded for a fight (`Backend`): `Gameplay`, `Card`, `UICard`, `World`/`WorldEntity` (aggregates audio,
  render, gameplay, noa, online and UI world-components), `GameInput`, `NoaSetup`, `AnimLoadToBE`, `AnimGameTalk`,
  venue audio modules, `Replay` (+ "StartRecording" on entry, "StopRecording" on exit), Online start/end-frame hooks.
  Per-frame hooks named `Gameplay::PopulateSceneOpMatrix` and `Gameplay::UpdateCallback`. **[DATA]**
* The same binary serves two products: `F2P` (this build) and `GEN4` (console-style). F2P turns **off** `GameModes`,
  `Cap` (create-a-fighter), `Movie`, `ICE` (presentation), `NoaReplay`; it turns **on** `Card`, `UICard`,
  `UIPreload`, a replay mock. **[DATA]**
* Memory budgets (`memorybudget.cfg`): Front-end 50 MB, In-game 20 MB (FE subsystem); Render 20 MB front-end /
  40 MB in-game; Replay 20 MB / 30 MB; NaturalInput 3 MB / 0. Low-spec device list (`android_lowspec_devicelist.json`)
  selects `lowspec` tunables and `*_low` shaders. **[DATA]**

## 5. Where the real game data lives (not in the APK) **[GAP]**

Evidence in strings and configs:

* `ufcf2p/data/common/card_f2p/` : `card_definitions.xml`, `card_mechanics.xml`, `card_params.xml`,
  `card_ai_params.xml`, `userPreference.json`, `gameFace.json`, `ftue_pick_six.json`, `ftue_start_challenge_response_%d.json`
* `ufcf2p/data/common/realai_f2p` (AI state-machine assets), `ufcf2p/data/common/noa/configs`,
  `ufcf2p/data/android/database/attrib/` (attribute DB), `ufcf2p/data/common/anim/`,
  `ufc_f2p_fighters_common.cba` (fighter bundle), `ufcf2p/data/common/manifests/` (`f2p.manifest`, `allschemas.schema`)
* Remote config: `https://config.easports.com/ufcf2p/android/<name>.json`; online service name `ufc-2015-f2p`.
* Dev-only artefacts left in the shipping config: `netfs.ini` (LAN file server), `BugSentry`, `Juice` test harness,
  `gdbserver` — evidence of an internal test pipeline (debug HTTP server `HttpdDebug`, debug console, memory dumps).

**Consequence for this plan:** structure, vocabulary, formulas decoded from code, and rule shapes are solid;
*numeric tuning, authored move timings, AI parameters, and card values are not available* and are replaced by our own
starting values, flagged **[REC]** throughout.

## 6. Cultural/product notes worth keeping

* Mobile F2P layer sits *on top of* a full simulation: hybrid of console-style systems (health regions, clinch, ground,
  submissions) with touch-friendly abstractions (light/medium/heavy strikes, ability "cards" with cooldowns, timing
  meters). See `14-input-and-controls.md` and `15-modes-progression-f2p.md`.
* Energy / coins / packs / quests / ads are product design, not combat. We document them only to explain the code that
  surrounds the fight (e.g. `ForceCardGoal`).
