// kaminos-test: node
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneLifecycle} from '../scene-lifecycle.mjs';
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import { checkedSceneLightRecord } from '../scene-spot-light.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(start, end) {
  const begin = html.indexOf(start), finish = html.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `production functions: ${start}`);
  return html.slice(begin, finish);
}

function context() {
  const scene = new THREE.Scene();
  const state = sceneContext({
    activeSceneComposition:null,THREE, checkedSceneLightRecord, structuredClone,viewportHelpersVisible:true,sceneSelection:{ids:[],activeId:null},
    scene, sceneObjects: [], sceneGroups: [], rimLight: new THREE.SpotLight(), RIM_LIGHT_ID: '@rim-light',
    window: { _kaminosDirty() {} }, document: { getElementById: () => ({ checked: false, classList: { remove() {} } }) },
    sceneMutationToken: 0, greenroomPreviewGeneration: 0, greenroomPreviewState: null,
    VOLUME_PRIMITIVE_SCHEMA: 'kaminos.volume-primitives.v0',
    activeSceneObjectId: null, activeSceneGroupId: null, activeSceneFieldId: 'flame-field',
    currentMesh: null, currentSceneFile: 'kiln.kaminos.json', sceneSaveBlockedByFailedRestore: false,
    modelSourceUrl: '/kiln.glb', modelSourceType: 'glb', glbFileName: 'kiln.glb', transformControls: null,
    getVolumePrimitiveState: () => ({ primitives: [] }), setVolumePrimitivesState() {},
    renderSceneObjectList() {}, updateTransformInspector() {}, updateGreenroomPreviewControls() {},
    sceneObjectTransformState: object => ({ position: object.position.toArray(), rotation: [object.rotation.x, object.rotation.y, object.rotation.z], scale: object.scale.toArray() }),
    applySceneObjectTransformState(object, pose) { object.position.fromArray(pose.position); object.rotation.set(...pose.rotation); object.scale.fromArray(pose.scale); },
    serializeSceneObject: entry => ({ ...entry, object: undefined }),
    greenroomMeshMetadata: () => ({}), setInfo() {}, console: { warn() {} }, disposeObjectTree() {},
    previewTransformState: () => ({}), applyPreviewTransformState() {},
  });
  state.workingScene=createWorkingScene();state.createSceneLifecycle=createSceneLifecycle;
  for(const [name,get,set] of [
    ['sceneObjects',()=>state.workingScene.objects,value=>state.workingScene.replaceObjects(value)],
    ['sceneGroups',()=>state.workingScene.groups,value=>state.workingScene.setGroups(value)],
    ['sceneSelection',()=>state.workingScene.selection,value=>state.workingScene.select(value.ids,value.activeId,['flame-field','water-field'])],
    ['activeSceneObjectId',()=>state.workingScene.activeObjectId],['activeSceneGroupId',()=>state.workingScene.activeGroupId],['activeSceneFieldId',()=>state.workingScene.activeFieldId],
  ])Object.defineProperty(state,name,{get,set,configurable:true});
  state.setSceneSelection=(ids,id=ids.at(-1)??null)=>state.workingScene.select(ids,id,['flame-field','water-field']);
  state.setActiveSceneObject=id=>state.setSceneSelection(id?[id]:[],id);
  state.setActiveSceneGroup=id=>state.setSceneSelection(['@group:'+id]);
  state.window.selectSceneField=id=>state.setSceneSelection([id]);
  state.setSceneGroupsFromRecords=rows=>state.workingScene.setGroups(rows);
  state.workingScene.select(['flame-field'],'flame-field',['flame-field']);
  state.recordedInsertions = [];
  state.recordSceneObjectInsertion = async id => { state.recordedInsertions.push(id); return true; };
  state.sceneObjectRecordForDescendant = object => state.sceneObjects.find(entry => entry.object === object);
  state.showGLB = async (url, options) => {
    const object = new THREE.Group(); object.name = url; scene.add(object);
    if (options.register !== false) state.workingScene.put({ id: url, type: 'glb', object });
    return object;
  };
  state.applyGiProxySetting = () => {}; state.sceneGiProxies = { release() {} };
  vm.runInContext(source('const sceneSpotLights=new Map();', 'function groupPivotPose('), state);
  vm.runInContext(source('function greenroomPreviewIsActive()', 'function greenroomPreviewDebugState('), state);
  vm.runInContext(source('function nextGreenroomPreviewGeneration(', 'function updateGreenroomPreviewControls('), state);
  vm.runInContext(source('function removeGreenroomPreviewObject(', 'function sceneObjectTransformState('), state);
  vm.runInContext(source('async function restoreAuthoredSceneFromPreview(', 'function sceneObjectReloadabilityLabel('), state);
  vm.runInContext(source('async function greenroomViewMesh(', 'function createSplatSceneObjectPlaceholder('), state);
  vm.runInContext(source('async function importGreenroomPreviewToScene(', 'function addGreenroomMeshActions('), state);
  vm.runInContext(source('function restoreLoadedSceneRecord(', 'async function loadSceneObjects('),state);
  vm.runInContext(source('function createPageSceneLifecycle(', 'function loadTexture(').replace('const sceneLifecycle=createPageSceneLifecycle();',''),state);
  state.sceneLifecycle=state.createPageSceneLifecycle();
  for (const [id, enabled] of [['spot-on', true], ['spot-off', false], ['@rim-light', true]]) {
    state.mountSceneSpotLight({ id, type: 'light', source: 'kaminos:scene-spot-light',
      transform: { position: [2, 3, 4], rotation: [-.6, .7, 0], scale: [1, 1, 1] },
      light: { kind: 'spot', enabled, color: '#faf0e0', intensity: 30, angle: 30, penumbra: .3, aimDistance: 3 } });
  }
  state.originalRecords = [...state.sceneObjects];
  return state;
}

