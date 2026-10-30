import {DISPLAY_AXIS_WGSL, interpolatingSplineCoefficients, sampleDisplayLine} from '../volume-display-reconstruction.mjs';

export function verifyDisplayAxisValues(actual,expected) {
  if(!expected.length||actual.length!==expected.length)throw Error('Missing display-axis output');
  let maxError=0;
  for(let i=0;i<expected.length;i++) {
    const error=Math.abs(actual[i]-expected[i]);
    if(!Number.isFinite(actual[i])||!Number.isFinite(expected[i])||error>2e-5*Math.max(1,Math.abs(expected[i])))
      throw Error(`Display-axis mismatch at ${i}: ${actual[i]} versus ${expected[i]}`);
    maxError=Math.max(maxError,error);
  }
  return maxError;
}

// Runs only in the offline native witness, never the renderer or operator page.
export async function checkDisplayAxes() {
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter||adapter.info.vendor!=='apple')throw Error('Native Apple WebGPU required for display-axis conformance');
  const device=await adapter.requestDevice(), results=[];
  const index=(p,d)=>p[0]+d[0]*(p[1]+d[1]*p[2]);
  try {
    device.pushErrorScope('validation');
    const module=device.createShaderModule({code:DISPLAY_AXIS_WGSL});
    const compilation=await module.getCompilationInfo();
    if(compilation.messages.some(m=>m.type==='error'))throw Error(compilation.messages.map(m=>m.message).join('\n'));
    for(const axis of [0,1,2])for(const kinds of [['monotone','positive'],['interpolating','monotone'],['monotone','interpolating']]) {
      const src=[4,3,2],dst=[...src];dst[axis]=(src[axis]-1)*4+1;
      const source=new Float32Array(src.reduce((a,b)=>a*b,4));
      for(let z=0;z<src[2];z++)for(let y=0;y<src[1];y++)for(let x=0;x<src[0];x++) {
        const i=index([x,y,z],src)*4;
        source.set([[0,1,3,0][x]*(1+y)+z,2*x-y+z,[2,0,1,5][x]+y*z,4-x+y-2*z],i);
      }
      const coefficients=new Float32Array(source.length),expected=new Float32Array(dst.reduce((a,b)=>a*b,4));
      for(let z=0;z<dst[2];z++)for(let y=0;y<dst[1];y++)for(let x=0;x<dst[0];x++) {
        const p=[x,y,z],q=p[axis]/4;
        for(let channel=0;channel<4;channel++) {
          const line=Array.from({length:src[axis]},(_,j)=>{const s=[...p];s[axis]=j;return source[index(s,src)*4+channel];});
          const c=interpolatingSplineCoefficients(line);
          for(let j=0;j<c.length;j++){const s=[...p];s[axis]=j;coefficients[index(s,src)*4+channel]=c[j];}
          expected[index(p,dst)*4+channel]=sampleDisplayLine(line,c,q,kinds[channel===3?1:0],channel===3?.5:1);
        }
      }
      const input=device.createTexture({size:src,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      const output=device.createTexture({size:dst,dimension:'3d',format:'rgba32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
      const options=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const coef=device.createBuffer({size:coefficients.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      const bytesPerRow=Math.ceil(dst[0]*16/256)*256;
      const readback=device.createBuffer({size:bytesPerRow*dst[1]*dst[2],usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      try {
        device.queue.writeTexture({texture:input},source,{bytesPerRow:src[0]*16,rowsPerImage:src[1]},src);
        device.queue.writeBuffer(coef,0,coefficients);
        device.queue.writeBuffer(options,0,new Float32Array([1,.5,1,4,...kinds.map(k=>['positive','interpolating','monotone'].indexOf(k)),0,0]));
        const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'filterDisplayAxis',constants:{DISPLAY_AXIS:axis}}});
        const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[
          {binding:0,resource:input.createView()},{binding:1,resource:output.createView()},
          {binding:2,resource:{buffer:options}},{binding:3,resource:{buffer:coef}}]});
        const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
        pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(...dst.map(n=>Math.ceil(n/4)));pass.end();
        encoder.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow,rowsPerImage:dst[1]},dst);
        device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
        const mapped=new Float32Array(readback.getMappedRange()),actual=[];
        for(let row=0;row<dst[1]*dst[2];row++)actual.push(...mapped.subarray(row*bytesPerRow/4,row*bytesPerRow/4+dst[0]*4));
        const maxError=verifyDisplayAxisValues(actual,expected);
        results.push({axis,kinds,src,dst,source:[...source],actual,expected:[...expected],maxError});
      }finally {readback.destroy();coef.destroy();options.destroy();output.destroy();input.destroy();}
    }
    const error=await device.popErrorScope();if(error)throw Error(error.message);
    return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},results};
  }finally {device.destroy();}
}
