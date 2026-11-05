import {createGPUStochasticSignalSet} from '../../volume-inlet-perturbation-gpu.mjs';
import {StochasticSignalSet} from '../../volume-inlet-perturbation.mjs';
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();if(adapter?.info.vendor!=='apple'||adapter.isFallbackAdapter)throw Error('Native Apple GPU required');const device=await adapter.requestDevice(),errors=[],result={adapter:{vendor:adapter.info.vendor},cases:[],errors};device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');let scopeOpen=true,gpu;
 try{
  for(const count of [1,25,81]){
   gpu=createGPUStochasticSignalSet(device,{seed:7921,count});const cpu=new StochasticSignalSet(7921,count);
   for(const [step,tau]of [[0,30],[1,30],[2,30],[7,30],[7,3],[3,3],[20,3],[240,30]]){
    const encoder=device.createCommandEncoder();gpu.encode(encoder,step,tau);const copy=device.createBuffer({size:gpu.buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(gpu.buffer,0,copy,0,copy.size);device.queue.submit([encoder.finish()]);let actual;try{await copy.mapAsync(GPUMapMode.READ);const state=new Float32Array(copy.getMappedRange());actual=Array.from({length:count},(_,i)=>Math.max(-1,Math.min(1,state[i*4])));}finally{copy.destroy();}
    const expected=Array.from(cpu.sampleAt(step,tau)),maximum=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));result.cases.push({count,seed:7921,step,tau,actual,expected,maximum});if(!Number.isFinite(maximum)||maximum>1e-5)throw Error('Seeded GPU inlet differs from the original OU streams');
   }gpu.destroy();gpu=null;
  }
  const error=await device.popErrorScope();scopeOpen=false;if(error)errors.push(error.message);if(errors.length)throw Error(errors.join('\n'));return result;
 }catch(e){if(scopeOpen){const error=await device.popErrorScope();if(error)errors.push(error.message);}return{...result,failed:true,error:e.stack};}finally{gpu?.destroy();device.destroy();}
}