function assertDetached(state) {
  assert.equal(state.sceneObjects.length, 0);
  for (const light of state.window.kaminosSceneLightState()) {
    assert.equal(light.parentIsScene, false, `${light.id}: runtime light must leave authored scene`);
    assert.equal(light.markerIsScene, false, `${light.id}: marker must leave authored scene`);
  }
  assert.equal(state.scene.children.filter(child => child.isSpotLight).length, 0);
}
function assertRestored(state, original) {
  assert.equal(state.greenroomPreviewState, null);
  for (const entry of state.originalRecords) assert.equal(state.sceneObjects.find(record => record.id === entry.id), entry);
  assert.deepEqual(state.window.kaminosSceneLightState(), original);
  assert.equal(state.scene.children.filter(child => child.isSpotLight).length, 3, 'exactly one instance of each retained light');
}

test('temporary View removes complete light bindings and Back restores accepted data and field selection', async () => {
  const state = context(), original = state.window.kaminosSceneLightState();
  await state.greenroomViewMesh('/preview.glb', 'preview.glb', {});
  assertDetached(state);
  await state.restoreAuthoredSceneFromPreview();
  assertRestored(state, original);
  assert.equal(state.activeSceneFieldId, 'flame-field');
});

test('View-to-Import restores original bindings once before appending the preview', async () => {
  const state = context(), original = state.window.kaminosSceneLightState();
  await state.greenroomViewMesh('/preview.glb', 'preview.glb', {});
  assertDetached(state);
  assert.equal(await state.importGreenroomPreviewToScene(), true);
  assertRestored(state, original);
  assert.equal(state.sceneObjects.filter(entry => entry.id === '/preview.glb').length, 1);
  assert.deepEqual(state.recordedInsertions, ['/preview.glb'], 'accepted preview import joins ordinary insertion history');
});

test('direct asset Import records its registered instance in ordinary scene history', async () => {
  const state = context();
  await state.greenroomImportMesh('/direct.glb', 'direct.glb', {});
  assert.deepEqual(state.recordedInsertions, ['/direct.glb']);
});

test('failed View and a late completion after Back preserve original light identity', async () => {
  const state = context(), original = state.window.kaminosSceneLightState();
  state.showGLB = async () => { throw new Error('retained load failure'); };
  await assert.rejects(state.greenroomViewMesh('/failed.glb', 'failed.glb', {}), /retained load failure/);
  assertRestored(state, original);
  let complete;
  state.showGLB = () => new Promise(resolve => { complete = resolve; });
  const loading = state.greenroomViewMesh('/late.glb', 'late.glb', {});
  await new Promise(resolve=>setImmediate(resolve));
  assertDetached(state);
  await state.restoreAuthoredSceneFromPreview();
  const late = new THREE.Group(); state.scene.add(late); complete(late);
  await loading;
  assertRestored(state, original);
  assert.equal(late.parent, null, 'stale preview cannot reattach authored or preview objects');
});

test('clearing during preview releases the detached authored roots',async()=>{
 const state=context(),root=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());state.scene.add(root);
 state.workingScene.put({id:'authored-mesh',type:'glb',source:'/authored.glb',object:root});let disposed=0;
 state.disposeObjectTree=object=>{if(object===root)disposed++;};
 await state.greenroomViewMesh('/preview.glb','preview.glb',{});
 Object.assign(state,{authoringControlSessions:[],sceneControlHistory:null,scenePlacementTools:null,sceneCameras:null,
 groupProxies:new Map(),meshDataTargets:new Set(),flameSourceDataTargets:new Set(),colliderEditTargets:new Set(),burnableEditTargets:new Set(),giProxyEditTargets:new Set(),groupEditTargets:new Set(),proceduralMeshes:new Map(),sceneColliderCollection:{clear(){}},sceneGiProxies:{clear(){},release(){}},
 localLiquidDomainGuide:null,flameDomainGuide:null,localLiquidGeneration:0,localLiquidHost:null});
 state.sceneLoadRequests=state.workingScene.loads??{invalidate(){},isCurrent:()=>false};
 state.sceneLifecycle=state.createPageSceneLifecycle();await state.clearScene();
 assert.equal(disposed,1,'whole-scene clear must release authored roots parked outside the preview');
 assert.equal(state.greenroomPreviewState,null);assert.equal(await state.restoreAuthoredSceneFromPreview(),false);
});

