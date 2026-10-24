// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createAuthoringAssets,assetSource} from '../authoring-assets.mjs';
import {createAuthoringGeneration} from '../authoring-generation.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('assemblies browse and add through the authoring drawer without becoming mesh imports',async()=>{
 const calls=[],arm={id:'piston-arm',label:'Piston arm',url:'./assets/assemblies/piston-arm.json'};
 const c=createAuthoringAssets({request:async url=>{calls.push(url);return {};},addMesh:()=>assert.fail('assembly is not a mesh'),assemblies:{list:()=>[arm],add:async entry=>{calls.push(entry.id);return '@group:arm';}}});
 await c.refresh();assert.ok(c.read().roots.some(r=>r.id==='assemblies'));
 assert.equal(await c.browse('assemblies'),true);assert.equal(c.read().catalog,true);
 const entry=c.read().entries[0];assert.equal(entry.kind,'assembly');assert.equal(entry.source,arm.url);
 c.select(entry);assert.equal(await c.add(),'@group:arm');assert.equal(c.read().adding,false);
 assert.deepEqual(calls,['/api/roots','piston-arm']);
});
test('assembly load failure remains visible and late lists cannot replace another collection',async()=>{
 const pending=deferred();const c=createAuthoringAssets({request:async()=>({type:'dir',root:'other',path:'',entries:[]}),assemblies:{list:()=>pending.promise,add:async()=>{throw Error('incomplete mechanism');}}});
 const old=c.browse('assemblies');await c.browse('other');pending.resolve([{id:'arm',label:'Arm',url:'./arm.json'}]);await old;assert.equal(c.read().root,'other');assert.equal(c.read().entries.length,0);
 c.select({id:'arm',kind:'assembly'});await assert.rejects(c.add(),/incomplete mechanism/);assert.equal(c.read().error,'incomplete mechanism');assert.equal(c.read().adding,false);
});
test('held catalog selections retain their identity but cannot load, prepare or generate',async()=>{
 let calls=0;const c=createAuthoringAssets({request:async()=>({schema:'kaminos.authoring-assets.v1',collection:'greenroom',entries:[]}),addMesh:async()=>calls++,prepareImage:async()=>calls++,generator:()=>({preparesInput:true,read:()=>({status:'idle'}),run:async()=>calls++})});
 const held={kind:'image',source:'/api/job-output?job_id=held&file=output.png',label:'Lirm study',visibility:{status:'withheld',reason:'Hostile to eyesight. Awaiting further review.'}};
 c.select(held);assert.deepEqual(c.read().selected,held);
 await assert.rejects(c.prepare(),/awaiting further review/i);await assert.rejects(c.generate(),/awaiting further review/i);
 c.select({...held,kind:'mesh'});await assert.rejects(c.add(),/awaiting further review/i);assert.equal(calls,0);
});
test('late folder response cannot replace a newer choice or source',async()=>{
 const old=deferred(),fresh=deferred();const c=createAuthoringAssets({request:url=>url.includes('root=old')?old.promise:fresh.promise});
 const a=c.browse('old','a'),b=c.browse('new','b');fresh.resolve({type:'dir',root:'new',path:'b',entries:[{name:'part.glb',type:'file'}]});await b;c.select(c.read().entries[0]);old.resolve({type:'dir',root:'old',path:'a',entries:[{name:'wrong.glb',type:'file'}]});await a;
 assert.equal(c.read().root,'new');assert.equal(c.read().selected.name,'part.glb');assert.equal(assetSource('r','a & b.glb'),'/api/read?root=r&path=a+%26+b.glb');
});
test('failed or wrong folder response clears stale contents rather than appearing successful',async()=>{
 const c=createAuthoringAssets({request:async()=>({type:'dir',root:'wrong',path:'',entries:[{name:'wrong.glb',type:'file'}]})});assert.equal(await c.browse('actual'),false);assert.equal(c.read().entries.length,0);assert.match(c.read().error,/does not match/);
});
test('adding an asset uses its exact source and retains an error without adding a substitute',async()=>{
 let observed;const c=createAuthoringAssets({request(){},addMesh:async entry=>{observed=entry;throw Error('scene busy');}});c.select({root:'library',path:'a.glb',kind:'mesh'});await assert.rejects(c.add(),/scene busy/);assert.equal(observed.source,'/api/read?root=library&path=a.glb');assert.equal(c.read().adding,false);assert.equal(c.read().results.length,0);
});
test('a generated output whose storage fails is retryable without rerunning or losing its identity',async()=>{
 let runs=0,writes=0;const glb=new Uint8Array([1,2,3]).buffer;
 const c=createAuthoringGeneration({loadInput:async()=>({image:{},identity:{source:'/api/read?root=r&path=i.png',sha256:'input'}}),initialize:async()=>({run:async()=>{runs++;return{glb,receiptValidation:{ok:true},receipt:{routeId:'observed'}};}}),persist:async(bytes,generation)=>{writes++;if(writes===1)throw Error('disk failed');assert.deepEqual(new Uint8Array(bytes),new Uint8Array(glb));return{source:'/api/read?root=generated-meshes&path=result.glb',generation,name:'Result'};}});
 await assert.rejects(c.run({source:'/api/read?root=r&path=i.png'}),/disk failed/);const pending=c.read().pending;assert.equal(pending.generation.input.sha256,'input');
 assert.equal(typeof c.retryPersistence,'function','a retained inference output needs a persistence retry operation');await c.retryPersistence();assert.equal(runs,1);assert.equal(writes,2);assert.equal(c.read().pending,null);
});
test('missing output or invalid receipt cannot appear as a completed generation',async()=>{
 let writes=0;const c=createAuthoringGeneration({loadInput:async()=>({image:{},identity:{source:'image'}}),initialize:async()=>({run:async()=>({glb:new ArrayBuffer(3),receiptValidation:{ok:false}})}),persist:async()=>writes++});await assert.rejects(c.run({source:'image'}),/invalid producer receipt/);assert.equal(writes,0);assert.equal(c.read().status,'failed');
});

