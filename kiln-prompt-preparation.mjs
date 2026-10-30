import {BufferGeometry,BufferAttribute} from './lib/three.core.js';
export function createKilnPromptPreparation({rasterize,Worker=globalThis.Worker}){
 const worker=new Worker(new URL('./kiln-prompt-worker.mjs',import.meta.url),{type:'module'});
 let serial=0,disposed=false,cached=null,phase='idle';const pending=new Map();
 worker.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;if(data.phase){phase=data.phase;return;}phase=data.error?'failed':'prepared';pending.delete(data.id);if(data.error){item.reject(Error(data.error));return;}
  const geometry=new BufferGeometry();for(const [key,a]of Object.entries(data.attributes))geometry.setAttribute(key,new BufferAttribute(a.array,a.itemSize,a.normalized));for(const g of data.groups)geometry.addGroup(g.start,g.count,g.materialIndex);geometry.computeBoundingBox();
  data.mask.samples=data.samples;data.mask.surface=data.surface;item.resolve({geometry,surfaceMask:data.mask,height:item.height,text:item.text});
 };
 worker.onerror=event=>{for(const p of pending.values())p.reject(Error(event.message));pending.clear();};
 function prepare(text){
  if(disposed)return Promise.reject(Error('Prompt preparation disposed'));
  if(cached?.text===text)return cached.promise;
  phase='rasterizing';const prior=cached;const promise=(async()=>{const canvas=await rasterize(text);if(disposed)throw Error('Prompt preparation disposed');const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject,height:canvas.height,text});worker.postMessage({id,pixels:{width:canvas.width,height:canvas.height,data:pixels.data}},[pixels.data.buffer]);});})();
  cached={text,promise};if(prior)prior.promise.then(result=>result.geometry.dispose(),()=>{});return promise;
 }
 return {prepare,read:()=>({phase,pending:pending.size,requests:serial,text:cached?.text??null}),dispose(){disposed=true;worker.terminate();for(const p of pending.values())p.reject(Error('Prompt preparation disposed'));pending.clear();cached?.promise.then(r=>r.geometry.dispose(),()=>{});cached=null;}};
}