for(const kind of ['mesh','splat','preview'])test(`superseded preview return aborts ${kind} import`,async()=>{
 const state=context();await state.greenroomViewMesh('/preview.glb','preview.glb',{});
 let finish,started;const retiring=new Promise(resolve=>started=resolve);
 state.restoreAuthoredSceneFromPreview=()=>{started();return new Promise(resolve=>{finish=resolve;});};
 state.createSceneObjectPublicationGuard=()=>()=>true;
 state.shouldClearSceneForImport=()=>false;
 state.greenroomSplatMetadata=()=>{throw Error('Superseded splat import continued');};
 vm.runInContext(source('async function greenroomImportSplat(', 'window.greenroomImportSplat ='),state);
 const pending=kind==='mesh'?state.greenroomImportMesh('/stale.glb','stale.glb',{}):kind==='splat'?state.greenroomImportSplat('/stale.ply','stale.ply',{}):state.importGreenroomPreviewToScene();
 await retiring;state.workingScene.loads.invalidate();state.workingScene.discardSuspendedMembership();finish(false);
 assert.ok(!await pending);
 assert.deepEqual(state.recordedInsertions,[]);
 assert.equal(state.sceneObjects.length,0,'no stale asset in the replacement document');
});

test('preview retirement releases dependent lighting and Back restores its accepted settings',async()=>{
 const state=context(),events=[];
 state.fireLightFieldRouteParams=()=>new URLSearchParams('volume_light_field=1&volume_light_field_shared_source=1');
 state.fireShadowSceneRoute=()=>({volume_light_field_hybrid_shadow_resolution:'128'});
 state.syncSceneRadianceRoute=async params=>{events.push(Object.fromEntries(params));};
 await state.flameFeature.restore({present:true,composition:false});
 await state.greenroomViewMesh('/preview.glb','preview.glb',{});
 assert.deepEqual(events.at(-1),{},'retired producer must release scene lighting consumer before displaying preview');
 await state.restoreAuthoredSceneFromPreview();
 assert.equal(events.at(-1).volume_light_field_shared_source,'1');
 assert.equal(events.at(-1).volume_light_field_hybrid_shadow_resolution,'128','retain accepted lighting settings across temporary preview');
});

test('an older Back cannot adopt the generation of a later replacing GLB import',async()=>{
 const state=context();await state.greenroomViewMesh('/preview.glb','preview.glb',{});
 let active=true,release,started;const gate=new Promise(r=>release=r),retiring=new Promise(r=>started=r);
 state.volumePrototype={isActive:()=>active,setActive:async value=>{if(!value){started();await gate;}active=value;}};
 Object.assign(state,{authoringControlSessions:[],sceneControlHistory:null,scenePlacementTools:null,sceneCameras:null,
 groupProxies:new Map(),meshDataTargets:new Set(),flameSourceDataTargets:new Set(),colliderEditTargets:new Set(),burnableEditTargets:new Set(),giProxyEditTargets:new Set(),groupEditTargets:new Set(),proceduralMeshes:new Map(),sceneColliderCollection:{clear(){}},
 localLiquidDomainGuide:null,flameDomainGuide:null,sceneNavigation:null,sceneGiProxies:{clear(){},release(){}},
 shouldClearSceneForImport:()=>true,resolveAssetArrivalMode:()=> 'preserve',applyAssetArrival:()=>false,
 GLTFLoader:class{load(url,done){const scene=new THREE.Group();scene.name=url;done({scene});}},
 registerSceneObject(object,metadata){const row={id:'replacement',object,...metadata};state.workingScene.put(row);return row;},
 });
 state.document.getElementById=()=>({classList:{add(){},remove(){}}});
 const start=html.indexOf('async function showGLB('),end=html.indexOf('\n}',start)+2;vm.runInContext(html.slice(start,end),state);
 const back=state.restoreAuthoredSceneFromPreview();await retiring;
 const replacing=state.showGLB('/replacement.glb',{clear:true});await new Promise(r=>setImmediate(r));release();
 assert.equal(await back,false,'obsolete Back must yield to the later replacing operation');
 assert.ok(await replacing,'newer import must not be silently discarded');
 assert.deepEqual(state.workingScene.objects.map(row=>row.id),['replacement']);assert.equal(state.greenroomPreviewState,null);
});

 test('overlapping View preserves the original authored presence',async()=>{
 const state=context();await state.flameFeature.restore({present:true,composition:false});
 let release,started;const gate=new Promise(r=>release=r),retiring=new Promise(r=>started=r);
 state.volumePrototype={isActive:()=>true,setActive:async value=>{if(!value){started();await gate;}}};
 const first=state.greenroomViewMesh('/first.glb','first.glb',{});await retiring;
 const second=state.greenroomViewMesh('/second.glb','second.glb',{});release();
 await Promise.all([first,second]);
 assert.equal(state.greenroomPreviewState.authored.flamePresent,true,'second View must retain original authored presence');
 assert.equal(await state.restoreAuthoredSceneFromPreview(),true);assert.equal(state.flameFeature.present,true);
 });
