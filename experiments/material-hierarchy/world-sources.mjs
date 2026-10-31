import {createWorldSmoke,worldSmokePlan} from '../../volume-world-smoke.mjs';
import {compileImmersedSourceCollection,compileWorldSourceParcels} from '../../volume-immersed-source-collection.mjs';

// A source wholly outside Fine deposits into world cells whose centers are
// inside Fine. Zero refinement must still preserve its fuel/heat and history.
export function boundaryFixture(){
 const dims=[32,64,32],transform={translate:[.35,0,0],scale:1},anchor={translate:[0,0,0],scale:1};
 const controls={emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',
  immersedCentreX:1.0625,immersedCentreY:0,immersedCentreZ:0,
  immersedRadius:.02,immersedThickness:1,immersedPitch:90,immersedSpeed:.1,immersedMomentumGain:0,
  immersedFuel:.5,immersedTemperature:1.2};
 const packed=compileImmersedSourceCollection([{id:'edge',worldSource:true,controls}],{controls,grid:dims[0],gridHeight:dims[1]});
 const sources=compileWorldSourceParcels(packed,{grid:dims[0],gridHeight:dims[1],transform,anchor});
 return {dims,transform,anchor,sources,fineSupply:packed.sources[0].config.effective.fluxEffectivePredicted,
  plan:worldSmokePlan({flow:8,material:16,pressure:4,extent:4,fineHeightRatio:2})};
}
export function validateBoundaryEvidence(raw){
 const demand=(ok,message)=>{if(!ok)throw Error(message);};
 const fixture=boundaryFixture(),length=fixture.plan.materialCells*8;
 demand(raw.adapter?.vendor==='apple'&&raw.adapter?.fallback===false,'Native Apple route required');
 demand(Array.isArray(raw.errors)&&raw.errors.length===0,'GPU errors or missing error evidence');
 demand(raw.fineSupply===0&&raw.parcels===8,'Exact wholly exterior source required');
 demand(raw.cases?.length===2,'Dense and unrefined adaptive cases required');
 const expected=fixture.sources.parcels.reduce((v,p)=>v+p.rate*p.heat*p.lo.reduce((s,x,a)=>s*(p.hi[a]-x),1),0);
 for(const [i,c] of raw.cases.entries()){
  demand(c.mode===['dense','adaptive-zero'][i],'Wrong or duplicate material route');
  demand(c.receipt?.steps===2&&c.receipt?.materialLaw==='passive-authored','Two passive steps required');
  demand(c.receipt?.adaptiveMaterial?.options?.budget===0||i===0,'Adaptive budget changed');
  demand((c.receipt?.adaptiveMaterial!=null)===(i===1),'Requested material route did not execute');
  demand(JSON.stringify(c.receipt.materialDims)===JSON.stringify(fixture.plan.materialDims),'Wrong material dimensions');
  demand(c.frames?.length===2,'Injection and removal frames required');
  for(const [step,values] of c.frames.entries()){
   demand(Array.isArray(values)&&values.length===length&&values.every(Number.isFinite),'Complete finite raw gas required');
   let heat=0,fuel=0;
   for(let j=0;j<values.length;j+=8){heat+=values[j+1]*fixture.plan.materialPitch**3;fuel+=values[j+2]*fixture.plan.materialPitch**3;}
   demand(Math.abs(heat-expected)<expected*1e-5,`${c.mode} step ${step}: exterior heat was lost or duplicated (${heat} vs ${expected})`);
   demand(Math.abs(fuel-expected*.5/1.2)<expected*1e-5,'Exterior fuel was lost or duplicated');
  }
 }
 return {expectedHeat:expected,cases:raw.cases.map(c=>c.mode)};
}
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter||(adapter.info.isFallbackAdapter??adapter.isFallbackAdapter)||adapter.info.vendor!=='apple')throw Error('Native Apple WebGPU required');
 const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:8}});
 const errors=[],owned=[],f=boundaryFixture();
 const result={adapter:{vendor:adapter.info.vendor,fallback:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter},errors,fineSupply:f.fineSupply,parcels:f.sources.parcels.length,cases:[]};
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
 try{
  const fine=device.createBuffer({size:f.dims.reduce((a,b)=>a*b,1)*64,usage:GPUBufferUsage.STORAGE});
  const reaction=device.createTexture({size:f.dims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});
  owned.push(fine,reaction);
  for(const mode of ['dense','adaptive-zero']){
   const world=createWorldSmoke(device,f.plan,f.anchor);owned.push(world);
   if(mode==='adaptive-zero')world.configureAdaptiveMaterial({budget:0,maxDetail:4});
   const c={mode,frames:[]};result.cases.push(c);
   for(let step=0;step<2;step++){
    const encoder=device.createCommandEncoder();
    c.receipt=world.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:f.dims,transform:f.transform,
     time:{dtScale:0,backtraceScale:1},iterations:0,buoyancy:0,sources:step?{count:0,parcels:[],supports:[]}:f.sources});
    const r=world.materialResources(),buffer=r.buffers[r.index],size=f.plan.materialCells*32;
    const copy=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    encoder.copyBufferToBuffer(buffer,0,copy,0,size);device.queue.submit([encoder.finish()]);
    try{await copy.mapAsync(GPUMapMode.READ);c.frames.push(Array.from(new Float32Array(copy.getMappedRange())));}finally{copy.destroy();}
   }
  }
  const validation=await device.popErrorScope();if(validation)errors.push(validation.message);
  result.summary=validateBoundaryEvidence(result);return result;
 }catch(error){return {...result,failed:true,error:error.stack};}
 finally{for(const x of owned)x.destroy();device.destroy();}
}
