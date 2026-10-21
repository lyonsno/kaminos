import * as THREE from '../lib/three.webgpu.js';
import {FIRE_SMOKE_FILTER_WGSL,filterSmokeDirectionReference} from '../fire-smoke-shadow.mjs';

// Run the production filter against an independently indexed CPU reference.
// Two lights, two packed radial groups, face seams and dissimilar channels
// expose atlas/light/depth cross-talk. Caller retains report and owns device.
export async function checkFireSmokeFilterGpu(device){
  const r=4,count=2,groups=2,width=r*6*count,height=r*groups,row=width*8;
  const input=device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const output=device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
  const params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const stride=Math.ceil(row/256)*256;
  const result=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
    device.queue.writeBuffer(params,0,new Uint32Array([r,8,count,groups]));
    const values=new Uint16Array(width*height*4),reference=[];
    const at=(light,group,face,x,y,c)=>(((group*r+y)*width+(light*6+face)*r+x)*4+c);
    for(let light=0;light<count;light++)for(let group=0;group<groups;group++)for(let face=0;face<6;face++)for(let y=0;y<r;y++)for(let x=0;x<r;x++)for(let c=0;c<4;c++){
      const tau=c===0?0:c===1?.0001:c===2?65504:(light+1)*(group+1)*((face+x+y)%3);
      values[at(light,group,face,x,y,c)]=THREE.DataUtils.toHalfFloat(tau);
    }
    device.queue.writeTexture({texture:input},values,{bytesPerRow:row},[width,height]);
    const module=device.createShaderModule({code:FIRE_SMOKE_FILTER_WGSL});
    const info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(JSON.stringify(info.messages));
    const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'filterDirections'}});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:input.createView()},{binding:1,resource:output.createView()},{binding:2,resource:{buffer:params}}]});
    const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
    pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1,1,count*6*groups);pass.end();
    encoder.copyTextureToBuffer({texture:output},{buffer:result,bytesPerRow:stride},[width,height]);device.queue.submit([encoder.finish()]);
    await result.mapAsync(GPUMapMode.READ);const actual=new Uint16Array(result.getMappedRange());
    let maxError=0;
    for(let light=0;light<count;light++)for(let group=0;group<groups;group++)for(let face=0;face<6;face++)for(let y=0;y<r;y++)for(let x=0;x<r;x++)for(let c=0;c<4;c++){
      const expected=filterSmokeDirectionReference({face,x,y,resolution:r,read:(f,a,b)=>THREE.DataUtils.fromHalfFloat(values[at(light,group,f,a,b,c)])});
      const observed=THREE.DataUtils.fromHalfFloat(actual[(group*r+y)*stride/2+((light*6+face)*r+x)*4+c]);
      const error=Math.abs(expected-observed);maxError=Math.max(maxError,error);
      reference.push({light,group,face,x,y,c,expected,observed});
      if(!Number.isFinite(observed)||error>.004)throw Error(`smoke direction filter mismatch ${JSON.stringify(reference.at(-1))}`);
    }
    result.unmap();return {identity:'production-smoke-direction-filter-v1',maxError,rows:reference};
  }finally{input.destroy();output.destroy();params.destroy();result.destroy();}
}
