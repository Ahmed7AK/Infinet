"""
Convert the Poly Haven 1k glTF models (CC0) into compact GLBs for public/models (plan §12).
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/import_polyhaven.py [-- only=id1,id2]
Reads assets-src/downloads/polyhaven/models/models.json (written by tools/assets/fetch-polyhaven.ts).
Each model is decimated down to its triangle budget, textures are re-encoded as WebP, and the result sits
on the ground (z = 0) centred on its footprint. `split` sets (a pile of rocks) keep each object as its own top-level node, recentred, in one GLB (the
textures are shared, so one file is far smaller than one per rock); the scene picks them by index.
"""
import json
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets-src', 'downloads', 'polyhaven', 'models')
OUT = os.path.join(ROOT, 'public', 'models')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
only = None
for a in argv:
    if a.startswith('only='):
        only = set(a[5:].split(','))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def tris(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def decimate(objs, budget):
    total = sum(tris(o) for o in objs)
    if total <= budget:
        return total
    ratio = budget / total
    for o in objs:
        m = o.modifiers.new('Decimate', 'DECIMATE')
        m.ratio = ratio
        m.use_collapse_triangulate = True
    return total


def broken_textures(path):
    """textures with no image (an image Blender composes in memory, e.g. colour + opacity, can fail as WebP)"""
    import struct
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    return [t for t in j.get('textures', []) if 'source' not in t and not t.get('extensions', {}).get('EXT_texture_webp')]


def export(path, objs, fmt='WEBP'):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        # keep parents (glTF node hierarchy) in the selection so transforms survive
        p = o.parent
        while p:
            p.select_set(True)
            p = p.parent
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True,
        export_image_format=fmt, export_image_quality=82, export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False,
    )
    if fmt == 'WEBP' and broken_textures(path):
        print('  (a texture failed as WebP: re-exporting', os.path.basename(path), 'with the source formats)')
        export(path, objs, 'AUTO')


def ground(objs):
    """move the roots so the set sits on z = 0, centred on its footprint"""
    lo, hi = bbox(objs)
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    roots = {o if not o.parent else top(o) for o in objs}
    for r in roots:
        r.location -= shift
    bpy.context.view_layer.update()


def top(o):
    while o.parent:
        o = o.parent
    return o


report = []
for m in json.load(open(os.path.join(SRC, 'models.json'))):
    if only and m['id'] not in only:
        continue
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, m['gltf']))
    objs = meshes()
    if m.get('drop'):
        for o in [o for o in objs if m['drop'] in o.name]:
            bpy.data.objects.remove(o)
        objs = meshes()
    if m.get('split'):
        src = decimate(objs, m['tris'])
        for i, o in enumerate(sorted(objs, key=lambda o: o.name)):
            # unparent, recentre each piece on its own footprint, and name it piece_0, piece_1, …
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
            bpy.context.view_layer.update()
            ground([o])
            o.name = f'piece_{i}'
        export(os.path.join(OUT, m['as'] + '.glb'), objs)
        report.append((m['as'], src, min(src, m['tris']), [(o.name, tuple(round(v, 2) for v in o.dimensions)) for o in objs]))
        continue
    if m.get('height'):
        lo, hi = bbox(objs)
        k = m['height'] / (hi.z - lo.z)
        for r in {top(o) for o in objs}:
            r.scale *= k
            r.location *= k
        bpy.context.view_layer.update()
    src = decimate(objs, m['tris'])
    ground(objs)
    export(os.path.join(OUT, m['as'] + '.glb'), objs)
    lo, hi = bbox(objs)
    report.append((m['as'], src, min(src, m['tris']), tuple(round(v, 2) for v in hi - lo), [o.name for o in objs][:6]))

print('\n=== Poly Haven import ===')
for r in report:
    print(*r)
