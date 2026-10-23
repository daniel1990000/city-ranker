# 14 · Input and controls

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/input/{intent,buffer,recognizer,mapping}.js`.
Tests: `reference/test/input.test.js`.

## 1. What the reference does

### 1.1 Pipeline **[ARCH]** (class names)
```
Device (touch / gamepad / keyboard / mouse / accelerometer / legacy Wii)         InputDevice*, GamepadSceneOp, KeyboardDevice, MouseDevice, Accel*
  → raw state (Vector2InputState, GamepadButtonsState, TouchState …) + FilterInput
  → Signal drivers (…SignalDriver, Pulse/Decay/Threshold/Terminating signals)
  → Matchers:  GestureAsset ▸ GestureStep ▸ GestureExpression ▸ GestureLogicMatch ▸ GestureToSignalMapping
               AnalogStickGestureMatch · GamepadButtonsMatch · KeyboardMatch · MouseGestureMatch · MouseButtonsMatch
  → Signals / GameState values (SkillSignal, InteractionSignal, MoveAngleSignal, PhaseSignal …)
  → Controllers (strike, block, locomotion, grapple) and the AI slot interface (AIRequestedActionSlot)
Recording/sync:  SavedInputAsset (recorded input), SyncInputSceneOp, InputStateSerializer → replays, tutorials, netcode
```
Takeaways: (a) **gestures are declarative** (steps + expressions), not hard-coded; (b) a player action and an AI action
are the *same* kind of object; (c) inputs are serialisable ⇒ **replays and lock-step netplay** work from input logs.

### 1.2 Java → native bridge **[CODE-level, Java]**
Touch: raw `Down/Move/Up/Cancel` with pointer id and float x,y. Gamepad: 2 sticks (axes X/Y and Z/RZ), triggers as analog
keys (L2 104 / R2 105), regular buttons as key events with pressure. Vibration/haptics available. So *all* recognition
is native, per-frame.

### 1.3 Touch concepts visible in strings **[DATA]**
`TouchTag`, `AddAxisAlignedRectangleTouchMask`/`RemoveTouchMask` (regions of the screen assigned to controls),
`TouchPlane{Normal,Pitch,Yaw}`, `PlayerDistAtTouch`, `PlayerDistAngleAtTouch`, `PlayerFaceAngleAtTouch`
(touch position expressed relative to the fighter), `MultitouchInputMode`, gesture types for UI:
`PAN, PRESS_AND_TAP, ROTATE, SWIPE, TWO_FINGER_TAP, ZOOM`. In-game, the generic `NaturalInput` module has a **0 MB** budget (3 MB in the front-end), so it appears to be a
front-end/UI recogniser **[ARCH]**; gameplay input goes through `GameInput` + Ant gestures.

### 1.4 Control vocabulary
* **Console-style (move names)**: 4 strike buttons = lead/back × punch/kick; modifiers: **body**, **fwd/bwd** (with
  movement), **sig**, **tech**; separate clinch/takedown/guard/sprint/stance inputs; two analog triggers (likely modifiers/guard).
* **Mobile tutorial steps [DATA]** (`FTUE_*`, `NEW_FTUE_*`): *tap*, *swipe*, *loaded swipe*, **light/medium/heavy punch**,
  **light/medium/heavy kick**, **punch-to-body**, **kick-to-body**, **block**, **parry**, **takedown** (+ takedown meter),
  *action pool / charge actions / actions (cards)*, **ground core moves**, ground action, **ground meter**, ground striking,
  **submit**. "Core" kicks: body roundhouse/side/teep, head front/roundhouse, leg roundhouse (`f2p_corekicks_*`).
* Training: heavy-bag mode with **targeting** (`HeavyBagTargettingEnabled`, `HeavyBagPosition`), combo/timed training sub-steps.

## 2. Recommended abstraction **[REC]** (implemented in `reference/src/input/`)

```
RawEvent  → InputBuffer (30-tick ring) → Recognizers → Intent frame
Intent frame ::= { move:{x,y} (world space, |v| ≤ 1), guard:none|high|low, strike:{limb,side,slot,target,power?,chargeTicks?}|null,
                   parry, slip, catch, feint, switchStance, clinch:{type?}|null, takedown:{dir,size}|null,
                   grapple:{kind,…}|null, prompt:{buttons?,end?,mash?,tap?,noTap?}|null, ability:{slot,result?}|null }
