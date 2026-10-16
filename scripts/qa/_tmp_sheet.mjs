// contact sheet: node scripts/qa/_tmp_sheet.mjs out.png "jab@0.42,cross@0.45,..." [query]
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
const [out, list, q = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 360, height: 360 } });
p.on('pageerror', e => console.log('pageerror:', e.message));
await p.goto('http://127.0.0.1:5173/lab.html?single&' + q);
await p.waitForFunction(() => window.labReady === true, null, { timeout: 60000 });
const files = [];
for (const item of list.split(',')) {
  const [a, u] = item.split('@');
  await p.evaluate(([a, u]) => window.labSet(a, Number(u ?? 0.5)), [a, u]);
  await p.waitForTimeout(250);
  const f = `/tmp/q/_c_${files.length}.png`;
  await p.screenshot({ path: f });
  files.push([f, item]);
}
await b.close();
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
items = ${JSON.stringify(files)}
cols = 6
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (cols * 240, rows * 240))
for i, (f, label) in enumerate(items):
    im = Image.open(f).resize((240, 240))
    ImageDraw.Draw(im).text((6, 6), label, fill=(255, 220, 120))
    sheet.paste(im, ((i % cols) * 240, (i // cols) * 240))
sheet.save('${out}')
`]);
