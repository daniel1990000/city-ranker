# 16 · Events, stats, story, replays, crowd, audio, visual feedback

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/sim/{events,stats,story,replay,replayer}.js`.
Tests: `reference/test/events.test.js` (event bus **and** stats tracker), `story.test.js`, `replay.test.js`.

The presentation layer in the reference is **driven entirely by gameplay events + statistics**. That is the most reusable
idea: emit a rich, typed event stream and everything else (HUD, camera, commentary, crowd, replays, haptics) subscribes.

## 1. Combat event vocabulary **[DATA]** (`Csis` triggers, 247)

`STRIKE, MISS, BLOCK, PARRY, SLIP, CATCH, CATCH_RELEASE, FEINT, COMBO, STUN, STUN_RECOVERY, KNOCKDOWN, INJURY,
CLINCH, CLINCH_MOVEMENT, TAKEDOWN, GETS_UP, GROUND_POSITION, GROUND_MOVEMENT, GROUND_PASS_DENIED, GROUND_REVERSAL, POSTURE,
SUBMISSION_{ATTEMPT,LOCKED,STAGE,DEEP,DEEPEST,INSTANT,LETS_GO,ESCAPE}, STANCE_SWITCH, TAUNT, PROCEDURAL_FALL,
START_ROUND, END_ROUND, END_FIGHT, FIGHT_CLOCK, OFFICIAL_DECISION, MOMENT_OF_VICTORY, TOUCH_GLOVES,
REPLAY{,_INTRO,_POINT_OF_IMPACT,_RECAP}, ROUND_ANALYSIS, *_ANALYSIS` plus referee, crowd, trainer and banter triggers.

**[REC] event schema** (implemented: `sim/events.js`; every event is `{...payload, type, tick, round}` and **the envelope keys can
never be shadowed by a payload field** — an early bug let a takedown payload's `type:'hip_throw'` overwrite the envelope, so
payload fields are named `move`, `name`, `kind` instead):
```
strike{attacker,defender,moveId,limb,kind,side,target,mode,outcome(hit|blocked|parried|slipped|caught|whiff),taken,blocked,tier,crit,counter,counterHit,significant,contact,region,strong}
feint{fighter} combo{fighter,count} catch{fighter,from} catch_release{fighter,reason} health_event{fighter,event,region,source}
stun_recovery{fighter} knockdown{fighter,by,region} injury{fighter,region,stage} stance_switch{fighter}
clinch_attempt{attacker,defender,outcome} clinch_start{dom,sub,position,cage} clinch_transition{actor,from,to,style} clinch_break{dom,sub,reason}
takedown{attacker,defender,phase(start|result),move,size,direction,origin,result,denial,position}
ground_position{top,bottom,from,to,reason} pass{actor,success,against,from,to} sweep{actor,from,to} get_up{actor,success}
submission{attacker,defender,name,category,stage,result(start|denied|stage|defend|escape|abort|tap|ko|injury)}
referee{kind(low_action|break|stand_up),mode} round_start{} round_end{} stoppage{kind,how,winner,loser} decision{result,winner,cards}
ability{fighter,ability,result}
```
The bus is synchronous and ordered: typed handlers run before wildcard handlers, listeners added or removed while dispatching take
effect from the next emit, and `record:true` keeps the full log (what the tests, the stats tracker, the referee and the story engine
read). Presentation code (HUD, camera, audio, commentary, haptics) should subscribe here and **never poke at the sim state**.

## 2. Stats **[DATA]** → requirements
Implemented by `sim/stats.js: StatsTracker` — a subscriber of the event bus holding dotted counters per fighter, per fight **and** per
round (`stats.get(id, 'strikes.sig.landed.head', round)`), plus marks and `ticksSince` timers; `strikesReceivedThisRound` feeds the
health-event formula (`06`). Time is booked by the sim, one bucket per fighter-tick (`time.standup / clinch.dom / clinch.sub /
ground.top / ground.dominant / ground.bottom / takedown / submission.attacker / submission.defender / down`), so the buckets always add up.
Requirements, per fighter, per round and per fight (see `04` §6, `12` §4): strikes thrown/landed/blocked/avoided split by **target**
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

**[REC] story selection** (implemented: `sim/story.js: StoryEngine`, 20 original round stories plus pre-decision and post-fight ones):
after every round compute candidate stories, each with `score = significance × weight`; tell the top 2 (`perRound`), and a story
id cannot repeat inside its cooldown (2 rounds). Significance comes from simple thresholds on the stat (e.g. accuracy ≥ 55 % of ≥ 10
strikes, ≥ 5 kicks landed, ≥ 3 counters, a knockdown weighs 2.5, "saved by the bell" 2.2). Output = story id + params (fighter,
count, region) + a debug text; a real game maps `id + params` to VO or captions. The ids are ours; the reference has 244 variants.

## 4. Replays **[DATA]**
* `replay_group_*` (80) classify clips by **what happened**: block (body/head/kick/knee), clinch strikes, combos
  (flurry, trade, against-cage, GnP flurry), counters (after block/slip/incoming/with kick), cuts, elbows, feint-and-attack,
  GnP (huge elbow/punch, diving punch, knees), kicks (body/head/leg/inside-leg), knees, knockdowns (already-stunned,
  counter to caught kick/incoming strike), misses, punches, huge strikes (against cage), stuns (counter, body/liver, kick,
  knee, punch), submission escape (offence/defence), takedowns (after feint/slip/strikes, slam, suplex, throw, trip, tackle,
  defended variants).
* The runtime records **a rolling window of sim state** (module config `replaySeconds: 100`; memory 20/30 MB) and has
  `REPLAY_POINT_OF_IMPACT` markers and highlight-reel playback after the fight.

**[REC]** (implemented: `sim/replay.js`, `sim/replayer.js`) A recorded fight is **`{seed, tunables, fighters, rounds, clock settings, run-length
intent log, hash checkpoints every 30 ticks, result}`** — nothing else. Viewing = re-simulating from tick 0 with the recorded intents
fed back through the same `FightSim.step(external)` path the humans use (`playReplay(data, {upTo})`; `upTo` gives "scrub to any tick").
This works because a 3-round fight simulates in well under a second (≈ 0.012 ms per tick, ≈ 1 400× real time on a laptop-class
CPU), so no keyframes are needed. The checkpoints make the replay *self-verifying*: `playReplay` reports the first tick whose state
hash differs, which is how the golden replay (`data/replays/golden-1.json`) guards against accidental behaviour changes.
Size: ≈ 21 bytes per tick as JSON (≈ 1.7 gzipped) — a full 3 × 5 min fight is ≈ 1.1 MB raw / 90 KB gzipped; the movement quantiser
(`04`/`14`) is what keeps it that small. Two traps worth remembering: (1) AI-private RNG streams (`ai.*`) must stay out of the state hash,
because a replay never runs the brains; (2) the log stores *intents*, not outcomes, so a replay is only valid for the same code and
tunables — store the code version with it.
For presentation: tag the event log with markers, choose the replay group = most-significant event in the last 6 s (`replay_group_*`),
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
**[REC]** hit-stop 2/4/6 ticks for light/medium/heavy (`strike.hitStopTicks` — **presentation only**, the sim never pauses); screen-shake
amplitude by tier; slow-mo 0.3× for 40 ticks on knockdown.

## 8. Acceptance tests (`reference/test/events.test.js`, `story.test.js`, `replay.test.js`, all passing)
1. Event bus: ordered delivery, typed handlers before wildcard, envelope keys cannot be shadowed, unsubscribe safe during dispatch, listeners added during dispatch start with the next emit; event names unique and covering the documented vocabulary.
2. Stats: counters per fight and per round, marks, `ticksSince`, snapshot; counts reconcile over whole fights (`landed + blocked + avoided = thrown`; per-mode splits and per-round sums equal the totals; time buckets add up).
3. Story: unique ids with a weight and renderer; deterministic top-k for a crafted stats table (the knockdown outranks the rest); cooldown prevents repeats; the quiet-round story is told once; at most two stories per real round.
4. Replay: record → re-simulate → identical hashes at every checkpoint, same result and length; scrubbing to tick N lands on the original state at N; tampering with the log is detected at (or soon after) the changed tick; the log is run-length compact; the feeder holds a frame until the next change; external (human / netplay) intents are recorded and replayed like AI intents; a long multi-round fight replays in well under a second per simulated minute.
