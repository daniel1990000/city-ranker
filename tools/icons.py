# Cage Kings launcher icons and splash screens (Android): an original gold crown and "CK" on near-black.
#   python3 tools/icons.py            (writes into android/app/src/main/res and public/)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android/app/src/main/res')
FONT = '/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf'
BG = (11, 11, 15)
GOLD = (212, 166, 74)
GOLD2 = (243, 210, 122)


def crown(d: ImageDraw.ImageDraw, cx: float, cy: float, s: float, fill) -> None:
    pts = [(-1, 0.45), (-1.05, -0.45), (-0.55, -0.05), (-0.28, -0.62), (0, -0.12), (0.28, -0.62), (0.55, -0.05), (1.05, -0.45), (1, 0.45)]
    d.polygon([(cx + x * s, cy + y * s) for x, y in pts], fill=fill)
    d.rectangle([cx - s, cy + 0.55 * s, cx + s, cy + 0.73 * s], fill=fill)
    for x, y in [(-1.05, -0.53), (-0.28, -0.72), (0.28, -0.72), (1.05, -0.53)]:
        r = 0.1 * s
        d.ellipse([cx + x * s - r, cy + y * s - r, cx + x * s + r, cy + y * s + r], fill=fill)


def icon(size: int, round_: bool = False, foreground_only: bool = False) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0) if foreground_only else BG + (255,))
    d = ImageDraw.Draw(img)
    if not foreground_only:
        # a soft gold glow behind the mark
        glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([size * 0.18, size * 0.18, size * 0.82, size * 0.82], fill=(212, 166, 74, 70))
        img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(size * 0.08)))
        d = ImageDraw.Draw(img)
    # adaptive icons keep the art inside the middle 66 %
    k = 0.62 if foreground_only else 0.9
    crown(d, size / 2, size * (0.5 - 0.14 * k), size * 0.2 * k, GOLD2)
    font = ImageFont.truetype(FONT, int(size * 0.3 * k))
    d.text((size / 2, size * (0.5 + 0.18 * k)), 'CK', font=font, fill=(245, 245, 245), anchor='mm')
    if round_:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        img.putalpha(mask)
    return img


def splash(w: int, h: int) -> Image.Image:
    img = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(img)
    s = min(w, h)
    crown(d, w / 2, h / 2 - s * 0.16, s * 0.1, GOLD2)
    font = ImageFont.truetype(FONT, int(s * 0.11))
    d.text((w / 2 - s * 0.02, h / 2 + s * 0.06), 'CAGE ', font=font, fill=(245, 245, 245), anchor='rm')
    d.text((w / 2 - s * 0.02, h / 2 + s * 0.06), 'KINGS', font=font, fill=GOLD, anchor='lm')
    return img


DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for name, k in DENS.items():
    d = os.path.join(RES, f'mipmap-{name}')
    os.makedirs(d, exist_ok=True)
    icon(int(48 * k)).save(os.path.join(d, 'ic_launcher.png'))
    icon(int(48 * k), round_=True).save(os.path.join(d, 'ic_launcher_round.png'))
    icon(int(108 * k), foreground_only=True).save(os.path.join(d, 'ic_launcher_foreground.png'))
    Image.new('RGB', (int(108 * k), int(108 * k)), BG).save(os.path.join(d, 'ic_launcher_background.png'))
for folder in os.listdir(RES):
    p = os.path.join(RES, folder, 'splash.png')
    if os.path.exists(p):
        w, h = Image.open(p).size
        splash(w, h).save(p)
pub = os.path.join(ROOT, 'public')
os.makedirs(os.path.join(pub, 'icons'), exist_ok=True)
icon(512).save(os.path.join(pub, 'icons', 'icon-512.png'))
icon(192).save(os.path.join(pub, 'icons', 'icon-192.png'))
icon(64).save(os.path.join(pub, 'favicon.png'))
splash(1024, 500).save(os.path.join(ROOT, 'docs', 'feature-graphic.png'))
print('icons and splashes written')
