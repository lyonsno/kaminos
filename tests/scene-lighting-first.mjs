// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneLifecycle} from '../scene-lifecycle.mjs';
import * as THREE from '../lib/three.core.js';

const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=page.indexOf('async function loadSceneObjects('),b=page.indexOf('\nfunction writeAuthoredCameraView',a);
assert.ok(a>=0&&b>a);
function fixture(compile=async()=>{}){
 const scene=createWorkingScene(),events=[];
 const lifecycle=createSceneLifecycle({scene,roots:{detach(){},dispose(){}},
  records:{load:async record=>{events.push('construct:'+record.id);const object=new THREE.Group();scene.put({...record,object});return object;},restore(){}},
  groups:{restore:groups=>scene.setGroups(groups)},selection:{object:id=>scene.select(id?[id]:[],id),group(){}},
  context:{loaded:()=>events.push('water/ash initialization')},
 });
 const context=vm.createContext({sceneLifecycle:lifecycle,activeSceneComposition:null,authoredFlamePresent:false,
  ASH_OBJECT_TYPE:'retained-ash',ASH_SOURCE_TYPE:'ash-source',sceneLoadRequests:scene.loads,
  sceneGeometryPreview:{present:async()=>events.push('neutral'),presentLighting:async()=>{events.push('lit');return true;}},
  sceneLightingPreparation:{request:async()=>{events.push('compile');await compile();}},
  viewportDisplay:{hiddenIds:[]},sceneVisibilityContext:()=>({objects:scene.objects,groups:scene.groups}),itemVisible:()=>true,
 });
 vm.runInContext(page.slice(a,b),context);
 return {scene,events,load:context.loadSceneObjects};
}
test('the actual page adapter restores and presents lighting before ash construction and water startup',async()=>{
 const f=fixture(),id=f.scene.loads.begin();
 const records=[{id:'ash',type:'retained-ash'},{id:'mesh',type:'glb'},{id:'spot',type:'light'}];
 assert.equal(await f.load(records,'mesh',[],null,{},id,()=>f.events.push('saved lighting')),true);
 assert.deepEqual(f.events,['construct:mesh','construct:spot','neutral','saved lighting','compile','lit','construct:ash','water/ash initialization']);
 assert.deepEqual(f.scene.objects.map(row=>row.id),records.map(row=>row.id));
});
test('supersession during the real adapter lighting preparation cannot draw or start old domains',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),f=fixture(()=>gate),id=f.scene.loads.begin();
 const pending=f.load([{id:'mesh'},{id:'ash',type:'retained-ash'}],null,[],null,null,id,()=>f.events.push('saved lighting'));
 await new Promise(resolve=>setImmediate(resolve));f.scene.loads.invalidate();release();
 assert.equal(await pending,false);assert.deepEqual(f.events,['construct:mesh','neutral','saved lighting','compile']);
});

