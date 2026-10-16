import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
p.on('pageerror', e => console.log('pageerror:', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
await p.goto('http://127.0.0.1:5173/');
await p.waitForFunction(() => window.__ckStarted === true, null, { timeout: 120000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/q/m_daily.png' });
const claim = await p.$('[data-a=claim]'); if (claim) await claim.click();
await p.waitForTimeout(4000);
await p.screenshot({ path: '/tmp/q/m_hub.png' });
for (const r of [{ s: 'career', div: 'mLight' }, { s: 'fighters' }, { s: 'fighter', id: 'owen-brennan' }, { s: 'packs' }, { s: 'shop' }, { s: 'season' }, { s: 'settings' }]) {
  await p.evaluate(r => window.cageKings.qaNav(r), r);
  await p.waitForTimeout(r.s === 'fighters' ? 9000 : 3500);
  await p.screenshot({ path: `/tmp/q/m_${r.s}.png` });
}
await p.evaluate(() => window.cageKings.qaReveal());
await p.waitForTimeout(5000);
await p.screenshot({ path: '/tmp/q/m_reveal.png' });
await b.close();
