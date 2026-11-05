import {createGPUWorldSourceAtlas,depositWorldSources} from '../../volume-world-sources.mjs';
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();if(adapter?.info.vendor!=='apple'||adapter.isFallbackAdapter)throw Error('Native Apple GPU required');
 const device=await adapter.requestDevice(),errors=[],owned=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');let scopeOpen=true;
 const result={adapter:{vendor:adapter.info.vendor},cases:[],errors};let atlas;
 try{
  const grid={dims:[8,4,4],min:[-2,-1,0],pitch:.5},cells=128;
  atlas=createGPUWorldSourceAtlas(device,grid,'native source conformance');
  const module=device.createShaderModule({code:`@group(0) @binding(0) var t:texture_2d<f32>;@group(0) @binding(1) var<storage,read_write> out:array<vec4<f32>>;
   @compute @workgroup_size(64) fn read(@builtin(global_invocation_id) g:vec3<u32>){if(g.x>=arrayLength(&out)){return;}let d=textureDimensions(t);var v=vec4<f32>(0);if(g.x<d.x*d.y){v=textureLoad(t,vec2<i32>(i32(g.x%d.x),i32(g.x/d.x)),0);}out[g.x]=v;}`}),pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'read'}});
  const p={lo:[-1.85,-.72,.13],hi:[-.63,.65,.91],rate:.37,fuel:.23,heat:.81,relax:.17,velocity:[.2,-.4,.1]};
  for(const parcels of [[p],[{...p,heat:.4},{...p,lo:[-.9,-.1,.4],hi:[.3,.8,1.8],rate:.11}],[],[p]]){
   const encoder=device.createCommandEncoder(),view=atlas.encode(encoder,parcels),buffer=device.createBuffer({size:cells*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),copy=device.createBuffer({size:cells*32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});owned.push(buffer,copy);
   const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:view},{binding:1,resource:{buffer}}]}));pass.dispatchWorkgroups(cells*2/64);pass.end();encoder.copyBufferToBuffer(buffer,0,copy,0,buffer.size);device.queue.submit([encoder.finish()]);await copy.mapAsync(GPUMapMode.READ);const actual=Array.from(new Float32Array(copy.getMappedRange()));copy.unmap();
   const expected=Array.from(depositWorldSources(parcels,grid)),maximum=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));result.cases.push({grid,parcels,actual,expected,maximum});if(!Number.isFinite(maximum)||maximum>1e-6)throw Error('GPU source deposition differs from finite-volume reference');
  }
  const error=await device.popErrorScope();scopeOpen=false;if(error)errors.push(error.message);if(errors.length)throw Error(errors.join('\n'));return result;
 }catch(e){if(scopeOpen){const x=await device.popErrorScope();if(x)errors.push(x.message);}return{...result,failed:true,error:e.stack};}finally{atlas?.destroy();for(const b of owned)b.destroy();device.destroy();}
}
