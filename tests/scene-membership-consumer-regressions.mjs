import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkingScene } from '../working-scene.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';
import {canCollideWithFire,checkedObjectCollision} from '../scene-collider.mjs';
import * as T from '../lib/three.core.js';
import {createWorkbenchSceneHost,disposeOwnedSceneTree} from '../workbench-scene-host.mjs';
import registrationExperiment from '../experiments/part-claims.experiment.mjs';
import {checkedSelection,createSelectionTransformTarget} from '../scene-selection.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const membershipStart = html.indexOf('function membershipEditTargetId(');
const membershipEnd = html.indexOf('function shouldIgnoreSceneObjectDeleteShortcut(', membershipStart);
assert.ok(membershipStart >= 0 && membershipEnd > membershipStart, 'production scene-membership methods must be extractable');
const membershipSource = html.slice(membershipStart, membershipEnd);
const disposeStart = html.indexOf('function disposeObjectTree(');
const disposeEnd = html.indexOf('function shouldClearSceneForImport(', disposeStart);
assert.ok(disposeStart >= 0 && disposeEnd > disposeStart, 'production object disposal must be extractable');
const disposeSource = html.slice(disposeStart, disposeEnd);

function makeRecord(id, object, overrides = {}) {
  return {
    id, object, source: `/api/ingest-mesh/${id}.glb`, type: 'glb', fileName: `${id}.glb`, label: id,
    groupId: null, createdAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  };
}

function makeSceneContext({ reloadObject = () => ({}), liveScene = null } = {}) {
  const workingScene = createWorkingScene();
  const sceneGroups = [];
  const scene = liveScene || {
    add(object) { object.parent = this; },
    remove(object) { if (object.parent === this) object.parent = null; },
  };
  const context = vm.createContext({
    structuredClone,canCollideWithFire,
    writeObjectCollision(id,value){const entry=workingScene.objects.find(e=>e.id===id);entry.collision=checkedObjectCollision(entry,value);},
    FLAME_EMITTER_ID: '@flame-emitter',FLAME_EMITTER_TYPE:'flame-emitter',CAMERA_TYPE:'camera',sceneCameras:null,sceneGiProxies:{attach(){},release(){}},
    PROCEDURAL_MESH_TYPE:'procedural-mesh',compoundRetentionTargets:new Map(),RIM_LIGHT_ID: '@rim-light',
    LOCAL_LIQUID_EMITTER_TYPE: 'local-liquid-emitter',
    workingScene,

    sceneSelection:{ids:[],activeId:null},
    scene,
    setSceneObjectMounted(entry,mounted){if(mounted)scene.add(entry.object);else scene.remove(entry.object);},
    window: { _kaminosDirty() {} },
    scenePlacementTools: { finish() {}, edits: null },
    sceneMembershipEditTargets: new Set(),
    sceneMembershipRetainedObjects: new Map(),
    sceneMembershipDisposers: new WeakMap(),
    activeSceneObjectId: null,
    activeSceneGroupId: null,
    currentMesh: null,
    hybridSplatOverlayState: { objectId: null },
    splatCorrectionMode: null,
    transformControls: null,
    sceneSaveBlockedByFailedRestore: false,
    isReloadableSceneObjectRecord: record => record?.type === 'glb' && typeof record.source === 'string',
    serializeSceneObject: entry => ({
      id: entry.id, source: entry.source, type: entry.type, fileName: entry.fileName,
      label: entry.label, groupId: entry.groupId, createdAt: entry.createdAt,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, materials: [],
    }),
    sceneObjectMetadataFor: () => null,
    restoreSceneObjectGroupsState: current => structuredClone(current),
    setSceneObjectGroupId: (entry, id) => { entry.groupId = id; },
    pruneSceneGroups() {},
    applySceneObjectTransformState() {},
    applyMaterialStateToObject() {},
    renderSceneObjectList() {},
    updateTransformInspector() {},
    stopHybridSplatOverlay() {},
    exitSplatCorrectionMode() {},
    setInfo() {},
    sceneNavigation: { prepare() {}, invalidate() {} },
    sceneObjectsForFraming: () => [],
    setActiveSceneObject(id) {
      workingScene.select(id?[id]:[],id);
      context.currentMesh = workingScene.objects.find(entry => entry.id === id)?.object || null;
    },
    setActiveSceneGroup(id) { workingScene.select(id?['@group:'+id]:[],id?'@group:'+id:null); },
    setSceneSelection(ids,activeId){workingScene.select(ids,activeId);context.setActiveSceneObject(activeId);context.renderSceneObjectList();},
    clearActiveSceneObjectSelection() {
      workingScene.clearSelection();
      context.currentMesh = null;
    },
    reloadObject,
  });
  const edits = createSceneEdits({ read: () => null, write() {} });
  context.scenePlacementTools.edits = edits;
  context.addSceneObjectFromSource = async record => {
    const object = context.reloadObject(record);
    const entry = makeRecord(record.id, object, record);
    workingScene.put(entry);
    scene.add(object);
    return object;
  };
  vm.runInContext(disposeSource, context);
  vm.runInContext(membershipSource, context);
  edits.subscribe(context.releaseUnreferencedSceneMembershipObjects);
  return { context, edits, workingScene, scene };
}

function presentGlbMethod() {
  const match = html.match(/    async presentGlb\(glb, \{runId, sha256\}\) \{[\s\S]*?\n    \},(?=\n  \};)/);
  assert.ok(match, 'production SF3D presenter must be extractable');
  return match[0].trim().replace(/,$/, '');
}