Fighter controller = anything that returns a frame each tick: human devices, AI brains, ScriptedBrain, replay feeder.
```
The frame is **plain data** (`emptyIntent()`, `compactIntent()` / `expandIntent()` for storage) and it is the *only* thing that
crosses from a controller into the sim, so there is exactly one code path for a human, a bot and a replay.
* **Determinism**: sample input at 60 Hz, one frame per fighter per tick, and **quantise the analogue part before the sim sees
  it** — `quantizeMove` snaps the move vector to 16 directions × 3 magnitudes (+ zero; dead zone 0.12) for humans and AI alike.
  The replay log is then `(tick, fighter, frame)` run-length encoded: a held stick produces the same frame for many ticks.
* **Buffering** (`InputBuffer`): strikes pressed during startup/recovery are remembered for ≤ **6 ticks** and fire at the first
  cancel window that allows them (never earlier: see the cancel-window lesson in `04`); parry / slip / catch presses get **4 ticks**
  of early-press forgiveness (`STRIKE_BUFFER_TICKS`, `DEFENSE_BUFFER_TICKS`). Repeated presses of one kind collapse into one.
* **Hysteresis/leash** (`11`) on the move vector and on stick-based gestures to remove jitter.

### 2.1 Gamepad / keyboard mapping (reference scheme — `GamepadMapper`)
| Input | Action |
|---|---|
| Left stick / WASD | Move **relative to the opponent** (stick up = toward them, left/right = strafe/circle); then the `LocoSpeedByAngle` table applies |
| X / Y | Lead punch / back punch |
| A / B | Lead kick / back kick |
| Left trigger (hold > 0.35) | **Body modifier** (strikes target the body). A kick with the stick pulled down and no modifier = **leg kick** |
| Stick forward / back + strike | picks the `fwd` / `bwd` slot variants (lunging / step-back) |
| Right trigger | Guard while held (on at 0.35, off at 0.25 — hysteresis; stick down = low guard) · a quick tap (≤ 11 ticks ≈ 180 ms) = **parry** |
| Right bumper | Sig/tech modifier: hold = `sig`; double-tap (≤ 16 ticks) = `tech`; double-tap and hold = `tech_sig` |
| Left bumper | Tap (< 8 ticks) = clinch; hold ≥ 8 ticks with the stick forward and the opponent out of clinch range = takedown shot |
| R3 / Tab | Switch stance |
| In a clinch or on the ground | Face buttons pick from what the bout says is legal (`bout.legalActions`): X = strikes (the left stick's horizontal position chooses which), Y = elbow/hammer, A = transition/pummel, B = submission/takedown, LB = get up/break; RT = guard |
| Submission prompts | Face buttons (snipe), stick directions (gates), mash for escape — all through `intent.prompt` |

Keyboard layout (`keyboardToPadState`): WASD move, J/K = X/Y, U/I = A/B, Shift = LT, Space = RT, E = LB, Q = RB, Tab = R3 —
it produces the same state object, so the mapper has one code path.

### 2.2 Touch mapping (mobile scheme — `TouchRecognizer`)
Screen split into masks: **left 40 %** = floating virtual stick (origin where the thumb lands, radius 60 dp, leash filter 14 dp),
**right 60 %** = action zone; a fixed Guard button (hold = block, release within 180 ms = parry) and card slots (≤ 4) at the bottom.
All distances are in dp (`px = dp × density`), all times in ms.

| Gesture in the action zone | Intent |
|---|---|
| Tap (≤ 180 ms, drift ≤ 12 dp) | **Light** strike with the lead limb; the zone picks the limb: upper half = punch to the head, lower half = kick to the body. A press of 180–250 ms is still a tap but flagged `late` |
| Swipe up / down | Head / body target for punches, head / leg for kicks (≥ 24 dp and ≥ 400 px/s; direction = dominant axis; length ≥ 90 dp = **medium** power) |
| Swipe left / right | Lead (left; the `tech` hook slot for punches) / back (right) side |
| Press & hold ≥ 250 ms, release | **Heavy** back-side strike (punch from the `tech` slot, or kick). Charge ramps over 250–800 ms into `chargeTicks` (hold: ×48, swipe: ×30); the sim ignores charge below `strike.minChargeTicks` (15) and reaches the full ×1.6 damage / +4 startup at `maxChargeTicks` (48) |
| "Loaded swipe" (hold, then swipe) | Heavy strike in the swiped direction, keeps the charge |
| Two-finger tap (second finger within 120 ms, both short) | Takedown shot (the meter starts if `takedown.resolver = 'meter'`) |
| Double-tap (≤ 260 ms) | Switch stance — or **catch** when the context says a catch is possible (`ctx.catchReady`) |
| Guard button tap timed to impact | **Parry**; hold = block |
| Ground: swipe direction | Transition / escape / strike; meter taps for timing duels (`intent.prompt.end`) |

Constants (`TOUCH`): `TAP_MS 180, TAP_SLOP_DP 12, SWIPE_MIN_DP 24, SWIPE_MIN_SPEED 400, SWIPE_MEDIUM_DP 90, HOLD_MS 250,
CHARGE_MAX_MS 800, DOUBLE_TAP_MS 260, TWO_FINGER_MS 120, STICK_ZONE 0.4, STICK_RADIUS_DP 60, LEASH_DP 14`.

### 2.3 Feedback
Haptics on landed heavy hit (short), on being hit (stronger), on parry (crisp); camera hit-stop (presentation only, `04`); UI shows
guard height and parry window flash. Provide **accessibility**: one-handed mode (auto-guard), toggle-hold, larger masks, reduced shake.

## 3. Acceptance tests (`reference/test/input.test.js`, all passing)
1. Tap vs swipe vs hold classification at boundary values, with DPI scaling; swipe direction by dominant axis, min length and speed, medium at 90 dp; hold threshold 250 ms with charge ramping to 1 at 800 ms and clamping; a loaded swipe keeps its charge.
2. Double-tap, two-finger tap and the parry button; gestures map to intents (zone picks punch/kick, swipe picks target / side / power).
3. Virtual stick: floating origin, magnitude ≤ 1, jitter inside the leash ignored, release returns zero.
4. Intent frames: compact ↔ expand round trip, quantisation, idle detection; the movement quantiser has 16 directions × 3 speeds, a dead zone, is idempotent and a held stick yields one repeated frame.
5. Buffer: a strike pressed during recovery fires exactly when the cancel window opens; stale presses are dropped.
6. Gamepad: every strike slot is reachable; targets follow LT / stick-down; fwd/bwd follow the stick; movement is relative to the opponent; guard has hysteresis and height; a quick RT tap = parry; LB tap = clinch / hold = shot.
7. In a clinch or on the ground the face buttons pick from the legal actions; the keyboard layout produces the same state shape.
8. Intent logs replay to identical fight outcomes with the same seed (end-to-end, in `replay.test.js`).
