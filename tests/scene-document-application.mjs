// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MessageChannel} from 'node:worker_threads';
import * as THREE from '../lib/three.core.js';
import {registerHooks} from 'node:module';
import {sceneObjectTransformState,applySceneObjectTransformState,getMaterialStateForObject,applyMaterialStateToObject} from '../scene-object-state.mjs';
import {createSceneGlbLoader} from '../scene-glb-loader.mjs';
import {createSceneWorkerClient,installSceneWorkerHost} from '../scene-worker-handoff.mjs';
// Match the ordinary page's actual namespace and addon resolution.
registerHooks({resolve(specifier,context,next){
 const local={'three':'../lib/three.webgpu.js','three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];
 return local?{url:new URL(local,import.meta.url).href,shortCircuit:true}:next(specifier,context);
}});
const {createSceneGltfLoaderClass}=await import('../scene-gltf-loader.mjs');
const renderer={isWebGPURenderer:true,hasFeature:()=>false};
const GLTFLoader=createSceneGltfLoaderClass({THREE,readRenderer:()=>renderer});
// The production parser expects the browser/worker alias even for embedded GLB geometry.
const previousSelf=globalThis.self;
test.before(()=>{globalThis.self=globalThis;});
test.after(()=>{if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf;});
const load=async name=>{try{return await import(new URL(name,import.meta.url));}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&e.url===new URL(name,import.meta.url).href)return {};throw e;}};
const authored=await load('../scene-authored-runtime.mjs'),application=await load('../scene-document-application.mjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const source='demos/material-recipes/two-finishes.glb';
const bytes=readFileSync(new URL('../'+source,import.meta.url));
const pose={position:[1,2,3],rotation:[0,.4,0],scale:[2,1,1]};
const document=(id='asset')=>({version:8,objects:[{id,type:'glb',source,label:id,transform:pose,materials:{side:THREE.DoubleSide,transparent:true,opacity:.6}}],
 groups:[{id:'assembly',label:'Saved group',objectIds:[id]}],activeObjectId:id,activeGroupId:'assembly',selectionIds:[id,'@group:assembly']});

function fixture({read=null,prepare=null,after=null,support=null,documentSupport=null}={}){
 assert.equal(typeof authored.createAuthoredSceneRuntime,'function','actual authored registry composition is required');
 assert.equal(typeof application.createSceneDocumentApplication,'function','actual document command must apply assets, not just initialize a shell');
 const scene=new THREE.Scene(),disposed=[],reads=[],events=[],materialVersions=new WeakMap();
 const restore=(entry,record)=>authored.restoreAuthoredSceneRecord(entry,record,{transform:applySceneObjectTransformState,materials:applyMaterialStateToObject});
 const runtime=authored.createAuthoredSceneRuntime({scene,readers:{transform:sceneObjectTransformState,materials:getMaterialStateForObject},
  roots:{restore,dispose:root=>{disposed.push(root);root.traverse(n=>{n.geometry?.dispose();for(const m of [].concat(n.material??[]))m.dispose();});}},
  assertRecordSupported:support??(record=>{if(record.type!=='glb')throw Error('No mounted source for '+record.type);}),
  replacement:{context:{retire:async()=>events.push('retire')}},
  createLoaders:({workingScene,registerSceneObject})=>{
   const show=createSceneGlbLoader({GLTFLoader,workingScene,readScene:()=>scene,registerSceneObject:(root,...args)=>{
    root.traverse(n=>{for(const material of [].concat(n.material??[]))materialVersions.set(material,material.version);});
    return registerSceneObject(root,...args);
   },
    readAssetBytes:async url=>{reads.push(url);await read?.(url);return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},
    shouldClearSceneForImport:()=>false,resolveAssetArrivalMode:()=>null,
    disposeObjectTree:root=>disposed.push(root),applyAssetArrival:()=>null});
   return {glb:(record,options)=>show(record.source,{clear:false,normalize:false,activate:options.activate,metadata:record,isCurrent:options.isCurrent})};
  },
 });
 const app=application.createSceneDocumentApplication({runtime,
  assertSupported:documentSupport??(data=>{if(data.environment)throw Error('Environment service is not mounted');}),
  prepareDocument:async(...args)=>{events.push('prepare');await prepare?.(...args);},beforeReplace:async()=>events.push('before'),
  afterReplace:async(...args)=>{events.push('after');await after?.(...args);},
  documentServices:{filename:'previous.kaminos.json',readAddress:()=>({origin:'http://fixture'}),post:async()=>{throw Error('Unexpected save');},restoreUrl:()=>'/scene'},
 });
 return {runtime,app,scene,disposed,reads,events,materialVersions};
}
const context=signal=>({signal:signal??new AbortController().signal,assertCurrent(){this.signal.throwIfAborted();}});
const apply=(h,data,ctx=context(),sceneFile='saved.kaminos.json')=>h.app.commands['scene.applyDocument']({document:data,sceneFile},ctx);

test('real facade applies saved GLB through actual parser, registry and lifecycle, then replaces owned roots',async t=>{
 const h=fixture(),{port1,port2}=new MessageChannel();
 const host=installSceneWorkerHost({port:port2,createRuntime:async()=>({commands:h.app.commands,frame(){},retire:async()=>h.runtime.lifecycle.clear()})});
 const client=createSceneWorkerClient({port:port1,sessionId:'authored-consumer'});
 t.after(()=>{client.disconnect();host.disconnect();port1.close();port2.close();});
 await client.initialize({}).completion;
 const result=(await client.request('scene.applyDocument',{document:document(),sceneFile:'saved.kaminos.json'}).completion).output;
 assert.equal(result.applied,true);assert.equal(h.app.session.state().filename,'saved.kaminos.json');
 const entry=h.runtime.workingScene.find('asset');assert.ok(entry.object.isObject3D);assert.equal(entry.object.parent,h.scene);
 assert.deepEqual(entry.object.position.toArray(),pose.position);assert.equal(entry.object.rotation.y,.4);
 const meshes=[];entry.object.traverse(n=>{if(n.isMesh)meshes.push(n);});assert.ok(meshes.length>0);
 for(const mesh of meshes){assert.equal(mesh.material.opacity,.6);assert.equal(mesh.material.side,THREE.DoubleSide);assert.ok(mesh.material.version>h.materialVersions.get(mesh.material),'restored material controls must invalidate the actual render material');}
 assert.deepEqual(h.runtime.workingScene.selection.ids,['asset','@group:assembly']);assert.equal(h.runtime.workingScene.activeGroupId,'assembly');
 const state=(await client.request('scene.read').completion).output;
 assert.deepEqual(state.objects.map(r=>r.id),['asset']);assert.equal(state.objects[0].object,undefined);assert.equal(state.objects[0].source,source);
 await client.request('scene.applyDocument',{document:document('replacement')}).completion;
 assert.equal(h.runtime.workingScene.find('asset'),undefined);assert.equal(entry.object.parent,null);assert.ok(h.disposed.includes(entry.object));
 assert.equal(h.scene.children.length,1);assert.equal(h.app.session.state().filename,null);
 assert.deepEqual(h.events,['prepare','before','retire','after','prepare','before','retire','after']);
});

test('requested unmounted record or presentation service refuses before clearing a viable scene',async()=>{
 const h=fixture();await apply(h,document());const kept=h.runtime.workingScene.find('asset').object,before=h.events.length;
 const image=document('image');image.objects[0].type='image';image.objects[0].source='/api/photo.png';
 await assert.rejects(apply(h,image),/No mounted source for image/);
 await assert.rejects(apply(h,{...document('other'),environment:{name:'studio'}}),/Environment service/);
 assert.equal(h.runtime.workingScene.find('asset').object,kept);assert.equal(h.disposed.length,0);assert.equal(h.events.length,before);
 assert.equal(h.app.session.state().filename,'saved.kaminos.json');assert.equal(h.app.session.state().blocked,false);
});

test('failed real asset load blocks saving and never reports successful application',async()=>{
 let fail=false;const h=fixture({read:()=>{if(fail)throw Error('GLB source unavailable');}});await apply(h,document());fail=true;
 await assert.rejects(apply(h,document('broken')),/GLB source unavailable/);
 assert.equal(h.app.session.state().blocked,true);assert.equal(h.app.session.state().filename,null);assert.equal(h.app.session.state().phase,'idle');
 assert.equal(h.runtime.workingScene.objects.length,0);assert.equal(await h.app.session.save(document()),false);
});

test('negative or asynchronous support checks cannot silently certify a document',async()=>{
 for(const kind of ['record','document'])for(const result of [false,Promise.resolve()]){
  let reject=false;const support=()=>reject?result:undefined;
  const h=fixture(kind==='record'?{support}:{documentSupport:support});await apply(h,document());const kept=h.runtime.workingScene.find('asset').object;
  reject=true;await assert.rejects(apply(h,document('unsupported')),/support|synchronous/i);
  assert.equal(h.runtime.workingScene.find('asset').object,kept);assert.equal(h.app.session.state().blocked,false);
 }
});

test('command cancellation during asset read cannot publish or leave the session applying',async()=>{
 const gate=deferred(),entered=deferred(),h=fixture({read:async()=>{entered.resolve();await gate.promise;}}),abort=new AbortController();
 const pending=apply(h,document(),context(abort.signal));pending.catch(()=>{});await entered.promise;abort.abort(new DOMException('Canceled','AbortError'));gate.resolve();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(h.runtime.workingScene.objects.length,0);
 assert.equal(h.app.session.state().phase,'idle');assert.equal(h.app.session.state().blocked,true);
});

test('superseded read cannot publish over the newer document or change its binding',async()=>{
 const gate=deferred(),entered=deferred();let count=0;
 const h=fixture({read:async()=>{if(++count===1){entered.resolve();await gate.promise;}}});
 const old=apply(h,document('old'),context(),'old.kaminos.json');old.catch(()=>{});await entered.promise;
 await apply(h,document('new'),context(),'new.kaminos.json');gate.resolve();await assert.rejects(old,/superseded|stale/i);
 assert.deepEqual(h.runtime.workingScene.objects.map(r=>r.id),['new']);assert.equal(h.app.session.state().filename,'new.kaminos.json');
});

test('document hook context stays invocation-local across overlapping preparation',async()=>{
 const gate=deferred(),entered=deferred(),seen=[];
 const h=fixture({prepare:async(_data,_plan,meta)=>{seen.push(meta.context);if(seen.length===1){entered.resolve();await gate.promise;}}});
 const a=context(),b=context(),old=apply(h,document('old'),a);old.catch(()=>{});await entered.promise;await apply(h,document('new'),b);gate.resolve();
 await assert.rejects(old,/superseded|stale/i);assert.deepEqual(seen,[a,b]);assert.deepEqual(h.runtime.workingScene.objects.map(r=>r.id),['new']);
});
