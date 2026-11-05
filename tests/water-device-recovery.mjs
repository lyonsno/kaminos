// kaminos-test: node
import assert from 'node:assert/strict';
import {createAuthoredWaterFeature} from '../authored-water-feature.mjs';
let device=1;const hosts=[];
const feature=createAuthoredWaterFeature({services:()=>({device}),emitters:()=>[{}],loadHost:async()=>({createAuthoredWaterHost:async({device})=>{
 const host={device,paused:null,disposed:false,setPaused(value){this.paused=value;},setEmitters(){},state:()=>({mode:'finite_drop'}),dispose(){this.disposed=true;}};hosts.push(host);return host;
}})});
feature.setup={};await feature.release();assert.equal(feature.paused,false);
feature.restart(feature.setup);device=2;
assert.equal(typeof feature.recover,'function','water requires a restart preserving play/pause');
await feature.recover(false);assert.equal(feature.host.device,2);assert.equal(feature.host.paused,false);assert(hosts[0].disposed);
feature.restart(feature.setup);device=3;await feature.recover(true);assert.equal(feature.host.device,3);assert.equal(feature.host.paused,true);
console.log('Water restarts on the replacement device, retaining play/pause');
{
 let visible=false;const enabled=[{id:'enabled'}],hidden={id:'hidden'};let inputs;
 const f=createAuthoredWaterFeature({services:()=>({}),emitters:()=>[...enabled,hidden],enabledEmitters:()=>enabled,visible:()=>visible,
 loadHost:async()=>({createAuthoredWaterHost:async options=>{inputs=options.emitters;return {setEmitters(){},setPaused(v){this.paused=v;},state:()=>({mode:'finite_drop'}),dispose(){}};}})});
 f.setup={};await f.recover(false);assert.deepEqual(inputs,enabled,'recovery must not reseed hidden emitters');assert.equal(f.paused,false);assert.equal(f.host.paused,true,'hidden water stays GPU-paused without changing authored pause');
}
{
 // A readback can reject before GPUDevice.lost is delivered. Losing the
 // disposable host must not erase the authored choice to run this water.
 await feature.release();feature.setPaused(true);
 feature.fail(new Error('readback aborted before loss delivery'));
 assert.equal(feature.host,null);
 assert.equal(feature.recoveryRequested,true,'failed host must retain the request to run water');
 assert.equal(feature.paused,true);
 feature.restart(feature.setup);device=4;
 if(feature.recoveryRequested)await feature.recover(feature.paused);
 assert.equal(feature.host.device,4);assert.equal(feature.paused,true);
 feature.reset();assert.equal(feature.recoveryRequested,false,'explicit reset keeps initial preview across loss');
 await feature.release();feature.clear();assert.equal(feature.recoveryRequested,false,'removed water must not reappear');
}
