# Unfinished work kept for later

Work from the October 2026 overhaul that was started but not finished, so it is not in the game yet (the
animation rewrite that was here is finished and in the game since 0.4.1). They are kept
here as patches against commit `923f7ed` (apply with `git apply --3way docs/wip/<name>.patch` and expect conflicts).

- `clinch.patch`: the clinch layer in the fight simulation (`src/game/fight/clinch.ts`: grab, holds, knees, elbows,
  dirty boxing, trips, breaks, the referee, a replay input bit, SIM_VERSION 3) with touch and keyboard input. Still
  to do: the AI's clinch game, HUD prompts, real clips (only placeholders), the anti-spam tests, the balance run and
  the lesson text. Planned for the 90-day update (`docs/MASTER-PLAN.md` section 14).
