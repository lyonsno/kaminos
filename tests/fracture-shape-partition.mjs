// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildShapeGraph, partitionShape, geodesicNeckPartition, shapeHierarchyView, buildBranchHierarchy} from '../fracture-shape-partition.mjs';

// Closed surface of revolution: a thick body, concave shoulder, narrow stalk.
function specimen(radii, segments=12) {
 const positions=[],indices=[];
 radii.forEach(([y,r])=>{for(let j=0;j<segments;j++){const a=j*2*Math.PI/segments;positions.push(r*Math.cos(a),y,r*Math.sin(a));}});
 for(let k=0;k<radii.length-1;k++)for(let j=0;j<segments;j++){
  const a=k*segments+j,b=k*segments+(j+1)%segments,c=a+segments,d=b+segments;
  indices.push(a,c,b,b,c,d);
 }
 const bottom=positions.length/3;positions.push(0,radii[0][0],0);
 const top=positions.length/3;positions.push(0,radii.at(-1)[0],0);
 for(let j=0;j<segments;j++){indices.push(bottom,j,(j+1)%segments);const a=(radii.length-1)*segments+j,b=(radii.length-1)*segments+(j+1)%segments;indices.push(top,b,a);}
 return {positions,indices};
}

test('a convex cylinder stays together while a concave shoulder separates a stalk',()=>{
 const convex=specimen([[0,1],[1,1]]),convexGraph=buildShapeGraph(convex);
 assert.equal(partitionShape(convexGraph,{concavityDegrees:20,minAreaFraction:0}).parts.length,1);
 const shape=specimen([[0,1],[1,1],[1,.2],[2,.2]]),graph=buildShapeGraph(shape);
 const result=partitionShape(graph,{concavityDegrees:20,minAreaFraction:0});
 assert.equal(result.triangleCount,shape.indices.length/3);
 assert.equal(result.parts.length,2);
 assert.ok(result.boundaries.length>0);
 const stalk=2*12*2,body=0;
 assert.notEqual(result.labels[stalk],result.labels[body]);
 assert.equal(result.parts.reduce((sum,p)=>sum+p.triangles,0),result.triangleCount);
 assert.ok(result.attachments.length>0);
});

test('attribute-seam duplicates do not become false disconnected parts',()=>{
 const input=specimen([[0,1],[1,1]]),positions=input.indices.flatMap(i=>input.positions.slice(i*3,i*3+3));
 const result=partitionShape(buildShapeGraph({positions,indices:positions.map((_,i)=>i).filter(i=>i<positions.length/3)}),{concavityDegrees:20,minAreaFraction:0});
 assert.equal(result.parts.length,1);
 assert.equal(result.sourceComponents,1);
});

test('disconnected shells remain distinct and small-area cleanup drops no triangles',()=>{
 const a=specimen([[0,1],[1,1]]),b=specimen([[0,.1],[1,.1]]),n=a.positions.length/3;
 const result=partitionShape(buildShapeGraph({positions:[...a.positions,...b.positions.map((x,i)=>i%3===0?x+4:x)],indices:[...a.indices,...b.indices.map(i=>i+n)]}),{concavityDegrees:20,minAreaFraction:.1});
 assert.equal(result.parts.length,2);assert.equal(result.sourceComponents,2);
 assert.equal(result.parts.reduce((s,p)=>s+p.triangles,0),(a.indices.length+b.indices.length)/3);
 assert.equal(result.attachments.length,0);
});

test('invalid input fails visibly; zero-area source triangles remain accounted for',()=>{
 assert.throws(()=>buildShapeGraph({positions:[0,0,0],indices:[0,1,2]}),/indices/);
 const input=specimen([[0,1],[1,1]]);input.indices.push(0,0,1);
 const graph=buildShapeGraph(input),result=partitionShape(graph,{concavityDegrees:20,minAreaFraction:.001});
 assert.equal(result.triangleCount,input.indices.length/3);assert.equal(graph.diagnostics.degenerateTriangles,1);
 assert.throws(()=>partitionShape(graph,{concavityDegrees:NaN,minAreaFraction:0}),/concavity/);
});

 test('coincident duplicate faces do not fragment the connectivity analysis',()=>{
 const input=specimen([[0,1],[1,1]]);input.indices.push(...input.indices.slice());
 const graph=buildShapeGraph(input),result=partitionShape(graph,{concavityDegrees:20,minAreaFraction:0});
 assert.equal(result.sourceComponents,1);assert.equal(result.parts.length,1);assert.equal(result.triangleCount,input.indices.length/3);
 assert.equal(graph.diagnostics.duplicateTriangles,input.indices.length/6);
 });

