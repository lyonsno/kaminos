import { withGreenroomLease } from '../../greenroom-lease.mjs';
import { Qwen35TextModel } from './text-model.js';
import { QwenTokenizer } from '../flux2-klein/qwen-tokenizer.js';
import { createWebGpuInferenceControl } from '../../webgpu-inference-kit/src/inference-control.js';
import { createQwenTextChat } from './pup-text.js';

// Standalone model example owns its device. Embedding apps instead pass their
// loaded adapter/control directly to createQwenTextChat.
export async function loadChatExample({ manifestUrl, manifestSha256, modelUrl, systemPrompt, onProgress, signal } = {}) {
  let device, control, model, chat;
  const errors = [];
  const dispose = async () => {
    const failures=[];
    for (const work of [()=>chat?.dispose(),()=>model?.destroy(),()=>control?.close()]) {
      try { await work(); } catch(e) { failures.push(e); }
    }
    device?.destroy(); if(failures.length) throw new AggregateError(failures,'chat cleanup failed');
  };
  try {
    const response=await fetch(manifestUrl,{signal}); if(!response.ok) throw Error('Model manifest unavailable');
    const bytes=await response.arrayBuffer();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(digest!==manifestSha256) throw Error('Model manifest identity mismatch');
    const manifest=JSON.parse(new TextDecoder().decode(bytes));
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    if(!adapter) throw Error('WebGPU unavailable');
    device=await adapter.requestDevice();
    device.addEventListener('uncapturederror',e=>errors.push(String(e.error?.message??e.error)));
    device.lost.then(info=>{if(info.reason!=='destroyed') errors.push(`device lost: ${info.message}`);});
    control=createWebGpuInferenceControl({queue:device.queue});
    model=new Qwen35TextModel(device,manifest,{control,singleTokenKernel:'quad',batchDecode:true,decodeAttention:'single-query'});
    const started=performance.now(); await model.load(modelUrl,{signal,onProgress});
    const tokenizerResponse=await fetch(new URL('tokenizer.json',modelUrl),{signal});
    if(!tokenizerResponse.ok) throw Error('Tokenizer unavailable');
    const tokenizer=new QwenTokenizer(await tokenizerResponse.json());
    // Actual model/device addressing limit, not an extra application context cap.
    const capacity=Math.min(model.config.maxPositions,Math.floor(model.bindingBytes/(model.config.kvHeads*model.config.headDim*4)));
    chat=createQwenTextChat({model,tokenizer,capacity,control,systemPrompt});
    return {chat,model,control,dispose,errors,identity:{backend:'webgpu',manifestSha256:digest,
      source:manifest.source,adapter:Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter'].map(k=>[k,adapter[k]??adapter.info?.[k]??null])),
      singleTokenKernel:model.singleTokenKernel,decodeAttention:model.decodeAttention,batchDecode:model.batchDecode,
      capacity,loadMs:performance.now()-started}};
  } catch(e) { try { await dispose(); } catch(cleanup) { throw new AggregateError([e,cleanup],'chat load and cleanup failed'); } throw e; }
}

// Reuse Kaminos page admission. Idle weights/cache retain no execution lease.
export async function withChatAdmission({post,runId=crypto.randomUUID(),signal=null,onWait=()=>{},onAdmitted=()=>{},unsettledWork=async()=>[]}={},work) {
  let admittedLease;
  try { const result=await withGreenroomLease({post,runId,route:'qwen35.text-chat.webgpu.v0',admission:'queue',signal,onWait,unsettledWork,
    sleep:(ms,signal)=>new Promise((resolve,reject)=>{
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const timer=setTimeout(()=>{cleanup();resolve();},ms);
      const abort=()=>{clearTimeout(timer);cleanup();reject(Object.assign(Error('GPU wait stopped'),{name:'AbortError'}));};
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    })},async lease=>{admittedLease=lease;onAdmitted(lease);return work(lease);});
  if(result.lease.releaseError||result.lease.state==='kept-blocking'||result.lease.renewError)
    throw Object.assign(Error('Chat GPU handback failed: '+(result.lease.releaseError??result.lease.renewError)),result);
  return result;
  }catch(error){
    if(admittedLease&&!error.lease){
      error.lease={...admittedLease,...(error.greenroomHandback??{state:admittedLease.status==='held'?'released':'unconfigured'})};
    }
    throw error;
  }
}
