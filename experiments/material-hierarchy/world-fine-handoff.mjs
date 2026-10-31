import {createWorldSmoke,worldSmokePlan} from '../../volume-world-smoke.mjs';
import {depositWorldSources} from '../../volume-world-sources.mjs';
import {compileImmersedSourceCollection,compileWorldSourceParcels} from '../../volume-immersed-source-collection.mjs';

export function handoffFixture(){
 const dims=[32,64,32],transform={translate:[.25,0,.25],scale:.2},anchor={translate:[0,0,0],scale:1};
 const controls={emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',immersedCentreX:1.25,immersedCentreY:0,immersedCentreZ:0,
  immersedRadius:.2,immersedThickness:1,immersedPitch:90,immersedSpeed:1,immersedMomentumGain:0,immersedFuel:.5,immersedTemperature:1.2};
 const packed=compileImmersedSourceCollection([{id:'exterior-edge',worldSource:true,controls}],{controls,grid:dims[0],gridHeight:dims[1]});
 const sources=compileWorldSourceParcels(packed,{grid:dims[0],gridHeight:dims[1],transform,anchor});
 return {dims,transform,anchor,sources,plan:worldSmokePlan({flow:8,material:16,pressure:4,extent:4,fineHeightRatio:2}),fineGas:[.25,2,.125]};
}
const modes=['dense','adaptive-zero','adaptive-regrid','dense-adaptive-switch'];
function stageFor(mode,step){
 const variable=mode==='adaptive-regrid'||mode==='dense-adaptive-switch';
 const release=variable?5:4;
 return {release:step>=release,budget:mode==='adaptive-regrid'&&step===3?.125:0,
  adaptive:mode==='dense-adaptive-switch'?step===2||step===3:mode!=='dense',
  heat:step<3?2:1};
}
export function validateHandoffEvidence(raw){
 const demand=(ok,message)=>{if(!ok)throw Error(message);};
 const f=handoffFixture(),length=f.plan.materialCells*8,volume=8*(f.dims[1]/f.dims[0])*f.transform.scale**3;
 const supply=depositWorldSources(f.sources.parcels,{dims:f.plan.materialDims,min:f.plan.min,pitch:f.plan.materialPitch});
 const supplyHeat=f.sources.parcels.reduce((v,p)=>v+p.rate*p.heat*p.lo.reduce((s,x,a)=>s*(p.hi[a]-x),1),0);
 demand(raw.adapter?.vendor==='apple'&&raw.adapter?.fallback===false,'Native Apple route required');
 demand(Array.isArray(raw.errors)&&raw.errors.length===0,'GPU errors or missing evidence');
 demand(raw.cases?.length===modes.length,'Both material routes required');
 for(const [i,c] of raw.cases.entries()){
  demand(c.mode===modes[i],'Wrong or duplicate material route');
  demand(c.frames?.length===(i<2?5:7),'Initial, repeated, supplied, removed and released frames required');
  for(const [j,frame] of c.frames.entries()){
   const values=frame.values,receipt=frame.receipt,stage=stageFor(c.mode,j);
   const expectedMapping=stage.release?[2,0,2,.2]:[.25,0,.25,.2];
   demand(JSON.stringify(receipt?.fineToField)===JSON.stringify(expectedMapping),'Wrong effective Fine transform');
   demand(receipt?.steps===j+1&&receipt.materialLaw==='passive-authored','Wrong step or combustion law');
   demand(JSON.stringify(receipt.materialDims)===JSON.stringify(f.plan.materialDims),'Wrong material dimensions');
   demand((receipt.adaptiveMaterial!=null)===stage.adaptive,'Wrong material route');
   if(stage.adaptive){demand(receipt.adaptiveMaterial.options.budget===stage.budget,'Wrong allocation budget');
    demand(!receipt.adaptiveMaterial.error,'Adaptive route reported an error');
    if(stage.budget>0)demand(receipt.adaptiveMaterial.allocatedBricks>128,'Refinement did not execute');}
   demand(Array.isArray(values)&&values.length===length&&values.every(Number.isFinite),'Complete finite gas required');
   const totals=[0,0,0];for(let k=0;k<values.length;k+=8)for(let a=0;a<3;a++)totals[a]+=values[k+a]*f.plan.materialPitch**3;
   const expected=[f.fineGas[0],stage.heat,f.fineGas[2]].map(x=>x*volume);if(j>=2){expected[1]+=supplyHeat;expected[2]+=supplyHeat*.5/1.2;}
   for(let a=0;a<3;a++)demand(Math.abs(totals[a]-expected[a])<expected[a]*2e-5,`${c.mode} frame ${j} channel ${a}: ${totals[a]} vs ${expected[a]}`);
   // Uniform Fine data gives an independent per-receiver volume oracle. Total
   // conservation alone would accept placing the gas in the wrong cells.
   const [nx,ny,nz]=f.plan.materialDims,pitch=f.plan.materialPitch;
   for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const q=[x,y,z],lo=q.map((v,a)=>f.plan.min[a]+v*pitch),k=(x+nx*(y+ny*z))*8;
    const fineLo=f.transform.translate.map(v=>v-f.transform.scale);
    const fineHi=f.transform.translate.map((v,a)=>v+(a===1?3:1)*f.transform.scale);
    const fraction=lo.reduce((v,l,a)=>v*Math.max(0,Math.min(l+pitch,fineHi[a])-Math.max(l,fineLo[a]))/pitch,1);
    const expectedCell=[fraction*.25,fraction*stage.heat,fraction*.125];
    if(j>=2){expectedCell[1]+=supply[k+2];expectedCell[2]+=supply[k+1];}
    for(let a=0;a<3;a++)demand(Math.abs(values[k+a]-expectedCell[a])<2e-6,`Wrong receiving cell ${k/8}, channel ${a}`);
   }

  }
 }
 return {fineVolume:volume,fineHeat:f.fineGas[1]*volume,exteriorHeat:supplyHeat};
}
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();
 if(!adapter||(adapter.info.isFallbackAdapter??adapter.isFallbackAdapter)||adapter.info.vendor!=='apple')throw Error('Native Apple WebGPU required');
 const device=await adapter.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:8}});
 const errors=[],owned=[],f=handoffFixture();
 const result={adapter:{vendor:adapter.info.vendor,fallback:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter},errors,cases:[]};
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');
 try{
  const data=new Float32Array(f.dims.reduce((a,b)=>a*b,1)*16);
  for(let i=0;i<data.length;i+=16)data.set(f.fineGas,i+4);
  const fine=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const reaction=device.createTexture({size:f.dims,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING});owned.push(fine,reaction);
  for(const mode of modes){
   device.queue.writeBuffer(fine,0,data);
   const world=createWorldSmoke(device,f.plan,f.anchor);owned.push(world);
   if(stageFor(mode,0).adaptive)world.configureAdaptiveMaterial({budget:0,maxDetail:1});
   const c={mode,frames:[]};result.cases.push(c);
   for(let step=0;step<(modes.indexOf(mode)<2?5:7);step++){
    const stage=stageFor(mode,step);
    if(mode==='adaptive-regrid')world.configureAdaptiveMaterial({budget:stage.budget,maxDetail:1});
    if(mode==='dense-adaptive-switch'&&(step===2||step===4))world.configureAdaptiveMaterial(step===2?{budget:0,maxDetail:1}:null);
    const current=data.slice();for(let i=0;i<current.length;i+=16)current[i+5]=stage.heat;
    device.queue.writeBuffer(fine,0,stage.release?new Float32Array(data.length):current);
    // Moving an empty Fine region away must leave its former gas in World.

    const encoder=device.createCommandEncoder();
    const receipt=world.encode(encoder,{fineBuffer:fine,reactionTexture:reaction,fineDims:f.dims,
     transform:stage.release?{translate:[2,0,2],scale:.2}:f.transform,
     time:{dtScale:0,backtraceScale:1},iterations:0,buoyancy:0,sources:step===2?f.sources:{count:0,parcels:[],supports:[]}});
    const r=world.materialResources(),buffer=r.buffers[r.index],size=f.plan.materialCells*32;
    const copy=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    encoder.copyBufferToBuffer(buffer,0,copy,0,size);device.queue.submit([encoder.finish()]);
    try{await copy.mapAsync(GPUMapMode.READ);c.frames.push({receipt,values:Array.from(new Float32Array(copy.getMappedRange()))});}finally{copy.destroy();}
   }
  }
  const validation=await device.popErrorScope();if(validation)errors.push(validation.message);
  result.summary=validateHandoffEvidence(result);return result;
 }catch(error){return {...result,failed:true,error:error.stack};}
 finally{for(const x of owned)x.destroy();device.destroy();}
}