function pageFunction(name,end){
 const a=page.indexOf('function '+name+'('),b=page.indexOf(end,a);
 assert.ok(a>=0&&b>a,'actual page function '+name);return page.slice(a,b);
}
function lightingFrame({mode='combined',view='scene',draw=()=>{}}={}){
 const events=[],output={},base={},bloom={},oldOutput={},camera={updateMatrixWorld:()=>events.push('camera')};
 const renderer={toneMapping:'prior'},pipeline={outputNode:oldOutput,outputColorTransform:false,render(){events.push('draw');draw();}};
 const visible=id=>id==='visible',c=vm.createContext({
  syncViewportRendererSize:()=>events.push('resize'),camera,renderer,renderPipeline:pipeline,
  sceneGISettings:{mode,view},sceneGI:{output:value=>{assert.equal(value,view);events.push('GI');return base;}},scenePass:base,
  sceneBloom:{output:(node,emission)=>{assert.equal(node,base);assert.equal(emission,output);events.push('bloom');return bloom;}},sceneEmissionSource:output,
  THREE:{ACESFilmicToneMapping:'aces',AgXToneMapping:'agx'},document:{getElementById:()=>({value:'custom'})},
  sceneExposureControls:{sync:()=>events.push('exposure')},viewportVisibilityObjects:()=>['objects'],
  withViewportVisibility:(objects,predicate,run)=>{assert.deepEqual(objects,['objects']);assert.equal(predicate,visible);events.push('visibility');return run();},
  sceneBeautyLods:{withFrame:(cam,options,run)=>{assert.equal(cam,camera);assert.equal(options,'saved-lods');events.push('lods');return run();}},
  currentBeautyFrameOptions:()=> 'saved-lods',
 });
 vm.runInContext(pageFunction('presentSceneRestoreLightingFrame','  function rebuildSceneGIOutput('),c);
 return {events,renderer,pipeline,oldOutput,base,bloom,visible,render:c.presentSceneRestoreLightingFrame};
}
test('the actual provisional draw uses ordinary saved GI and bloom and balances pipeline state',()=>{
 const f=lightingFrame({draw(){assert.equal(f.pipeline.outputNode,f.bloom);assert.equal(f.renderer.toneMapping,'aces');}});
 assert.equal(f.render({isVisible:f.visible,isCurrent:()=>true}),true);
 assert.deepEqual(f.events,['resize','camera','GI','bloom','exposure','visibility','lods','draw']);
 assert.equal(f.pipeline.outputNode,f.oldOutput);assert.equal(f.pipeline.outputColorTransform,false);assert.equal(f.renderer.toneMapping,'prior');
});
test('lighting diagnostics and non-GI settings use their actual ordinary output without adding bloom to diagnostics',()=>{
 for(const settings of [{mode:'combined',view:'incoming'},{mode:'gtao',view:'scene'}]){
  const f=lightingFrame({...settings,draw:()=>assert.equal(f.pipeline.outputNode,settings.view==='incoming'?f.base:f.bloom)});
  assert.equal(f.render({isVisible:f.visible,isCurrent:()=>true}),true);
  assert.equal(f.events.includes('bloom'),settings.view!=='incoming');assert.equal(f.events.includes('GI'),settings.mode==='combined');
 }
});
test('failed or superseded ordinary lighting cannot claim a displayed frame or leave the pipeline replaced',()=>{
 const f=lightingFrame({draw:()=>{throw Error('native draw failed');}});
 assert.throws(()=>f.render({isVisible:f.visible,isCurrent:()=>true}),/native draw failed/);
 assert.equal(f.pipeline.outputNode,f.oldOutput);assert.equal(f.pipeline.outputColorTransform,false);assert.equal(f.renderer.toneMapping,'prior');
 const stale=lightingFrame();assert.equal(stale.render({isVisible:stale.visible,isCurrent:()=>false}),false);assert.deepEqual(stale.events,[]);
});

test('saved lighting recipe preserves authored postprocessing and resets unsaved GI tuning',()=>{
 const events=[],elements=new Map(),node=id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);};
 const c=vm.createContext({document:{getElementById:node},restoreFireRendering:(doc,value)=>events.push(['fire',value]),
  sceneBloom:{set:value=>events.push(['bloom',value])},checkedSceneBloom:value=>value,bloomControls:{sync:()=>events.push(['bloom controls'])},
  setSceneGIControls:value=>events.push(['GI',value]),sceneAO:{restoreDocument:value=>events.push(['AO',value])},saveSettings:()=>events.push(['save']),
 });
 vm.runInContext(pageFunction('restoreSavedSceneLighting','async function applySceneDocument('),c);
 const settings={fireLighting:{gain:3},bloom:{enabled:true},sceneGI:{gain:2,radius:8},ao:{intensity:1.5},dof:{enabled:true,focus:2,aperture:.005,maxblur:.02}};
 c.restoreSavedSceneLighting({postprocessing:settings});
 assert.deepEqual(events,[['fire',settings.fireLighting],['bloom',settings.bloom],['bloom controls'],['GI',settings.sceneGI],['AO',settings.ao],['save']]);
 assert.equal(node('dof-toggle').checked,true);assert.equal(node('dof-focus').value,2);assert.equal(node('dof-aperture-val').textContent,'0.0050');
 events.length=0;c.restoreSavedSceneLighting({});assert.deepEqual(JSON.parse(JSON.stringify(events)),[['fire',null],['bloom',{}],['bloom controls'],['GI',{}]]);
});
