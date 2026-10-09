import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('async function advance('),text.indexOf('\nfunction ray(',text.indexOf('async function advance(')));
for(const accepted of [false,true]){
 let releaseCut,entered=false,publishedStep=0;
 const next={steps:1,model:{points:1},state:[0,0,0,0,.25,0,0],bonds:[],stresses:[]},held={phase:'active',displacement:[.25,0,0],baselineDisplacement:[0,0,0],component:0};
 const context={busy:false,failure:null,gesture:held,observed:{...next,steps:0},configuration:{},resident:{async movePatch(){},async step(){return{totalMilliseconds:0};},async readFrame(){return next;}},materialComponents:()=>[0],body:{positions:[[0,0,0]],tetrahedra:[]},selectStressRelease:()=>({normal:[1,0,0]}),components:[0],latestSelection:null,interiorSplit:true,$:()=>({value:'1',textContent:''}),performance:{now:()=>0},surfaceObservation:null,timings:[],present(){publishedStep=context.observed.steps;},observeSurface:async()=>{},fail(e){throw e;},async cutInterior(){entered=true;await new Promise(r=>releaseCut=r);if(accepted)context.observed={...next,steps:2};return accepted;}};
 vm.runInNewContext(source,context);const pending=context.advance({evidence:false});while(!entered)await Promise.resolve();
 assert.equal(context.busy,true);assert.equal(publishedStep,1,'The pose used for a new pick must be published before candidate preparation waits');
 const newer={phase:'capturing',point:[.25,0,0]};context.gesture=newer;releaseCut();await pending;
 assert.equal(context.gesture,newer,'Cut completion cannot replace a newer grip');assert.equal(publishedStep,accepted?2:1);assert.equal(context.busy,false);
}
console.log('Actual advance publishes the solved pose before pending cut success/refusal, preserving a newer grip. Synthetic scheduling, not native contact proof.');
