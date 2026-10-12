"""Observed Blender export continuity and visible marker/link placement."""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector

folder = Path(sys.argv[sys.argv.index('--')+1])
bpy.ops.wm.open_mainfile(filepath=str(folder/'complete-joints-derived.blend'))
bpy.context.view_layer.update()
plan = json.loads((folder/'joint-plan.json').read_text())
rig = bpy.data.objects['MARIONETTE_COMPLETE_JOINTS']
points = {j['name']: rig.matrix_world @ Vector(j['head']) for j in plan['joints']}
marker_error = 0.
link_error = 0.
for j in plan['joints']:
    marker = bpy.data.objects[j['name']+' joint marker']
    marker_error = max(marker_error,(marker.matrix_world.translation-points[j['name']]).length)
    if j['parent'] is None:
        continue
    link = bpy.data.objects[j['name']+' hierarchy link']
    z_values = [v.co.z for v in link.data.vertices]
    ends = [link.matrix_world @ Vector((0,0,z)) for z in (min(z_values),max(z_values))]
    targets = [points[j['parent']],points[j['name']]]
    link_error = max(link_error,min(max((ends[k]-targets[k]).length for k in (0,1)),
                                   max((ends[k]-targets[1-k]).length for k in (0,1))))
report = {'joint_count':len(plan['joints']),'max_marker_world_error':marker_error,
          'max_link_endpoint_world_error':link_error,'ok':marker_error<1e-4 and link_error<1e-4,
          'blend':str(folder/'complete-joints-derived.blend')}
(folder/'placement-witness.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
assert report['ok'], 'visible joint markers/hierarchy links disagree with joint world positions'
