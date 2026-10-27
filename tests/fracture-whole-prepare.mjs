// kaminos-test: node
import assert from 'node:assert/strict';
import {BoxGeometry} from '../lib/three.core.js';
import {prepareCoarseFracture} from '../fracture-coarse-prepare.mjs';
const g=new BoxGeometry(2,2,2),source={positions:g.attributes.position.array,indices:Uint32Array.from(g.index.array),normals:g.attributes.normal.array,uvs:g.attributes.uv.array,faceMaterial:new Uint8Array(12)};
const faces=Array.from({length:12},(_,i)=>i);
const result=prepareCoarseFracture(source,faces,{cellExtent:1});
assert.ok(result.pieces.length>=8,'Whole material must subdivide in all three dimensions, rather than prepare one two-body specimen');
assert.ok(result.bonds.length>=12,'Neighboring subdivisions must transmit forces across every shared interface');
assert.equal(result.receipt.exteriorAreaBefore,result.receipt.exteriorAreaAfter,'The whole original exterior survives partitioning');
assert.ok(result.pieces.every(p=>p.faceInterfaces.length===p.arrays.indices.length/3));
assert.ok(result.bonds.every(b=>b.area>0&&b.a!==b.b));
console.log('whole material has spatial cells, complete interfaces and preserved exterior');
const {bisectFaces}=await import('../poly-mesh-edit.mjs'),{buildPolyMesh}=await import('../poly-mesh-core.mjs'),{prepareWholeFracture}=await import('../fracture-whole-prepare.mjs');
const cut=bisectFaces(source,new Uint8Array(12).fill(1),{point:[0,0,0],normal:[1,0,0]}),topology=buildPolyMesh(cut.arrays),labels=Uint32Array.from(cut.side,x=>Number(x>0)),boundaries=[];
for(let e=0;e<topology.edgeCount;e++){const corners=Array.from(topology.edgeCorners.subarray(topology.edgeFaceOffsets[e],topology.edgeFaceOffsets[e+1]));if(corners.length===2&&labels[corners[0]/3|0]!==labels[corners[1]/3|0])boundaries.push({parts:corners.map(c=>labels[c/3|0]),points:Array.from(topology.edgeVertices.subarray(e*2,e*2+2),v=>Array.from(topology.vertexPositions.subarray(v*3,v*3+3)))});}
const whole=prepareWholeFracture(cut.arrays,{labels,boundaries},{cellExtent:1});
assert.equal(whole.receipt.sourceParts,2);assert.equal(whole.cells.length,8);assert.ok(whole.bonds.some(b=>b.kind==='attachment'));assert.ok(whole.bonds.some(b=>b.kind==='internal'));assert.equal(whole.receipt.diagnostics.inferredAttachments.length,0,'A closed shared boundary does not need fabricated gap bonds');
assert.equal(whole.receipt.diagnostics.uncappedAttachments.length,0,'Closed attachment has interiors on both sides');
for(const p of whole.pieces)for(let f=0;f<p.faceInterfaces.length;f++)if(p.faceInterfaces[f])assert.ok(p.faceBonds[f]>=0,'Every interior triangle belongs to its actual local connection');
assert.ok(Math.abs(whole.receipt.exteriorAreaAfter-whole.receipt.exteriorAreaBefore)<1e-6);
const inverted={...source,indices:Uint32Array.from(source.indices)};for(let i=0;i<inverted.indices.length;i+=3)[inverted.indices[i+1],inverted.indices[i+2]]=[inverted.indices[i+2],inverted.indices[i+1]];
const reverse=prepareWholeFracture(inverted,{labels:new Uint32Array(12),boundaries:[]},{cellExtent:1});
assert.equal(reverse.cells.length,8,'Source winding must not disable coarse material subdivision');
for(const a of [source,inverted]){
 const first=prepareWholeFracture(a,{labels:new Uint32Array(12),boundaries:[]},{cellExtent:1});
 const moved={...a,positions:Float32Array.from(a.positions,v=>v+10)},second=prepareWholeFracture(moved,{labels:new Uint32Array(12),boundaries:[]},{cellExtent:1});
 assert.equal(second.cells.length,first.cells.length);
 for(let i=0;i<first.cells.length;i++)assert.ok(Math.abs(first.cells[i].volume-second.cells[i].volume)<1e-6,'Material mass cannot depend on source coordinate offset, including reversed source winding');
}
for(const b of whole.bonds){assert.ok(b.linearStiffness>0&&b.rotationalStiffness>0,'Each material interface needs area-scaled linear and bending stiffness');const a=whole.cells[b.a],c=whole.cells[b.b],length=Math.hypot(...a.position.map((v,k)=>v-c.position[k]));assert.ok(Math.abs(b.linearStiffness-whole.config.elasticModulus*b.area/length)<1e-4);}

for(const entry of whole.receipt.diagnostics.sectionCoverage){assert.ok(Math.abs(entry.positiveArea-entry.negativeArea)<1e-6,'Both sides must inherit one shared material section');assert.ok(Math.abs(entry.sharedArea-entry.positiveArea)<1e-6,'Cell matching must account for that shared section');}
