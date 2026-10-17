// kaminos-test: node
// Slice: a plane cuts the selected faces, the mesh splits where the cut separates it,
// both openings are capped, and the smaller piece becomes the new part.
import assert from 'node:assert/strict';
import {encodeGlb,parseGlb,readTrianglePrimitives} from '../poly-glb-io.mjs';
import {buildPolyMesh,polyMeshCensus} from '../poly-mesh-core.mjs';
import {moveOrigin,separateSelection,sliceSelection} from '../poly-separate-selection.mjs';

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
// One wall is enough: the cut follows the line around the column.
const oneWall=Uint8Array.from({length:faces},(_,f)=>f<2?1:0);
assert.deepEqual(yRange(sliceSelection(glb,oneWall,plane).part.bytes),[0,.5]);
// A loop the plane crosses in two places that do not touch: selecting one crossing cannot
// separate it, and following the cut cannot reach the other.
{
  const L=Float32Array.from([0,0,0, 2,0,0, 2,2,0, 0,2,0, 0,0,1, 2,0,1, 2,2,1, 0,2,1]),Q=[];
  for(let i=0;i<4;i++){const j=(i+1)%4;Q.push(i,j,j+4,i,j+4,i+4);}
  const LI=Uint32Array.from(Q),lb=new Uint8Array(L.byteLength+LI.byteLength);lb.set(new Uint8Array(L.buffer),0);lb.set(new Uint8Array(LI.buffer),L.byteLength);
  const loop=encodeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],
    buffers:[{byteLength:lb.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:L.byteLength},{buffer:0,byteOffset:L.byteLength,byteLength:LI.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3'},{bufferView:1,componentType:5125,count:LI.length,type:'SCALAR'}]},lb);
  // Faces 2 and 3 are the side at x = 2; faces 6 and 7 the side at x = 0.
  assert.throws(()=>sliceSelection(loop,Uint8Array.from([0,0,1,1,0,0,0,0]),{point:[0,1,0],normal:[0,1,0]}),/does not separate the mesh/);
}
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

// Selected debris that the cut never touches stays where it is: a floating triangle above the
// plane must not ride off with the part grown from the cut.
{
  const P=Float32Array.from([...positions,3,1.8,0,3.2,1.8,0,3,1.9,0]),J=Uint32Array.from([...I,12,13,14]);
  const bin2=new Uint8Array(P.byteLength+J.byteLength);bin2.set(new Uint8Array(P.buffer),0);bin2.set(new Uint8Array(J.buffer),P.byteLength);
  const withDebris=encodeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{name:'paint'}],
    buffers:[{byteLength:bin2.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:P.byteLength},{buffer:0,byteOffset:P.byteLength,byteLength:J.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:15,type:'VEC3'},{bufferView:1,componentType:5125,count:J.length,type:'SCALAR'}]},bin2);
  const cut=sliceSelection(withDebris,new Uint8Array(J.length/3).fill(1),{point:[0,1.5,0],normal:[0,1,0]});
  const xRange=bytes=>{const x=readTrianglePrimitives(bytes)[0].positions.filter((_,i)=>i%3===0);return [Math.min(...x),Math.max(...x)];};
  assert.deepEqual(xRange(cut.part.bytes),[0,1],'the part is the column top only; the floating triangle is not part of what the cut separated');
  assert.equal(xRange(cut.rest.bytes)[1]>3,true,'the debris stays with the remainder');
  const flipped=sliceSelection(withDebris,new Uint8Array(J.length/3).fill(1),{point:[0,1.5,0],normal:[0,-1,0]});
  assert.deepEqual(xRange(flipped.part.bytes),[0,1],'with the plane facing the other way, the debris still stays behind');
}

// Re-writing a piece whose primitives share one vertex block keeps one copy of each vertex.
{
  const piece=out.rest.bytes,[first]=readTrianglePrimitives(piece),before=first.positions.length/3;
  const [after]=readTrianglePrimitives(moveOrigin(piece,[0,1,0]).bytes);
  assert.equal(after.positions.length/3,before,'Origin to Selection does not duplicate vertices');
}

// A selection that misses a face crossing the line (a long triangle whose centre lies outside
// the box) still cuts cleanly: the cut follows the line into crossing faces that touch it.
{
  const gappy=Uint8Array.from({length:faces},(_,f)=>f>=1&&f<8?1:0);
  const cut=sliceSelection(glb,gappy,plane);
  assert.deepEqual(yRange(cut.part.bytes),[0,.5]);assert.ok(closed(cut.part.bytes)&&closed(cut.rest.bytes),'both pieces close');
  assert.equal(cut.part.receipt.operations[0].followedFaces,1,'the receipt says the cut followed one unselected face');
}


