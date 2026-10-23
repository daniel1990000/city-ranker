import { freshClock, sanitizeClock, type ClockState } from './clock';
import { obj, num, int, str, bool, oneOf, strList, intSet, record, jsonSize } from './sanitize';
import { BUNDLES } from './products';
import { DIFFICULTY_LEVELS, type DifficultyLevel } from './difficulty';

/**
 * The save: everything the player has, as plain JSON in local storage (plus a native mirror on Android, a backup
 * copy, Play Games cloud save and a copyable save code).
 *
 * Rules that keep it safe:
 * - Every load goes through `sanitize`: a corrupt, old, hand-edited or crafted save always loads, with every value
 *   of the right type and range. Nothing outside it trusts the stored JSON.
 * - The schema has a version (`v`). A change to the stored shape bumps SAVE_VERSION and adds a step to MIGRATIONS,
 *   so saves from every earlier version keep working. A save code or cloud copy from a NEWER version is refused
 *   (the game says to update), never half-read.
 * - Paid things (No Ads, Starter Pack, fighter bundles, the Season Pass) come from Google Play, never from a save
 *   file: see meta/entitlements.ts `keepEntitlements`.
 *
 * Game content (roster, career, packs, training, gear...) keeps its data in `progress`, one slot per area, each with
 * its own sanitiser: see `ProgressSlots` and `registerProgressSlot` below.
 */
export const SAVE_VERSION = 1;

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type QualityTier = 'low' | 'medium' | 'high';

/** W win, L loss, D draw, N no contest. */
export type FightResult = 'W' | 'L' | 'D' | 'N';

/** One finished fight, kept for the diagnostics report (last 50). Short keys keep save codes small. */
export interface FightLogEntry {
  /** when (ms) */
  t: number;
  /** mode: career, daily, weekly, exhibition... */
  k: string;
  /** opponent fighter id */
  o: string;
  r: FightResult;
  /** how it ended: KO, TKO, SUB, DEC... */
  m: string;
  /** fight length in seconds */
  s: number;
}

export interface Settings {
  music: number;
  sfx: number;
  haptics: boolean;
  quality: QualitySetting;
  /** what the automatic graphics setting settled on for this phone (remembered between launches) */
  autoTier: { q: '' | QualityTier; res: number };
  /** swap the halves of the screen: attacks on the left, defence on the right */
  leftHanded: boolean;
  /** less camera shake, no flashes */
  reducedMotion: boolean;
  /** browser only: go full screen (and lock landscape) when a fight starts on a phone */
  autoFullscreen: boolean;
  /** opt-in local reminders (Android) */
  reminders: boolean;
  /** size of the on-screen fight controls: 0.85, 1 or 1.2 */
  controlScale: number;
  /** size of all text and menus: 1, 1.1 or 1.2 */
  textScale: number;
  /** send anonymous play stats and error reports (only when the build has an analytics key, and only if asked) */
  analytics: boolean;
  /** how good career and quick-fight opponents are, and what a win pays (meta/difficulty.ts) */
  difficulty: DifficultyLevel;
}

export interface Flags {
  tutorialDone: boolean;
  /** from Google Play: No Ads or the Starter Pack is owned */
  noAds: boolean;
  /** from Google Play: the Starter Pack is owned */
  starterPack: boolean;
  /** Play's in-app review card was requested once */
  ratePrompted: boolean;
  /** the player was asked whether to share play stats (analytics stays off until they say yes) */
  consentAsked: boolean;
  /** the one-time first_open analytics event was queued */
  firstOpen: boolean;
  /** the player was offered reminders (once) */
  remindAsked: boolean;
  /** first-launch frame-rate check done */
  benchDone: boolean;
}

/**
 * Extension point for game content. Each area declares its slot's type by declaration merging and registers a
 * sanitiser for it, at module load (top level), e.g. in src/meta/career.ts:
 *
 *   declare module './save' {
 *     interface ProgressSlots { career: CareerState }
 *   }
 *   registerProgressSlot('career', { fresh: freshCareer, sanitize: sanitizeCareer });
 *
 * Then `save.progress.career` is typed everywhere, a new player gets `fresh()`, and every load (local, cloud, save
 * code, older version) passes the stored value through `sanitize`. The slot owns its own versioning: keep a `v` in
 * the slot and migrate inside `sanitize`.
 */
export interface ProgressSlots {}

