"""Provisional binding of the retained official Cat/Dog casts; no mesh decimation.

Invocation supplies the observed cast, registration, reference bundle and pinned
existing binder roots. Original names/parents survive; aliases only let the
existing custom-role seed rules consume this different input graph.
"""
import argparse, hashlib, importlib.util, json, struct, sys, traceback
from pathlib import Path
import numpy as np

def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p): return json.loads(Path(p).read_text())
def write(p,v): Path(p).write_text(json.dumps(v,indent=2)+'\n')

def mesh(p):
    raw=Path(p).read_bytes()
    magic,version,length=struct.unpack_from('<III',raw)
    if magic!=0x46546c67 or version!=2 or length!=len(raw): raise ValueError('Invalid GLB')
    size,kind=struct.unpack_from('<II',raw,12)
    if kind!=0x4e4f534a: raise ValueError('Missing GLB JSON')
    d=json.loads(raw[20:20+size]);start=20+size
    n,kind=struct.unpack_from('<II',raw,start);binary=raw[start+8:start+8+n]
    if kind!=0x004e4942 or len(binary)!=n: raise ValueError('Missing GLB binary')
    if d.get('skins') or d.get('animations'):raise ValueError('Expected the retained unskinned cast')
    nodes=d.get('nodes',[])
    if len(nodes)!=1 or nodes[0].get('mesh')!=0 or any(k in nodes[0] for k in ['matrix','translation','rotation','scale','children']):raise ValueError('Unobserved GLB node transform; explicit import needed')
    if len(d['meshes'])!=1 or len(d['meshes'][0]['primitives'])!=1:raise ValueError('Unobserved mesh layout')
    primitive=d['meshes'][0]['primitives'][0]
    if primitive.get('mode',4)!=4:raise ValueError('Expected triangles')
    def array(index):
        a=d['accessors'][index];v=d['bufferViews'][a['bufferView']]
        if a.get('sparse') or v.get('byteStride') or v.get('buffer',0)!=0:raise ValueError('Unobserved accessor layout')
        width={'SCALAR':1,'VEC3':3}[a['type']];dtype={5125:'<u4',5123:'<u2',5126:'<f4'}[a['componentType']]
        return np.frombuffer(binary,dtype=dtype,count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).copy().reshape(a['count'],width)
    points=array(primitive['attributes']['POSITION']);tri=array(primitive['indices']).reshape(-1,3)
    if not np.isfinite(points).all() or tri.min()<0 or tri.max()>=len(points):raise ValueError('Invalid cast geometry')
    return points,tri

def aliases(names):
    basic={'Bip01_Pelvis':'pelvis','Bip01_Spine':'spine-lumbar','Bip01_Spine1':'spine-mid','Bip01_Spine2':'spine-chest','Bip01_Neck':'neck','Bip01_Neck1':'neck-upper','Bip01_Head':'head','Bip01_HeadNub':'head-end'}
    for side,letter in [('left','L'),('right','R')]:
        for original,role in [('Clavicle','scapula'),('UpperArm','shoulder'),('Forearm','elbow'),('Hand','wrist'),('Finger0','toe'),('Finger01','toe-mid'),('Finger0Nub','toe-end')]:basic[f'Bip01_{letter}_{original}']=f'forelimb-{side}-{role}'
        for original,role in [('Thigh','hip'),('Calf','stifle'),('HorseLink','hock'),('Foot','foot'),('Toe0','toe'),('Toe0Nub','toe-end')]:basic[f'Bip01_{letter}_{original}']=f'hindlimb-{side}-{role}'
    result={n:basic.get(n,'tail-'+str(int(n.rsplit('_',1)[1])) if n.startswith('BN_Tail_') else 'helper:'+n) for n in names}
    if len(set(result.values()))!=len(names):raise ValueError('Role mapping merged controls')
    return result

