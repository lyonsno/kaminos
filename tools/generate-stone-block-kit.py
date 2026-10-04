"""Author five closed, common-fit limestone visual prototypes with embedded PBR.
Run using a Python environment with NumPy and Pillow; no model or GPU required.
"""
import argparse, hashlib, io, itertools, json, math, struct
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
SIZE=np.array([.28,.30576,.2123333333]);HALF=SIZE/2

def clipped_stone(seed):
 rng=np.random.default_rng(seed)
 # Outward CCW faces; duplicate face corners are welded by position at export validation.
 faces=[]
 for axis,sign in itertools.product(range(3),[-1,1]):
  other=[i for i in range(3) if i!=axis];n=np.eye(3)[axis]*sign
  pts=[]
  for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]:
   p=np.zeros(3);p[axis]=HALF[axis]*sign;p[other[0]]=HALF[other[0]]*u;p[other[1]]=HALF[other[1]]*v;pts.append(p)
  if np.dot(np.cross(pts[1]-pts[0],pts[2]-pts[0]),n)<0:pts.reverse()
  faces.append(pts)
 def clip(n,d):
  nonlocal faces
  new=[];cuts=[]
  for polygon in faces:
   out=[]
   for a,b in zip(polygon,polygon[1:]+polygon[:1]):
    da=np.dot(a,n)-d;db=np.dot(b,n)-d
    if da<=1e-10:out.append(a)
    if (da<0<db) or (db<0<da):
     p=a+(b-a)*(da/(da-db));out.append(p);cuts.append(p)
   if len(out)>=3:new.append(out)
  unique={tuple(np.round(p,12)):p for p in cuts};points=list(unique.values())
  if len(points)>=3:
   center=np.mean(points,axis=0);normal=n/np.linalg.norm(n);u=points[0]-center;u/=np.linalg.norm(u);v=np.cross(normal,u)
   points.sort(key=lambda p:math.atan2(np.dot(p-center,v),np.dot(p-center,u)));new.append(points)
  faces=new
 # Slight unequal edge bevels and corner flakes, never deep bites into mating faces.
 for axes in itertools.combinations(range(3),2):
  for signs in itertools.product([-1,1],repeat=2):
   n=np.zeros(3)
   for a,s in zip(axes,signs):n[a]=s
   clip(n,sum(HALF[a] for a in axes)-rng.uniform(.004,.008))
 for signs in itertools.product([-1,1],repeat=3):
  n=np.array(signs);clip(n,np.sum(HALF)-rng.uniform(.010,.019))
 pos=[];norm=[];uv=[];indices=[]
 for polygon in faces:
  normal=np.cross(polygon[1]-polygon[0],polygon[2]-polygon[0]);normal/=np.linalg.norm(normal)
  axis=int(np.argmax(abs(normal)));other=[i for i in range(3) if i!=axis];offset=rng.uniform(.08,.18,2)
  start=len(pos)
  for p in polygon:
   pos.append(p);norm.append(normal);uv.append([(p[other[0]]/SIZE[other[0]]+.5)*.72+offset[0],(p[other[1]]/SIZE[other[1]]+.5)*.72+offset[1]])
  for i in range(1,len(polygon)-1):indices.extend([start,start+i,start+i+1])
 return np.array(pos,dtype='<f4'),np.array(norm,dtype='<f4'),np.array(uv,dtype='<f4'),np.array(indices,dtype='<u2')

