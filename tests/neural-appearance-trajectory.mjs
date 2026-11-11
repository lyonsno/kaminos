// kaminos-test: node
import assert from 'node:assert/strict';
import {readAppearanceTrajectory,loadResponseSlice,responseDisplayPixels} from '../neural-appearance-trajectory.mjs';
const source={url:'/api/read?root=image-inbox&path=fit%2Fstep0.model',sha256:'a'.repeat(64)},field={url:'/api/read?root=image-inbox&path=fit%2Fresponse.f32',sha256:'b'.repeat(64)};
const raw={schema:'kaminos.neural-appearance.trajectory.v1',status:'complete',width:2,height:2,response:'projected-bsdf',views:[{id:'front',label:'Normal view',view:[0,0,1],light:[0,0,1],reference:field}],checkpoints:[{step:0,heldoutLogL1:.1,source,slices:{front:field}},{step:250,heldoutLogL1:.02,source,slices:{front:field}}],fit:{job:'fixture',kind:'synthetic-unit-test'}};
assert.equal(readAppearanceTrajectory(raw).checkpoints.length,2);
const pending=structuredClone(raw);pending.status='checkpoints-only';for(const c of pending.checkpoints)delete c.slices;for(const v of pending.views)delete v.reference;assert.equal(readAppearanceTrajectory(pending).status,'checkpoints-only');
for(const mutate of [x=>x.status='running',x=>x.views=[],x=>x.checkpoints=[],x=>x.checkpoints[1].step=0,x=>delete x.checkpoints[1].slices.front,x=>x.checkpoints[0].heldoutLogL1=NaN]){const x=structuredClone(raw);mutate(x);assert.throws(()=>readAppearanceTrajectory(x));}
const values=new Float32Array(12).fill(.25),bytes=new Uint8Array(values.buffer),hash=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex'),entry={...field,sha256:await hash(bytes)};
const loaded=await loadResponseSlice(entry,2,2,{fetcher:async()=>new Response(bytes)});assert.deepEqual(loaded,values);
await assert.rejects(loadResponseSlice({...entry,sha256:'0'.repeat(64)},2,2,{fetcher:async()=>new Response(bytes)}),/digest/);
await assert.rejects(loadResponseSlice(entry,2,2,{fetcher:async()=>new Response(new Float32Array(3))}),/byte/);
const nonfinite=new Float32Array(12).fill(NaN),invalid={...entry,sha256:await hash(nonfinite)};
await assert.rejects(loadResponseSlice(invalid,2,2,{fetcher:async()=>new Response(nonfinite)}),/finite/);
const pixels=responseDisplayPixels(new Float32Array([0,.25,1]),1);assert.deepEqual([...pixels.slice(0,1)],[0]);assert(pixels[1]>0&&pixels[2]>pixels[1]);assert.equal(pixels[3],255);
console.log('Checkpoint trajectory completeness, exact retained slice integrity and display mapping passed');
