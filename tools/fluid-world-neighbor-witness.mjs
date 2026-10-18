import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
const {values:a}=parseArgs({options:Object.fromEntries(['origin','repo-root','out','browser-module','executable'].map(k=>[k,{type:'string'}]))});
if(!a.out)throw Error('--out is required');await mkdir(a.out,{recursive:true});
const report={ok:false,phase:'arguments',requested:a,errors:[]};let browser,page;
try{
 for(const k of ['origin','repo-root','browser-module','executable'])assert.ok(a[k],`--${k} is required`);
 report.phase='identity';report.serving=await verifyAuthoringServer({origin:a.origin,repoRoot:a['repo-root']});
 const sha=b=>createHash('sha256').update(b).digest('hex');report.source={};
 for(const name of ['finger-fluid-webgpu-core.js','authored-water-drop.mjs']){const response=await fetch(a.origin+'/'+name);assert.ok(response.ok);const served=Buffer.from(await response.arrayBuffer());assert.equal(sha(served),sha(await readFile(a['repo-root']+'/'+name)));report.source[name]=sha(served);}
 const {chromium}=await import(a['browser-module']);
 browser=await chromium.launch({executablePath:a.executable,headless:true,args:['--enable-automation','--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu']});
 report.browser=await browser.version();report.commandLine=await (await browser.newBrowserCDPSession()).send('Browser.getBrowserCommandLine');assert.ok(report.commandLine.arguments.some(a=>a.startsWith('--user-data-dir=')));
 page=await browser.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(a.origin+'/authored-water-drop.mjs');report.phase='effective-gpu';
 report.gpu=await page.evaluate(async()=>{
  const {authoredDropSetup}=await import('/authored-water-host.mjs');
  const {createWebGPUFingerFluidSolver}=await import('/finger-fluid-webgpu-core.js');
  const result=window.__worldNeighborEvidence={errors:[],cases:[]};const old=GPUDevice.prototype.createShaderModule;
  addEventListener('unhandledrejection',e=>result.errors.push(String(e.reason)));
  const shaders=[];GPUDevice.prototype.createShaderModule=function(d){if(d.label==='kaminos-finger-fluid-compute-wgsl-v0'||d.code.includes('fn build_linked_cell_grid'))shaders.push(d.code);return old.call(this,d);};
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No effective WebGPU adapter');result.adapter={...adapter.info};
  const require=(condition,message)=>{if(!condition)throw Error(message);};
  try{
   for(const spec of [{name:'origin',center:[0,1,0],walls:false},{name:'translated',center:[12,5,-7],walls:false},{name:'container',center:[0,.3,0],walls:true}]){
    const record={id:'water',transform:{position:spec.center,rotation:[0,0,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.3,samplesPerUnit:11/.3,container:spec.walls?{min:[-1,0,-1],max:[1,2,1]}:null}}};
    const setup=authoredDropSetup([record],{densityIterations:2}),canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;document.body.append(canvas);let solver;
    const entry={...spec};result.cases.push(entry);
    try{
     solver=await createWebGPUFingerFluidSolver({...setup.solver,canvas,simulationStepSeconds:setup.dt});require(solver.available,'Actual solver unavailable: '+solver.reason);
     entry.initial=await solver.requestParticleState();entry.debug=solver.getDebugState();require(entry.debug.neighborGridContract==='wgsl-world-space-linked-hash-neighbors-v1','Effective solver still uses bounded neighbor lookup');
     require(entry.debug.neighborSearchBounds===null,'Effective lookup must have no search bounds');
     for(let i=0;i<80;i++){solver.step(setup.dt);if(i===0)entry.firstStep=await solver.requestParticleState();}
     entry.final=await solver.requestParticleState();entry.finalDebug=solver.getDebugState();
     const f=new Float32Array(new Uint32Array(entry.final.words).buffer);entry.centroid=[0,0,0];entry.minY=Infinity;entry.maxY=-Infinity;
     for(let i=0;i<entry.final.particleCount;i++){for(let k=0;k<3;k++){require(Number.isFinite(f[16*i+k]),'Nonfinite actual particle');entry.centroid[k]+=f[16*i+k]/entry.final.particleCount;}entry.minY=Math.min(entry.minY,f[16*i+1]);entry.maxY=Math.max(entry.maxY,f[16*i+1]);}
     require(entry.final.stepCount===80,'Every case must use matching fixed timesteps');
     if(spec.walls)require(entry.minY>=setup.solver.diagnosticBox.collisionRadius-1e-5,'Physical floor lost containment');
     else require(entry.centroid[1]<spec.center[1]-.1,'Free water must move under gravity, including outside old bounds');
    }finally{solver?.destroy();canvas.remove();}
   }
   const [near,far]=result.cases,fa=new Float32Array(new Uint32Array(near.final.words).buffer),fb=new Float32Array(new Uint32Array(far.final.words).buffer);
   result.translationMaxPositionError=0;for(let i=0;i<near.final.particleCount;i++)for(let k=0;k<3;k++)result.translationMaxPositionError=Math.max(result.translationMaxPositionError,Math.abs((fb[i*16+k]-far.center[k])-(fa[i*16+k]-near.center[k])));
   result.translationCentroidError=near.centroid.map((v,k)=>Math.abs((far.centroid[k]-far.center[k])-(v-near.center[k])));
   require(Math.max(...result.translationCentroidError)<.0001,'Translated water must preserve aggregate free-fall motion');
   const firstA=new Float32Array(new Uint32Array(near.firstStep.words).buffer),firstB=new Float32Array(new Uint32Array(far.firstStep.words).buffer);result.translationFirstStepMaxError=0;
   for(let i=0;i<near.final.particleCount;i++)for(let k=0;k<3;k++)result.translationFirstStepMaxError=Math.max(result.translationFirstStepMaxError,Math.abs((firstB[i*16+k]-far.center[k])-(firstA[i*16+k]-near.center[k])));
   require(result.translationFirstStepMaxError<.0001,'Rigid translation must preserve the first actual pressure step to f32 tolerance');
   // Compile the actual effective production cell helpers, builder, and traversal
   // admission into a tiny oracle. One bucket forces all 27 stencil cells to alias.
   const production=shaders.find(s=>s.includes('worldNeighborCellWidth'));require(production,'Missing actual compiled world-neighbor shader');
   result.shader=production;
   const functions=production.slice(production.indexOf('const worldNeighborCellWidth:'),production.indexOf('fn kernelWeight('));
   const build=production.match(/@compute @workgroup_size\(\d+\)\nfn build_linked_cell_grid[\s\S]*?(?=\n@compute)/)?.[0];require(build,'Production builder missing');
   const admission=production.match(/          if \(any\(particleNext\[neighborIndex\]\.xyz != neighborCell\)\) \{[\s\S]*?\n          }/)?.[0];require(admission,'Production exact-cell admission missing');
   const device=await adapter.requestDevice();device.addEventListener('uncapturederror',e=>result.errors.push(e.error.message));
   const h=result.cases[0].debug.neighborCellWidth,points=[[0,0,0],[.25*h,0,0],[-.25*h,0,0],[0,.9*h,0],[.9*h,.9*h,0],[10*h,0,0],[-40*h,0,0]],count=points.length;
   const data=new Float32Array(count*16);points.forEach((p,i)=>{data.set(p,i*16);data.set(p,i*16+4);});
   const code=`struct Particle { position:vec4<f32>,predicted:vec4<f32>,velocity:vec4<f32>,delta:vec4<f32> }
struct Params { particleCount:u32,gridCellCount:u32,pad:vec2<u32>,fluid:vec4<f32>,refinementControl:vec4<u32> }
@group(0) @binding(0) var<storage,read_write> particles:array<Particle>;
@group(0) @binding(1) var<storage,read_write> cellHeads:array<atomic<i32>>;
@group(0) @binding(2) var<storage,read_write> particleNext:array<vec4<i32>>;
@group(0) @binding(3) var<uniform> params:Params;
@group(0) @binding(4) var<storage,read_write> output:array<u32>;
${functions}\n${build}
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) gid:vec3<u32>) {
 let index=gid.x;if(index>=params.particleCount){return;}let position=particles[index].predicted.xyz;let baseCell=gridCoord(position);
 for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
 let neighborCell=baseCell+vec3<i32>(x,y,z);if(!density_neighbor_cell_might_contribute(position,neighborCell,1.0)){continue;}
 var current=atomicLoad(&cellHeads[cellIndex(neighborCell)]);while(current>=0){let neighborIndex=u32(current);
 ${admission}
 if(neighborIndex!=index&&distance(position,particles[neighborIndex].predicted.xyz)<params.fluid.x){output[index*params.particleCount+neighborIndex]+=1u;}
 current=particleNext[neighborIndex].w;}
 }}}
}`;
   const module=device.createShaderModule({code});const messages=(await module.getCompilationInfo()).messages;require(!messages.some(m=>m.type==='error'),JSON.stringify(messages));
   const make=(size,usage,values)=>{const b=device.createBuffer({size,usage});if(values)device.queue.writeBuffer(b,0,values);return b;};
   const U=GPUBufferUsage,uniform=new ArrayBuffer(48),view=new DataView(uniform);view.setUint32(0,count,true);view.setUint32(4,1,true);view.setFloat32(16,h,true);view.setUint32(44,1,true);
   const buffers=[make(data.byteLength,U.STORAGE|U.COPY_DST,data),make(4,U.STORAGE|U.COPY_DST,new Int32Array([-1])),make(count*16,U.STORAGE),make(48,U.UNIFORM|U.COPY_DST,uniform),make(count*count*4,U.STORAGE|U.COPY_SRC)];
   // Bind groups are per entry-point: unused bindings are correctly absent.
   const encode=(encoder,entry,indices,dispatch)=>{const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:entry}}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:indices.map(binding=>({binding,resource:{buffer:buffers[binding]}}))});const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(dispatch);pass.end();};
   const encoder=device.createCommandEncoder();encode(encoder,'build_linked_cell_grid',[0,1,2,3],1);encode(encoder,'probe',[0,1,2,3,4],count);const readback=make(count*count*4,U.COPY_DST|U.MAP_READ);encoder.copyBufferToBuffer(buffers[4],0,readback,0,count*count*4);device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);const observed=Array.from(new Uint32Array(readback.getMappedRange()));result.oracle={points,h,hashBucketCount:1,observed};
   for(let i=0;i<count;i++)for(let j=0;j<count;j++){const expected=i!==j&&Math.hypot(...points[i].map((v,k)=>v-points[j][k]))<h?1:0;require(observed[i*count+j]===expected,`GPU hash-alias neighbor ${i}->${j}: ${observed[i*count+j]} expected ${expected}`);}
   require(!result.errors.length,'Uncaptured GPU errors');readback.unmap();readback.destroy();buffers.forEach(b=>b.destroy());device.destroy();return result;
  }finally{GPUDevice.prototype.createShaderModule=old;}
 });
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.gpu.errors,[]);report.ok=true;report.phase='complete';
}catch(error){report.error=error.stack;report.lastTrustworthyEvidence=await page?.evaluate(()=>window.__worldNeighborEvidence??null).catch(()=>null);process.exitCode=1;}finally{await browser?.close();report.browserClosed=true;await writeFile(a.out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error}));}