export interface ProgressSlot<T> {
  /** a new player's data */
  fresh(): T;
  /**
   * Turn whatever was stored (an older version, a crafted save code, junk, `undefined`) into valid data. Must not
   * throw, and must be idempotent: sanitize(sanitize(x)) equals sanitize(x).
   */
  sanitize(raw: unknown): T;
  /** largest JSON size kept for this slot (default 96 KB): beyond it the slot starts fresh */
  maxBytes?: number;
}

export interface SaveData {
  /** schema version, SAVE_VERSION after loading */
  v: number;
  savedAt: number;
  /** when this save was first created (ms) */
  firstAt: number;
  /** soft currency, earned by fighting */
  cash: number;
  /** premium currency: bought with gem bundles, also earned in small amounts */
  gems: number;
  /** cash ever received; only goes up (decides which of two copies holds more progress) */
  lifetimeCash: number;
  /** gems ever received, from play and purchases; only goes up */
  lifetimeGems: number;
  /** fights finished in any mode, and how many were won */
  fights: number;
  wins: number;
  /** achievement id -> when it was earned (ms); mirrored to Play Games achievements */
  achievements: Record<string, number>;
  /** this week's tournament record (meta/weekly.ts); the bracket itself is content's */
  weekly: { id: string; entries: number; best: number; claimed: number[] };
  /** this month's season: xp, claimed tiers per track, fight xp earned today (capped per day) */
  season: { id: string; xp: number; free: number[]; prem: number[]; day: number; dayXp: number };
  /** season id whose premium track is unlocked (the month's Season Pass, or the Starter Pack's month) */
  seasonPass: string;
  /** from Google Play: fixed-price fighter bundles owned (content unlocks their fighters while they are here) */
  paidBundles: string[];
  /** Play purchase tokens already granted (each pays out once), and what each recent one paid */
  iap: { tokens: string[]; paid: { t: string; g: number; c: number }[] };
  /** daily login streak (meta/daily.ts) */
  daily: { lastDay: number; streak: number };
  /** running timers on the reward clock (meta/timers.ts): ready-at time and length, by id */
  timers: Record<string, { at: number; len: number }>;
  settings: Settings;
  /** first-time hint cards already shown */
  hints: string[];
  flags: Flags;
  /** day the Starter Pack offer last popped up by itself (at most once a day) */
  offerDay: number;
  /** interstitial pacing (meta/adpacing.ts) */
  ads: { fightsSince: number; lastAt: number; playSec: number; sessions: number };
  /** the reward clock that a moved-back phone clock can't rewind (meta/clock.ts) */
  clock: ClockState;
  /** last 50 fights, for the diagnostics report */
  fightLog: FightLogEntry[];
  /** game content, one slot per area (see ProgressSlots) */
  progress: ProgressSlots;
}

const KEY = 'cagekings.save.v1';
const BACKUP = 'cagekings.save.v1.bak';

// ------------------------------------------------------------------ progress slots
const slots = new Map<string, ProgressSlot<unknown>>();
const SLOT_MAX = 96 * 1024;
/** data of a slot whose code is not loaded (yet): kept as it is, within these limits */
const UNKNOWN_SLOT_MAX = 32 * 1024;
const UNKNOWN_SLOTS = 16;

/** Register a content area's progress slot (see ProgressSlots). Registering a key twice is a programming error. */
export function registerProgressSlot<K extends keyof ProgressSlots & string>(key: K, slot: ProgressSlot<ProgressSlots[K]>): void {
  if (slots.has(key)) throw new Error(`progress slot '${key}' is registered twice`);
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) throw new Error(`progress slot key '${key}' is not a plain identifier`);
  slots.set(key, slot as ProgressSlot<unknown>);
}

/** Slot keys registered so far (for diagnostics and tests). */
export function progressSlotKeys(): string[] {
  return [...slots.keys()];
}

function sanitizeSlot(slot: ProgressSlot<unknown>, raw: unknown): unknown {
  try {
    if (raw !== undefined && jsonSize(raw) > (slot.maxBytes ?? SLOT_MAX)) return slot.fresh();
    return slot.sanitize(raw);
  } catch (e) {
    // a sanitiser bug must not cost the player their save: start this one slot fresh, and say so in the console
    console.warn('progress slot sanitiser failed', e);
    return slot.fresh();
  }
}

