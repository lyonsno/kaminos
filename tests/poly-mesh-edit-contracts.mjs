// kaminos-test: node
import assert from 'node:assert/strict';
import {buildPolyMesh,polyMeshCensus} from '../poly-mesh-core.mjs';
import {bisectFaces,extractFaces,capPlanarOpenings,signedVolume,cutBarrier,sectionCap} from '../poly-mesh-edit.mjs';
import {selectLinkedFaces} from '../poly-mesh-core.mjs';

const near=(a,b,tolerance=1e-5)=>Math.abs(a-b)<=tolerance;
function seamCube(){
  const sides=[[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[0,0,1],[1,0,0]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[0,1,0],[1,0,0]]];
  const positions=[],normals=[],uvs=[],indices=[];
  sides.forEach(([n,u,v],k)=>{
    for(const [s,t] of [[0,0],[1,0],[1,1],[0,1]]){positions.push(...[0,1,2].map(i=>n[i]+(2*s-1)*u[i]+(2*t-1)*v[i]));normals.push(...n);uvs.push((k+s)/6,t);}
    indices.push(4*k,4*k+1,4*k+2,4*k,4*k+2,4*k+3);
  });
  return {positions:Float32Array.from(positions),normals:Float32Array.from(normals),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices)};
}
// A thick-walled tube: outer and inner walls plus top and bottom rings, wound outward.
function tube(n=16,R=1,r=.5,h=2){
  const positions=[],indices=[],ring=(radius,z)=>{const start=positions.length/3;for(let i=0;i<n;i++){const a=2*Math.PI*i/n;positions.push(radius*Math.cos(a),radius*Math.sin(a),z);}return start;};
  const ob=ring(R,0),ot=ring(R,h),ib=ring(r,0),it=ring(r,h);
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    indices.push(ob+i,ob+j,ot+j, ob+i,ot+j,ot+i);
    indices.push(ib+i,it+j,ib+j, ib+i,it+i,it+j);
    indices.push(ot+i,ot+j,it+j, ot+i,it+j,it+i);
    indices.push(ob+i,ib+j,ob+j, ob+i,ib+i,ib+j);
  }
  return {positions:Float32Array.from(positions),indices:Uint32Array.from(indices),annulusArea:n/2*Math.sin(2*Math.PI/n)*(R*R-r*r)};
}
const closed=arrays=>{const c=polyMeshCensus(buildPolyMesh(arrays));return c.boundaryEdges===0&&c.nonManifoldEdges===0&&c.flippedEdges===0;};
const all=arrays=>new Uint8Array(arrays.indices.length/3).fill(1);
const sides=(cut,s)=>Uint8Array.from(cut.side,v=>v===s?1:0);

// Cut a closed cube at z=0.25, separate the two sides and cap each opening.
const cube=seamCube();
assert.ok(closed(cube));
assert.ok(near(signedVolume(cube),8));
const cut=bisectFaces(cube,all(cube),{point:[0,0,.25],normal:[0,0,1]});
assert.equal(cut.side.length,cut.arrays.indices.length/3);
assert.ok(closed(cut.arrays),'cutting never opens the surface');
assert.ok(near(signedVolume(cut.arrays),8),'nor changes its volume');
for(const [s,volume] of [[1,3],[-1,5]]){
  const {part}=extractFaces(cut.arrays,sides(cut,s));
  assert.ok(!closed(part),'a separated half is open at the cut');
  const capped=capPlanarOpenings(part,{point:[0,0,.25],normal:[0,0,1]},{side:s});
  assert.equal(capped.loops,1);
  assert.ok(closed(capped.arrays),`the ${s>0?'upper':'lower'} half is watertight after capping`);
  assert.ok(near(signedVolume(capped.arrays),volume),`and holds volume ${volume}, so the cap faces outward`);
  const capFaces=[...capped.arrays.faceMaterial].filter(m=>m===1).length;
  assert.ok(capFaces>=2,'cap faces carry their own material slot');
  assert.equal(capped.arrays.faceMaterial.length,capped.arrays.indices.length/3);
}

