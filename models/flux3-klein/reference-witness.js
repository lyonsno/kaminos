import {Flux3VaeEncoder} from './flux3-vae-encoder.js';
import {Flux3Transformer} from './flux3-transformer.js';
export function compareReferenceValues(got,expected,tolerance){
 if(!got?.length||got.length!==expected?.length)throw Error('Missing or mismatched reference tensor');
 let error=0,norm=0,maxAbs=0;
 for(let i=0;i<got.length;i++){if(!Number.isFinite(got[i])||!Number.isFinite(expected[i]))throw Error('Nonfinite reference result');const d=got[i]-expected[i];error+=d*d;norm+=expected[i]*expected[i];maxAbs=Math.max(maxAbs,Math.abs(d));}
 if(!norm)throw Error('Blank reference tensor');
 const relativeL2=Math.sqrt(error/norm);return {n:got.length,relativeL2,maxAbs,tolerance,pass:relativeL2<=tolerance};
}
export function validateReferenceWitness(r){
 if(r.phase!=='done'||r.gpuErrors?.length||!r.adapter?.vendor||r.adapter.fallback)throw Error('Missing native GPU completion');
 if(r.weights?.mode!=='text-and-image'||r.weights?.source?.revision!==r.oracle?.sourceRevision||r.weights?.lora?.sha256!==r.oracle?.loraSha256)throw Error('Reference route/source mismatch');
 for(const key of ['format','globals_format','group'])if(r.weights[key]!==r.oracle.weights?.[key]||r.weights[key]===undefined)throw Error('Reference quantization mismatch');
 for(const name of ['encoder-f32','encoder-f16','transformer'])if(!r.checks?.[name]?.pass)throw Error(`Reference parity failed: ${name}`);
 if(!(r.oracle.referenceEffectL2>1e-3))throw Error('Unproved reference effect');
}
export async function runReferenceWitness(){
 const r={phase:'init',checks:{},gpuErrors:[]};let device,encoder,tr;
 const json=async url=>{const res=await fetch(url);if(!res.ok)throw Error(`${url}: ${res.status}`);return res.json();};
 const bytes=async(url,expected)=>{const res=await fetch(url);if(!res.ok)throw Error(`${url}: ${res.status}`);const b=await res.arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==expected.sha256)throw Error(`Digest mismatch: ${url}`);return b;};
 try{
  const oracle=await json('/ref/manifest.json');if(!oracle.ok||oracle.phase!=='done')throw Error('CPU reference did not complete');r.oracle=oracle;
  r.weights=await json('/weights/dit/manifest.json');
  if(r.weights.mode!=='text-and-image')throw Error('Package omits reference mode');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});r.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,fallback:adapter.info.isFallbackAdapter??adapter.isFallbackAdapter??false};
  device=await adapter.requestDevice({requiredFeatures:['shader-f16'],requiredLimits:Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage'].map(k=>[k,adapter.limits[k]]))});
  device.addEventListener('uncapturederror',e=>r.gpuErrors.push(e.error.message));
  const tensor=async name=>new Float32Array(await bytes('/ref/'+oracle.tensors[name].file,oracle.tensors[name]));
  const ref=await tensor('reference'),rgb=await tensor('rgb');
  const manifest=await json('/weights/encoder/manifest.json');
  encoder=new Flux3VaeEncoder(device,manifest);encoder.sharedType='f32';await encoder.load(await bytes('/weights/encoder/'+manifest.bundle.file,manifest.bundle));
  for(const act of ['f32','f16']){r.phase=`encoder-${act}`;encoder.actType=act;r.checks[r.phase]=compareReferenceValues(await encoder.encode(rgb,oracle.width,oracle.height),ref,act==='f32'?1e-3:3e-2);}
  encoder.destroy();encoder=null;
  r.phase='transformer';tr=new Flux3Transformer(device,r.weights);tr.gemmVersion=2;tr.sharedType='f32';
  await tr.loadBundles((file,b)=>bytes('/weights/dit/'+file,b));
  tr.allocate(6,2,6);tr.prepare({latents:await tensor('latents'),promptEmbeds:await tensor('prompt'),imgIds:await tensor('image_ids'),txtIds:await tensor('text_ids'),reference:ref,referenceIds:await tensor('reference_ids')});
  await tr.forward({tModel:1000});
  const rb=device.createBuffer({size:6*128*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),cmd=device.createCommandEncoder();
  cmd.copyBufferToBuffer(tr.act.velocity,0,rb,0,rb.size);device.queue.submit([cmd.finish()]);await rb.mapAsync(GPUMapMode.READ);
  const got=new Float32Array(rb.getMappedRange().slice(0));rb.unmap();rb.destroy();
  r.checks.transformer=compareReferenceValues(got,await tensor('velocity'),1e-3);
  await device.queue.onSubmittedWorkDone();r.phase='done';validateReferenceWitness(r);r.ok=true;
 }catch(e){r.ok=false;r.error=String(e.stack||e);}finally{encoder?.destroy();tr?.destroy();device?.destroy();}
 return r;
}
