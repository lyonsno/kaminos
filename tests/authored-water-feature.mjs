// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterFeature} from '../authored-water-feature.mjs';
import {defaultLocalLiquidSetup,LOCAL_LIQUID_EMITTER_SCHEMA} from '../local-liquid-setup.mjs';
import {createLocalLiquidEmitterSceneRecord} from '../local-liquid-scene-object.mjs';
const drop=createLocalLiquidEmitterSceneRecord({id:'water',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:LOCAL_LIQUID_EMITTER_SCHEMA,mode:'finite_drop',drop:{width:.3,samplesPerUnit:8}}});
{
 let imports=0,previews=[];
 const feature=createAuthoredWaterFeature({services:()=>{throw Error('Preview must not require render/GPU services');},emitters:()=>[drop],preview:value=>previews.push(value),loadHost:()=>{imports++;throw Error('Unexpected runtime');}});
 feature.setup=defaultLocalLiquidSetup();assert.equal(await feature.restore(),true);
 assert.equal(imports,0);assert.equal(feature.host,null);assert.equal(feature.paused,true);assert.deepEqual(previews,[true]);
 const setup=feature.setup;feature.reset();assert.equal(feature.setup,setup);feature.clear();assert.equal(feature.setup,null);
}
{
 const pending=[];const feature=createAuthoredWaterFeature({services:()=>({}),emitters:()=>[],loadExperiment:options=>new Promise(resolve=>pending.push({options,resolve}))});
 const make=()=>{let disposed=0;const host={setPaused(){},state:()=>({}),dispose(){disposed++;},capability:{dispose(){host.dispose();}}};return {host,get disposed(){return disposed;}};};
 const a=feature.openExperiment({dt:1});await Promise.resolve();const A=make();pending[0].resolve(A.host);const capA=await a;
 const b=feature.openExperiment({dt:2});await Promise.resolve();const B=make();pending[1].resolve(B.host);await b;
 assert.equal(A.disposed,1);assert.equal(pending[0].options.isCurrent(),false);await capA.dispose();assert.equal(feature.host,B.host);assert.equal(B.disposed,0);
 const c=feature.openExperiment({dt:3});await Promise.resolve();feature.clear();const C=make();pending[2].resolve(C.host);await assert.rejects(c,/superseded|changed/);assert.equal(C.disposed,1);assert.equal(B.disposed,1);
}
console.log('Authored preview stays lazy; experiment and authored integration share runtime retirement');
