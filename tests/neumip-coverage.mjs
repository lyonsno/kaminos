// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createNeumipStudent,createNeumipTraining} from '../neumip-training.mjs';import {writeNeumipModel,readNeumipModel} from '../neumip-model.mjs';import {withKaminosGpu} from '../tools/shader-herder.mjs';
test('coverage student retains a view-only opacity output through training and archive reload',async()=>{
 const model=createNeumipStudent({resolution:4,seed:41,coverage:true});assert.equal(model.layers.find(l=>l.name==='offset_network.mpl3').output,2,'offset stage must also expose view-only coverage');
 const restored=readNeumipModel(writeNeumipModel(model));assert.equal(restored.coverage,true);
 await withKaminosGpu(async({device})=>{const learner=await createNeumipTraining(device,restored,{batchSize:2});try{const q=new Float32Array([.25,.25,0,0,0,0,0,0,.75,.75,0,0,0,0,0,0]);learner.setQueries(q);const before=await learner.evaluate();assert.equal(before.coverage.length,2);for(let i=0;i<40;i++){learner.setQueries(q);learner.setTargets(new Float32Array([.1,.1,.1,1,.1,.1,.1,1]));const encoder=device.createCommandEncoder();learner.encodeUpdate(encoder);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();}const after=await learner.evaluate();assert.ok(after.coverage[0]>before.coverage[0]+.05,'observed coverage must learn from hit labels');}finally{learner.dispose();}});
});
