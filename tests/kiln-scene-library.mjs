// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createKilnRecipeStore,KILN_SELECTION_SCHEMA} from '../inference-kiln-selection.mjs';
import {PREFERENCES_SCHEMA} from '../user-preferences.mjs';
import {BoxGeometry,BufferGeometry,Mesh,MeshStandardMaterial} from '../lib/three.core.js';
import {promptReliefRecord,promptReliefMetadata} from '../inference-kiln-record.mjs';
import {COMPOSITION_SCHEMA} from '../scene-authoring.mjs';
// Execute the actual Generate chooser, before and after the shared library
// adapter. The baseline fails on the missing catalog, not a missing import.
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('    async choose(){',source.indexOf('authoringGenerateLayout=installGenerateLayout'));
const end=source.indexOf('\n  },createFlame:',start);assert.ok(start>0&&end>start);
let chooseSavedSceneFromLibrary;
if(source.includes("from './scene-library-client.mjs'"))({chooseSavedSceneFromLibrary}=await import('../scene-library-client.mjs'));
test('Design in Workbench addresses its saved scene through the native startup hash',()=>{
 const line=source.split('\n').find(line=>line.trim().startsWith('const kilnDesignURL='));assert.ok(line);
 const name='kiln (2) # 🔥.kaminos.json',href=Function('kilnRecipes',line+';return kilnDesignURL();')({read:()=>({selection:{sceneFile:name}})}),url=new URL(href,'http://127.0.0.1:8601/');
 assert.equal(new URLSearchParams(url.hash.slice(1)).get('scene'),name,'the native startup loader reads #scene, not the query');assert.equal(url.searchParams.get('workspace'),'workbench');assert.equal(url.searchParams.get('experiment'),'inference-kiln-material');
});
test('Choose kiln finds and imports the same other-store saves as ordinary Load',async()=>{
 const name='inference-kiln-eats-yourmom-rises-again.kaminos.json',chosen=[],imports=[];
 const grFetchApi=async route=>route==='browse'?{entries:[]}:assert.fail('unexpected local read');
 const request=async(url,options)=>{
  if(url==='/api/scene-library')return {ok:true,json:async()=>({stores:[{id:'editor-store',label:'kaminos-dark-side-kiln-editor-1027',scenes:[{name,label:'Kiln study',timestamp:'2026-10-27T10:00:00Z'}]}]})};
  assert.equal(url,'/api/scene-library-import');imports.push(JSON.parse(options.body));return {ok:true,json:async()=>({saved:'retained-copy.kaminos.json',document:{label:'Kiln study'},dependencies:[]})};
 };
 const pickSavedScene=async options=>{const extra=await options.more;assert.ok(extra?.some(scene=>scene.name===name),'other-store saved kiln must reach the Generate chooser');return extra.find(scene=>scene.name===name);};
 const choose=Function('grFetchApi','pickSavedScene','kilnRecipes','chooseSavedSceneFromLibrary','fetch','return({'+source.slice(start,end)+'}).choose;')(grFetchApi,pickSavedScene,{chooseScene:async name=>chosen.push(name)},chooseSavedSceneFromLibrary,request);
 assert.equal(await choose(),true);assert.deepEqual(imports,[{store:'editor-store',name}]);assert.deepEqual(chosen,['retained-copy.kaminos.json']);
});
test('a failed other-store import cannot acknowledge a scene selection',async()=>{
 const {chooseSavedSceneFromLibrary}=await import('../scene-library-client.mjs');
 const request=async url=>({ok:true,json:async()=>url==='/api/scene-library'?{stores:[]}:{document:{label:'unretained'}}});
 await assert.rejects(chooseSavedSceneFromLibrary({grFetchApi:async()=>({entries:[]}),request,pickSavedScene:async()=>({name:'saved.kaminos.json',store:{id:'worktree',label:'Worktree'}})}),/did not retain/);
});
test('Browse files retains a fresh ordinary scene without accepting overwrite hints',async()=>{
 const {chooseSavedSceneFromLibrary}=await import('../scene-library-client.mjs');let body;
 const document={schema:'kaminos.scene.v1',version:8,objects:[{id:'cube',type:'procedural-mesh',source:'kaminos:geometry',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},geometry:{kind:'box',parameters:{width:1,height:1,depth:1}}}],_filename:'existing.kaminos.json',_saveAsName:'existing',_overwrite:true};
 const result=await chooseSavedSceneFromLibrary({grFetchApi:async()=>({entries:[]}),pickSavedScene:async()=> 'browse',browseFile:async()=>({name:'uploaded.kaminos.json',text:async()=>JSON.stringify(document)}),request:async(url,options)=>{
  if(url==='/api/scene-library')return {ok:true,json:async()=>({stores:[]})};assert.equal(url,'/api/save-scene');body=JSON.parse(options.body);return {ok:true,json:async()=>({saved:'new-copy.kaminos.json'})};
 }});assert.equal(result.name,'new-copy.kaminos.json');assert.equal(body._filename,null);assert.equal(body._saveAsName,null);assert.equal(body._overwrite,false);
});
for(const status of ['missing','present','imported'])test('Generate preserves import dependency status '+status+' before acknowledging its kiln',async()=>{
 const mesh=new Mesh(new BufferGeometry().copy(new BoxGeometry()),new MeshStandardMaterial());mesh.userData.kaminosPromptRelief=promptReliefMetadata('SAMPLE','composed');const lettering={...promptReliefRecord(mesh),id:'prompt'};mesh.geometry.dispose();mesh.material.dispose();
 const transform={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},asset='/api/read?root=generated-meshes&path='+ 'a'.repeat(64)+'.glb';
 const document={version:8,objects:[lettering,{id:'source',type:'flame-emitter',source:'kaminos:analytic-flame',transform},{id:'model',type:'glb',source:asset,transform}],composition:{schema:COMPOSITION_SCHEMA,flame:{presetId:'vsp-'+ 'b'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}}};
 let prefs={schema:PREFERENCES_SCHEMA},writes=0;const store=createKilnRecipeStore({preferences:{load:async()=>prefs,save:async value=>{prefs=structuredClone(value);writes++;}},request:async()=>({ok:true,json:async()=>document})});
 await store.choose({schema:KILN_SELECTION_SCHEMA,sceneFile:'working.kaminos.json',promptObjectId:'prompt'});const before=store.read();
 const request=async url=>({ok:true,json:async()=>url==='/api/scene-library'?{stores:[]}:{saved:'retained-copy.kaminos.json',document,dependencies:[{source:asset,status}]}});
 const choose=Function('grFetchApi','pickSavedScene','kilnRecipes','chooseSavedSceneFromLibrary','fetch','return({'+source.slice(start,end)+'}).choose;')(async()=>({entries:[]}),async()=>({name:'source.kaminos.json',store:{id:'other',label:'Other'}}),store,chooseSavedSceneFromLibrary,request);
 if(status==='missing'){await assert.rejects(choose(),/could not retain|missing|required/i);assert.equal(writes,1);assert.deepEqual(store.read(),before);assert.equal(prefs.inferenceKiln.sceneFile,'working.kaminos.json');}
 else{assert.equal(await choose(),true);assert.equal(writes,2);assert.equal(store.read().selection.sceneFile,'retained-copy.kaminos.json');}
});
