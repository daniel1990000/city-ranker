import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:5173/');
await p.waitForFunction(() => window.__ckStarted === true, null, { timeout: 120000 });
const claim = await p.$('[data-a=claim]'); if (claim) await claim.click();
for (const r of [{ s: 'career', div: 'mLight' }, { s: 'fighters', div: 'wStraw' }]) {
  await p.evaluate(r => window.cageKings.qaNav(r), r);
  await p.waitForTimeout(14000);
  await p.screenshot({ path: `/tmp/q/m2_${r.s}.png` });
}
await b.close();
