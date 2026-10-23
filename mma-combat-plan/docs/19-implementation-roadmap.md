# 19 · Implementation roadmap, calibration results, backlog, risks

Tags: **[REC]** throughout — this is our plan, not extracted data. Read `README.md` first, then `02` (what to trust), then this file.

## 1. What exists today (the starting line)

`reference/` is a **complete, deterministic, dependency-free simulation of an MMA fight** in ES-module JavaScript (≈ 5 700 lines of `src/`, 216 tests,
≈ 8 s to run). It is engine-agnostic: the sim consumes *intent frames* and emits *events*; it renders nothing and plays no sound. A full 3-round bot-vs-bot
fight takes ≈ 0.7 s. It has no animation, art, audio or UI — those are the next agent's job, and the sim tells them exactly when to do what (`16`).

| Area | State | Where | Doc |
|---|---|---|---|
| Fighters, 25 ratings, pools, stamina, skills, injuries | done, tested | `combat/fighter` `skills` `stamina` `injuries` | `03` |
| Stand-up striking: strike grid, frames, cancels, aim assist, hit test, reach | done | `combat/strike` `moves` `damage` | `04` |
| Defence: guard, parry, slip, catch, counters, hands-down | done (catch is hold + punch + release only) | `combat/defense` | `05` |
| Damage → health events (decoded formula + dice, ladder, effects) | done, **exact to the decode** | `combat/health-events` `impact` | `06` |
| Clinch: entry, roles, pummel, strikes, takedowns, cage pin, referee timers | done | `combat/clinch` | `07` |
| Takedowns: 3 phases, auto and meter resolvers, denials, slams | done | `combat/takedown` | `08` |
| Ground: position graph, transitions, GnP, posture, get-ups, knockdown follow-up | done | `combat/ground` | `09` |
| Submissions: 31 position/role entries, 5 stages, 4 modes, tap decision | done | `combat/submission` `minigames` | `10` |
| Movement, octagon, wall sensing, input filters | done | `sim/locomotion` `cage` `core/math` | `11` |
| Match flow, referee, TKO rules, doctor, judging (12 components, 3 judges) | done | `sim/match` `combat/referee` `scoring` | `12` |
| AI: 12 archetypes, aggression from 21 factors, goal draw, difficulty, pounce | done, 0 illegal intents in thousands of fights | `ai/*` | `13` |
| Input: intent frame, buffer, touch recognizer, gamepad / keyboard mapper | done (headless; no device adapters) | `input/*` | `14` |
| Abilities (cards) and minimal progression | done as optional modules | `combat/abilities` `meta/progression` | `15` |
| Event bus, stats, stories, replay, golden replay | done | `sim/events` `stats` `story` `replay` | `16` |
| Content packs + generator + consistency tests | done | `data/` `demo/build-data.js` | `18` |
| Calibration CLI, headless demo, batch runner | done | `demo/` `sim/batch` | this file |

**Not in the reference and not evidenced by it:** animation, rendering, audio, camera rigs, UI, networking, fouls, overtime, career mode, store / F2P. See §5.

## 2. Calibration results — what the shipped numbers produce

Targets are **design bands we chose** for a game that should feel like MMA (`reference/src/sim/batch.js: TARGETS`); they are *not* extracted from
the reference. Bot-vs-bot, every default fighter against every other, `pro` difficulty, 3 × 5:00 rounds, default tunables. Reproduce with
`cd reference && npm run calibrate -- --fights 300 --seed 1` (about a minute on 4 cores; add `--json` to script it).

