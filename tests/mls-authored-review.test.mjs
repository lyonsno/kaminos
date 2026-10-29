// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {authoredMlsSetup} from '../authored-mls-water.mjs';
import {createMlsJuiceSolver} from '../mls-juice-solver.mjs';
const row={id:'water',label:'Water',type:'local-liquid-emitter',transform:{position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width:.5,samplesPerUnit:48}}};
const setup={waterSampling:{spacing:1/48,particleTarget:12000,container:{min:[-2,-1,-2],max:[2,3,2]},worldBounds:{min:[-2,-1,-2],max:[2,3,2]}}};
const text=await fs.readFile(new URL('../authored-mls-host.mjs',import.meta.url),'utf8');
const pendingExpression=text.match(/pendingSourceChanges:(.*),\n/)[1];
const pending=(records,initial,saved=setup,next=setup)=>new Function('records','initial','setup','pendingSetup',`return ${pendingExpression}`)(records,initial,saved,next);
const initial=authoredMlsSetup([row],setup);
assert.equal(pending([row],initial),false,'fresh release must not claim that its initial source has changed');
assert.equal(pending([{...row,label:'Renamed'}],initial),false,'labels do not alter the initial particle population');
const moved=structuredClone(row);moved.transform.position[0]=.1;
assert.equal(pending([moved],initial),true);assert.equal(pending([moved],authoredMlsSetup([moved],setup)),false);
assert.equal(pending([row],initial,setup,{...setup,particleCount:24000}),true);
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
const originalFetch=globalThis.fetch;globalThis.fetch=async url=>({ok:true,text:()=>fs.readFile(url,'utf8')});
const calls=[];
const device={limits:{maxStorageBufferBindingSize:1024**3,maxBufferSize:1024**3,maxComputeWorkgroupsPerDimension:65535},
createBuffer:({size})=>({getMappedRange:()=>new ArrayBuffer(size),unmap(){},destroy(){}}),createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),createBindGroup:()=>({}),
createCommandEncoder:()=>({clearBuffer(){},copyBufferToBuffer(){},beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(...args){calls.push(args);},end(){}}),finish:()=>({})}),
queue:{writeBuffer(){},submit(){},onSubmittedWorkDone:async()=>{}}};
try{for(const width of [.5,.25]){const source=structuredClone(row);source.localLiquidEmitter.drop.width=width;const s=authoredMlsSetup([source],setup);
 assert.equal(s.initialCount,initial.initialCount);const solver=await createMlsJuiceSolver({device,setup:s.solver,initialParticles:s.initialParticles,packet:{authority:{simulation_safe:false},emitters:[]}});await solver.advanceTo(1);solver.dispose();
 const gridCall=calls.at(-2);assert(gridCall.every(n=>n<=65535));assert(gridCall[0]*(gridCall[1]??1)*64>=s.solver.gridSize.reduce((a,b)=>a*b));
}}finally{globalThis.fetch=originalFetch;}
console.log('MLS fresh/edited source state and unchanged-population half-size grid admission');
