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
 assert.equal(f.controller.read().selected,null);await f.controller.select(entry);assert.equal(f.controller.read({selectionOnly:true}).selected.source,entry.source);
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
test('saved image entries carry their actual inbox and human title into selection',async()=>{
 const f=fixture(),saved={...entry,root_id:'image-inbox',display:{title:'A bronze basin'}};
 await f.worker.commands['assets.select']({entry:saved},context);
 const result=await f.worker.commands['assets.read'](null,context);
 assert.equal(result.state.selected.root,'image-inbox');assert.equal(result.state.selected.label,'A bronze basin');
});
test('omitted browse payload uses the current collection; omitted selection has a domain error',async()=>{
 const f=fixture();await f.controller.ensure();const result=await f.worker.commands['assets.browse'](null,context);assert.equal(result.state.root,'image-inbox');
 await assert.rejects(f.worker.commands['assets.select'](null,context),/Choose a 3D asset or source image/);
});
test('incomplete catalog state retains the usable projection and permits a later refresh',async()=>{
 const f=fixture();await f.controller.ensure();await f.controller.select(entry);const valid=f.controller.read();let requests=0;
 const packets=[{revision:1,state:valid},{revision:2,state:{entries:[]}},{revision:2,state:{...valid,selected:null}}];
 const c=createSceneWorkerAssetsController({page:{request:()=>({completion:Promise.resolve({output:packets[requests++]})})},changed:state=>{state.roots.map(root=>root.id);state.results.map(result=>result.name);}});
 await c.refresh();await assert.rejects(c.refresh(),/catalog state/);assert.equal(c.read().loading,false);assert.equal(c.read().selected.source,entry.source);assert.match(c.read().error,/catalog state/);
 assert.equal(await c.refresh(),true);assert.equal(requests,3);assert.equal(c.read().selected,null);assert.equal(c.read().error,null);assert.equal(c.read().loading,false);
});
test('a failed presentation callback cannot prevent worker requests or strand loading',async()=>{
 const f=fixture();await f.controller.ensure();const state=f.controller.read();let requests=0;
 const c=createSceneWorkerAssetsController({page:{request:()=>{requests++;return{completion:Promise.resolve({output:{revision:requests,state}})};}},changed:()=>{throw Error('view unavailable');}});
 for(let i=0;i<2;i++){await c.refresh();assert.equal(c.read().loading,false);assert.match(c.read().error,/view unavailable/);}
 assert.equal(requests,2);
});
