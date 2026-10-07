"""Display a retained native AnyTop skeleton; no target rig or motion correction."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import numpy as np


def export_glb(positions, parents, names, fps, metadata):
    positions = np.asarray(positions, dtype=np.float32)
    if positions.ndim != 3 or positions.shape[1:] != (len(parents), 3) or len(positions) < 2:
        raise ValueError('Expected full frame/joint/XYZ array')
    if not np.isfinite(positions).all() or not np.isfinite(fps) or fps <= 0:
        raise ValueError('Nonfinite motion or invalid FPS')
    metadata={**metadata,'display_bounds':{'min':positions.min(axis=(0,1)).astype(float).tolist(),
                                        'max':positions.max(axis=(0,1)).astype(float).tolist()}}
    doc = {'asset': {'version': '2.0', 'generator': 'Kaminos native skeleton display'},
           'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'name': 'NativeSource', 'children': [], 'extras': {'native_motion': metadata}}],
           'buffers': [], 'bufferViews': [], 'accessors': [], 'meshes': [],
           'materials': [{'pbrMetallicRoughness': {'baseColorFactor': color,
                         'metallicFactor': 0, 'roughnessFactor': 0.8}, 'doubleSided': True}
                         for color in ([0.85,0.68,0.35,1],[0.1,0.75,1,1],[0.35,0.9,0.35,1])],
           'animations': [{'name': metadata['label'], 'samplers': [], 'channels': []}]}
    binary = bytearray()
    def accessor(array, kind, component=5126):
        array = np.asarray(array, dtype='<u2' if component == 5123 else '<f4')
        while len(binary)%4:
            binary.append(0)
        offset = len(binary)
        binary.extend(array.tobytes())
        view = len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':array.nbytes})
        item = {'bufferView':view,'componentType':component,'count':len(array),'type':kind}
        if kind == 'SCALAR':
            item.update(min=[float(array.min())],max=[float(array.max())])
        elif kind == 'VEC3':
            item.update(min=array.min(0).astype(float).tolist(),max=array.max(0).astype(float).tolist())
        index = len(doc['accessors'])
        doc['accessors'].append(item)
        return index
    # Unit cube; native joint spheres are intentionally simple visible markers.
    vertices=np.array([[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],
                       [-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]])
    faces=np.array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,
                    3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5],dtype=np.uint16)
    vertex_accessor=accessor(vertices,'VEC3')
    index_accessor=accessor(faces,'SCALAR',5123)
    for mat in range(3):
        doc['meshes'].append({'primitives':[{'attributes':{'POSITION':vertex_accessor},
                            'indices':index_accessor,'material':mat}]})
    time_accessor=accessor(np.arange(len(positions))/fps,'SCALAR')
    animation=doc['animations'][0]
    def track(node, path, values, kind):
        sampler=len(animation['samplers'])
        animation['samplers'].append({'input':time_accessor,'output':accessor(values,kind),'interpolation':'LINEAR'})
        animation['channels'].append({'sampler':sampler,'target':{'node':node,'path':path}})
    def color(name):
        name=name.lower()
        if any(part in name for part in ('arm','clavicle','hand','finger')):
            return 1
        if any(part in name for part in ('thigh','calf','foot','toe')):
            return 2
        return 0
    def node(item):
        index=len(doc['nodes'])
        doc['nodes'].append(item)
        doc['nodes'][0]['children'].append(index)
        return index
    for joint, name in enumerate(names):
        marker=node({'name':f'joint_{joint}_{name}','mesh':color(name),
                     'translation':positions[0,joint].astype(float).tolist(),'scale':[.025,.025,.025]})
        track(marker,'translation',positions[:,joint],'VEC3')
        parent=int(parents[joint])
        if parent<0 or parent==joint:
            continue
        start,end=positions[:,parent],positions[:,joint]
        vector=end-start
        length=np.linalg.norm(vector,axis=-1)
        direction=vector/np.where(length[:,None]>1e-12,length[:,None],1)
        # Quaternion mapping unit +Y beam to each measured parent-child segment.
        quat=np.column_stack([direction[:,2],np.zeros(len(direction)),-direction[:,0],1+direction[:,1]])
        norm=np.linalg.norm(quat,axis=-1)
        quat[norm<1e-8]=[1,0,0,0]
        quat/=np.linalg.norm(quat,axis=-1)[:,None]
        for frame in range(1,len(quat)):
            if np.dot(quat[frame-1],quat[frame])<0:
                quat[frame]*=-1
        scale=np.column_stack([np.full(len(length),.012),length,np.full(len(length),.012)])
        mid=(start+end)/2
        beam=node({'name':f'edge_{parent}_{joint}','mesh':color(name),
                   'translation':mid[0].astype(float).tolist(),'rotation':quat[0].tolist(),'scale':scale[0].tolist()})
        track(beam,'translation',mid,'VEC3')
        track(beam,'rotation',quat,'VEC4')
        track(beam,'scale',scale,'VEC3')
    doc['buffers']=[{'byteLength':len(binary)}]
    encoded=json.dumps(doc,separators=(',',':'),allow_nan=False).encode()
    encoded+=b' '*((-len(encoded))%4)
    binary.extend(b'\0'*((-len(binary))%4))
    total=12+8+len(encoded)+8+len(binary)
    return struct.pack('<4sII',b'glTF',2,total)+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',required=True)
    parser.add_argument('--condition',required=True)
    parser.add_argument('--object',required=True)
    parser.add_argument('--representation',choices=['raw-xyz','source-bvh-ik'],required=True)
    parser.add_argument('--fps',type=float,required=True)
    parser.add_argument('--label',required=True)
    parser.add_argument('--out',required=True)
    args=parser.parse_args()
    source=Path(args.source)
    condition=Path(args.condition)
    data=np.load(condition,allow_pickle=True).item()[args.object]
    metadata={'label':args.label,'representation':args.representation,'fps':args.fps,
              'source':str(source),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
              'condition_sha256':hashlib.sha256(condition.read_bytes()).hexdigest(),
              'license_scope':'AnyTop non-commercial research only',
              'retargeted':False,'painted_creature':False,'seamless_loop':False}
    if args.representation=='raw-xyz':
        positions=np.load(source)
    else:
        import BVH, Animation
        animation,names,dt=BVH.load(str(source))
        if list(names)!=list(data['joints_names']):
            raise ValueError('BVH names do not match native condition order')
        positions=Animation.positions_global(animation)
        metadata['source_bvh_fps']=1/dt
        metadata['playback_fps_override']=args.fps
    metadata['frames']=len(positions)
    metadata['joint_names']=list(data['joints_names'])
    metadata['parents']=[int(p) for p in data['parents']]
    output=Path(args.out)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(export_glb(positions,data['parents'],data['joints_names'],args.fps,metadata))
    print(json.dumps({'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),**metadata}))


if __name__=='__main__':
    main()