test('geodesic neck proposals keep all source faces and retain thin-branch geometry',()=>{
 const shape=specimen([[0,1],[1,1],[1,.2],[3,.2]],24),graph=buildShapeGraph(shape);
 const result=geodesicNeckPartition(graph,{minReachFraction:.02,maxCutRatio:6,minAreaFraction:0});
 assert.equal(result.parts.reduce((s,p)=>s+p.triangles,0),shape.indices.length/3);
 assert.ok(result.parts.length>1);assert.ok(result.attachments.length>0);
 assert.notEqual(result.labels[0],result.labels[2*24*2]);
 assert.throws(()=>geodesicNeckPartition(graph,{minReachFraction:NaN}),/Finite/);
});

test('branch size and concavity cleanup are independent settings',()=>{
 const graph=buildShapeGraph(specimen([[0,1],[1,1],[1,.2],[3,.2]],24));
 const a=geodesicNeckPartition(graph,{minReachFraction:.001,minAreaFraction:.00001,cleanupAreaFraction:0});
 const b=geodesicNeckPartition(graph,{minReachFraction:.001,minAreaFraction:.00001,cleanupAreaFraction:.9});
 assert.equal(a.settings.cleanupAreaFraction,0);
 assert.equal(b.settings.cleanupAreaFraction,.9);
 assert.deepEqual(a.candidateBranches,b.candidateBranches);
 assert.ok(a.parts.length>b.parts.length,'cleanup changes surface-patch refinement independently of branch eligibility');
});

test('hierarchy retains full face ownership and parent membership at every detail level',()=>{
 const graph=buildShapeGraph(specimen([[0,1],[1,1],[1,.3],[2,.3],[2,.15],[3,.15]],24));
 const result=geodesicNeckPartition(graph,{minReachFraction:.001,minAreaFraction:0,cleanupAreaFraction:0});
 assert.ok(result.hierarchy,'nested ownership must survive partition output');
 const {nodes,faceOwners,maxDepth}=result.hierarchy;
 assert.equal(faceOwners.length,result.triangleCount);
 assert.ok(maxDepth>0);
 for(const owner of faceOwners){assert.ok(nodes[owner]);let id=owner;const visited=new Set();while(id!==null){assert.ok(!visited.has(id));visited.add(id);id=nodes[id].parent;}}
 assert.equal(nodes.filter(n=>n.parent===null).reduce((sum,n)=>sum+n.triangles,0),result.triangleCount);
});

test('nested branch proposals retain their actual merge-tree parent',()=>{
 const graph=buildShapeGraph({positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});
 const h=buildBranchHierarchy(graph,{children:[[0,1],[4,2],[5,3]],roots:[6],candidates:[{node:5,reach:2,cutRatio:1},{node:4,reach:1,cutRatio:.5}],patchLabels:new Uint32Array(4)});
 assert.equal(h.nodes.length,3);assert.deepEqual(h.nodes.map(n=>n.parent),[null,0,1]);
 assert.deepEqual(Array.from(h.faceOwners),[2,2,1,0]);
 assert.deepEqual(h.nodes.map(n=>n.triangles),[4,3,2]);
});

