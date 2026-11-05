// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boxContactShape,materialContactShape,contactShapeFeatures,contactShapeSeparation} from '../fracture-contact-shape.mjs';

test('complete polygon determines its normal when its first three points are collinear',()=>{
 // Same failure as the clipped original arm joint at grid2, piece11, leaf5:
 // the first three boundary vertices are collinear on a valid support face.
 const box=boxContactShape([1,1,1]);
 const vertices=Float32Array.from([...box.vertices,-1,-1,0]);
 const shape={...box,vertices,faces:[[0,8,4,6,2],...box.faces.slice(1)]};
 assert.deepEqual(contactShapeFeatures(shape).normals[0],[-1,0,0]);
 assert.equal(contactShapeSeparation(shape,[0,0,0],box,[3,0,0]).separation,1);
 const degenerate={vertices:Float32Array.from([0,0,0,1,0,0,2,0,0]),faces:[[0,1,2]]};
 assert.throws(()=>contactShapeFeatures(degenerate),/Degenerate collision face/);
});

test('source hull deduplication uses the same coordinate precision as GPU support vertices',()=>{
 // Float64 points can differ yet become the same Float32 GPU support point.
 // Preserve all quantized support positions without duplicate vertices/edges.
 const positions=Float64Array.from([...boxContactShape([1,1,1]).vertices,1,1+1e-10,1,1,1,1+1e-10]);
 const shape=materialContactShape({positions,indices:Uint32Array.from({length:10},(_,i)=>i)},[0,0,0],[1,1,1]);
 const points=[];for(let i=0;i<shape.vertices.length;i+=3)points.push(Array.from(shape.vertices.subarray(i,i+3)).join(','));
 assert.equal(new Set(points).size,points.length,'distinct hull IDs must not collapse to one GPU point');
 assert.equal(points.length,8);
 for(const e of contactShapeFeatures(shape).edges)assert.notEqual(points[e[0]],points[e[1]]);
});
