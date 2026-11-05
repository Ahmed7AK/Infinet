"""
Builds every Infinet prop and hero asset procedurally and exports one GLB each to public/models/ (plan §12.4).
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/build_all.py [-- only=name1,name2]

Conventions
- metres, Blender Z-up; the glTF exporter writes Y-up. Blender +Y = north/compass 0°.
- "Forward" for people, cars and furniture = Blender -Y (three.js +Z, what Object3D.lookAt aims).
- Named nodes for anything the app animates or lights: Sector_1..3, Az, El, LED, Screen, LampLight, joints.
- PBR materials only (Principled BSDF). Emissive parts are separate materials.
- No logos, no brand names, no text on any surface.
"""
import bpy, bmesh, math, os, sys
from math import cos, sin, pi, radians

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'models')
os.makedirs(OUT, exist_ok=True)
ONLY = None
if '--' in sys.argv:
    for a in sys.argv[sys.argv.index('--') + 1:]:
        if a.startswith('only='):
            ONLY = set(a[5:].split(','))


# ───────────────────────── helpers ─────────────────────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

_mats = {}
def mat(name, rgb, rough=0.6, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0, double=False):
    m = bpy.data.materials.get(name)
    if m: return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    m.use_backface_culling = not double
    return m

def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    return o


class MB:
    """Mesh builder: accumulates simple solids into ONE mesh object (one draw call per material)."""
    def __init__(self):
        self.v = []; self.f = []; self.smooth = []

    def _add(self, verts, faces, smooth=False):
        o = len(self.v)
        self.v += verts
        for fc in faces:
            self.f.append([i + o for i in fc]); self.smooth.append(smooth)
        return self

    def box(self, c, s, rz=0.0):
        cx, cy, cz = c; sx, sy, sz = s[0] / 2, s[1] / 2, s[2] / 2
        cr, sr = cos(rz), sin(rz)
        pts = []
        for z in (-sz, sz):
            for (x, y) in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
                pts.append((cx + x * cr - y * sr, cy + x * sr + y * cr, cz + z))
        F = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
        return self._add(pts, F)

    def cyl(self, c, r0, r1, h, n=16, axis='z', caps=True, smooth=True, sx=1.0, sy=1.0):
        """frustum from c along +axis for h"""
        cx, cy, cz = c
        V = []
        for k, r in ((0, r0), (1, r1)):
            for i in range(n):
                a = 2 * pi * i / n
                u, w = r * cos(a) * sx, r * sin(a) * sy
                d = h * k
                if axis == 'z': V.append((cx + u, cy + w, cz + d))
                elif axis == 'x': V.append((cx + d, cy + u, cz + w))
                else: V.append((cx + u, cy + d, cz + w))
        F = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
        self._add(V, F, smooth)
        if caps:
            o = len(self.v) - 2 * n
            self.f.append([o + i for i in reversed(range(n))]); self.smooth.append(False)
            self.f.append([o + n + i for i in range(n)]); self.smooth.append(False)
        return self

    def tube(self, pts, radii, n=10, sx=1.0, sy=1.0, caps=True):
        """generalised capsule along a polyline of 3D points (any direction), elliptical section"""
        import mathutils
        V = []
        P = [mathutils.Vector(p) for p in pts]
        prev = mathutils.Vector((1, 0, 0))
        for j, p in enumerate(P):
            t = (P[min(j + 1, len(P) - 1)] - P[max(j - 1, 0)]).normalized()
            side = t.cross(mathutils.Vector((0, 1, 0)) if abs(t.y) < 0.9 else mathutils.Vector((1, 0, 0))).normalized()
            if side.dot(prev) < 0: side = -side
            prev = side
            up = t.cross(side).normalized()
            for i in range(n):
                a = 2 * pi * i / n
                q = p + side * (radii[j] * cos(a) * sx) + up * (radii[j] * sin(a) * sy)
                V.append(tuple(q))
        F = []
        for j in range(len(P) - 1):
            for i in range(n):
                a, b = j * n + i, j * n + (i + 1) % n
                F.append([a, b, b + n, a + n])
        self._add(V, F, True)
        if caps:
            o = len(self.v) - len(P) * n
            self.f.append([o + i for i in reversed(range(n))]); self.smooth.append(True)
            self.f.append([o + (len(P) - 1) * n + i for i in range(n)]); self.smooth.append(True)
        return self

    def sphere(self, c, r, n=16, m=10, sx=1.0, sy=1.0, sz=1.0):
        cx, cy, cz = c
        V = [(cx, cy, cz - r * sz)]
        for j in range(1, m):
            ph = -pi / 2 + pi * j / m
            for i in range(n):
                a = 2 * pi * i / n
                V.append((cx + r * cos(ph) * cos(a) * sx, cy + r * cos(ph) * sin(a) * sy, cz + r * sin(ph) * sz))
        V.append((cx, cy, cz + r * sz))
        F = [[0, 1 + (i + 1) % n, 1 + i] for i in range(n)]
        for j in range(m - 2):
            for i in range(n):
                a = 1 + j * n + i; b = 1 + j * n + (i + 1) % n
                F.append([a, b, b + n, a + n])
        top = len(V) - 1
        F += [[top, 1 + (m - 2) * n + i, 1 + (m - 2) * n + (i + 1) % n] for i in range(n)]
        return self._add(V, F, True)

    def raw(self, verts, faces, smooth=False):
        return self._add(verts, faces, smooth)

    def build(self, name, material, parent=None, loc=(0, 0, 0), bevel=0.0):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        for p, s in zip(me.polygons, self.smooth): p.use_smooth = s
        o = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(o)
        me.materials.append(material)
        o.parent = parent
        o.location = loc
        if bevel > 0:
            md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 2; md.limit_method = 'ANGLE'
        return o


def extrude_profile(mb, prof, w0, w1=None, y0=0.0):
    """side profile [(x,z)] (convex-ish, CCW) extruded across Y from -w/2..w/2; w1 tapers the top half"""
    n = len(prof); w1 = w0 if w1 is None else w1
    zs = [z for _, z in prof]; zmin, zmax = min(zs), max(zs)
    V = []
    for side in (-1, 1):
        for (x, z) in prof:
            t = (z - zmin) / max(zmax - zmin, 1e-6)
            w = w0 + (w1 - w0) * t
            V.append((x, y0 + side * w / 2, z))
    F = [list(reversed(range(n))), [n + i for i in range(n)]]
    F += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    mb.raw(V, F)


def export(name):
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              use_selection=False, export_cameras=False, export_lights=False)
    tris = sum(len(o.data.loop_triangles) if (o.type == 'MESH' and (o.data.calc_loop_triangles() or True)) else 0
               for o in bpy.data.objects)
    print(f'EXPORT {name}  {os.path.getsize(path) / 1024:.0f} KB  ~{tris} tris')


ASSETS = {}
def asset(fn):
    ASSETS[fn.__name__] = fn
    return fn


# ───────────────────────── common materials ─────────────────────────
def M():
    return dict(
        white=mat('WhitePlastic', (0.82, 0.82, 0.8), 0.55),
        black=mat('BlackPlastic', (0.03, 0.03, 0.035), 0.45),
        steel=mat('GalvSteel', (0.55, 0.56, 0.57), 0.45, 0.9),
        darksteel=mat('DarkSteel', (0.12, 0.12, 0.13), 0.5, 0.8),
        alu=mat('Aluminium', (0.78, 0.79, 0.8), 0.3, 1.0),
        paint=mat('GreyPaint', (0.55, 0.56, 0.55), 0.6, 0.0),
        led_g=mat('LED', (0.1, 0.8, 0.3), 0.4, 0, (0.2, 1.0, 0.45), 3.0),
        rubber=mat('Rubber', (0.025, 0.025, 0.025), 0.9),
        glass=mat('Glass', (0.04, 0.05, 0.06), 0.05, 0.0, alpha=0.55),
        screen=mat('Screen', (0.01, 0.01, 0.015), 0.15, 0, (0.25, 0.4, 0.6), 0.6),
    )


# ───────────────────────── network hardware ─────────────────────────
@asset
def ap_ceiling():
    m = M()
    root = empty('ap_ceiling')
    MB().box((0, 0, -0.004), (0.26, 0.26, 0.008)).build('Plate', m['white'], root)
    b = MB(); b.cyl((0, 0, -0.045), 0.105, 0.11, 0.037, n=40)
    b.build('Body', m['white'], root, bevel=0.006)
    MB().cyl((0, 0, -0.0465), 0.07, 0.07, 0.002, n=40).cyl((0, 0, -0.0465), 0.0, 0.0, 0.0, n=3, caps=False) \
        .build('LED', m['led_g'], root)


