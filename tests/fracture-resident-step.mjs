// kaminos-test: node
import assert from 'node:assert/strict';import fs from 'node:fs';
// Execute the actual production step body with GPU submission dependencies. A
// physical-state read is forbidden; explicit diagnostic acquisition is separate.
const source=fs.readFileSync(new URL('../fracture-coarse-dynamics.mjs',import.meta.url),'utf8');
const start=source.indexOf('function step()'),open=source.indexOf('{',start);let depth=1,end=open+1;while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
const body=source.slice(open+1,end-1),calls=[];
const run=new Function('calls',`let disposed=false,stepIndex=1,bindRequest=null,hand=null;const config={gravity:9.81,timeStep:1/60};const gravityScale=()=>1;const samples=[],events=[],state={bonds:[]};const parameters=()=>calls.push('parameters'),dispatch=name=>calls.push(name),read=()=>{throw Error('Live step acquired GPU state');};const batchCoarseCompute=(_renderer,action)=>action();const engine={stats:{pairDispatchTruncated:false},setGravity:()=>{},step:()=>calls.push('solve')},renderer={};return async()=>{${body}};`)(calls);
await run();assert.deepEqual(calls,['parameters','commands','solve','fracture']);
console.log('Live step submits commands, solve and fracture without state acquisition');
