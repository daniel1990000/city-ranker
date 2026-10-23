// The intent frame: the ONE currency between controllers (human devices, AI brains, scripted opponents, replays) and the sim
// (docs/14 §2, docs/17 §1.3). A frame is what a fighter "wants" this tick. Frames are plain data so they serialise into replay logs.

/**
 * @typedef {object} Intent
 * @property {{x:number,y:number}} move  desired movement in WORLD space, |v| <= 1
 * @property {'none'|'high'|'low'} guard  held guard height
 * @property {null|{limb:string,side:string,slot:string,target:string,power?:string,chargeTicks?:number}} strike
 * @property {boolean} parry @property {boolean} slip @property {boolean} catch @property {boolean} feint @property {boolean} switchStance
 * @property {null|{type?:string}} clinch  try to clinch (type optional: over_under|double_under|single_collar|thai)
 * @property {null|{dir:'fwd'|'bwd',size:'major'|'minor'}} takedown  start a stand-up shot
 * @property {null|object} grapple  paired-state action: {kind:'strike'|'pummel'|'takedown'|'break'|'transition'|'escape'|'getup'|
 *   'submission'|'cover'|'posture'|'turtle'|'sprawl'|'followUp'|'release', ...}
 * @property {null|{buttons?:boolean[],end?:boolean,mash?:number,tap?:boolean,noTap?:boolean}} prompt  minigame / recovery input
 * @property {null|{slot:number,result?:'fail'|'success'|'perfect'|'none'}} ability  press an ability card (docs/15)
 */
export function emptyIntent() {
  return { move: { x: 0, y: 0 }, guard: 'none', strike: null, parry: false, slip: false, catch: false, feint: false, switchStance: false, clinch: null, takedown: null, grapple: null, prompt: null, ability: null };
}

/** Copy only the fields that differ from the empty frame (compact replay storage). */
export function compactIntent(i) {
  const o = {};
  if (i.move.x !== 0 || i.move.y !== 0) o.move = { x: round3(i.move.x), y: round3(i.move.y) };
  if (i.guard !== 'none') o.guard = i.guard;
  if (i.strike) o.strike = { ...i.strike };
  for (const k of ['parry', 'slip', 'catch', 'feint', 'switchStance']) if (i[k]) o[k] = true;
  if (i.clinch) o.clinch = { ...i.clinch };
  if (i.takedown) o.takedown = { ...i.takedown };
  if (i.grapple) o.grapple = { ...i.grapple };
  if (i.prompt) o.prompt = { ...i.prompt, ...(i.prompt.buttons ? { buttons: [...i.prompt.buttons] } : {}) };
  if (i.ability) o.ability = { ...i.ability };
  return o;
}

/** Inverse of compactIntent. */
export function expandIntent(o = {}) {
  return { ...emptyIntent(), ...o, move: o.move ? { ...o.move } : { x: 0, y: 0 } };
}

export const MOVE_DIRECTIONS = 16;
export const MOVE_LEVELS = [0, 0.4, 0.75, 1];

/**
 * Snap a movement vector to 16 directions × 3 magnitudes (+ zero). This is what keeps replay logs small — a held stick
 * produces the same frame for many ticks — and 22.5° / 3 speeds is plenty for footwork. Both humans and AI go through it.
 */
export function quantizeMove(v) {
  const m = Math.hypot(v.x, v.y);
  if (m < 0.12) return { x: 0, y: 0 };
  const level = m > 0.88 ? 1 : m > 0.57 ? 0.75 : 0.4;
  const step = (2 * Math.PI) / MOVE_DIRECTIONS, a = Math.round(Math.atan2(v.y, v.x) / step) * step;
  return { x: round3(Math.cos(a) * level), y: round3(Math.sin(a) * level) };
}

/** Quantise the analogue parts of a frame so a recorded fight re-simulates bit-identically and compresses well. */
export function quantizeIntent(i) {
  return { ...i, move: quantizeMove(i.move) };
}

export const isIdle = (i) => {
  const c = compactIntent(i);
  return Object.keys(c).length === 0;
};

const round3 = (n) => Math.round(n * 1000) / 1000;
