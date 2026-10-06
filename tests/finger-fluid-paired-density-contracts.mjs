import assert from 'node:assert/strict';
import * as witness from '../finger-fluid-packed-density-witness.mjs';
assert.equal(typeof witness.capturePairedDensityWitness,'function','frozen witness must expose the paired production-kernel experiment');
const rejects = args => assert.rejects(witness.capturePairedDensityWitness(args),/paired density/);
await rejects({pairs:0});await rejects({pairs:2,repetitions:0});
await rejects({pairs:2,repetitions:1,comparison:'fallback'});
console.log('paired density admission contracts passed');
globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8,MAP_READ:16,QUERY_RESOLVE:32};globalThis.GPUMapMode={READ:1};
const passes=[],groups=[],original=[],submissions=[];let clock=1n;
const makeBuffer=d=>({...d,data:new Uint8Array(d.size),destroy(){},async mapAsync(){},unmap(){},getMappedRange(){return this.data.buffer}});
for(let i=0;i<12;i++)original.push({binding:i,resource:{buffer:makeBuffer({label:'live-'+i,size:i===0?128:16,usage:2|(i===3||i===11?8:1)})}});
original[3].resource.buffer.data[0]=73;
const device={features:new Set(['timestamp-query']),pushErrorScope(){},async popErrorScope(){return null},createBuffer:makeBuffer,createQuerySet:d=>({...d,values:[],destroy(){}}),createPipelineLayout:x=>x,createShaderModule:x=>x,async createComputePipelineAsync(x){return x.compute},createBindGroup:x=>{groups.push(x);return x},queue:{submit(items){submissions.push(...items)},writeBuffer(b,offset,data){b.data.set(data,offset)},async onSubmittedWorkDone(){if(submissions.length)submissions.at(-1).completed=true}},createCommandEncoder(){let timedPasses=0,copies=0;return {
 copyBufferToBuffer(a,offset,b,to,size){copies++;b.data.set(a.data.subarray(offset,offset+size),to)},
 beginComputePass(d={}){if(d.timestampWrites)timedPasses++;const p={...d,ops:[],setBindGroup(_,g){this.group=g},setPipeline(x){this.pipeline=x},dispatchWorkgroups(){this.ops.push(this.pipeline.entryPoint);if(this.pipeline.entryPoint==='solve_position_delta')this.group.entries.find(e=>e.binding===0).resource.buffer.data[0]=this.pipeline.module.code.includes('var densityCellAdmissionMask =')?77:11},end(){if(d.timestampWrites){const t=d.timestampWrites;t.querySet.values[t.beginningOfPassWriteIndex]=clock;clock+=100n;t.querySet.values[t.endOfPassWriteIndex]=clock;clock+=10n}}};passes.push(p);return p},
 resolveQuerySet(q,start,count,b){new BigUint64Array(b.data.buffer).set(q.values.slice(start,start+count))},finish(){return {timedPasses,copies}}};}};
const args={device,shader:'const packedDensityEnabled: bool = false;\n'+(await import('node:fs')).readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8'),layout:{},buffers:original,count:2,cells:2,packedLayout:{headWords:10,particleWords:10},stepCount:180,pairs:2,repetitions:2};
const r=await witness.capturePairedDensityWitness(args);
assert.equal(r.frozenBindings.length,12);assert.equal(Buffer.from(r.frozenBindings[3].bytes,'base64')[0],73);
assert.ok(groups.every(g=>g.entries.every(e=>!original.some(o=>o.resource.buffer===e.resource.buffer))),'all compute bindings are detached from live state');
assert.equal(r.series.length,2);assert.deepEqual(r.series.map(s=>s.samples.map(x=>x.order)),[[['A','B'],['B','A']],[['A','B'],['B','A']]]);
const timed=passes.filter(p=>p.timestampWrites);assert.equal(timed.length,8);
for(const p of timed.slice(0,4))assert.deepEqual(p.ops,['compute_density_lambda','solve_position_delta','compute_density_lambda','solve_position_delta']);
for(const p of timed.slice(4))assert.ok(p.ops.includes('clear_grid')&&p.ops.includes('build_linked_cell_grid'));
assert.ok(timed.slice(4).some(p=>p.ops.includes('pack_density_cell_records')));
const bad=original.map(e=>({...e,resource:{buffer:{...e.resource.buffer,usage:0}}}));await assert.rejects(witness.capturePairedDensityWitness({...args,buffers:bad}),/cannot be frozen/);
console.log('actual paired scheduler freezes dependencies and preserves both orders/routes');
const retained=structuredClone(r.frozenBindings);const bytes=Buffer.from(retained[3].bytes,'base64');bytes[0]=99;retained[3].bytes=bytes.toString('base64');
const replay=await witness.capturePairedDensityWitness({...args,frozenBindings:retained});assert.equal(Buffer.from(replay.frozenBindings[3].bytes,'base64')[0],99,'retained inputs must replace live inputs on replay');

await assert.rejects(witness.capturePairedDensityWitness({...args,frozenBindings:retained.slice(1)}),/twelve/);
const partial=structuredClone(retained);partial[3].bytes='AA==';await assert.rejects(witness.capturePairedDensityWitness({...args,frozenBindings:partial}),/partial/);

assert.ok(submissions.every(s=>s.timedPasses<=1),'each timed arm must occupy its own completion-fenced submission');

assert.ok(submissions.filter(s=>s.timedPasses).every(s=>s.completed),'every timed submission is completion-fenced');

assert.ok(submissions.filter(s=>s.timedPasses).every(s=>s.copies===0),'measured submissions contain no input restoration copies');

await assert.doesNotReject(()=>witness.capturePairedDensityWitness({...args,comparison:'packed-vs-cell-reuse'}),'paired route must exercise the within-iteration cell reuse candidate');

const cached=await witness.capturePairedDensityWitness({...args,comparison:'packed-vs-cell-reuse'});assert.deepEqual(cached.armModes,{A:'packed',B:'cell-reuse'});
for(const s of cached.series){const proof=s.validation.find(x=>x.arm==='B').witness;assert.equal(Buffer.from(proof.buffers.packedResult,'base64')[0],77,'candidate output retained in candidate role');assert.equal(Buffer.from(proof.buffers.linkedResult,'base64')[0],11,'independent reference output retained separately');}
