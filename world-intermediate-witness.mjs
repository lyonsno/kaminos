// Tiny native transport comparison of a resolved lateral donor jet against
// the same coarser far field without the intermediate envelope.
export async function probeIntermediateFlow(){
  const {createWorldSmoke,worldSmokePlan,intermediateFlowPlan}=await import('./volume-world-smoke.mjs');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('Native WebGPU adapter unavailable');
  const device=await adapter.requestDevice(),errors=[],cases=[];
  device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  try{
    for(const enabled of [false,true]){
      const plan=worldSmokePlan({flow:4,material:16,extent:3,fineHeightRatio:1});
      const transform={translate:[0,0,0],scale:1},far=createWorldSmoke(device,plan,transform);
      const middle=enabled?createWorldSmoke(device,intermediateFlowPlan(plan,[16,16,16]),transform,{borrowMaterial:far.materialResources()}):null;
      const fine=device.createBuffer({size:16**3*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const values=new Float32Array(16**3*16);
      for(let i=0;i<16**3;i++){values[i*16]=4;values[i*16+4]=1;}
      device.queue.writeBuffer(fine,0,values);
      const reaction=device.createTexture({size:[16,16,16],dimension:'3d',format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING});
      const input={fineBuffer:fine,reactionTexture:reaction,fineDims:[16,16,16],fineVelocityMode:'staggered',transform,time:{dtScale:1,backtraceScale:.25},iterations:16,buoyancy:0};
      for(let step=0;step<24;step++){
        const encoder=device.createCommandEncoder();
        middle?.encode(encoder,{...input,materialIndex:far.materialResources().index});
        far.encode(encoder,{...input,intermediate:middle});
        device.queue.submit([encoder.finish()]);
      }
      const size=plan.materialCells*16,read=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
      const encoder=device.createCommandEncoder();
      encoder.copyTextureToBuffer({texture:far.optical},{buffer:read,bytesPerRow:256,rowsPerImage:plan.materialDims[1]},plan.materialDims);
      device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      const data=new Float32Array(read.getMappedRange());let lateralSoot=0,finite=true;
      for(let z=0;z<16;z++)for(let y=0;y<32;y++)for(let x=0;x<16;x++){
        const i=4*(x+16*(y+32*z));for(let k=0;k<4;k++)finite&&=Number.isFinite(data[i+k]);
        if(-3+(x+.5)*plan.materialPitch>1)lateralSoot+=data[i];
      }
      cases.push({enabled,lateralSoot,finite,flowDims:plan.flowDims,materialDims:plan.materialDims,intermediateDims:middle?.plan.flowDims??null,extraMaterialCells:0});
      read.unmap();read.destroy();middle?.destroy();
      // Exercise continued far-field ownership after its borrower is retired.
      const after=device.createCommandEncoder();far.encode(after,input);device.queue.submit([after.finish()]);await device.queue.onSubmittedWorkDone();
      far.destroy();fine.destroy();reaction.destroy();
    }
    return {cases,errors,passed:errors.length===0&&cases.every(c=>c.finite)&&cases[1].lateralSoot>cases[0].lateralSoot};
  }finally{device.destroy();}
}
