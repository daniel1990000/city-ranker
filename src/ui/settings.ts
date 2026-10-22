// The settings panel: sound, controls, graphics, privacy, purchases and the save code.
import type { Game } from '../app/game';
import { exportCode, importCode } from '../meta/save';
import { isNative, openExternal, setHaptics } from '../platform/platform';
import { requestReminderPermission } from '../platform/notify';
import { adChoicesRequired, showAdChoices } from '../platform/ads';
import { setTelemetryAllowed } from '../platform/telemetry';
import { CONFIG } from '../platform/config';


export function buildSettings(game: Game, toast: (m: string) => void): HTMLElement {
  const s = game.save.settings;
  const wrap = document.createElement('div');
  const row = (label: string, control: HTMLElement) => {
    const r = document.createElement('div');
    r.className = 'setrow';
    const l = document.createElement('span');
    l.textContent = label;
    r.append(l, control);
    wrap.appendChild(r);
  };
  const slider = (v: number, set: (x: number) => void) => {
    const i = document.createElement('input');
    i.type = 'range';
    i.min = '0';
    i.max = '1';
    i.step = '0.05';
    i.value = String(v);
    i.addEventListener('input', () => {
      set(Number(i.value));
      game.persist();
    });
    return i;
  };
  const toggle = (v: boolean, set: (x: boolean) => void) => {
    const b = document.createElement('button');
    b.className = `toggle${v ? ' on' : ''}`;
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(v));
    b.addEventListener('click', () => {
      const nv = !b.classList.contains('on');
      b.classList.toggle('on', nv);
      b.setAttribute('aria-checked', String(nv));
      set(nv);
      game.persist();
    });
    return b;
  };
  const button = (label: string, fn: () => void, ghost = true) => {
    const b = document.createElement('button');
    b.className = `btn${ghost ? ' ghost' : ''}`;
    b.style.cssText = 'padding:6px 14px;font-size:13px';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  row('Music', slider(s.music, x => (s.music = x)));
  row('Sound effects', slider(s.sfx, x => (s.sfx = x)));
  row('Vibration', toggle(s.haptics, x => {
    s.haptics = x;
    setHaptics(x);
  }));
  if (isNative)
    row('Reminders (free pack ready, training finished)', toggle(s.reminders, x => {
      s.reminders = x;
      if (x)
        void requestReminderPermission().then(ok => {
          if (ok) return;
          s.reminders = false;
          game.persist();
          toast('Notifications are off for Cage Kings in your phone settings');
        });
    }));
  row('Left-handed controls (attack on the left)', toggle(s.leftHanded, x => (s.leftHanded = x)));
  row('Reduced motion (less shake, no flashes)', toggle(s.reducedMotion, x => (s.reducedMotion = x)));
  row('Commentary captions in fights', toggle(s.commentary, x => (s.commentary = x)));
  const q = document.createElement('select');
  for (const o of ['auto', 'low', 'medium', 'high']) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o[0].toUpperCase() + o.slice(1);
    q.appendChild(opt);
  }
  q.value = s.quality;
  q.addEventListener('change', () => {
    s.quality = q.value as typeof s.quality;
    game.persist();
    toast('Graphics change applies from the next fight');
  });
  row('Graphics', q);
  row('Share anonymous play stats', toggle(s.analytics, x => {
    s.analytics = x;
    setTelemetryAllowed(x);
  }));
  // where the consent rules apply (EEA, UK, Switzerland, some US states), a way back to the ad consent choices
  if (adChoicesRequired()) row('Ads and privacy', button('Privacy options', () => void showAdChoices().then(ok => ok || toast('Could not open the privacy options'))));
  row('Purchases', button('Restore purchases', () => void game.syncPurchases().then(r => toast(r ? 'Purchases restored' : 'Could not reach Google Play'))));
  row('Save code (move your progress by hand)', button('Copy', () => {
    const code = exportCode(game.save);
    void navigator.clipboard?.writeText(code).then(() => toast('Save code copied'), () => toast('Could not copy'));
  }));
  row('Load a save code', button('Paste', () => {
    const code = prompt('Paste your save code');
    if (!code) return;
    const next = importCode(code.trim());
    if (!next) {
      toast('That code is not valid (or comes from a newer version)');
      return;
    }
    game.replaceSave(next, false);
    toast('Progress loaded');
  }));
  row('Privacy policy', button('Open', () => openExternal(CONFIG.privacyUrl)));
  const ver = document.createElement('div');
  ver.className = 'muted';
  ver.style.cssText = 'font-size:11px;margin-top:10px';
  ver.textContent = `Cage Kings ${__APP_VERSION__}`;
  wrap.appendChild(ver);
  return wrap;
}