@asset
def ap_cafe():
    m = M()
    root = empty('ap_cafe')  # origin: wall mount point; body faces -Y (into the room)
    MB().box((0, 0.01, 0), (0.12, 0.02, 0.1)).build('Bracket', m['darksteel'], root)
    MB().box((0, -0.04, 0), (0.22, 0.04, 0.15)).build('Body', m['black'], root, bevel=0.006)
    a = MB()
    for x in (-0.09, 0.09):
        a.cyl((x, -0.04, 0.075), 0.009, 0.007, 0.17, n=10)
    a.build('Antennas', m['black'], root)
    MB().box((0.06, -0.0605, 0.05), (0.05, 0.002, 0.006)).build('LED', m['led_g'], root)


@asset
def adapter_usb():
    m = M()
    root = empty('adapter_usb')
    MB().box((0, 0, 0.005), (0.06, 0.02, 0.01)).build('Body', m['black'], root, bevel=0.002)
    MB().cyl((0.028, 0, 0.01), 0.004, 0.003, 0.09, n=8).build('Antenna', m['black'], root)
    MB().box((-0.033, 0, 0.005), (0.012, 0.012, 0.005)).build('Plug', m['alu'], root)


@asset
def laptop():
    m = M()
    root = empty('laptop')  # base on the table, screen hinge at the back (+Y), user at -Y
    MB().box((0, 0, 0.009), (0.32, 0.22, 0.018)).build('Base', m['alu'], root, bevel=0.004)
    MB().box((0, 0.015, 0.0185), (0.28, 0.1, 0.001)).build('Keys', m['black'], root)
    hinge = empty('Hinge', (0, 0.11, 0.018), root, (radians(-15), 0, 0))
    MB().box((0, 0.004, 0.11), (0.32, 0.008, 0.22)).build('Lid', m['alu'], hinge, bevel=0.003)
    MB().box((0, -0.0005, 0.11), (0.29, 0.001, 0.19)).build('Screen', mat('LaptopScreen', (0.02, 0.03, 0.04), 0.2, 0, (0.55, 0.65, 0.8), 0.9), hinge)


@asset
def phone_hand():
    m = M()
    root = empty('phone_hand')
    MB().box((0, 0, 0), (0.072, 0.008, 0.15)).build('Body', m['black'], root, bevel=0.006)
    MB().box((0, -0.0042, 0), (0.066, 0.0005, 0.142)).build('Screen', mat('PhoneScreen', (0.02, 0.05, 0.08), 0.15, 0, (0.4, 0.85, 1.0), 1.4), root)


@asset
def rack_42u():
    m = M()
    root = empty('rack_42u')  # front faces -Y
    fr = MB()
    for x in (-0.29, 0.29):
        for y in (-0.48, 0.48):
            fr.box((x, y, 1.0), (0.03, 0.03, 2.0))
    for z in (0.02, 1.98):
        fr.box((0, -0.48, z), (0.6, 0.03, 0.03)).box((0, 0.48, z), (0.6, 0.03, 0.03))
        fr.box((-0.29, 0, z), (0.03, 0.96, 0.03)).box((0.29, 0, z), (0.03, 0.96, 0.03))
    fr.box((0, 0, 2.0), (0.6, 1.0, 0.02)).box((-0.3, 0, 1.0), (0.005, 1.0, 2.0)).box((0.3, 0, 1.0), (0.005, 1.0, 2.0)).box((0, 0.5, 1.0), (0.6, 0.005, 2.0))
    fr.build('Frame', m['darksteel'], root)
    units = MB(); leds = MB(); ports = MB()
    z = 1.75
    for k, h in enumerate([0.044, 0.044, 0.044, 0.088, 0.044, 0.044, 0.132, 0.088]):
        units.box((0, -0.2, z), (0.48, 0.55, h - 0.004))
        if k in (0, 1, 2, 4, 5):
            for i in range(24):
                x = -0.2 + i * 0.016
                ports.box((x, -0.476, z), (0.011, 0.004, 0.01))
                if (i * 7 + k * 3) % 5:
                    leds.box((x, -0.479, z + 0.012), (0.003, 0.002, 0.003))
        z -= h + 0.02
    units.build('Units', m['black'], root)
    ports.build('Ports', mat('PortGrey', (0.2, 0.2, 0.22), 0.6), root)
    leds.build('LED', mat('LEDRack', (0.1, 0.9, 0.3), 0.4, 0, (0.25, 1.0, 0.45), 4.0), root)
    cab = MB()
    for i in range(6):
        cab.box((-0.18 + i * 0.07, 0.3, 2.5), (0.012, 0.012, 1.0))
    cab.box((0, 0.3, 3.0), (0.5, 0.3, 0.05))
    cab.build('CableTray', mat('CableBlue', (0.05, 0.16, 0.4), 0.6), root)


@asset
def tower_monopole():
    m = M()
    root = empty('tower_monopole')
    pole = MB()
    rings = [(0, 0.45), (10, 0.39), (20, 0.32), (30, 0.26)]
    for (z0, r0), (z1, r1) in zip(rings, rings[1:]):
        pole.cyl((0, 0, z0), r0, r1, z1 - z0, n=18, caps=False)
        pole.cyl((0, 0, z1 - 0.15), r1 + 0.04, r1 + 0.04, 0.15, n=18)  # flange
    pole.cyl((0, 0, 0), 0.9, 0.9, 0.5, n=8, smooth=False)  # foundation collar
    pole.build('Pole', m['steel'], root)
    MB().cyl((0, 0, -0.01), 1.6, 1.6, 0.2, n=8, smooth=False).build('Plinth', mat('Concrete', (0.55, 0.54, 0.52), 0.85), root)
    plat = MB()
    for k in range(3):
        a = radians(k * 120)
        a2 = radians(k * 120 + 120)
        p0 = (1.2 * sin(a), 1.2 * cos(a)); p1 = (1.2 * sin(a2), 1.2 * cos(a2))
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        plat.box((mx, my, 28.0), (L, 0.08, 0.08), rz=math.atan2(p1[1] - p0[1], p1[0] - p0[0]))
        plat.box((0.6 * sin(a), 0.6 * cos(a), 28.0), (0.08, 1.2, 0.08), rz=-a)
        plat.box((0.6 * sin(a), 0.6 * cos(a), 27.6), (0.05, 0.05, 0.8), rz=-a)
    plat.build('Platform', m['steel'], root)
    panel = mat('PanelWhite', (0.78, 0.78, 0.76), 0.55)
    for k in range(3):
        s = empty(f'Sector_{k + 1}', (0, 0, 0), root, (0, 0, -radians(k * 120)))
        mount = MB()
        mount.cyl((0, 1.2, 26.9), 0.04, 0.04, 2.2, n=8)
        mount.build(f'Mount_{k + 1}', m['steel'], s)
        tilt = empty(f'Tilt_{k + 1}', (0, 1.35, 28.0), s, (radians(-4), 0, 0))
        MB().box((0, 0.075, 0), (0.45, 0.15, 0.85)).build(f'Panel_{k + 1}', panel, tilt, bevel=0.02)
        MB().box((0, -0.02, -0.75), (0.32, 0.12, 0.45)).build(f'RRU_{k + 1}', m['paint'], tilt, bevel=0.01)
    dish = empty('Microwave', (0, 0, 25.0), root, (0, 0, radians(200)))
    d = MB(); d.cyl((0, 0.45, 0), 0.3, 0.3, 0.12, n=24, axis='y')
    d.build('Dish', m['white'], dish, bevel=0.01)
    MB().cyl((0, 0.3, 0), 0.05, 0.05, 0.15, n=8, axis='y').build('DishArm', m['steel'], dish)
    lad = MB()
    lad.box((0, -0.5, 14.0), (0.3, 0.02, 28.0))
    lad.build('CableLadder', m['darksteel'], root)
    base = MB()
    base.box((2.4, -1.5, 0.9), (1.2, 0.8, 1.8)).box((2.4, 0.0, 0.8), (1.0, 0.8, 1.6))
    base.build('Cabinets', mat('CabinetBeige', (0.72, 0.7, 0.64), 0.6), root, bevel=0.02)
    fence = MB()
    for i in range(16):
        a = 2 * pi * i / 16
        fence.cyl((4.2 * cos(a), 4.2 * sin(a), 0), 0.03, 0.03, 2.0, n=6)
    fence.cyl((0, 0, 1.95), 4.2, 4.2, 0.04, n=32, caps=False).cyl((0, 0, 0.1), 4.2, 4.2, 0.04, n=32, caps=False)
    fence.build('Fence', m['steel'], root)
    MB().cyl((0, 0, 0.05), 4.2, 4.2, 1.9, n=32, caps=False).build('FenceMesh', mat('ChainLink', (0.5, 0.5, 0.5), 0.5, 0.8, alpha=0.25, double=True), root)


