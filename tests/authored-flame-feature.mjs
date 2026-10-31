// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneSimulationActivity} from '../scene-simulation-activity.mjs';
// Baseline acceptance: losing the composed field retires a currently active
// borrowed runtime, even when no GPU initialization remains pending.
let active=true,current;
const runtime={isActive:()=>active,setActive:async value=>{active=value;}};current=runtime;
const sync=createSceneSimulationActivity({prototype:()=>current,wanted:()=>!!current});
await sync();current=null;await sync();
assert.equal(active,false,'Removing the feature must deactivate its formerly admitted runtime');

const {createAuthoredFlameFeature}=await import('../authored-flame-feature.mjs');
{
 let active=false,finish,visible=true;const calls=[];
 const runtime={isActive:()=>active,setActive:value=>{calls.push(value);if(!value){active=false;return Promise.resolve();}return new Promise(resolve=>{finish=()=>{active=true;resolve();};});},dispose(){throw Error('Borrowed runtime must survive scene retirement');}};
 const feature=createAuthoredFlameFeature({runtime:()=>runtime,visible:()=>visible,composed:()=>true});
 const pending=feature.sync();await feature.clear();finish();assert.equal(await pending,false);assert.equal(active,false);
 const next=feature.restore({present:true,composition:true,isCurrent:()=>true});finish();assert.equal(await next,true);assert.equal(active,true);
 visible=false;await feature.sync();assert.equal(active,false);
 const count=calls.length;await feature.sync();assert.equal(calls.length,count,'No repeated runtime work when accepted activity is unchanged');
}
{
 let active=false,current=true,finish;
 const runtime={isActive:()=>active,setActive:value=>value?new Promise(resolve=>{finish=()=>{active=true;resolve();};}):(active=false,Promise.resolve())};
 const feature=createAuthoredFlameFeature({runtime:()=>runtime,visible:()=>true,composed:()=>true});
 const pending=feature.restore({present:true,composition:true,isCurrent:()=>current});current=false;finish();
 assert.equal(await pending,false);assert.equal(active,false,'Superseded restore cannot revive retained fire');
}
console.log('Flame retirement, retained reuse, visibility and obsolete restore preserve borrowed runtime custody');
