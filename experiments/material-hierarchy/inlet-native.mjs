import {createGPUStochasticSignalSet} from '../../volume-inlet-perturbation-gpu.mjs';
import {StochasticSignalSet} from '../../volume-inlet-perturbation.mjs';
export async function run(){
 const adapter=await navigator.gpu.requestAdapter();if(adapter?.info.vendor!=='apple'||adapter.isFallbackAdapter)throw Error('Native Apple GPU required');const device=await adapter.requestDevice(),errors=[],result={adapter:{vendor:adapter.info.vendor},cases:[],errors};device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');let scopeOpen=true,gpu;
 try{
  for(const count of [1,25,81]){
   gpu=createGPUStochasticSignalSet(device,{seed:7921,count});const cpu=new StochasticSignalSet(7921,count);
   for(const [step,tau]of [[0,30],[1,30],[2,30],[7,30],[7,3],[3,3],[20,3],[240,30]]){
    const encoder=device.createCommandEncoder();gpu.encode(encoder,step,tau);const copy=device.createBuffer({size:gpu.buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(gpu.buffer,0,copy,0,copy.size);device.queue.submit([encoder.finish()]);let actual;try{await copy.mapAsync(GPUMapMode.READ);const state=new Float32Array(copy.getMappedRange());actual=Array.from({length:count},(_,i)=>Math.max(-1,Math.min(1,state[i*4])));}finally{copy.destroy();}
    const expected=Array.from(cpu.sampleAt(step,tau)),maximum=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])));result.cases.push({count,seed:7921,step,tau,actual,expected,maximum});if(!Number.isFinite(maximum)||maximum>1e-6)throw Error('Seeded GPU inlet differs from the original OU streams');
   }gpu.destroy();gpu=null;
  }
  gpu=createGPUStochasticSignalSet(device,{seed:2,count:1});const cpuBatch=new StochasticSignalSet(2,1),encoder=device.createCommandEncoder(),copies=[];
  for(const [step,tau]of [[1,30],[3,3]]){gpu.encode(encoder,step,tau);const copy=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(gpu.buffer,0,copy,0,16);copies.push({copy,step,tau,expected:Array.from(cpuBatch.sampleAt(step,tau))});}
  device.queue.submit([encoder.finish()]);for(const {copy,step,tau,expected}of copies){try{await copy.mapAsync(GPUMapMode.READ);const actual=[Math.max(-1,Math.min(1,new Float32Array(copy.getMappedRange())[0]))],maximum=Math.abs(actual[0]-expected[0]);result.cases.push({count:1,seed:2,step,tau,batch:true,actual,expected,maximum});if(maximum>1e-6)throw Error('Queued inlet steps overwrote one another');}finally{copy.destroy();}}gpu.destroy();gpu=null;
  const error=await device.popErrorScope();scopeOpen=false;if(error)errors.push(error.message);if(errors.length)throw Error(errors.join('\n'));return result;
 }catch(e){if(scopeOpen){const error=await device.popErrorScope();if(error)errors.push(error.message);}return{...result,failed:true,error:e.stack};}finally{gpu?.destroy();device.destroy();}
}
