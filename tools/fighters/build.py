# Builds the game-ready fighter bodies from MPFB (MakeHuman for Blender) CC0 assets.
#
#   blender -b --python tools/fighters/build.py -- <out dir>
#   (run through tools/fighters/build.sh, which sets up Blender's user folder with MPFB and the asset pack)
#
# For each sex it builds ONE base fighter (game_engine rig, the CC0 game-weight "muscle" proxy body, high-poly
# eyes, lashes, every brow and hair style) plus "variant" fighters with other builds, ethnic facial structure and
# face shapes. The variants share the base's topology, so their vertex positions become morph targets (shape keys)
# on the base: at runtime one mesh + a few morph weights gives a different-looking fighter. Shorts, fingerless MMA
# gloves and (women) a sports top are cut from the body itself and carry the same morphs, so they always fit.
# Output: fighter_m.glb, fighter_f.glb (no images: textures ship separately, see textures.py) and fighters.json.

import bpy, bmesh, os, sys, json, math
from mathutils import Vector
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
DATA = LocationService.get_user_data()

HAIR = {
    'm': ['short01', 'short02', 'short03', 'short04', 'afro01', 'braid01'],
    'f': ['ponytail01', 'braid01', 'bob01', 'short02', 'afro01', 'long01'],
}
BROWS = {'m': ['eyebrow001', 'eyebrow004', 'eyebrow007'], 'f': ['eyebrow002', 'eyebrow005', 'eyebrow010']}

BASE_MACRO = {
    'm': dict(gender=1.0, age=0.5, muscle=0.72, weight=0.5, height=0.5, proportions=0.75, cupsize=0.5, firmness=0.5),
    'f': dict(gender=0.0, age=0.5, muscle=0.62, weight=0.45, height=0.5, proportions=0.75, cupsize=0.35, firmness=0.7),
}
# morph name -> (macro overrides, micro targets {name: weight})
VARIANTS = {
    'heavy': ({'weight': 0.95}, {}),
    'thin': ({'weight': 0.12}, {}),
    'muscle': ({'muscle': 1.0}, {}),
    'soft': ({'muscle': 0.25}, {}),
    'african': ({'race': {'african': 1.0, 'asian': 0.0, 'caucasian': 0.0}}, {}),
    'asian': ({'race': {'african': 0.0, 'asian': 1.0, 'caucasian': 0.0}}, {}),
    'faceSquare': ({}, {'head-square': 1.0}),
    'faceOval': ({}, {'head-oval': 1.0}),
    'faceRound': ({}, {'head-round': 1.0}),
    'noseBroad': ({}, {'nose-flaring-incr': 1.0, 'nose-scale-horiz-incr': 0.6}),
    'older': ({'age': 0.75}, {}),
}


def asset_file(kind, name):
    d = os.path.join(DATA, kind, name)
    for f in sorted(os.listdir(d)):
        if f.endswith('.mhclo') or f.endswith('.proxy'):
            return os.path.join(d, f)
    raise IOError(d)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_human(sex, overrides, micro):
    """One complete human. Returns {key: object} for the rig and every exported mesh."""
    clear()
    macro = TargetService.get_default_macro_info_dict()
    macro.update(BASE_MACRO[sex])
    macro['race'] = {'african': 0.0, 'asian': 0.0, 'caucasian': 1.0}
    for k, v in overrides.items():
        macro[k] = v
    bm = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
    for name, w in micro.items():
        TargetService.set_target_value(bm, name, w)
    rig = HumanService.add_builtin_rig(bm, 'game_engine')
    objs = {'rig': rig, 'basemesh': bm}
    proxy = 'male_muscle_13290' if sex == 'm' else 'female_muscle_13442'
    objs['body'] = HumanService.add_mhclo_asset(asset_file('proxymeshes', proxy), bm, asset_type='Proxymeshes', subdiv_levels=0, material_type='NONE')
    objs['eyes'] = HumanService.add_mhclo_asset(asset_file('eyes', 'high-poly'), bm, asset_type='Eyes', subdiv_levels=0, material_type='NONE')
    objs['lashes'] = HumanService.add_mhclo_asset(asset_file('eyelashes', 'eyelashes01'), bm, asset_type='Eyelashes', subdiv_levels=0, material_type='NONE')
    objs['teeth'] = HumanService.add_mhclo_asset(asset_file('teeth', 'teeth_base'), bm, asset_type='Teeth', subdiv_levels=0, material_type='NONE')
    for b in BROWS[sex]:
        objs['brow_' + b] = HumanService.add_mhclo_asset(asset_file('eyebrows', b), bm, asset_type='Eyebrows', subdiv_levels=0, material_type='NONE')
    for h in HAIR[sex]:
        objs['hair_' + h] = HumanService.add_mhclo_asset(asset_file('hair', h), bm, asset_type='Hair', subdiv_levels=0, material_type='NONE')
    return objs


