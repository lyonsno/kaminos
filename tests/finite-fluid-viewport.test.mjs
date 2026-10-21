// kaminos-test: node
import assert from 'node:assert/strict';
import {createFiniteFluidHost} from '../finite-fluid-host.mjs';
let ticks=0,options=[];const descriptor={writeTick:1};
const setup={dt:1/240,playbackMode:'render_cadence',support:{kind:'invisible_box'},solver:{particleCount:8,diagnosticPopulation:{},diagnosticBox:{},rendererMode:'screen_space_refraction'}};
const host=await createFiniteFluidHost({setup,device:{},createSolver:async()=>({available:true,step(){ticks++;},getDebugState:()=>({}),getInterfaceRecordDescriptor:()=>descriptor,destroy(){}}),createPresentation:()=>({render:o=>options.push(o),state:()=>({}),dispose(){}})});
assert.equal(host.presentation,'full','Finite water must implement current shared viewport presentation');
host.setPresentation('proxy');assert.equal(host.interfaceRecordDescriptor(),descriptor);host.setProxyStepEvery(2);host.setPaused(false);
for(let n=0;n<5;n++)host.render({timestampMs:n*100});
assert.equal(options.length,5);assert.ok(options.every(o=>o.presentation==='proxy'));assert.equal(ticks,2,'Proxy cadence skips complete fixed ticks instead of enlarging them');
host.setPresentation('hidden');host.render({timestampMs:500});assert.equal(options.at(-1).presentation,'hidden');
assert.throws(()=>host.setPresentation('bogus'),/presentation/i);assert.throws(()=>host.setProxyStepEvery(0),/positive/i);host.dispose();assert.equal(host.interfaceRecordDescriptor(),null);
console.log('Finite water shares Full/Proxy/Hidden, descriptor and fixed-tick proxy cadence contracts');
