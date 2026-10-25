// kaminos-test: node
import {createWorkingScene} from '../working-scene.mjs';
import {createSceneLifecycle} from '../scene-lifecycle.mjs';
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
import { checkedSceneLightRecord, sceneLightRuntimeRecipe } from '../scene-rim-light.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(start, end) {
  const begin = html.indexOf(start), finish = html.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `production functions: ${start}`);
  return html.slice(begin, finish);
}

function context() {
  const scene = new THREE.Scene();
  const state = sceneContext({
    THREE, checkedSceneLightRecord, sceneLightRuntimeRecipe, structuredClone,viewportHelpersVisible:true,sceneSelection:{ids:[],activeId:null},
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
  state.updateRimLight = () => { state.rimLight.visible = false; };
  state.setRimLight = recipe => { state.rimLight.visible = recipe.enabled; };
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
 state.sceneLifecycle=state.createPageSceneLifecycle();state.clearScene();
 assert.equal(disposed,1,'whole-scene clear must release authored roots parked outside the preview');
 assert.equal(state.greenroomPreviewState,null);assert.equal(await state.restoreAuthoredSceneFromPreview(),false);
});
