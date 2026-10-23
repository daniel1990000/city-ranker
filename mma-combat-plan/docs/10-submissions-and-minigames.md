# 10 · Submissions and the three decoded minigames

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/submission.js` and
`minigames.js`. Tests: `reference/test/minigames.test.js`, `submission.test.js`.

## 1. Submission system as exposed by the reference

| Aspect | Evidence |
|---|---|
| **20 techniques, 31 position/role entries** | americana, anaconda, armbar, arm-triangle, D'Arce, gogoplata, guillotine, heel hook, inverted triangle, Japanese necktie, kimura, kneebar, omoplata, Peruvian necktie, rear-naked choke, rolling kneebar, triangle, triangle-armbar, twister, windshield choke (the `SUBMISSION_*` enum, plus `INVALID`) **[DATA]**. The role/position table `submission_type_submission_{dom,sub}_<pos>_<name>` has 29 entries (+ `none`, `sub_escape` as a pseudo-submission and a mobile-only `f2p_dom_fm_groundandpound` finisher); the fighter-move list `basetypes_fighter_move_subm_*` additionally has D'Arce from half guard and an armbar from rubber guard, so our table (`data/taxonomy.json → submissions`) is the union: **31** entries. An earlier draft of this document said "28 named submissions"; that number was a miscount |
| **Category** | `submission_category ∈ {choke, lock, none}` **[DATA]** |
| **Stages** | `not_in_submission, stage_1 … stage_5, submission_completed`; stat `SUBMISSION_STAGE_CURRENTLY_IN`; stage listeners (`Register/UnRegisterSubmissionStage/StatusListener`) **[DATA]** |
| **Dominance of the move** | each submission is keyed by *who applies it* (`dom`/`sub`) and *from which position*: `submission_type_{dom,sub}_<pos>_<name>` **[DATA]** (full table below) |
| **Gates** | `submission_gate ∈ {up, down, left, right}` and `_blocked` variants; AI "gate" factors **[DATA]** |
| **Tap decision** | `tap_or_not ∈ {tap, no_tap, none}` (`Submission_TapOrNot`) **[DATA]** |
| **Mash / other minigame styles** | `SubmissionMashSuccess`; `minigame_style ∈ {circular_golf_meter, mash_meter}`; `minigame_result ∈ {none, fail, success, perfect}`; UI-hosted: gameplay calls `set-minigame-handler`, the UI reports `minigame-golf-meter-score` / `minigame-mash-success` back through the card service **[DATA]** |
| **Damage** | `[Blue Corner] [Submission Damage: %.2f]` debug overlay; move `subm_minigamedamage` **[DATA]** |
| **AI** | `AiSubmissionAsset`, `AiSubmissionChooserAsset`, `AiSubmissionGateAsset`, `AiSubmissionStyleTuningAsset`; interest factors `fighter stamina`, `opponent stamina`, `submission stage`; gate factors `completion proximity`, `gate movement`, `stamina/time completion cost` (own & opponent) **[DATA]** |
| **Ratings** | `chokesubmission`, `jointsubmission`, `chokedefense`, `jointdefense` **[DATA]** |
| **Presentation** | camera mode `submission`, fight mode `submission`; commentary `SUBMISSION_{ATTEMPT,LOCKED,STAGE,DEEP,DEEPEST,INSTANT,LETS_GO,ESCAPE}`; crowd `SUBMISSION_STAGE1..5`, `DENIED`; story: one attempt, multiple attempts, almost finished, strong defence, saved by the bell **[DATA]** |
| **Stats** | `submission_attempts`, `submission_attempts_locked`, `submissions_escaped`, `in_submission_attempt` **[DATA]** |

### Position → submission table (as shipped; top = applies from dominant, bottom = from submissive)
| Position (code) | Top (dom) | Bottom (sub) |
|---|---|---|
| back mount (`bm`) | rear-naked choke, armbar | — |
| crucifix (`cr`) | armbar | — |
| full guard (`fg`) | heel hook | armbar, triangle, omoplata, guillotine |
| full mount (`fm`) | armbar, gogoplata, triangle-armbar, *ground-and-pound finisher (mobile)* | — |
| half guard (`hg`) | arm-triangle, kneebar (D'Arce exists as a move) | kimura, twister |
| north-south (`ns`) | windshield choke | — |
| side control (`sc`) | Americana, kimura, inverted triangle | D'Arce |
| stacked guard (`sg`) | heel hook, kneebar | — |
| sprawl (`sp`) | anaconda, Japanese necktie, Peruvian necktie | — |
| side saddle (`ss`) | arm-triangle | — |
| rubber guard (`rg`) | — | gogoplata, omoplata, armbar |
| back side-mount (`bs`) | — | rolling kneebar |

## 2. Console-style stage/gate model **[ARCH]**
Five numbered stages; at each stage a **gate** (a direction) must be "passed" by the attacker and can be **blocked** by the
defender; stage progress accumulates *submission damage*; at the end the defender chooses `tap` / `no_tap` (a human who
refuses is choked out or injured; AI decides by rating/damage). Escape = defender wins enough gate contests / mashes.
For non-gamepad games map "gate direction" to **swipe direction** (attacker swipes the prompted way, defender swipes to
block) — or drop gates and use the timing minigames below.

## 3. Three decoded minigames (all from the mobile build) **[CODE]**

Common vocabulary: **Dom** = initiator/attacker side; **Sub** = defender; `IsPlaying` = side is **human-controlled**
(an AI side does not press anything and is decided by rules below). Time unit = the caller's tick (`DeltaTicks`).

### 3.1 `SnakeMeter` — two-sided needle/zone timing meter (`0x11c5b00`)

Used for the timed duels (the mobile takedown meter and ground meter are the most likely callers **[ARCH]**).

**Parameters**: `StartDelay`, `MinigameDuration D`, `NumPasses N`, `MinigameDifficulty d∈[0,1]`, `ScoreSizeMin`, `ScoreSizeMax`,
(`PerfectZoneSize` *is ignored by the original*), `Random ρ∈[0,1)`, `DeltaTicks`, per-side `IsPlaying` and `EndTrigger`.

```
START (StartTrigger while idle):
  delay = StartDelay ; timer = 0 ; finalDom = finalSub = −1 (unlocked)
  zoneDom = Max + d·(Min − Max)            # difficulty shrinks the attacker's window …
  zoneSub = Max + (1−d)·(Min − Max)        # … and widens the defender's
  centre  = 0.5 + ρ · 0.5 · (1 − max(zoneDom, zoneSub))      # shared by both sides, always right of centre
  perfect = (max(zoneDom, zoneSub) + 1) / D · dt0            # ORIGINAL: one tick of needle travel (device-dependent!)
  needlePos = −zone/2 for each side