test('persisting a generated artifact does not admit it into a replacement scene', async () => {
  const { context, workingScene } = makeSceneContext();
  context.sceneMutationToken = 0;
  const sha256 = 'b'.repeat(64);
  let finishPersist;
  context.fetch = () => new Promise(resolve => { finishPersist = () => resolve({
    ok: true, json: async () => ({ sha256, source: '/api/read?root=generated-meshes&path=result.glb' }),
  }); });
  context.showGLB = async source => {
    const object = { source };
    workingScene.put(makeRecord('late-output', object, { source }));
    return object;
  };
  const presenter = vm.runInContext(`({${presentGlbMethod()}}).presentGlb`, context);
  const pending = presenter(new Uint8Array([1, 2, 3]), { runId: 'old-scene', sha256 });
  context.sceneMutationToken++;
  context.workingScene?.invalidateArrivals();
  finishPersist();
  await assert.rejects(pending, /scene changed/i);
  assert.equal(workingScene.objects.length, 0, 'the saved artifact must not enter the replacement scene');
});

test('SF3D output waits for membership replay and is recorded instead of discarded', async () => {
  const { context, edits, workingScene } = makeSceneContext();
  let blocker = 'after';
  let finishReplay;
  edits.register('@membership-replay-blocker', {
    allowMissing: true,
    read: () => blocker,
    check: value => value,
    write: value => new Promise(resolve => { finishReplay = () => { blocker = value; resolve(); }; }),
  });
  edits.recordApplied('@membership-replay-blocker', 'before', 'after', 'Block presentation during replay');

  const sha256 = 'a'.repeat(64);
  let finishPersist;
  context.fetch = () => new Promise(resolve => { finishPersist = () => resolve({
    ok: true,
    json: async () => ({ sha256, source: '/api/ingest-mesh/generated.glb' }),
  }); });
  context.showGLB = async source => {
    const object = { source };
    workingScene.put(makeRecord('generated-output', object, { source }));
    context.scene.add(object);
    return object;
  };
  const presenter = vm.runInContext(`({${presentGlbMethod()}}).presentGlb`, context);

  const replay = edits.undo();
  assert.equal(edits.state().replaying, true);
  let presentationError;
  const presentation = presenter(new Uint8Array([1, 2, 3]), { runId: 'run-1', sha256 })
    .catch(error => { presentationError = error; });
  finishPersist();
  await new Promise(resolve => setImmediate(resolve));
  finishReplay();
  await replay;
  await presentation;

  assert.equal(presentationError, undefined, 'history contention must not turn successful inference into a presentation failure');
  assert.equal(workingScene.objects.filter(entry => entry.id === 'generated-output').length, 1,
    'the retained result should be inserted once after replay settles');
  assert.equal(edits.state().undoCount, 1, 'the generated insertion should enter the same chronological scene history');
});

