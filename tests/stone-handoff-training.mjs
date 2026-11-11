// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createNeumipStudent,neumipTrainingLayout,restoreNeumipParameters} from '../neumip-training.mjs';
const handoff={cheapResolution:64,routing:{width:.7,depth:.7,inner:.08,collar:.04},material:{color:[.4,.35,.3],roughness:.8,metalness:0}};
test('paired student carries independently trainable cheap mip fields and a zero signed residual',()=>{
 const model=createNeumipStudent({resolution:256,seed:41,handoff});
 assert.equal(model.architecture,'kaminos-stone-handoff-residual-v1');
 assert.equal(model.handoff.cheap[0].width,64);
 assert.equal(model.handoff.cheap.at(-1).width,2);
 assert.ok(model.handoff.cheap.every(t=>t.channels===3&&t.data.every(x=>x===0)));
 const head=model.layers.find(l=>l.name==='main.mpl3');assert.ok(head.weights.every(x=>x===0));assert.ok(head.biases.every(x=>x===0));
 const layout=neumipTrainingLayout(model);assert.equal(layout.appearanceLevels,8);assert.equal(layout.cheapStartField,9);
 const values=layout.values.slice();const field=layout.fields[layout.cheapStartField];values[field.offset]=-.25;
 restoreNeumipParameters(model,layout,values);assert.equal(model.handoff.cheap[0].data[0],-.25);
});
test('invalid handoff cannot silently create an ordinary material',()=>{
 assert.throws(()=>createNeumipStudent({resolution:64,handoff:{...handoff,routing:{...handoff.routing,collar:-1}}}),/routing/i);
 assert.throws(()=>createNeumipStudent({resolution:64,handoff:{...handoff,cheapResolution:128}}),/cheap/i);
});
import {handoffWeight,writeStoneHandoffModel,readStoneHandoffModel} from '../stone-handoff-model.mjs';
test('footprint routing is periodic and integrates the whole footprint at coarse levels',()=>{
 const r=handoff.routing;
 assert.equal(handoffWeight([.25,.25],0,256,r),0);
 assert.equal(handoffWeight([0,0],0,256,r),1);
 const expected=1-(1-4*(r.inner+r.collar/2)/r.width)**2;
 for(const uv of [[0,0],[.25,.25],[.98,.03],[-.02,1.03]])assert.ok(Math.abs(handoffWeight(uv,7,256,r)-expected)<1e-12);
 for(const lod of [0,1.5,3,6.2])assert.ok(Math.abs(handoffWeight([.98,.03],lod,256,r)-handoffWeight([-.02,1.03],lod,256,r))<1e-11);
});
test('paired archive round trips both representations and refuses partial or corrupt endpoint data',()=>{
 const model=createNeumipStudent({resolution:64,handoff});model.handoff.cheap[0].data[0]=-.25;
 const bytes=writeStoneHandoffModel(model),decoded=readStoneHandoffModel(bytes);assert.equal(decoded.handoff.cheap[0].data[0],-.25);assert.deepEqual(decoded.handoff.routing,handoff.routing);
 assert.throws(()=>readStoneHandoffModel(bytes.subarray(0,bytes.length-1)),/length/);
 const corrupt=bytes.slice();new DataView(corrupt.buffer).setFloat32(corrupt.length-4,NaN,true);assert.throws(()=>readStoneHandoffModel(corrupt),/finite/);
});
