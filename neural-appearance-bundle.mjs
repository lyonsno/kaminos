import {readNeuralAppearanceDecoder} from './neural-appearance.mjs';

// The decoder retains the author's model.json layout. This small extension
// transports linear latent texels without a browser multi-channel EXR decoder.
export function readNeuralAppearanceBundle(raw){
 if(typeof raw==='string')raw=JSON.parse(raw);
 const decoder=readNeuralAppearanceDecoder(raw),meta=raw?.kaminos;
 if(meta?.schema!=='kaminos.neural-appearance.bundle.v1')throw Error('Neural appearance spatial bundle metadata required');
 if(meta.response!=='projected-bsdf')throw Error('Unsupported neural appearance response convention');
 if(meta.filtering!=='nearest-authored-texel-mip')throw Error('Unsupported neural appearance filtering policy');
 if(!Array.isArray(meta.levels)||!meta.levels.length)throw Error('Authored latent levels required');
 const levels=meta.levels.map(level=>{
  if(!Number.isSafeInteger(level.width)||level.width<1||!Number.isSafeInteger(level.height)||level.height<1)throw Error('Invalid latent level dimension');
  if(typeof level.url!=='string'||!level.url)throw Error('Latent payload URL required');
  if(typeof level.sha256!=='string'||! /^[a-f0-9]{64}$/.test(level.sha256))throw Error('Latent payload SHA256 required');
  const byteLength=level.width*level.height*decoder.numLatents*4;
  if(!Number.isSafeInteger(byteLength))throw Error('Latent level dimension exceeds addressable payload');
  return {...level,byteLength};
 });
 return {decoder,levels,response:meta.response,filtering:meta.filtering,provenance:structuredClone(meta.provenance??null)};
}
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function loadNeuralAppearanceBundle(url,{sha256,fetcher=fetch}={}){
 if(! /^[a-f0-9]{64}$/.test(sha256??''))throw Error('Checkpoint SHA256 required');
 const response=await fetcher(url);if(!response.ok)throw Error(`Neural appearance checkpoint HTTP ${response.status}`);
 const bytes=await response.arrayBuffer();if(await digest(bytes)!==sha256)throw Error('Neural appearance checkpoint digest mismatch');
 const raw=JSON.parse(new TextDecoder().decode(bytes)),bundle=readNeuralAppearanceBundle(raw);
 const base=new URL(url,globalThis.location?.href??'http://localhost/');
 const companionURL=relative=>{
  if(base.pathname==='/api/read'&&base.searchParams.has('path')&&! /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(relative)){
   const result=new URL(base),file=new URL(relative,new URL(base.searchParams.get('path'),'https://bundle.invalid/'));
   result.searchParams.set('path',decodeURIComponent(file.pathname.slice(1)));return result.href;
  }
  return new URL(relative,base).href;
 };
 const levels=await Promise.all(bundle.levels.map(async level=>{
  const response=await fetcher(companionURL(level.url));if(!response.ok)throw Error(`Latent payload HTTP ${response.status}`);
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==level.byteLength)throw Error('Latent payload byte count mismatch');
  if(await digest(bytes)!==level.sha256)throw Error('Latent payload digest mismatch');
  const view=new DataView(bytes),data=new Float32Array(bytes.byteLength/4);
  for(let i=0;i<data.length;i++){data[i]=view.getFloat32(i*4,true);if(!Number.isFinite(data[i]))throw Error('Nonfinite latent payload');}
  return {...level,data};
 }));
 return {...bundle,levels,source:{url,sha256},checkpoint:raw};
}
