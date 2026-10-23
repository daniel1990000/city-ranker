# MMA combat plan

A complete, original plan **and working reference implementation** for the combat of an MMA game — stand-up striking, defence, clinch, takedowns, ground game,
submissions, damage and knockouts, referee, judging, AI, input, events, replays — built from a study of a shipped mobile MMA game's APK
(`com.ea.game.easportsufc_row` 1.9.3786573) and written for **the next agent (or team) to implement in the game's engine**.

The study could only see the APK. The APK is a thin Java shell around one stripped native engine; the authored fight data (animations, per-event tunables,
fighter attributes, AI state machines) lives in an expansion file (OBB) that was **not available**. So this repository contains:

* what the machine code and the string tables prove (exact algorithms for ten gameplay functions; a near-complete vocabulary of the systems),
* a design for everything else, with every uncertain claim tagged,
* **`reference/`: a deterministic, dependency-free simulation of a whole fight** (ES-module JavaScript, 216 tests) that realises all of it with original code and
  original numbers, calibrated to a plausible MMA finish mix,
* the content packs, a golden replay, a calibration tool, the analysis tooling, a phased roadmap, a backlog, and an exact list of what data to ask for next.

> Nothing here is copied from the game: **no decompiled code, no assets, animations, audio, textures or real athlete names.** Mechanics are described in prose,
> identifiers appear only as vocabulary, algorithms were re-derived and re-implemented from scratch. See "Provenance" below and `docs/20` §4.

## Start here

| If you want to… | Read |
|---|---|
| understand what was found and how far to trust it | `docs/02-evidence-and-method.md` (the tags below are defined there) |
| see how the pieces fit | `docs/17-architecture.md` (module map, tick order, Bout interface, determinism) |
| plan the work | `docs/19-implementation-roadmap.md` (phases, calibration results, backlog B-01…B-20, risks) |
| know what is *not* known | `docs/20-gaps-and-next-data.md` (the OBB gap and exactly which files to ask for) |
| implement a system | its doc, `04`–`16`, each ending with acceptance tests that exist as code in `reference/test/` |
| use the data | `docs/18-data-schemas.md`, `data/*.json` |
| run something | the commands below |

## Quick start
```bash
cd mma-combat-plan/reference            # Node >= 20, no dependencies, nothing to install
npm test                                # 216 tests, ~8 s
npm run demo -- --seed 3 --a f_brawler --b f_striker      # play-by-play of a whole 3-round fight, cards, stats, stories
npm run calibrate -- --fights 300 --seed 1                # N bot-vs-bot fights vs the design bands (parallel, ~1 min)
npm run build-data                      # regenerate ../data/*.json from the sources (a test pins them together)
npm run golden                          # re-record ../data/replays/golden-1.json — only if you changed the sim on purpose
```
Public API: `reference/src/index.js` (`FightSim`, `World`, `Brain`, `GamepadMapper`, `TouchRecognizer`, `playReplay`, …). The sim consumes **intent frames** and emits
**events**; it renders nothing.

## Provenance legend (used in every doc)
| Tag | Meaning |
|---|---|
| **[CODE]** | an algorithm read from the machine code, constants read from data — exact |
| **[DATA]** | an identifier / enum / config that exists in the shipped files — the *existence* is certain, the semantics may be inferred |
| **[ARCH]** | inferred from class and asset names and how they group — plausible, not proven |
| **[REC]** | our recommendation or original value — change freely |
| **[GAP]** | not recoverable from the APK (lives in the OBB or on a server) — do not guess |

**Solid:** the structure and constants of `HealthEventProbability` (18-input stun / knockdown / KO probability), `SwitchHealthEvent` (the seeded dice), `SnakeMeter`,
`ButtonSnipe`, `UTSubmissionMinigame`, `LocoSpeedByAngle`, `DeadZoneFilter`, `ApproachFilter`, hysteresis and `RangeToRatio`; the vocabularies (25 ratings, 12 AI archetypes,
10 fighting styles, the strike grid, clinch positions and the 88-entry clinch-takedown matrix, 13 ground positions, 20 submissions with their position tables, 12 judging
components, 21 aggression factors, health events). **Inferred or ours:** every probability, frame count, damage number, AI weight and camera rule.