test('scene save and restore retain generated input and result identity',()=>{
 const generation={schema:'kaminos.asset-generation.v1',input:{source:'/api/read?root=image-inbox&path=source.png',sha256:'input'},route:'sf3d.image-to-mesh.webgpu-local.v0',runId:'observed-run',sha256:'mesh'};
 const object={id:'generated',type:'glb',source:'/api/read?root=generated-meshes&path=mesh.glb',generation,transform:{position:[1,2,3],rotation:[0,0,0],scale:[1,1,1]}};
 const document=buildSceneDocument({objects:[object],activeObjectId:'generated'});assert.deepEqual(document.objects[0].generation,generation);assert.deepEqual(planSceneRestore(document).objects[0].generation,generation);
});

test('an explicit empty selection survives document normalization while legacy omission keeps its fallback',()=>{
 const objects=[{id:'a',source:'/api/read?root=generated-meshes&path=a.glb',type:'glb'},{id:'b',source:'/api/read?root=generated-meshes&path=b.glb',type:'glb'}];
 const empty=buildSceneDocument({objects,selectionIds:[],activeObjectId:null});assert.equal(empty.activeObjectId,null);assert.equal(planSceneRestore(empty).activeObjectId,null);
 const legacy=buildSceneDocument({objects});assert.equal(legacy.activeObjectId,'a');assert.equal(Object.hasOwn(legacy,'selectionIds'),false);
});
test('catalog uses canonical asset sources and refuses folders or mismatched collections',async()=>{
 let url;const c=createAuthoringAssets({request:async value=>{url=value;return{schema:'kaminos.authoring-assets.v1',collection:'greenroom',entries:[{id:'mesh',kind:'mesh',source:'/api/job-output?job_id=observed&file=asset.glb',name:'asset.glb',label:'Kiln'}],warnings:[]};}});
 assert.equal(await c.browse('greenroom'),true);assert.match(url,/authoring-assets\?collection=greenroom/);assert.equal(c.read().entries[0].source,'/api/job-output?job_id=observed&file=asset.glb');assert.equal(c.read().catalog,true);
 const bad=createAuthoringAssets({request:async()=>({schema:'kaminos.authoring-assets.v1',collection:'greenroom',entries:[{kind:'folder',source:'/api/read?root=greenroom&path=cache'}]})});assert.equal(await bad.browse('greenroom'),false);assert.match(bad.read().error,/invalid asset source/);
});
test('an imported generator asset retains its original source beside retained scene bytes',()=>{
 const assetOrigin={source:'/api/job-output?job_id=observed&file=asset.glb',jobId:'observed',route:'trellis2.image-generation.webgpu.v0',sha256:'mesh'};
 const object={id:'imported',type:'glb',source:'/api/read?root=generated-meshes&path=mesh.glb',assetOrigin};assert.deepEqual(planSceneRestore(buildSceneDocument({objects:[object]})).objects[0].assetOrigin,assetOrigin);
});
