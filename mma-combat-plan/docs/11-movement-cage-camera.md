# 11 · Movement, input filters, cage geometry, camera

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/core/math.js`,
`sim/cage.js`, `sim/locomotion.js`, `input/intent.js` (movement quantiser). Tests: `reference/test/core.test.js`
(math, filters, RNG, statechart), `reference/test/cage.test.js` (geometry, wall sense, locomotion), `reference/test/input.test.js`.

## 1. Locomotion

### 1.1 Direction-dependent speed table — decoded **[CODE]** (`LocoSpeedByAngle`, `0x11c32e0`)
Input: `angle` (radians, −π…π, 0 = straight ahead relative to facing) and eight speeds `D1…D8`. Output: speed, by **linear
interpolation between adjacent knots**:

| Knot angle | 0 | +π/4 | +π/2 | +3π/4 | ±π | −3π/4 | −π/2 | −π/4 |
|---|---|---|---|---|---|---|---|---|
| Value | D1 (forward) | D2 | D3 (side) | D4 | D5 (backward) | D6 | D7 (side) | D8 |

(`D5` is shared by +π and −π; the two lateral halves can differ — useful for stance asymmetry.)
**[REC] defaults** (× base speed): `D1 1.00, D2 0.92, D3 0.80, D4 0.66, D5 0.55, D6 0.66, D7 0.80, D8 0.92`, base
`2.0 m/s × (0.85 + 0.30·movement/100)`, × `0.65` when `limping`, × `0.5` while `wobbled`, × `0.9` when gassed
(`fighter.baseSpeed / movementRatingSpan / loco / limpMult / gassedSpeedMult`; the wobble factor comes from the health-event
effect table, `06`).

**Implemented rules** (`sim/locomotion.js`, `FightSim.#locomotion`):
* Facing always tracks the opponent at ≤ `turnRateDegPerTick` (9°/tick) — even while locked.
* **Locked** (no translation, but turning continues) during a strike's startup and active frames, a stance switch, a caught
  kick (`trapped`), and while helpless. During recovery movement runs at ×0.5.
* A move with `advance > 0` (lunging jab/cross, lunging knee, superman punch, flying knee) slides the fighter along their
  facing by `advance/startup` per startup tick, so the strike closes distance instead of the player doing it.
* Two standing discs are pushed apart equally (`separate`); every standing fighter (and a shooter in takedown phase I) is
  clamped inside the octagon.
* **Movement input is quantised to 16 directions × 3 magnitudes** (`MOVE_LEVELS = [0, .4, .75, 1]`, dead zone 0.12, level
  thresholds 0.57 / 0.88) for humans and AI alike (`quantizeMove`). That is what keeps replay logs small — a held stick
  produces the same frame for many ticks — and 22.5° / three speeds is plenty for footwork.

### 1.2 Locomotion controllers in the engine **[ARCH]**
`StreetLocomotionController` (free movement), `SyncPointBlendSpaceMoveGroupController` (blend-space locomotion with
sync points → foot-synchronised blends), `ClinchLocoController` (pair locomotion, `07`), `LocoLeanNode` (body lean),
`MovementDirection/Angle/Speed` assets, `MoveAngleSignal`, `LocoSuppressed` (disable locomotion during actions),
`DomLocoAllowed`/`SubLocoAllowed`. **Takeaway:** locomotion is *velocity + facing driven*, with an
"allowed/suppressed" gate per state, and *stance* (lead foot) selects mirrored animation sets
(`MirrorController`, `IsMirrored`).

### 1.3 Stance and footwork **[DATA]**
`FIGHTER_STANCE_CURRENT`, `STANCE_TRADITIONAL` (orthodox vs southpaw), `STANCE_SWITCH_COUNT`, action `switch_stance`,
`switch_stance_tendency`, commentary trigger `STANCE_SWITCH`, flag `IS_CIRCLING`. Lead/back limbs flip with stance.
**[REC]** switch = 14-tick action costing 1 stamina (movement and strikes locked, `STANCE_SWITCH` event). Lead/back limbs flip
with the stance (`Fighter.limbSide`). *Not implemented, suggested:* an opposite-stance angle bonus (lead-hand strikes
+3 % hit wedge against an opposite-stance opponent).

## 2. Input-feel filters (decoded) **[CODE]**

| Filter | Original behaviour | Use |
|---|---|---|
| **`DeadZoneFilter`** (`0x11c4b40`) – "leash" | state `last`. `Reset ⇒ out = last = in`. Else `d = |in − last|`; `d ≤ radius ⇒ out = last`; `d > radius ⇒ last += (in − last)/d · (d − radius)` (the point is dragged so it trails the input at exactly `radius`); `radius ≤ 0 ⇒ snap`. | Joystick/aim smoothing, camera look-at, touch-drag jitter removal |
| **`ApproachFilter`** (`0x11c5790`) | `diff = target − in`, `v = maxSpeed/60`; if `v>0 ∧ dist>snap ∧ dt>0`: `step = diff·v·dt·(dist<decel ? (dist/decel)² : 1)` else `step = diff` (snap). `dt ≤ 0 ⇒ out = in`; overshoot ⇒ `out = target`. Also outputs `step/dt` as approach speed. | Camera distance, facing alignment, UI meters |
| **`GreaterThanWithHysteresis(a, b1, b2, prev)`** | `a > (prev ? b2 : b1)` | Guard on/off thresholds, stick-to-action thresholds (Schmitt trigger) |
| **`RangeToRatio(a, x, y)`** | `clamp((a−x)/(y−x), 0, 1)`, `0` if `|y−x| ≤ ε` | Every tuning curve / stamina % mapping |
| `Counter`, `Counter_UpDown`, `Counter_Oscillating` | integer/float counters with reset/start/end | timers, combo counters |

