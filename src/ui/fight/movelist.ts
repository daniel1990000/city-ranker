// The MOVE LIST: every move, the gesture (and key) that throws it, and how hard and how fast it is. Built from the
// real tables, so it can't drift from the game: frame data from moves.ts, swipe directions from the gesture
// recogniser (OFFENCE_SWIPES, kickFor, DEFENCE_FLICKS) and keys from keyboard.ts. Opened from the pause menu in every
// fight, and from the MOVES button in the Training Room.

import { MOVES, SIGNATURE_BY_ARCHETYPE, evades } from '../../game/fight/moves';
import type { FighterSpec, MoveId, Strike } from '../../game/fight/types';
import { DEFENCE_FLICKS, kickFor, OFFENCE_SWIPES } from '../../game/touch/recognizer';
import { GROUND_KEYS, STAND_KEYS } from '../../game/touch/keyboard';
import type { Dir8 } from '../../game/touch/types';
import './movelist.css';

export const MOVE_NAMES: Record<MoveId, string> = {
  jab: 'Jab',
  cross: 'Cross',
  hookL: 'Lead hook',
  hookR: 'Rear hook',
  uppercut: 'Uppercut',
  bodyShot: 'Body shot',
  lowKick: 'Leg kick',
  bodyKick: 'Body kick',
  headKick: 'Head kick',
  superman: 'Superman punch',
  flyingKnee: 'Flying knee',
  spinBackfist: 'Spinning back fist',
  clinchKnee: 'Knee to the body',
  clinchKneeHead: 'Knee to the head',
  clinchElbow: 'Short elbow',
  clinchUpper: 'Clinch uppercut',
};

/** Screen arrows for swipe directions (the opponent is always to the right: F = →). */
const ARROW: Record<Dir8, string> = { F: '→', UF: '↗', U: '↑', UB: '↖', B: '←', DB: '↙', D: '↓', DF: '↘' };
const DIRS: readonly Dir8[] = ['F', 'UF', 'U', 'UB', 'B', 'DB', 'D', 'DF'];

export interface MoveRow {
  name: string;
  /** How to do it on the touch screen. */
  gesture: string;
  /** Keyboard key(s), '' when there are none. */
  key: string;
  /** 1..5 pips, 0 = not an attack. */
  power: number;
  speed: number;
  note: string;
}

export interface MoveSection {
  title: string;
  sub: string;
  rows: MoveRow[];
}

export interface MoveListOptions {
  leftHanded?: boolean;
  /** The player's fighter (its signature special); the archetype default otherwise. */
  fighter?: Pick<FighterSpec, 'archetype' | 'signature'> | null;
}

/** Damage pips: jab 1 .. head kick and specials 5. */
export function powerPips(m: MoveId): number {
  return Math.max(1, Math.min(5, Math.round(MOVES[m].dmg / 350)));
}

/** Speed pips from the startup: jab 5 .. head kick 1. */
export function speedPips(m: MoveId): number {
  return Math.max(1, Math.min(5, 6 - Math.ceil((MOVES[m].startup - 5) / 3.5)));
}

function keysFor(match: (v: (typeof STAND_KEYS)[string]) => boolean): string {
  const out: string[] = [];
  for (const [code, v] of Object.entries(STAND_KEYS)) if (match(v)) out.push(keyName(code));
  return out.slice(0, 2).join(' / ');
}

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  if (code === 'Comma') return ',';
  if (code.startsWith('Shift')) return 'Shift';
  return code;
}

function arrows(dirs: Dir8[]): string {
  return dirs.map(d => ARROW[d]).join(' ');
}