function sanitizeProgress(raw: unknown): ProgressSlots {
  const r = obj(raw);
  const out: Record<string, unknown> = {};
  for (const [key, slot] of slots) out[key] = sanitizeSlot(slot, r[key]);
  // slots from code that isn't registered yet keep their data, so nothing is lost if an area loads later
  let kept = 0;
  for (const [key, v] of Object.entries(r)) {
    if (slots.has(key) || kept >= UNKNOWN_SLOTS || !/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) continue;
    const size = jsonSize(v);
    if (size === 0 || size > UNKNOWN_SLOT_MAX) continue;
    out[key] = JSON.parse(JSON.stringify(v)) as unknown;
    kept++;
  }
  return out as unknown as ProgressSlots;
}

/**
 * Pass every registered slot through its sanitiser again (fills slots registered after this save was loaded).
 * Safe to call any time; the App calls it after loading or restoring a save.
 */
export function ensureProgress(save: SaveData): void {
  save.progress = sanitizeProgress(save.progress);
}

// ------------------------------------------------------------------ fresh and sanitise
export function freshSettings(): Settings {
  return {
    music: 0.7, sfx: 0.9, haptics: true, quality: 'auto', autoTier: { q: '', res: 1 }, leftHanded: false, reducedMotion: false,
    autoFullscreen: true, reminders: false, controlScale: 1, textScale: 1, analytics: false, difficulty: 'normal',
  };
}

export function freshSave(): SaveData {
  return {
    v: SAVE_VERSION,
    savedAt: 0,
    firstAt: 0,
    cash: 0,
    gems: 0,
    lifetimeCash: 0,
    lifetimeGems: 0,
    fights: 0,
    wins: 0,
    achievements: {},
    weekly: { id: '', entries: 0, best: 0, claimed: [] },
    season: { id: '', xp: 0, free: [], prem: [], day: -1, dayXp: 0 },
    seasonPass: '',
    paidBundles: [],
    iap: { tokens: [], paid: [] },
    daily: { lastDay: -1, streak: 0 },
    timers: {},
    settings: freshSettings(),
    hints: [],
    flags: { tutorialDone: false, noAds: false, starterPack: false, ratePrompted: false, consentAsked: false, firstOpen: false, remindAsked: false, benchDone: false },
    offerDay: -1,
    ads: { fightsSince: 0, lastAt: 0, playSec: 0, sessions: 0 },
    clock: freshClock(),
    fightLog: [],
    progress: sanitizeProgress({}),
  };
}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * MIGRATIONS[n] turns a version-n save into version n + 1. Never change a step that has shipped; add a new one and
 * bump SAVE_VERSION. Fields that only appear or disappear need no step: `sanitize` fills defaults and drops unknowns.
 * A step is for data that changes meaning or place (a renamed field, a unit change, a split).
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

/** Run the migration steps from version `from` up to `to`. Pure: exported for tests with their own table. */
export function runMigrations(raw: Record<string, unknown>, from: number, to: number, table: Readonly<Record<number, Migration>> = MIGRATIONS): Record<string, unknown> {
  let r = raw;
  for (let v = Math.max(1, from); v < to; v++) {
    const step = table[v];
    if (step) r = step(r);
  }
  return { ...r, v: to };
}

/** The schema version a stored save claims (saves written before versioning count as 1). */
function versionOf(raw: Record<string, unknown>): number {
  return int(raw.v, 1, 1, 1e6);
}

const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high'];
const TIERS: readonly ('' | QualityTier)[] = ['', 'low', 'medium', 'high'];
const RESULTS: readonly FightResult[] = ['W', 'L', 'D', 'N'];
const MAX_COUNT = 1e9;