class TestVector3 {
  fromBufferAttribute(attribute, index) {
    this.x = attribute.getX(index); this.y = attribute.getY(index); this.z = attribute.getZ(index);
    return this;
  }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  cross(other) {
    const { x, y, z } = this;
    this.x = y * other.z - z * other.y;
    this.y = z * other.x - x * other.z;
    this.z = x * other.y - y * other.x;
    return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
}

function attribute(array, itemSize) {
  return {
    array, itemSize, count: array.length / itemSize,
    getX(index) { return array[index * itemSize]; },
    getY(index) { return array[index * itemSize + 1]; },
    getZ(index) { return array[index * itemSize + 2]; },
    setXYZ(index, x, y, z) {
      array[index * itemSize] = x; array[index * itemSize + 1] = y; array[index * itemSize + 2] = z;
    },
  };
}

function repairedMesh() {
  const texture = { disposed: false, dispose() { this.disposed = true; } };
  const position = attribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, .1, 0, 0, 0, .01, 0,
  ]), 3);
  const normal = attribute(new Float32Array(Array(15).fill(0).map((_, index) => index % 3 === 2 ? 1 : 0)), 3);
  const geometry = {
    index: { array: new Uint16Array([0, 1, 2, 0, 3, 4]), needsUpdate: false },
    attributes: { position, normal },
    disposed: false,
    dispose() { this.disposed = true; },
    getAttribute(name) { return this.attributes[name]; },
    setIndex(indices) { this.index = { array: new Uint16Array(indices), needsUpdate: false }; },
  };
  const material = { map: texture, disposed: false, dispose() { this.disposed = true; } };
  const mesh = { geometry, material, texture, traverse(callback) { callback({ isMesh: true, geometry, material }); } };
  return mesh;
}

test('membership undo restores repaired GLB geometry rather than its original source', async () => {
  const mesh = repairedMesh();
  const { context, edits, workingScene, scene } = makeSceneContext({ reloadObject: () => repairedMesh() });
  workingScene.put(makeRecord('repaired-kiln', mesh));
  scene.add(mesh);
  workingScene.select(['repaired-kiln']);
  context.currentMesh = mesh;
  context.THREE = { Vector3: TestVector3 };

  const repairStart = html.indexOf('window.reverseWinding = function()');
  const repairEnd = html.indexOf('window.toggleDoubleSided = function()', repairStart);
  const cullStart = html.indexOf('window.cullSmallFaces = function()', repairEnd);
  const cullEnd = html.indexOf('window.setGizmoMode = function(mode)', cullStart);
  assert.ok(repairStart >= 0 && repairEnd > repairStart && cullStart > repairEnd && cullEnd > cullStart,
    'production geometry repair operations must be extractable');
  vm.runInContext(html.slice(repairStart, repairEnd), context);
  vm.runInContext(html.slice(cullStart, cullEnd), context);
  vm.runInContext('window.cullSmallFaces(); window.reverseWinding(); window.flipNormals();', context);

  const expectedIndices = Array.from(mesh.geometry.index.array);
  const expectedNormals = Array.from(mesh.geometry.getAttribute('normal').array);
  assert.deepEqual(expectedIndices, [0, 2, 1], 'fixture exercises debris removal followed by winding repair');
  assert.deepEqual(expectedNormals.slice(0, 9), [-0, -0, -1, -0, -0, -1, -0, -0, -1], 'fixture exercises normal repair');

  assert.equal(vm.runInContext("removeSceneObjectInternal('repaired-kiln')", context), true);
  await edits.undo();

  const restored = workingScene.objects.find(entry => entry.id === 'repaired-kiln')?.object;
  assert.ok(restored, 'undo should restore the authored scene member');
  assert.deepEqual(Array.from(restored.geometry.index.array), expectedIndices,
    'undo must not silently replace repaired triangle indices with the source indices');
  assert.deepEqual(Array.from(restored.geometry.getAttribute('normal').array), expectedNormals,
    'undo must preserve edited normals exactly');
  assert.equal(workingScene.retained('repaired-kiln')?.object, restored,
    'history keeps the detached-object handle available for redo');

  await edits.redo();
  assert.equal(workingScene.objects.some(entry => entry.id === 'repaired-kiln'), false, 'redo should remove the member again');
  assert.equal(workingScene.retained('repaired-kiln')?.object, restored,
    'redo must retain the exact object while the future history entry still refers to it');
  assert.equal(restored.geometry.disposed, false, 'redo must not dispose geometry still needed by undo');
  assert.equal(restored.material.map, restored.texture, 'redo must preserve material maps still needed by undo');

  await edits.undo();
  const redoneRestored = workingScene.objects.find(entry => entry.id === 'repaired-kiln')?.object;
  assert.equal(redoneRestored, restored, 'undo after redo must reattach the same in-memory object');
  assert.deepEqual(Array.from(redoneRestored.geometry.index.array), expectedIndices,
    'a full undo/redo cycle must preserve repaired indices');
  assert.deepEqual(Array.from(redoneRestored.geometry.getAttribute('normal').array), expectedNormals,
    'a full undo/redo cycle must preserve repaired normals');
  assert.equal(redoneRestored.material.map, redoneRestored.texture,
    'a full undo/redo cycle must preserve material maps');

  edits.clear();
  assert.equal(Boolean(workingScene.retained('repaired-kiln')), false,
    'clearing history releases the detached-object handle');
  assert.equal(restored.geometry.disposed, false, 'dropping history for a live object must keep its geometry alive');
  assert.equal(restored.material.map, restored.texture, 'dropping history for a live object must keep its material map alive');

  assert.equal(vm.runInContext("removeSceneObjectInternal('repaired-kiln')", context), true);
  edits.clear();
  assert.equal(restored.geometry.disposed, true, 'final disposal releases detached geometry');
  assert.equal(restored.texture.disposed, true, 'final disposal releases detached textures');
  assert.equal(restored.material.disposed, true, 'final disposal releases detached materials');
  assert.equal(restored.material.map, null, 'final disposal clears the detached texture map');
});

