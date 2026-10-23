// Replays: a fight is its seed, the two fighters, the rules and both players' inputs. Inputs pack into a 17-bit code
// per tick and run-length encode well (most ticks repeat). The same format is what a network match will send.

import { type Fight, createFight, hashState, stepFight } from './sim';
import type { Controller, Evade, FighterSpec, FightInput, FightRules, FightView, GroundDir, Replay, Side, Strike } from './types';
import { NO_INPUT } from './types';
import { STRIKES, SPECIALS } from './moves';

/** 2: a 17th input bit (the clinch grab). Version 1 replays decode the same (the bit is 0). */
export const REPLAY_VERSION = 2;

const EVADES: readonly (Evade | null)[] = [null, 'left', 'right', 'back'];
const GROUND: readonly (GroundDir | null)[] = [null, 'up', 'down', 'left', 'right'];
void SPECIALS;

/** Pack one input into an integer (bits: strike 4, special 1, block 1, evade 2, move 2, shoot 1, ground 3, tap 1, taunt 1, clinch 1). */
export function encodeInput(i: FightInput): number {
  const strike = i.strike ? STRIKES.indexOf(i.strike) + 1 : 0;
  const evade = EVADES.indexOf(i.evade);
  const ground = GROUND.indexOf(i.ground);
  return (
    strike |
    ((i.special ? 1 : 0) << 4) |
    ((i.block ? 1 : 0) << 5) |
    (evade << 6) |
    ((i.move + 1) << 8) |
    ((i.shoot ? 1 : 0) << 10) |
    (ground << 11) |
    ((i.tap ? 1 : 0) << 14) |
    ((i.taunt ? 1 : 0) << 15) |
    ((i.clinch ? 1 : 0) << 16)
  );
}

export function decodeInput(c: number): FightInput {
  const strike = c & 15;
  return {
    strike: strike ? (STRIKES[strike - 1] as Strike) : null,
    special: ((c >> 4) & 1) === 1,
    block: ((c >> 5) & 1) === 1,
    evade: EVADES[(c >> 6) & 3] ?? null,
    move: ((((c >> 8) & 3) - 1) as -1 | 0 | 1),
    shoot: ((c >> 10) & 1) === 1,
    ground: GROUND[(c >> 11) & 7] ?? null,
    tap: ((c >> 14) & 1) === 1,
    taunt: ((c >> 15) & 1) === 1,
    clinch: ((c >> 16) & 1) === 1,
  };
}

/** Records inputs as they are fed to the simulation. */
export class ReplayRecorder {
  private codes: [number[], number[]] = [[], []];
  constructor(private readonly fight: Fight) {}

  record(inputs: [FightInput, FightInput]): void {
    this.codes[0].push(encodeInput(inputs[0]));
    this.codes[1].push(encodeInput(inputs[1]));
  }

  finish(): Replay {
    const f = this.fight;
    return {
      version: REPLAY_VERSION,
      sim: f.state.v,
      seed: f.seed,
      specs: [f.specs[0], f.specs[1]] as [FighterSpec, FighterSpec],
      rules: { ...f.rules },
      ticks: this.codes[0].length,
      inputs: [rle(this.codes[0]), rle(this.codes[1])],
      hash: hashState(f.state),
    };
  }
}

/** Run-length encode: "code.count" pairs in base 36, comma separated (count omitted when 1). */
export function rle(codes: number[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < codes.length) {
    const c = codes[i];
    let n = 1;
    while (i + n < codes.length && codes[i + n] === c) n++;
    out.push(n === 1 ? c.toString(36) : `${c.toString(36)}.${n.toString(36)}`);
    i += n;
  }
  return out.join(',');
}

export function unrle(s: string): number[] {
  if (!s) return [];
  const out: number[] = [];
  for (const part of s.split(',')) {
    const [c, n] = part.split('.');
    const code = parseInt(c, 36);
    const count = n ? parseInt(n, 36) : 1;
    if (!Number.isFinite(code) || !Number.isFinite(count) || count < 1 || count > 1e7) throw new Error('bad replay');
    for (let k = 0; k < count; k++) out.push(code);
  }
  return out;
}

/** Plays back one side of a replay as a controller. */
export class ReplayController implements Controller {
  private i = 0;
  constructor(private readonly codes: number[]) {}
  next(view: FightView, side: Side): FightInput {
    void view;
    void side;
    const c = this.codes[this.i++];
    return c === undefined ? { ...NO_INPUT } : decodeInput(c);
  }
}

/** Re-run a whole replay; returns the fight at its end (its hash should equal replay.hash). */
export function runReplay(r: Replay): Fight {
  const f = createFight({ seed: r.seed, a: r.specs[0], b: r.specs[1], rules: r.rules as FightRules });
  const a = unrle(r.inputs[0]);
  const b = unrle(r.inputs[1]);
  for (let t = 0; t < r.ticks; t++) stepFight(f, [decodeInput(a[t] ?? 0x100), decodeInput(b[t] ?? 0x100)]);
  return f;
}
