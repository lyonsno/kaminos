import {createWorldSmoke,worldSmokePlan} from '../../volume-world-smoke.mjs';
import {resolveReactantCombustionConfig} from '../../volume-reactant-combustion.mjs';
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter||adapter.info.vendor!=='apple')throw Error('Native Apple WebGPU required');
 const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:8}});const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
 let world;const owned=[];
 const result={adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},steps:[]};
 try{
  const plan=worldSmokePlan({flow:4,material:8,pressure:2,extent:3,fineHeightRatio:1});
  world=createWorldSmoke(device,plan,{translate:[0,0,0],scale:1});
  const fine=device.createBuffer({size:4**3*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});owned.push(fine);
  const reaction=device.createTexture({size:[4,4,4],dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});owned.push(reaction);
  const initial=new Float32Array(plan.materialCells*8);
  for(let i=0;i<plan.materialCells;i++){initial[i*8]=(i%8)/8;initial[i*8+1]=.1;initial[i*8+2]=.2;initial[i*8+3]=1;}
  for(const b of world.materialResources().buffers)device.queue.writeBuffer(b,0,initial);
  world.configureAdaptiveMaterial({budget:2,maxDetail:2,persistence:0});
  for(const budget of [2,2,2,0,3,3]){
   world.configureAdaptiveMaterial({budget});
   const encoder=device.createCommandEncoder();world.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:[4,4,4],transform:{translate:[100,100,100],scale:1},time:{dtScale:0,backtraceScale:0},iterations:0,buoyancy:0});
   device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
   // Permit the compact-demand asynchronous completion to publish.
   await new Promise(r=>setTimeout(r,0));
   const state=world.adaptiveMaterialState();const snapshot=await world.adaptiveMaterialSnapshot();
   const totals=Array(8).fill(0);for(const n of snapshot.nodes.filter(n=>!n.children)){for(let c=0;c<64;c++)for(let ch=0;ch<8;ch++)totals[ch]+=snapshot.values[(n.slot*64+c)*8+ch]*n.pitch**3;}
   result.steps.push({...state,totals,snapshot});
  }
  // At zero extra budget the hierarchy must preserve the existing reacting
  // transport law. Compare actual native output, including open-edge samples.
  const pair=[createWorldSmoke(device,plan,{translate:[0,0,0],scale:1}),createWorldSmoke(device,plan,{translate:[0,0,0],scale:1})];owned.push(...pair);
  const seed=initial.slice();for(let i=0;i<plan.materialCells;i++){seed[i*8+1]=.6+(i%5)*.05;for(let k=1;k<=3;k++)seed[i*8+4+k]=seed[i*8]*seed[i*8+1]**k;}
  for(const field of pair)for(const b of field.materialResources().buffers)device.queue.writeBuffer(b,0,seed);
  pair[1].configureAdaptiveMaterial({budget:0,maxDetail:2});
  const reactant=resolveReactantCombustionConfig({reactionLaw:'reactant-v0',emitterSourceLaw:'immersed-source'},{grid:4});
  if(!reactant.effective.admitted)throw Error('Native reference chemistry was not admitted');
  for(let step=0;step<4;step++){
   for(const field of pair){const encoder=device.createCommandEncoder();field.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:[4,4,4],transform:{translate:[100,100,100],scale:1},time:{dtScale:.5,backtraceScale:1},reactant,iterations:2,buoyancy:.2});device.queue.submit([encoder.finish()]);}
   await device.queue.onSubmittedWorkDone();await new Promise(r=>setTimeout(r,0));
  }
  result.reference=[];
  for(const field of pair){const resources=field.materialResources(),buffer=resources.buffers[resources.index];const copy=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,copy,0,buffer.size);device.queue.submit([encoder.finish()]);await copy.mapAsync(GPUMapMode.READ);result.reference.push(Array.from(new Float32Array(copy.getMappedRange())));copy.destroy();}
  result.referenceMaxError=Math.max(...result.reference[0].map((v,i)=>Math.abs(v-result.reference[1][i])));
  if(result.referenceMaxError>1e-5)throw Error('Zero-budget native transport differs from dense reference: '+result.referenceMaxError);
  const validation=await device.popErrorScope();if(validation)errors.push(validation.message);
  result.errors=errors;if(errors.length)throw Error(errors.join('\n'));
  if(!result.steps.some(s=>s.levels.some(l=>l.level>0)))throw Error('No material refinement executed');
  if(result.steps[3].levels.some(l=>l.level!==0))throw Error('Zero budget did not remove refinement');
  for(const s of result.steps)for(let ch=0;ch<8;ch++)if(Math.abs(s.totals[ch]-result.steps[0].totals[ch])>1e-4*Math.max(1,result.steps[0].totals[ch]))throw Error(`Reallocation changed channel ${ch} quantity`);
  for(const s of result.steps)if(s.error||s.allocatedBricks>s.capacity)throw Error('Allocator failed: '+JSON.stringify(s));
  return result;
 }catch(e){return {...result,errors,error:e.stack,failed:true};}finally{world?.destroy();for(const x of owned)x.destroy();device.destroy();}
}