@asset
def vsat_geo():
    m = M()
    root = empty('vsat_geo')
    MB().cyl((0, 0, 0), 0.06, 0.06, 1.25, n=12).cyl((0, 0, 0), 0.35, 0.35, 0.05, n=8, smooth=False).build('Pole', m['steel'], root)
    az = empty('Az', (0, 0, 1.25), root)
    MB().box((0, 0, 0.05), (0.2, 0.2, 0.12)).build('AzHead', m['steel'], az)
    el = empty('El', (0, 0, 0.12), az)
    f = 0.45; R = 0.6; rings = 10; n = 36
    V = [(0, 0.05, 0.25)]
    for j in range(1, rings + 1):
        r = R * j / rings
        for i in range(n):
            a = 2 * pi * i / n
            x, zz = r * cos(a), r * sin(a) * 1.08
            V.append((x, 0.05 + (x * x + zz * zz) / (4 * f), 0.25 + zz))
    F = [[0, 1 + i, 1 + (i + 1) % n] for i in range(n)]
    for j in range(rings - 1):
        for i in range(n):
            a = 1 + j * n + i; b = 1 + j * n + (i + 1) % n
            F.append([a, a + n, b + n, b])
    MB().raw(V, F, True).build('Reflector', mat('DishWhite', (0.8, 0.8, 0.78), 0.45, double=True), el)
    arm = MB()
    arm.tube([(0, 0.05, -0.32), (0, 0.32, -0.05), (0, 0.55, 0.12)], [0.015, 0.015, 0.015], n=8)
    arm.build('FeedArm', m['steel'], el)
    MB().box((0, 0.6, 0.15), (0.09, 0.14, 0.09)).build('LNB_BUC', mat('BucGrey', (0.35, 0.36, 0.36), 0.5, 0.5), el, bevel=0.008)
    MB().box((0, -0.05, 0.25), (0.25, 0.1, 0.25)).build('Back', m['steel'], el)


@asset
def leo_terminal():
    m = M()
    root = empty('leo_terminal')
    MB().cyl((0, 0, 0), 0.03, 0.03, 0.55, n=10).build('Mast', m['white'], root)
    tilt = empty('Panel', (0, 0, 0.58), root, (radians(-60), 0, 0))
    MB().box((0, 0, 0), (0.58, 0.04, 0.38)).build('Face', m['white'], tilt, bevel=0.012)


@asset
def site_router():
    m = M()
    root = empty('site_router')  # wall mount, faces -Y
    MB().box((0, -0.03, 0), (0.25, 0.05, 0.18)).build('Body', m['white'], root, bevel=0.006)
    a = MB()
    for x in (-0.1, 0.1):
        a.cyl((x, -0.03, 0.09), 0.008, 0.006, 0.16, n=8)
    a.build('Antennas', m['white'], root)
    MB().box((0.07, -0.056, 0.05), (0.06, 0.002, 0.006)).build('LED', m['led_g'], root)


@asset
def sat_leo():
    m = M()
    root = empty('sat_leo')
    MB().box((0, 0, 0), (1.3, 0.7, 0.25)).build('Bus', mat('Foil', (0.7, 0.62, 0.35), 0.3, 1.0), root)
    MB().box((0, 2.2, 0.05), (1.2, 3.6, 0.03)).build('Array', mat('Solar', (0.04, 0.06, 0.15), 0.25, 0.4), root)
    MB().box((0, 0, -0.16), (0.15, 0.15, 0.06)).build('Marker', mat('SatMarker', (0.6, 0.5, 1.0), 0.3, 0, (0.65, 0.55, 0.98), 6.0), root)


@asset
def sat_geo():
    m = M()
    root = empty('sat_geo')
    MB().box((0, 0, 0), (2.0, 2.0, 2.4)).build('Bus', mat('Foil', (0.7, 0.62, 0.35), 0.3, 1.0), root)
    w = MB()
    for s in (-1, 1):
        w.box((s * 4.5, 0, 0), (6.0, 1.8, 0.04))
    w.build('Wings', mat('Solar', (0.04, 0.06, 0.15), 0.25, 0.4), root)
    MB().cyl((0, 0, -1.2), 1.2, 0.2, -0.5, n=20).build('Dish', m['white'], root)
    MB().box((0, 0, 1.3), (0.3, 0.3, 0.2)).build('Marker', mat('SatMarker', (0.6, 0.5, 1.0), 0.3, 0, (0.65, 0.55, 0.98), 6.0), root)


@asset
def gateway_cluster():
    m = M()
    root = empty('gateway_cluster')
    for k, (x, y, r) in enumerate([(0, 0, 4.5), (14, 3, 3.6), (-13, 4, 3.0)]):
        MB().cyl((x, y, 0), 1.2, 1.0, 3.0, n=12).build(f'Plinth_{k}', mat('Concrete', (0.55, 0.54, 0.52), 0.85), root)
        piv = empty(f'Dish_{k}', (x, y, 3.0 + r * 0.6), root, (radians(-35), 0, radians(30)))
        MB().cyl((0, 0, 0), r, r * 0.25, -r * 0.35, n=32, axis='y').build(f'Reflector_{k}', mat('DishWhite', (0.8, 0.8, 0.78), 0.45, double=True), piv)


# ───────────────────────── office & café ─────────────────────────
@asset
def desk_set():
    m = M()
    root = empty('desk_set')  # desk centre on the floor; user sits at -Y
    oak = mat('Oak', (0.55, 0.4, 0.26), 0.55)
    MB().box((0, 0, 0.735), (1.6, 0.8, 0.03)).build('Top', oak, root, bevel=0.004)
    legs = MB()
    for x in (-0.75, 0.75):
        legs.box((x, 0, 0.36), (0.05, 0.7, 0.04)).box((x, -0.33, 0.36), (0.05, 0.04, 0.72)).box((x, 0.33, 0.36), (0.05, 0.04, 0.72)).box((x, 0, 0.02), (0.06, 0.75, 0.04))
    legs.box((0, 0.3, 0.6), (1.45, 0.02, 0.25))
    legs.build('Frame', mat('DeskWhiteSteel', (0.85, 0.85, 0.84), 0.5, 0.3), root)
    mon = MB(); mon.box((0, 0.22, 0.755), (0.25, 0.18, 0.01)).box((0, 0.27, 0.95), (0.05, 0.03, 0.4)).box((0, 0.24, 1.1), (0.62, 0.025, 0.37))
    mon.build('Monitor', m['black'], root, bevel=0.003)
    MB().box((0, 0.2265, 1.11), (0.59, 0.002, 0.33)).build('Screen', mat('MonitorScreen', (0.02, 0.03, 0.04), 0.2, 0, (0.5, 0.6, 0.72), 0.8), root)
    MB().box((0, -0.05, 0.756), (0.44, 0.14, 0.015)).box((0.33, -0.05, 0.756), (0.07, 0.11, 0.02)).build('Keyboard', mat('KeyGrey', (0.15, 0.15, 0.16), 0.6), root, bevel=0.002)
    chair = empty('Chair', (0.1, -0.6, 0), root, (0, 0, radians(8)))
    cb = MB()
    for k in range(5):
        a = 2 * pi * k / 5
        cb.box((0.17 * cos(a), 0.17 * sin(a), 0.07), (0.34, 0.04, 0.03), rz=a)
        cb.cyl((0.33 * cos(a), 0.33 * sin(a), 0.0), 0.025, 0.025, 0.05, n=8)
    cb.cyl((0, 0, 0.07), 0.025, 0.025, 0.36, n=10)
    cb.build('Base', m['black'], chair)
    MB().box((0, 0, 0.47), (0.5, 0.48, 0.08)).box((0, -0.25, 0.8), (0.46, 0.06, 0.55)).build('Seat', mat('Fabric', (0.16, 0.18, 0.22), 0.9), chair, bevel=0.02)


@asset
def meeting_table():
    m = M()
    root = empty('meeting_table')
    MB().box((0, 0, 0.735), (2.4, 1.1, 0.03)).build('Top', mat('Oak', (0.55, 0.4, 0.26), 0.55), root, bevel=0.004)
    MB().box((-0.9, 0, 0.36), (0.08, 0.7, 0.72)).box((0.9, 0, 0.36), (0.08, 0.7, 0.72)).build('Legs', m['darksteel'], root)


