// kaminos-test: node
import assert from 'node:assert/strict';
import {
  EDGE_BOUNDARY,EDGE_NONMANIFOLD,EDGE_SHARP,EDGE_UV_SEAM,EDGE_NORMAL_SEAM,EDGE_FLIPPED,
  buildPolyMesh,classifyEdges,faceComponents,selectLinkedFaces,growFaceSelection,shrinkFaceSelection,polyMeshCensus,
} from '../poly-mesh-core.mjs';

// Each cube side owns four render vertices, its own normal and its own atlas cell,
// as an exporter splits a UV-atlased mesh along charts.
function seamCube(){
  const sides=[[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[0,0,1],[1,0,0]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[0,1,0],[1,0,0]]];
  const positions=[],normals=[],uvs=[],indices=[];
  sides.forEach(([n,u,v],k)=>{
    for(const [s,t] of [[0,0],[1,0],[1,1],[0,1]]){
      positions.push(...[0,1,2].map(i=>n[i]+(2*s-1)*u[i]+(2*t-1)*v[i]));normals.push(...n);uvs.push((k+s)/6,t);
    }
    indices.push(4*k,4*k+1,4*k+2,4*k,4*k+2,4*k+3);
  });
  return {positions:Float32Array.from(positions),normals:Float32Array.from(normals),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices)};
}
function grid(n){
  const positions=[],indices=[];
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)positions.push(x,y,0);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=x+(n+1)*y,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,c,b,d,c);}
  return {positions:Float32Array.from(positions),indices:Uint32Array.from(indices)};
}
const faces=mask=>[...mask.keys()].filter(f=>mask[f]);
const edgeBetween=(mesh,a,b)=>{
  const [x,y]=[mesh.renderVertexToVertex[a],mesh.renderVertexToVertex[b]].sort((p,q)=>p-q);
  for(let e=0;e<mesh.edgeCount;e++)if(mesh.edgeVertices[2*e]===x&&mesh.edgeVertices[2*e+1]===y)return e;
  return -1;
};

// Welding recovers topology the render index splits along charts.
const cube=seamCube(),mesh=buildPolyMesh(cube);
assert.equal(mesh.renderVertexCount,24);
assert.equal(mesh.faceCount,12);
assert.equal(mesh.vertexCount,8,'seam-split copies at identical positions weld into one vertex');
assert.equal(mesh.edgeCount,18,'twelve cube edges plus six side diagonals');
for(let f=0;f<12;f++)for(let i=0;i<3;i++)assert.equal(mesh.cornerRenderVertex[3*f+i],cube.indices[3*f+i],'corners keep their source render vertex, so attributes survive');
const cubeFlags=classifyEdges(mesh,{sharpAngle:30});
let sharp=0,uvSeams=0,normalSeams=0;
for(let e=0;e<mesh.edgeCount;e++){
  assert.equal(cubeFlags[e]&(EDGE_BOUNDARY|EDGE_NONMANIFOLD|EDGE_FLIPPED),0,'a closed consistently wound cube has only manifold edges');
  const isSharp=!!(cubeFlags[e]&EDGE_SHARP);sharp+=isSharp;
  assert.equal(!!(cubeFlags[e]&EDGE_UV_SEAM),isSharp,'on this cube exactly the creases separate atlas cells');
  assert.equal(!!(cubeFlags[e]&EDGE_NORMAL_SEAM),isSharp,'and exactly the creases split normals');
  uvSeams+=!!(cubeFlags[e]&EDGE_UV_SEAM);normalSeams+=!!(cubeFlags[e]&EDGE_NORMAL_SEAM);
}
assert.equal(sharp,12);assert.equal(uvSeams,12);assert.equal(normalSeams,12);
assert.equal(cubeFlags[edgeBetween(mesh,0,2)]&EDGE_SHARP,0,'a coplanar side diagonal is not a crease');

const census=polyMeshCensus(mesh,{sharpAngle:30});
assert.deepEqual({
  renderVertices:census.renderVertices,faces:census.faces,vertices:census.vertices,edges:census.edges,boundaryEdges:census.boundaryEdges,
  manifoldEdges:census.manifoldEdges,nonManifoldEdges:census.nonManifoldEdges,components:census.components,
  vertexConnectedComponents:census.vertexConnectedComponents,renderIndexComponents:census.renderIndexComponents,
  sharpEdges:census.sharpEdges,uvSeamEdges:census.uvSeamEdges,normalSeamEdges:census.normalSeamEdges,flippedEdges:census.flippedEdges,degenerateFaces:census.degenerateFaces,
},{renderVertices:24,faces:12,vertices:8,edges:18,boundaryEdges:0,manifoldEdges:18,nonManifoldEdges:0,components:1,vertexConnectedComponents:1,renderIndexComponents:6,sharpEdges:12,uvSeamEdges:12,normalSeamEdges:12,flippedEdges:0,degenerateFaces:0});
assert.deepEqual(census.edgeFaceHistogram,{2:18});

