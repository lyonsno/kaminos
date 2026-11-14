// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneWorkerAssets} from '../scene-worker-assets.mjs';
import {createSceneWorkerAssetsController} from '../scene-worker-assets-page.mjs';

const saved={kind:'image',name:'source.png',root_id:'image-inbox',source:'/api/read?root=image-inbox&path=source.png'};
const ctx={signal:new AbortController().signal,assertCurrent(){}};
function fixture(uploadImage){
 const worker=createSceneWorkerAssets({uploadImage});
 const calls=[];
 const page={request(name,payload,options){calls.push({name,payload,options});return {completion:Promise.resolve().then(()=>worker.commands[name](payload,ctx)).then(output=>({output}))};}};
 return {worker,calls,controller:createSceneWorkerAssetsController({page})};
}
test('local image upload crosses the actual drawer worker service and selects its stored reference',async()=>{
 let actual;
 const f=fixture(async(file,options)=>{actual={name:file.name,type:file.type,bytes:[...new Uint8Array(await file.arrayBuffer())],options};return saved;});
 await f.controller.upload(new File([new Uint8Array([1,5,9])],'source.png',{type:'image/png'}));
 assert.equal(f.calls[0].name,'assets.upload');assert.deepEqual(actual.bytes,[1,5,9]);assert.equal(actual.name,'source.png');assert.equal(actual.type,'image/png');
 assert.equal(typeof actual.options.assertCurrent,'function');assert.equal(actual.options.signal,ctx.signal);
 assert.equal(f.controller.read().selected.source,saved.source);assert.equal(f.controller.read().selected.root,'image-inbox');assert.equal(f.controller.read().loading,false);
});
test('storage failure preserves selected input and allows a later successful upload',async()=>{
 let failed=false;const f=fixture(async()=>{if(failed)throw Error('disk unavailable');return saved;});
 await f.controller.upload(new File(['first'],'first.png'));failed=true;
 await assert.rejects(f.controller.upload(new File(['second'],'second.png')),/disk unavailable/);
 assert.equal(f.controller.read().selected.source,saved.source);assert.equal(f.controller.read().loading,false);
 failed=false;await f.controller.upload(new File(['third'],'third.png'));assert.equal(f.controller.read().error,null);
});
test('an upload completing after a different input selection retains that current selection',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>finish=resolve));
 const pending=f.controller.upload(new File(['late'],'late.png'));
 for(let i=0;i<8;i++)await Promise.resolve();
 const newer={kind:'image',source:'/api/read?root=image-inbox&path=newer.png',name:'newer.png'};await f.controller.select(newer);finish(saved);await pending;
 assert.equal(f.controller.read().selected.source,newer.source);
});
test('stale upload cannot select into the replacement worker epoch',async()=>{
 let finish,current=true;const worker=createSceneWorkerAssets({uploadImage:()=>new Promise(resolve=>finish=resolve)});
 const context={...ctx,assertCurrent(){if(!current)throw Object.assign(Error('stale epoch'),{name:'AbortError'});}};
 assert.equal(typeof worker.commands['assets.upload'],'function');
 const pending=worker.commands['assets.upload']({file:{name:'late.png',type:'image/png',bytes:new Uint8Array([1]).buffer}},context);
 for(let i=0;i<8;i++)await Promise.resolve();current=false;finish(saved);await assert.rejects(pending,/stale epoch/);
 const state=await worker.commands['assets.read'](null,ctx);assert.equal(state.state.selected,null);
});
