// kaminos-test: node
// Slice: a plane cuts the selected faces, the mesh splits where the cut separates it,
// both openings are capped, and the smaller piece becomes the new part.
import assert from 'node:assert/strict';
import {encodeGlb,parseGlb,readTrianglePrimitives} from '../poly-glb-io.mjs';
import {buildPolyMesh,polyMeshCensus} from '../poly-mesh-core.mjs';
import {separateSelection,sliceSelection} from '../poly-separate-selection.mjs';

// A closed column, 1 x 2 x 1, with a ring of vertices at y = 0, 1 and 2.
const ring=y=>[[0,y,0],[1,y,0],[1,y,1],[0,y,1]],positions=Float32Array.from([0,1,2].flatMap(y=>ring(y).flat())),indices=[];
const quad=(a,b,c,d)=>indices.push(a,b,c,a,c,d);
for(const level of [0,1])for(let i=0;i<4;i++){const j=(i+1)%4,lo=4*level,hi=4*level+4;quad(lo+i,lo+j,hi+j,hi+i);}
quad(0,3,2,1);quad(8,9,10,11);
const I=Uint32Array.from(indices),faces=I.length/3;
const bin=new Uint8Array(positions.byteLength+I.byteLength);bin.set(new Uint8Array(positions.buffer),0);bin.set(new Uint8Array(I.buffer),positions.byteLength);
const glb=encodeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Column',mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{name:'paint'}],
  buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:I.byteLength}],
  accessors:[{bufferView:0,componentType:5126,count:12,type:'VEC3',min:[0,0,0],max:[1,2,1]},{bufferView:1,componentType:5125,count:I.length,type:'SCALAR'}]},bin);
const all=new Uint8Array(faces).fill(1),plane={point:[0,.5,0],normal:[0,1,0]},geometry={positions,indices:I};
const yRange=bytes=>{const [p]=readTrianglePrimitives(bytes),y=p.positions.filter((_,i)=>i%3===1);return [Math.min(...y),Math.max(...y)];};
// Cap faces sit in a second primitive (the cap material) over the same vertices, so check them together.
const closed=bytes=>{const all=readTrianglePrimitives(bytes);return polyMeshCensus(buildPolyMesh({...all[0],indices:Uint32Array.from(all.flatMap(p=>[...p.indices]))})).boundaryEdges===0;};

const out=sliceSelection(glb,all,plane,{geometry,name:'Foot',restName:'Column'});
assert.deepEqual(yRange(out.part.bytes),[0,.5],'the smaller side, below the plane, is the new part');
assert.deepEqual(yRange(out.rest.bytes),[.5,2],'the rest keeps everything above');
assert.ok(closed(out.part.bytes)&&closed(out.rest.bytes),'both openings are capped, so each piece is closed');
assert.ok(out.part.capFaces>0&&out.rest.capFaces>0);
assert.equal(out.part.openChains,0);
assert.deepEqual(out.part.receipt.operations.map(o=>o.op),['bisect','separate','section-cap']);
assert.equal(out.part.receipt.operations[1].keep,'selection');assert.equal(out.rest.receipt.operations[1].keep,'remainder');

// Only the faces the cut needs have to be selected: the lower storey's walls are enough.
const lower=Uint8Array.from({length:faces},(_,f)=>f<8?1:0);
assert.deepEqual(yRange(sliceSelection(glb,lower,plane).part.bytes),[0,.5]);

// The plane's side does not decide which piece is new; size does.
assert.deepEqual(yRange(sliceSelection(glb,all,{point:[0,1.5,0],normal:[0,-1,0]}).part.bytes),[1.5,2]);

// Refusals: a cut that leaves the sides joined elsewhere, a line that misses, nothing selected.
const oneWall=Uint8Array.from({length:faces},(_,f)=>f<2?1:0);
assert.throws(()=>sliceSelection(glb,oneWall,plane),/does not separate the mesh/);
assert.throws(()=>sliceSelection(glb,all,{point:[0,5,0],normal:[0,1,0]}),/does not cross the selected faces/);
assert.throws(()=>sliceSelection(glb,new Uint8Array(faces),plane),/Select the faces to slice/);

// A sliced piece can be sliced or separated again: its cap faces (a second primitive) edit
// with the rest, keep the cap material, and the new cut adds to them.
const column=out.rest.bytes,columnFaces=readTrianglePrimitives(column).reduce((n,p)=>n+p.indices.length/3,0);
const again=sliceSelection(column,new Uint8Array(columnFaces).fill(1),{point:[0,1.5,0],normal:[0,1,0]},{name:'Top'});
assert.deepEqual(yRange(again.part.bytes),[1.5,2]);assert.deepEqual(yRange(again.rest.bytes),[.5,1.5]);
assert.ok(closed(again.rest.bytes),'the middle piece is closed by the old cap below and the new one above');
const middle=parseGlb(again.rest.bytes).json;
assert.deepEqual(middle.materials.map(m=>m.name),['paint','Cut cap'],'still the source material plus one cap material');
assert.equal(middle.meshes[0].primitives.length,2);
const capFaces=readTrianglePrimitives(again.rest.bytes).find(p=>p.material===1).indices.length/3;
assert.equal(capFaces,out.rest.capFaces+again.rest.capFaces,'the old cap stays cap, the new cap joins it');
const someFaces=Uint8Array.from({length:columnFaces},(_,f)=>f===0?1:0);
assert.equal(separateSelection(column,someFaces).part.faces,1,'Separate works on a sliced piece too');