/** Any stored value -> a valid save. Never throws. */
export function sanitize(input: unknown): SaveData {
  const base = freshSave();
  let raw = obj(input);
  raw = runMigrations(raw, versionOf(raw), Math.max(SAVE_VERSION, versionOf(raw)));
  const out = base;
  out.savedAt = num(raw.savedAt, 0, 0);
  out.firstAt = num(raw.firstAt, 0, 0);
  out.cash = int(raw.cash, 0, 0, MAX_COUNT);
  out.gems = int(raw.gems, 0, 0, MAX_COUNT);
  out.lifetimeCash = Math.max(out.cash, int(raw.lifetimeCash, 0, 0, Number.MAX_SAFE_INTEGER));
  out.lifetimeGems = Math.max(out.gems, int(raw.lifetimeGems, 0, 0, Number.MAX_SAFE_INTEGER));
  out.fights = int(raw.fights, 0, 0, MAX_COUNT);
  out.wins = Math.min(out.fights, int(raw.wins, 0, 0, MAX_COUNT));
  out.achievements = record(raw.achievements, (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined), 300, 40);

  const wk = obj(raw.weekly);
  out.weekly = { id: str(wk.id, '', 10), entries: int(wk.entries, 0, 0, MAX_COUNT), best: int(wk.best, 0, 0, MAX_COUNT), claimed: intSet(wk.claimed, 0, 99, 20) };
  const se = obj(raw.season);
  out.season = {
    id: str(se.id, '', 7),
    xp: int(se.xp, 0, 0, 1e7),
    free: intSet(se.free, 1, 100, 100),
    prem: intSet(se.prem, 1, 100, 100),
    day: int(se.day, -1, -1),
    dayXp: int(se.dayXp, 0, 0, 1e7),
  };
  out.seasonPass = /^\d{4}-\d{2}$/.test(str(raw.seasonPass, '', 7)) ? str(raw.seasonPass, '', 7) : '';
  out.paidBundles = strList(raw.paidBundles, 20, 40, (b) => (BUNDLES as readonly string[]).includes(b));

  const iap = obj(raw.iap);
  out.iap = {
    tokens: strList(iap.tokens, 100, 400),
    paid: (Array.isArray(iap.paid) ? iap.paid : [])
      .map((x) => obj(x))
      .filter((g) => typeof g.t === 'string' && g.t.length > 0 && g.t.length <= 400)
      .map((g) => ({ t: str(g.t, '', 400), g: int(g.g, 0, 0, 1e7), c: int(g.c, 0, 0, 1e9) }))
      .filter((g) => g.g > 0 || g.c > 0)
      .slice(-50),
  };
  const da = obj(raw.daily);
  out.daily = { lastDay: int(da.lastDay, -1, -1), streak: int(da.streak, 0, 0, 100000) };
  const yearMs = 366 * 86400000;
  out.timers = record(raw.timers, (v) => {
    const t = obj(v);
    const len = num(t.len, -1, 0, 30 * 86400000);
    const at = num(t.at, -1, 0, Date.now() + 2 * yearMs);
    return len >= 0 && at >= 0 ? { at, len } : undefined;
  }, 64, 40);

  const st = obj(raw.settings);
  const s = out.settings;
  s.music = num(st.music, s.music, 0, 1);
  s.sfx = num(st.sfx, s.sfx, 0, 1);
  s.haptics = bool(st.haptics, s.haptics);
  s.quality = oneOf(st.quality, QUALITIES, 'auto');
  const at = obj(st.autoTier);
  s.autoTier = { q: oneOf(at.q, TIERS, ''), res: num(at.res, 1, 0.5, 1) };
  s.leftHanded = bool(st.leftHanded, false);
  // first launch on a phone set to reduce motion: start with reduced motion on
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  s.reducedMotion = bool(st.reducedMotion, prefersReduced);
  s.autoFullscreen = bool(st.autoFullscreen, true);
  s.reminders = bool(st.reminders, false);
  s.controlScale = oneOf(st.controlScale, [0.85, 1, 1.2], 1);
  s.textScale = oneOf(st.textScale, [1, 1.1, 1.2], 1);
  // added after 0.3.0: no migration step, saves without it start on Normal (what every earlier version played)
  s.difficulty = oneOf(st.difficulty, DIFFICULTY_LEVELS, 'normal');

  const fl = obj(raw.flags);
  for (const k of Object.keys(out.flags) as (keyof Flags)[]) out.flags[k] = bool(fl[k], false);
  // play stats are opt-in: only a player who said yes when asked has them on
  s.analytics = bool(st.analytics, false) && out.flags.consentAsked;

  out.hints = strList(raw.hints, 60, 24);
  out.offerDay = int(raw.offerDay, -1, -1);
  const ad = obj(raw.ads);
  out.ads = { fightsSince: int(ad.fightsSince, 0, 0, MAX_COUNT), lastAt: num(ad.lastAt, 0, 0), playSec: num(ad.playSec, 0, 0, 1e9), sessions: int(ad.sessions, 0, 0, MAX_COUNT) };
  out.clock = sanitizeClock(raw.clock);
  out.fightLog = (Array.isArray(raw.fightLog) ? raw.fightLog : [])
    .slice(-50)
    .map((x) => obj(x))
    .map((e) => ({ t: num(e.t, 0, 0), k: str(e.k, '', 12), o: str(e.o, '', 40), r: oneOf(e.r, RESULTS, 'N'), m: str(e.m, '', 12), s: int(e.s, 0, 0, 3600) }));
  out.progress = sanitizeProgress(raw.progress);
  out.v = SAVE_VERSION;
  return out;
}

