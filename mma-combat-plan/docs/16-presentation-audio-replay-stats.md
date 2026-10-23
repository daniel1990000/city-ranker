# 16 · Events, stats, story, replays, crowd, audio, visual feedback

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/sim/{events,stats,story,replay}.js`.
Tests: `reference/test/events.test.js`, `stats.test.js`, `story.test.js`, `replay.test.js`.

The presentation layer in the reference is **driven entirely by gameplay events + statistics**. That is the most reusable
idea: emit a rich, typed event stream and everything else (HUD, camera, commentary, crowd, replays, haptics) subscribes.

## 1. Combat event vocabulary **[DATA]** (`Csis` triggers, 247)

`STRIKE, MISS, BLOCK, PARRY, SLIP, CATCH, CATCH_RELEASE, FEINT, COMBO, STUN, STUN_RECOVERY, KNOCKDOWN, INJURY,
CLINCH, CLINCH_MOVEMENT, TAKEDOWN, GETS_UP, GROUND_POSITION, GROUND_MOVEMENT, GROUND_PASS_DENIED, GROUND_REVERSAL, POSTURE,
SUBMISSION_{ATTEMPT,LOCKED,STAGE,DEEP,DEEPEST,INSTANT,LETS_GO,ESCAPE}, STANCE_SWITCH, TAUNT, PROCEDURAL_FALL,
START_ROUND, END_ROUND, END_FIGHT, FIGHT_CLOCK, OFFICIAL_DECISION, MOMENT_OF_VICTORY, TOUCH_GLOVES,
REPLAY{,_INTRO,_POINT_OF_IMPACT,_RECAP}, ROUND_ANALYSIS, *_ANALYSIS` plus referee, crowd, trainer and banter triggers.

**[REC] event schema** (all events carry `{tick, round, clock, actor, target?}`):
```
strike{limb,side,slot,target,type,contact,damageTier,blocked,counter,crit,combo}   miss{...}   block{height,strength}
parry{} slip{} catch{kind} catchRelease{} feint{} stun{event,region,duration} knockdown{region} injury{region,stage}
clinchStart{type,dom,sub,cage} clinchBreak{reason} takedownStart/Result{type,phase,result} groundPosition{from,to,reason}
pass{} reversal{} getUp{} submission{stage,type,category,result} stanceSwitch{} roundStart/End{} stoppage{type}
decision{cards,result}
```

## 2. Stats **[DATA]** → requirements
Per fighter, per round and per fight (see `04` §6, `12` §4): strikes thrown/landed/blocked/avoided split by **target**
(head/body/leg), **limb** (punch/kick/knee/elbow), **side** (left/right), **mode** (stand-up/clinch/ground), **type**
(jab-cross/hook/overhand/uppercut/…), **significant** flag, **damage by type**, counters, combos, KOs/stuns/staggers by
strike type, takedowns attempted/landed/denied, passes, sweeps, submissions attempted/locked/escaped, knockdowns, stuns,
control percentages (clinch/ground), cage stats (fence strikes thrown/landed, time with back to cage), idle/proximity time,
time-since-last-X and time-between-X timers (these feed commentary and AI).

## 3. Story system **[DATA]** (244 `story_type_*`) — narrative from stats
Three families:
* **Round stories** (blue/red variants): stat leaders and moments — high striking accuracy, kicks/leg kicks/knees landed
  high, counters (after blocks/slips/with kicks), defence good/bad, takedown accuracy/defense/big takedown/kept on ground,
  clinch control, GnP strikes/knees, cage strikes, **cuts** (cut → worse → critical per brow/cheek/lip/nose/forehead/above-eye),
  **swelling** (eye/both eyes/face/forehead, worse), stunned head/body (once/multiple), wobbled, knockdown (once/multiple/both),
  submission (one attempt/multiple/almost finished/strong defence), **saved by the bell** (knocked down / stunned / GnP / submission),
  low-action rounds.
* **Pre-decision stories**: unanimous vs close, each with an "edge" reason (kick accuracy, strikes landed, knockdowns, stuns,
  takedowns, submissions…).
* **Post-fight stories**: KO, submission, doctor stoppage (cut), TKO flavours — after knockdown / after stun by punch/kick/knee/
  elbow to head or body, ground-and-pound (after takedown, side-control knees, up-down), leg-kick injury, brutal leg kicks,
  deadly clinch, elbows, knees-and-punches.

**[REC] story selection**: after every round compute candidate stories, each with `score = significance × freshness`; pick
the top 1–2 (cooldown per story id ≥ 2 rounds). Significance comes from percentile thresholds on the stat ("high" = ≥ the
fighter's 85th-percentile benchmark or ≥ absolute minimum). Output = story id + params (fighter, count, region) → text/VO.

## 4. Replays **[DATA]**
* `replay_group_*` (80) classify clips by **what happened**: block (body/head/kick/knee), clinch strikes, combos
  (flurry, trade, against-cage, GnP flurry), counters (after block/slip/incoming/with kick), cuts, elbows, feint-and-attack,
  GnP (huge elbow/punch, diving punch, knees), kicks (body/head/leg/inside-leg), knees, knockdowns (already-stunned,
  counter to caught kick/incoming strike), misses, punches, huge strikes (against cage), stuns (counter, body/liver, kick,
  knee, punch), submission escape (offence/defence), takedowns (after feint/slip/strikes, slam, suplex, throw, trip, tackle,
  defended variants).
* The runtime records **a rolling window of sim state** (module config `replaySeconds: 100`; memory 20/30 MB) and has
  `REPLAY_POINT_OF_IMPACT` markers and highlight-reel playback after the fight.

**[REC]** Record `(tick, intents, rngSeed)` plus a keyframe every 2 s; a replay = re-simulate from a keyframe (deterministic
sim ⇒ tiny storage). Tag the buffer with event markers; choose replay group = most-significant event in the last 6 s,
camera by group (`11` §4), slow-mo factor 0.35 around `point_of_impact`.

## 5. Crowd **[DATA]**
Reactions: `angry, anticipation, applause, boo, cheer, idle, oh, strike, towel_wave`. Triggers include
strike-success low/med/high damage, big damage, fighter health critical, injury limp, clinch (generic/denied/flurry),
submission attempt/stages 1-5/denied/any-round, takedown, pre-fight gesture. A running **fight-quality** metric
(`crowd_fight_quality_{adds,sum}_tracking`) accumulates "adds" per exciting event and shapes crowd intensity.
**[REC]** `quality += weight(event)`; decays 2 %/s; `reaction = f(event, quality)`.

## 6. Audio taxonomy **[DATA]**
* **Strike types** (SFX bank keys): punches — jab, pawing jab, straight, hook, overhand, uppercut, backfist, hammerfist, superman,
  flashy; kicks — roundhouse, leg kick, side, switch, teep, axe, heel, ankle, foot stomp, upkick, flashy; knee; elbow.
  Movement tags: spinning, flying, diving, flying-off-cage. Contact surfaces/body parts (13) pick the thud.
* **Defence**: block, caught kick, caught punch, slip, step back. **Takedown**: attempt, grapple, ground contact, denied, missed,
  success. **Clinch**: successful, denied, missed, transition. **Submission**: attempt, locked, escape.
* Layers: announcer, commentary (play-by-play/colour with ANALYSIS lines), referee, trainers (corner), crowd, music (ring-walk),
  world SFX, mixer "wheel" per venue. Per-venue data modules (see `01`).

## 7. Visual feedback **[DATA/ARCH]**
Skin/cloth shaders, blood transfer between contacting regions (17 regions), sweat, face wrinkle deformation, cuts/swelling
layers, octagon mat decals, a `PowerRing` component + `enviro_power_ring` shader (ring-shaped environment effect; purpose not evidenced), camera flashes in crowd, spotlight/strobe light animation
curves (colour/intensity/transform), low-spec variants of nearly every shader. Time-scale controllers produce slow-mo and
freeze-frames (`FreezeFrameController`, `TimeScaleController`) on heavy hits.
**[REC]** hit-stop 2/4/6 ticks for light/medium/heavy; screen-shake amplitude by tier; slow-mo 0.3× for 40 ticks on knockdown.

## 8. Acceptance tests
1. Event bus: ordered delivery, unsubscribe safe during dispatch, wildcard subscription.
2. Stats: counts reconcile (`landed + blocked + avoided = thrown`; per-mode sums = totals).
3. Story: deterministic top-k for a crafted stats table; cooldown prevents repeats.
4. Replay: record → re-simulate from keyframe → identical final state hash.
