import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:5173/');
await p.waitForFunction(() => window.__ckStarted === true, null, { timeout: 120000 });
await p.click('[data-a=fight]');
await p.waitForTimeout(6000);
await p.evaluate(() => window.cageKings.qaSpeed(0.0001));
for (const [name, args] of [['guard', ['guard', 0]], ['mount', ['mount', 0]], ['armbar', ['guard', 1, 'armbar']], ['choke', ['guard', 0, 'choke']]]) {
  await p.evaluate(a => window.cageKings.qaGround(...a), args);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `/tmp/q/gr_${name}.png` });
}
await b.close();
