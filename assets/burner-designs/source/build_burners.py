"""Parametric, original burner design proposals. Blender 5.1; no external assets.

Run: blender --background --factory-startup --python build_burners.py -- --out DIR
Authoring space is Blender Z-up; exported GLBs and outlet JSON are glTF Y-up.
Every dimension is in metres. See ../README.md for the attachment contract.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

TAU = math.tau
P = {
    'annular': {'radius': .275, 'slot_count': 24, 'slot_length': .068,
                'slot_width': .014, 'outlet_height': .228},
    'linear': {'length': 1.06, 'slot_length': .88, 'slot_width': .016,
               'outlet_height': .252},
    'nozzle': {'pitch_degrees': 14, 'mouth_radius': .059,
               'pivot_height': .292, 'mouth_station': .215},
}
M = {}
ROOT = None
PARTS = {}
OUTLETS = {}


def gltf(v):
    """Blender (X,Y,Z) -> glTF (X,Z,-Y), a proper rotation."""
    return [round(float(v[0]), 8), round(float(v[2]), 8), round(-float(v[1]), 8)]


def material(name, rgb, metal=0, rough=.4):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    M[name] = m
    return m


def finish(obj, name, mat, bevel=0, smooth=False, parent=None):
    obj.name = name
    obj.data.name = name + '_mesh'
    obj.parent = parent or ROOT
    obj.data.materials.append(M[mat])
    if bevel:
        b = obj.modifiers.new('Machined edge radii', 'BEVEL')
        b.width = bevel
        b.segments = 3
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    # Weighted normals keep broad manufactured faces planar after beveling.
    if bevel:
        n = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        n.keep_sharp = True
        n.weight = 50
    obj['component'] = name
    return obj


def box(name, size, pos, mat, bevel=.003, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, name, mat, bevel, parent=parent)


def cylinder(name, r, depth, pos, mat, axis=(0, 0, 1), vertices=64, bevel=.001):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=r, depth=depth, location=pos)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector(axis).to_track_quat('Z', 'Y')
    return finish(o, name, mat, bevel, smooth=vertices > 12)


def mesh(name, verts, faces, mat, bevel=0, smooth=False):
    me = bpy.data.meshes.new(name + '_mesh')
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return finish(o, name, mat, bevel, smooth)


def lathe(name, profile, mat, center=(0, 0, 0), axis=(0, 0, 1), segments=128, bevel=.0007):
    # Closed profile includes the inner return: these are hollow solids, not disks.
    q = Vector(axis).to_track_quat('Z', 'Y')
    c = Vector(center)
    verts = []
    for r, z in profile:
        for i in range(segments):
            a = TAU * i / segments
            verts.append(c + q @ Vector((r * math.cos(a), r * math.sin(a), z)))
    faces = []
    for j in range(len(profile)):
        k = (j + 1) % len(profile)
        for i in range(segments):
            ni = (i + 1) % segments
            faces.append((j * segments + i, j * segments + ni,
                          k * segments + ni, k * segments + i))
    # Recalculate from geometric connectivity, including inner surfaces.
    o = mesh(name, verts, faces, mat, bevel, True)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    o.select_set(False)
    return o


def ring(name, ri, ro, lo, hi, mat, **kwargs):
    return lathe(name, [(ri, lo), (ro, lo), (ro, hi), (ri, hi)], mat, **kwargs)


def capsule_cutter(length, width, depth, pos, angle=0):
    # Extruded capsule with rounded ends; planar sides are radial/tangential.
    r = width / 2
    h = (length - width) / 2
    loop = []
    for cx, start in [(h, -math.pi / 2), (-h, math.pi / 2)]:
        for i in range(13):
            a = start + math.pi * i / 12
            x, y = cx + r * math.cos(a), r * math.sin(a)
            loop.append((x * math.cos(angle) - y * math.sin(angle),
                         x * math.sin(angle) + y * math.cos(angle)))
    n = len(loop)
    verts = [(x + pos[0], y + pos[1], z + pos[2])
             for z in [-depth / 2, depth / 2] for x, y in loop]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh('temporary_aperture_tool', verts, faces, 'steel')


def cut(obj, cutter):
    bpy.context.view_layer.objects.active = obj
    b = obj.modifiers.new('Actual through aperture', 'BOOLEAN')
    b.operation = 'DIFFERENCE'
    b.solver = 'EXACT'
    b.object = cutter
    # Put aperture before edge treatment for a small visible rim on every port.
    bpy.ops.object.modifier_move_to_index(modifier=b.name, index=0)
    bpy.ops.object.modifier_apply(modifier=b.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def bolt(name, pos, radius=.009, axis=(0, 0, 1), mat='steel'):
    p = Vector(pos)
    a = Vector(axis)
    cylinder(name + '_washer', radius * 1.28, .002, p - a * .002, 'dark_steel', axis, 32, .0004)
    head = cylinder(name + '_hex_head', radius, .006, p + a * .0015, mat, axis, 6, .0005)
    # A small actual hex socket (not painted aperture).
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius * .40, depth=.004,
                                      location=p + a * .004)
    tool = bpy.context.object
    tool.rotation_mode = 'QUATERNION'
    tool.rotation_quaternion = a.to_track_quat('Z', 'Y')
    cut(head, tool)


def tube(name, points, radius, mat):
    cu = bpy.data.curves.new(name + '_path', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.resolution_u = 16
    cu.use_fill_caps = True
    s = cu.splines.new('BEZIER')
    s.bezier_points.add(len(points) - 1)
    for b, p in zip(s.bezier_points, points):
        b.co = p
        b.handle_left_type = 'AUTO'
        b.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    return finish(o, name, mat, smooth=True)


def label(name, text, pos, size, mat, rotation=(0, 0, 0)):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = .00012
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    o.location = pos
    o.rotation_euler = rotation
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o.select_set(False)
    return finish(o, name, mat)


def root(name, description):
    global ROOT
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o['design'] = description
    o['units'] = 'metres'
    o['coordinate_convention'] = 'Exported glTF: right handed; +Y up; +X right; +Z forward; ground origin'
    ROOT = o
    return o


def outlet(asset, name, pos, direction, aperture):
    row = {'id': name, 'position': gltf(pos), 'direction': gltf(direction),
           'aperture': aperture, 'space': 'assembly_root_local', 'units': 'metres'}
    OUTLETS.setdefault(asset, []).append(row)
    o = bpy.data.objects.new('outlet_' + name, None)
    bpy.context.collection.objects.link(o)
    o.parent = ROOT
    o.location = pos
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector(direction).to_track_quat('Z', 'Y')
    o['outlet_json'] = json.dumps(row)
    o['role'] = 'proposed_emission_aperture'
    o.empty_display_size = .015
    return row


def annular():
    cfg = P['annular']
    r = root('annular_burner', 'CORONA / 24 radial ports around a clear central opening')
    # Three cast legs leave the through-opening visually and physically clear.
    for i in range(3):
        a = TAU * i / 3 + math.pi / 6
        p = Vector((.286 * math.cos(a), .286 * math.sin(a), 0))
        f = box(f'foot_{i+1:02}', (.112, .095, .018), p + Vector((0, 0, .009)), 'rubber', .009)
        f.rotation_euler.z = a
        leg = box(f'cast_pedestal_{i+1:02}', (.073, .060, .098), p + Vector((0, 0, .063)), 'graphite', .009)
        leg.rotation_euler.z = a
        bolt(f'foot_anchor_{i+1:02}', p + Vector((0, 0, .117)), .011)
    lathe('hollow_bronze_plenum', [(.191, .104), (.353, .104), (.353, .202),
          (.336, .202), (.336, .126), (.208, .126), (.208, .202), (.191, .202)], 'bronze', bevel=.002)
    ring('lower_machined_bead', .190, .359, .108, .122, 'bronze_dark')
    ring('inner_lid_seal', .188, .211, .198, .203, 'dark_steel')
    ring('outer_lid_seal', .333, .359, .198, .203, 'dark_steel')
    lid = ring('removable_port_crown', .183, .365, .203, cfg['outlet_height'], 'bronze', bevel=.001)
    for i in range(cfg['slot_count']):
        a = TAU * i / cfg['slot_count']
        p = (cfg['radius'] * math.cos(a), cfg['radius'] * math.sin(a), cfg['outlet_height'])
        cut(lid, capsule_cutter(cfg['slot_length'], cfg['slot_width'], .065, p, a))
        outlet('annular', f'radial_slot_{i+1:02}', p, (0, 0, 1), {
            'shape': 'capsule', 'length': cfg['slot_length'], 'width': cfg['slot_width'],
            'major_axis': gltf((math.cos(a), math.sin(a), 0)), 'normal': [0, 1, 0],
            'thickness': .025, 'open_into': 'hollow_bronze_plenum'})
    ring('inner_polished_guard_lip', .179, .190, .214, .239, 'steel', bevel=.001)
    ring('outer_polished_crown_rim', .357, .369, .211, .235, 'steel', bevel=.001)
    for i in range(12):
        a = TAU * (i + .25) / 12
        bolt(f'crown_fastener_{i+1:02}', (.337 * math.cos(a), .337 * math.sin(a), .230), .007)
    # Rear fuel union and an upright handwheel make orientation readable.
    cylinder('rear_manifold_stub', .023, .105, (0, .394, .156), 'bronze_dark', (0, 1, 0))
    cylinder('rear_hex_union', .034, .033, (0, .431, .156), 'brass', (0, 1, 0), 6)
    cylinder('rear_hose_barb', .017, .048, (0, .465, .156), 'steel', (0, 1, 0))
    for y in [.455, .465, .475]:
        cylinder('barb_ridge_' + str(y), .020, .004, (0, y, .156), 'steel', (0, 1, 0))
    cylinder('valve_stem', .007, .054, (0, .394, .208), 'steel')
    ring('teal_valve_handwheel', .018, .036, .231, .241, 'teal', center=(0, .394, 0), bevel=.002)
    for i in range(3):
        a = TAU * i / 3
        o = box(f'valve_spoke_{i}', (.032, .008, .007), (.014 * math.cos(a), .394 + .014 * math.sin(a), .236), 'teal', .002)
        o.rotation_euler.z = a
    box('corona_identity_plate', (.160, .008, .032), (0, -.354, .158), 'bronze_dark', .003)
    label('corona_name', 'CORONA  /  24', (0, -.359, .158), .015, 'steel', (math.pi/2, 0, 0))
    return r


def linear():
    c = P['linear']
    r = root('linear_burner', 'RIFT / continuous recessed ribbon slot in replaceable ceramic lips')
    L = c['length']
    for i, x in enumerate([-.37, .37]):
        box(f'crossfoot_{i+1}', (.108, .286, .027), (x, 0, .0255), 'graphite', .008)
        for j, y in enumerate([-.104, .104]):
            box(f'isolator_{i+1}_{j+1}', (.086, .060, .012), (x, y, .006), 'rubber', .004)
            bolt(f'base_fixing_{i+1}_{j+1}', (x, y, .043), .009)
        box(f'raised_saddle_{i+1}', (.068, .136, .066), (x, 0, .066), 'teal', .005)
    box('plenum_floor', (L, .176, .019), (0, 0, .1045), 'dark_steel', .004)
    # Four separately named walls form an open, recessed chamber.
    for side in [-1, 1]:
        box('chassis_wall_' + ('front' if side < 0 else 'rear'), (L, .018, .107),
            (0, side * .084, .164), 'graphite', .006)
        box('upper_stainless_trim_' + str(side), (.970, .012, .016), (0, side * .091, .214), 'steel', .002)
        for i in range(17):
            x = -.448 + i * .056
            box(f'cooling_rib_{side}_{i+1:02}', (.012, .013, .064), (x, side * .098, .159), 'dark_steel', .002)
        # Two lips are distinct continuous solids. The space between is the slot.
        lipwidth = .063
        y = side * (c['slot_width'] / 2 + lipwidth / 2)
        box('ceramic_lip_' + ('front' if side < 0 else 'rear'),
            (c['slot_length'], lipwidth, .038), (0, y, .233), 'ceramic', .003)
        box('lip_retainer_' + str(side), (.94, .014, .023), (0, side * .078, .235), 'steel', .002)
        for i, x in enumerate([-.43, -.215, 0, .215, .43]):
            bolt(f'retainer_screw_{side}_{i+1}', (x, side * .078, .249), .006)
    for i, x in enumerate([-L / 2 + .018, L / 2 - .018]):
        box(f'teal_end_block_{i+1}', (.036, .191, .128), (x, 0, .166), 'teal', .007)
        box(f'end_slot_stop_{i+1}', (.030, .140, .038),
            ((c['slot_length'] / 2 + .015) * (-1 if i == 0 else 1), 0, .233), 'ceramic', .002)
        for j, y in enumerate([-.060, .060]):
            bolt(f'end_cap_screw_{i+1}_{j+1}', (x, y, .234), .007)
    # Recessed two-sided baffle leaves the central emission path unobstructed.
    for side in [-1, 1]:
        box('internal_baffle_' + str(side), (.86, .018, .018), (0, side * .031, .173), 'bronze_dark', .002)
    cylinder('right_fuel_union', .026, .045, (.546, 0, .153), 'brass', (1, 0, 0), 6)
    cylinder('right_inlet_barb', .014, .043, (.587, 0, .153), 'steel', (1, 0, 0))
    for x in [.580, .590, .600]:
        cylinder('inlet_ridge_' + str(x), .017, .004, (x, 0, .153), 'steel', (1, 0, 0))
    box('front_identity_plate', (.188, .008, .044), (0, -.110, .161), 'bronze', .002)
    label('rift_name', 'RIFT   /   880', (0, -.115, .163), .018, 'dark_steel', (math.pi / 2, 0, 0))
    outlet('linear', 'ribbon_slot', (0, 0, c['outlet_height']), (0, 0, 1), {
        'shape': 'rectangle', 'length': c['slot_length'], 'width': c['slot_width'],
        'major_axis': [1, 0, 0], 'minor_axis': [0, 0, 1],
        'endpoints': [[-c['slot_length']/2, c['outlet_height'], 0],
                      [c['slot_length']/2, c['outlet_height'], 0]],
        'open_into': 'open_plenum_between_chassis_walls'})
    return r


def nozzle():
    c = P['nozzle']
    r = root('directional_nozzle', 'VECTOR / hollow converging nozzle, trunnion yoke, raised aim')
    a = math.radians(c['pitch_degrees'])
    d = Vector((0, -math.cos(a), math.sin(a)))
    p = Vector((0, 0, c['pivot_height']))
    box('yoke_base_plate', (.290, .286, .025), (0, .008, .0245), 'graphite', .012)
    for i, x in enumerate([-.105, .105]):
        for j, y in enumerate([-.085, .105]):
            box(f'base_rubber_pad_{i}_{j}', (.060, .055, .012), (x, y, .006), 'rubber', .006)
            bolt(f'base_bolt_{i}_{j}', (x, y, .041), .009)
    box('yoke_bridge', (.228, .106, .030), (0, .012, .061), 'teal', .007)
    for side in [-1, 1]:
        # Hexagonal upright silhouette with relieved neck rather than a raw box.
        poly = [(-.070, .072), (.070, .072), (.060, .267), (.035, .322),
                (-.035, .322), (-.060, .267)]
        verts = [(side * .107 + dx, y, z) for dx in [-.014, .014] for y, z in poly]
        n = len(poly)
        faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
        faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
        mesh('cast_yoke_' + str(side), verts, faces, 'teal', .006)
        cylinder('trunnion_bearing_' + str(side), .034, .038, (side * .110, 0, p.z), 'steel', (1, 0, 0))
        cylinder('trunnion_cap_' + str(side), .026, .012, (side * .136, 0, p.z), 'bronze', (1, 0, 0), 48)
    # One continuous hollow turned shell: outer taper and a visible inner return.
    lathe('hollow_tapered_barrel', [(.078, -.154), (.090, -.128), (.090, -.025),
          (.080, .075), (.071, .187), (.071, .205), (.059, .205),
          (.057, .174), (.047, .065), (.041, -.030), (.041, -.154)],
          'steel', p, d, bevel=.0013)
    lathe('teal_rear_jacket', [(.090, -.125), (.098, -.125), (.098, -.032), (.089, -.032)],
          'teal', p, d, bevel=.002)
    # Raised circumferential cooling ribs separated by visible air gaps.
    for i in range(5):
        t = -.118 + i * .018
        ring(f'cooling_fin_{i+1}', .095, .111, t, t + .007, 'dark_steel', center=p, axis=d, bevel=.001)
    for i, t in enumerate([-.020, .055, .155]):
        rad = .090 if i == 0 else (.083 if i == 1 else .075)
        ring(f'barrel_band_{i+1}', rad-.005, rad+.005, t, t+.012, 'bronze_dark', center=p, axis=d)
    ring('copper_outlet_lip', c['mouth_radius'], .080, .192, c['mouth_station'],
         'copper', center=p, axis=d, bevel=.0013)
    # A ring deep in the bore makes its converging depth visible without capping it.
    ring('internal_throat_seat', .038, .043, -.058, -.046, 'dark_steel', center=p, axis=d)
    ring('rear_union_flange', .020, .078, -.169, -.154, 'dark_steel', center=p, axis=d)
    cylinder('rear_fuel_hex_union', .029, .043, p + d * -.184, 'brass', d, 6)
    cylinder('rear_fuel_tail', .015, .045, p + d * -.225, 'steel', d)
    for t in [-.215, -.225, -.235]:
        cylinder('rear_hose_ridge_' + str(t), .018, .004, p+d*t, 'steel', d)
    # Locking wheel is open between its spokes.
    ring('orange_aim_lockwheel', .025, .049, .147, .159, 'orange',
         center=(0, 0, p.z), axis=(1, 0, 0), bevel=.002)
    cylinder('lockwheel_hub', .017, .018, (.153, 0, p.z), 'orange', (1, 0, 0))
    for i in range(3):
        aa = TAU * i / 3
        o = box(f'lockwheel_spoke_{i}', (.010, .040, .009),
                (.153, .022*math.cos(aa), p.z+.022*math.sin(aa)), 'orange', .002)
        o.rotation_euler.x = aa
    # Index ticks on the exposed left pivot bezel; each remains a mesh.
    for i in range(7):
        aa = math.radians(-45 + 15*i)
        o = box(f'aim_index_{i}', (.0015, .010 if i%2==0 else .006, .0018),
                (-.145, -.043*math.cos(aa), p.z+.043*math.sin(aa)), 'steel', .0003)
        o.rotation_euler.x = -aa
    label('vector_name', 'VECTOR', (0, -.109, .039), .021, 'steel')
    outlet('nozzle', 'round_mouth', p+d*c['mouth_station'], d, {
        'shape': 'circle', 'radius': c['mouth_radius'], 'diameter': c['mouth_radius']*2,
        'pitch_degrees': c['pitch_degrees'], 'yaw_degrees': 0,
        'open_into': 'hollow_tapered_barrel', 'bore_depth': .369})
    return r


def descend(obj):
    return [obj] + [c for child in obj.children for c in descend(child)]


def export(root_obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in descend(root_obj):
        o.select_set(True)
    bpy.context.view_layer.objects.active = root_obj
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_extras=True,
                              export_cameras=False, export_lights=False,
                              export_materials='EXPORT')


def build(out):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    for args in [
        ('steel', (.52, .60, .65), .88, .25),
        ('dark_steel', (.075, .105, .12), .75, .33),
        ('graphite', (.028, .040, .046), .55, .37),
        ('bronze', (.46, .255, .095), .82, .29),
        ('bronze_dark', (.25, .125, .048), .82, .34),
        ('copper', (.56, .245, .12), .82, .24),
        ('brass', (.53, .37, .13), .85, .25),
        ('teal', (.035, .17, .18), .50, .31),
        ('orange', (.80, .19, .045), .35, .34),
        ('ceramic', (.80, .76, .63), .02, .47),
        ('rubber', (.015, .021, .024), 0, .78),
    ]:
        material(*args)
    roots = [('annular', annular()), ('linear', linear()), ('nozzle', nozzle())]
    manifest = {'schema': 'kaminos.burner-design-outlets.v1', 'units': 'metres',
        'coordinates': {'handedness': 'right', 'up': '+Y', 'right': '+X', 'forward': '+Z',
                        'origin': 'ground plane beneath each assembly',
                        'space': 'individual assembly root local coordinates'},
        'purpose': 'Visual proposals; proposed emitter attachment apertures; no simulation or fabrication claim',
        'design_parameters': P, 'assets': {}}
    for key, obj in roots:
        obj['outlets_json'] = json.dumps(OUTLETS[key])
        path = out / (key + '-burner.glb' if key != 'nozzle' else 'directional-nozzle.glb')
        export(obj, path)
        meshes = [o for o in descend(obj) if o.type == 'MESH']
        manifest['assets'][key] = {'file': path.name, 'root_node': obj.name,
            'mesh_parts': [o.name for o in meshes], 'outlets': OUTLETS[key],
            'comparison_translation': gltf(({'annular': -1.13, 'linear': 0, 'nozzle': 1.13}[key], 0, 0))}
        obj.location.x = {'annular': -1.13, 'linear': 0, 'nozzle': 1.13}[key]
    # Comparison has the exact same parts and native metre scale, translated only.
    comparison = root('burner_comparison', 'Three asset designs at the same physical scale; no scenery')
    for _, obj in roots:
        obj.parent = comparison
    export(comparison, out / 'burner-comparison.glb')
    (out / 'outlets.json').write_text(json.dumps(manifest, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'source' / 'burner-designs.blend'))
    print('BURNER_DESIGNS_EXPORTED', json.dumps({k: len(v) for k, v in OUTLETS.items()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parent.parent)
    a = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / 'source').mkdir(exist_ok=True)
    build(a.out.resolve())
