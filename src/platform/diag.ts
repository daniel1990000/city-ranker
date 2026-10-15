import { installId, knownInstallId } from './telemetry';
/**
 * Diagnostics without an SDK: a small error log in localStorage, and a text report the player can copy or email
 * (Settings > Report a problem). It stays on the device until they choose to send it.
 */
import type { SaveData } from '../meta/save';
import { isNative } from './platform';

const KEY = 'cagekings.errors';

function load(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}

/** Add a line to the error log (kept: the last 20). */
export function logError(msg: string): void {
  try {
    const list = load();
    list.push(`${new Date().toISOString().slice(0, 19)} ${msg}`.slice(0, 400));
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* storage blocked */
  }
}

let installed = false;
export function installErrorLog(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => logError(`error: ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    logError(`rejection: ${r instanceof Error ? r.message : String(r)}`);
  });
}

export function recentErrors(): string[] {
  return load();
}

export interface DiagContext {
  version: string;
  quality: string;
  resScale: number;
  fps: number;
  p95: number;
  glInfo: string;
}

/** Extra report lines from other parts of the game (career position, roster size...). */
const sections: ((save: SaveData) => string[])[] = [];
export function addDiagnosticsSection(fn: (save: SaveData) => string[]): void {
  sections.push(fn);
}

export function buildDiagnostics(save: SaveData, c: DiagContext): string {
  const lines: string[] = [];
  lines.push(`Cage Kings v${c.version} (${isNative ? 'Android app' : 'web'})`);
  lines.push(`Device: ${navigator.userAgent}`);
  // shown after opting out too, so a player can still ask for the stats already sent to be deleted
  const id = save.settings.analytics ? installId() : knownInstallId();
  if (id) lines.push(`Install number (play stats): ${id}`);
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  lines.push(`Screen: ${innerWidth}x${innerHeight} @${(window.devicePixelRatio || 1).toFixed(2)}, cores ${navigator.hardwareConcurrency || '?'}, memory ${mem ?? '?'} GB`);
  lines.push(`Graphics: ${c.quality} (setting ${save.settings.quality}), render scale ${c.resScale.toFixed(2)}, ${c.fps.toFixed(0)} fps, frame p95 ${c.p95.toFixed(1)} ms, ${c.glInfo}`);
  lines.push(`Progress: ${save.fights} fights, ${save.wins} wins, cash ${save.cash}, gems ${save.gems}, season ${save.season.id || '-'} xp ${save.season.xp}`);
  for (const fn of sections) {
    try {
      lines.push(...fn(save));
    } catch {
      /* a broken section must not break the report */
    }
  }
  lines.push('');
  lines.push('Last fights (mode / opponent / result / method / seconds):');
  for (const f of save.fightLog.slice(-30)) lines.push(`  ${f.k} / ${f.o} / ${f.r} / ${f.m} / ${f.s}`);
  const errs = recentErrors();
  lines.push('');
  lines.push(errs.length ? 'Errors:' : 'Errors: none');
  for (const e of errs) lines.push('  ' + e);
  return lines.join('\n');
}
