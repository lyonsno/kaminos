"""Build a geometry-only articulated binding before loading separate reference fields."""
import argparse
import hashlib
import json
import time
from pathlib import Path
import numpy as np
from hindquarter_binding import bind_geometry,partial_rotation

parser=argparse.ArgumentParser();parser.add_argument('--control',required=True);parser.add_argument('--rig',required=True)
parser.add_argument('--baseline',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
report={'status':'running','phase':'authentication','output':str(out),'effectiveSolver':'numpy-geodesic-bilateral-binding'}
digest=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
try:
    control=json.loads(Path(args.control).read_text());rig=json.loads(Path(args.rig).read_text())
    baseline=Path(args.baseline);old=json.loads((baseline/'manifest.json').read_text())
    if rig['sourceSha256']!=control['sourceSha256'] or old['sourceSha256']!=control['sourceSha256']:raise ValueError('source identity mismatch')
    if digest(control['geometry']['path'])!=control['geometry']['sha256']:raise ValueError('geometry digest mismatch')
    geom=np.load(control['geometry']['path'])
    if set(geom.files)!={'positions','triangles'}:raise ValueError('candidate input includes painted fields')
    rest,triangles=geom['positions'],geom['triangles'];control.update(domainMethod='surface',articulated=True)
    report['phase']='automatic-binding';start=time.monotonic();binding=bind_geometry(rest,triangles,control)
    report['bindingSeconds']=time.monotonic()-start
    # No reference influence is read until candidate binding is complete.
    report['phase']='reference-conformance'
    for key in ['paintedWeights','reference']:
        if digest(rig[key]['path'])!=rig[key]['sha256']:raise ValueError('reference digest mismatch')
    painted=np.fromfile(rig['paintedWeights']['path'],dtype='<f4').reshape(len(rest),8)
    reference=np.fromfile(rig['reference']['path'],dtype='<f4').reshape(len(rig['presets']),len(rest),3)
    conformance=[];automatic=[]
    for frame,expected in zip(rig['presets'],reference):
        palette=np.asarray(frame['palette']);actual=partial_rotation(rest,palette,painted)
        conformance.append({'name':frame['name'],'paintedMaxError':float(np.max(np.abs(actual-expected))),
            'paintedRmsError':float(np.sqrt(np.mean((actual-expected)**2)))})
        automatic.append(partial_rotation(rest,palette,binding['jointWeights']))
    accepted=np.fromfile(baseline/'automatic.bin',dtype='<f4').reshape(39,len(rest),3)
    baseline_error=float(np.max(np.abs(automatic[1]-accepted[6])))
    if baseline_error>2e-5:raise ValueError('accepted left hip baseline changed: '+str(baseline_error))
    # Reference conformance is numeric route identity, not a visual quality gate.
    if max(row['paintedMaxError'] for row in conformance)>2e-5:raise ValueError('live painted replay does not match Blender')
    arrays={'rest.bin':rest.astype('<f4'),'triangles.bin':triangles.astype('<u4'),
        'automatic-weights.bin':binding['jointWeights'].astype('<f4'),'painted-weights.bin':painted.astype('<f4'),
        'blender-reference.bin':reference.astype('<f4'),'automatic-presets.bin':np.asarray(automatic,dtype='<f4')}
    assets={}
    for name,array in arrays.items():
        path=out/name;array.tofile(path);assets[name]={'sha256':digest(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
    manifest={'schema':'kaminos.live-transport.v1','status':'completed','sourceSha256':control['sourceSha256'],
        'sourceCast':control['cast'],'sourceArmature':control['armature'],'vertices':len(rest),'triangles':len(triangles),
        'channels':binding['jointChannels'],'bones':rig['bones'],'presets':rig['presets'],'assets':assets,
        'candidatePaintedWeights':False,'bindingRule':binding['articulatedRule'],'referenceConformance':conformance,
        'acceptedBaseline':{'manifestSha256':digest(baseline/'manifest.json'),'leftHipMaxError':baseline_error},
        'sourceGeometrySha256':control['geometry']['sha256'],'bounds':control['bounds'],
        'route':'live CPU dual-quaternion transport from actual rear bones; no posed support projection',
        'scope':'six independently editable rear bones, pelvis fixed; unseeded fragments held fixed; no full-body binding claim'}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    report.update(status='completed',phase='completed',manifestSha256=digest(out/'manifest.json'),
        acceptedBaselineMaxError=baseline_error,referenceConformance=conformance,bindingRule=binding['articulatedRule'])
except Exception as error:
    report.update(status='failed',error=str(error));raise
finally:(out/'build-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({key:value for key,value in report.items() if key!='bindingRule'}))