| Metric | Band | seed 1 | seed 2 | seed 11 | pooled (900 fights) |
|---|---|---|---|---|---|
| KO | — | 11.0 % | 15.3 % | 15.7 % | **14.0 %** |
| TKO (incl. ground-and-pound, leg injury, doctor) | — | 17.7 % | 19.3 % | 19.0 % | **18.7 %** |
| KO + TKO | 25–35 % | 28.7 | 34.7 | 34.7 | **32.7 %** |
| Submission | 8–14 % | 11.3 | 9.7 | 12.7 | **11.2 %** |
| Decision | 52–66 % | 56.7 | 52.0 | 49.3 | **52.7 %** |
| Draw | 0–4 % | 3.3 | 3.7 | 3.3 | **3.4 %** |
| Strikes thrown / fighter / round | 40–80 | 51.0 | 50.5 | 50.7 | **50.7** |
| Strike accuracy | 30–45 % | 39.5 | 39.5 | 39.4 | **39.5 %** |
| Significant strikes landed / round | 12–30 | 16.9 | 16.8 | 16.6 | **16.8** |
| Takedown attempts / fighter / fight | 1.5–7 | 5.37 | 5.43 | 5.29 | **5.4** |
| Takedown accuracy | 30–55 % | 45.8 | 44.9 | 44.6 | **45.1 %** |
| Submission attempts / fighter / fight | 1–4 | 2.58 | 2.69 | 2.55 | **2.6** |
| Knockdowns against / fighter / fight | 0.1–0.6 | 0.45 | 0.47 | 0.47 | **0.5** |
| Time share: clinch / ground | 4–15 / 8–25 % | 11.9 / 19.5 | 12.0 / 19.4 | 12.3 / 19.5 | **12.1 / 19.5 %** |
| Average fight length | — | 703 s | 693 s | 683 s | **693 s** |
| Illegal AI intents | 0 | 0 | 0 | 0 | **0** |

**Read the spread honestly:** 300 fights per seed give a standard error of ≈ 3 points on each finish rate, so *decision 52.7 %* sits on the lower edge of its
band and seed 11 is outside it. The bands are wide on purpose; what matters is that no mechanism dominates. A real calibration pass needs the real
content (`20`) and, above all, human playtests.

**How the mix was reached (the iteration log — each line is a lesson):**
1. First complete sim: KO 34 %, TKO 1 %, KO + TKO 35 %. *The AI ignored knockdowns*, so TKOs (the dominant real-world finish) almost never happened.
2. Added **pounce** (`13` §2.4): KO 39 %, TKO 2.5 %. The pounce produced more *KOs* — ground strikes were rolling the `knockout` die on helpless fighters.
3. Excluded `knockout` for ground-mode strikes (the referee stops those fights) and lowered `tkoUnansweredAny` 7 → 5: KO 30 %, TKO 14.5 %.
4. Cut `head.knockout` `Pmax` 0.0075 → 0.003 (×0.4): KO 12.5 %, TKO 15.5 %, total 28 %.
5. **Five-round fights**: per-round finish rate doubled by round 4 because only 3–4 % of the pools healed between rounds. Raised `recovery` to head 14 % /
   body-legs 10 %: the rate is flat at ≈ 19–20 % per round.
6. That lowered 3-round finishes to 20.7 %; raised `Pmax` to 0.0042 (24.7 %), then — once the pounce got an immediate first strike (`nextDecision = now`) and
   every pounce on a defenceless fighter ended in a TKO — settled at 0.0034 with the pooled numbers above.

**Known miss — five-round fights (title mode).** `--rounds 5` gives KO 20 %, TKO 31 %, submission 15 %, decision ≈ 32 % (real title fights go the distance about
half the time), with a per-round finish rate of ≈ 19–20 % that does not fall in later rounds (round 4 spikes to ≈ 27 %). Stamina is not binding in this
calibration (fighters start every round at ≈ 97 %), so nothing makes them pace themselves. Fix options, in order of cost: a *title preset* of lower
`head.knockdown` / `head.knockout` probabilities (tested: removes ≈ 8 points of KO but not the TKO excess), AI output that scales with round count and
stamina, a binding stamina curve. This is backlog item B-15.

**Per-hit numbers** (head strike on a default fighter, attacker fresh) are tabulated in `06` §4; the whole health-event ladder at a glance:
wobble ≈ 7 %, stun ≈ 5 %, critical stun ≈ 2 %, knockdown ≈ 0.3 %, KO ≈ 0.06 % per landed head strike at the start of a round, rising ×3–10 for a
battered pool deep into a round.

**Performance:** ≈ 0.012 ms per tick (a 3-round fight in ≈ 0.7 s; ≈ 1 400× real time) with both AI brains and debug checks on.

## 3. Phased plan for the real game

