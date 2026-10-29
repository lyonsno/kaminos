// kaminos-test: node
import {sceneContext} from './helpers/scene-context.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createInferenceKiln} from '../inference-kiln.mjs';import {buildSceneDocument,isReloadableSceneObjectRecord,planSceneRestore} from '../scene-persistence-core.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('the actual kiln record retains reloadable lettering geometry and source after prompt replacement',async()=>{
 const canvas={getContext:()=>ctx},ctx={measureText:s=>({width:s.length*30}),clearRect(){},fillText(){},getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);for(let y=40;y<120;y++)for(let x=200;x<700;x++)data[(y*canvas.width+x)*4+3]=255;return {data,width:canvas.width,height:canvas.height};}};
 const kiln=createInferenceKiln({document:{createElement:()=>canvas},representation:'relief',prompt:'ORIGINAL',appearance:'incineration'});
 const entry={id:'prompt',type:'pbr',object:kiln.text,burnable:{enabled:true,material:'wood'}};
 const context={sceneObjectMetadataFor:()=>entry,sceneObjectTransformState:()=>({position:[0,.15,.13],rotation:[0,0,0],scale:[1,1,1]}),getMaterialStateForObject:()=>null,canCollideWithFire:()=>false,FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'water-emitter',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural-mesh',structuredClone};
 // The production serializer is the acceptance boundary, not a synthetic record.
 const module=await import('../inference-kiln-record.mjs');Object.assign(context,module);
 sceneContext(context);vm.runInContext(source.slice(source.indexOf('function serializeSceneObject('),source.indexOf('function readNumberControl(',source.indexOf('function serializeSceneObject('))),context);
 for(const prompt of ['ORIGINAL','REPLACEMENT']){kiln.setPrompt(prompt);const raw=context.serializeSceneObject(entry),document=buildSceneDocument({objects:[raw]});assert.equal(isReloadableSceneObjectRecord(document.objects[0]),true,'Save must retain geometry instead of source:null');const saved=planSceneRestore(document).objects[0];assert.equal(saved.promptRelief.prompt,prompt);const restored=module.restorePromptRelief(saved);assert.deepEqual(Array.from(restored.geometry.attributes.position.array),Array.from(kiln.text.geometry.attributes.position.array));assert.deepEqual(restored.geometry.index?.array??null,kiln.text.geometry.index?.array??null);assert.equal(restored.material.userData.kaminosBurnAppearance,'incineration');restored.geometry.dispose();restored.material.dispose();}
 kiln.dispose();
});

test('Save rejects an unretained scene object before sending or overwriting a file',async()=>{
 let sent=false;const messages=[];const c={fetch:async()=>{sent=true;return {ok:true,json:async()=>({saved:'bad.kaminos.json'})};},setInfo:s=>messages.push(s),compositionRestoreUrl:()=>'',readOwnerExperimentAddress:()=>({}),authoringWorkspace:null,location:{origin:'http://test',href:'http://test'},history:{replaceState(){}},savedSceneLocation:()=>'',grBrowseScenes(){}};
 const core=await import('../scene-persistence-core.js');Object.assign(c,core);
 sceneContext(c);vm.runInContext(source.slice(source.indexOf('async function saveToServer('),source.indexOf('function sceneIsEmpty()',source.indexOf('async function saveToServer('))),c);
 const result=await c.saveToServer({version:8,objects:[{id:'lost',type:'pbr',source:null}]},'existing.kaminos.json',{result:true});assert.equal(sent,false,'unreloadable source must never overwrite the existing document');assert.equal(result.ok,false);assert.match(result.error,/reloadable|source/i);
});

test('saved lettering rejects missing and non-finite geometry and invalid triangle addresses',async()=>{
 const {checkedPromptRelief}=await import('../inference-kiln-record.mjs');
 const value={schema:'kaminos.prompt-relief.v1',prompt:'A',appearance:'incineration',geometry:{data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[0,0,0,1,0,0,0,1,0]}}}}};
 assert.equal(checkedPromptRelief(value).prompt,'A');
 for(const broken of [{...value,geometry:null},{...value,geometry:{data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[0,NaN,0]}}}}},{...value,geometry:{...value.geometry,data:{...value.geometry.data,index:{type:'Uint16Array',array:[0,1,4]}}}}])assert.throws(()=>checkedPromptRelief(broken),/geometry|triangles/);
});

test('saved-source guard checks the effective float and index decoder before overwrite',async()=>{
 const {checkedPromptRelief,PROMPT_RELIEF_SOURCE}=await import('../inference-kiln-record.mjs');const {assertSceneSourcesReloadable}=await import('../scene-persistence-core.js');
 const base={schema:'kaminos.prompt-relief.v1',prompt:'A',appearance:'incineration',geometry:{data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[0,0,0,1,0,0,0,1,0]}}}}};
 const interleaved=structuredClone(base);Object.assign(interleaved.geometry.data.attributes.position,{isInterleavedBufferAttribute:true,data:'missing'});
 const overflow=structuredClone(base);overflow.geometry.data.attributes.position.array[0]=1e40;
 const wrappedIndex=structuredClone(base);wrappedIndex.geometry.data.attributes.position.array=Array(65537*3).fill(0);wrappedIndex.geometry.data.index={type:'Uint16Array',array:[0,1,65536]};
 for(const value of [interleaved,overflow,wrappedIndex]){assert.throws(()=>checkedPromptRelief(value),/attribute|geometry|triangles|representation/);assert.throws(()=>assertSceneSourcesReloadable([{id:'bad',type:'pbr',source:PROMPT_RELIEF_SOURCE,promptRelief:value}]),/reloadable/);}
});


test('pre-overwrite validation rejects explicit null decoder fields and unsupported legacy groups',async()=>{
 const {PROMPT_RELIEF_SOURCE}=await import('../inference-kiln-record.mjs');const core=await import('../scene-persistence-core.js');
 const base={schema:'kaminos.prompt-relief.v1',prompt:'A',appearance:'incineration',geometry:{data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[0,0,0,1,0,0,0,1,0]}}}}};
 for(const patch of [{index:null},{boundingSphere:null},{drawcalls:[{start:-3,count:99,materialIndex:0}]},{offsets:[{start:-3,count:99,materialIndex:0}]}]){
  const promptRelief=structuredClone(base);Object.assign(promptRelief.geometry.data,patch);let sent=false;
  const context={...core,fetch:async()=>{sent=true;return {ok:true,json:async()=>({saved:'existing.kaminos.json'})};},setInfo(){},compositionRestoreUrl:()=>'',readOwnerExperimentAddress:()=>({}),authoringWorkspace:null,location:{origin:'http://test',href:'http://test'},history:{replaceState(){}},savedSceneLocation:()=>'',grBrowseScenes(){}};
  sceneContext(context);vm.runInContext(source.slice(source.indexOf('async function saveToServer('),source.indexOf('function sceneIsEmpty()',source.indexOf('async function saveToServer('))),context);
  const result=await context.saveToServer({version:8,objects:[{id:'bad',type:'pbr',source:PROMPT_RELIEF_SOURCE,promptRelief}]},'existing.kaminos.json',{result:true});assert.equal(sent,false,'Invalid effective decoder fields must not reach overwrite');assert.equal(result.ok,false);assert.match(result.error,/prompt (triangles|geometry)|Unsupported saved prompt|reloadable/);
 }
});
