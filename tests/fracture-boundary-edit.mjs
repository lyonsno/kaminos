// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as shape from '../fracture-shape-partition.mjs';
function strip(){
 const positions=[],indices=[];
 for(let x=0;x<=12;x++)positions.push(x,0,0,x,1,0);
 for(let x=0;x<12;x++){const i=x*2;indices.push(i,i+2,i+1,i+1,i+2,i+3);}
 return shape.buildShapeGraph({positions,indices});
}
test('a local cut moves both ways from a stable baseline, protecting adjacent pieces',()=>{
 assert.equal(typeof shape.moveShapeBoundary,'function','local boundary placement must be an operation, not another proposal filter');
 const graph=strip(),faces=Array.from({length:8},(_,i)=>i+16),allowed=Array.from({length:22},(_,i)=>i+2);
 const anchor={faces,allowedFaces:allowed,protectedFaces:[22,23]};
 const grow=shape.moveShapeBoundary(graph,anchor,.15),shrink=shape.moveShapeBoundary(graph,anchor,-.1);
 assert.ok(grow.faces.length>faces.length);assert.ok(shrink.faces.length<faces.length);
 assert.ok(!grow.faces.includes(0)&&!grow.faces.includes(1));
 assert.ok(shrink.faces.includes(22)&&shrink.faces.includes(23));
 assert.deepEqual(shape.moveShapeBoundary(graph,anchor,0).faces,faces);
 assert.deepEqual(shape.moveShapeBoundary(graph,anchor,.15).faces,grow.faces,'history cannot change an absolute cut position');
 assert.throws(()=>shape.moveShapeBoundary(graph,anchor,NaN),/finite/i);
});
test('fixed attachment cuts survive detection thresholds with all source faces accounted for',()=>{
 const graph=strip(),faces=Array.from({length:8},(_,i)=>i+16),key='operator-fitting';
 const r=shape.geodesicNeckPartition(graph,{minReachFraction:1,minAreaFraction:1,cleanupAreaFraction:1,fixedCuts:[{key,faces}]});
 assert.ok(r.hierarchy.nodes.some(n=>n.key===key),'an edited attachment must survive global eligibility changes');
 const branch=r.hierarchy.nodes.find(n=>n.key===key);
 for(const f of faces){let n=r.hierarchy.faceOwners[f];while(n!==null&&n!==branch.id)n=r.hierarchy.nodes[n].parent;assert.equal(n,branch.id);}
 assert.equal(r.parts.reduce((s,p)=>s+p.triangles,0),graph.triangles.length);
 assert.throws(()=>shape.geodesicNeckPartition(graph,{fixedCuts:[{key:'bad',faces:[999]}]}),/face/i);
});
test('candidate catalog carries exact source membership and stable branch identity',()=>{
 const graph=strip(),fixedCuts=[{key:'chosen',faces:[20,21,22,23]}];
 const r=shape.geodesicNeckPartition(graph,{fixedCuts});
 const c=r.candidateBranches.find(c=>c.key==='chosen');
 assert.ok(c?.faces,'candidate boundaries must be displayable from source faces');assert.deepEqual(Array.from(c.faces),fixedCuts[0].faces);
 assert.equal(r.hierarchy.nodes.find(n=>n.key==='chosen').kind,'branch');
});
