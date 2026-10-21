// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {compileFingerFluidPipelines} from '../finger-fluid-pipeline-startup.mjs';
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
const begin=source.indexOf('    pipelines = '),end=source.indexOf('\n  let computeBindGroup;',begin);
// Exercise the actual production compilation block with independent deferred
// compiler completions. No GPU emulation or wall-clock threshold is involved.
let compiled=[];const pending=[];
const context={useIPBF:false,useAkinci:false,effectiveLiquidFireContactCoverage:'active-liquid-particles',pipelineFor:name=>{compiled.push(name);return new Promise((resolve,reject)=>pending.push({name,resolve,reject}));},failFingerFluidInitialization:reason=>({available:false,reason})};
context.compileFingerFluidPipelines=compileFingerFluidPipelines;
vm.createContext(context);
// Include the original try/catch boundary and its return on failure.
const block=source.slice(source.lastIndexOf('  try {',begin),end);
const run=vm.runInContext('(async()=>{let pipelines;'+block+';return pipelines;})',context);
const task=run();for(let i=0;i<4;i++)await Promise.resolve();
assert.ok(compiled.length>=26,'Independent compute compilations must all start without waiting for the first pipeline');
for(const p of pending)p.resolve({entryPoint:p.name});
const out=await task;assert.equal(out.clear.entryPoint,'clear_grid');assert.equal(out.compactLiquidFireContacts.entryPoint,'compact_liquid_volume_particles');
assert.ok(!compiled.some(x=>x.startsWith('ipbf_')||x.startsWith('surface_')),'Disabled model variants must remain unrequested');
console.log('Actual fluid initialization launches independent compute pipelines together and preserves entry-point selection');

let release,settled=false;const slow=new Promise(r=>release=r),failure=new Error('driver rejected');
const failed=compileFingerFluidPipelines({first:()=>{throw failure;},second:()=>slow});
failed.catch(()=>{settled=true;});for(let i=0;i<4;i++)await Promise.resolve();assert.equal(settled,false,'Cleanup cannot begin while another compilation remains live');release({});await assert.rejects(failed,e=>e===failure);
const a={},b={};assert.deepEqual(await compileFingerFluidPipelines({a:()=>Promise.resolve(a),b:()=>Promise.resolve(b)}),{a,b});