def coords(obj):
    return [v.co.copy() for v in obj.data.vertices]


def bone_head(rig, name):
    return rig.matrix_world @ rig.data.bones[name].head_local


def weight_of(obj, v, names):
    total = 0.0
    for g in v.groups:
        if obj.vertex_groups[g.group].name in names:
            total += g.weight
    return total


def cut_garment(body, name, keep_vertex, offset, flare=None, hems=None):
    """Duplicate `body` (with its shape keys and skin weights), keep the faces whose vertices all pass keep_vertex,
    push the result out along the base normals by `offset` (+ flare(v) per vertex) in every shape key."""
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    g = bpy.context.active_object
    g.name = name
    me = g.data
    keep = [keep_vertex(g, v) for v in me.vertices]
    bpy.ops.object.mode_set(mode='EDIT')
    b = bmesh.from_edit_mesh(me)
    b.faces.ensure_lookup_table()
    dead = [f for f in b.faces if not all(keep[v.index] for v in f.verts)]
    bmesh.ops.delete(b, geom=dead, context='FACES')
    loose = [v for v in b.verts if not v.link_faces]
    bmesh.ops.delete(b, geom=loose, context='VERTS')
    bmesh.update_edit_mesh(me)
    bpy.ops.object.mode_set(mode='OBJECT')
    normals = [v.normal.copy() for v in me.vertices]
    # straight hems: open-edge vertices near a cut height snap onto it (in every shape key by the same amount)
    if hems:
        edge_faces = {}
        for poly in me.polygons:
            for ek in poly.edge_keys:
                edge_faces[ek] = edge_faces.get(ek, 0) + 1
        border = set()
        for (a, b2), n in edge_faces.items():
            if n == 1:
                border.add(a)
                border.add(b2)
        for i in border:
            z = me.vertices[i].co.z
            for h in hems:
                if abs(z - h) < 0.045:
                    dz = h - z
                    me.vertices[i].co.z += dz
                    if me.shape_keys:
                        for kb in me.shape_keys.key_blocks:
                            kb.data[i].co.z += dz
                    break
    base_co = [v.co.copy() for v in me.vertices]
    push = [offset + (flare(base_co[i]) if flare else 0.0) for i in range(len(normals))]
    if me.shape_keys:
        for kb in me.shape_keys.key_blocks:
            for i, d in enumerate(kb.data):
                d.co = d.co + normals[i] * push[i]
    for i, v in enumerate(me.vertices):
        v.co = base_co[i] + normals[i] * push[i]
    mat = bpy.data.materials.new(name)
    me.materials.clear()
    me.materials.append(mat)
    return g