TICK (after delay<=0; while delay>0 : delay −= dt):
  timer  = clamp(timer + dt, 0, D)
  x      = timer / (D / N) ; n = floor(x) ; f = x − n ; t = (n odd) ? 1 − f : f       # ping-pong, N passes
  size   = (DomIsPlaying ∧ SubIsPlaying) ? max(zoneDom, zoneSub) : zoneOwn
  pos    = (size + 1)·t − size/2                                                       # sweeps from off-left to off-right
  for each side not yet locked:
      dist = |pos − centre|
      score = dist ≤ perfect ? 1.0 : dist ≥ zoneOwn ? 0 : 0.99·(1 − dist/zoneOwn)       # ORIGINAL perfect test only when pos ≤ centre
      outLive = score ; if EndTrigger(side): final(side) = score (locked)
FINISH when:  no playing side is unlocked   OR   timer ≥ D   OR   (DomIsPlaying ∧ finalDom == 0 exactly)
WINNER (DomWon):
  both play : finalDom > 0 ∧ finalDom > finalSub          # strict; ties go to Sub; a side that never locked has −1
  only Dom  : finalDom > 0
  only Sub  : finalSub ≤ 0                                 # vs an AI attacker the human defender wins by scoring > 0
```
Outputs: needle position/size, zone position/size and perfect-zone position/size for both sides, live scores, final
scores, `Finished`, `DomWon`, `IsRunning`.

**[REC] changes**: make the perfect test symmetric; take `perfectZoneSize` as a real parameter (default 0.06 of track)
so it is independent of frame rate; keep the 0.99 cap so "1.0" is reserved for perfect; use `d` from rating delta
(`d = clamp(0.5 + (defRating − atkRating)/200, 0.1, 0.9)`). Typical: `Min 0.12, Max 0.35, D 1.6 s, N 2, delay 0.4 s`.
`new SnakeMeter({..., faithful: true})` reproduces the two original quirks (asymmetric perfect test, frame-dependent perfect
size) for anyone who wants to compare against the reference; the default is the symmetric, frame-rate independent version.

### 3.2 `ButtonSnipe` — reaction minigame (`0x11c6c10`)
Inputs: `StartTrigger`, `SnipeTime`, `SnipeButton ∈ {0..3}`, per side `IsPlaying` and `Button1..4`, `DeltaTicks`.
```
START: running = true ; timer = 0 ; mask = 1 << SnipeButton
TICK : timer += dt ; remaining = SnipeTime − timer
  domMask = Σ Button_i<<i  (Dom)   subMask likewise
  if timer > SnipeTime:                finished ; DomWon = !DomIsPlaying       # the human who failed to react loses
  elif SubIsPlaying ∧ subMask == mask: finished ; DomWon = false              # Sub is evaluated first → ties go to Sub
  elif DomIsPlaying ∧ domMask == mask: finished ; DomWon = true
  elif DomIsPlaying ∧ domMask  > 0   : finished ; DomWon = false              # wrong button
  elif SubIsPlaying ∧ subMask  > 0   : finished ; DomWon = true               # wrong button
  running = !finished
