// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.core.js';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('late Add Flame passes the mounted opaque surface cache to the hybrid consumer',async()=>{
  const cache={},elements=new Map();let options;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'1',parentElement:{querySelector:()=>({})}});return elements.get(id);},querySelector:()=>({})};
  const context={URLSearchParams,window:{__kaminosSurfaceLighting:cache},document,renderer:{},scene:{},volumePrototype:{},sharedGpu:{device:{}},
    isFireLightFieldRoute:()=>true,renderingMode:'',readFireShadowSceneSettings:()=>({}),
    importedModule:{mountDistributedSceneRadiance(value){options=value;return {}; }},
    bindSceneLightEditInteraction:()=>()=>{},workbenchSceneFrames:{onFrame(){}},
    createFireShadowSettings:()=>({operations:{},sync(){},mount(){}}),organizeFireRenderingPanel(){},refreshRenderingControls(){}};
  const start=source.indexOf('async function mountSceneRadianceRoute('),end=source.indexOf('async function initKaminosVolumeRoute()',start);
  const mount=source.slice(start,end).replace(/await import\([^;]+\);/,'importedModule;');
  vm.createContext(context);vm.runInContext(mount,context);
  await context.mountSceneRadianceRoute(new URLSearchParams('volume_light_field_distributed=1&volume_light_field_hybrid=1'));
  assert.equal(options.surfaceLighting,cache,'ordinary emitter must retain current main opaque irradiance reuse');
});

test('ordinary Add Flame selects live four-source lighting without altering its saved basin',async()=>{
  const settings={source:{presetId:'saved-basin'},domControls:Object.fromEntries(Object.entries({
    'volume-emitter-source-law':'immersed-source','volume-pressure-solver':'converged-open-top',
    'volume-advection-scheme':'maccormack','volume-time-step':'uniform','volume-physical-mode':'2',
  }).map(([key,value])=>[key,{value}]))};
  let applied;
  const context={activeSceneComposition:null,volumePrototype:{},authoringBusy:false,
    assertSceneConstructionAvailable(){},firstFlameFieldState:()=>({}),loadAuthoredFlameBasin:async()=>settings,
    COMPOSITION_SCHEMA:'test',FLAME_EMITTER_ID:'flame-emitter',setActiveSceneObject(){},setInfo(){},
    scenePlacementTools:{edits:{state:()=>({}),async applySettled(id,value){applied=value;context.activeSceneComposition=value.composition;}}}};
  const start=source.indexOf('async function addFirstFlameField('),end=source.indexOf('async function openFirstFlameFieldDialog',start);
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  await context.addFirstFlameField('saved-basin');
  assert.equal(applied.route.volume_light_field_shared_source,'1','ordinary emitter must request the shared source');
  assert.equal(applied.route.volume_light_field_hybrid,'1');
  assert.equal(applied.route.volume_light_field_hybrid_shadow_resolution,'12');
  assert.equal(applied.route.volume_light_field_hybrid_shadow_grain,'screen-animated');
  assert.equal(applied.settings,settings,'do not replace or recolor the saved flame to light the scene');
  context.activeSceneComposition=null;settings.domControls['volume-physical-mode'].value='0';
  await context.addFirstFlameField('saved-basin');
  assert.equal(applied.route.volume_light_field_shared_source,undefined,'a replay basin must not mount an unsupported emissive export');
  assert.equal(applied.settings.domControls['volume-physical-mode'].value,'0');
});

test('first-field writes await lighting synchronization before resuming, including undo',async()=>{
  const events=[],location={href:'http://localhost/#authoring=1'};
  const context={URL,URLSearchParams,structuredClone,location,history:{state:null,replaceState(a,b,url){location.href=String(url);}},
    volumePrototype:{setActive:async value=>events.push(['active',value]),setSceneCompositionPresentation(){}},
    activeSceneComposition:null,authoredFlamePresent:false,activeSceneFieldId:null,
    writeFlameSettingsState(){},ensureAuthoredFlameEmitter(){},renderSceneObjectList(){},refreshRenderingControls(){},flameInspector:null,
    fireLightFieldRouteParams:()=>new URLSearchParams(),window:{},async syncSceneRadianceRoute(){await Promise.resolve();events.push(['lighting',!!context.activeSceneComposition]);}};
  const start=source.indexOf('function writeFirstFlameFieldStateUnchecked('),end=source.indexOf('async function addFirstFlameField',start);
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  await context.writeFirstFlameFieldStateUnchecked({composition:{},sourcePresent:true,settings:{},route:{volume_light_field:'1'}});
  assert.deepEqual(events,[['active',false],['lighting',true],['active',true]]);
  events.length=0;
  await context.writeFirstFlameFieldStateUnchecked({composition:null,sourcePresent:false,settings:{},route:{}});
  assert.deepEqual(events,[['active',false],['lighting',false],['active',false]],'undo must remove the consumer, not strand canRender on an absent source');
});

