// GPU-resident BFL low-rank delta over the positively identified base Qwen.
import {fetchTensor} from './model-source.js';
import {gemmShader} from '../flux2-klein/klein-kernels.js';
const shapeEqual=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const offsetNorm=name=>/\.(input_layernorm|post_attention_layernorm|q_norm|k_norm)\.weight$/.test(name)||name==='model.norm.weight';
function roundedBf16(value){const f=new Float32Array([value]),u=new Uint32Array(f.buffer);u[0]=(u[0]+0x7fff+((u[0]>>>16)&1))&0xffff0000;return f[0];}
export function deltaLayout(manifest,model){
 if(manifest?.schema!=='kaminos.qwen35-delta.v1'||manifest.complete!==true)throw Error('complete native delta adapter required');
 if(model.manifest.source?.baseRole!=='qwen'||model.manifest.source?.sourceRevision!==manifest.qwenRevision||manifest.baseConfigSha256!==model.manifest.source.configSha256)throw Error('delta adapter requires its identified base Qwen weights');
 if(!Number.isSafeInteger(manifest.maxRank)||manifest.maxRank<1)throw Error('invalid adapter rank');
 const expected=new Set([...model.layout.projections.keys(),...model.layout.vectors.keys()]);
 for(const name of model.layout.projections.keys()){
  const e=model.layout.projections.get(name),r=manifest.projections?.[name],x=manifest.exact?.[name+'.weight'];
  if(r&&x)throw Error('ambiguous delta target '+name);
  if(r){if(!shapeEqual(r.a.shape,[manifest.maxRank,e.columns])||!shapeEqual(r.b.shape,[e.rows,manifest.maxRank]))throw Error('incompatible delta projection '+name);expected.delete(name);}
  else if(x&&shapeEqual(x.shape,[e.rows,e.columns]))expected.delete(name);
 }
 for(const [name,row]of model.layout.vectors){const x=manifest.exact?.[name];if(!x||x.shape.reduce((a,b)=>a*b,1)!==row.shape.reduce((a,b)=>a*b,1))throw Error('missing delta vector '+name);expected.delete(name);}
 if(expected.size)throw Error('missing delta targets: '+[...expected].join(', '));
 const allowed=new Set([...model.layout.vectors.keys(),...[...model.layout.projections.keys()].map(n=>n+'.weight')]);
 if(Object.keys(manifest.exact).some(n=>!allowed.has(n))||Object.keys(manifest.projections).some(n=>!model.layout.projections.has(n)))throw Error('unknown delta target');
 return manifest;
}
function parts(rows,width,limit){const n=Math.floor(limit/(width*4));if(!n)throw Error('delta row exceeds binding capacity');const out=[];for(let i=0;i<rows;i+=n)out.push({rowStart:i,rows:Math.min(n,rows-i)});return out;}
export async function loadDelta(model,manifest,baseUrl,{fetchImpl=fetch,signal,onProgress}={}){
 if(model.closed||!model.loaded||model.loading||model.active||model.delta)throw Error('model cannot load adapter in its current state');
 deltaLayout(manifest,model);
 model.loading=true;model.loadingDone=new Promise(r=>model.finishLoading=r);
 signal=AbortSignal.any([model.lifetime.signal,...(signal?[signal]:[])]);
 const owned=new Set(),projections=new Map(),exact=new Map(),enabledVectors=new Map(model.vectors);
 const get=row=>fetchTensor(baseUrl,row,{fetchImpl,signal});
 const upload=data=>model.upload(data,owned);
 const duty=work=>model.control.runDuty(async()=>{if(signal.aborted)throw Object.assign(Error('adapter load aborted'),{name:'AbortError'});await work();await model.device.queue.onSubmittedWorkDone();});
 try{
  let completed=0;const total=Object.keys(manifest.projections).length+Object.keys(manifest.exact).length;
  for(const [name,row]of Object.entries(manifest.projections)){
   const a=await get(row.a),b=await get(row.b),slices=[];
   await duty(async()=>{for(const p of parts(row.b.shape[0],manifest.maxRank,model.bindingBytes))slices.push({...p,weight:upload(b.subarray(p.rowStart*manifest.maxRank,(p.rowStart+p.rows)*manifest.maxRank))});projections.set(name,{a:upload(a),slices});});onProgress?.({name,completed:++completed,total});
  }
  for(const [name,row]of Object.entries(manifest.exact)){
   let data=await get(row);
   // Source RMSNorm offsets are sanitized and rounded exactly as MLX conversion.
   if(offsetNorm(name))data=Float32Array.from(data,x=>roundedBf16(x+1));
   await duty(async()=>{const buffer=upload(data);if(model.layout.vectors.has(name))enabledVectors.set(name,buffer);else exact.set(name.slice(0,-7),buffer);});onProgress?.({name,completed:++completed,total});
  }
  for(const [i,type]of model.config.layers.entries()){
   const root=`model.layers.${i}.${type==='linear_attention'?'linear_attn':'self_attn'}`,names=type==='linear_attention'?['A_log','dt_bias']:['q_norm.weight','k_norm.weight'];
   const data=[];for(const n of names){let v=await get(manifest.exact[root+'.'+n]);if(offsetNorm(root+'.'+n))v=Float32Array.from(v,x=>roundedBf16(x+1));data.push(v);}
   const joined=new Float32Array(data[0].length+data[1].length);joined.set(data[0]);joined.set(data[1],data[0].length);await duty(async()=>enabledVectors.set(root+'.joined',upload(joined)));
  }
  if(signal.aborted)throw Object.assign(Error('adapter load aborted'),{name:'AbortError'});
  model.delta={manifest,maxRank:manifest.maxRank,rank:manifest.maxRank,enabled:false,owned,projections,exact,baseVectors:model.vectors,enabledVectors};for(const b of owned)model.owned.add(b);
 }catch(e){await model.device.queue.onSubmittedWorkDone().catch(()=>{});for(const b of owned)b.destroy();throw e;}
 finally{model.loading=false;model.finishLoading();}
}
export async function setDeltaMode(model,{enabled,rank=model.delta?.rank}={}){
 if(model.closed||model.active||model.loading||model.switchingDelta)throw Error('cannot switch adapter during active model work');
 if(typeof enabled!=='boolean')throw Error('adapter enabled must be boolean');if(!model.delta)throw Error('no delta adapter loaded');
 if(!Number.isSafeInteger(rank)||rank<1||rank>model.delta.maxRank)throw Error('adapter rank outside extracted capacity');
 if(model.delta.enabled===enabled&&(!enabled||model.delta.rank===rank)){model.delta.rank=rank;return {enabled,rank,reset:false};}
 model.switchingDelta=true;
 try{for(const state of [...model.states])await model.disposeState(state);model.delta.enabled=enabled;model.delta.rank=rank;model.vectors=enabled?model.delta.enabledVectors:model.delta.baseVectors;return {enabled,rank,reset:true};}
 finally{model.switchingDelta=false;}
}
export async function dense(model,input,weight,output,{tokens,rows,columns,weightStride=columns,inputStride=columns,inputOffset=0,outputStride=rows,outputOffset=0,add=false},ctx){
 const p=new Uint32Array([tokens,rows,columns,0x3f800000,inputOffset,inputStride,0,0,weightStride,0,outputOffset,outputStride,0,0,0,0]);
 await model.dispatch(add?'delta-gemm-add':'delta-gemm',()=>gemmShader({bType:'f32',epilogue:add?'add':'store'}),[input,weight,output],p,[Math.ceil(rows/64),Math.ceil(tokens/64),1],ctx);
}
export async function deltaLinear(model,name,input,output,tokens,ctx,options={}){
 const d=model.delta;if(!d?.enabled)return false;const entry=model.weights.get(name),o={outputStride:entry.rows,outputOffset:0,inputOffset:0,...options};
 if(d.exact.has(name)){await dense(model,input,d.exact.get(name),output,{tokens,rows:entry.rows,columns:entry.columns,...o},ctx);return true;}
 return false;
}
export async function addDeltaLinear(model,name,input,output,tokens,ctx,options={}){
 const d=model.delta;if(!d?.enabled)return;const row=d.projections.get(name);if(!row)return;
 const e=model.weights.get(name),o={outputStride:e.rows,outputOffset:0,inputOffset:0,...options};
 await dense(model,input,row.a,ctx.deltaScratch,{tokens,rows:d.rank,columns:e.columns,inputOffset:o.inputOffset,outputStride:d.maxRank},ctx);
 for(const p of row.slices)await dense(model,ctx.deltaScratch,p.weight,output,{tokens,rows:p.rows,columns:d.rank,inputStride:d.maxRank,weightStride:d.maxRank,outputStride:o.outputStride,outputOffset:o.outputOffset+p.rowStart,add:true},ctx);
}
export const deltaEmbeddingShader=()=>`struct P{tokens:u32,dim:u32,start:u32,rows:u32,rank:u32,stride:u32,z0:u32,z1:u32};
@group(0) @binding(0)var<storage,read>ids:array<u32>;
@group(0) @binding(1)var<storage,read>b:array<f32>;
@group(0) @binding(2)var<storage,read>a:array<f32>;
@group(0) @binding(3)var<storage,read_write>output:array<f32>;
@group(0) @binding(4)var<uniform>p:P;
@compute @workgroup_size(256)fn main(@builtin(global_invocation_id)g:vec3<u32>){let d=g.x;let t=g.y;if(d>=p.dim||t>=p.tokens){return;}let id=ids[t];if(id<p.start||id>=p.start+p.rows){return;}var v=0.0;for(var r=0u;r<p.rank;r++){v=fma(b[(id-p.start)*p.stride+r],a[r*p.dim+d],v);}output[t*p.dim+d]+=v;}`;