test('removing one selected member prunes it before a surviving selection is projected',()=>{
 const {context,workingScene,scene}=makeSceneContext();
 for(const id of ['original','copy-a','copy-b']){const object=repairedMesh();workingScene.put(makeRecord(id,object));scene.add(object);}
 workingScene.select(['copy-a','copy-b'],'copy-b');
 context.renderSceneObjectList=()=>{for(const id of workingScene.selection.ids)assert.ok(workingScene.objects.some(entry=>entry.id===id),`Selection projection references removed ${id}`);};
 assert.doesNotThrow(()=>vm.runInContext("removeSceneObjectInternal('copy-a',{recordHistory:false,preserveForMembershipHistory:true})",context));
 assert.deepEqual(Array.from(workingScene.selection.ids),['copy-b']);assert.ok(workingScene.objects.some(entry=>entry.id==='copy-b'));
});


test('duplicating a grouped light changes membership through the real scene owner',()=>{
  const {context,workingScene}=makeSceneContext();
  workingScene.put(makeRecord('lamp',{}, {type:'light'}));
  workingScene.setGroups([{id:'pair',objectIds:['lamp']}]);
  Object.assign(context,{
    assertSceneConstructionAvailable(){},canDuplicateObject:()=>true,makeSceneObjectId:()=> 'copy',
    sceneObjectDisplayLabel:entry=>entry.label,sceneLightRuntimeRecipe:record=>record,
    mountSceneSpotLight:record=>workingScene.put({...record,object:{}}),
    recordSceneObjectInsertion(){},
  });
  const start=html.indexOf('function duplicateSceneObject('),end=html.indexOf('\n}',start)+2;
  vm.runInContext(html.slice(start,end),context);
  assert.equal(context.duplicateSceneObject('lamp'),'copy');
  assert.deepEqual(workingScene.groups[0].objectIds,['lamp','copy']);
  assert.equal(workingScene.find('copy').groupId,'pair');
});