Each phase ends with a demo build, the listed tests passing, and a calibration run. "Port" = re-implement the module in the engine's language, using the
JS tests as the oracle (`17` §10); "bind" = embed the JS sim in the engine behind the intent/event interface (QuickJS / V8 / Hermes). Recommended: **bind
first** to get a playable slice in days, **port module by module** behind the same interface so the JS tests and the golden replay keep proving
equivalence, and switch the packs' source of truth from the JS generator to the JSON (`18`).

| Phase | Goal | Deliverables | Acceptance |
|---|---|---|---|
| **0 · Decisions** (1–2 days) | engine, target devices, 2D vs 3D, animation-driven vs sim-driven timing, input scheme (touch / pad), scope of F2P | a one-page decision record; the engine project skeleton; the sim running inside it (bind) | `npm test` equivalent green in-engine; golden replay re-simulates there |
| **1 · Stand-up slice** | two fighters in an octagon trading strikes | locomotion, strike grid, frames driving animation (or `animEvents`), hit-stop / camera, block / parry / slip, damage, health events, KO, rounds + clock, HUD (health, stamina, round clock), `pro` AI | a 3-round stand-up fight is playable at 60 fps on the target device; the acceptance lists of `04`, `05`, `06` and `11` pass in-engine |
| **2 · Grappling** | clinch, takedowns, ground | clinch positions + pair locomotion, shot phases + sprawl, `auto` resolver first, ground graph + GnP + get-ups, knockdown follow-up, TKO rules | takedown invariant `attempted == landed + denied + missed`; ground idle rule; no fighter ever stuck in a bout (invariant test) |
| **3 · Submissions** | the five-stage hold with the minigame of choice | submission session in `meter` / `snipe` / `gate` mode for humans, `auto` for AI, tap decision UI | human can win and lose duels; AI never presses; `attempts ≥ locked ≥ finishes + escapes` |
| **4 · Match flow & judging** | a whole card | match statechart, between-rounds corner (recovery, cutman, doctor), 3 judges + scorecards UI, decision announcement, stats screen, story captions | decisions classify correctly; scorecards can disagree; stats reconcile |
| **5 · Presentation** | it looks and sounds like a fight | animation set per move / position, camera rigs (`11` §4), crowd and audio from the event bus (`16`), haptics, replays with highlight selection, VFX (cuts, swelling, blood transfer) | every event type in `16` has a presentation mapping or an explicit "none" |
| **6 · Meta** | the reason to come back | modes (career, training belts, quick fight), progression (`15`), abilities if wanted, store / energy only if the product wants them | belts and rating spending persist; no meta system touches `src/combat` |
| **7 · Balance, polish, ship** | | telemetry, calibration in CI, difficulty tuning from real play, accessibility (one-handed, toggle-hold), performance / battery, optional lock-step netplay | finish-rate envelope enforced in CI; 60 fps on the lowest supported device |

**Order of risk:** the things most likely to hurt are (1) animation ↔ sim timing (decide in phase 0), (2) touch controls for grappling (prototype in phase 1 with the
mobile gestures of `14`), (3) content volume (moves × positions × animations), (4) balance — in that order.

## 4. First-day checklist for the next agent
```
cd mma-combat-plan/reference
npm test                 # 216 tests, ~8 s, must be green
npm run demo -- --seed 3 --a f_brawler --b f_striker    # play-by-play of a whole fight
npm run calibrate -- --fights 120                        # finish mix vs the design bands
npm run golden && git diff --stat ../data                # only if you changed the sim ON PURPOSE
```
Then read in this order: `README.md` → `02` → `17` → the doc of the system you are touching. Change numbers in `src/core/tunables.js` (never inline), add a test next to
the change, run `npm run build-data`, and let the consistency tests (`data.test.js`) tell you which doc or pack you forgot.

## 5. Backlog — everything the reference does not do (IDs are stable; reference them in commits)

