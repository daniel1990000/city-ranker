// Match flow (docs/12 §2): a hierarchical statechart  preFight → fight{round{live ⇄ stopped}, betweenRounds} → postFight.
// The clock only runs in `live`; `stopped` pauses it (referee stop, knockdown sequence). Transitions are events:
// fightStart · refStop · resume · bell · next · ko · tko · tap · doctorStop.

import { Statechart } from '../core/statechart.js';
import { MatchState } from '../core/taxonomy.js';

export class Match {
  /** @param o {rounds, roundTicks, restTicks, hooks:{onRoundStart,onRoundEnd,onBetweenRounds,onFightOver}} */
  constructor({ rounds = 3, roundTicks = 18000, restTicks = 3600, hooks = {} } = {}) {
    this.rounds = rounds; this.roundTicks = roundTicks; this.restTicks = restTicks; this.hooks = hooks;
    this.round = 0; this.elapsed = 0; this.rest = 0; this.reason = null; this.outcome = null;
    const self = this;
    const roundEnd = () => hooks.onRoundEnd?.(self.round);
    this.chart = new Statechart({
      id: 'match',
      initial: 'preFight',
      states: {
        preFight: { on: { fightStart: 'fight.round' } },
        fight: {
          initial: 'round',
          states: {
            round: {
              initial: 'live',
              entry: [() => { self.round += 1; self.elapsed = 0; hooks.onRoundStart?.(self.round); }],
              states: {
                live: { on: { refStop: { target: 'fight.round.stopped', actions: [(c, p) => { self.reason = p?.reason ?? 'referee'; }] } } },
                stopped: { on: { resume: { target: 'fight.round.live', actions: [() => { self.reason = null; }] } } },
              },
              on: {
                bell: [
                  { target: 'postFight', guard: () => self.round >= self.rounds, actions: [roundEnd] },
                  { target: 'fight.betweenRounds', actions: [roundEnd] },
                ],
              },
            },
            betweenRounds: {
              entry: [() => { self.rest = self.restTicks; hooks.onBetweenRounds?.(self.round); }],
              on: { next: 'fight.round' },
            },
          },
          on: {
            ko: { target: 'postFight', actions: [roundEnd] }, tko: { target: 'postFight', actions: [roundEnd] },
            tap: { target: 'postFight', actions: [roundEnd] }, doctorStop: 'postFight',
          },
        },
        postFight: { entry: [(c, p) => { self.outcome = p ?? null; hooks.onFightOver?.(p); }] },
      },
    });
  }

  start() { this.chart.start(); this.chart.send('fightStart'); return this; }
  send(event, payload) { this.chart.send(event, payload); return this; }

  /** Our MatchState vocabulary for the HUD / camera. */
  get state() {
    const c = this.chart;
    if (c.matches('preFight')) return MatchState.PRE_FIGHT;
    if (c.matches('postFight')) return MatchState.POST_FIGHT;
    if (c.matches('fight.betweenRounds')) return MatchState.BETWEEN_ROUNDS;
    if (c.matches('fight.round.stopped')) return MatchState.STOPPED;
    return MatchState.FIGHT;
  }
  get live() { return this.chart.matches('fight.round.live'); }
  get simRuns() { return this.live || (this.chart.matches('fight.round.stopped') && this.reason === 'knockdown'); }

  /** advance the round clock one tick; rings the bell at the limit */
  tickClock() {
    if (!this.live) return;
    this.elapsed += 1;
    if (this.elapsed >= this.roundTicks) this.send('bell');
  }
  tickRest() {
    if (!this.chart.matches('fight.betweenRounds')) return;
    if (--this.rest <= 0) this.send('next');
  }
  stop(reason = 'referee') { if (this.live) this.send('refStop', { reason }); }
  resume() { if (this.chart.matches('fight.round.stopped')) this.send('resume'); }
  finish(kind, outcome) { this.send(kind, outcome); }
  get secondsLeft() { return Math.max(0, (this.roundTicks - this.elapsed) / 60); }
}
