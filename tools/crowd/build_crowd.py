# Renders the arena crowd: varied CC0 MakeHuman spectators (skin, build, age, hair, casual clothes recoloured),
# standing / cheering / seated, into one sprite atlas the game's instanced crowd billboards sample.
#
#   tools/crowd/build.sh            (runs Blender headless with the MPFB add-on set up by tools/fighters/build.sh)
#   blender -b --python tools/crowd/build_crowd.py -- <out dir> [count] [only-index]
#
# Output: <out>/cell_<i>.png (one per atlas cell, transparent), assembled by build.sh into
# public/assets/crowd/crowd.webp (8 x 4 cells of 128 x 256: top two rows standing, bottom two seated).

import bpy, os, sys, math, random
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
COUNT = int(argv[1]) if len(argv) > 1 else 32
ONLY = int(argv[2]) if len(argv) > 2 else -1
os.makedirs(OUT, exist_ok=True)
DATA = LocationService.get_user_data()

HAIR = {'m': ['short01', 'short03', 'short04', 'afro01', None, None], 'f': ['ponytail01', 'bob01', 'long01', 'braid01', 'afro01']}
BROWS = {'m': ['eyebrow001', 'eyebrow004', 'eyebrow007'], 'f': ['eyebrow002', 'eyebrow005', 'eyebrow010']}
SUITS = {'m': ['male_casualsuit01', 'male_casualsuit02', 'male_casualsuit03', 'male_casualsuit04', 'male_casualsuit05', 'male_casualsuit06'], 'f': ['female_casualsuit01', 'female_casualsuit02', 'female_sportsuit01']}
RACES = ['caucasian', 'african', 'asian']


def asset_file(kind, name, ext=('.mhclo', '.proxy')):
    d = os.path.join(DATA, kind, name)
    for f in sorted(os.listdir(d)):
        if f.endswith(ext):
            return os.path.join(d, f)
    raise IOError(d)


def skin_file(age, race, sex):
    a = 'young' if age < 0.45 else 'middleage' if age < 0.7 else 'old'
    name = f"{a}_{race}_{'male' if sex == 'm' else 'female'}"
    return asset_file('skins', name, ('.mhmat',))


def recolor(obj, hue, sat, val):
    """Shift the hue of an object's base colour texture (one set of clothes, many shirts)."""
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf or not bsdf.inputs['Base Color'].links:
            continue
        link = bsdf.inputs['Base Color'].links[0]
        hs = nt.nodes.new('ShaderNodeHueSaturation')
        hs.inputs['Hue'].default_value = hue
        hs.inputs['Saturation'].default_value = sat
        hs.inputs['Value'].default_value = val
        nt.links.new(link.from_socket, hs.inputs['Color'])
        nt.links.new(hs.outputs['Color'], bsdf.inputs['Base Color'])


def pose(rig, kind, rnd):
    """kind: stand | cheer | clap | seated | seated_cheer. Rotations in each bone's local space (game_engine rig)."""
    pb = rig.pose.bones
    for b in pb:
        b.rotation_mode = 'XYZ'
    def rot(name, x=0, y=0, z=0):
        if name in pb:
            pb[name].rotation_euler = (math.radians(x), math.radians(y), math.radians(z))
    seated = kind.startswith('seated')
    # the rest pose is an A-pose (arms ~45 degrees down); +z raises the left arm, +x swings an arm or leg forward
    for s, sg in (('l', 1), ('r', -1)):
        if kind == 'cheer' or kind == 'seated_cheer' or (kind == 'point' and s == 'r'):
            rot(f'upperarm_{s}', rnd.uniform(-10, 15), 0, sg * rnd.uniform(105, 135))
            rot(f'lowerarm_{s}', 0, 0, sg * rnd.uniform(10, 45))
        else:
            rot(f'upperarm_{s}', rnd.uniform(-5, 12), 0, sg * -rnd.uniform(32, 40))
            rot(f'lowerarm_{s}', rnd.uniform(0, 25), 0, 0)
    rot('head', rnd.uniform(-8, 6), rnd.uniform(-12, 12), 0)


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = 256
    sc.render.resolution_y = 512
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.35, 0.38, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    # arena light: a big key from above and in front (the cage lights), a little rim from behind
    for name, loc, rotx, energy in (('key', (0, -4, 6), 40, 5.0), ('rim', (0, 4, 4), -40, 2.0)):
        d = bpy.data.lights.new(name, 'SUN')
        d.energy = energy
        d.angle = math.radians(20)
        o = bpy.data.objects.new(name, d)
        o.rotation_euler = (math.radians(rotx), 0, 0)
        sc.collection.objects.link(o)
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.05
    co = bpy.data.objects.new('cam', cam)
    co.location = (0, -6, 1.02)
    co.rotation_euler = (math.radians(88), 0, 0)
    sc.collection.objects.link(co)
    sc.camera = co


def build(i):
    rnd = random.Random(1000 + i)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sex = 'm' if rnd.random() < 0.62 else 'f'
    race = rnd.choice(RACES)
    age = rnd.uniform(0.3, 0.85)
    macro = TargetService.get_default_macro_info_dict()
    macro.update(dict(gender=1.0 if sex == 'm' else 0.0, age=age, muscle=rnd.uniform(0.3, 0.65), weight=rnd.uniform(0.3, 0.95), height=rnd.uniform(0.35, 0.7), proportions=0.5))
    macro['race'] = {r: (1.0 if r == race else 0.0) for r in RACES}
    bm = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    rig = HumanService.add_builtin_rig(bm, 'game_engine')
    HumanService.set_character_skin(skin_file(age, race, sex), bm, skin_type='MAKESKIN')
    HumanService.add_mhclo_asset(asset_file('eyes', 'high-poly'), bm, asset_type='Eyes', subdiv_levels=0, material_type='MAKESKIN')
    HumanService.add_mhclo_asset(asset_file('eyebrows', rnd.choice(BROWS[sex])), bm, asset_type='Eyebrows', subdiv_levels=0, material_type='MAKESKIN')
    hair = rnd.choice(HAIR[sex])
    if hair:
        HumanService.add_mhclo_asset(asset_file('hair', hair), bm, asset_type='Hair', subdiv_levels=0, material_type='MAKESKIN')
    suit = HumanService.add_mhclo_asset(asset_file('clothes', rnd.choice(SUITS[sex])), bm, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
    recolor(suit, rnd.random(), rnd.uniform(0.6, 1.3), rnd.uniform(0.55, 1.15))
    HumanService.add_mhclo_asset(asset_file('clothes', rnd.choice(['shoes01', 'shoes02', 'shoes03', 'shoes05'])), bm, asset_type='Clothes', subdiv_levels=0, material_type='MAKESKIN')
    # half the cells stand (rows 0-1), half sit (rows 2-3); a third of each cheer
    seated = i >= COUNT // 2
    k = rnd.random()
    kind = ('seated_cheer' if k < 0.3 else 'seated') if seated else ('cheer' if k < 0.35 else 'point' if k < 0.5 else 'stand')
    pose(rig, kind, rnd)
    if seated:
        # seated rows show from the seat backs up: frame the upper body (the legs fall below the cell)
        rig.location.z -= 0.62
    rig.rotation_euler = (0, 0, math.radians(rnd.uniform(-12, 12)))
    setup_scene()
    bpy.context.scene.render.filepath = os.path.join(OUT, f'cell_{i:02d}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', i, sex, race, round(age, 2), kind)


for i in range(COUNT):
    if ONLY < 0 or i == ONLY:
        build(i)
