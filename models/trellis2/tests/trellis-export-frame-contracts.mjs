import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Matrix3, Matrix4, Vector3 } from '../../../lib/three.core.js';
import { encodeTrellisGeometryGLB, encodeTrellisPbrGLB } from '../sparse-decoder.js';

const observed=JSON.parse(await readFile(new URL('./fixtures/trellis-glb-export-source.json',import.meta.url),'utf8'));
assert.equal(observed.source.modelCalls,0);
assert.equal(observed.source.route,'actual fresh-export AST plus trimesh GLB exporter');
const mesh={vertices:new Float32Array(observed.input.vertices.flat()),
  triangles:new Uint32Array(observed.input.triangles.flat()),uvs:new Float32Array(observed.input.uvs.flat())};
const a=new Vector3().fromArray(mesh.vertices,0),b=new Vector3().fromArray(mesh.vertices,3),c=new Vector3().fromArray(mesh.vertices,6),
  normal=b.sub(a).cross(c.sub(a)).normalize().toArray();
mesh.normals=new Float32Array([...normal,...normal,...normal]);
const textures={width:2,height:2,alphaMode:'OPAQUE',baseColor:new Uint8Array(observed.input.pixels.flat(2)),
  metallicRoughness:new Uint8Array(observed.input.pixels.flat(2))};
for(const [name,glb] of [['neutral',encodeTrellisGeometryGLB(mesh)],['PBR',await encodeTrellisPbrGLB(mesh,{textures})]]){
  const view=new DataView(glb),jsonLength=view.getUint32(12,true),
    doc=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jsonLength))),node=doc.nodes[doc.scenes[doc.scene].nodes[0]],
    matrix=new Matrix4();if(node.matrix)matrix.fromArray(node.matrix);
  const normalMatrix=new Matrix3().getNormalMatrix(matrix),primitive=doc.meshes[node.mesh].primitives[0];
  function attribute(key,width){const accessor=doc.accessors[primitive.attributes[key]],buffer=doc.bufferViews[accessor.bufferView];
    return new Float32Array(glb,28+jsonLength+(buffer.byteOffset??0)+(accessor.byteOffset??0),accessor.count*width);}
  for(const key of ['POSITION','NORMAL']){
    const values=attribute(key,3);
    for(let row=0;row<values.length/3;row++){
      const point=new Vector3().fromArray(values,row*3);
      if(key==='POSITION')point.applyMatrix4(matrix);else point.applyNormalMatrix(normalMatrix);
      point.toArray().forEach((value,axis)=>assert.ok(Math.abs(value-observed.expected[key][row][axis])<2e-7,
        `${name} ${key} ${row}/${axis}: exported source frame expected ${observed.expected[key][row][axis]}, got ${value}`));
    }
  }
  assert.deepEqual([...attribute('POSITION',3)],[...mesh.vertices],'Local model coordinates must remain unchanged.');
  if(name==='PBR')assert.deepEqual([...attribute('TEXCOORD_0',2)],observed.expected.TEXCOORD_0.flat(),
    'Source V flip is canceled by trimesh export; direct GLB must not flip it a second time.');
}
assert.deepEqual(observed.expected.baseColorPixels,observed.input.pixels,'Effective source export preserves texture row order.');
console.log('Neutral and learned GLBs match actual source world positions/normals and emitted UVs; raw model coordinates stay unchanged.');
