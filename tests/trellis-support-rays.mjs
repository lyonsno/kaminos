// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {supportFrame,sampleSourceAddress} from '../trellis-local-support.mjs';import {traceSupportRays} from '../trellis-support-rays.mjs';import {withKaminosGpu} from '../tools/shader-herder.mjs';
const teacher=()=>({frame:supportFrame({normal:[0,0,1],tangent:[1,0,0],radius:1,depth:.5}),lo:[-1,-1,-.5],hi:[1,1,.5],patch:[{sourceTriangle:37,vertices:[[-.5,-.5,0],[.5,-.5,0],[0,.5,0]].map((p,i)=>({p,b:[0,1,2].map(k=>+(k===i))}))}]});
test('native ray teacher returns original triangle and barycentrics between support entry and exit',async()=>{
 await withKaminosGpu(async({device})=>{const r=await traceSupportRays(device,teacher(),[{origin:[0,0,1],direction:[0,0,-1]},{origin:[.9,.9,1],direction:[0,0,-1]},{origin:[0,0,.25],direction:[1,0,0]},{origin:[0,0,-1],direction:[0,0,1]}]);
  const hit=r.samples[0];assert.equal(hit.hit,true);assert.equal(hit.sourceTriangle,37);assert.ok(Math.abs(hit.distance-1)<1e-6);assert.deepEqual(hit.sourceBary,[.25,.25,.5]);assert.equal(hit.entry,.5);assert.equal(hit.exit,1.5);
  assert.equal(hit.frontFacing,true);assert.equal(r.samples[3].frontFacing,false);
  assert.equal(r.samples[1].hit,false);assert.equal(r.samples[1].exit,1.5);assert.equal(r.samples[2].hit,false);assert.equal(r.samples[2].exit,1);
  assert.equal(r.samples[3].hit,true,'the double-sided TRELLIS teacher must retain back-facing sheets');assert.equal(r.samples[3].sourceTriangle,37);
  const oneSided=await traceSupportRays(device,teacher(),[{origin:[0,0,-1],direction:[0,0,1]}],{twoSided:false});assert.equal(oneSided.samples[0].hit,false);
  await assert.rejects(traceSupportRays(device,teacher(),[{origin:[0,0,1],direction:[0,0,0]}]),/nonzero/);
 });
});
test('nearest hit, empty-space exit and rotated physical chart retain their meanings',async()=>{
 await withKaminosGpu(async({device})=>{
  const c=teacher();c.patch.push({sourceTriangle:99,vertices:c.patch[0].vertices.map(v=>({...v,p:[v.p[0],v.p[1],.2]}))});
  const r=await traceSupportRays(device,c,[{origin:[0,0,1],direction:[0,0,-1]},{origin:[2,0,1],direction:[0,0,-1]},{origin:[0,0,.2],direction:[0,0,-1]}]);
  assert.equal(r.samples[0].sourceTriangle,99);assert.ok(Math.abs(r.samples[0].distance-.8)<1e-6);assert.equal(r.samples[1].intersectsSupport,false);assert.equal(r.samples[1].exit,null);assert.ok(r.samples[2].distance<1e-6);
  const rotated=teacher();rotated.frame=supportFrame({origin:[1,2,3],normal:[0,1,0],tangent:[0,0,1],radius:.25,depth:.125});
  const q=await traceSupportRays(device,rotated,[{origin:[1,2.25,3],direction:[0,-2,0]}]);assert.equal(q.samples[0].distance,.25);assert.deepEqual(q.samples[0].position,[1,2,3]);
  const outside=teacher();outside.patch=outside.patch.map(t=>({...t,vertices:t.vertices.map(v=>({...v,p:[v.p[0],v.p[1],-2]}))}));const miss=await traceSupportRays(device,outside,[{origin:[0,0,1],direction:[0,0,-1]}]);assert.equal(miss.samples[0].hit,false,'a hit beyond the support exit must remain external');assert.equal(miss.samples[0].exit,1.5);
 });
});
test('source barycentrics sample the original UV island and base normal',()=>{
 const s={positions:Float32Array.from([0,0,0,1,0,0,0,1,0]),indices:Uint32Array.from([0,1,2]),uvs:Float32Array.from([.2,.3,.8,.3,.2,.9]),normals:Float32Array.from([0,0,1,0,0,1,0,0,1])};
 const sample=sampleSourceAddress(s,0,[.25,.25,.5]);assert.deepEqual(sample.sourcePosition,[.25,.5,0]);assert.ok(Math.abs(sample.sourceUV[0]-.35)<1e-6);assert.ok(Math.abs(sample.sourceUV[1]-.6)<1e-6);assert.deepEqual(sample.vertexNormal,[0,0,1]);
 assert.throws(()=>sampleSourceAddress(s,7,[1,0,0]),/valid original/);
});
