// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildShapeGraph, partitionShape, geodesicNeckPartition} from '../fracture-shape-partition.mjs';

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
