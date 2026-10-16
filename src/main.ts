// Boot: styles, WebGL check, the App, the loading bar. (Platform services — ads, purchases, saves — are wired in
// app/services.ts once the menus need them.)
import './ui/styles.css';
import './ui/screens.css';
import { App } from './app';
import { startServices } from './app/services';

declare global {
  interface Window {
    __ckStarted?: boolean;
    __ckBootError?: boolean;
    cageKings?: App;
  }
}

function fail(msg: string): void {
  window.__ckBootError = true;
  const b = document.getElementById('boot');
  if (b) b.innerHTML = `<div class="logo">Cage <b>Kings</b></div><p style="text-align:center;max-width:26rem;color:#fff">${msg}</p>`;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    fail('This device cannot run the game (no WebGL 2). Update Android System WebView and Chrome from the Play Store.');
    return;
  }
  const bar = document.querySelector<HTMLElement>('#boot .boot-bar i');
  const app = new App(canvas, ui);
  if (import.meta.env.VITE_QA || import.meta.env.DEV) window.cageKings = app;
  await app.boot(p => {
    if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  });
  window.__ckStarted = true;
  document.getElementById('boot')?.classList.add('gone');
  void startServices(app.game, app.serviceHooks());
}

main().catch(e => {
  console.error(e);
  fail('Something went wrong while starting. Please restart the game.');
});