```

### 3.3 `UTSubmissionMinigame` — "snipe chain" (`0x11c72d0`)
Two phases: a **count-up** that builds a counter, then a **countdown** that tears it down.
Inputs: `ResetTrigger`, `CountUpTrigger`, `CountUpSnipeTime`, `IsCountingDown`, `CountDownSnipeTime`,
`CountDownTimerDelay`, `…SpeedIncrease`, `…MinTicks`, `SnipeButton`, per-side `IsPlaying` + `Button1..4`, `DeltaTicks`,
`DomInitiates`, `StopTrigger`. State: `SnipeTimer, CountDownDelayTimer, mask, SnipeCount, CountdownTotalSnipeCount, CountUpTries`.
```
RESET (idle): running = true ; SnipeTimer = −1 ; mask = 0 ; SnipeCount = 0 ; totalCD = 0 ; delayTimer = CountDownTimerDelay ; tries = 0
count-up : on CountUpTrigger (and !IsCountingDown): SnipeTimer = CountUpSnipeTime ; mask = 1<<SnipeButton ; tries++
countdown: while SnipeTimer ≤ 0: delayTimer −= dt ; at ≤ 0: SnipeTimer = CountDownSnipeTime ; mask = 1<<SnipeButton ;
           delayTimer = max(CountDownTimerDelay − SpeedIncrease·totalCD, MinTicks)           # snipes arrive faster and faster
active snipe (SnipeTimer > 0):  SnipeTimer −= max(dt,0)
   initiator = DomInitiates ? Dom : Sub              # "OutDomWon" actually means *initiator succeeded*
   timeout          → result, success = !initiator.IsPlaying
   initiator exact  → success      initiator wrong press → fail
   other exact      → fail         other wrong press     → success        (the Sub-exact check precedes the Dom-exact check)
on result:  countdown: if !success SnipeCount −= 1 ;  count-up: if success SnipeCount += 1 ; totalCD += IsCountingDown ; SnipeTimer = 0
STOP when:  StopTrigger  OR  (tries == 3 ∧ SnipeCount == 0)  OR  (IsCountingDown ∧ SnipeCount == 0)
OUTPUTS: OutSnipeTime (remaining), OutSnipeButton (mask), OutSnipeResult, OutDomWon, OutSnipeCount, OutIsRunning
```
Reading **[ARCH]**: count-up = up to 3 tries for the attacker to "set the hold" (`SnipeCount` = lock depth ≤ 3; zero after
3 tries ⇒ the attempt fails); countdown = the defender's fight to escape: every failed snipe by the attacker removes one
depth point, hitting 0 = escape, with ever-shorter gaps between prompts (pressure). Maps nicely onto the 5 stage model.

## 4. Recommended unified design **[REC]** (as implemented in `reference/src/combat/submission.js`; `submission.*` tunables)
```
beginSubmission(attacker, defender, name, position, role)
   requires name ∈ table §1 for (position, role) and the attacker's 300-tick (5 s) submission cooldown elapsed
   gate roll p = clamp(0.25 + 0.004·(atk.sub − def.defence) − 0.1·(1 − atk.stamina%) + ability bonus, 0.10, 0.90)
        denied → SUBMISSION{result:'denied'} and the fighters stay in the ground bout
        locked → the ground bout is released (restore:false) and a SubmissionBout takes over (modes: submission)
