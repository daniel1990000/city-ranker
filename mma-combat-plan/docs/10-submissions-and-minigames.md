# 10 · Submissions and the three decoded minigames

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/combat/submission.js` and
`minigames.js`. Tests: `reference/test/minigames.test.js`, `submission.test.js`.

## 1. Submission system as exposed by the reference

| Aspect | Evidence |
|---|---|
| **28 named submissions** | americana, anaconda, armbar, arm-triangle, D'Arce, gogoplata, guillotine, heel hook, inverted triangle, Japanese necktie, kimura, kneebar, omoplata, Peruvian necktie, rear-naked choke, rolling kneebar, triangle, triangle-armbar, twister, windshield choke (+ `none`, `minigamedamage`, mobile-only `ground_and_pound` finisher, and `escape` as a pseudo-submission) **[DATA]** |
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

## 4. Recommended unified design **[REC]**
```
SubmissionSession { type, category(choke|lock), attacker, defender, position, stage 0..5, depth, damage, mode }
start(attacker, submission)   requires position ∈ table §1 AND attacker rating gate: roll p = clamp(0.35 + 0.004·(atk.sub − def.defence) − 0.1·stageFatigue, 0.1, 0.9)
stage loop (per stage 1..5): run one micro-duel chosen by `mode`
     'auto'   : rating roll p_stage = clamp(0.5 + 0.004·(atk − def) − 0.04·stage , 0.1, 0.9)
     'meter'  : SnakeMeter(Dom=attacker, Sub=defender; d from ratings)
     'snipe'  : ButtonSnipe / UTSubmission (fast mobile mode)
     'gate'   : swipe/stick gate contest (console style)
   attacker wins → stage++ , damage += stageDamage(category) ; defender wins → depth−− ; depth<0 → ESCAPE (position → defender's best)
at stage 5 completed: human defender chooses tap / no_tap ; AI taps if damage ≥ toughness-threshold
   tap → SUBMISSION win ; no_tap → choke: KO (unconscious) · lock: injury (limb pool=0 → TKO "doctor/injury")
referee/clock : stalling and round end: `saved_by_bell` story event if the bell rings during stage ≥ 3
stamina       : attacker 2.0/s, defender 2.5/s while in session; AI aborts if stamina < 15 %
stats         : attempts++ on start ; locked++ when stage ≥ 2 ; escaped++ on escape
```
AI chooser (inputs from the reference: own stamina, opponent stamina, current stage) and gate factors → see `13`.

## 5. Acceptance tests
1. `SnakeMeter`: deterministic for fixed `ρ`; difficulty 0.9 gives smaller Dom zone than 0.1; tie ⇒ Sub; locking exactly 0 ends the game at once; AI-attacker: human wins iff final > 0.
2. `ButtonSnipe`: the 6 branches of §3.2 incl. Sub-first tie-break and timeout rule.
3. `UTSubmission`: 3 failed count-up tries stop the session; countdown gaps follow `max(delay − inc·n, min)`; `initiator` flip.
4. Session: attempts ≥ locked ≥ finishes+escapes; choke no-tap ⇒ KO event; lock no-tap ⇒ injury.