## Assumptions
* **Engine-agnostic.** The target engine was not specified, so the reference is plain JavaScript with no dependencies; the docs give a porting map (`17` §10).
* **Original content.** All moves, fighters and numbers are ours; the bundled fighters are fictional archetypes (`Striker Prime`, `Brawler Prime`, …).
* **60 Hz fixed step, deterministic.** Same seed + same intents ⇒ bit-identical fight; replays are `seed + run-length intent log + hash checkpoints`.
* **3 × 5:00 is the calibrated format.** Five-round fights run hot (`19` §2 "Known miss").
* **Bots are `pro` difficulty** in all calibration numbers.

## Folder map
```
mma-combat-plan/
├─ README.md                     you are here
├─ docs/                         01–20: teardown, evidence, one doc per system, architecture, schemas, roadmap, gaps
├─ reference/                    the working implementation (Node ≥ 20, no dependencies)
│  ├─ src/{core,combat,ai,input,sim,data,meta,testing}/    ≈ 5 700 lines — module map in docs/17 §2
│  ├─ test/                      216 tests in 21 files, incl. statistical, invariant, golden-replay and documentation-consistency tests
│  ├─ demo/                      headless-fight · calibrate · build-data · record-golden
│  └─ package.json               npm test | demo | calibrate | build-data | golden
├─ data/                         generated content packs: moves.json (37), fighters.json (8), tunables.json, taxonomy.json, replays/golden-1.json
└─ tools/apk-analysis/           the read-only static-analysis scripts behind the evidence (+ README with reproduction steps)
```

## The documents
| # | Title | One line |
|---|---|---|
| 01 | APK teardown | what the game ships (and what it does not) |
| 02 | Evidence and method | tags, the register of decoded functions, soft spots in the decode |
| 03 | Fighter model | regional health, 25 ratings, archetypes, skills, injuries |
| 04 | Stand-up striking | the strike grid, frames, cancels, hit detection, damage tiers |
| 05 | Defence and counters | guard, parry, slip, catch, counter windows |
| 06 | Damage and health events | the decoded stun → knockdown → KO formula and dice; calibrated profiles |
| 07 | Clinch | entry, roles, pummel, strikes, takedown matrix, cage pin |
| 08 | Takedowns | three phases, sprawl, resolvers, denials, slams |
| 09 | Ground game | position graph, transitions, ground-and-pound, get-ups |
| 10 | Submissions and minigames | five stages, tap decision, the three decoded minigames |
| 11 | Movement, cage, camera | speed table, input filters, octagon geometry, camera rules |
| 12 | Referee, rounds, judging | match statechart, stoppages, 10-point-must with three judges |
| 13 | AI | archetypes, aggression, goal draw, difficulty, pounce |
| 14 | Input and controls | intent frame, buffering, touch gestures, gamepad mapping |
| 15 | Modes, progression, F2P | the ability-card layer and the optional meta |
| 16 | Events, stats, story, replay | the event bus as the contract with presentation |
| 17 | Architecture | layers, tick order, Bout contract, determinism, testing |
| 18 | Data schemas | the content packs, the replay format, validation checklist |
| 19 | Roadmap | phases, calibration results, backlog, risks, definition of done |
| 20 | Gaps and next data | what the OBB holds, how to get it, legal note |

## Status
* `reference/`: 216 tests green; 0 illegal AI intents over thousands of bot fights, state invariants checked every tick in the tests; a 3-round fight simulates in ≈ 0.7 s.
* Calibrated 3-round finish mix (pooled 900 fights): KO 14 %, TKO 19 %, submission 11 %, decision 53 %, draw 3 % (`19` §2).
* Known simplifications are listed as backlog items B-01…B-20 in `docs/19` §5.

## Provenance
Written by Claude (Anthropic) from a read-only static analysis of the supplied APK; nothing was executed from it. The code and numbers in `reference/` and `data/` are original
work released with this repository; the game, its name and its content belong to their owners. Only analyse files you are entitled to examine, and do not redistribute the game's
expansion file or anything extracted from it.
