"""Read-only Blender import in the same world-coordinate route as Ghost's fit."""
import argparse
import hashlib
import json
import sys
from pathlib import Path
import bpy
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--inputs', required=True); parser.add_argument('--out', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
out = Path(args.out); out.mkdir(parents=True, exist_ok=False)
report = {'status': 'failed', 'phase': 'input', 'effectiveExecutable': bpy.app.binary_path,
          'version': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(), 'casts': []}
try:
    state = json.loads(Path(args.inputs).read_text())
    for row in state['casts']:
        path = Path(row['cast']['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['cast']['sha256']:
            raise ValueError('cast digest changed before Blender import')
        report['phase'] = 'import-'+row['slug']
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
        if not meshes or any(o.vertex_groups or any(m.type == 'ARMATURE' for m in o.modifiers) for o in meshes):
            raise ValueError('missing geometry or unexpectedly pre-rigged source')
        positions = []; triangles = []; inventory = []; offset = 0
        for obj in meshes:
            obj.data.calc_loop_triangles()
            vertices = np.array([list(obj.matrix_world@v.co) for v in obj.data.vertices])
            faces = np.array([list(t.vertices) for t in obj.data.loop_triangles], dtype=np.uint32)
            if not len(vertices) or not len(faces) or not np.isfinite(vertices).all():
                raise ValueError('partial or nonfinite imported mesh')
            positions.append(vertices); triangles.append(faces+offset); offset += len(vertices)
            inventory.append({'name': obj.name, 'vertices': len(vertices), 'triangles': len(faces),
                              'matrixWorld': [list(r) for r in obj.matrix_world]})
        np.savez(out/(row['slug']+'.npz'), positions=np.concatenate(positions), triangles=np.concatenate(triangles))
        report['casts'].append({'slug': row['slug'], 'path': str(path), 'sha256': row['cast']['sha256'],
                                'objects': inventory, 'allImportedMeshesIncluded': True, 'route': 'Blender glTF import, object matrix_world baked once; no save, welding or decimation'})
    report.update(status='completed', phase='complete')
except Exception as error:
    report['error'] = repr(error)
    raise
finally:
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
