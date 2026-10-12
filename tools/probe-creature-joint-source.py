"""Read exact scene controls/cast and frozen anatomy into a shared joint frame."""
import bpy
import hashlib
import json
import sys
from pathlib import Path
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
source, anatomy, output = map(Path, args)
hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (source, anatomy)}
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.view_layer.update()
rig = bpy.data.objects['KAMINOS_CONTROL_ADAPTER']
cast = bpy.data.objects['CAT_CAST_MANNEQUIN_80413_STRONG']
report = {'source': hashes, 'rig_matrix': [list(r) for r in rig.matrix_world],
          'cast_matrix': [list(r) for r in cast.matrix_world],
          'bones': [{'name': b.name, 'parent': b.parent.name if b.parent else None,
                     'head': list(b.head_local), 'tail': list(b.tail_local),
                     'matrix': [list(r) for r in b.matrix_local]}
                    for b in rig.data.bones],
          'controls': [{'name': o.name, 'matrix': [list(r) for r in o.matrix_world]}
                       for o in bpy.data.objects if o.name == 'pelvis' or o.name.startswith('hindlimb-')]}
points = np.asarray([list(rig.matrix_world.inverted() @ cast.matrix_world @ v.co) for v in cast.data.vertices])
report['cast_bounds_rig'] = [points.min(0).tolist(), points.max(0).tolist()]
# Export only original geometry information; adding objects in memory does not alter the source file.
bpy.ops.wm.read_factory_settings(use_empty=True)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(anatomy))
report['anatomy'] = []
for obj in sorted(set(bpy.data.objects) - before, key=lambda o:o.name):
    if obj.type != 'MESH':
        continue
    pts = np.asarray([list(obj.matrix_world @ v.co) for v in obj.data.vertices])
    centre = pts.mean(0)
    _, _, axes = np.linalg.svd(pts-centre, full_matrices=False)
    projection = (pts-centre) @ axes[0]
    endpoints = [centre + axes[0]*projection.min(), centre + axes[0]*projection.max()]
    report['anatomy'].append({'name': obj.name,
                             'vertices': pts.tolist(), 'centre': centre.tolist(),
                             'bounds': [pts.min(0).tolist(),pts.max(0).tolist()],
                             'long_axis_ends': [p.tolist() for p in endpoints]})
report['source_unchanged'] = all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes.items())
output.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'source_unchanged': report['source_unchanged'], 'rig_matrix': report['rig_matrix'],
                  'cast_bounds_rig': report['cast_bounds_rig'], 'bones': report['bones'],
                  'anatomy_meshes':len(report['anatomy'])}))