SubmissionBout { name, category(choke|lock), attacker, defender, position, role, stage 0..5, depth = 2, damage, mode }
stage loop (stages 1..5): one micro-duel per stage, chosen by `submission.mode` (honoured only when a human is in the pair;
                          AI-vs-AI is always 'auto')
     'auto'   : after 75 ticks, p_stage = clamp(0.46 + 0.003·(atk − def) − 0.03·stage + 0.10·(atk.stamina% − def.stamina%), 0.10, 0.90)
     'meter'  : SnakeMeter(Dom=attacker, Sub=defender; difficulty from the ratings; 1.6 s, 2 passes, delay 0.4 s)
     'gate'   : ButtonSnipe, 36-tick prompt; the defender must press the prompted button (console / swipe style)
     'snipe'  : SnipeChain — 3 count-up tries (40-tick prompts) set the hold (0 successes ⇒ denied), then the countdown with
                34-tick prompts whose gaps shrink as max(60 − 6·n, 18) ticks (the fast mobile mode)
   attacker wins → stage++, damage += 0.2 (choke or lock) ; defender wins → depth−− ; depth < 0 (three lost duels) → ESCAPE
        escape: a TOP attacker loses the position (defender goes to the first plain bottom edge of the graph, `09`);
        a BOTTOM attacker (guard subs) keeps the position — the submission just failed
   stage 5 completed → tap decision (≥ 20 ticks): AI taps with p = clamp(0.92 − 0.004·(toughness − 50), 0.40, 0.98);
        a human defender sends `tap` / `no_tap` (auto-tap after 120 ticks)
        tap → SUBMISSION win ('tap') ; no tap → choke: the knockout health event (result 'ko', the referee records
        `<name>_choke_out`, still a submission win) · lock: 'injury' (the referee records a `<name>_injury` TKO)
referee/clock : the bell during stage ≥ 3 counts `subs.saved_by_bell` for the defender; the bout ends ('abort') back on the ground
stamina       : attacker 1.3/s, defender 1.7/s while in session; an AI attacker aborts below 8 % stamina (a human never)
stats         : attempted++ on 'start' ; locked++ when stage 2 is reached ; deep++ at stage 4 ; escaped++ (defender) on escape ;
                finished++ on tap / ko ; depth++ per stage won
```
AI chooser (inputs from the reference: own stamina, opponent stamina, current stage) and gate factors → see `13`.

## 5. Acceptance tests (`reference/test/minigames.test.js`, `reference/test/submission.test.js`, all passing)
1. `SnakeMeter`: deterministic for fixed `ρ`; difficulty 0.9 gives smaller Dom zone than 0.1; tie ⇒ Sub; locking exactly 0 ends the game at once; AI-attacker: human wins iff final > 0; the start delay holds the needle; faithful mode reproduces the quirks.
2. `ButtonSnipe`: the 6 branches of §3.2 incl. Sub-first tie-break and the timeout rule (a human who failed to react loses, an AI side is decided for the other side).
3. `UTSubmission` (`SnipeChain`): 3 failed count-up tries stop the session; countdown gaps follow `max(delay − inc·n, min)`; `initiator` flips the outcome mapping; the stop trigger halts.
4. `availableSubmissions` reproduces the position → submission table exactly; start and stage probabilities are bounded and monotone in the rating delta and fall with stage and fatigue.
5. Full success path: five stages, 0.2 damage each, tap decision, SUBMISSION win events; no-tap choke ⇒ knockout event, no-tap lock ⇒ injury result; AI tap probability falls with toughness.
6. Escape after three lost duels (top attacker loses position, bottom attacker keeps it); counters reconcile over many sessions (attempts ≥ locked, attempts ≥ finishes + escapes); better submission artists finish more and better defenders escape more.
7. Meter, gate and snipe modes behave as described for human attackers / defenders (perfect lock wins stages, never locking loses, correct prompt press blocks every stage, no reaction fails the three tries).
8. Stamina drains at the tunable per-second rates; an exhausted AI attacker releases the hold (abort, no escape recorded); the bell during stage ≥ 3 is "saved by the bell"; a fixed seed gives an identical session.
