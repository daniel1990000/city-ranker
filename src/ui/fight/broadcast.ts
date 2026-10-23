// The TV-broadcast layer's rules, kept pure so they can be unit tested (tests/broadcast.test.ts): the walkout name
// plates, the between-round corner screen (stats, an obvious-round hint, corner advice), the commentary captions and
// the finish replay's timing. Presentation only: everything here reads the fight state and events and never changes
// them. All text is original and plain.

import { scoreRound } from '../../game/fight/judges';
import type { FighterSpec, FightEvent, FightResult, FightState, MoveId, RoundStats, Side } from '../../game/fight/types';
import { METER_MAX, TICK_HZ } from '../../game/fight/types';
import { overall, rosterFighter } from '../../meta/roster';

// ---- small helpers ------------------------------------------------------------------------------------------------

/** The name a commentator uses: the surname ("Dante Okafor" -> "Okafor"). */
export function callName(spec: FighterSpec): string {
  const parts = spec.name.trim().split(/\s+/);
  return parts[parts.length - 1] || spec.name;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const MOVE_WORD: Record<MoveId | 'pound' | 'legs', string> = {
  jab: 'jab',
  cross: 'right hand',
  hookL: 'left hook',
  hookR: 'right hook',
  uppercut: 'uppercut',
  bodyShot: 'body shot',
  lowKick: 'leg kick',
  bodyKick: 'body kick',
  headKick: 'head kick',
  superman: 'superman punch',
  flyingKnee: 'flying knee',
  spinBackfist: 'spinning back fist',
  clinchKnee: 'knee to the body',
  clinchKneeHead: 'knee up the middle',
  clinchElbow: 'short elbow',
  clinchUpper: 'uppercut in close',
  pound: 'ground strikes',
  legs: 'leg kicks',
};

// ---- walkout name plates -------------------------------------------------------------------------------------------

export interface PlateInfo {
  name: string;
  nickname: string;
  /** Pro record shown on the plate, "W-L" or "W-L-D". */
  record: string;
  ovr: number;
  hometown: string;
}

/** Original, generic places for fighters who are not on the roster (quick-fight opponents). */
const TOWNS = [
  'Cardiff, Wales',
  'Lyon, France',
  'Porto, Portugal',
  'Gdansk, Poland',
  'Perth, Australia',
  'Denver, USA',
  'Cork, Ireland',
  'Recife, Brazil',
  'Tbilisi, Georgia',
  'Accra, Ghana',
  'Winnipeg, Canada',
  'Busan, South Korea',
  'Leeds, England',
  'Malmo, Sweden',
  'Cebu, Philippines',
  'Tucson, USA',
];

const RARITY_WINS: Record<FighterSpec['rarity'], [number, number]> = {
  common: [6, 9],
  rare: [10, 9],
  epic: [15, 9],
  legend: [21, 9],
};

/**
 * What the broadcast plate shows for a fighter: name, nickname, a pro record (made up from the fighter's id, so it
 * is the same every time), the overall rating and the hometown.
 */
export function plateInfo(spec: FighterSpec): PlateInfo {
  const h = hash(spec.id);
  const [base, spread] = RARITY_WINS[spec.rarity] ?? RARITY_WINS.common;
  const wins = base + (h % spread);
  const losses = (h >>> 8) % (spec.rarity === 'legend' ? 3 : 6);
  const draws = (h >>> 16) % 7 === 0 ? 1 : 0;
  const home = rosterFighter(spec.id)?.hometown ?? TOWNS[(h >>> 4) % TOWNS.length];
  return {
    name: spec.name,
    nickname: spec.nickname,
    record: draws ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`,
    ovr: overall(spec.stats),
    hometown: home,
  };
}

// ---- the corner screen ----------------------------------------------------------------------------------------------

export interface CornerReport {
  round: number;
  /** [fighter 0, fighter 1]. */
  landed: [number, number];
  thrown: [number, number];
  power: [number, number];
  takedowns: [number, number];
  tdAttempts: [number, number];
  /** Seconds on top on the ground. */
  control: [number, number];
  knockdowns: [number, number];
  /** Who clearly won the round (all three judges agree and it was not close), else null. */
  clearWinner: Side | null;
  /** One or two lines from the player's corner. */
  advice: string[];
}

/**
 * Who clearly won a round, or null when it could be argued: every judge must give it to the same fighter and the
 * gap must be plain to see (a knockdown, a big gap in power shots, or a 10-8).
 */
export function clearRoundWinner(stats: [RoundStats, RoundStats], judges: FightState['judges']): Side | null {
  let winner: Side | null = null;
  let tenEight = false;
  for (const j of judges) {
    const [a, b] = scoreRound(stats, j);
    const w: Side | null = a > b ? 0 : b > a ? 1 : null;
    if (w === null) return null;
    if (winner !== null && w !== winner) return null;
    winner = w;
    if (Math.abs(a - b) >= 2) tenEight = true;
  }
  if (winner === null) return null;
  const me = stats[winner];
  const them = stats[winner === 0 ? 1 : 0];
  const plain =
    tenEight ||
    me.knockdowns > them.knockdowns ||
    me.power - them.power >= 10 ||
    (me.takedowns - them.takedowns >= 2 && me.controlTicks >= 15 * TICK_HZ && me.power >= them.power - 3);
  return plain ? winner : null;
}

interface AdviceCtx {
  /** The opponent's pronouns. */
  he: string;
  his: string;
  him: string;
  /** Which screen half defends / attacks ("left side" / "right side"; swapped for left-handed players). */
  def: string;
  atk: string;
}

/** A candidate line: higher weight wins; one line per topic. */
interface Line {
  topic: string;
  w: number;
  text: string;
}

/**
 * One or two lines of corner advice for the player (side `me`) from what happened in the round and how both
 * fighters are now. The advice uses the real controls (src/game/touch/recognizer.ts and the first-fight lesson).
 */
export function cornerAdvice(state: FightState, me: Side, oppSpec: FighterSpec, leftHanded = false): string[] {
  const them: Side = me === 0 ? 1 : 0;
  const r = state.stats[state.stats.length - 1];
  if (!r) return [];
  const mine = r[me];
  const theirs = r[them];
  const fMe = state.fighters[me];
  const fThem = state.fighters[them];
  const f = oppSpec.lookHints.sex === 'f';
  const c: AdviceCtx = {
    he: f ? 'she' : 'he',
    his: f ? 'her' : 'his',
    him: f ? 'her' : 'him',
    def: leftHanded ? 'right side' : 'left side',
    atk: leftHanded ? 'left side' : 'right side',
  };
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const lines: Line[] = [];
  const add = (topic: string, w: number, text: string) => lines.push({ topic, w, text });

  // dangers first: what is hurting the player
  const legs = fMe.legs / METER_MAX;
  if (legs >= 0.25 || theirs.legDmg >= 1500) add('legs', 60 + legs * 100, `Your legs are taking damage: check ${c.his} low kicks by holding block (thumb on the ${c.def}).`);
  if (theirs.takedowns >= 1 || theirs.tdAttempts >= 3)
    add('sprawl', 55 + theirs.takedowns * 12, `You're getting taken down: swipe down to sprawl the moment ${c.he} shoots.`);
  const head = fMe.head / METER_MAX;
  if (head >= 0.6) add('head', 40 + head * 60, `You're taking too much to the head: keep your guard up (hold the ${c.def}) and flick up or down to slip.`);
  const body = fMe.body / METER_MAX;
  if (body >= 0.5) add('body', 35 + body * 50, `Your body is hurting: cover up in close and don't trade on the inside.`);
  const myTank = fMe.staminaCap / METER_MAX;
  if (fMe.gassed || myTank <= 0.78 || fMe.stamina < fMe.staminaCap * 0.4)
    add('tired', 45 + (1 - myTank) * 80, `You're tiring: pick your shots and block between combinations.`);
  if (theirs.power >= mine.power + 8 && theirs.landed > mine.landed)
    add('outstruck', 42 + (theirs.power - mine.power), `${cap(c.he)}'s beating you to the punch: slip ${c.his} shots (flick on the ${c.def}) and counter straight away.`);
  if (mine.thrown < 30 && theirs.takedowns === 0)
    add('busy', 38, `Too quiet out there: throw more. Tap the ${c.atk} to jab, swipe it for power punches.`);

  // chances: what the player can go after
  const theirTank = fThem.staminaCap / METER_MAX;
  if (fThem.gassed || theirTank <= 0.8 || fThem.stamina < fThem.staminaCap * 0.45)
    add('pace', 50 + (1 - theirTank) * 80, `${cap(c.he)}'s tiring: push the pace and keep throwing.`);
  if (fThem.head / METER_MAX >= 0.65) add('finish', 52 + (fThem.head / METER_MAX) * 30, `${cap(c.he)}'s hurt upstairs: go to the head with hooks and the cross (swipe on the ${c.atk}).`);
  if (fThem.legs / METER_MAX >= 0.3) add('chop', 44, `${cap(c.his)} lead leg is going: keep chopping it with leg kicks (KICK, swipe down).`);
  if (fThem.body / METER_MAX >= 0.55) add('bodywork', 40, `The body work is paying off: swipe down on the ${c.atk} for more body shots.`);
  if (mine.takedowns >= 1 && mine.controlTicks >= 10 * TICK_HZ)
    add('wrestle', 41, `Your wrestling is working: take ${c.him} down again (tap TAKEDOWN) and stay on top.`);

  lines.sort((a, b) => b.w - a.w);
  const out: string[] = [];
  const topics = new Set<string>();
  for (const l of lines) {
    if (topics.has(l.topic)) continue;
    topics.add(l.topic);
    out.push(l.text);
    if (out.length >= 2) break;
  }
  if (out.length === 0) out.push(`Good round. Keep mixing punches, kicks and takedowns so ${c.he} can't read you.`);
  return out;
}

/** The corner screen for the round that just ended (state.stats' last entry). */
export function cornerReport(state: FightState, me: Side, oppSpec: FighterSpec, leftHanded = false): CornerReport {
  const r = state.stats[state.stats.length - 1];
  const pair = <T>(fn: (s: RoundStats) => T): [T, T] => [fn(r[0]), fn(r[1])];
  return {
    round: state.stats.length,
    landed: pair(s => s.landed),
    thrown: pair(s => s.thrown),
    power: pair(s => s.power),
    takedowns: pair(s => s.takedowns),
    tdAttempts: pair(s => s.tdAttempts),
    control: pair(s => Math.round(s.controlTicks / TICK_HZ)),
    knockdowns: pair(s => s.knockdowns),
    clearWinner: clearRoundWinner(r, state.judges),
    advice: cornerAdvice(state, me, oppSpec, leftHanded),
  };
}

/** "1:05" from seconds. */
export function mmss(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- commentary --------------------------------------------------------------------------------------------------

/** A caption line and how much it matters (3 = can cut in on a recent line). */
export interface Caption {
  text: string;
  priority: 1 | 2 | 3;
  /** What it is about (the same kind does not repeat too soon). */
  kind: string;
}

/** Ticks between two captions, and before the same kind of caption comes back. */
export const CAPTION_GAP = 150;
export const CAPTION_SAME_KIND_GAP = 720;
/** A priority-3 line may replace a line that has been up at least this long. */
export const CAPTION_CUT_IN = 40;

function pick(lines: string[], n: number): string {
  return lines[((n % lines.length) + lines.length) % lines.length];
}

/**
 * Picks the commentary lines for the fight's key moments, rate limited in simulation ticks (so it is the same on
 * every device and testable). Feed it every tick's events; it returns the line to show now, or null.
 */
export class Commentary {
  private lastTick = -100000;
  private lastPriority = 0;
  private lastKind = new Map<string, number>();
  private n = 0;
  /** Knockdowns and rocked moments each fighter has suffered (for comeback lines). */
  private trouble: [number, number] = [0, 0];
  private names: [string, string];

  constructor(specs: [FighterSpec, FighterSpec]) {
    this.names = [callName(specs[0]), callName(specs[1])];
  }

  /** The best line for these events, or null (nothing worth saying, or too soon after the last line). */
  feed(events: FightEvent[], state: FightState): string | null {
    let best: Caption | null = null;
    let tick = state.tick;
    for (const e of events) {
      tick = e.tick;
      const c = this.lineFor(e);
      if (c && (!best || c.priority > best.priority)) best = c;
    }
    if (!best) return null;
    const since = tick - this.lastTick;
    const kindAt = this.lastKind.get(best.kind);
    if (kindAt !== undefined && tick - kindAt < CAPTION_SAME_KIND_GAP && best.priority < 3) return null;
    const ok = since >= CAPTION_GAP || (best.priority === 3 && since >= CAPTION_CUT_IN && best.priority >= this.lastPriority) || (best.priority > this.lastPriority && since >= CAPTION_CUT_IN * 2);
    if (!ok) return null;
    this.lastTick = tick;
    this.lastPriority = best.priority;
    this.lastKind.set(best.kind, tick);
    this.n++;
    return best.text;
  }

  /** The candidate line for one event (no rate limit). Exposed for tests. */
  lineFor(e: FightEvent): Caption | null {
    const N = this.names;
    const k = this.n + e.tick;
    const other = (s: Side): Side => (s === 0 ? 1 : 0);
    switch (e.type) {
      case 'roundStart':
        return e.round === 1
          ? { kind: 'start', priority: 1, text: pick(['Here we go. Touch of the gloves and we are under way.', 'And we are off in round one.', 'Round one. Let\'s see who settles first.'], k) }
          : { kind: 'start', priority: 1, text: pick([`Round ${e.round}. Fresh instructions from both corners.`, `Here comes round ${e.round}.`], k) };
      case 'hit': {
        if (e.blocked) return null;
        const a = N[e.side];
        if (e.move !== 'pound' && (e.move === 'superman' || e.move === 'flyingKnee' || e.move === 'spinBackfist') && e.strength !== 'light')
          return { kind: 'special', priority: 2, text: pick([`What a ${MOVE_WORD[e.move]} from ${a}!`, `${a} pulls out the ${MOVE_WORD[e.move]}, and it lands!`], k) };
        if (e.counter && e.strength !== 'light')
          return { kind: 'counter', priority: 2, text: pick([`Beautiful counter from ${a}.`, `${a} times that perfectly.`, `Made ${N[other(e.side)]} pay for that one.`], k) };
        if (e.strength !== 'heavy') return null;
        if (e.move === 'pound') return { kind: 'pound', priority: 1, text: pick([`${a} raining down shots from the top.`, `Heavy ground strikes from ${a}.`], k) };
        return { kind: 'big', priority: 2, text: pick([`Big ${MOVE_WORD[e.move]} from ${a}!`, `${a} lands a heavy ${MOVE_WORD[e.move]}.`, `That ${MOVE_WORD[e.move]} landed clean.`, `Huge shot by ${a}!`], k) };
      }
      case 'knockdown': {
        const v = N[e.side];
        const a = N[other(e.side)];
        const comeback = this.trouble[other(e.side)] > 0 && this.trouble[other(e.side)] >= this.trouble[e.side];
        this.trouble[e.side] += 2;
        if (comeback) return { kind: 'knockdown', priority: 3, text: pick([`What a comeback! ${a} drops ${v}!`, `${a} was in trouble, and now ${v} is down!`], k) };
        if (e.by === 'legs') return { kind: 'knockdown', priority: 3, text: pick([`The leg gives way! ${v} goes down.`, `${v} can't stand on that leg!`], k) };
        return { kind: 'knockdown', priority: 3, text: pick([`${v} is down!`, `Down goes ${v}!`, `${a} drops ${v} with a ${MOVE_WORD[e.by]}!`], k) };
      }
      case 'stun': {
        const v = N[e.side];
        const a = N[other(e.side)];
        const comeback = this.trouble[other(e.side)] > this.trouble[e.side];
        this.trouble[e.side] += 1;
        if (comeback) return { kind: 'rocked', priority: 3, text: pick([`Turnaround! ${a} has ${v} hurt now!`, `${a} fights back and ${v} is wobbled!`], k) };
        return { kind: 'rocked', priority: 3, text: pick([`${v} is rocked!`, `${v} is in big trouble!`, `${v} is out on shaky legs!`], k) };
      }
      case 'recover':
        return { kind: 'recover', priority: 2, text: pick([`${N[e.side]} survives the storm.`, `${N[e.side]} clears the head. Tough as they come.`], k) };
      case 'hurt':
        return e.zone === 'body'
          ? { kind: 'hurtBody', priority: 2, text: pick([`${N[e.side]} is hurt to the body!`, `That body shot folded ${N[e.side]}.`], k) }
          : { kind: 'hurtLegs', priority: 2, text: pick([`${N[e.side]} is limping now. Those kicks are adding up.`, `${N[e.side]}'s lead leg is in trouble.`], k) };
      case 'takedown':
        return e.caughtKick
          ? { kind: 'takedown', priority: 2, text: pick([`${N[e.side]} catches the kick and puts ${N[other(e.side)]} down.`, `Kick caught, and ${N[e.side]} takes it to the mat.`], k) }
          : { kind: 'takedown', priority: 2, text: pick([`${N[e.side]} takes it to the mat.`, `Big takedown from ${N[e.side]}.`, `${N[e.side]} gets the legs and drives through.`], k) };
      case 'sprawl':
        return e.success ? { kind: 'sprawl', priority: 1, text: pick([`Great sprawl by ${N[e.side]}.`, `${N[e.side]} stuffs the takedown.`], k) } : null;
      case 'subStart':
        return e.sub === 'armbar'
          ? { kind: 'sub', priority: 3, text: pick([`${N[e.side]} is hunting an armbar!`, `Armbar attempt from ${N[e.side]}!`], k) }
          : { kind: 'sub', priority: 3, text: pick([`${N[e.side]} is looking for the choke!`, `${N[e.side]} sinks in a choke!`], k) };
      case 'subEscape':
        return { kind: 'escape', priority: 3, text: pick([`${N[e.side]} escapes!`, `Out of trouble! ${N[e.side]} slips free.`], k) };
      case 'scrambleEnd':
        if (!e.success) return null;
        if (e.purpose === 'standUp') return { kind: 'scramble', priority: 1, text: pick([`${N[e.side]} scrambles back to the feet.`, `Back up goes ${N[e.side]}.`], k) };
        if (e.purpose === 'advance') return { kind: 'scramble', priority: 2, text: pick([`${N[e.side]} passes to full mount. Danger here.`, `Mount for ${N[e.side]}.`], k) };
        return { kind: 'scramble', priority: 1, text: `${N[e.side]} escapes the mount.` };
      case 'standUp':
        return e.reason === 'ref' ? { kind: 'ref', priority: 1, text: pick(['The referee wants more action. Back on the feet.', 'Not enough work down there. The referee stands them up.'], k) } : null;
      case 'guardBreak':
        return { kind: 'guard', priority: 1, text: `${N[other(e.side)]}'s guard is broken open.` };
      case 'clinchStart':
        return e.wall
          ? { kind: 'clinch', priority: 1, text: pick([`${N[e.side]} has ${N[other(e.side)]} pinned on the cage.`, `${N[e.side]} ties it up against the fence.`], k) }
          : { kind: 'clinch', priority: 1, text: pick([`${N[e.side]} grabs hold. We're in the clinch.`, `${N[e.side]} ties ${N[other(e.side)]} up.`, `Into the clinch they go.`], k) };
      case 'clinchTripEnd':
        return e.success ? { kind: 'clinchTrip', priority: 2, text: pick([`${N[e.side]} trips ${N[other(e.side)]} to the canvas!`, `Lovely trip from ${N[e.side]}.`], k) } : null;
      case 'clinchContestEnd':
        if (!e.success) return null;
        return e.purpose === 'reverse'
          ? { kind: 'clinchTurn', priority: 1, text: pick([`${N[e.side]} turns it around. Now ${N[e.side]} has the control.`, `Reversal in the clinch from ${N[e.side]}.`], k) }
          : { kind: 'clinchOut', priority: 1, text: pick([`${N[e.side]} breaks free.`, `${N[e.side]} gets out of there.`], k) };
      case 'clinchBreak':
        return e.reason === 'ref' ? { kind: 'ref', priority: 1, text: pick(['The referee breaks them up.', 'Nothing happening in there. The referee separates them.'], k) } : null;
      case 'gassed':
        return { kind: 'gassed', priority: 1, text: pick([`${N[e.side]} is running on empty.`, `${N[e.side]} is breathing hard now.`], k) };
      case 'roundEnd':
        return { kind: 'roundEnd', priority: 2, text: pick([`That's the end of round ${e.round}.`, `There's the bell for round ${e.round}.`], k) };
      case 'tapOut':
        return { kind: 'end', priority: 3, text: pick([`${N[e.side]} taps! It's over!`, `The tap! ${N[other(e.side)]} gets the submission!`], k) };
      case 'fightEnd':
        return { kind: 'end', priority: 3, text: finishLine(e.result, N, k) };
      default:
        return null;
    }
  }
}

function finishLine(r: FightResult, N: [string, string], k: number): string {
  const w = r.winner === null ? '' : N[r.winner];
  if (r.stoppage === 'forfeit') return `The corner has seen enough. ${w} wins.`;
  switch (r.method) {
    case 'KO':
      return pick([`It's all over! ${w} wins by knockout!`, `Lights out! ${w} ends it!`], k);
    case 'TKO':
      return pick([`The referee steps in. It's over! ${w} wins!`, `That's enough. Stoppage win for ${w}.`], k);
    case 'SUB':
      return pick([`${w} gets the tap! What a finish.`, `Submission! ${w} wins it on the mat.`], k);
    case 'DEC':
      return r.winner === null ? 'Too close to split. We have a draw.' : `The judges have it for ${w}.`;
  }
}

// ---- the finish replay --------------------------------------------------------------------------------------------

/** How far before the finish the replay starts, and how long it runs after it (ticks). */
export const REPLAY_BEFORE = 180;
export const REPLAY_AFTER = 80;

/** A finish worth a replay: KO, TKO or submission (not a decision, not a retirement). */
export function replayable(r: FightResult | null): boolean {
  return !!r && (r.method === 'KO' || r.method === 'TKO' || r.method === 'SUB') && r.stoppage !== 'forfeit';
}

/** Replay speed at `tick` (1 = real time): normal-ish run-up, slow motion around the finish, then easing out. */
export function replaySpeed(tick: number, endTick: number): number {
  const d = tick - endTick;
  if (d < -50) return 0.75;
  if (d < 30) return 0.3;
  return 0.55;
}
