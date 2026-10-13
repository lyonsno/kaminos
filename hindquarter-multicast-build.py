"""Different cast geometries, receipted frame composition, unchanged rear binder."""
import argparse
import copy
import hashlib
import json
import time
from pathlib import Path
import numpy as np
from hindquarter_binding import bind_geometry,partial_rotation

def prepare_geometry(package,frame,hierarchy,plan,control):
    source=package['source'];comparison=source['comparisonFrame']
    if comparison!={**comparison,'frame':'frozen-envelope-baseline','operation':'inverse-cast-registration'}:
        raise ValueError('cast is not in the receipted frozen-envelope frame')
    anatomical=source['skeletonSha256']
    if (frame['inputs']['sourceSha256']!=anatomical or hierarchy['source']['skeletonSha256']!=anatomical
        or frame['inputs']['envelopeSha256']!=source['envelopeSha256']
        or anatomical not in plan['source'].values() or control['sourceSha256'] not in plan['source'].values()):
        raise ValueError('frame source identity mismatch')
    gltf_to_blender=np.array([[1.,0,0],[0,0,-1],[0,1,0]])
    shift=np.array(plan['anatomy_to_rear_frame']);joints={j['name']:np.array(j['head']) for j in plan['joints']}
    mapping=[]
    for old in hierarchy['controls']:
        # Recorded old sides are opposite to the current v025 adapter names.
        current=old['name'].replace('-left-','-SIDE-').replace('-right-','-left-').replace('-SIDE-','-right-')
        residual=float(np.linalg.norm(gltf_to_blender@old['pivot']+shift-joints[current]))
        if residual>1e-4:raise ValueError('source control anchor mismatch: '+old['name'])
        mapping.append({'receiptControl':old['name'],'currentControl':current,'residualSourceUnits':residual})
    skeleton_to_envelope=np.eye(4);transform=frame['link']['transform']
    skeleton_to_envelope[:3,:3]=transform['rotation'];skeleton_to_envelope[:3,3]=transform['translation']
    r=skeleton_to_envelope[:3,:3]
    if not np.allclose(r.T@r,np.eye(3),atol=1e-8) or np.linalg.det(r)<0:raise ValueError('non-rigid frame link')
    anatomy_to_rear=np.eye(4);anatomy_to_rear[:3,:3]=gltf_to_blender;anatomy_to_rear[:3,3]=shift
    rear_to_normal=np.eye(4);scale=control['unitsPerFemur']
    if not np.isfinite(scale) or scale<=0:raise ValueError('invalid rig normalization')
    rear_to_normal[:3,:3]=gltf_to_blender/scale
    rear_to_normal[:3,3]=-rear_to_normal[:3,:3]@joints['hindlimb-left-hip']
    bridge=rear_to_normal@anatomy_to_rear@np.linalg.inv(skeleton_to_envelope)
    # Only cast positions/topology are read. Old skinBinding/castBinding are not inputs.
    rest=np.asarray(package['cast']['positions'],dtype=float).reshape(-1,3)
    triangles=np.asarray(package['cast']['triangles'],dtype=np.uint32).reshape(-1,3)
    if not np.isfinite(rest).all() or not len(rest) or not len(triangles) or triangles.max()>=len(rest):
        raise ValueError('invalid complete cast geometry')
    rest=rest@bridge[:3,:3].T+bridge[:3,3]
    receipt={'operation':'inverse skeleton-envelope link, glTF to Blender, receipted anatomy translation, accepted hip/femur normalization',
             'matrix':bridge.tolist(),'anchorMapping':mapping,'geometryReflected':False,
             'authority':'reconstruction of existing provisional registration; not new anatomical or authored-side authority'}
    return rest,triangles,receipt

def build(args):
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    report={'status':'running','phase':'source-authentication','output':str(out),
            'effectiveSolver':'unchanged numpy-geodesic-bilateral-binding','requestedInputs':vars(args)}
    digest=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
    try:
        inputs={name:json.loads(Path(getattr(args,name.replace('-','_'))).read_text())
                for name in ['package','frame_link','hierarchy','plan','control','rig']}
        if digest(args.package)!=args.expected_package_sha256:raise ValueError('package digest mismatch')
        control=inputs['control'];rig=inputs['rig']
        if rig['sourceSha256']!=control['sourceSha256']:raise ValueError('rig source mismatch')
        report['phase']='frame-reconstruction'
        rest,triangles,frame=prepare_geometry(inputs['package'],inputs['frame_link'],inputs['hierarchy'],inputs['plan'],control)
        frame['inputs']={name:{'path':str(Path(getattr(args,name)).resolve()),'sha256':digest(getattr(args,name))} for name in inputs}
        frame_bytes=json.dumps(frame,indent=2).encode();(out/'frame-chain.json').write_bytes(frame_bytes)
        automatic_control=copy.deepcopy(control)
        automatic_control.update(bounds={'min':rest.min(axis=0).tolist(),'max':rest.max(axis=0).tolist()},domainMethod='surface',articulated=True,
                                 surfaceConnectivity=args.connectivity)
        report['phase']='automatic-binding';start=time.monotonic()
        binding=bind_geometry(rest,triangles,automatic_control);report['bindingSeconds']=time.monotonic()-start
        poses=np.asarray([partial_rotation(rest,np.asarray(p['palette']),binding['jointWeights']) for p in rig['presets']],dtype='<f4')
        arrays={'rest.bin':rest.astype('<f4'),'triangles.bin':triangles.astype('<u4'),
                'automatic-weights.bin':binding['jointWeights'].astype('<f4'),'automatic-presets.bin':poses}
        assets={}
        for name,array in arrays.items():
            path=out/name;array.tofile(path);assets[name]={'sha256':digest(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
        manifest={'schema':'kaminos.live-transport.v2','status':'completed','sourceCast':args.name,
            'sourceSha256':inputs['package']['source']['castSha256'],'sourceArmature':rig['armature'],
            'vertices':len(rest),'triangles':len(triangles),'channels':binding['jointChannels'],'bones':rig['bones'],
            'presets':rig['presets'],'assets':assets,'candidatePaintedWeights':False,'bindingRule':binding['articulatedRule'],
            'reference':{'kind':'none','reason':'No expert-painted reference is admitted for this distinct cast; not transferred from v025'},
            'provenance':{'packageSha256':args.expected_package_sha256,'rigSourceSha256':rig['sourceSha256'],
                          'frameChainSha256':hashlib.sha256(frame_bytes).hexdigest()},
            'bounds':automatic_control['bounds'],'route':'same geometry-only rear binder and live dual-quaternion transport',
            'scope':'temporary rear-only comparison on another complete registered cast; no full-body or anatomy admission'}
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
        report.update(status='completed',phase='completed',manifestSha256=digest(out/'manifest.json'),sourceSha256=manifest['sourceSha256'],
                      vertices=len(rest),triangles=len(triangles),anchorMapping=frame['anchorMapping'],
                      unknownVertices=len(binding['articulatedRule']['unknownVertices']))
    except Exception as error:report.update(status='failed',error=str(error));raise
    finally:(out/'build-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for key in ['package','expected-package-sha256','frame-link','hierarchy','plan','control','rig','name','out']:
        parser.add_argument('--'+key,required=True)
    parser.add_argument('--connectivity',choices=['indexed','coincident'],default='indexed')
    build(parser.parse_args())