def source_arrays(folder):
    d=read(folder/'demo.json');binary=(folder/'demo.bin').read_bytes()
    if hashlib.sha256(binary).hexdigest()!=d['sha256']:raise ValueError('Reference binary digest mismatch')
    a=next(x for x in d['arrays'] if x['name']=='restPositions')
    p=np.frombuffer(binary,dtype='<f4',count=a['byteLength']//4,offset=a['offset']).reshape(a['shape']).copy()
    return d,p

def prepare(config,out,report):
    if not config.get('expected_sources'):raise ValueError('Pinned preparation sources required')
    for source,expected in config['expected_sources'].items():
        if sha(source)!=expected:raise ValueError('Preparation source identity differs: '+source)
    paths={k:Path(config[k]).resolve() for k in ['cast','registration','reference','binder','trunk']}
    for key in ['cast','registration']:
        if sha(paths[key])!=config[key+'_sha256']:raise ValueError('Wrong '+key+' source identity')
    folder=paths['reference'];d,canonical=source_arrays(folder);names=d['skeleton']['jointNames'];parents=d['skeleton']['parents'];mapping=aliases(names)
    if d['skeleton']['name'].lower()!=config['id'] or len(names)!=config['joints']:raise ValueError('Wrong reference rig')
    for side in ['L','R']:
        for child,parent in [('UpperArm','Clavicle'),('Forearm','UpperArm')]:
            if parents[names.index(f'Bip01_{side}_{child}')]!=names.index(f'Bip01_{side}_{parent}'):raise ValueError('Missing reference shoulder chain')
    reg=read(paths['registration'])
    if Path(reg['cast']).resolve()!=paths['cast'] or reg['rig']!=config['id']:raise ValueError('Registration/cast/rig mismatch')
    points,triangles=mesh(paths['cast'])
    # Blender importer applies this Y-up -> Z-up basis before the recorded ICP.
    blender=np.array([[1.,0,0],[0,0,-1],[0,1,0]])
    registered=((points@blender.T)@np.asarray(reg['rotation']).T*reg['scale']+reg['translation'])@blender
    pelvis=canonical[names.index('Bip01_Pelvis')].astype(float)
    femur=np.linalg.norm(canonical[names.index('Bip01_L_Thigh')]-canonical[names.index('Bip01_L_Calf')])
    orientation=np.diag([-1.,1.,-1.]);conversion=np.eye(4);conversion[:3,:3]=orientation/femur;conversion[:3,3]=-orientation@pelvis/femur
    normalized=(canonical-pelvis)@orientation.T/femur;points=(registered-pelvis)@orientation.T/femur
    bones=[]
    for i,name in enumerate(names):
        matrix=np.eye(4);matrix[:3,3]=normalized[i]
        bones.append({'name':name,'parent':None if parents[i]<0 else names[parents[i]],'restMatrix':matrix.tolist(),'semanticRole':mapping[name]})
    semantic=[{**b,'name':mapping[b['name']],'parent':None if b['parent'] is None else mapping[b['parent']]} for b in bones]
    control={'paintedWeightsIncluded':False,'joints':{b['name']:np.asarray(b['restMatrix'])[:3,3].tolist() for b in semantic},'bounds':{'min':points.min(0).tolist(),'max':points.max(0).tolist()},'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':True}
    report.update(phase='binding',sources={str(p):sha(p) for p in [paths['cast'],paths['registration'],folder/'demo.json',folder/'demo.bin',paths['binder']/'full-creature-binding.py',paths['binder']/'hindquarter_binding.py',paths['trunk']/'trunk_anchors.py']},canonicalWorldToNormalized=conversion.tolist(),roles=mapping,vertices=len(points),triangles=len(triangles));write(out/'report.json',report)
    sys.path[:0]=[str(paths['binder']),str(paths['trunk'])]
    spec=importlib.util.spec_from_file_location('full_creature',paths['binder']/'full-creature-binding.py');full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)
    rear=full.bind_geometry(points,triangles,control)
    result=full.distributed_trunk_weights(points,triangles,rear['edges'],rear['jointWeights'],semantic)
    # Same automatic body rule; extra reference controls remain independent.
    # No custom28->32 paw intervention: this graph is already complete.
    weights=result['weights'].astype('<f4')
    if not np.isfinite(weights).all() or weights.min()<0 or not np.allclose(weights.sum(1),1,atol=1e-6):raise ValueError('Invalid partition')
    package=out/'package';package.mkdir(exist_ok=True);assets={}
    for name,array in [('rest.bin',points.astype('<f4')),('triangles.bin',triangles.astype('<u4')),('automatic-weights.bin',weights),('automatic-presets.bin',points.astype('<f4')[None])]:
        array.tofile(package/name);assets[name]={'sha256':sha(package/name),'bytes':(package/name).stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
    frame={'schema':'kaminos.full-given-rig-frame.v1','bones':bones,'canonicalWorldToSourceNormalized':conversion.tolist(),'source':report['sources']};write(out/'rig-frame.json',frame)
    manifest={'schema':'kaminos.live-transport.v3','status':'completed','sourceSha256':sha(paths['cast']),'sourceCast':'Ghost retained '+config['id']+'-conditioned cast','sourceArmature':'Official '+d['skeleton']['name']+str(len(names)),'vertices':len(points),'triangles':len(triangles),'channels':['fixed']+names,'bones':bones,'assets':assets,'candidatePaintedWeights':False,'reference':{'kind':'none','reason':'Geometry-only generated cast; no painted skin reference'},'provenance':{'packageSha256':sha(paths['cast']),'rigSourceSha256':sha(folder/'demo.json'),'frameChainSha256':sha(out/'rig-frame.json')},'presets':[{'name':'neutral','poseWxyz':{}}],'bindingRule':{k:v for k,v in result.items() if k not in ['weights','channels']},'scope':'Provisional exact full reference graph with recorded approximate registration; existing rear and distributed-trunk geodesic binding, explicit role map, no painted/anatomical admission or new motion'}
    write(package/'manifest.json',manifest)
    assert np.array_equal(np.fromfile(package/'triangles.bin',dtype='<u4').reshape(-1,3),triangles)
    report.update(status='completed',phase='complete',manifestSha256=sha(package/'manifest.json'),bones=len(bones),maxPartitionError=float(np.max(np.abs(weights.sum(1)-1))),unknownVertices=len(result['unknownVertices']),channelInfluence={n:{'max':float(weights[:,i].max()),'sum':float(weights[:,i].sum())} for i,n in enumerate(manifest['channels'])},geometryTrianglesPreserved=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--out',required=True);args=p.parse_args();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','phase':'inputs','sourceScriptSha256':sha(__file__),'route':'numpy-existing-surface-geodesic-reference-role-map'};write(out/'report.json',report)
    try:prepare(read(args.inputs),out,report)
    except Exception:report['error']=traceback.format_exc();raise
    finally:write(out/'report.json',report)
if __name__=='__main__':main()
