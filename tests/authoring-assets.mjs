import test from 'node:test';import assert from 'node:assert/strict';
import {createAuthoringAssets,assetSource} from '../authoring-assets.mjs';
import {createAuthoringGeneration} from '../authoring-generation.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
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
