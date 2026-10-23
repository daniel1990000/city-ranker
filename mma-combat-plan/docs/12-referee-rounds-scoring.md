# 12 · Fight flow, referee, rounds and judging

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/core/statechart.js`,
`sim/match.js`, `combat/referee.js`, `combat/scoring.js`. Tests: `reference/test/scoring.test.js`, `match.test.js`.

## 1. Observed structure **[DATA]**

**Match states**: `pre_fight → start_fight → fight → stop_fight ⇄ restart_fight → between_rounds → … → post_fight`.
`stop_fight` reasons: `referee_stop, between_rounds, desync, none`; sub-states `break`, `broken`.

**Pre-fight choreography**: announcer introductions, "coming up next", enter ring ×2, ring-walk ×2, ref check ×2, pre-staredown
idle, staredown walk / interaction / wait-for-fight-start, glove touch. **Between rounds**: walk to corner (+idle), sit down,
corner huddle (trainer, cutman, entourage), huddle end, entourage exit. **Post-fight**: crowd shot, decision announcement
loop, fighter and group celebration, highlight-reel replay, replays, done.

**Referee voice/events**: `RULES_READ`, `SECONDS_OUT`, `ROUND_START/ENDS`, `BREAK_RESET_TO_MIDDLE`, `FIGHT_BACK`,
`FIGHT_RESTART`, `LOW_ACTION`, `STOP`, `FIGHTER_{BLUE,RED}_READY`, `END_FIGHT`, `OFFICIAL_DECISION`, `MOMENT_OF_VICTORY`.
`RefereeController`, `TrainerController` exist as gameplay controllers.

**Round parameters**: `max_rounds`, `num_ot_rounds` (overtime), `round_number`, `round_time_elapsed`, `FIGHT_CLOCK`.

**Stoppage types**: `fighters_idle, ko, round_end, submission_win, tko` (+ doctor stoppage story).
**Result types**: `ko, tko, submission, unanimous_decision, majority_decision, split_decision, draw, majority_draw, undecided`
(win-states also `referee_stoppage`, `loser`).

**Judging – the 12 scored components** (`judge_score_component_*`):
`effective_striking, damage, health_events, blocks_and_parries, clinch_dominance, ground_dominance,
takedowns_performed, takedowns_denied, passes_performed, passes_denied, submissions, submissions_escaped`.
Scorecards are tracked per fighter (`FIGHTER_SCORE_CARD`) and the commentary layer classifies round/fight closeness
(`story_pre_decision_close_*`, `…_unanimous_*`) with "edge" categories (who led in strike accuracy, kicks landed,
knockdowns, takedowns, submission attempts …).

## 2. Match state machine **[REC]** (hierarchical statechart; engine in `core/statechart.js`)

```
Match
├─ PreFight   : intro → refCheck → staredown → (event: fightStart)
├─ Fight
│   ├─ Round(n)
│   │   ├─ Live          (clock running)   ──ko / tko / submissionTap──▶ PostFight
│   │   ├─ Stopped       (clock paused: refStop | doctorCheck | knockdownSequence)  ──resume──▶ Live
│   │   └─ (event: bell) ──▶ BetweenRounds  | PostFight (final round)
│   └─ BetweenRounds     : corner (recovery tick, cutman, advice) ── (event: next) ──▶ Round(n+1)
└─ PostFight  : decision | stoppageAnnounce | celebration
```
Transitions are events (`bell`, `ko`, `tko`, `tap`, `refStop`, `resume`, `doctorStop`, `next`) with enter/exit actions —
the same pattern as the reference's flow engine (SCXML-style composite states).

### Round parameters (starting values)
Non-title: 3 × 5:00; main event/title: 5 × 5:00; rest 60 s. `seconds_out` call at 10 s. Clock **pauses** on referee
stop, knockdown sequence, doctor check.

### Recovery between rounds **[REC]**
`stamina += 0.40·(max − current)` (cap 100 %), `body/legs pools += 3 %` of max, `head += 1 %`, cut severity −1 with the
cutman on `p = 0.7` (critical cuts need the doctor: `p(doctorStop) = 0.5·severity`), `strikesReceivedThisRound = 0`
(this resets the accumulation term in `HealthEventProbability`, `06`).

## 3. Referee behaviour **[REC]**
Priority each tick: (1) `knockout` event ⇒ KO; (2) TKO rules (`06` §6); (3) doctor check; (4) **idle** rules:
 * stand-up: no strike/transition/submission attempt for 5 s → `LOW_ACTION` warning, 10 s → `BREAK`/stand-up
   (restart at centre, "FIGHT_BACK");
 * clinch: 6 s warning, 12 s break (`07`);
 * ground: 10 s `fighters_idle` → stand-up (`09`);
(5) bell. A stoppage while a submission is at stage ≥ 3 and the bell rings → `saved_by_bell` story event.
Fouls are not evidenced in the reference; omit or add later as a separate module.

## 4. Judging **[REC]** (components and tags above are observed; formulas are ours)

Each round, per fighter *f* compute 12 component values from the stats tracker, normalise each to `[0,1]` as
`share = mine / (mine + theirs)` (0.5 when both zero), then:
```
S_f = Σ_i w_i · c_i(f)                       # weights below; normalise so Σ w = 1
```
| Component | Raw measure | Start weight |
|---|---|---|
| effective_striking | significant strikes landed (head 1.0, body 0.7, leg 0.6) × accuracy bonus | 0.26 |
| damage | post-block damage dealt ÷ opponent pool maxima | 0.26 |
| health_events | wobbled 1, stun 2, critical stun 3.5, knockdown 8, liver shot 2, limp 1.5 | 0.14 |
| takedowns_performed / denied | landed · 1.0 / denied · 0.4 | 0.05 / 0.02 |
| ground_dominance | seconds on top × (GnP landed bonus) | 0.07 |
| clinch_dominance | dom seconds − sub seconds (+ clinch strikes) | 0.03 |
| passes_performed / denied | improvements · 1.0 / stuffed · 0.5 | 0.02 / 0.01 |
| submissions / escaped | Σ stage depth reached / escapes | 0.05 / 0.02 |
| blocks_and_parries | defended ÷ attempted strikes | 0.07 |

**Round card (10-point must)**: winner 10, loser 9; **10-8** if `S_win − S_lose ≥ 0.38` *or* the loser suffered a
knockdown with ≥ 2 health events *or* ≥ 2 minutes of ground dominance with heavy GnP; **10-7** if two such criteria and
`≥ 0.55`; `10-10` only if `|ΔS| < 0.02`. Three **judges**, each with jittered weights (±15 %) and one "style bias"
(damage-first, grappling-first, activity-first), so scorecards occasionally disagree.

**Decision**: sum rounds per judge; results = `unanimous` (3–0), `majority` (2–0 + one draw), `split` (2–1), `draw`
(1–1–1 or all equal), `majority_draw` (1 judge for A + 1 draw + 1 for B). Overtime/extra rounds only if a mode demands it.

### Stats needed (emitted by `sim/stats.js`)
Per round and per fight: strikes thrown/landed/blocked/avoided by target/limb/type/mode, significant strikes, takedown
attempts/landed/denied, passes landed/denied, ground/clinch/stand-up seconds, submission attempts/locked/escaped/depth,
knockdowns, stuns, wobbles, event timings (`time_since_last_*`), control percentages.

## 5. Acceptance tests
1. Statechart: legal/illegal transitions; `bell` in last round ⇒ PostFight; `ko` from any Live state ⇒ PostFight with result KO.
2. Clock stops during `Stopped`; resumes with the same remaining time.
3. Idle thresholds fire exactly once each and respect mode.
4. Scoring: symmetric (swap fighters ⇒ swapped scores), monotone in each component, 10-8 rule triggers on a synthetic
   dominant round, unanimous/split/majority classification across 3 judges with crafted cards.
5. Recovery resets `strikesReceivedThisRound`.