/** The move list as data (sections of rows), for the overlay and the tests. */
export function moveList(opts: MoveListOptions = {}): MoveSection[] {
  const atk = opts.leftHanded ? 'left' : 'right';
  const def = opts.leftHanded ? 'right' : 'left';
  const punches: Strike[] = ['jab', 'cross', 'hookL', 'hookR', 'uppercut', 'bodyShot'];
  const strikeRow = (s: Strike, gesture: string, note = ''): MoveRow => ({
    name: MOVE_NAMES[s],
    gesture,
    key: keysFor(v => v.k === 'strike' && v.strike === s),
    power: powerPips(s),
    speed: speedPips(s),
    note,
  });
  const swipeDirs = (s: Strike) => DIRS.filter(d => OFFENCE_SWIPES[d] === s);
  const punchRows = punches.map(s => {
    if (s === 'jab') return strikeRow(s, 'Tap', 'Fastest: start every combo with it');
    const dirs = swipeDirs(s);
    const g = `Swipe ${arrows(dirs)}${s === 'bodyShot' ? ' (short)' : ''}`;
    const note = s === 'bodyShot' ? 'Tires them and lowers their stamina' : s === 'uppercut' ? 'Beats a slip' : MOVES[s].kind === 'hook' ? 'Beats a slip to the wrong side' : 'Long reach';
    return strikeRow(s, g, note);
  });
  const kickDirs = (k: Strike) => DIRS.filter(d => kickFor(d) === k);
  const kickRows = (['bodyKick', 'lowKick', 'headKick'] as Strike[]).map(k => {
    const g = k === 'bodyKick' ? 'Tap KICK' : `Swipe ${arrows(kickDirs(k).filter(d => d === 'U' || d === 'D'))} from KICK`;
    const note = k === 'lowKick' ? 'Goes under the guard; slows them down' : k === 'headKick' ? 'Slow but can end the fight' : 'Hard on the body, easy to see coming';
    return strikeRow(k, g, note);
  });
  const sig = opts.fighter?.signature ?? SIGNATURE_BY_ARCHETYPE[opts.fighter?.archetype ?? 'brawler'];
  const specialRow: MoveRow = {
    name: MOVE_NAMES[sig],
    gesture: 'SPECIAL button (meter full)',
    key: keysFor(v => v.k === 'special'),
    power: powerPips(sig),
    speed: speedPips(sig),
    note: 'Your fighter’s signature move',
  };
  const flickDirs = (e: 'left' | 'right' | 'back') => DIRS.filter(d => d !== 'F' && DEFENCE_FLICKS[d as Exclude<Dir8, 'F'>] === e);
  const beats = (e: 'left' | 'right' | 'back') =>
    (['jab', 'cross', 'hookL', 'hookR', 'uppercut'] as Strike[])
      .filter(m => evades(e, m))
      .map(m => MOVE_NAMES[m].toLowerCase())
      .join(', ');
  const defRow = (name: string, gesture: string, key: string, note: string): MoveRow => ({ name, gesture, key, power: 0, speed: 0, note });
  return [
    { title: 'Punches', sub: `Attack side (${atk} half of the screen)`, rows: punchRows },
    { title: 'Kicks', sub: 'KICK button, or two fingers at once on the attack side', rows: kickRows },
    { title: 'Special', sub: 'Fills as you land and defend', rows: [specialRow] },
    {
      title: 'Defence',
      sub: `Defence side (${def} half of the screen)`,
      rows: [
        defRow('Block', 'Hold', keysFor(v => v.k === 'block'), 'Stops punches and kicks; checks leg kicks; raise it late to parry'),
        defRow('Slip left', `Flick ${arrows(flickDirs('left'))}`, keysFor(v => v.k === 'evade' && v.evade === 'left'), `Dodges ${beats('left')}`),
        defRow('Slip right', `Flick ${arrows(flickDirs('right'))}`, keysFor(v => v.k === 'evade' && v.evade === 'right'), `Dodges ${beats('right')}`),
        defRow('Sway back', `Flick ${arrows(flickDirs('back'))}`, keysFor(v => v.k === 'evade' && v.evade === 'back'), 'Dodges head shots (not flying ones)'),
        defRow('Move', 'Drag the pad in the corner', keysFor(v => v.k === 'move'), 'Step in and out of range'),
      ],
    },
    {
      title: 'Takedowns',
      sub: 'Wrestling',
      rows: [
        defRow('Takedown', 'TAKEDOWN, or a long swipe ↓', keysFor(v => v.k === 'shoot'), 'Shoot from close range'),
        defRow('Sprawl', 'Swipe ↓ or TAKEDOWN as they shoot', keysFor(v => v.k === 'shoot'), 'Early is best'),
      ],
    },
    {
      title: 'Clinch',
      sub: 'Tie them up at close range; the same gestures become clinch strikes',
      rows: [
        defRow('Grab', 'Hold a finger still on the attack side', keysFor(v => v.k === 'clinch'), 'Only up close; a punch beats a grab'),
        { ...strikeRow('jab', 'Tap or swipe ↓', 'Wears down their body'), name: MOVE_NAMES.clinchKnee, power: powerPips('clinchKnee'), speed: speedPips('clinchKnee') },
        { ...strikeRow('headKick', 'Swipe ↑ from KICK', 'Big damage, slow'), name: MOVE_NAMES.clinchKneeHead, power: powerPips('clinchKneeHead'), speed: speedPips('clinchKneeHead') },
        { ...strikeRow('cross', `Swipe ${arrows(swipeDirs('cross'))} or a hook swipe`, 'Fast and sharp'), name: MOVE_NAMES.clinchElbow, power: powerPips('clinchElbow'), speed: speedPips('clinchElbow') },
        { ...strikeRow('uppercut', `Swipe ${arrows(swipeDirs('uppercut'))}`, 'The quickest shot in close'), name: MOVE_NAMES.clinchUpper, power: powerPips('clinchUpper'), speed: speedPips('clinchUpper') },
        defRow('Trip', 'TAKEDOWN, or a long swipe ↓ (in control)', keysFor(v => v.k === 'shoot'), 'Easier with them on the cage'),
        defRow('Break away / turn it', 'Flick on the defence side (held)', keysFor(v => v.k === 'evade'), 'Then flick the arrow shown before they do'),
        defRow('Let go', 'Step back with the pad (in control)', keysFor(v => v.k === 'move'), 'Breathe, then go again'),
      ],
    },
    {
      title: 'Ground',
      sub: 'Swipe anywhere; the arrow shown wins scrambles',
      rows: [
        defRow('Ground strike', 'Tap (on top)', groundKeys('tap'), 'Mount hits harder'),
        defRow('Pass to mount', 'Swipe ↑ in guard (on top)', groundKeys('up'), 'Then swipe the arrow first'),
        defRow('Submission', 'Swipe ↓ (on top, or armbar from guard underneath)', groundKeys('down'), 'Then tap fast to finish it'),
        defRow('Escape / get up', 'Swipe ↑ (underneath)', groundKeys('up'), 'Escape mount to guard, or stand up from guard'),
        defRow('Cover up', 'Hold the defence side (underneath)', groundKeys('block'), 'Blocks ground strikes'),
        defRow('Escape a hold', 'Tap fast anywhere', 'J / Space', 'Fill the bar before they do'),
      ],
    },
  ];
}