// Circle cut: a cylinder along the view cuts the selected faces. The inside of the circle becomes
// the part, both openings are capped on the cylinder, and the part's origin sits on the axis with
// its local X along it, so rotating about X turns it about the hinge.
{
  const N=8,P=[],Q=[],vertex=(x,y,z)=>{P.push(x,y,z);return P.length/3-1;};
  const grid=z=>{const ids=[];for(let j=0;j<=N;j++)for(let i=0;i<=N;i++)ids.push(vertex(-2+4*i/N,-2+4*j/N,z));return (i,j)=>ids[j*(N+1)+i];};
  const top=grid(.1),bottom=grid(-.1),face=(a,b,c,d)=>Q.push(a,b,c,a,c,d);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){face(top(i,j),top(i+1,j),top(i+1,j+1),top(i,j+1));face(bottom(i,j),bottom(i,j+1),bottom(i+1,j+1),bottom(i+1,j));}
  for(let i=0;i<N;i++){face(bottom(i,0),bottom(i+1,0),top(i+1,0),top(i,0));face(bottom(i+1,N),bottom(i,N),top(i,N),top(i+1,N));face(bottom(0,i+1),bottom(0,i),top(0,i),top(0,i+1));face(bottom(N,i),bottom(N,i+1),top(N,i+1),top(N,i));}
  const PP=Float32Array.from(P),QQ=Uint32Array.from(Q),pb=new Uint8Array(PP.byteLength+QQ.byteLength);pb.set(new Uint8Array(PP.buffer),0);pb.set(new Uint8Array(QQ.buffer),PP.byteLength);
  const plate=encodeGlb({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{name:'steel'}],
    buffers:[{byteLength:pb.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:PP.byteLength},{buffer:0,byteOffset:PP.byteLength,byteLength:QQ.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:PP.length/3,type:'VEC3'},{bufferView:1,componentType:5125,count:QQ.length,type:'SCALAR'}]},pb);
  const R=1.1,cylinder={kind:'cylinder',point:[0,0,0],axis:[0,0,1],radius:R};
  const cut=sliceSelection(plate,new Uint8Array(QQ.length/3).fill(1),cylinder,{name:'Hub'});
  const radial=bytes=>{const [p]=readTrianglePrimitives(bytes),r=[];for(let i=0;i<p.positions.length;i+=3)r.push(Math.hypot(p.positions[i],p.positions[i+1]));return r;};
  assert.ok(radial(cut.part.bytes).every(r=>r<=R+1e-5),'the part is the inside of the circle');
  assert.ok(radial(cut.rest.bytes).every(r=>r>=R-1e-5),'the rest is the plate around it');
  assert.ok(closed(cut.part.bytes)&&closed(cut.rest.bytes),'both pieces are closed by caps');
  const capOf=bytes=>{const all=readTrianglePrimitives(bytes),cap=all.find(p=>p.material===1),used=new Set(cap.indices);return [...used].map(v=>Math.hypot(cap.positions[3*v],cap.positions[3*v+1]));};
  assert.ok(capOf(cut.part.bytes).every(r=>Math.abs(r-R)<1e-4),'the cap lies on the cylinder');
  assert.equal(cut.part.receipt.operations[0].shape.kind,'cylinder');
  // The hinge frame: the axis point maps to the part's origin and the axis to its local X.
  const node=readTrianglePrimitives(cut.part.bytes)[0].worldMatrices[0],apply=(m,[x,y,z],w=1)=>[0,1,2].map(r=>m[r]*x+m[4+r]*y+m[8+r]*z+w*m[12+r]);
  const round=v=>v.map(x=>Math.round(x*1e6)/1e6+0);
  assert.deepEqual(round(apply(node,cut.part.frame.point)),[0,0,0],'the axis point sits on the origin');
  assert.deepEqual(round(apply(node,[0,0,1],0)),[1,0,0],'the hinge axis is the part\'s local X');
  assert.deepEqual(round(cut.part.frame.offset),round(cut.part.frame.point),'the object moves to the axis point');
  assert.equal(cut.part.frame.rotation.length,4);
  assert.throws(()=>sliceSelection(plate,new Uint8Array(QQ.length/3).fill(1),{kind:'cylinder',point:[0,0,0],axis:[0,0,0],radius:1}),/axis/);
}

// Cut preview: the section outline a cut would make, without cutting. Outlines that close are the
// ones that will fill; open ones will not.
{
  const {sectionPreview}=await import('../poly-mesh-edit.mjs');
  const arrays={positions,normals:null,uvs:null,indices:I};
  const level=sectionPreview(arrays,all,plane);
  assert.equal(level.closed.length,1,'one closed outline around the column');assert.equal(level.open.length,0);
  assert.ok(level.closed[0].length>=4&&level.closed[0].every(q=>Math.abs(q[1]-.5)<1e-9),'it lies on the cut plane, in the mesh frame');
  const oneSide=Uint8Array.from({length:faces},(_,f)=>f<2?1:0);
  assert.equal(sectionPreview(arrays,oneSide,plane).closed.length,1,'the preview follows the cut around, as Slice does');
  // An open sheet: the strip of the U-loop's left side alone leaves an open outline.
  const sheet={positions:Float32Array.from([0,0,0, 0,2,0, 0,0,1, 0,2,1]),normals:null,uvs:null,indices:Uint32Array.from([0,1,3, 0,3,2])};
  const openPreview=sectionPreview(sheet,Uint8Array.from([1,1]),{point:[0,1,0],normal:[0,1,0]});
  assert.equal(openPreview.closed.length,0);assert.equal(openPreview.open.length,1,'an open outline is reported as open');
}