// ------------------------------------------------------------------ storage
export function loadSave(): SaveData {
  for (const key of [KEY, BACKUP]) {
    try {
      const txt = localStorage.getItem(key);
      if (txt) return sanitize(JSON.parse(txt));
    } catch {
      /* try the backup */
    }
  }
  return freshSave();
}

let writeFailed = false;
let onWriteFail: (() => void) | null = null;
let mirror: ((txt: string) => void) | null = null;

/** Called once when the save can't be written (storage full or blocked). */
export function onSaveWriteFail(fn: () => void): void {
  onWriteFail = fn;
}

/**
 * A second copy of every save (native key-value storage on Android, which reaches disk sooner than the WebView's
 * storage and survives a WebView storage reset). Wired up by platform/storage.ts.
 */
export function setSaveMirror(fn: (txt: string) => void): void {
  mirror = fn;
}

/** Parse a mirrored copy (same format as the main save). */
export function parseSave(txt: string | null): SaveData | null {
  if (!txt) return null;
  try {
    return sanitize(JSON.parse(txt));
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: SaveData | null = null;
const listeners: ((d: SaveData) => void)[] = [];

/** Hear every save written (cloud upload throttling, debug tools). */
export function onPersist(fn: (d: SaveData) => void): void {
  listeners.push(fn);
}

/** Queue a write (batched within 400 ms), or write now with `immediate` (purchases, before going to background). */
export function writeSave(data: SaveData, immediate = false): void {
  pending = data;
  if (immediate) return flush();
  if (!timer) timer = setTimeout(flush, 400);
}

export function flush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending) return;
  pending.savedAt = Date.now();
  const txt = JSON.stringify(pending);
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BACKUP, prev);
    localStorage.setItem(KEY, txt);
    writeFailed = false;
  } catch {
    // storage full or blocked: keep playing, and let the game tell the player once
    if (!writeFailed) onWriteFail?.();
    writeFailed = true;
  }
  mirror?.(txt);
  for (const fn of listeners) fn(pending);
  pending = null;
}

/** Wipe the stored save (Settings > Reset progress). The caller keeps entitlements and the clock (meta/entitlements.ts). */
export function resetSave(): SaveData {
  const d = freshSave();
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP);
  } catch {
    /* ignore */
  }
  return d;
}

// ------------------------------------------------------------------ save codes
const CODE_PREFIX = 'CK1.';
/** Longest save code accepted (a real save is a few KB; content slots are bounded too). */
const CODE_MAX = 512 * 1024;

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** FNV-1a over the code body: catches a truncated or mistyped paste and casual edits (not a security measure). */
function checksum(body: string): string {
  let h = 0x811c9dc5 ^ 0x4b43; // salted with "CK"
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A save as a text code: copy it, keep it, paste it on a new phone or after a reinstall. Also the cloud format. */
export function exportCode(d: SaveData): string {
  const body = toBase64(JSON.stringify(d));
  return `${CODE_PREFIX}${body}.${checksum(body)}`;
}

export type CodeResult = { ok: true; save: SaveData } | { ok: false; reason: 'invalid' | 'newer' };

/**
 * Read a save code. 'newer' means it was made by a newer version of the game (update first); 'invalid' means it is
 * not a complete Cage Kings save code (cut short, mistyped, or edited).
 */
export function readCode(code: string): CodeResult {
  if (typeof code !== 'string' || code.length > CODE_MAX * 2) return { ok: false, reason: 'invalid' };
  const t = code.replace(/\s+/g, '');
  if (!t.startsWith(CODE_PREFIX) || t.length > CODE_MAX * 1.4) return { ok: false, reason: 'invalid' };
  const dot = t.lastIndexOf('.');
  const body = t.slice(CODE_PREFIX.length, dot);
  if (dot <= CODE_PREFIX.length || t.slice(dot + 1) !== checksum(body)) return { ok: false, reason: 'invalid' };
  try {
    const raw = obj(JSON.parse(fromBase64(body)));
    if (typeof raw.v !== 'number' || !Number.isInteger(raw.v) || raw.v < 1) return { ok: false, reason: 'invalid' };
    if (raw.v > SAVE_VERSION) return { ok: false, reason: 'newer' };
    return { ok: true, save: sanitize(raw) };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/** Read a save code; null when it is not a usable Cage Kings save code. */
export function importCode(code: string): SaveData | null {
  const r = readCode(code);
  return r.ok ? r.save : null;
}
