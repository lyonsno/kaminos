// kaminos-test: node
// Separate > Selection on a GLB: the selected faces leave as one mesh, the rest stays as another,
// both keep the source material and node placement, and nothing is lost or invented.
import assert from 'node:assert/strict';
import {encodeGlb,parseGlb,readTrianglePrimitives} from '../poly-glb-io.mjs';
import {moveOrigin,separateSelection} from '../poly-separate-selection.mjs';

// A strip of two quads (four triangles) placed by a rotating, moving node.
const positions=new Float32Array([0,0,0, 1,0,0, 2,0,0, 0,1,0, 1,1,0, 2,1,0]),uvs=new Float32Array([0,0, .5,0, 1,0, 0,1, .5,1, 1,1]);
const indices=new Uint32Array([0,1,4, 0,4,3, 1,2,5, 1,5,4]),matrix=[0,0,-1,0, 0,1,0,0, 1,0,0,0, 3,0,0,1];
function strip({indexed=true}={}){
  const corners=indexed?null:Float32Array.from([...indices].flatMap(v=>[...positions.subarray(3*v,3*v+3)]));
  const P=corners??positions,parts=[P,...(indexed?[uvs,indices]:[])],bin=new Uint8Array(parts.reduce((n,a)=>n+a.byteLength,0));
  let offset=0;const views=parts.map(a=>{bin.set(new Uint8Array(a.buffer),offset);const view={buffer:0,byteOffset:offset,byteLength:a.byteLength};offset+=a.byteLength;return view;});
  const accessors=[{bufferView:0,componentType:5126,count:P.length/3,type:'VEC3'}];
  if(indexed)accessors.push({bufferView:1,componentType:5126,count:6,type:'VEC2'},{bufferView:2,componentType:5125,count:12,type:'SCALAR'});
  return encodeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Arm',mesh:0,matrix}],
    meshes:[{primitives:[{attributes:indexed?{POSITION:0,TEXCOORD_0:1}:{POSITION:0},...(indexed?{indices:2}:{}),material:0}]}],materials:[{name:'atlas'}],
    buffers:[{byteLength:bin.length}],bufferViews:views,accessors},bin);
}
const corners=({positions:P,indices:I})=>[...I].map(v=>[...P.subarray(3*v,3*v+3)].join(','));
const glb=strip(),mask=Uint8Array.from([0,0,1,1]),geometry={positions,indices};
const out=separateSelection(glb,mask,{geometry,name:'Cup',source:{sha256:'abc',url:'/api/read?root=x&path=abc.glb'}});

const [part]=readTrianglePrimitives(out.part.bytes),[rest]=readTrianglePrimitives(out.rest.bytes);
assert.equal(out.part.faces,2);assert.equal(out.rest.faces,2);
assert.deepEqual(corners(part),corners({positions,indices:indices.subarray(6)}),'the part is exactly the selected faces, corner for corner');
assert.deepEqual(corners(rest),corners({positions,indices:indices.subarray(0,6)}),'the rest is exactly the unselected faces');
assert.deepEqual([...part.uvs],[.5,0, 1,0, 1,1, .5,1],'corner UVs travel with their faces, so the atlas still fits');
for(const piece of [part,rest])assert.deepEqual(piece.worldMatrices,[matrix],'both keep the node placement, so nothing moves on screen');
const partJson=parseGlb(out.part.bytes).json;
assert.equal(partJson.materials[0].name,'atlas','the source material comes along');
assert.equal(partJson.nodes[0].name,'Cup');
assert.deepEqual(partJson.asset.extras.kaminosDerivation,{schema:'kaminos.poly-derivation.v0',source:{sha256:'abc',url:'/api/read?root=x&path=abc.glb'},
  operations:[{op:'separate',keep:'selection',selectedFaces:2,sourceFaces:4}]},'the part says where it came from and what was done');
assert.equal(parseGlb(out.rest.bytes).json.asset.extras.kaminosDerivation.operations[0].keep,'remainder');
assert.deepEqual(out.part.receipt,partJson.asset.extras.kaminosDerivation,'the returned receipt is the embedded one');

// Primitives without an index buffer separate the same way.
const flat=separateSelection(strip({indexed:false}),mask);
assert.deepEqual(corners(readTrianglePrimitives(flat.part.bytes)[0]),corners({positions,indices:indices.subarray(6)}));

// The selection must have been made on these very triangles, or nothing is written.
const moved=Float32Array.from(positions);moved[3*5+1]+=1e-3;
assert.throws(()=>separateSelection(glb,mask,{geometry:{positions:moved,indices}}),/does not match the GLB at face 2/);
assert.throws(()=>separateSelection(glb,Uint8Array.from([1,0,1])),/covers 3 faces but the GLB has 4/);
assert.throws(()=>separateSelection(glb,new Uint8Array(4)),/Select faces to separate/);
assert.throws(()=>separateSelection(glb,Uint8Array.from([1,1,1,1])),/nothing would remain/);

// Origin to Selection: the chosen point becomes the object's origin. The geometry is untouched;
// the node moves by the opposite of the returned offset, so with the object moved by that offset
// every vertex stays where it was in the world.
{
  const apply=(m,[x,y,z])=>[0,1,2].map(r=>m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r]);
  const point=[1.5,.5,0],moved=moveOrigin(glb,point,{geometry,source:{sha256:'abc',url:'u'}});
  assert.deepEqual(moved.offset,apply(matrix,point),'the offset is the chosen point in the object frame');
  const [after]=readTrianglePrimitives(moved.bytes),node=after.worldMatrices[0];
  assert.deepEqual(apply(node,point).map(v=>Math.round(v*1e9)/1e9+0),[0,0,0],'the chosen point now sits on the origin');
  for(let v=0;v<6;v++){
    const p=[...positions.subarray(3*v,3*v+3)],before=apply(matrix,p),now=apply(node,p).map((x,k)=>x+moved.offset[k]);
    assert.deepEqual(now.map(x=>Math.round(x*1e9)),before.map(x=>Math.round(x*1e9)),`vertex ${v} does not move`);
  }
  assert.deepEqual(corners(after),corners({positions,indices}),'the triangles themselves are unchanged, corner for corner');
  assert.deepEqual(moved.receipt.operations,[{op:'origin',to:'selection',point}]);
  assert.throws(()=>moveOrigin(glb,[0,NaN,0]),/finite point/);
}

