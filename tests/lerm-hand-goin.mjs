// kaminos-test: node
import assert from 'node:assert/strict';
import hand from '../experiments/hand-browser-juice.experiment.mjs';
import goin from '../experiments/lerms/goin-pursuit.experiment.mjs';
import composition from '../experiments/lerms/hand-goin.experiment.mjs';
const saved={hand:hand.create,goin:goin.create,window:globalThis.window};
let mounted,opened,handInputs,receiver,water,disposed=0;
const state={playSpace:{config:{pitchDegrees:0,reachX:4}},handedness:'left',acquisitionMode:'detector',cropPadding:1.4,detectorThreshold:.2,
 fingerJuice:{load:{requestedParticleCount:3210,requestedRate:777},jetSpeedWorldPerSecond:2.1,particleLifetimeSeconds:9}};
try{
 hand.create=async context=>{handInputs=context.inputs;water=await context.host.fluid.openInlets({});return {read:()=>state,operations:{},mount(){},async dispose(){disposed++;await water.dispose();}};};
 goin.create=async(context,dependencies)=>{receiver=dependencies.waterReceiver;assert.equal(context.inputs.water.route,'borrowed-mls');return {read:()=>({goin:{id:'same-goin'}}),operations:{},mount:value=>{mounted=value;},dispose:async()=>{disposed++;}};};
 globalThis.window={kaminosWorkbenchExperiments:{open:async(id,inputs)=>{opened={id,inputs};}}};
 let finish;
 const live={dispose(){disposed++;},sampleSphere:()=>new Promise(resolve=>{finish=resolve;})};
 const entry=await composition.create({host:{fluid:{openInlets:async()=>live}},inputs:{hand:{fluidGridSize:[128,80,128]},water:{receiver:{bone:'pelvis',offset:[0,0,0],radius:.5}}},record(){}});
 assert.equal(handInputs.goinPile,null);assert.equal(handInputs.fluidBackend,'mls-mpm');assert.equal(handInputs.playSpace.pitchDegrees,0);
 entry.mount({root:{}});
 const recipe={creature:{case:'source',play:false},physics:{support:{size:[6,.2,6]}},water:{route:'borrowed-mls'}};
 await mounted.reopen(recipe);
 assert.equal(opened.id,'lerms/hand-goin');assert.deepEqual(opened.inputs.creature,recipe.creature);assert.deepEqual(opened.inputs.physics,recipe.physics);
 assert.equal(opened.inputs.hand.particleCount,3210);assert.equal(opened.inputs.hand.sourceFlux,777);assert.equal(opened.inputs.hand.playSpace.reachX,4);
 assert.deepEqual(opened.inputs.hand.fluidGridSize,[128,80,128]);assert.equal(opened.inputs.hand.jetSpeed,2.1);
 const old=receiver.sample({center:[0,0,0],radius:1});await water.dispose();finish({status:'observed',overlap:3});
 assert.equal((await old).status,'superseded');assert.equal((await receiver.sample({center:[0,0,0],radius:1})).status,'awaiting-water');
 await entry.dispose();assert.equal(disposed,4);
}finally{hand.create=saved.hand;goin.create=saved.goin;globalThis.window=saved.window;}
console.log('Outer hand/goin route retains current hand configuration and rejects replaced borrowed water');
