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