// Select Linked walks welded topology and stops only where told to delimit.
assert.equal(faces(selectLinkedFaces(mesh,[0])).length,12,'one welded component, even though the render index has six');
assert.deepEqual(faces(selectLinkedFaces(mesh,[0],{delimit:EDGE_SHARP,flags:cubeFlags})),[0,1],'delimit by crease selects one cube side');
assert.deepEqual(faces(selectLinkedFaces(mesh,[5],{delimit:EDGE_UV_SEAM,flags:cubeFlags})),[4,5],'delimit by UV seam selects one atlas island');
const allCube=new Uint8Array(12).fill(1);
assert.deepEqual(faces(shrinkFaceSelection(mesh,allCube)),faces(allCube),'a closed mesh fully selected has no selection boundary to shrink');

// A fin shares one edge among three faces; the kernel keeps all three incidences.
const fin=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,1,1,0,0,1,0,.5,.5,1),indices:Uint32Array.of(0,1,2,0,2,3,0,2,4)});
const finFlags=classifyEdges(fin);
const finEdge=edgeBetween(fin,0,2);
assert.ok(finEdge>=0);
assert.equal(finFlags[finEdge],EDGE_NONMANIFOLD,'three faces on one edge is non-manifold, neither sharp nor seam');
assert.equal(fin.edgeFaceOffsets[finEdge+1]-fin.edgeFaceOffsets[finEdge],3);
assert.deepEqual(polyMeshCensus(fin).edgeFaceHistogram,{1:6,3:1});
assert.equal(faceComponents(fin).count,1);
assert.equal(faceComponents(fin,{delimit:EDGE_NONMANIFOLD,flags:finFlags}).count,3,'delimiting non-manifold edges isolates each fan face here');

// Inconsistent winding is reported as such and does not masquerade as a crease.
const flip=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,0,1,0,1,1,0),indices:Uint32Array.of(0,1,2,1,2,3)});
const flipFlags=classifyEdges(flip,{sharpAngle:30});
assert.equal(flipFlags[edgeBetween(flip,1,2)],EDGE_FLIPPED,'coplanar faces wound against each other are flipped, not sharp');
const fixed=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,0,1,0,1,1,0),indices:Uint32Array.of(0,1,2,2,1,3)});
assert.equal(classifyEdges(fixed)[edgeBetween(fixed,1,2)],0);

// Grow and shrink follow Blender's Select More/Less: face step joins faces sharing a vertex.
const g=buildPolyMesh(grid(3));
const center=new Uint8Array(g.faceCount);center[8]=center[9]=1;
const edgeGrown=growFaceSelection(g,center,{faceStep:false});
assert.deepEqual(faces(edgeGrown),[3,7,8,9,10,14],'the four triangles across the center quad edges');
assert.deepEqual(faces(shrinkFaceSelection(g,edgeGrown,{faceStep:false})),[8,9]);
const vertexGrown=growFaceSelection(g,center);
for(const f of faces(edgeGrown))assert.equal(vertexGrown[f],1);
assert.equal(vertexGrown[1],1,'a face touching the selection only at a corner joins under face step');
assert.deepEqual(faces(vertexGrown),[...Array(18).keys()].filter(f=>f!==0&&f!==17),'every triangle touching the center quad corners');
assert.equal(center[3],0,'selection operations return new masks');

// Degenerate input stays countable instead of corrupting adjacency.
const sliver=buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,0,0,0,0,1,0),indices:Uint32Array.of(0,1,2,0,1,3)});
assert.equal(sliver.vertexCount,3);
assert.equal(polyMeshCensus(sliver).degenerateFaces,1);
assert.equal(sliver.edgeCount,3,'the collapsed corner pair contributes no zero-length edge');
assert.throws(()=>buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,0,0,1,0),indices:Uint32Array.of(0,1,3)}),/index/);
assert.throws(()=>buildPolyMesh({positions:Float32Array.of(0,0,0,1,0,NaN,0,1,0),indices:Uint32Array.of(0,1,2)}),/finite/);
assert.equal(buildPolyMesh({positions:Float32Array.of(0,0,0,-0,1,0,0,0,0,1,0,0),indices:Uint32Array.of(0,1,3,2,1,3)}).vertexCount,3,'signed zero welds');