@asset
def cafe_counter():
    m = M()
    root = empty('cafe_counter')  # customers at -Y
    MB().box((0, 0, 0.52), (3.2, 0.7, 1.04)).build('Body', mat('Walnut', (0.35, 0.22, 0.13), 0.5), root, bevel=0.01)
    MB().box((0, 0, 1.06), (3.3, 0.78, 0.04)).build('Top', mat('Marble', (0.86, 0.85, 0.82), 0.25), root, bevel=0.004)
    cm = MB(); cm.box((0.8, 0.12, 1.32), (0.7, 0.5, 0.48))
    cm.build('CoffeeMachine', mat('Chrome', (0.8, 0.8, 0.8), 0.15, 1.0), root, bevel=0.02)
    MB().box((0.8, -0.14, 1.2), (0.6, 0.02, 0.06)).build('GroupHeads', m['black'], root)
    MB().box((-0.6, 0, 1.25), (0.9, 0.6, 0.35)).build('PastryCase', mat('CaseGlass', (0.6, 0.7, 0.75), 0.05, 0, alpha=0.3), root)
    MB().box((-1.3, 0.05, 1.12), (0.3, 0.3, 0.1)).box((-1.3, 0.12, 1.25), (0.28, 0.04, 0.2)).build('Till', m['black'], root, bevel=0.005)


# ───────────────────────── street ─────────────────────────
_slopes = {}
def _interp(pts, y):
    """monotone cubic (Fritsch–Carlson) through [(y, v)] sorted by y, clamped: smooth, and no overshoot"""
    if y <= pts[0][0]: return pts[0][1]
    if y >= pts[-1][0]: return pts[-1][1]
    key = id(pts)
    if key not in _slopes:
        n = len(pts)
        d = [(pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]) for i in range(n - 1)]
        m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
        for i in range(n - 1):
            if d[i] == 0: m[i] = m[i + 1] = 0.0; continue
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9: t = 3 / math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]
        _slopes[key] = m
    m = _slopes[key]
    for i, ((y0, v0), (y1, v1)) in enumerate(zip(pts, pts[1:])):
        if y <= y1:
            h = y1 - y0; t = (y - y0) / h
            h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
            return h00 * v0 + h10 * h * m[i] + h01 * v1 + h11 * h * m[i + 1]
    return pts[-1][1]


def _half_ring(hw, zb, zt, crown, rb=0.07, rt=0.16, bulge=0.025, arch=None):
    """
    one side of a body cross-section, bottom centre → top centre: a rounded box with a slight side bulge.
    `arch` (a height) lifts the outer bottom over a wheel: the points outboard of the wheel well's inner wall are
    pushed up to it, the rest of the section keeps its shape (so the bonnet doesn't ripple over the arches).
    """
    h = zt - zb
    rb = min(rb, h / 3); rt = min(rt, h / 2.2)
    za = zb if arch is None else max(zb, arch)
    pts = [(0.0, zb), (hw - 0.33, zb), (hw - 0.31, za)]
    for k in range(1, 4):  # bottom corner
        a = -pi / 2 + (pi / 2) * k / 3
        pts.append((hw - rb + rb * cos(a), zb + rb + rb * sin(a)))
    for k in range(1, 5):  # side, bulging out a little below the shoulder
        t = k / 5
        z = zb + rb + (h - rb - rt) * t
        pts.append((hw + bulge * sin(pi * t) - bulge * 0.3, z))
    for k in range(0, 5):  # shoulder
        a = (pi / 2) * k / 4
        pts.append((hw - rt + rt * cos(a) - bulge * 0.3 * (1 - k / 4), zt - rt + rt * sin(a)))
    if arch is not None:
        pts = pts[:3] + [(x, max(z, za)) for (x, z) in pts[3:]]
    pts.append((hw * 0.45, zt + crown * 0.8))
    pts.append((0.0, zt + crown))
    return pts


def _ring(half):
    """mirror a half ring into a closed ring (no duplicate centre points)"""
    left = [(-x, z) for (x, z) in reversed(half[1:-1])]
    return half + left


