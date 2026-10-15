/**
 * Anonymous play stats and error reports, with no SDK.
 *
 * Off unless a key is set at build time (VITE_ANALYTICS_KEY), and off for every player until they say yes when the
 * game asks (Settings can switch it either way). Events go in small batches to a PostHog-compatible endpoint (free
 * tier: 1M events a month; EU hosting by default):
 *   VITE_ANALYTICS_KEY=phc_xxx VITE_ANALYTICS_HOST=https://eu.i.posthog.com npm run build
 * What is sent: a random install id (not tied to the player, the device or any ad id), the app version and platform,
 * and game events (fights, purchases started and their result, ads watched). Errors are sent as `$exception` events
 * so they show up in PostHog's error tracking. No names, emails, locations or device ids.
 */
import { isNative, platformName } from './platform';

const env = import.meta.env as Record<string, string | undefined>;
const KEY = env.VITE_ANALYTICS_KEY || '';
const HOST = (env.VITE_ANALYTICS_HOST || 'https://eu.i.posthog.com').replace(/\/+$/, '');
const ID_KEY = 'cagekings.did';
const MAX_QUEUE = 200;
const MAX_ERRORS = 8; // per session: one broken frame must not flood the quota

export type Props = Record<string, string | number | boolean | null | undefined>;
interface QueuedEvent {
  event: string;
  properties: Props;
  timestamp: string;
}

let enabled = false;
let base: Props = {};
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let errorsSent = 0;
const seenErrors = new Set<string>();
const session = Math.random().toString(36).slice(2, 12);

/** The install number if play stats were ever switched on (never creates one), for deletion requests. */
export function knownInstallId(): string | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}

/** The random install number sent with play stats (shown in problem reports so a player can ask for deletion). */
export function installId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).toString();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + session;
  }
}

/** Whether telemetry is built in at all (a key was set); the Settings switch and the question are only shown then. */
export function telemetryAvailable(): boolean {
  return KEY.length > 0;
}

export function initTelemetry(opts: { version: string; allowed: boolean }): void {
  // no IP-based location lookups: the privacy policy promises no location data
  base = { app_version: opts.version, platform: platformName, native: isNative, $lib: 'cagekings', $session_id: session, $geoip_disable: true };
  setTelemetryAllowed(opts.allowed);
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'rejection'));
}

/** Player switch (Settings). Turning it off drops anything still queued. */
export function setTelemetryAllowed(on: boolean): void {
  enabled = on && telemetryAvailable();
  if (!enabled) {
    queue = [];
    if (timer) clearInterval(timer);
    timer = null;
    return;
  }
  if (!timer) timer = setInterval(() => void flushTelemetry(), 30000);
}

/** Context added to every later event (division, fights, quality...). */
export function setTelemetryContext(p: Props): void {
  base = { ...base, ...p };
}

export function track(event: string, props: Props = {}): void {
  if (!enabled) return;
  queue.push({ event, properties: { ...base, ...props }, timestamp: new Date().toISOString() });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= 25) void flushTelemetry();
}

export function reportError(err: unknown, kind = 'error'): void {
  if (!enabled || errorsSent >= MAX_ERRORS) return;
  const e = err instanceof Error ? err : null;
  const message = String(e ? e.message : ((err as { message?: string } | null)?.message ?? err)).slice(0, 300);
  const type = e ? e.name : kind;
  if (seenErrors.has(type + message)) return;
  seenErrors.add(type + message);
  errorsSent++;
  track('$exception', {
    $exception_type: type,
    $exception_message: message,
    $exception_stack_trace_raw: e?.stack ? e.stack.slice(0, 2000) : undefined,
    $exception_level: 'error',
    kind,
  });
  void flushTelemetry();
}

/** Send what is queued. Safe to call often; quietly keeps the events if the network is down. */
export async function flushTelemetry(): Promise<void> {
  if (!enabled || !queue.length) return;
  const batch = queue.splice(0, queue.length);
  const distinct = installId();
  const body = JSON.stringify({ api_key: KEY, batch: batch.map((b) => ({ ...b, properties: { ...b.properties, distinct_id: distinct } })) });
  try {
    const res = await fetch(`${HOST}/batch/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 });
    if (!res.ok && res.status >= 500) queue.unshift(...batch.slice(-50));
  } catch {
    queue.unshift(...batch.slice(-50)); // offline: try again later
  }
}
