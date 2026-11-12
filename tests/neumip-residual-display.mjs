// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeumipMaterial} from '../neumip-material.mjs';
import {createNeumipStudent} from '../neumip-training.mjs';
const handoff={cheapResolution:4,routing:{width:.7,depth:.7,inner:.08,collar:.04},material:{color:[.4,.35,.3],roughness:.8,metalness:0}};
test('paired diagnostics expose a live signed correction gain and explicit display identity',()=>{
 const bundle=createNeumipMaterial(createNeumipStudent({resolution:4,handoff}),{display:'residual',residualGain:2});
 try{assert.equal(bundle.read().display,'residual');assert.equal(bundle.read().residualGain,2);bundle.settings.residualGain.value=4;assert.equal(bundle.read().residualGain,4);assert.equal(bundle.material.fog,false);}finally{bundle.material.dispose();}
});
test('diagnostics reject missing pair, unknown display and invalid gain',()=>{
 const ordinary=createNeumipStudent({resolution:4});
 assert.throws(()=>createNeumipMaterial(ordinary,{display:'residual'}),/paired/i);
 const pair=createNeumipStudent({resolution:4,handoff});
 assert.throws(()=>createNeumipMaterial(pair,{display:'banana'}),/display/i);
 for(const residualGain of [-1,NaN,Infinity])assert.throws(()=>createNeumipMaterial(pair,{display:'residual',residualGain}),/gain/i);
});
import stoneExperiment from '../experiments/stone-handoff.experiment.mjs';
test('stone diagnostic control releases its global drag listeners on teardown',async()=>{
 let disposed=0;
 const document={createElement(){return {append(){},setAttribute(){}};}};
 const session={redraw(){},readView(){return {};},setView(){},async attach(root){return {id:'test-stone',root};},async dispose(){}};
 const instance=await stoneExperiment.create({host:{scene:{open:async()=>session},controls:{installNumberDrag(){return {dispose(){disposed++;}};}}},inputs:{source:{cells:4}},record(){}});
 instance.mount({root:{append(){}},document,invoke(){return Promise.resolve();}});
 await instance.dispose();assert.equal(disposed,1,'number-drag document/window listeners retained after scene disposal');
});
