// The first fight's lesson: one step at a time (jab, power punch, block, slip, kick, takedown), each waiting for the
// player to do it. Meanwhile the opponent is a sparring partner who only throws slow jabs when the lesson needs
// something to defend; after the last step the real (easy) AI takes over.

import { AIController } from '../game/fight/ai';
import type { Controller, FightInput, FightView, Side } from '../game/fight/types';
import { NO_INPUT } from '../game/fight/types';

interface Step {
  title: string;
  text: string;
  done(i: FightInput, held: number): boolean;
  /** The partner throws jabs during this step (block / slip practice). */
  partnerJabs?: boolean;
}

const KICKS = new Set(['lowKick', 'bodyKick', 'headKick']);
const POWER = new Set(['cross', 'hookL', 'hookR', 'uppercut', 'bodyShot']);

export const STEPS: Step[] = [
  { title: 'Jab', text: 'Tap the right side of the screen', done: i => i.strike === 'jab' },
  { title: 'Power punches', text: 'Swipe on the right side: forward = cross, up = uppercut, diagonal = hooks, down = body', done: i => !!i.strike && POWER.has(i.strike) },
  { title: 'Block', text: 'Hold your thumb on the left side to keep your guard up', done: (_i, held) => held >= 45, partnerJabs: true },
  { title: 'Slip', text: 'Flick up or down on the left side to slip a punch', done: i => i.evade === 'left' || i.evade === 'right', partnerJabs: true },
  { title: 'Kick', text: 'Tap KICK for a body kick, or swipe from it: up = head kick, down = leg kick', done: i => !!i.strike && KICKS.has(i.strike) },
  { title: 'Takedown', text: 'Tap TAKEDOWN (or swipe down hard on the right) to shoot for the legs', done: i => i.shoot },
];

/** The sparring partner: stands in front of you, jabs slowly when asked. */
class Partner {
  jabs = false;
  private nextJab = 0;

  input(view: FightView): FightInput {
    const out = { ...NO_INPUT };
    if (view.phase !== 'fight') return out;
    if (view.dist > 1100) out.move = 1;
    else if (view.dist < 800) out.move = -1;
    if (this.jabs && view.tick >= this.nextJab && view.dist <= 1150) {
      out.strike = 'jab';
      this.nextJab = view.tick + 110;
    }
    // get back up / out of ground positions on its own
    if (view.ground) out.ground = 'up';
    if (view.me.action === 'downed') out.tap = view.tick % 6 === 0;
    return out;
  }
}

export class Tutorial implements Controller {
  step = 0;
  private held = 0;
  private partner = new Partner();
  private ai: AIController;
  /** Called when the step changes (null = the lesson is over). */
  onStep: ((s: Step | null, index: number) => void) | null = null;

  constructor(seed: number) {
    this.ai = new AIController({ difficulty: 80, seed });
  }

  get finished(): boolean {
    return this.step >= STEPS.length;
  }

  /** Feed the player's input of this tick (advances the lesson). */
  observe(i: FightInput): void {
    if (this.finished) return;
    this.held = i.block ? this.held + 1 : 0;
    const s = STEPS[this.step];
    if (s.done(i, this.held)) {
      this.step++;
      this.held = 0;
      this.onStep?.(this.finished ? null : STEPS[this.step], this.step);
    }
    this.partner.jabs = !this.finished && !!STEPS[this.step]?.partnerJabs;
  }

  /** The player pressed Skip (the lesson ends the same way, but the funnel counts it apart). */
  skipped = false;

  skip(): void {
    this.skipped = !this.finished;
    this.step = STEPS.length;
    this.onStep?.(null, this.step);
  }

  next(view: FightView, side: Side): FightInput {
    if (this.finished) return this.ai.next(view, side);
    return this.partner.input(view);
  }
}