test('lighting route mounts are idempotent and serialized with undo and failed imports',async()=>{
  const events=[],window={};let finish;
  const context={URLSearchParams,window,JSON,
    document:{getElementById:()=>({hidden:false,replaceChildren(){events.push('clear-controls');}})},
    volumePrototype:{setSceneVolumeSourceEnabled:value=>events.push(['source',value])},
    refreshRenderingControls(){},
    async mountSceneRadianceRoute(params){
      events.push('mount');
      if(params.get('fail'))throw Error('observed import failure');
      window.__kaminosSceneRadiance={dispose(){events.push('dispose');}};
      await new Promise(resolve=>{finish=resolve;});
    }};
  const start=source.indexOf('let sceneRadianceRouteTask='),end=source.indexOf('async function mountSceneRadianceRoute(',start);
  assert(start>=0&&end>start,'shared mount lifecycle must exist');
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const on=new URLSearchParams('volume_light_field_shared_source=1');
  const mounting=context.syncSceneRadianceRoute(on),repeat=context.syncSceneRadianceRoute(on);
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  finish();await Promise.all([mounting,repeat]);
  assert.equal(events.filter(x=>x==='mount').length,1);
  context.debugView={dispose(){events.push('dispose-debug');}};
  vm.runInContext('sceneRadianceDebugView=debugView',context);
  const off=context.syncSceneRadianceRoute(new URLSearchParams());await off;
  assert.equal(events.filter(x=>x==='dispose').length,1);assert.equal(window.__kaminosSceneRadiance,null);
  assert.equal(events.filter(x=>x==='dispose-debug').length,1,'debug subscriptions follow the same serialized lifetime');
  await assert.rejects(context.syncSceneRadianceRoute(new URLSearchParams('volume_light_field_shared_source=1&fail=1')),/observed import failure/);
  assert.equal(window.__kaminosSceneRadianceSetup.status,'failed');
  await context.syncSceneRadianceRoute(new URLSearchParams());
  assert.equal(window.__kaminosSceneRadianceSetup.status,'inactive','failed mounting must not poison later scene edits');
});

test('the actual domain helper retires when its field is absent and survives toggles',()=>{
  let flameDomainGuide=null,activeSceneComposition={},flameDomainDraft=null,flameDomainProxy=null;
  const isSceneItemVisible=()=>true;
  const scene=new THREE.Scene(),selectionCaptureSuspended=false,viewportHelpersVisible=true;
  const viewportDisplay={domains:true,domainOpacity:1,domainWidth:1},transformControls=null;
  const acceptedFlameDomainPose=()=>({position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]});
  const domainTransformForPose=()=>({translation:[0,0,0],scale:1}),flameDomainTopY=()=>3,styleHelperLines=()=>{},styleSimulationDomainGuide=()=>{};
  const document={getElementById:()=>null},window={_kaminosDirty:()=>{}};
  const a=source.indexOf('function refreshFlameDomainPreview()'),b=source.indexOf('function writeFlameDomainPreview',a);
  const refresh=eval('('+source.slice(a,b)+')');refresh();assert.equal(flameDomainGuide.visible,true);
  activeSceneComposition=null;refresh();assert.equal(flameDomainGuide.visible,false);
  viewportDisplay.domains=false;refresh();viewportDisplay.domains=true;refresh();assert.equal(flameDomainGuide.visible,false);
  activeSceneComposition={};refresh();assert.equal(flameDomainGuide.visible,true);assert.equal(scene.children.length,1);
});

test('both actual GI graph arms retain the mounted water host linear input',()=>{
  for(const cached of [false,true]) {
    const sceneGISettings={mode:'gtao',view:'scene',denoise:1,temporal:false},document={body:{dataset:{}}},localLiquidHost={};
    const scenePass={},prePassDepth={},prePassNormal={},sceneGI={debugState:()=>({filterImplementation:'shared'})};let activeSceneDepth,fireLightFieldPass;
    let rawSceneOutput,outlinedSceneOutput,outlinedCameraOutput,sceneEmissiveCamera=null;
    const renderPipeline={outputColorTransform:false},selectionFeedback={output:x=>x};
    const sharedGpu={device:{}},isFireLightFieldRoute=()=>true,fireLightFieldRouteParams=()=>new URLSearchParams();
    const refreshRenderingControls=()=>{},createFireLightFieldReceiverPass=()=>({outputNode:{}});
    const giOutputGraphs=new Map(cached?[['shared:gtao:true:false:true:false',{rawSceneOutput:{},outlinedSceneOutput:{},outlinedCameraOutput:null,sceneEmissiveCamera:null,fireLightFieldPass:{}}]]:[]);
    const a=source.indexOf('  function rebuildSceneGIOutput()'),b=source.indexOf('  updateSceneGI =',a);
    const rebuild=eval('('+source.slice(a,b).trim()+')');rebuild();assert.equal(renderPipeline.outputColorTransform,false);
  }
});
