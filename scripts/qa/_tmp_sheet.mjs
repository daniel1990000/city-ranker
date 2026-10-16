import { chromium } from 'playwright';
const acts = (process.env.ACTS ?? 'idle jab cross hookL hookR uppercut bodyShot lowKick bodyKick headKick superman flyingKnee spinBackfist block blockHit slipL slipR swayBack hitHeadL hitHeadHeavy hitBody stunned knockdown shoot sprawl taunt victory walkout').split(' ');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 300, height: 300 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:5173/lab.html?single&nopole&seed=' + (process.env.SEED ?? 5) + (process.env.SEX ? '&sex=' + process.env.SEX : ''));
await p.waitForFunction(() => window.labReady, null, { timeout: 90000 });
await p.evaluate(() => window.labCam([1.6, 1.5, 2.6], [0.3, 1.0, 0]));
for (const a of acts) {
  await p.evaluate(a => { const c = window.labClip?.(a); window.labSet(a, c ?? 0.5); }, a);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${process.env.SHOT}/s-${a}.png` });
}
await b.close();
console.log(acts.join(' '));
