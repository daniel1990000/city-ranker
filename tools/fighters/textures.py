# Copies and shrinks the CC0 MakeHuman textures the fighters use into public/assets/fighters/tex as WebP (alpha kept),
# and copies the bodies (fighter_m.glb, fighter_f.glb, fighters.json) next to them.
#   python3 tools/fighters/textures.py <sysassets dir> <build out dir> <public/assets/fighters>
import json, os, shutil, sys
from PIL import Image

SYS, BUILD, PUB = sys.argv[1:4]
TEX = os.path.join(PUB, 'tex')
os.makedirs(TEX, exist_ok=True)
manifest = json.load(open(os.path.join(BUILD, 'fighters.json')))


def find_png(folder, prefer=('diffuse',)):
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith('.png'))
    for p in prefer:
        for f in files:
            if p in f.lower():
                return os.path.join(folder, f)
    return os.path.join(folder, files[0]) if files else None


def save(src, name, size, quality=82):
    im = Image.open(src)
    alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
    im = im.convert('RGBA' if alpha else 'RGB')
    if max(im.size) > size:
        im = im.resize((size, size), Image.LANCZOS)
    out = os.path.join(TEX, name + '.webp')
    im.save(out, 'WEBP', quality=quality, method=6, lossless=False, alpha_quality=90)
    return os.path.getsize(out)


total = 0
for race in ('caucasian', 'african', 'asian'):
    for sex, word in (('m', 'male'), ('f', 'female')):
        total += save(find_png(os.path.join(SYS, 'skins', f'young_{race}_{word}')), f'skin_{race}_{sex}', 1024, 85)
hair = sorted(set(manifest['m']['hair']) | set(manifest['f']['hair']))
for h in hair:
    d = os.path.join(SYS, 'hair', h)
    total += save(find_png(d, ('diffuse',)), f'hair_{h}', 1024)
    n = [f for f in os.listdir(d) if 'normal' in f.lower()]
    if n:
        total += save(os.path.join(d, n[0]), f'hair_{h}_n', 512)
for b in sorted(set(manifest['m']['brows']) | set(manifest['f']['brows'])):
    total += save(find_png(os.path.join(SYS, 'eyebrows', b)), f'brow_{b}', 256)
for e in ('brown', 'brownlight', 'blue', 'green', 'grey', 'deepblue'):
    total += save(os.path.join(SYS, 'eyes', 'materials', f'{e}_eye.png'), f'eye_{e}', 256)
total += save(find_png(os.path.join(SYS, 'eyelashes', 'eyelashes01')), 'lashes', 256)
total += save(find_png(os.path.join(SYS, 'teeth', 'teeth_base')), 'teeth', 256)
shutil.copy(os.path.join(BUILD, 'fighters.json'), os.path.join(PUB, 'fighters.json'))
print('textures', round(total / 1024), 'KB')
