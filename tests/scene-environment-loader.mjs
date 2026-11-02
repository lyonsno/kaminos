// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnvironmentLoader} from '../scene-environment-loader.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const requests=[],applied=[],states=[];
 const presets={sunset:{url:'sun-full',previewUrl:'sun-preview'},studio:{url:'studio-full',previewUrl:'studio-preview'},neutral:{}};
 const loader=createEnvironmentLoader({presets,load:(url)=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),apply:map=>applied.push(map),fallback:()=> 'neutral',changed:s=>states.push(s)});
 return {loader,requests,applied,states,resolve:(url)=>requests.find(r=>r.url===url).resolve(url),reject:(url)=>requests.find(r=>r.url===url).reject(Error('offline'))};
}
test('cold selection is synchronous; preview precedes scene completion; full waits for release',async()=>{
 const f=fixture();assert.equal(f.loader.select('sunset').pending,true);await flush();
 assert.deepEqual(f.requests.map(r=>r.url),['sun-preview']);f.resolve('sun-preview');await flush();
 assert.equal(f.loader.read().quality,'preview');assert.deepEqual(f.applied,['sun-preview']);
 f.loader.releaseFull();await flush();f.resolve('sun-full');await f.loader.whenSettled();
 assert.equal(f.loader.read().quality,'full');assert.deepEqual(f.applied,['sun-preview','sun-full']);
});
test('late preview never downgrades full; cached selection requires no reload',async()=>{
 const f=fixture();f.loader.select('sunset');f.loader.releaseFull();await flush();f.resolve('sun-full');await f.loader.whenSettled();f.resolve('sun-preview');await flush();
 assert.deepEqual(f.applied,['sun-full']);f.loader.select('neutral');f.loader.select('sunset');await flush();
 assert.equal(f.requests.length,2);assert.equal(f.applied.at(-1),'sun-full');
});
test('late resources cannot overwrite a newer environment; repeated pending selection deduplicates',async()=>{
 const f=fixture();f.loader.releaseFull();f.loader.select('sunset');f.loader.select('sunset');await flush();
 f.loader.select('studio');await flush();f.resolve('studio-preview');f.resolve('studio-full');await f.loader.whenSettled();
 f.resolve('sun-preview');f.resolve('sun-full');await flush();assert.deepEqual(f.applied,['studio-preview','studio-full']);
 assert.equal(f.requests.filter(r=>r.url==='sun-full').length,1);
});
test('failed full map retains preview with honest status and can retry',async()=>{
 const f=fixture();f.loader.select('sunset');f.loader.releaseFull();await flush();f.resolve('sun-preview');f.reject('sun-full');await f.loader.whenSettled();
 assert.equal(f.loader.read().quality,'preview');assert.equal(f.loader.read().pending,false);assert.equal(f.loader.read().error,'offline');
 f.loader.select('sunset');await flush();assert.equal(f.requests.length,3);f.requests.at(-1).resolve('sun-full');await f.loader.whenSettled();assert.equal(f.loader.read().error,null);
});
test('missing preview and failed full map leave a usable fallback and preserve requested identity',async()=>{
 const f=fixture();f.loader.select('sunset');f.loader.releaseFull();await flush();f.reject('sun-preview');f.reject('sun-full');await f.loader.whenSettled();
 assert.equal(f.loader.read().name,'sunset');assert.equal(f.loader.read().mapName,null);assert.equal(f.loader.read().quality,'fallback');assert.equal(f.applied.at(-1),'neutral');
});