## 3. Octagon and wall awareness

**Real-world geometry [REC]**: regular octagon, **30 ft (9.14 m) across flats**: apothem `a = 4.57 m`, circumradius
`R = a / cos(π/8) ≈ 4.946 m`, side `s = 2a·tan(π/8) ≈ 3.79 m`. Wall outward normals at `22.5° + k·45°`.
```
inside(p)      = ∀k: p·u_k ≤ a − r             (r = fighter radius ≈ 0.28 m)
wallGap(p,k)   = a − p·u_k                      distance to wall k
nearestWall(p) = argmin_k wallGap
pinned(p)      = wallGap < r + 0.12
```
**Relative wall sensing [ARCH]** (`UFCOctagonProximitySceneOp`, fields `NormalFront/Back/Left/Right/FrontLeft/FrontRight/
BackLeft/BackRight` and matching `AngleNormal*`): for the nearest wall, the engine exposes its normal expressed in the
fighter's frame and bins it into 8 sectors. Use it to choose animations/moves and to set the flags
`back_against_cage`, `facing_cage`, `back_exposed`, `fence_dominance`:
```
rel = wrapPi(angle(directionToWall = outward normal) − fighter.facing) ; sector = SECTORS[round(rel / 45°) mod 8]
SECTORS = front, front_left, left, back_left, back, back_right, right, front_right
backAgainstCage = pinned ∧ sector ∈ {back, back_left, back_right}      facingCage = pinned ∧ sector ∈ {front, front_left, front_right}
```
(`Octagon.sense(pos, facing, radius, pinMargin = 0.12)` also returns the gap, the wall index and `pinned`.)
Wall-related engine assets: `PrimaryWall{Contact,Normal,Position}`, `SecondaryWall*`, `HasWallContact`, `WallDistance`,
`WallNormal`, `WallAlignmentController` (snap the pair to the fence), `WallVault{Query,Processor}` (cage run-ups: moves
"off the cage" `flying_off_cage`) **[DATA/ARCH]**. Gameplay effects: cage strikes (`04`), sprawl-against-cage denial
(`08`), clinch pin (`07`), wall-walk get-up (`09`). Retreat is simply impossible into the wall (the clamp), with no extra
speed penalty.

## 4. Camera **[ARCH]**
* **Modes** (`cameramode_*`): `standup`, `ground`, `submission`; fight modes also split `clinch`.
* Rig building blocks: `CameraController`, `CameramanTrackingController`, `CameraRigFeature`, interest/lens/clip/blur
  layouts, `CameraInterestLayout`, DOF masks, level-of-detail features. Expressions: **`FramePoints`** (frame a set of
  points), **`AvoidCylinder`** (keep the camera out of a cylinder — the fence), **`RevolveOctagon`/`RevolveOctagon2`**
  (orbit the octagon), `InterpolateArc`, `ZoomToPoint`, `OffsetFromOrientation`, `MinRayCast` (collision-avoiding pull-in).
* Named shots: wide octagon, handheld ×2, 4 corner cams, follow, referee-ack, announcer intro, tale of the tape, ring-walk
  fly-bys; crowd and "jita" cams. Replays use camera groups and the `replay_group_*` tags (80 groups).

**[REC] fight camera** (works in 2D or 3D):
1. Target = midpoint of fighters (ground: the pair's centre, lowered); distance chosen so both fit with margin
   `m = 1.2 m`; clamp to `[dMin, dMax]`.
2. Yaw: keep the camera on the side that shows both fighters in profile; revolve slowly around the octagon on
   `RevolveOctagon`-style easing when the fight drifts; never cross a wall (`AvoidCylinder` radius = `R + 0.5`).
3. Smooth with the `ApproachFilter` (decel distance 1.5 m, snap 0.02 m) and the leash filter on the look-at point.
4. Modes: `standup` wide; `clinch` tighter + low angle; `ground` high and closer with slight dutch for dominance; `submission`
   close-up with stage-based zoom; hit-stop shake on heavy hits; slow-mo on knockdown/KO (`replay` tiers).
5. Cheap fallback for low-end devices: fixed side-on orthographic camera with the same smoothing.

## 5. Acceptance tests (`reference/test/core.test.js`, `cage.test.js`, `input.test.js`, all passing)
1. `locoSpeedByAngle(0)=D1`, `(±π)=D5`, linear at midpoints, continuous across ±π.
2. Leash filter: output never farther than `radius` from input; idempotent when stationary; reset snaps; `radius ≤ 0` snaps.
3. Octagon: 30 ft across flats gives the regular-octagon apothem / circumradius / side; `inside` true at centre, false 1 cm past a
   wall; `nearestWall` normals match the 8 directions; sector binning follows the facing and is stable under rotation.
4. Hysteresis: no flicker for input oscillating within `(b2,b1)`; `rangeToRatio`, `pingPong`, `approachFilter` behave as decoded.
5. Locomotion: forward is faster than sideways is faster than backward; limping and a gassed fighter slow you; locked
   fighters turn but do not move; separation is symmetric.
6. Movement quantiser: dead zone, three magnitudes, 16 directions, idempotent.
