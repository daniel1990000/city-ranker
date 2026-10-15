import { applyTuning } from '../meta/tuning';

/**
 * Remote tuning: a small JSON file the owner hosts (next to privacy.html on their website) changes ad pacing, gem and
 * pack sizes, season pacing and the paid-pack country list without an app update. See docs/REMOTE-TUNING.md.
 * The last good copy is cached, applied at the next launch, and refreshed in the background; every value is
 * range-checked in meta/tuning.ts. No URL configured = built-in defaults only.
 */
const URL_ = (import.meta.env as Record<string, string | undefined>).VITE_REMOTE_CONFIG_URL || '';
const CACHE = 'cagekings.tuning';

export function initRemoteTuning(): void {
  try {
    const cached = localStorage.getItem(CACHE);
    if (cached) applyTuning(JSON.parse(cached));
  } catch {
    /* ignore a broken cache */
  }
  if (!URL_) return;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  fetch(URL_, { cache: 'no-cache', signal: ctl.signal })
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
    .then((json) => {
      if (!json || typeof json !== 'object') return;
      applyTuning(json);
      try {
        const txt = JSON.stringify(json);
        if (txt.length <= 20000) localStorage.setItem(CACHE, txt);
      } catch {
        /* ignore */
      }
    })
    .catch(() => {})
    .finally(() => clearTimeout(timer));
}