def build(sex):
    print('BUILD', sex)
    variant_coords = {}
    for key, (ov, micro) in VARIANTS.items():
        objs = make_human(sex, ov, micro)
        variant_coords[key] = {k: coords(o) for k, o in objs.items() if k not in ('rig', 'basemesh')}
        print('  variant', key)
    objs = make_human(sex, {}, {})
    rig = objs['rig']
    # morph targets on every exported mesh
    for k, o in objs.items():
        if k in ('rig', 'basemesh'):
            continue
        for m in list(o.modifiers):
            if m.type != 'ARMATURE':
                o.modifiers.remove(m)
        o.shape_key_add(name='Basis', from_mix=False)
        for vk in VARIANTS:
            co = variant_coords[vk][k]
            if len(co) != len(o.data.vertices):
                raise RuntimeError(f'{k}: topology differs in variant {vk}')
            kb = o.shape_key_add(name=vk, from_mix=False)
            for i, c in enumerate(co):
                kb.data[i].co = c
        o.name = k
        o.data.materials.clear()
        mat = bpy.data.materials.new(k)
        o.data.materials.append(mat)

    body = objs['body']
    hip = bone_head(rig, 'thigh_l').z
    knee = bone_head(rig, 'calf_l').z
    waist = bone_head(rig, 'spine_02').z
    shorts_bottom = knee + (hip - knee) * (0.42 if sex == 'm' else 0.62)
    arm_names = {'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'}

    def in_shorts(g, v):
        z = v.co.z
        return shorts_bottom <= z <= waist - 0.01 and weight_of(g, v, arm_names) < 0.2

    flare_span = max(0.01, (hip - shorts_bottom))
    # looser at the hem, snug at the waistband
    shorts = cut_garment(body, 'shorts', in_shorts, 0.010 if sex == 'm' else 0.006,
                         (lambda c: 0.022 * max(0.0, 1.0 - (c.z - shorts_bottom) / flare_span)) if sex == 'm' else None,
                         hems=[shorts_bottom + 0.012, waist - 0.02])

    hand_bones = {'hand_l', 'hand_r'}
    knuckle_bones = {f'{f}_01_{s}' for f in ('index', 'middle', 'ring', 'pinky') for s in 'lr'} | {f'thumb_01_{s}' for s in 'lr'} | {f'thumb_02_{s}' for s in 'lr'}
    wrist_l = bone_head(rig, 'hand_l')
    wrist_r = bone_head(rig, 'hand_r')

    def in_glove(g, v):
        w = weight_of(g, v, hand_bones | knuckle_bones)
        near_wrist = min((v.co - wrist_l).length, (v.co - wrist_r).length) < 0.06
        return w > 0.5 or (near_wrist and weight_of(g, v, {'lowerarm_l', 'lowerarm_r'}) > 0.3)

    gloves = cut_garment(body, 'gloves', in_glove, 0.011)
    garments = [shorts, gloves]
    if sex == 'f':
        chest_low = bone_head(rig, 'spine_02').z + 0.02
        chest_top = bone_head(rig, 'clavicle_l').z - 0.03

        def in_top(g, v):
            return chest_low <= v.co.z <= chest_top and weight_of(g, v, arm_names) < 0.25 and weight_of(g, v, {'neck_01', 'head'}) < 0.2

        garments.append(cut_garment(body, 'top', in_top, 0.004, hems=[chest_low + 0.012]))

    # export: rig + every mesh except the basemesh
    bpy.ops.object.select_all(action='DESELECT')
    objs['basemesh'].hide_set(False)
    export = [rig] + [o for k, o in objs.items() if k not in ('rig', 'basemesh')] + garments
    for o in export:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(OUT, f'fighter_{sex}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
                              export_animations=False, export_skins=True, export_morph=True, export_morph_normal=False,
                              export_image_format='NONE', export_materials='EXPORT', export_attributes=False)
    info = {
        'file': os.path.basename(path),
        'morphs': list(VARIANTS.keys()),
        'hair': HAIR[sex],
        'brows': BROWS[sex],
        'meshes': {o.name: len(o.data.vertices) for o in export if o.type == 'MESH'},
        'height': round(max(v.co.z for v in body.data.vertices) - min(v.co.z for v in body.data.vertices), 3),
    }
    print('EXPORTED', path, os.path.getsize(path), json.dumps(info))
    return info


manifest = {'m': build('m'), 'f': build('f')}
with open(os.path.join(OUT, 'fighters.json'), 'w') as fh:
    json.dump(manifest, fh, indent=1)
print('DONE')