function groundKeys(k: 'tap' | 'block' | 'up' | 'down'): string {
  const out: string[] = [];
  for (const [code, v] of Object.entries(GROUND_KEYS)) {
    if (k === 'tap' || k === 'block' ? v.k === k : v.k === 'ground' && v.dir === k) out.push(keyName(code));
  }
  return out.slice(0, 2).join(' / ');
}

function pips(n: number, kind: string): string {
  if (n <= 0) return '';
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<i${i <= n ? ' class="on"' : ''}></i>`;
  return `<span class="pips ${kind}" title="${kind === 'p' ? 'Damage' : 'Speed'} ${n} of 5" aria-label="${kind === 'p' ? 'Damage' : 'Speed'} ${n} of 5">${s}</span>`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** The move list panel (a modal card). `keys` shows the keyboard column (a desktop with a mouse). */
export function buildMoveList(opts: MoveListOptions & { keys?: boolean }, onClose: () => void): HTMLElement {
  const back = document.createElement('div');
  back.className = 'modal-back movelist-back';
  const keys = opts.keys ?? false;
  const sections = moveList(opts)
    .map(
      sec => `<section><h3>${esc(sec.title)} <small>${esc(sec.sub)}</small></h3><table>
        ${sec.rows
          .map(
            r => `<tr><th>${esc(r.name)}</th><td class="g">${esc(r.gesture)}</td>${keys ? `<td class="k">${r.key ? `<kbd>${esc(r.key)}</kbd>` : ''}</td>` : ''}
              <td class="t">${pips(r.power, 'p')}${pips(r.speed, 's')}</td><td class="n">${esc(r.note)}</td></tr>`,
          )
          .join('')}
      </table></section>`,
    )
    .join('');
  back.innerHTML = `<div class="movelist panel" role="dialog" aria-label="Move list">
    <div class="ml-head"><h2>Move list</h2><span class="legend"><span class="pips p"><i class="on"></i></span> damage <span class="pips s"><i class="on"></i></span> speed</span><button class="btn ghost" data-a="close">Close</button></div>
    <div class="ml-body">${sections}</div></div>`;
  const close = () => {
    back.remove();
    onClose();
  };
  back.querySelector('[data-a=close]')?.addEventListener('click', close);
  back.addEventListener('click', e => {
    if (e.target === back) close();
  });
  // a touch on the list must never reach the fight's touch layer
  back.addEventListener('pointerdown', e => e.stopPropagation());
  return back;
}