// A cut point interpolates the attributes of the face it splits.
const quad={positions:Float32Array.of(0,0,0,1,0,0,1,1,0,0,1,0),uvs:Float32Array.of(0,0,1,0,1,1,0,1),normals:Float32Array.of(0,0,1,0,0,1,0,0,1,0,0,1),indices:Uint32Array.of(0,1,2,0,2,3)};
const quadCut=bisectFaces(quad,all(quad),{point:[.25,0,0],normal:[1,0,0]});
const p=quadCut.arrays.positions,u=quadCut.arrays.uvs;
let found=false;
for(let i=4;i<p.length/3;i++)if(near(p[3*i],.25)&&near(p[3*i+1],0)){found=true;assert.ok(near(u[2*i],.25)&&near(u[2*i+1],0),'the cut point on the bottom edge carries uv (0.25, 0)');}
assert.ok(found);
for(let i=0;i<4;i++)assert.deepEqual([...quadCut.arrays.uvs.subarray(2*i,2*i+2)],[...quad.uvs.subarray(2*i,2*i+2)],'existing vertices keep their attributes');

// A local cut splits only the selected faces; neighbors absorb the cut points without cracks.
const ySide=new Uint8Array(12);ySide[4]=ySide[5]=1;
const local=bisectFaces(cube,ySide,{point:[0,0,0],normal:[0,0,1]});
assert.ok(closed(local.arrays),'no T-junction cracks where the cut leaves the selection');
const localMesh=buildPolyMesh(local.arrays);
assert.equal(localMesh.vertexCount,11,'cut points on both +Y vertical edges and on the +Y diagonal');
for(let f=0;f<local.side.length;f++){
  const from=local.sourceFace[f];
  if(!ySide[from])assert.equal(local.side[f],0,'unselected faces are not assigned a side');
  else assert.notEqual(local.side[f],0);
}
const xSideFaces=[...local.sourceFace].filter(f=>f===0||f===1).length;
assert.ok(xSideFaces>2,'the +X side absorbs the cut point on the edge it shares with +Y');

// After a local cut, the cut line is a barrier: Select Linked from one side stops there,
// like a seam marked along a bisect in Blender, even though the cut faces stay welded.
const band=bisectFaces(cube,all(cube),{point:[0,0,.25],normal:[0,0,1]});
const bandMesh=buildPolyMesh(band.arrays),barrier=cutBarrier(bandMesh,band.side);
assert.equal(barrier.length,bandMesh.edgeCount);
const topSeed=[...band.side.keys()].find(f=>band.side[f]===1);
const linked=selectLinkedFaces(bandMesh,[topSeed],{barrier});
for(let f=0;f<band.side.length;f++)assert.equal(linked[f],band.side[f]===1?1:0,'the flood takes exactly the faces above the cut');
assert.equal([...selectLinkedFaces(bandMesh,[topSeed])].every(Boolean),true,'without the barrier the welded cube is one piece');
assert.throws(()=>selectLinkedFaces(bandMesh,[0],{barrier:new Uint8Array(2)}),/barrier/);

// A thick tube cut through its middle leaves an annulus; the cap keeps the hole.
const t=tube();
assert.ok(closed(t));
assert.ok(near(signedVolume(t),2*t.annulusArea,1e-4));
const tubeCut=bisectFaces(t,all(t),{point:[0,0,1],normal:[0,0,1]});
const {part:upper}=extractFaces(tubeCut.arrays,sides(tubeCut,1));
const tubeCap=capPlanarOpenings(upper,{point:[0,0,1],normal:[0,0,1]},{side:1});
assert.equal(tubeCap.loops,2,'outer and inner rims');
assert.ok(closed(tubeCap.arrays),'the annulus cap closes the upper half');
assert.ok(near(signedVolume(tubeCap.arrays),t.annulusArea,1e-4),'a filled inner hole would add volume; an annulus does not');

