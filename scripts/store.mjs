// Play Store screenshots from the real game (1920x1080 landscape) into docs/store/.
// Run a dev server first (npx vite --port 5173 --host 127.0.0.1), then: node scripts/store.mjs
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.OUT ?? 'docs/store';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('page error', e.message));
const wait = ms => p.waitForTimeout(ms);
const shot = async name => {
  await p.screenshot({ path: `${OUT}/${name}.png` });
  console.log('saved', name);
};
const clearModals = () => p.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));

await p.goto(URL);
await p.waitForFunction(() => window.cageKings, null, { timeout: 90000 });
await wait(2500);
// a player a few days in: some cash, gems and fighters, so the menus look lived in
await p.evaluate(() => {
  const k = window.cageKings;
  const s = k.game.save;
  s.cash = 18450;
  s.gems = 240;
  s.flags.tutorialDone = true;
  s.fights = 6;
  s.wins = 5;
  for (let i = 0; i < 4; i++) k.qaReveal();
  k.game.persist(true);
});
await clearModals();
await p.evaluate(() => document.querySelectorAll('.reveal').forEach(m => m.remove()));
await p.evaluate(() => window.cageKings.qaNav({ s: 'hub' }));
await wait(1500);
await shot('2-home');

await p.evaluate(() => window.cageKings.qaNav({ s: 'career', div: 'mLight' }));
await wait(2500);
await shot('4-career');

await p.evaluate(() => window.cageKings.qaNav({ s: 'packs' }));
await wait(800);
await p.evaluate(() => {
  window.cageKings.game.save.progress.packs.unopened.standard++;
  window.cageKings.qaReveal();
});
await wait(4000);
await shot('5-pack');
await p.evaluate(() => document.querySelectorAll('.reveal, .modal-back').forEach(m => m.remove()));

// a fight: let the AI play both sides and take frames mid-exchange
await p.evaluate(() => window.cageKings.qaNav({ s: 'career', div: 'mLight' }));
await wait(1000);
await p.evaluate(() => window.cageKings.qaAutoplay(true));
await p.click('[data-a=fight]');
await p.waitForFunction(() => window.cageKings.debugState().fight?.phase === 'fight', null, { timeout: 120000 });
await p.evaluate(() => window.cageKings.qaSpeed(3));
let n = 0;
for (let i = 0; i < 40 && n < 2; i++) {
  await wait(1200);
  const busy = await p.evaluate(() => {
    const f = window.cageKings.debugState().fight;
    return f.fighters.some(x => /jab|cross|hook|upper|Kick|body|superman|knee/i.test(x.action));
  });
  if (busy) {
    await p.evaluate(() => window.cageKings.qaSpeed(0.0001));
    await wait(400);
    await shot(`1-fight-${++n}`);
    await p.evaluate(() => window.cageKings.qaSpeed(3));
  }
}
// the Play Store feature graphic (1024x500): a clean fight frame with the name over it
await p.setViewportSize({ width: 1024, height: 500 });
await p.evaluate(() => {
  const st = document.createElement('style');
  st.id = 'feature-css';
  st.textContent = '.hud,.touch,.coach{display:none!important}';
  document.head.appendChild(st);
  const t = document.createElement('div');
  t.id = 'feature-title';
  t.innerHTML = '<div style="font-family:Oswald,sans-serif;font-weight:700;font-size:96px;letter-spacing:.02em;line-height:.95;color:#fff;text-shadow:0 4px 24px rgba(0,0,0,.8)">CAGE<br><span style="color:#d4a640">KINGS</span></div><div style="font-family:Inter,sans-serif;font-size:22px;color:#e8e8e8;margin-top:8px;text-shadow:0 2px 10px rgba(0,0,0,.9)">Fight your way to the belt</div>';
  t.style.cssText = 'position:fixed;inset:0;z-index:99;pointer-events:none;padding:96px 0 0 48px;background:linear-gradient(90deg,rgba(0,0,0,.82) 0%,rgba(0,0,0,.5) 26%,rgba(0,0,0,0) 46%)';
  document.body.appendChild(t);
  window.cageKings.qaSpeed(3);
});
for (let i = 0; i < 30; i++) {
  await wait(1200);
  const busy = await p.evaluate(() => window.cageKings.debugState().fight.fighters.some(x => /cross|hook|Kick|superman|knee/i.test(x.action)));
  if (busy) break;
}
await p.evaluate(() => window.cageKings.qaSpeed(0.0001));
await wait(800);
await p.screenshot({ path: 'docs/feature-graphic.png', scale: 'css' }); // exactly 1024x500, as Play asks
console.log('saved feature-graphic');
await p.evaluate(() => {
  document.getElementById('feature-css')?.remove();
  document.getElementById('feature-title')?.remove();
});
await p.setViewportSize({ width: 960, height: 540 });
await wait(1000);
await p.evaluate(() => {
  window.cageKings.qaGround('mount', 0);
  window.cageKings.qaSpeed(0.0001);
});
await wait(2500);
await shot('3-ground');
await b.close();