def _loft(name, stations, ring_at, material_at, mats, parent, smooth=True):
    """loft closed rings along Y; material_at(j, i) picks a material index per quad; caps at both ends"""
    rings = [ring_at(y) for y in stations]
    n = len(rings[0])
    V, F, FM = [], [], []
    for y, r in zip(stations, rings):
        V += [(x, y, z) for (x, z) in r]
    for j in range(len(stations) - 1):
        for i in range(n):
            a, b = j * n + i, j * n + (i + 1) % n
            F.append([a, b, b + n, a + n]); FM.append(material_at(j, i))
    F.append(list(range(n))[::-1]); FM.append(material_at(0, -1))
    k = (len(stations) - 1) * n
    F.append([k + i for i in range(n)]); FM.append(material_at(len(stations) - 2, -1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(V, [], F)
    for m in mats: me.materials.append(m)
    for p, mi in zip(me.polygons, FM):
        p.material_index = mi
        p.use_smooth = smooth
    me.polygons[-1].use_smooth = me.polygons[-2].use_smooth = False
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    return o


def _wheel(name, parent, loc, r, w, side, tyre, rim, dark):
    """a wheel on its own node (the app spins it about X): rounded tyre, five-spoke rim, dark hub face"""
    piv = empty(name, loc, parent)
    rr = r * 0.66  # rim radius
    prof = [(rr, -w / 2), (r * 0.9, -w / 2 - 0.006), (r * 0.98, -w / 2 + 0.02), (r, -w / 4), (r, w / 4), (r * 0.98, w / 2 - 0.02), (r * 0.9, w / 2 + 0.006), (rr, w / 2)]
    N = 30
    V, F = [], []
    for i in range(N):
        a = 2 * pi * i / N
        for (rad, x) in prof:
            V.append((x, rad * cos(a), rad * sin(a)))
    m = len(prof)
    for i in range(N):
        for k in range(m - 1):
            a0, a1 = i * m + k, ((i + 1) % N) * m + k
            F.append([a0, a0 + 1, a1 + 1, a1])
    t = MB().raw(V, F, smooth=True).build(f'{name}_tyre', tyre, piv)
    face = side * (w / 2 - 0.01)
    rb = MB()
    rb.cyl((face - side * 0.01 if side > 0 else face, 0, 0), rr, rr, 0.012, n=24, axis='x')  # rim lip
    rb.cyl((face - side * 0.06 if side > 0 else face - 0.0, 0, 0), rr * 0.92, rr * 0.92, 0.05, n=24, axis='x', caps=False)
    for k in range(5):  # spokes
        a = 2 * pi * k / 5 + 0.3
        c = (face, cos(a) * rr * 0.5, sin(a) * rr * 0.5)
        rb.box(c, (0.03, 0.075, rr * 0.92), rz=0)
        # rotate the spoke about X: rebuild its 8 verts
        o = len(rb.v) - 8
        for q in range(o, o + 8):
            x0, y0, z0 = rb.v[q]
            dy, dz = y0 - c[1], z0 - c[2]
            ca, sa = cos(a - pi / 2), sin(a - pi / 2)
            rb.v[q] = (x0, c[1] + dy * ca - dz * sa, c[2] + dy * sa + dz * ca)
    rb.cyl((face - side * 0.02, 0, 0), rr * 0.2, rr * 0.18, 0.035 * side, n=14, axis='x')  # hub
    rb.build(f'{name}_rim', rim, piv)
    MB().cyl((face - side * 0.07, 0, 0), rr * 0.9, rr * 0.9, 0.004, n=20, axis='x').build(f'{name}_disc', dark, piv)
    return piv


def vehicle(name, S):
    """
    A road car built as a loft of cross-sections along its length (front at -Y), so the body has real curvature,
    wheel arches cut by the axles, a glasshouse with tumblehome, and the small parts that read as a car:
    lights, grille, mirrors, handles, blank plates. Wheels are separate nodes (Wheel_FL, _FR, _RL, _RR) the app spins.
    Generic shapes only: no maker's grille pattern, badge or text.
    """
    root = empty(name)
    L = S['L']; r = S['r']; ax = S['axles']
    paint = mat('CarPaint', (0.55, 0.56, 0.58), 0.3, 0.6)
    glass = mat('CarGlass', (0.035, 0.04, 0.045), 0.04, 0.4)
    trim = mat('CarTrim', (0.02, 0.02, 0.022), 0.5)
    chrome = mat('Chrome', (0.85, 0.85, 0.85), 0.12, 1.0)
    head = mat('HeadLight', (0.85, 0.87, 0.88), 0.06, 0.2, (1, 0.97, 0.92), 0.6)
    tail = mat('TailLight', (0.45, 0.01, 0.01), 0.15, 0, (0.85, 0.03, 0.02), 0.5)
    plate = mat('Plate', (0.88, 0.88, 0.86), 0.5)
    tyre = mat('Rubber', (0.03, 0.03, 0.03), 0.85)
    rim = mat('Alloy', (0.62, 0.63, 0.65), 0.3, 1.0)
    liner = mat('ArchLiner', (0.012, 0.012, 0.012), 0.95, double=True)
    Ra = r + 0.07

    def arch_at(y):
        z = None
        for a in ax:
            d = y - a
            if abs(d) < Ra: z = r + 0.02 + math.sqrt(Ra * Ra - d * d)
        return z

    def zb_at(y):
        return _interp(S['bottom'], y)

    # stations: dense at the ends and through the arches, coarse elsewhere
    ys = set()
    y = 0.0
    while y <= L + 1e-6:
        near_end = y < 0.45 or y > L - 0.45
        near_arch = any(abs(y - a) < Ra + 0.12 for a in ax)
        ys.add(round(y, 4))
        y += 0.04 if (near_end or near_arch) else 0.14
    for a in ax:
        for s in (-1, 1): ys.add(round(a + s * (Ra - 0.002), 4)); ys.add(round(a + s * (Ra + 0.004), 4))
    ys.add(L)
    stations = sorted(v for v in ys if 0 <= v <= L)

    def body_ring(yy):
        return _ring(_half_ring(_interp(S['hw'], yy), zb_at(yy), _interp(S['top'], yy), S.get('crown', 0.035), arch=arch_at(yy)))
    o = _loft('Body', [v - L / 2 for v in stations], lambda yy: body_ring(yy + L / 2), lambda j, i: 0, [paint], root)

    # glasshouse: belt → roof, with tumblehome; glass sides, painted roof, black window surround
    ya, yr0, yr1, yc = S['glass']
    roof = S['roof']

    def zroof(yy):
        if yy <= yr0:
            t = (yy - ya) / (yr0 - ya); return _interp(S['top'], yy) - 0.02 + (roof - 0.03 - _interp(S['top'], yy) + 0.02) * (1 - (1 - t) ** 1.6)
        if yy >= yr1:
            t = (yc - yy) / (yc - yr1); return _interp(S['top'], yy) - 0.02 + (roof - 0.03 - _interp(S['top'], yy) + 0.02) * (1 - (1 - t) ** 1.6)
        t = (yy - yr0) / (yr1 - yr0); return roof - 0.03 + 0.03 * sin(pi * t)

    def g_half(yy):
        hw = _interp(S['hw'], yy) - 0.05
        zb = _interp(S['top'], yy) - 0.06
        zr = max(zroof(yy), zb + 0.08)
        hr = hw - S.get('tumble', 0.26)
        hgt = zr - zb
        return [(0.0, zb), (hw - 0.06, zb), (hw, zb + 0.05), (hw - 0.02, zb + 0.06 + 0.35 * (hgt - 0.06)), (hw - (hw - hr) * 0.55, zb + 0.06 + 0.72 * (hgt - 0.06)),
                (hr, zr - 0.04), (hr - 0.06, zr - 0.008), (hr * 0.5, zr + 0.01), (0.0, zr + 0.015)]
    gys = [ya + (yc - ya) * k / 40 for k in range(41)]
    gmid = [(a + b) / 2 for a, b in zip(gys, gys[1:])]
    nh = 9
    cpil = S.get('cpillar', 0.4)

    def g_mat(j, i):
        if i < 0: return 0
        yy = gmid[j]
        k = i if i < nh - 1 else (2 * (nh - 1) - i - 1)  # fold the mirrored side onto the same index
        if k in (0, 1): return 0                              # hidden base
        if k in (2, 3, 4):                                    # side glass (A-sail and C/D-pillar painted)
            if yy < ya + 0.22: return 2
            if yy > yc - cpil: return 0
            return 1
        if k == 5: return 0 if yr0 - 0.1 < yy < yr1 + 0.1 else 2  # drip rail: paint on the roof, black round the screens
        return 0 if yr0 < yy < yr1 else 1                     # roof panel, or windscreen / rear window
    _loft('Glasshouse', [v - L / 2 for v in gys], lambda yy: _ring(g_half(yy + L / 2)), g_mat, [paint, glass, trim], root)

    # B-pillar (black), following the side glass
    def g_pt(yy, k, sgn):
        x, z = g_half(yy)[k]; return (sgn * (x + 0.004), yy - L / 2, z)
    yb = S.get('bpillar', (ya + yc) / 2 - 0.1)
    bp = MB()
    for sgn in (-1, 1):
        q = [g_pt(yb - 0.05, 2, sgn), g_pt(yb + 0.05, 2, sgn), g_pt(yb + 0.05, 5, sgn), g_pt(yb - 0.05, 5, sgn)]
        bp.raw(q, [[0, 1, 2, 3], [3, 2, 1, 0]])
    bp.build('BPillar', trim, root)

    # chassis block and arch liners: nothing to see through under the car
    hw0 = _interp(S['hw'], L / 2)
    MB().box((0, 0, (S['clear'] + r * 1.6) / 2), (2 * (hw0 - 0.3), L - 0.9, r * 1.6 - S['clear'])).build('Chassis', trim, root)
    lv = MB()
    for a in ax:
        for sgn in (-1, 1):
            V = []; Fq = []
            N = 14
            for k in range(N + 1):
                th = pi * k / N
                for xx in (hw0 - 0.3, hw0 - 0.02):
                    V.append((sgn * xx, (a - L / 2) - Ra * cos(th) * 0.98, r + 0.02 + Ra * 0.98 * sin(th)))
            for k in range(N):
                Fq.append([2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2])
            lv.raw(V, Fq)
    lv.build('Liners', liner, root)

    # wheels
    tw = S.get('tyre_w', 0.225)
    for (a, tag) in ((ax[0], 'F'), (ax[1], 'R')):
        for sgn, s in ((-1, 'L'), (1, 'R')):
            _wheel(f'Wheel_{tag}{s}', root, (sgn * (hw0 - 0.14), a - L / 2, r), r, tw, sgn, tyre, rim, trim)

    # front: lights, grille, intake, plate (on the near-vertical nose face)
    y0 = -L / 2
    zf = _interp(S['top'], 0.0)
    zb0 = S['bottom'][0][1]
    hwf = _interp(S['hw'], 0.0)
    gh = S.get('grille_h', 0.1)
    hl = MB(); gl = MB(); pl = MB(); ch = MB()
    for sgn in (-1, 1):
        hl.box((sgn * (hwf - 0.16), y0 + 0.012, zf - 0.06), (0.34, 0.05, 0.07), rz=sgn * 0.16)
    hl.build('HeadLights', head, root)
    gz = zf - 0.07 - gh / 2
    gl.box((0, y0 - 0.006, gz), (2 * hwf - 0.62, 0.04, gh)).box((0, y0 + 0.0, zb0 + 0.05), (2 * hwf - 0.3, 0.05, 0.07))
    gl.build('Grille', trim, root)
    pl.box((0, y0 - 0.014, (zb0 + 0.09 + gz - gh / 2) / 2), (0.52, 0.02, 0.11))
    zr_ = _interp(S['top'], L - 0.05)
    pl.box((0, L / 2 + 0.006, S.get('rear_plate', zr_ - 0.28)), (0.52, 0.02, 0.11))
    pl.build('Plates', plate, root)
    ch.box((0, y0 - 0.012, gz + gh / 2 + 0.012), (2 * hwf - 0.66, 0.03, 0.012))
    ch.build('ChromeTrim', chrome, root)
    # rear lights
    tl = MB()
    hwr = _interp(S['hw'], L - 0.1)
    for sgn in (-1, 1):
        if S.get('tall_tail'):
            tl.box((sgn * (hwr - 0.08), L / 2 - 0.035, zr_ - 0.24), (0.14, 0.1, 0.34), rz=-sgn * 0.3)
        else:
            tl.box((sgn * (hwr - 0.2), L / 2 - 0.02, zr_ - 0.08), (0.4, 0.06, 0.08), rz=-sgn * 0.18)
    tl.build('TailLights', tail, root)
    # mirrors and door handles
    mr = MB(); hd = MB()
    ym = ya + 0.18 - L / 2
    for sgn in (-1, 1):
        zbelt = _interp(S['top'], ya + 0.18)
        mr.box((sgn * (_interp(S['hw'], ya + 0.18) + 0.08), ym, zbelt + 0.1), (0.17, 0.09, 0.12))
        mr.box((sgn * (_interp(S['hw'], ya + 0.18) + 0.01), ym + 0.02, zbelt + 0.05), (0.06, 0.05, 0.04))
        for yh in S['handles']:
            hd.box((sgn * (_interp(S['hw'], yh) + 0.012), yh - L / 2, _interp(S['top'], yh) - 0.1), (0.02, 0.15, 0.03))
    mr.build('Mirrors', paint, root)
    hd.build('Handles', chrome, root)
    # door shut lines: thin black ribbons on the body side
    sl = MB()
    for yd in S['doors']:
        for sgn in (-1, 1):
            half = _half_ring(_interp(S['hw'], yd), zb_at(yd), _interp(S['top'], yd), S.get('crown', 0.035), arch=arch_at(yd))
            side = [p for p in half[4:15]]
            V = []
            for (x, z) in side:
                for dy in (-0.004, 0.004):
                    V.append((sgn * (x + 0.003), yd - L / 2 + dy, z))
            sl.raw(V, [[2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2] if sgn > 0 else [2 * k, 2 * k + 2, 2 * k + 3, 2 * k + 1] for k in range(len(side) - 1)])
    sl.build('ShutLines', trim, root)
    for extra in S.get('extras', []):
        extra(root, S, paint, trim)


def _roof_rails(root, S, paint, trim):
    ya, yr0, yr1, yc = S['glass']
    L = S['L']
    hw = _interp(S['hw'], L / 2) - 0.05 - S.get('tumble', 0.26) - 0.04
    for sgn in (-1, 1):
        MB().box((sgn * hw, (yr0 + yr1) / 2 - L / 2, S['roof'] + 0.04), (0.04, yr1 - yr0 - 0.1, 0.05)).build(f'Rail_{sgn}', trim, root)


def _bed_cover(root, S, paint, trim):
    L = S['L']
    hw = _interp(S['hw'], L - 1.0)
    z = _interp(S['top'], L - 1.0)
    MB().box((0, (S['glass'][3] + 0.15 + L - 0.1) / 2 - L / 2, z + 0.03), (2 * hw - 0.2, L - 0.1 - S['glass'][3] - 0.15, 0.025)).build('BedCover', trim, root)
    MB().box((0, S['glass'][3] + 0.06 - L / 2, z - 0.05), (2 * hw + 0.01, 0.012, 0.22)).build('CabGap', trim, root)


SEDAN = dict(
    L=4.75, r=0.33, axles=(0.97, 3.77), clear=0.2, crown=0.04, tumble=0.27, cpillar=0.42,
    top=[(0, 0.66), (0.06, 0.72), (0.25, 0.77), (0.6, 0.81), (1.0, 0.86), (1.55, 0.93), (3.75, 0.98), (4.15, 1.0), (4.5, 0.99), (4.68, 0.95), (4.75, 0.84)],
    bottom=[(0, 0.3), (0.3, 0.22), (4.4, 0.22), (4.75, 0.38)],
    hw=[(0, 0.7), (0.12, 0.82), (0.4, 0.89), (0.95, 0.91), (3.9, 0.91), (4.4, 0.88), (4.66, 0.82), (4.75, 0.74)],
    glass=(1.55, 2.32, 3.35, 4.08), roof=1.46, bpillar=2.72,
    handles=(2.45, 3.3), doors=(1.5, 2.68, 3.62), rear_plate=0.74,
)
SUV = dict(
    L=4.88, r=0.37, axles=(0.98, 3.83), clear=0.28, crown=0.05, tumble=0.2, cpillar=0.35, tall_tail=True,
    top=[(0, 0.88), (0.06, 0.94), (0.25, 0.98), (0.6, 1.0), (1.0, 1.03), (1.5, 1.07), (4.55, 1.12), (4.8, 1.1), (4.88, 1.02)],
    bottom=[(0, 0.42), (0.3, 0.32), (4.5, 0.32), (4.88, 0.5)],
    hw=[(0, 0.78), (0.12, 0.89), (0.4, 0.95), (0.95, 0.97), (4.2, 0.97), (4.62, 0.95), (4.8, 0.9), (4.88, 0.84)],
    glass=(1.5, 2.2, 4.5, 4.8), roof=1.78, bpillar=2.75, grille_h=0.16,
    handles=(2.5, 3.45), doors=(1.45, 2.7, 3.78), rear_plate=0.86, extras=[_roof_rails],
)
PICKUP = dict(
    L=5.3, r=0.38, axles=(0.98, 4.08), clear=0.3, crown=0.04, tumble=0.22, cpillar=0.18, tall_tail=True,
    top=[(0, 0.94), (0.06, 1.0), (0.25, 1.03), (0.6, 1.05), (1.5, 1.1), (5.2, 1.13), (5.3, 1.08)],
    bottom=[(0, 0.46), (0.3, 0.35), (5.0, 0.35), (5.3, 0.55)],
    hw=[(0, 0.8), (0.12, 0.89), (0.4, 0.94), (0.9, 0.95), (5.1, 0.95), (5.3, 0.9)],
    glass=(1.55, 2.12, 3.02, 3.18), roof=1.82, bpillar=2.4, grille_h=0.2,
    handles=(2.2, 2.95), doors=(1.5, 2.5, 3.15), rear_plate=0.62, extras=[_bed_cover],
)


@asset
def car_sedan():
    vehicle('car_sedan', SEDAN)


@asset
def car_suv():
    vehicle('car_suv', SUV)


@asset
def pickup():
    vehicle('pickup', PICKUP)


def _office_chair(parent, loc=(0, 0, 0), rz=0.0):
    m = M()
    chair = empty('Chair', loc, parent, (0, 0, rz))
    cb = MB()
    for k in range(5):
        a = 2 * pi * k / 5
        cb.box((0.17 * cos(a), 0.17 * sin(a), 0.07), (0.34, 0.04, 0.03), rz=a)
        cb.cyl((0.33 * cos(a), 0.33 * sin(a), 0.0), 0.025, 0.025, 0.05, n=8)
    cb.cyl((0, 0, 0.07), 0.025, 0.025, 0.36, n=10)
    cb.build('Base', m['black'], chair)
    MB().box((0, 0, 0.47), (0.5, 0.48, 0.08)).box((0, -0.25, 0.8), (0.46, 0.06, 0.55)).build('Seat', mat('Fabric', (0.16, 0.18, 0.22), 0.9), chair, bevel=0.02)
    return chair


@asset
def office_chair():
    root = empty('office_chair')  # sits facing -Y, like the desk set's chair
    _office_chair(root)


@asset
def bus_shelter():
    """a 4 m bus shelter: steel frame, glass back and one side, a canopy, a bench (opens toward -Y, the road)"""
    m = M()
    root = empty('bus_shelter')
    W, D, H = 4.0, 1.5, 2.45
    fr = MB()
    for x in (-W / 2, 0, W / 2):
        fr.box((x, D / 2, H / 2), (0.08, 0.08, H))
    fr.box((W / 2, -D / 2 + 0.2, H / 2), (0.08, 0.08, H))
    fr.box((0, D / 2, 0.12), (W, 0.06, 0.06)).box((0, D / 2, H - 0.1), (W, 0.06, 0.06)).box((W / 2, 0.05, 0.12), (0.06, D - 0.3, 0.06))
    fr.build('Frame', m['darksteel'], root, bevel=0.01)
    MB().box((0, 0.1, H + 0.04), (W + 0.3, D + 0.4, 0.1)).build('Canopy', mat('ShelterRoof', (0.78, 0.79, 0.8), 0.35, 0.6), root, bevel=0.02)
    gl = MB()
    gl.box((-W / 4, D / 2, 1.3), (W / 2 - 0.1, 0.012, 2.0)).box((W / 4, D / 2, 1.3), (W / 2 - 0.1, 0.012, 2.0)).box((W / 2, 0.05, 1.3), (0.012, D - 0.3, 2.0))
    gl.build('Glass', mat('ShelterGlass', (0.75, 0.82, 0.84), 0.05, 0.0, alpha=0.22, double=True), root)
    b = MB()
    for i in range(3):
        b.box((-0.6, 0.35 + i * 0.13, 0.46), (2.2, 0.1, 0.035))
    b.build('BenchSlats', mat('Teak', (0.42, 0.28, 0.16), 0.6), root, bevel=0.005)
    MB().box((-1.6, 0.48, 0.22), (0.05, 0.3, 0.44)).box((0.4, 0.48, 0.22), (0.05, 0.3, 0.44)).build('BenchLegs', m['darksteel'], root)


@asset
def street_bin():
    m = M()
    root = empty('street_bin')
    MB().cyl((0, 0, 0.04), 0.24, 0.24, 0.86, n=24).build('Body', mat('BinSteel', (0.2, 0.21, 0.22), 0.45, 0.7), root, bevel=0.01)
    MB().cyl((0, 0, 0.9), 0.26, 0.2, 0.12, n=24).build('Lid', mat('BinLid', (0.62, 0.63, 0.64), 0.35, 0.9), root, bevel=0.01)
    MB().box((0, -0.24, 0.8), (0.22, 0.04, 0.12)).build('Slot', m['black'], root)
    MB().cyl((0, 0, 0), 0.2, 0.2, 0.04, n=16).build('Foot', m['darksteel'], root)


@asset
def crossing_sign():
    """pedestrian-crossing sign: a blue square with a white walking figure (a pictogram, no text)"""
    m = M()
    root = empty('crossing_sign')
    MB().cyl((0, 0, 0), 0.04, 0.04, 2.9, n=10).build('Pole', m['steel'], root)
    MB().box((0, -0.03, 2.6), (0.6, 0.02, 0.6)).build('Panel', mat('SignBlue', (0.03, 0.16, 0.5), 0.5), root, bevel=0.01)
    f = MB()
    f.sphere((0.02, -0.045, 2.79), 0.04, n=10, m=6)
    f.raw([(-0.02, -0.042, 2.73), (0.06, -0.042, 2.73), (0.04, -0.042, 2.58), (-0.04, -0.042, 2.6)], [[0, 3, 2, 1]])
    f.raw([(-0.04, -0.042, 2.6), (0.0, -0.042, 2.6), (-0.1, -0.042, 2.42), (-0.14, -0.042, 2.44)], [[0, 3, 2, 1]])
    f.raw([(0.0, -0.042, 2.6), (0.04, -0.042, 2.58), (0.12, -0.042, 2.43), (0.08, -0.042, 2.41)], [[0, 3, 2, 1]])
    f.raw([(-0.2, -0.042, 2.38), (0.2, -0.042, 2.38), (0.2, -0.042, 2.36), (-0.2, -0.042, 2.36)], [[0, 3, 2, 1]])
    f.build('Figure', mat('SignWhite', (0.92, 0.92, 0.9), 0.5), root)


@asset
def palm():
    import random
    rnd = random.Random(7)
    root = empty('palm')
    H = 6.2
    pts, rad = [], []
    for i in range(26):
        t = i / 25
        pts.append((0.35 * t * t, 0.1 * t * t, H * t)); rad.append(0.24 - 0.08 * t + (0.012 if i % 2 else 0))
    MB().tube(pts, rad, n=12).build('Trunk', mat('PalmBark', (0.38, 0.32, 0.25), 0.9), root)
    top = pts[-1]
    MB().sphere((top[0], top[1], top[2] - 0.2), 0.32, n=12, m=8, sz=1.3).build('Crown', mat('PalmBoot', (0.33, 0.29, 0.2), 0.9), root)
    fr = MB(); dead = MB()
    N = 22
    for k in range(N):
        a = 2 * pi * k / N + rnd.uniform(-0.1, 0.1)
        ring = k % 3
        lift = (0.85, 0.45, 0.1)[ring] + rnd.uniform(-0.1, 0.1)
        Lf = rnd.uniform(2.7, 3.2)
        droop = (0.45, 0.6, 0.8)[ring]
        tgt = fr
        if k % 8 == 5:
            tgt = dead; lift = -1.6; Lf = 1.7; droop = 0.1
        da, db = cos(a), sin(a)
        spine = []
        NS = 22
        for j in range(NS + 1):
            s = j / NS
            spine.append((top[0] + da * Lf * s, top[1] + db * Lf * s, top[2] + Lf * (lift * s - droop * s * s)))
        tgt.tube(spine, [0.035 * (1 - s / 1.15) + 0.006 for s in [j / NS for j in range(NS + 1)]], n=4)
        for j in range(2, NS):
            s = j / NS
            p = spine[j]
            ln = 0.85 * math.sin(pi * min(1.0, s * 1.05)) ** 0.7 + 0.1
            for side in (-1, 1):
                px, py = -db * side, da * side
                tip = (p[0] + px * ln + da * 0.18, p[1] + py * ln + db * 0.18, p[2] - 0.35 * ln)
                base2 = (p[0] + da * 0.11, p[1] + db * 0.11, p[2] + 0.005)
                mid = (p[0] + px * ln * 0.5 + da * 0.12, p[1] + py * ln * 0.5 + db * 0.12, p[2] - 0.12 * ln + 0.03)
                tgt.raw([p, base2, mid, tip], [[0, 2, 1], [1, 2, 3]])
    fr.build('Fronds', mat('PalmLeaf', (0.13, 0.22, 0.08), 0.65, double=True), root)
    dead.build('DeadFronds', mat('PalmDead', (0.42, 0.33, 0.18), 0.85, double=True), root)


@asset
def street_lamp():
    m = M()
    root = empty('street_lamp')  # arm reaches toward +X (the road)
    MB().cyl((0, 0, 0), 0.11, 0.07, 8.0, n=12).cyl((0, 0, 0), 0.18, 0.18, 0.5, n=8, smooth=False).build('Pole', m['steel'], root)
    MB().tube([(0, 0, 7.6), (0.6, 0, 8.05), (1.6, 0, 8.1)], [0.05, 0.045, 0.04], n=8).build('Arm', m['steel'], root)
    MB().box((1.75, 0, 8.08), (0.65, 0.28, 0.12)).build('Head', m['darksteel'], root, bevel=0.03)
    MB().box((1.75, 0, 8.015), (0.5, 0.2, 0.01)).build('LampLight', mat('LampLight', (1, 0.85, 0.6), 0.3, 0, (1.0, 0.8, 0.55), 2.5), root)


@asset
def bollard():
    root = empty('bollard')
    MB().cyl((0, 0, 0), 0.1, 0.1, 0.9, n=14).build('Body', mat('DarkSteel', (0.12, 0.12, 0.13), 0.5, 0.8), root, bevel=0.02)


@asset
def bench():
    m = M()
    root = empty('bench')
    s = MB()
    for i in range(4):
        s.box((0, -0.18 + i * 0.12, 0.45), (1.8, 0.09, 0.035))
    for i in range(2):
        s.box((0, 0.24, 0.62 + i * 0.13), (1.8, 0.03, 0.09))
    s.build('Slats', mat('Teak', (0.42, 0.28, 0.16), 0.6), root, bevel=0.005)
    f = MB()
    for x in (-0.75, 0.75):
        f.box((x, 0, 0.22), (0.06, 0.5, 0.44)).box((x, 0.25, 0.6), (0.06, 0.04, 0.4))
    f.build('Frame', m['darksteel'], root)


# ───────────────────────── desert site ─────────────────────────
@asset
def container_office():
    root = empty('container_office')  # 20 ft: 6.06 x 2.44 x 2.59 m; long axis X; door on -Y side
    L, W, H = 6.06, 2.44, 2.59
    paint = mat('ContainerPaint', (0.62, 0.6, 0.55), 0.7, 0.2)
    MB().box((0, 0, H / 2), (L, W, H)).build('Box', paint, root)
    rib = MB()
    n = int(L / 0.28)
    for i in range(n):
        x = -L / 2 + 0.14 + i * 0.28
        rib.box((x, -W / 2 - 0.015, H / 2), (0.1, 0.03, H - 0.25)).box((x, W / 2 + 0.015, H / 2), (0.1, 0.03, H - 0.25))
    rib.build('Ribs', paint, root)
    fr = MB()
    for x in (-L / 2, L / 2):
        for y in (-W / 2, W / 2):
            fr.box((x, y, H / 2), (0.16, 0.16, H))
    fr.box((0, -W / 2, H - 0.06), (L, 0.16, 0.12)).box((0, W / 2, H - 0.06), (L, 0.16, 0.12)).box((0, -W / 2, 0.06), (L, 0.16, 0.12)).box((0, W / 2, 0.06), (L, 0.16, 0.12))
    fr.build('Frame', mat('ContainerFrame', (0.4, 0.38, 0.34), 0.7, 0.3), root)
    MB().box((1.2, -W / 2 - 0.04, 1.05), (0.9, 0.04, 2.05)).build('Door', mat('DoorGrey', (0.5, 0.5, 0.48), 0.6, 0.2), root, bevel=0.01)
    MB().box((-1.4, -W / 2 - 0.04, 1.5), (1.1, 0.03, 0.8)).build('Window', mat('Glass', (0.04, 0.05, 0.06), 0.05, 0.0, alpha=0.55), root)
    MB().box((-2.4, -W / 2 - 0.25, 1.9), (0.75, 0.45, 0.5)).build('ACUnit', mat('WhitePlastic', (0.82, 0.82, 0.8), 0.55), root, bevel=0.02)
    MB().box((1.2, -W / 2 - 0.6, 0.1), (1.4, 1.0, 0.2)).build('Step', mat('Concrete', (0.55, 0.54, 0.52), 0.85), root)


@asset
def generator():
    root = empty('generator')
    body = mat('GenPaint', (0.7, 0.69, 0.62), 0.6, 0.2)
    MB().box((0, 0, 0.7), (2.2, 1.1, 1.1)).build('Enclosure', body, root, bevel=0.03)
    v = MB()
    for i in range(14):
        v.box((-0.9 + i * 0.07, -0.56, 0.85), (0.035, 0.02, 0.45))
    v.build('Vents', mat('DarkSteel', (0.12, 0.12, 0.13), 0.5, 0.8), root)
    MB().box((0, 0, 0.08), (2.4, 1.2, 0.16)).build('Skid', mat('DarkSteel', (0.12, 0.12, 0.13), 0.5, 0.8), root)
    MB().cyl((0.8, 0.3, 1.25), 0.06, 0.06, 0.7, n=10).build('Exhaust', mat('Rust', (0.3, 0.17, 0.1), 0.8, 0.4), root)


@asset
def water_dispenser():
    """an office water cooler: white cabinet, two taps, a drip tray, a blue 19 l bottle on top"""
    m = M()
    root = empty('water_dispenser')
    MB().box((0, 0, 0.5), (0.32, 0.32, 1.0)).build('Cabinet', mat('CoolerWhite', (0.86, 0.86, 0.84), 0.45), root, bevel=0.015)
    MB().box((0, -0.162, 0.82), (0.24, 0.01, 0.2)).build('Panel', m['black'], root)
    MB().cyl((-0.05, -0.17, 0.8), 0.014, 0.014, 0.04, n=10, axis='y').build('TapCold', mat('TapBlue', (0.05, 0.2, 0.7), 0.4), root)
    MB().cyl((0.05, -0.17, 0.8), 0.014, 0.014, 0.04, n=10, axis='y').build('TapHot', mat('TapRed', (0.7, 0.05, 0.04), 0.4), root)
    MB().box((0, -0.2, 0.62), (0.2, 0.08, 0.02)).build('Tray', m['darksteel'], root)
    b = MB(); b.cyl((0, 0, 1.0), 0.06, 0.06, 0.05, n=16).cyl((0, 0, 1.05), 0.135, 0.135, 0.38, n=24).sphere((0, 0, 1.43), 0.135, n=24, m=8, sz=0.35)
    b.build('Bottle', mat('BottleBlue', (0.35, 0.6, 0.85), 0.08, 0.0, alpha=0.5), root)


@asset
def printer():
    """a floor-standing office printer on its cabinet (generic: no badge, no text)"""
    m = M()
    root = empty('printer')
    MB().box((0, 0, 0.22), (0.62, 0.58, 0.44)).build('Cabinet', mat('PrinterDark', (0.2, 0.2, 0.21), 0.5), root, bevel=0.01)
    MB().box((0, 0, 0.72), (0.6, 0.56, 0.56)).box((0, 0.02, 1.04), (0.58, 0.5, 0.08)).build('Body', mat('PrinterGrey', (0.78, 0.78, 0.76), 0.45), root, bevel=0.012)
    MB().box((0, -0.06, 0.82), (0.48, 0.36, 0.015)).build('OutputTray', mat('PrinterDark', (0.2, 0.2, 0.21), 0.5), root)
    MB().box((0, -0.05, 0.84), (0.21, 0.297, 0.01)).build('Paper', mat('Paper', (0.95, 0.95, 0.93), 0.8), root)
    MB().box((0.18, -0.27, 1.06), (0.2, 0.08, 0.03)).build('Controls', m['black'], root)
    MB().box((0.18, -0.312, 1.07), (0.12, 0.003, 0.02)).build('Display', mat('PrinterScreen', (0.05, 0.1, 0.15), 0.2, 0, (0.4, 0.65, 0.9), 0.8), root)
    for k in range(3):
        MB().box((0, -0.291, 0.08 + k * 0.13), (0.5, 0.008, 0.012)).build(f'Drawer_{k}', m['black'], root)


@asset
def whiteboard():
    """a wall whiteboard (faces -Y) with a marker tray and a sketched network diagram: boxes and links, no text"""
    m = M()
    root = empty('whiteboard')
    W, H, z0 = 1.8, 1.05, 0.95
    MB().box((0, 0, z0 + H / 2), (W, 0.02, H)).build('Board', mat('BoardWhite', (0.93, 0.94, 0.94), 0.18), root)
    fr = MB()
    fr.box((0, -0.012, z0), (W + 0.04, 0.03, 0.03)).box((0, -0.012, z0 + H), (W + 0.04, 0.03, 0.03)).box((-W / 2, -0.012, z0 + H / 2), (0.03, 0.03, H)).box((W / 2, -0.012, z0 + H / 2), (0.03, 0.03, H))
    fr.box((0, -0.05, z0 - 0.02), (0.6, 0.07, 0.015))
    fr.build('Frame', m['alu'], root)
    ink = MB()
    def rect(cx, cz, w, h, t=0.008):
        for (x, z, sx, sz) in ((cx, cz + h / 2, w, t), (cx, cz - h / 2, w, t), (cx - w / 2, cz, t, h), (cx + w / 2, cz, t, h)):
            ink.box((x, -0.0115, z), (sx, 0.002, sz))
    def line(x0, z0_, x1, z1, t=0.007):
        import math as _m
        L = _m.hypot(x1 - x0, z1 - z0_); a = _m.atan2(z1 - z0_, x1 - x0)
        cx, cz = (x0 + x1) / 2, (z0_ + z1) / 2
        o = len(ink.v)
        ink.box((cx, -0.0115, cz), (L, 0.002, t))
        for q in range(o, o + 8):
            x, y, z = ink.v[q]; dx, dz = x - cx, z - cz
            ink.v[q] = (cx + dx * _m.cos(a) - dz * _m.sin(a), y, cz + dx * _m.sin(a) + dz * _m.cos(a))
    zc = z0 + H / 2
    rect(-0.6, zc + 0.25, 0.3, 0.16); rect(0.0, zc + 0.25, 0.3, 0.16); rect(0.6, zc + 0.25, 0.3, 0.16); rect(0.0, zc - 0.25, 0.42, 0.18)
    line(-0.45, zc + 0.25, -0.15, zc + 0.25); line(0.15, zc + 0.25, 0.45, zc + 0.25); line(0.0, zc + 0.17, 0.0, zc - 0.16)
    line(-0.6, zc + 0.17, -0.2, zc - 0.17); line(0.6, zc + 0.17, 0.2, zc - 0.17)
    ink.build('Ink', mat('MarkerBlue', (0.04, 0.1, 0.35), 0.5), root)
    pens = MB()
    for k in range(3):
        pens.cyl((-0.15 + k * 0.12, -0.05, z0 - 0.005), 0.009, 0.009, 0.13, n=8, axis='x')
    pens.build('Markers', mat('MarkerBody', (0.1, 0.1, 0.12), 0.5), root)


@asset
def windsock():
    """a site windsock: a 5 m mast and a striped sock on a swivel ('Sock', pivot at the mast top, sock along +X)"""
    m = M()
    root = empty('windsock')
    MB().cyl((0, 0, 0), 0.05, 0.035, 5.0, n=10).cyl((0, 0, 0), 0.14, 0.14, 0.12, n=10, smooth=False).build('Mast', m['steel'], root)
    piv = empty('Sock', (0, 0, 5.0), root)
    MB().tube([(0.0, 0, 0.0), (0.14, 0, 0.0)], [0.2, 0.2], n=16).build('Ring', m['steel'], piv)
    orange = MB(); white = MB()
    N = 5; Lk = 1.7
    for k in range(N):
        x0, x1 = 0.14 + Lk * k / N, 0.14 + Lk * (k + 1) / N
        r0, r1 = 0.2 - 0.1 * k / N, 0.2 - 0.1 * (k + 1) / N
        (orange if k % 2 == 0 else white).cyl((x0, 0, 0), r0, r1, x1 - x0, n=16, axis='x', caps=False)
    orange.build('SockOrange', mat('SockOrange', (0.9, 0.3, 0.05), 0.85, double=True), piv)
    white.build('SockWhite', mat('SockWhite', (0.9, 0.9, 0.88), 0.85, double=True), piv)


# (the café tables, plants, rocks and the placeholder mannequin are now Poly Haven / Rocketbox: see import_polyhaven.py, import_rocketbox.py)
# ───────────────────────── run ─────────────────────────
for name, fn in ASSETS.items():
    if ONLY and name not in ONLY:
        continue
    reset()
    fn()
    export(name)
print('DONE', len(ASSETS))
