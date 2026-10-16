// Load the game, shoot the title, start a quick fight, play a few seconds with keys, shoot again.
import { chromium } from 'playwright';
const [out = '/tmp/q/game', w = 844, h = 390] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('pageerror', e => console.log('pageerror:', e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 200)); });
await p.goto('http://127.0.0.1:5173/');
await p.waitForFunction(() => window.__ckStarted === true, null, { timeout: 120000 });
await p.evaluate(() => window.cageKings.qaSpeed(5));
await p.waitForTimeout(3000);
await p.screenshot({ path: `${out}_title.png` });
await p.click('[data-a=fight]');
await p.waitForTimeout(9000);
await p.screenshot({ path: `${out}_fight1.png` });
for (let i = 0; i < 10; i++) { await p.keyboard.press('KeyD'); await p.keyboard.press('KeyJ'); await p.waitForTimeout(120); await p.keyboard.press('KeyK'); await p.waitForTimeout(200); }
await p.screenshot({ path: `${out}_fight2.png` });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}_fight3.png` });
await b.close();
