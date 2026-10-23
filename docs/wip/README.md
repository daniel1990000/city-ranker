# Unfinished work kept for later

Two pieces from the October 2026 overhaul were started but not finished, so they are not in the game. They are kept
here as patches against commit `923f7ed` (apply with `git apply --3way docs/wip/<name>.patch` and expect conflicts).

- `clinch.patch`: the clinch layer in the fight simulation (`src/game/fight/clinch.ts`: grab, holds, knees, elbows,
  dirty boxing, trips, breaks, the referee, a replay input bit, SIM_VERSION 3) with touch and keyboard input. Still
  to do: the AI's clinch game, HUD prompts, real clips (only placeholders), the anti-spam tests, the balance run and
  the lesson text. Planned for the 90-day update (`docs/MASTER-PLAN.md` section 14).
- `animation.patch`: a rewrite of the fighter clips, poses and the IK rig with a two-fighter lab
  (`lab.html?pair`, `labCheck()` measures bodies passing through each other). The ground poses were better, but the
  standing clips were half rewritten and broken (fighters crouching in the air, a block that kicks), so it was not
  merged. Worth finishing, or replacing with a motion-capture pack.