def stone_maps(seed,res=512):
 rng=np.random.default_rng(seed);yy,xx=np.mgrid[:res,:res]/res
 def noise(n):
  a=rng.random((n,n),dtype=np.float32)
  return np.array(Image.fromarray(a).resize((res,res),Image.Resampling.BICUBIC))-.5
 cloud=noise(5);grain=noise(64);fine=noise(256);coarse=noise(20);speck=rng.random((res,res))-.5
 # Broad mineral clouds plus fine granular matrix and shallow isolated pores.
 porefield=noise(110);pits=np.clip((-porefield-.32)*3,0,1)
 tool=np.sin((xx*76+yy*5+noise(12)*.35)*math.pi)*.007
 relief=coarse*.15+grain*.10+fine*.028+speck*.012-pits*.14+tool
 shade=.46+cloud*.22+coarse*.10+grain*.030+fine*.018+speck*.012-pits*.065
 mineral=np.clip(noise(9)+.12,0,1)*.032
 tint=[np.array([1.015,1.00,.975]),np.array([.99,1.0,1.012]),np.array([1.025,1.00,.967]),np.array([1.0,1.0,1.0]),np.array([1.01,1.005,.99])][seed%5]
 shade+=rng.uniform(-.035,.025)
 color=np.clip(shade[...,None]*tint+mineral[...,None],0,1)
 dy,dx=np.gradient(relief);normal=np.stack([-dx*3,dy*3,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 rough=np.clip(.86+coarse*.09+pits*.07,.75,.98);mr=np.zeros((res,res,3));mr[:,:,0]=1;mr[:,:,1]=rough
 def png(a):
  buf=io.BytesIO();Image.fromarray(np.uint8(np.clip(a,0,1)*255)).save(buf,format='PNG');return buf.getvalue()
 return {'basecolor':png(color),'normal':png(normal*.5+.5),'roughness':png(mr)}

def write_glb(path,asset_id,arrays,maps):
 pos,norm,uv,idx=arrays;blob=bytearray();views=[];acc=[]
 def view(data,target=None):
  while len(blob)%4:blob.append(0)
  i=len(views);v={'buffer':0,'byteOffset':len(blob),'byteLength':len(data)}
  if target:v['target']=target
  views.append(v);blob.extend(data);return i
 def access(a,kind,component,target):
  v=view(a.tobytes(),target);i=len(acc);item={'bufferView':v,'componentType':component,'count':len(a),'type':kind}
  if kind=='VEC3':item.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
  acc.append(item);return i
 p=access(pos,'VEC3',5126,34962);n=access(norm,'VEC3',5126,34962);u=access(uv,'VEC2',5126,34962);ix=access(idx,'SCALAR',5123,34963)
 images=[{'bufferView':view(data),'mimeType':'image/png','name':name} for name,data in maps.items()]
 g={'asset':{'version':'2.0','generator':'stone-block-kit procedural author'},'scene':0,'scenes':[{'nodes':[0]}],
 'nodes':[{'name':asset_id,'mesh':0}], 'meshes':[{'name':asset_id,'primitives':[{'attributes':{'POSITION':p,'NORMAL':n,'TEXCOORD_0':u},'indices':ix,'material':0}]}],
 'materials':[{'name':'weathered-gray-limestone','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':1,'metallicRoughnessTexture':{'index':2}},'normalTexture':{'index':1,'scale':.75}}],
 'textures':[{'sampler':0,'source':i} for i in range(3)],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],
 'images':images,'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':acc,
 'extras':{'assetId':asset_id,'visualOnly':True,'coordinates':'uncalibrated simulation coordinates; +Y up; +Z front; body center pivot'}}
 js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
 total=12+8+len(js)+8+len(blob);path.write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob)
 return {'assetId':asset_id,'visualRef':path.name,'preferredNode':asset_id,'localBounds':{'min':pos.min(axis=0).tolist(),'max':pos.max(axis=0).tolist()},'pivot':[0,0,0],'transformsBaked':True,'triangleCount':len(idx)//3,'embeddedTextures':list(maps),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def write_comparison(root,variants):
 """Assemble the exact distributable buffers for a five-block inspection view."""
 blob=bytearray();g={'asset':{'version':'2.0','generator':'stone kit comparison assembly'},'scene':0,'scenes':[{'nodes':[]}],**{k:[] for k in ['nodes','meshes','accessors','bufferViews','buffers','images','textures','samplers','materials']}}
 for i,variant in enumerate(variants):
  b=(root/variant['visualRef']).read_bytes();length=struct.unpack_from('<I',b,12)[0];source=json.loads(b[20:20+length]);data=b[28+length:]
  offsets={k:len(g[k]) for k in ['bufferViews','accessors','images','textures','samplers','materials','meshes','nodes']};off=len(blob);blob.extend(data)
  for v in source['bufferViews']:v['byteOffset']=v.get('byteOffset',0)+off
  for a in source['accessors']:a['bufferView']+=offsets['bufferViews']
  for im in source['images']:im['bufferView']+=offsets['bufferViews']
  for t in source['textures']:t['source']+=offsets['images'];t['sampler']+=offsets['samplers']
  for material in source['materials']:
   for key in ['baseColorTexture','metallicRoughnessTexture']:material['pbrMetallicRoughness'][key]['index']+=offsets['textures']
   material['normalTexture']['index']+=offsets['textures']
  for mesh in source['meshes']:
   for primitive in mesh['primitives']:
    primitive['attributes']={k:v+offsets['accessors'] for k,v in primitive['attributes'].items()};primitive['indices']+=offsets['accessors'];primitive['material']+=offsets['materials']
  for node in source['nodes']:node['mesh']+=offsets['meshes'];node['translation']=[(i-2)*.37,0,0]
  for k in offsets:g[k].extend(source[k])
  g['scenes'][0]['nodes'].append(offsets['nodes'])
 g['buffers']=[{'byteLength':len(blob)}];js=json.dumps(g,separators=(',',':')).encode();js+=b' '*(-len(js)%4);blob+=b'\0'*(-len(blob)%4)
 (root/'kit-comparison.glb').write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob)

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 variants=[]
 for i in range(5):
  seed=100301+i;asset_id=f'limestone-block-{i+1:02d}';arrays=clipped_stone(seed);maps=stone_maps(seed)
  item=write_glb(args.out/f'{asset_id}.glb',asset_id,arrays,maps);item['seed']=seed;variants.append(item)
 descriptor={'schema':'kaminos.stone-block-kit.v0','assetId':'limestone-block-kit-v0','route':'deterministic clipped cuboids with procedural limestone PBR','coordinateFrame':{'handedness':'right','up':'+Y','forward':'+Z','unit':'uncalibrated-simulation-coordinate'},'commonEnvelope':SIZE.tolist(),'instancePolicy':'stable-body-id modulo variant-count; body-owned transforms','structuralAuthority':False,'collisionAuthority':False,'contactFacePolicy':'major faces remain at common box planes; edge and corner relief is inward','variants':variants}
 write_comparison(args.out,variants)
 (args.out/'descriptor.json').write_text(json.dumps(descriptor,indent=2)+'\n');print(json.dumps({'output':str(args.out),'variants':len(variants),'bytes':sum((args.out/v['visualRef']).stat().st_size for v in variants)}))
if __name__=='__main__':main()
