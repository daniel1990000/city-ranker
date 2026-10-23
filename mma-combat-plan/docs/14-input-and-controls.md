# 14 · Input and controls

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/input/{buffer,recognizer,mapping}.js`.
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

## 2. Recommended abstraction **[REC]**

```
RawEvent  → InputBuffer (ring, 30 ticks) → Recognizers → Intent
Intent ::= Move{vec}  | Strike{limb,side?,target,power,mods}  | Guard{height}  | Parry | Catch
         | Clinch{type?} | Takedown{dir,size} | Grapple{action} | GroundMove{dir} | SubmissionPrompt{button|dir}
         | SwitchStance | Taunt | Card{slot}
Fighter controller consumes Intents; AI produces the same Intents; replays store Intents per tick.
```
* **Determinism**: sample input at 60 Hz, quantise to ticks, store `(tick, intent)` — the replay/netcode currency.
* **Buffering**: strikes pressed during recovery are buffered for ≤ 6 ticks and fire at the first cancel window; defensive
  inputs get 4 ticks of early-press forgiveness (parry windows depend on this, `05`).
* **Hysteresis/leash** (`11`) on the move vector and on stick-based gestures to remove jitter.

### 2.1 Gamepad / keyboard mapping (reference scheme)
| Input | Action |
|---|---|
| Left stick / WASD | Move (relative to facing; `LocoSpeedByAngle` table) |
| X / Y | Lead punch / back punch |
| A / B | Lead kick / back kick |
| Left trigger (hold) | **Body modifier** (strikes target body; with kick = leg kick if stick down) |
| Right trigger (hold) | Guard (high; stick down = low) · tap with timing = parry |
| Right bumper | Sig/tech modifier (hold: sig; double-tap: tech) |
| Left bumper | Clinch / takedown (context: close ⇒ clinch; stick toward opponent + hold ⇒ shot) |
| Right stick | Strike by flick (alternate scheme): up = head, down = body, left/right = hook/cross choice |
| Stick click / R3 | Switch stance |
| Ground: left stick | Transition direction; face buttons = ground strikes / submission start; triggers = posture / defence |
| Submission prompts | Face buttons (snipe), stick directions (gates), mash for escape |

### 2.2 Touch mapping (mobile scheme)
Screen split into masks: **left 40 %** = virtual stick (floating origin, leash filter radius 14 px), **right 60 %** =
action zone; fixed buttons: Guard (hold), Clinch/Takedown, card slots (≤ 4) at the bottom.

| Gesture in the action zone | Intent |
|---|---|
| Tap (≤ 180 ms, drift < 12 px) | **Light** jab/front-leg strike (limb alternates punch↔kick by zone: upper half = punch, lower half = kick) |
| Swipe up / down | Head / body target (strike type by swipe length: ≥ 90 px = **medium**) |
| Swipe left / right | Hook / cross (lead/back side) or roundhouse / teep by zone |
| Press & hold ≥ 250 ms then release | **Heavy** (charge 250–800 ms scales damage ×1.0–1.6 and startup +4 ticks); "loaded swipe" = hold then swipe |
| Two-finger tap | Takedown shot (with meter if in meter mode) |
| Guard button tap timed to impact | **Parry**; hold = block (height from last swipe direction or auto) |
| Double-tap | Switch stance or catch (context) |
| Ground: swipe direction | Transition / escape / strike; meter taps for timing duels |

Constants (starting values): `TAP_MS 180, TAP_SLOP_PX 12, SWIPE_MIN_PX 24, SWIPE_MIN_SPEED 400 px/s, HOLD_MS 250,
CHARGE_MAX_MS 800, DOUBLE_TAP_MS 260`. Scale distances by device DPI (`px = dp × density`).

### 2.3 Feedback
Haptics on landed heavy hit (short), on being hit (stronger), on parry (crisp); camera hit-stop; UI shows guard height and
parry window flash. Provide **accessibility**: one-handed mode (auto-guard), toggle-hold, larger masks, reduced shake.

## 3. Acceptance tests (`reference/test/input.test.js`)
1. Tap vs swipe vs hold classification at boundary values, with DPI scaling.
2. Buffer fires a buffered strike exactly at the cancel window; older than 6 ticks is dropped.
3. Intent logs replay to identical fight outcomes with the same seed (end-to-end determinism test).
4. Leash filter: virtual stick output within radius never exceeds it; idle returns zero.
5. Gamepad mapping covers every strike slot (`04`) at least once.
