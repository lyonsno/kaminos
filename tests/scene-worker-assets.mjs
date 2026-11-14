// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createSceneWorkerAssets}from'../scene-worker-assets.mjs';
import {createSceneWorkerAssetsController}from'../scene-worker-assets-page.mjs';
const entry={kind:'image',name:'basin.png',source:'/api/read?root=image-inbox&path=basin.png'};
const context={assertCurrent(){}};
function fixture(){
 const requests=[],worker=createSceneWorkerAssets({request:async url=>{requests.push(url);if(url==='/api/roots')return {'image-inbox':{exists:true}};return {schema:'kaminos.authoring-assets.v1',collection:'image-inbox',entries:[entry]};}});
 const page={request:(name,input)=>({completion:worker.commands[name](input,context).then(output=>({output}))})};
 return {controller:createSceneWorkerAssetsController({page}),worker,requests};
}
test('shared drawer uses actual worker catalog and selected image, preserving unchanged selections on refresh',async()=>{
 const f=fixture();await f.controller.ensure();assert.deepEqual(f.requests,['/api/roots','/api/authoring-assets?collection=image-inbox']);
 assert.equal(f.controller.read().selected,null);await f.controller.select(entry);assert.deepEqual(f.controller.read({selectionOnly:true}).selected,entry);
 await f.controller.refresh();assert.equal(f.controller.read().selected.source,entry.source);assert.equal(f.controller.read().loading,false);
});
test('asset replies from an expired worker context cannot become current drawer state',async()=>{
 const f=fixture();let calls=0;await assert.rejects(f.worker.commands['assets.ensure']({}, {assertCurrent(){if(++calls===2)throw Error('retired worker');}}),/retired worker/);
});
test('out of order projections do not roll selected image back',async()=>{
 const f=fixture();await f.controller.ensure();const state=f.controller.read(),gates=[];
 const c=createSceneWorkerAssetsController({page:{request:()=>({completion:new Promise(resolve=>gates.push(resolve))})}});
 const older=c.ensure(),newer=c.select(entry);
 gates[1]({output:{revision:3,state:{...state,selected:entry}}});await newer;
 gates[0]({output:{revision:2,state:{...state,selected:null}}});await older;
 assert.deepEqual(c.read({selectionOnly:true}).selected,entry);
});
test('missing catalog output fails visibly and releases the presentation loading state',async()=>{
 const c=createSceneWorkerAssetsController({page:{request:()=>({completion:Promise.resolve({output:{}})})}});
 await assert.rejects(c.refresh(),/catalog state/);assert.equal(c.read().loading,false);assert.match(c.read().error,/catalog state/);
});
