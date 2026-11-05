"""
Convert the Microsoft Rocketbox people and clips (MIT) into GLBs for the scenes (plan §5, §12.5).
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/import_rocketbox.py [-- only=player,anim]
Reads assets-src/downloads/rocketbox/manifest.json (written by tools/assets/fetch-rocketbox.ts) and writes
  public/models/people/<as>.glb   one skinned person each (mesh + Bip01 skeleton, textures resized, WebP)
  public/models/people/anim_<m|f>_<clip>.glb  one clip each, on a bare skeleton
Every Rocketbox person shares the Bip01 bone names, so the scene plays one clip file on any person of that body type.
"""
import json
import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'downloads', 'rocketbox')
OUT = os.path.join(ROOT, 'public', 'models', 'people')
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
only = None
for a in argv:
    if a.startswith('only='):
        only = set(a[5:].split(','))

man = json.load(open(os.path.join(SRC, 'manifest.json')))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def clean_materials(tex):
    """drop the specular maps (missing, and glTF is metal/rough), set a skin-and-cloth roughness, resize the rest"""
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and (not n.image or n.image.size[0] == 0):
                nt.nodes.remove(n)
        if bsdf:
            for s in ('Specular IOR Level', 'Roughness', 'Metallic'):
                inp = bsdf.inputs.get(s)
                if inp:
                    for l in list(inp.links):
                        nt.links.remove(l)
            bsdf.inputs['Roughness'].default_value = 0.62
            bsdf.inputs['Metallic'].default_value = 0.0
            if bsdf.inputs.get('Specular IOR Level'):
                bsdf.inputs['Specular IOR Level'].default_value = 0.35
    for im in bpy.data.images:
        if im.size[0] > tex:
            im.scale(tex, tex)
        if 'opacity' in im.filepath.lower() and im.size[0] > 0:
            bleed(im)


def bleed(im):
    """
    Hair, brows and lashes are alpha cards whose texture is black wherever it is transparent. Mipmaps average that
    black into the hair edges, so at a distance the hair goes zebra-striped. Fill the transparent texels with the
    mean colour of the opaque ones (alpha is untouched).
    """
    import numpy as np
    px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    solid = px[:, 3] > 0.5
    if solid.any():
        px[~solid, :3] = px[solid, :3].mean(axis=0)
        im.pixels.foreach_set(px.ravel())
        im.update()


def person(p):
    reset()
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, 'avatars', p['id'], p['id'] + '.fbx'))
    for o in list(bpy.context.scene.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    if arm.animation_data:
        arm.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    arm.name = 'Bip01'
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    mesh.name = p['as']
    clean_materials(p['tex'])
    select([arm, mesh])
    path = os.path.join(OUT, p['as'] + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False,
        export_image_format='WEBP', export_image_quality=80, export_yup=True,
        export_skins=True, export_animations=False, export_morph=False, export_cameras=False, export_lights=False,
    )
    mesh.data.calc_loop_triangles()
    return (p['as'], p['id'], len(mesh.data.loop_triangles), len(arm.data.bones), os.path.getsize(path))


FACE = ('Eye', 'Mouth', 'Lip', 'lip', 'Cheek', 'Caninus', 'Masseter', 'Eyebrow', 'Jaw', 'Tongue', 'Nose')


def fcurves(act):
    """F-curves of an action (Blender 4.4+ keeps them in layers → strips → channel bags)"""
    if hasattr(act, 'layers') and act.layers:
        return [fc for ly in act.layers for st in ly.strips for cb in st.channelbags for fc in cb.fcurves], \
            [cb for ly in act.layers for st in ly.strips for cb in st.channelbags]
    return list(act.fcurves), [act]


def slim(arm, act):
    """drop the 'Nub' end bones (no person has them) and the face channels (the clips hold the face still)"""
    curves, bags = fcurves(act)
    for fc in curves:
        dp = fc.data_path
        if 'Nub' in dp or any(k in dp for k in FACE):
            for b in bags:
                if fc in list(b.fcurves):
                    b.fcurves.remove(fc)
                    break


def clips(sex):
    """
    One GLB per clip, each exported from its own skeleton. Every Rocketbox clip FBX stores its first pose as the
    armature's rest pose and keys the bones relative to it (the seated clip's rest pose is already seated), so a
    clip cannot be moved onto another clip's armature: glTF then writes the absolute local transforms we need.
    """
    out = []
    for c in man['clips']:
        if c.get('only') and c['only'] != sex:
            continue
        reset()
        bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, 'anim', f"{sex}_{c['name']}.max.fbx"))
        for o in list(bpy.context.scene.objects):
            if o.type != 'ARMATURE':
                bpy.data.objects.remove(o)
        arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
        arm.name = 'Bip01'
        act = arm.animation_data.action
        act.name = c['as']
        if c.get('range'):
            act.use_frame_range = True
            act.frame_start, act.frame_end = c['range']
        bpy.context.scene.frame_start, bpy.context.scene.frame_end = (int(v) for v in act.frame_range)
        slim(arm, act)
        select([arm])
        bpy.ops.object.mode_set(mode='EDIT')
        for eb in list(arm.data.edit_bones):
            if eb.name.endswith('Nub'):
                arm.data.edit_bones.remove(eb)
        bpy.ops.object.mode_set(mode='OBJECT')
        path = os.path.join(OUT, f"anim_{sex}_{c['as']}.glb")
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_yup=True,
            export_animations=True, export_animation_mode='ACTIVE_ACTIONS', export_force_sampling=True,
            export_frame_range=True, export_frame_step=2, export_optimize_animation_size=True, export_def_bones=False,
            export_cameras=False, export_lights=False,
        )
        out.append((c['as'], tuple(act.frame_range), os.path.getsize(path)))
    return (f'anim_{sex}', out)


report = []
for p in man['people']:
    if only and p['as'] not in only:
        continue
    report.append(person(p))
if not only or 'anim' in only:
    for sex in ('m', 'f'):
        report.append(clips(sex))
print('\n=== Rocketbox import ===')
for r in report:
    print(*r)