// Separation keeps exactly the selected faces, with their attributes, and the rest.
const halves=extractFaces(cube,Uint8Array.from({length:12},(_,f)=>f<4?1:0));
assert.equal(halves.part.indices.length/3,4);assert.equal(halves.rest.indices.length/3,8);
assert.equal(halves.part.positions.length/3,8,'only the render vertices the part uses');
for(let f=0;f<4;f++)for(let i=0;i<3;i++){
  const a=halves.part.indices[3*f+i],b=cube.indices[3*halves.partFaces[f]+i];
  assert.deepEqual([...halves.part.uvs.subarray(2*a,2*a+2)],[...cube.uvs.subarray(2*b,2*b+2)]);
  assert.deepEqual([...halves.part.positions.subarray(3*a,3*a+3)],[...cube.positions.subarray(3*b,3*b+3)]);
}
// Generated junctions do not leave clean loops, so a section cap fills the solid's
// cross-section itself: oriented crossing segments, winding fill, traced outline.
const capArea=cap=>{let a=0;const P=cap.arrays.positions,I=cap.arrays.indices;for(let f=cap.firstFace;f<I.length/3;f++){const [x,y,z]=[0,1,2].map(i=>3*I[3*f+i]);const u=[P[y]-P[x],P[y+1]-P[x+1],P[y+2]-P[x+2]],v=[P[z]-P[x],P[z+1]-P[x+1],P[z+2]-P[x+2]];a+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;}return a;};
const capNormal=cap=>{const P=cap.arrays.positions,I=cap.arrays.indices,f=cap.firstFace,[x,y,z]=[0,1,2].map(i=>3*I[3*f+i]);const u=[P[y]-P[x],P[y+1]-P[x+1],P[y+2]-P[x+2]],v=[P[z]-P[x],P[z+1]-P[x+1],P[z+2]-P[x+2]];return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];};
const zPlane={point:[0,0,.25],normal:[0,0,1]};
const {part:top}=extractFaces(cut.arrays,sides(cut,1));
const section=sectionCap(top,cube,all(cube),zPlane,{side:1});
assert.ok(section.capFaces>=2);
assert.ok(near(capArea(section),4,.06),`the cube's 2 x 2 cross-section is filled (got ${capArea(section)})`);
assert.ok(capNormal(section)[2]<0,'the upper part\'s cap faces down, out of it');
for(let f=section.firstFace;f<section.arrays.indices.length/3;f++)for(let i=0;i<3;i++)assert.ok(near(section.arrays.positions[3*section.arrays.indices[3*f+i]+2],.25,1e-6),'cap vertices lie in the cut plane');
assert.equal(section.arrays.faceMaterial[section.firstFace],1);
const below=sectionCap(extractFaces(cut.arrays,sides(cut,-1)).part,cube,all(cube),zPlane,{side:-1});
assert.ok(capNormal(below)[2]>0,'the lower part\'s cap faces up');
const tubeSection=sectionCap(upper,t,all(t),{point:[0,0,1],normal:[0,0,1]},{side:1});
assert.ok(near(capArea(tubeSection),t.annulusArea,t.annulusArea*.03),`the tube's annulus keeps its hole (got ${capArea(tubeSection)} of ${t.annulusArea})`);
// An interior membrane crossing the plane, as generated meshes carry, does not punch the cap.
const membrane={positions:Float32Array.of(...cube.positions,-.5,-.2,0,.5,-.2,0,0,-.2,1),normals:null,uvs:null,indices:Uint32Array.of(...cube.indices,24,25,26)};
const membraneSection=sectionCap(top,membrane,all(membrane),zPlane,{side:1});
assert.ok(near(capArea(membraneSection),4,.06),`a stray sheet inside the solid leaves the cross-section whole (got ${capArea(membraneSection)})`);

// Generated posts are hollow double walls, so a faithful section is a thin ring. An
// ordinary solid cap fills each outermost closed loop of the section instead.
const solidTube=sectionCap(upper,t,all(t),{point:[0,0,1],normal:[0,0,1]},{side:1,fill:'outline'});
const outerArea=16/2*Math.sin(2*Math.PI/16);
assert.ok(near(capArea(solidTube),outerArea,outerArea*.01),`outline fill closes the bore too (got ${capArea(solidTube)} of ${outerArea})`);
assert.equal(solidTube.regions,1,'one outermost loop');
assert.ok(capNormal(solidTube)[2]<0);
const solidMembrane=sectionCap(top,membrane,all(membrane),zPlane,{side:1,fill:'outline'});
assert.ok(near(capArea(solidMembrane),4,.01),`an open interior sheet is not a loop and is ignored (got ${capArea(solidMembrane)})`);
assert.equal(solidMembrane.openChains,1);
// A loop with a missing face is reported rather than guessed closed.
const gapped=seamCube();const gapIndices=Uint32Array.from([...gapped.indices].filter((_,i)=>Math.floor(i/3)!==0));
const gappedArrays={...gapped,indices:gapIndices},gapCap=sectionCap(top,gappedArrays,all(gappedArrays),zPlane,{side:1,fill:'outline'});
assert.equal(gapCap.capFaces,0,'no closed loop, no invented cap');
assert.ok(gapCap.openChains>=1);
assert.throws(()=>sectionCap(top,cube,all(cube),zPlane,{side:1,fill:'nonsense'}),/fill/);

assert.throws(()=>bisectFaces(cube,all(cube),{point:[0,0,0],normal:[0,0,0]}),/normal/);
assert.throws(()=>extractFaces(cube,new Uint8Array(3)),/one entry per face/);