test('detail views are nested refinements and never lose source triangles',()=>{
 const graph=buildShapeGraph(specimen([[0,1],[1,1],[1,.3],[2,.3],[2,.15],[3,.15]],24));
 const result=geodesicNeckPartition(graph,{minReachFraction:.001,minAreaFraction:0,cleanupAreaFraction:0});
 let previous=shapeHierarchyView(result,0);assert.equal(previous.parts.length,result.sourceComponents);
 for(let level=1;level<=result.hierarchy.maxDepth;level++){
  const next=shapeHierarchyView(result,level),parents=new Map();
  assert.equal(next.parts.reduce((s,p)=>s+p.triangles,0),result.triangleCount);
  for(let i=0;i<next.labels.length;i++){const id=next.labels[i];if(parents.has(id))assert.equal(parents.get(id),previous.labels[i]);else parents.set(id,previous.labels[i]);}
  previous=next;
 }
 assert.equal(previous.parts.length,result.parts.length);
 assert.throws(()=>shapeHierarchyView(result,-1),/detail level/);
});

test('threshold changes reuse source analysis and consider different starting points',()=>{
 const graph=buildShapeGraph(specimen([[0,1],[1,1],[1,.2],[3,.2]],24));
 const first=geodesicNeckPartition(graph,{minReachFraction:.001,minAreaFraction:0});
 const next=geodesicNeckPartition(graph,{minReachFraction:.02,minAreaFraction:.0001});
 assert.equal(first.analysis?.builds,1,'source traversal must have an explicit preparation receipt');
 assert.equal(next.analysis.builds,1,'changing thresholds must not rebuild geodesics');
 assert.equal(next.analysis.cacheHit,true);
 assert.equal(first.analysis.seedPolicy,'centroid-and-six-axis-extrema');
 assert.equal(first.analysis.passes,7);
 assert.ok(first.analysis.distinctSeeds>1,'alternative origins must actually differ');
 assert.equal(next.parts.reduce((s,p)=>s+p.triangles,0),graph.triangles.length);
});

test('local detail changes only the selected subtree and can keep its children together',()=>{
 const graph=buildShapeGraph({positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});
 const hierarchy=buildBranchHierarchy(graph,{children:[[0,1],[4,2],[5,3]],roots:[6],candidates:[{node:5,reach:2,cutRatio:1},{node:4,reach:1,cutRatio:.5}],patchLabels:new Uint32Array(4)});
 const result={hierarchy,labels:Uint32Array.from([0,0,1,2]),parts:[{id:0,nodeId:2,triangles:2,area:2,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}},{id:1,nodeId:1,triangles:1,area:1,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}},{id:2,nodeId:0,triangles:1,area:1,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}}],boundaries:[]};
 const before=shapeHierarchyView(result,1),local=shapeHierarchyView(result,1,{1:2});
 const owners=v=>Array.from(v.labels,id=>v.parts[id].nodeId);
 assert.deepEqual(owners(before),[1,1,1,0]);
 assert.deepEqual(owners(local),[2,2,1,0],'local refinement must expose the nested fitting without changing the rest');
 assert.deepEqual(owners(shapeHierarchyView(result,2,{1:1})),[1,1,1,0]);
 assert.throws(()=>shapeHierarchyView(result,1,{999:1}),/local detail/);
});

test('nearby cuts around one fitting remain alternatives rather than sliver subparts',async()=>{
 const {chooseNeckFamily}=await import('../fracture-shape-partition.mjs');
 assert.equal(typeof chooseNeckFamily,'function','attachment variants need distinct disposition from subparts');
 const proposal=faces=>({faces:Uint32Array.from(faces),seeds:new Set([0]),area:faces.length,reach:1,cutRatio:1});
 const outer=proposal(Array.from({length:12},(_,i)=>i)),near=proposal(Array.from({length:11},(_,i)=>i)),child=proposal([0,1,2]),cross=proposal([2,3,4,12]);
 const selected=chooseNeckFamily([outer,near,child,cross],new Float64Array(13).fill(1));
 assert.deepEqual(selected,[outer,child]);
 assert.equal(outer.status,'included');assert.equal(near.status,'boundary-variant');
 assert.equal(cross.status,'crossing-alternative');assert.equal(child.status,'included');
 assert.equal(near.variantOf,0);
 // Face count alone must not hide a child with a materially different surface area.
 const weighted=new Float64Array(13).fill(1);weighted[11]=20;
 assert.equal(chooseNeckFamily([proposal([...outer.faces]),proposal([...near.faces])],weighted).length,2);
});