test('Back during preview retirement restores the original scene without waiting for asset loading',async()=>{
 const state=context();await state.flameFeature.restore({present:true,composition:false});
 let active=true,release,started;const gate=new Promise(r=>release=r),retiring=new Promise(r=>started=r);
 state.volumePrototype={isActive:()=>active,setActive:async value=>{if(!value){started();await gate;}active=value;}};
 const viewing=state.greenroomViewMesh('/pending.glb','pending.glb',{});await retiring;
 const back=state.restoreAuthoredSceneFromPreview();release();await viewing;
 assert.equal(await back,true);assert.equal(state.greenroomPreviewState,null);assert.equal(state.flameFeature.present,true);
 assert.deepEqual(state.workingScene.objects.map(r=>r.id),state.originalRecords.map(r=>r.id));
});
test('switching preview retires admitted runtime work before removing its object',async()=>{
 const state=context();await state.greenroomViewMesh('/first.glb','first.glb',{});
 const original=state.greenroomPreviewState.previewObject;
 let active=true,release,started;const gate=new Promise(r=>release=r),retiring=new Promise(r=>started=r);
 state.volumePrototype={isActive:()=>active,setActive:async value=>{if(!value){started();await gate;}active=value;}};
 const switching=state.greenroomViewMesh('/second.glb','second.glb',{});
 await new Promise(r=>setImmediate(r));
 assert.equal(original.parent,state.scene,'keep the old preview drawable while retirement is pending');
 release();await switching;assert.equal(active,false);assert.equal(original.parent,null);
 assert.equal(state.greenroomPreviewState.preview.url,'/second.glb');
});

test('View during Back lighting restoration retains original authored presence',async()=>{
 const state=context();state.fireLightFieldRouteParams=()=>new URLSearchParams('volume_light_field=1');
 await state.flameFeature.restore({present:true,composition:false});await state.greenroomViewMesh('/first.glb','first.glb',{});
 let release,started;const gate=new Promise(r=>release=r),lighting=new Promise(r=>started=r);
 state.syncSceneRadianceRoute=async params=>{if(params.get('volume_light_field')){started();await gate;}};
 const back=state.restoreAuthoredSceneFromPreview();await lighting;
 const viewing=state.greenroomViewMesh('/second.glb','second.glb',{});release();await Promise.all([back,viewing]);
 assert.equal(state.greenroomPreviewState.authored.flamePresent,true);
 await state.restoreAuthoredSceneFromPreview();assert.equal(state.flameFeature.present,true);
});
test('Import cannot combine incoming preview metadata with the outgoing object during retirement',async()=>{
 const state=context();await state.greenroomViewMesh('/first.glb','first.glb',{});
 const importButton={disabled:false},panel={querySelector:()=>importButton};
 state.document.getElementById=id=>id==='greenroom-preview-controls'?panel:{classList:{add(){},remove(){}}};
 vm.runInContext(source('function updateGreenroomPreviewControls()', 'function removeGreenroomPreviewObject('),state);
 let active=true,release,started;const gate=new Promise(r=>release=r),retiring=new Promise(r=>started=r);
 state.volumePrototype={isActive:()=>active,setActive:async value=>{if(!value){started();await gate;}active=value;}};
 const switching=state.greenroomViewMesh('/second.glb','second.glb',{});await retiring;
 assert.equal(importButton.disabled,true,'pending preview cannot be imported through the visible control');
 const importing=state.importGreenroomPreviewToScene();release();await switching;
 assert.equal(await importing,false,'incoming preview has not loaded yet');assert.deepEqual(state.recordedInsertions,[]);
 assert.equal(importButton.disabled,false);assert.equal(await state.importGreenroomPreviewToScene(),true);
 assert.deepEqual(state.recordedInsertions,['/second.glb']);
});