| ID | Item | Why it matters | Doc |
|---|---|---|---|
| B-01 | Sweeps / takedowns out of a caught leg | the catch is currently a dead end (hold, punch, release) | `05` |
| B-02 | Evade stamina cost; AI reactions to feints | footwork is free today; feints only cost 0.8 stamina | `05` |
| B-03 | Opposite-stance angle bonus | stance matters only through lead/back limb mapping | `11` |
| B-04 | Fouls and point deductions (low blows, eye pokes, grabbing the fence) | not evidenced in the reference; a design choice | `12` |
| B-05 | Overtime / extra rounds | `num_ot_rounds` exists in the reference; no mode needs it yet | `12` |
| B-06 | Per-fighter move loadouts and signature moves | `MoveBook.select({allowed})` exists; no spec field; the strike grid's `sig`/`tech` slots are filled by shared moves | `04` `18` |
| B-07 | Animation-driven timing (`animEvents`) | the biggest integration decision; keep exactly one source of truth | `04` `18` |
| B-08 | Cage strikes and wall-assisted moves; wall vaults | observed (`FENCE_STRIKES`, `WallVault`), not modelled beyond pin / get-up bonus | `04` `11` |
| B-09 | Snapshot / restore of a whole `FightSim` | needed for rollback netcode and mid-fight save | `17` |
| B-10 | Style-imitation AI (`mma.style`) | the reference's `RealAI`; design in `18` §7 | `13` `18` |
| B-11 | Planner bias (`planner` aggression factor) | the hook exists and is always 0 | `13` |
| B-12 | Remaining 11 aggression-factor weights (body / leg health, opponent idle, round number …) | they exist at weight 0 | `13` |
| B-13 | Remaining 35 of 45 skills | vocabulary only; 10 are implemented | `03` |
| B-14 | Career / tournament flow, fight-card generation, move unlocks, weight-class ladders | meta layer | `15` |
| B-15 | Five-round (title) calibration: AI pacing, binding stamina, preset | see §2 "Known miss" | `19` |
| B-16 | Corner interaction between rounds (advice, cutman minigame) | the rest period is pure recovery today | `12` |
| B-17 | Camera rigs, replay camera selection, commentary / audio mapping | presentation, not in `reference/` | `11` `16` |
| B-18 | Device adapters (touch events, pad polling, haptics) for the chosen engine | `TouchRecognizer` / `GamepadMapper` take plain state | `14` |
| B-19 | Telemetry-driven balance: log intents + outcomes from real play, feed `calibrate` | the loop that actually fixes the numbers | `19` |
| B-20 | Replace our original numbers with the real ones if the OBB data becomes available | see `20` | `20` |

## 6. Risks and mitigations
| Risk | Mitigation |
|---|---|
| **The authored fight data is missing** (animations, per-event tunables, AI state machines, attribute DB live in the OBB — `20`) | everything numeric is data and tunable; the formulas that *were* recoverable are exact (`06` `10` `11`); the calibration CLI is the safety net; ask for the extracted config files |
| Animation and sim disagree about timing | choose one source of truth in phase 0; `frames` for sim-driven, `animEvents` for animation-driven; never both |
| Cross-platform float drift breaks replays / netplay | one numeric type, re-record the golden replay per platform, never hash floats from presentation code |
| Touch grappling is unplayable | prototype the mobile gestures in phase 1; `grapple` intents are already abstract (`legalActions` drives any UI) |
| Balance drifts as content grows | finish-rate envelope as a CI check; every new move must pass `validateMove` and the cancel-window rule |
| Scope creep from the F2P layer | `15` §3: none of it is needed for combat; it only touches the sim through the intent frame and the event bus |
| Legal / provenance | no decompiled code, assets, animations, audio or real athlete names are in this repository — only mechanics, identifiers as vocabulary, and original code and numbers (`README.md`, `02` §5) |
| Over-trusting the decode | read the soft-spots list (`02` §6); anything not tagged **[CODE]** is an interpretation |

## 7. Definition of done for "combat core v1"
1. All acceptance lists in docs `04–16` pass in the target engine (or in the bound sim) — `npm test` is the executable form.
2. Calibration pooled over ≥ 3 seeds × 300 fights is inside every band of §2 on the *final* content.
3. A golden replay recorded on the target platform re-simulates bit-identically on a second device.
4. Zero illegal AI intents over 1 000 fights; zero invariant violations over 1 000 fights.
5. 60 fps on the lowest supported device with the sim at < 1 ms/tick.
