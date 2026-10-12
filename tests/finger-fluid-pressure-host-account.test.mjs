import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFingerFluidBenchState} from '../finger-fluid-bench-core.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('onRequest:receipt=>{',source.indexOf('function installFingerFluidPressureCockpit'));
const open=source.indexOf('{',start);let depth=1,end=open+1;
for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
const callback=source.slice(open+1,end-1);
test('actual pressure cockpit request updates the shared host account without inventing GPU application',()=>{
 const config={ipbfAlternativeCompliance:.001,requestedPressureIterations:3};
 const state=createFingerFluidBenchState({status:'running'});state.config=config;state.runtime={controlEffectiveGeneration:0};
 const receipt={requested:{alternativeCompliance:125,densityIterations:3,capillaryStrength:.19,pressureRadiusScale:1,beta:60},generation:1,effectiveGeneration:0};
 const run=new Function('receipt','initialConfig','fingerFluidBenchState','window','investigationOperations',`let fingerFluidBenchConfig=initialConfig;${callback};return fingerFluidBenchConfig;`);
 const internal=run(receipt,config,state,{}, {active:false});
 assert.equal(internal.ipbfAlternativeCompliance,125);
 assert.equal(state.config.ipbfAlternativeCompliance,125,'shared session must publish the requested control configuration');
 assert.deepEqual(state.runtime,{controlEffectiveGeneration:0},'only the actual solver can claim effective GPU submission');
});