test('registration preview clear, rebuild and invalidation preserve usable unrelated Undo',async()=>{
 const savedFetch=globalThis.fetch;
 const source={objects:[{id:'box',type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters:{width:2,height:2,depth:2}},transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}],provenance:{analyticalCarrier:{parts:{base:['box'],second:['box']}}}};
 globalThis.fetch=async url=>{if(url.startsWith('/api/asset-registrations'))throw Error('fixture has no storage');return {ok:true,json:async()=>source};};
 try{for(const operation of ['clear','rebuild','invalidate'])for(const motion of ['direct','combined'])for(const undone of [false,true]){
  const {context,workingScene,scene}=makeSceneContext({liveScene:new T.Scene()}),frames=new Set();
  const edits=createSceneEdits({read:id=>{const root=workingScene.objects.find(r=>r.id===id)?.object;return root?{position:root.position.toArray(),rotation:root.rotation.toArray().slice(0,3),scale:root.scale.toArray()}:null;},write:(id,p)=>{const root=workingScene.objects.find(r=>r.id===id).object;root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);}});
  context.scenePlacementTools.edits=edits;context.disposeOwnedSceneTree=disposeOwnedSceneTree;
  context.scenePlacementTools.selectionChanged=()=>{};
  Object.assign(context,{checkedSelection,burnerGraphWriting:false,activeSceneComposition:null,localLiquidSetup:null,authoringWorkspace:null,activeSceneFieldId:null,selectionTransformProxy:()=>new T.Group(),selectedSceneObjectEntry:()=>workingScene.objects.find(r=>r.id===workingScene.activeObjectId),updateSelectionFeedback(){}});
  for(const name of ['setSceneSelection','setupSelectionHistory']){const start=html.indexOf(`function ${name}(`);vm.runInContext(html.slice(start,html.indexOf('\n}',start)+2),context);}
  context.setupSelectionHistory();
  const readPose=id=>{const root=workingScene.objects.find(r=>r.id===id)?.object;if(!root)throw Error(`Selected object ${id} is absent`);return {position:root.position.toArray(),rotation:root.rotation.toArray().slice(0,3),scale:root.scale.toArray()};};
  const selectionTransform=createSelectionTransformTarget({edits,selection:()=>workingScene.selection,groups:()=>[],preferences:()=>({pivot:'median',orientation:'world'}),read:readPose,check(){},write:(id,p)=>{const root=workingScene.objects.find(r=>r.id===id).object;root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);}});
  const removeHook=html.match(/removeObject:handle=>(\{[\s\S]*?\n    \}),\n    redraw:/);assert.ok(removeHook,'actual Workbench removal hook');
  const removeObject=vm.runInContext(`handle=>${removeHook[1]}`,context);
  const registerObject=(object,options)=>{const row=makeRecord(object.uuid,object,options);workingScene.put(row);return row;};
  const shared=createWorkbenchSceneHost({scene,camera:new T.PerspectiveCamera(),controls:{target:new T.Vector3(),update(){}},loadAsset:async()=>{const root=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());scene.add(root);const row=registerObject(root,{type:'glb'});return {id:row.id,root};},registerObject,findObject:root=>workingScene.objects.find(r=>r.object===root),removeObject,redraw(){},onFrame:cb=>{frames.add(cb);return()=>frames.delete(cb);}});
  const host={scene:{...shared,objects:()=>workingScene.objects,refreshPresentation(){},setTransform:async(id,p)=>edits.apply(id,p),select:id=>context.sceneSelectionHistory.set([id])}};
  const experiment=await registrationExperiment.create({host,inputs:{settings:{alignment:{rotation:[0,0,0]}}},record(){}}),sourceId=experiment.read().sourceObjectId;
  const before=workingScene.objects.find(r=>r.id===sourceId).object.position.toArray();edits.apply(sourceId,{position:[.1,0,0]});
  await experiment.operations.compute();await experiment.operations.buildPreview();const pieceId=experiment.read().preview.pieces[0].objectId;
  await experiment.operations.selectPiece('base');await experiment.operations.selectPiece('second');
  if(motion==='direct')edits.apply(pieceId,{position:[5,6,7]});
  else{context.sceneSelectionHistory.set(experiment.read().preview.pieces.slice(0,2).map(p=>p.objectId));selectionTransform.apply({position:[5,6,7]});}
  assert.ok(edits.state().undoCount>=4);
  if(undone)while(edits.state().undoCount>1)await edits.undo();
  if(operation==='clear')await experiment.operations.clearPreview();
  if(operation==='rebuild')await experiment.operations.buildPreview();
  if(operation==='invalidate'){experiment.operations.configure({threshold:.6});for(const tick of frames)tick({});await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(workingScene.objects.some(r=>r.id===pieceId),false);assert.equal(edits.state().undoCount,1,`${operation} retires dead preview history`);
  assert.equal(edits.state().redoCount,0,`${operation} retires unavailable future references`);
  await edits.undo();assert.deepEqual(workingScene.objects.find(r=>r.id===sourceId).object.position.toArray(),before,`${operation} preserves earlier carrier Undo`);
  await edits.redo();assert.deepEqual(workingScene.objects.find(r=>r.id===sourceId).object.position.toArray(),[.1,0,0],`${operation} preserves unrelated carrier Redo`);
  await experiment.dispose();
 }}finally{globalThis.fetch=savedFetch;}
});
