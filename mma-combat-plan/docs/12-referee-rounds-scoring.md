# 12 · Fight flow, referee, rounds and judging

Tags: **[CODE] [DATA] [ARCH] [REC] [GAP]** (see `02`). Reference code: `reference/src/core/statechart.js`,
`sim/match.js`, `combat/referee.js`, `combat/scoring.js`, `combat/injuries.js`, `combat/stamina.js`. Tests:
`reference/test/scoring.test.js`, `match.test.js`, `referee.test.js`.

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
Transitions are events (`fightStart`, `refStop`, `resume`, `bell`, `next`, `ko`, `tko`, `tap`, `doctorStop`) with enter/exit
actions — the same pattern as the reference's flow engine (SCXML-style composite states). `Match.state` maps the chart onto a
small HUD/camera vocabulary (`pre_fight`, `fight`, `stopped`, `between_rounds`, `post_fight`).

### Round parameters (implemented defaults)
3 × 5:00 by default (`FightSim({rounds: 5})` for main events), rest 60 s (`referee.roundSeconds / restSeconds`; headless
runs skip the rest with `fastRest`). The clock **pauses** in `stopped`: on a referee stop and **during the knockdown
sequence** — in that case the *simulation keeps running* (`Match.simRuns`: the downed fighter's event timer, the follow-up and
the referee's count continue) while the round clock stands still. The reference has a `seconds_out` call at 10 s of rest; that
is a presentation event and is not simulated.

### Recovery between rounds **[REC]** (`stamina.js: recoverBetweenRounds`, `injuries.js: cutmanTreat`)
`stamina += 0.40·(max − current)`, `body/leg pools += 10 %` of max, `head += 14 %` (`recovery.*`; the first draft restored 3–4 %
and the per-round finish rate doubled by round 4, see `19`); the cutman lowers a *cut* or
*worse* region by one stage with `p = 0.7` (a *critical* cut cannot be treated and goes to the doctor:
`p(doctorStop) = referee.doctorChanceFactor (0.5) · severity`, checked once at the end of every round that is not the last).
`strikesReceivedThisRound` resets because the stats tracker is round-scoped (`StatsTracker.startRound`) — this resets the
accumulation term in `HealthEventProbability` (`06`). Every bout is ended at the bell (`reason:'bell'`), both fighters start
the next round standing 1.4 m apart in the middle, and statuses other than a knockout are cleared.

## 3. Referee behaviour **[REC]** (`combat/referee.js` — an observer of the event bus plus one `update()` per tick)
Priority each tick: (1) `knockout` health event ⇒ KO (double KO: healthier head pool wins, exact tie = no contest);
(2) TKO rules (`06` §6: unanswered ground strikes, stunned-and-hurt, leg injury); (3) submission results (tap / choke-out /
lock injury); (4) **idle** rules, each owned by the state that has the timer:
 * stand-up (the referee): no strike, shot, clinch, transition or movement-to-contact for 5 s → `LOW_ACTION` warning, 10 s →
   `BREAK` and a reset to the middle (`FIGHT_BACK`);
 * clinch (the `ClinchBout`): 5 s warning, 8 s break — only significant strikes and pummels count as action (`07`);
 * ground (the `GroundBout`): 5 s warning, 10 s stand-up in the middle — only significant strikes, transitions, get-ups and
   submission attempts count (`09`);
(5) bell. A submission at stage ≥ 3 when the bell rings counts `subs.saved_by_bell` for the defender.
The doctor check runs between rounds (§2). Fouls are not evidenced in the reference; omit or add later as a separate module.

## 4. Judging **[REC]** (components and tags above are observed; formulas are ours — `combat/scoring.js`)

Each round, per fighter *f* compute the 12 raw component values from the stats tracker, turn each into a share
`share_i = mine / (mine + theirs)` (0.5 when both are zero), then:
```
S_f = Σ_i w_i · share_i(f)                    # weights below; normalised so Σ w = 1 ; S_a + S_b = 1
Δ   = S_a − S_b
```
| Component | Raw measure | Base weight |
|---|---|---|
| effective_striking | (head 1.0·sig head + body 0.7·sig body + leg 0.6·sig leg) × (0.85 + 0.3·accuracy) | 0.26 |
| damage | post-block damage dealt ÷ the opponent's four pool maxima | 0.26 |
| health_events | Σ value × events inflicted: wobble 1, stun 2, critical stun 3.5, knockdown 8, liver shot 2, limp 1.5 | 0.14 |
| takedowns_performed / denied | landed · 1.0 / denied · 0.4 | 0.05 / 0.02 |
| ground_dominance | dominant seconds × (1 + 0.1·ground strikes landed) | 0.07 |
| clinch_dominance | dom seconds + 2·clinch strikes landed | 0.03 |
| passes_performed / denied | passes landed · 1.0 / denied · 0.5 | 0.02 / 0.01 |
| submissions / escaped | stage depth + 0.5·attempts / escapes | 0.05 / 0.02 |
| blocks_and_parries | (blocked + parried + slipped + caught + evaded) ÷ strikes the opponent threw | 0.07 |

**Round card (10-point must)**: a round with `|Δ| < 0.004` (`drawMargin`) is **10-10**; otherwise winner 10, loser 9;
**10-8** if `|Δ| ≥ 0.38` (`ten8Margin`, the *margin* criterion) **or**, in a round the winner clearly won
(`|Δ| ≥ 0.20`, `ten8SoftMargin`), the loser suffered a knockdown plus ≥ 2 health events (*knockdown*) or the winner had ≥ 120 s
of dominant ground time with ≥ 10 ground strikes (*ground_dominance*); **10-7** if two criteria hold and `|Δ| ≥ 0.55`.
Three **judges** each get the base weights jittered by ±5 % (`judgeWeightJitter`) and **one style bias** (the three biases are
dealt out in random order, so every card has a damage-first, a grappling-first and an activity-first judge):
damage-first ×1.18 on damage and health events; grappling-first ×1.25 on takedown / ground / pass / submission components and
×1.12 on clinch; activity-first ×1.18 on striking and ×1.12 on blocks and parries. Scorecards therefore occasionally disagree.

**Decision** (`classifyDecision`, real-world definitions): sum the rounds per judge → a verdict per judge (`a`, `b`, `draw`);
`unanimous` (3–0), `majority` (2–0 with one draw), `split` (2–1), `draw` (all draws, or one for each and a draw),
`majority_draw` (two draws and one judge for a fighter — an earlier draft of this document had that definition wrong).
Overtime/extra rounds only if a mode demands it (not implemented).

The AI's `score_differential` input (`13`) comes from a **neutral judge** (base weights, no bias) over the rounds so far,
scaled to −1…+1 and refreshed once per second.

### Stats needed (emitted by `sim/stats.js`)
Per round and per fight: strikes thrown/landed/blocked/avoided by target/limb/type/mode, significant strikes, takedown
attempts/landed/denied, passes landed/denied, ground/clinch/stand-up seconds, submission attempts/locked/escaped/depth,
knockdowns, stuns, wobbles, event timings (`time_since_last_*`), control percentages.

## 5. Acceptance tests (`reference/test/match.test.js`, `scoring.test.js`, `referee.test.js`, all passing)
1. Statechart: legal/illegal transitions (illegal events are ignored); `bell` in the last round ⇒ PostFight; stoppage events end the fight from every fight state; hooks fire in order, once each.
2. Clock runs only while `live`, resumes with the same time left, resets every round; with `fastRest` off the sim spends the rest period.
3. Idle thresholds fire exactly once each per stall and respect the mode; activity resets them.
4. Scoring: all 12 components are scored and each has a feeding statistic; an inactive round is 10-10; symmetric (swap fighters ⇒ swapped scores); monotone in each component; 10-8 on a dominant round and 10-7 only with two criteria and a huge margin; crafted cards classify as unanimous / majority / split / draw / majority draw; weights sum to one, biases differ, jitter is bounded.
5. A multi-round `FightSim`: the bell breaks bouts, resets positions, restores some stamina, clears the per-round strike counter and reads the cards.
6. Referee: KO and double KO, the three TKO rules (incl. intelligent defence keeping the fight going), submission results, doctor stoppages only for critical cuts.
