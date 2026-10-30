// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import {readOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {savedSceneLocation} from '../scene-authoring.mjs';
import {fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const section=(start,end)=>{const at=html.indexOf(start);assert.ok(at>=0,start);return html.slice(at,html.indexOf(end,at));};
const fn=name=>section(`function ${name}(`,'\n}')+'\n}';
function mount({fire=true,existing=false,refused=true}={}) {
 const writes=[],messages=[],fields=new Map(),runtime={active:true,simGridDimensions:[96,192,96],gridHeight:{admitted:!refused,heightCells:384}};
 const preset={domControls:{'volume-resolution':{value:96},'volume-grid-height-ratio':{value:refused?4:2}},rendererControls:{},presentationControls:{},route:{}};
 const c=sceneContext({window:{},authoringWorkspace:null,readOwnerExperimentAddress,fireShadowSceneRoute,URLSearchParams,structuredClone,authoringBusy:false,vantageCaptureHeld:false,currentSceneFile:null,
  activeSceneComposition:existing?{}:null,volumePrototype:{debugState:()=>runtime},scenePlacementTools:null,
  sceneSaveBlockedByFailedRestore:false,planSceneRestore:data=>({objects:data.objects}),greenroomPreviewIsActive:()=>false,isFireLightFieldRoute:()=>fire,
  sceneObjects:[{id:'kiln',type:'glb'}],volumePrimitives:[],localLiquidSetup:null,sceneCameras:null,
  document:{getElementById:id=>{if(!fields.has(id))fields.set(id,{value:id==='composition-label'?'Fresh fire':'0',checked:false,disabled:false,dataset:{}});return fields.get(id);}},
  setInfo:m=>messages.push(m),compositionStatus:m=>messages.push(m),volumeCockpitLayoutReady:Promise.resolve(),
  buildVolumeSettingsPreset:()=>preset,activeVolumeSettingsPresetReceipt:null,burnerRecipe:null,
  isAuthoredKilnCollisionRoute:()=>true,fireLightFieldRouteParams:()=>new URLSearchParams('volume_light_field=1'),
  savedSceneLocation,history:{replaceState(_state,_title,url){c.location.href=url;}},location:{href:'http://localhost:61051/#authoring=1',hash:'#authoring=1',origin:'http://localhost:61051'},COMPOSITION_SCHEMA:'kaminos.stationary-flame-composition.v1',
  saveVolumeSettingsPreset:async({preset:p})=>{writes.push({kind:'basin',preset:p});return{effective:{presetId:'vsp-test',label:'Fresh fire'}};},
  buildSceneData:()=>({version:8,objects:[{id:'kiln',type:'glb',source:'/api/read?root=assets&path=kiln.glb'}],composition:c.activeSceneComposition}),
  fetch:async(url,{body})=>{writes.push({kind:'scene',body:JSON.parse(body)});return{ok:true,json:async()=>({saved:'fresh.kaminos.json'})};},
  grBrowseScenes(){},compositionRestoreUrl:(_,origin,filename)=>origin+'/#scene='+filename,
  sanitizeFileStem:s=>s,promptForFileName:async()=> 'fresh',
 });
 vm.runInContext(fn('sceneIsEmpty')+'\n'+fn('sceneSaveIsBlocked'),c);
 vm.runInContext(section('async function collectSceneComposition()','async function withAuthoringAction('),c);
 vm.runInContext(section('async function withAuthoringAction(','async function changeCompositionBasin('),c);
 vm.runInContext(section('async function saveToServer(','function sceneIsEmpty()'),c);
 vm.runInContext(section('// Save: overwrite current scene file','function getMaterialState()'),c);
 vm.runInContext(section('window.captureComposition =',"document.getElementById('composition-capture').onclick"),c);
 return{c,writes,messages,runtime,preset};
}
test('fresh and existing fire scenes refuse every persistence action before basin or scene writes',async()=>{
 for(const existing of[false,true])for(const expression of[
  'window.saveScene({result:true})','window.saveSceneAs({result:true})',
  'window.saveSceneAs({result:true,name:"fresh"})','window.captureComposition({result:true,viewportCapture:true})',
 ]){
  const m=mount({existing}),result=await vm.runInContext(expression,m.c);
  assert.equal(result.ok,false,`${existing?'existing':'fresh'}: ${expression}`);
  assert.deepEqual(m.writes,[],'refusal precedes basin and scene persistence');
  assert.match(m.messages.at(-1),/Undo.*supported dimensions/);
  assert.equal(m.runtime.gridHeight.admitted,false);assert.equal(m.preset.domControls['volume-grid-height-ratio'].value,4);
 }
});
test('an admitted replacement restores fire persistence and an unrelated mesh route remains saveable',async()=>{
 const m=mount();m.runtime.gridHeight.admitted=true;m.preset.domControls['volume-grid-height-ratio'].value=2;
 assert.equal((await m.c.window.saveScene({result:true})).ok,true);assert.deepEqual(m.writes.map(x=>x.kind),['basin','scene']);
 const mesh=mount({fire:false});assert.equal((await mesh.c.window.saveSceneAs({result:true})).ok,true);
 assert.deepEqual(mesh.writes.map(x=>x.kind),['scene']);assert.equal(mesh.writes[0].body.composition,null);
});
