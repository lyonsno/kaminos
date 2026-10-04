"""Validate the distributable stone kit, independently of its generator."""
import collections, json, struct, sys
from pathlib import Path
ROOT = Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'artifacts/stone-block-kit-v0-2026-10-03'
assert (ROOT/'descriptor.json').exists(), 'five-block kit descriptor is absent'
d=json.loads((ROOT/'descriptor.json').read_text())
assert len(d['variants'])==5 and len({v['assetId'] for v in d['variants']})==5
assert d['structuralAuthority'] is False and d['collisionAuthority'] is False
assert d['coordinateFrame']=={'handedness':'right','up':'+Y','forward':'+Z','unit':'uncalibrated-simulation-coordinate'}
sizes=[.28,.30576,.2123333333]
def accessor(g,blob,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']]; assert v['buffer']==0
 fmt={5126:'f',5123:'H',5125:'I'}[a['componentType']];n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
 start=v.get('byteOffset',0)+a.get('byteOffset',0); vals=struct.unpack_from('<'+fmt*(n*a['count']),blob,start)
 return [vals[k:k+n] for k in range(0,len(vals),n)]
for variant in d['variants']:
 b=(ROOT/variant['visualRef']).read_bytes(); magic,version,size=struct.unpack_from('<III',b)
 assert magic==0x46546c67 and version==2 and size==len(b)
 length,kind=struct.unpack_from('<II',b,12); assert kind==0x4e4f534a
 g=json.loads(b[20:20+length]); blen,bkind=struct.unpack_from('<II',b,20+length);assert bkind==0x004e4942
 blob=b[28+length:28+length+blen];assert len(blob)>=g['buffers'][0]['byteLength']
 assert len(g['nodes'])==len(g['meshes'])==1
 assert not any(k in g['nodes'][0] for k in ['translation','rotation','scale','matrix']), 'transforms must be baked'
 p=g['meshes'][0]['primitives'][0];pos=accessor(g,blob,p['attributes']['POSITION']);norm=accessor(g,blob,p['attributes']['NORMAL']);uv=accessor(g,blob,p['attributes']['TEXCOORD_0']);indices=[a[0] for a in accessor(g,blob,p['indices'])]
 assert len(pos)==len(norm)==len(uv) and len(indices)%3==0
 for axis,target in enumerate(sizes):
  lo=min(p[axis] for p in pos);hi=max(p[axis] for p in pos)
  assert abs(lo+target/2)<3e-8 and abs(hi-target/2)<3e-8, 'common centered fit differs'
  assert abs(variant['localBounds']['min'][axis]-lo)<3e-8 and abs(variant['localBounds']['max'][axis]-hi)<3e-8
 edges=collections.defaultdict(list);volume=0
 for k in range(0,len(indices),3):
  a,b,c=[pos[i] for i in indices[k:k+3]]
  cross=(b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]);volume+=sum(a[i]*cross[i] for i in range(3))/6
  verts=[tuple(round(x,7) for x in v) for v in [a,b,c]]
  for x,y in zip(verts,verts[1:]+verts[:1]):
   assert x!=y,'degenerate triangle edge';edges[tuple(sorted([x,y]))].append((x,y))
 assert all(len(e)==2 and e[0]==e[1][::-1] for e in edges.values()), 'mesh is not closed with consistent winding'
 assert volume>.8*__import__('math').prod(sizes), 'stone lost too much volume'
 assert len(indices)//3==variant['triangleCount']
 mat=g['materials'][p['material']];assert mat['pbrMetallicRoughness']['metallicFactor']==0
 for field,owner in [('baseColorTexture',mat['pbrMetallicRoughness']),('metallicRoughnessTexture',mat['pbrMetallicRoughness']),('normalTexture',mat)]:
  im=g['images'][g['textures'][owner[field]['index']]['source']];v=g['bufferViews'][im['bufferView']]
  assert im['mimeType']=='image/png' and 'uri' not in im
  assert blob[v['byteOffset']:v['byteOffset']+8]==b'\x89PNG\r\n\x1a\n'
 print(variant['assetId'],len(indices)//3,'triangles; closed; centered; embedded PBR')
print('PASS: all five distributable stone blocks match the consumer brief')
