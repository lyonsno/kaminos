// Native cost probe only: not imported by the live solver. Inputs are retained
// Galerkin hierarchy + RHS. CPU oracle and raw GPU result survive the run.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pressureTimestampScope} from './helpers/volume-pressure-timing.mjs';
const [dawnPath,inputPath,out]=process.argv.slice(2);assert.ok(dawnPath&&inputPath&&out);
mkdirSync(out,{recursive:true});const report={phase:'input',passed:false,claim:'one provisional multilevel correction; not a complete pressure solve or live flame',cases:[]};
const persist=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
const hash=b=>createHash('sha256').update(b).digest('hex');let device;const owned=[];
try{
 const raw=readFileSync(inputPath),input=JSON.parse(raw);assert.equal(input.schema,'coarse-probe-v0');assert.equal(input.mode,'balanced');
 report.source={revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),root:resolve(new URL('..',import.meta.url).pathname),script:hash(readFileSync(new URL(import.meta.url))),inputPath:resolve(inputPath),inputHash:hash(raw),producer:input.source};
 const all=input.levels;assert.ok(all.length>1);assert.equal(input.rhs.length,all[0].size);assert.ok(input.rhs.every(Number.isFinite));
 for(let j=0;j<all.length;j++){const l=all[j];assert.ok(Number.isInteger(l.size)&&l.size>0);assert.equal(l.ground.length,l.size);assert.equal(l.diag.length,l.size);assert.ok(l.ground.every(v=>Number.isFinite(v)&&v>=0));assert.ok(l.diag.every(v=>Number.isFinite(v)&&v>0));
   for(const [a,b,k]of l.edges)assert.ok(Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a<l.size&&b<l.size&&a!==b&&Number.isFinite(k)&&k>0);
   if(j<all.length-1){assert.equal(l.map.length,l.size);assert.ok(l.map.every(v=>Number.isInteger(v)&&v>=0&&v<all[j+1].size));}}
 report.phase='adapter';persist();const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
 // dawn.node owns its native instance through this JS object, not the device.
 // Keep it alive across the CPU hierarchy preparation and all pending work.
 const gpu=create(['backend=metal']);globalThis.__coarseProbeGPU=gpu;
 const adapter=await gpu.requestAdapter();assert.ok(adapter?.features.has('timestamp-query'),'Metal timestamp-query required');
 device=await adapter.requestDevice({requiredFeatures:['timestamp-query']});const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,timestampQuery:true,dawnPath:resolve(dawnPath)};
 // Use the effective workgroup capacity to choose a provisional small dense
 // coarse system. Its independent rows use the same 64-thread dispatch as
 // other levels; no cells are discarded from the hierarchy or domain.
 const coarse=all.findIndex(l=>l.size<=device.limits.maxComputeInvocationsPerWorkgroup);assert.ok(coarse>=0);
 const levels=all.slice(0,coarse+1);report.levels=levels.map(l=>l.size);report.coarseTreatment='dense inverse instead of deeper V-cycle';
 const last=levels.at(-1),m=last.size,A=Array.from({length:m},(_,i)=>Float64Array.from({length:2*m},(_,j)=>j===i?last.diag[i]:j===m+i?1:0));
 for(const [a,b,k]of last.edges){A[a][b]-=k;A[b][a]-=k;}
 for(let i=0;i<m;i++){let pivot=i;for(let j=i+1;j<m;j++)if(Math.abs(A[j][i])>Math.abs(A[pivot][i]))pivot=j;assert.ok(Math.abs(A[pivot][i])>1e-15,'grounded coarse system required by this probe');[A[i],A[pivot]]=[A[pivot],A[i]];const d=A[i][i];for(let k=0;k<2*m;k++)A[i][k]/=d;for(let j=0;j<m;j++)if(j!==i){const d=A[j][i];for(let k=0;k<2*m;k++)A[j][k]-=d*A[i][k];}}
 const inverse=Float64Array.from(A.flatMap(row=>Array.from(row.slice(m))));
 const apply=(l,x)=>{const y=Float64Array.from(x,(v,i)=>v*l.ground[i]);for(const [a,b,k]of l.edges){const v=k*(x[a]-x[b]);y[a]+=v;y[b]-=v;}return y;};
 const cpu=(j,b)=>{const l=levels[j];if(j===coarse)return Float64Array.from({length:m},(_,i)=>b.reduce((s,v,k)=>s+v*inverse[i*m+k],0));
   const x=new Float64Array(l.size),smooth=()=>{for(let t=0;t<2;t++){const a=apply(l,x);for(let i=0;i<x.length;i++)x[i]+=(2/3)*(b[i]-a[i])/l.diag[i];}};smooth();const a=apply(l,x),r=new Float64Array(levels[j+1].size);for(let i=0;i<x.length;i++)r[l.map[i]]+=b[i]-a[i];const c=cpu(j+1,r);for(let i=0;i<x.length;i++)x[i]+=c[l.map[i]];smooth();return x;};
 const expected=cpu(0,input.rhs);writeFileSync(resolve(out,'expected.f64'),new Uint8Array(expected.buffer));
 const alloc=(name,data)=>{const size=typeof data==='number'?data:data.byteLength;assert.ok(size<=device.limits.maxStorageBufferBindingSize);const b=device.createBuffer({label:name,size:Math.max(4,size),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);if(typeof data!=='number')device.queue.writeBuffer(b,0,data);return b;};
 const pipeline=(code,bindings)=>{const module=device.createShaderModule({code}),p=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'main'}}),group=device.createBindGroup({layout:p.getBindGroupLayout(0),entries:bindings.map((buffer,binding)=>({binding,resource:{buffer}}))});return {p,group};};
 const buffers=levels.map((l,j)=>{const rows=Array.from({length:l.size},()=>[]);for(const [a,b,k]of l.edges){rows[a].push(b,k);rows[b].push(a,k);}const nodes=[],links=[];rows.forEach((row,i)=>{nodes.push(links.length/2,row.length/2,l.diag[i],l.ground[i]);links.push(...row);});return {x:[alloc('x0',l.size*4),alloc('x1',l.size*4)],rhs:alloc('rhs',j?l.size*4:Float32Array.from(input.rhs)),res:alloc('residual',l.size*4),nodes:alloc('nodes',Float32Array.from(nodes)),links:alloc('links',Float32Array.from(links)),map:l.map?alloc('parent',Uint32Array.from(l.map)):null};});
 const steps=[];const call=(pass,step,count)=>{pass.setPipeline(step.p);pass.setBindGroup(0,step.group);pass.dispatchWorkgroups(Math.ceil(count/64));};
 for(let j=0;j<coarse;j++){const l=levels[j],b=buffers[j],next=buffers[j+1],child=levels[j+1];
   const math=`@group(0) @binding(0) var<storage,read> nodes:array<vec4<f32>>;@group(0) @binding(1) var<storage,read> links:array<vec2<f32>>;@group(0) @binding(2) var<storage,read> x:array<f32>;@group(0) @binding(3) var<storage,read> rhs:array<f32>;@group(0) @binding(4) var<storage,read_write> y:array<f32>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=${l.size}u){return;}let row=nodes[i];var ax=row.w*x[i];for(var k=0u;k<u32(row.y);k++){let e=links[u32(row.x)+k];ax+=e.y*(x[i]-x[u32(e.x)]);}BODY}`;
   const smooth=[0,1].map(i=>pipeline(math.replace('BODY','y[i]=x[i]+(2.0/3.0)*(rhs[i]-ax)/row.z;'),[b.nodes,b.links,b.x[i],b.rhs,b.x[1-i]]));
   const residual=pipeline(math.replace('BODY','y[i]=rhs[i]-ax;'),[b.nodes,b.links,b.x[0],b.rhs,b.res]);
   const children=Array.from({length:child.size},()=>[]);l.map.forEach((p,i)=>children[p].push(i));const ranges=[],indices=[];for(const row of children){ranges.push(indices.length,row.length);indices.push(...row);}
   const restrict=pipeline(`@group(0) @binding(0) var<storage,read> r:array<f32>;@group(0) @binding(1) var<storage,read> ranges:array<vec2<u32>>;@group(0) @binding(2) var<storage,read> indices:array<u32>;@group(0) @binding(3) var<storage,read_write> b:array<f32>;@group(0) @binding(4) var<storage,read_write> x:array<f32>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=${child.size}u){return;}let row=ranges[i];var v=0.0;for(var k=0u;k<row.y;k++){v+=r[indices[row.x+k]];}b[i]=v;x[i]=0.0;}`,[b.res,alloc('ranges',Uint32Array.from(ranges)),alloc('children',Uint32Array.from(indices)),next.rhs,next.x[0]]);
   const prolong=pipeline(`@group(0) @binding(0) var<storage,read> c:array<f32>;@group(0) @binding(1) var<storage,read> parent:array<u32>;@group(0) @binding(2) var<storage,read_write> x:array<f32>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i<${l.size}u){x[i]+=c[parent[i]];}}`,[next.x[0],b.map,b.x[0]]);
   steps.push({smooth,residual,restrict,prolong});
 }
 const direct=pipeline(`@group(0) @binding(0) var<storage,read> inverse:array<f32>;@group(0) @binding(1) var<storage,read> b:array<f32>;@group(0) @binding(2) var<storage,read_write> x:array<f32>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=${m}u){return;}var v=0.0;for(var k=0u;k<${m}u;k++){v+=inverse[i*${m}u+k]*b[k];}x[i]=v;}`,[alloc('coarse inverse',Float32Array.from(inverse)),buffers.at(-1).rhs,buffers.at(-1).x[0]]);
 const cycle=(pass,j=0)=>{if(j===coarse){call(pass,direct,m);return;}const s=steps[j],n=levels[j].size;for(const p of s.smooth)call(pass,p,n);call(pass,s.residual,n);call(pass,s.restrict,levels[j+1].size);cycle(pass,j+1);call(pass,s.prolong,n);for(const p of s.smooth)call(pass,p,n);};
 report.phase='gpu';persist();
 for(let i=0;i<4;i++){const encoder=device.createCommandEncoder();encoder.clearBuffer(buffers[0].x[0]);const scope=pressureTimestampScope(device,encoder),t=performance.now(),pass=scope.encoder.beginComputePass();cycle(pass);pass.end();scope.resolve();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();const wallMs=performance.now()-t;let timing;try{timing=await scope.read();}finally{scope.destroy();}report.cases.push({label:i?'repeat':'first-use',wallMs,timing});persist();}
 const read=device.createBuffer({size:expected.length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(read);const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffers[0].x[0],0,read,0,expected.length*4);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const actual=new Float32Array(read.getMappedRange().slice(0));writeFileSync(resolve(out,'actual.f32'),new Uint8Array(actual.buffer));
 assert.deepEqual(errors,[]);assert.ok(actual.every(Number.isFinite));report.maxAbsoluteError=expected.reduce((m,v,i)=>Math.max(m,Math.abs(v-actual[i])),0);report.maxExpected=expected.reduce((m,v)=>Math.max(m,Math.abs(v)),0);assert.ok(report.maxAbsoluteError<1e-6,'GPU correction differs from CPU oracle');report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}finally{owned.forEach(b=>b.destroy());device?.destroy();persist();console.log(JSON.stringify(report));delete globalThis.__coarseProbeGPU;}
