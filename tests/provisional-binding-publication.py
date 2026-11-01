# kaminos-test: python
"""BIPED-01: completed-package publication, with only the heavy binder stubbed."""
import importlib.util, json, struct, tempfile, hashlib, types, subprocess
from pathlib import Path
import numpy as np

script = Path(__file__).resolve().parents[1]/'tools/assays/rig-to-cast-fit/bind_provisional.py'
spec = importlib.util.spec_from_file_location('review_binder', script)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory(prefix='static-biped-publication-') as tmp:
    r = Path(tmp)
    binder, trunk = r/'binder', r/'trunk'
    binder.mkdir(); trunk.mkdir()
    dependencies = [binder/'full-creature-binding.py', binder/'hindquarter_binding.py', trunk/'trunk_anchors.py']
    for p in dependencies:
        p.write_text('# synthetic binder dependency\n')
    positions = np.array([[1.000001,0,0],[0,1,0],[0,0,1]], dtype='<f4')
    indices = np.array([0,1,2], dtype='<u4')
    binary = positions.tobytes() + indices.tobytes()
    doc = {
        'asset': {'version':'2.0'}, 'nodes':[{'mesh':0}],
        'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1}]}],
        'buffers':[{'byteLength':len(binary)}],
        'bufferViews':[
            {'buffer':0,'byteOffset':0,'byteLength':positions.nbytes},
            {'buffer':0,'byteOffset':positions.nbytes,'byteLength':indices.nbytes}],
        'accessors':[
            {'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'},
            {'bufferView':1,'componentType':5125,'count':3,'type':'SCALAR'}]}
    js = json.dumps(doc).encode()
    js += b' ' * ((-len(js)) % 4)
    raw = (struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))
           + struct.pack('<II',len(js),0x4e4f534a) + js
           + struct.pack('<II',len(binary),0x004e4942) + binary)
    cast = r/'cast.glb'; cast.write_bytes(raw)
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    plan = r/'plan.json'
    plan.write_text(json.dumps({'joints':[
        {'name':'Hips','parent':None,'head':[0,0,0]},
        {'name':'Leg','parent':'Hips','head':[0,1,0]}]}))
    placement = r/'placement.json'
    placement.write_text(json.dumps({'evidence':{'meshAssetLink':{'object':{
        'source':'/api/read?root=generated-meshes&path='+sha(cast)+'.glb',
        'transform':{'scale':[10000]*3,'rotation':[0]*3,'position':[0]*3}}}}}))
    config = {
        'cast':str(cast),'plan':str(plan),'placement':str(placement),
        'binder':str(binder),'trunk':str(trunk),
        'roles':{'Hips':'pelvis','Leg':'hindlimb-left-hip'},
        'inactive':[],'root':'Hips','lengthReference':['Hips','Leg']}
    config['expected_sources'] = {str(p):sha(p) for p in [cast,plan,placement,*dependencies]}
    inputs = r/'inputs.json'; inputs.write_text(json.dumps(config))
    fake = types.SimpleNamespace(
        bind_geometry=lambda points,triangles,control:{
            'edges':np.array([[0,1],[1,2],[2,0]]),'jointWeights':None},
        distributed_trunk_weights=lambda points,triangles,edges,joint_weights,bones:{
            'weights':np.array([[0.,1.,0.]]*3),
            'channels':['fixed','pelvis','hindlimb-left-hip'],'unknownVertices':[]})
    m.module = lambda name,path: fake
    out = r/'out'
    try:
        m.run(inputs,out)
    except ValueError as e:
        print('runner_error:',str(e))
    report = json.loads((out/'report.json').read_text())
    manifest_path = out/'package/manifest.json'
    assert report['status']=='failed'
    assert 'cast coordinate preservation failed' in report['error']
    assert (out/'failure.json').exists()
    assert not manifest_path.exists(), 'Rejected geometry left a completed manifest available to the consumer'
    print('late preservation failure leaves no admissible manifest')

    # The same layout at ordinary scale should complete and load through the
    # production static route. This checks publication, not the stubbed binder.
    value=json.loads(placement.read_text())
    value['evidence']['meshAssetLink']['object']['transform']['scale']=[1,1,1]
    placement.write_text(json.dumps(value))
    config['expected_sources'][str(placement)]=sha(placement)
    inputs.write_text(json.dumps(config))
    valid=r/'valid'
    m.run(inputs,valid)
    assert json.loads((valid/'report.json').read_text())['status']=='completed'
    consumer="""
import fs from 'node:fs/promises';
import {loadPosedSkeletonSources} from './experiments/creature-motion/posed-skeleton.experiment.mjs';
const dir=process.argv[1], bytes=await fs.readFile(dir+'/manifest.json');
const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
globalThis.fetch=async path=>{try{return new Response(await fs.readFile(path));}catch{return new Response('',{status:404});}};
const loaded=await loadPosedSkeletonSources({case:dir,case_sha256:digest});
if(loaded.source.poseRoute!=='static-bind'||loaded.manifest.vertices!==3)throw Error('Unexpected consumer result');
console.log('successful package loads through real static consumer');
"""
    subprocess.run(['node','--input-type=module','-e',consumer,str(valid/'package')],cwd=script.parents[3],check=True)
