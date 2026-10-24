// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createWorkingScene } from '../working-scene.mjs';
import {createSceneMembershipOperations} from '../scene-membership-operations.mjs';
import { createSceneEdits } from '../scene-edit-session.mjs';
import {canCollideWithFire,checkedObjectCollision} from '../scene-collider.mjs';
import * as THREE from '../lib/three.core.js';
import {checkedProceduralMesh, createProceduralMesh, PROCEDURAL_MESH_TYPE} from '../scene-geometry.mjs';
import {isReloadableSceneObjectRecord} from '../scene-persistence-core.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

function makeSceneContext({reloadObject = () => ({}), reloadableType = 'glb'} = {}) {
  const workingScene = createWorkingScene();
  const scene = {
    add(object) { object.parent = this; },
    remove(object) { if (object.parent === this) object.parent = null; },
  };
  // VM remains only for the unrelated page presenter and mesh repair callers.
  // Membership operations themselves are imported and run outside that context.
  const context = vm.createContext({structuredClone,workingScene,scene,currentMesh:null,
    window:{_kaminosDirty(){}},setInfo(){},renderSceneObjectList(){},sceneNavigation:{invalidate(){}},
    applyMaterialStateToObject(){},applySceneObjectTransformState(){},
  });
  const edits = createSceneEdits({read:() => null, write(){}});
  vm.runInContext(disposeSource, context);
  const membership = createSceneMembershipOperations({
    scene:workingScene,
    records:{
      serialize:entry=>({id:entry.id,source:entry.source,type:entry.type,fileName:entry.fileName,
        label:entry.label,groupId:entry.groupId,createdAt:entry.createdAt,
        transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},materials:[]}),
      reloadable:record=>record?.type===reloadableType&&typeof record.source==='string',
      async load(record){const object=reloadObject(record);workingScene.put(makeRecord(record.id,object,record));scene.add(object);return object;},
    },
    roots:{attach:entry=>scene.add(entry.object),detach:entry=>scene.remove(entry.object),
      restore(entry,record){context.applySceneObjectTransformState(entry.object,record.transform);context.applyMaterialStateToObject(entry.object,record.materials);
        if(canCollideWithFire(entry))entry.collision=checkedObjectCollision(entry,record.collision);},
      dispose:context.disposeObjectTree},
    domains:{[reloadableType]:{retainRoot:true}},
    select(ids,activeId){workingScene.select(ids,activeId);context.currentMesh=workingScene.find(activeId)?.object??null;},
    changed:()=>context.renderSceneObjectList(),
  });
  membership.attachHistory(edits);
  Object.assign(context,{scenePlacementTools:{edits},
    recordSceneObjectInsertion:membership.recordInsertion,removeSceneObjectInternal:membership.remove,
    ensureSceneObjectMembershipTarget:membership.ensureTarget,
    releaseUnreferencedSceneMembershipObjects:membership.releaseUnreferenced,
    serializeSceneObject:entry=>membership.snapshot(entry.id)?.record,
  });
  return {context,edits,workingScene,scene,membership};
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
    serializeSceneObject:entry=>({...entry,object:undefined}),
    LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',FLAME_EMITTER_TYPE:'flame-emitter',CAMERA_TYPE:'camera',PROCEDURAL_MESH_TYPE:'procedural-mesh',RIM_LIGHT_ID:'@rim-light',
    setActiveSceneObject:id=>workingScene.select([id],id),
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


test('an admitted domain object preserves its exact root through membership history', async () => {
  const root = repairedMesh();
  const {context, edits, workingScene, scene} = makeSceneContext({
    reloadableType: 'assembly-fixture', reloadObject: () => repairedMesh(),
  });
  workingScene.put(makeRecord('assembly', root, {type:'assembly-fixture'}));
  scene.add(root);
  context.removeSceneObjectInternal('assembly');
  assert.equal(root.geometry.disposed, false, 'a domain-admitted retained root must remain alive for Undo');
  await edits.undo();
  assert.equal(workingScene.find('assembly').object, root, 'Undo must restore the same domain root');
  await edits.redo();
  assert.equal(root.geometry.disposed, false, 'Redo must keep the root while history retains it');
  edits.clear();
  assert.equal(root.geometry.disposed, true, 'dropping the final history reference disposes the detached root');
});

test('geometry replacement after membership Undo survives release of the old root', async () => {
  const workingScene = createWorkingScene(), scene = new THREE.Scene(), proceduralMeshes = new Map();
  const edits = createSceneEdits({read:()=>null, write(){}});
  const pose = {position:[0,0,0], rotation:[0,0,0], scale:[1,1,1]};
  const serializeSceneObject = entry => {
    const {object, ...record} = entry;
    return structuredClone(record);
  };
  const context = vm.createContext({
    structuredClone, THREE, workingScene, scene, proceduralMeshes, edits,
    createSceneMembershipOperations, checkedProceduralMesh, createProceduralMesh,
    PROCEDURAL_MESH_TYPE, CAMERA_TYPE:'camera', LOCAL_LIQUID_EMITTER_TYPE:'water', FLAME_EMITTER_TYPE:'flame',
    serializeSceneObject, isReloadableSceneObjectRecord, mergeGeometries:null,
    addSceneObjectFromSource(){throw Error('Undo must use its retained root');},
    scenePlacementTools:{edits, finish(){}}, meshDataTargets:new Set(),
    sceneNavigation:{prepare(){}}, sceneGiProxies:{release(){}},
    applyGiProxySetting(){}, createSceneGroupForObjects(){},
    sceneCameras:null, currentMesh:null, transformControls:null,
    hybridSplatOverlayState:{}, splatCorrectionMode:null,
    sceneSaveBlockedByFailedRestore:false,
    setSceneObjectMounted:(entry,mounted)=>mounted?scene.add(entry.object):scene.remove(entry.object),
    applySceneObjectTransformState(object,transform){
      object.position.fromArray(transform.position);object.rotation.fromArray(transform.rotation);object.scale.fromArray(transform.scale);
    },
    applyMaterialStateToObject(){}, canCollideWithFire:()=>false,
    setSceneSelection:(ids,id)=>workingScene.select(ids,id),
    clearActiveSceneObjectSelection:()=>workingScene.clearSelection(),
    renderSceneObjectList(){}, updateTransformInspector(){}, setInfo(){}, window:{},
  });
  // Exercise the production adapter and geometry replacement path together.
  for (const [first,last] of [
    ['function disposeObjectTree(', 'function shouldClearSceneForImport('],
    ['function createPageSceneMembershipOperations(', 'const sceneMembership ='],
    ['function checkedObjectData(', 'function addProceduralMesh('],
    ['function mountProceduralMesh(', 'function readBurnerGraph('],
  ]) {
    const start=html.indexOf(first), end=html.indexOf(last,start);
    assert.ok(start>=0&&end>start, `production ${first} must be extractable`);
    vm.runInContext(html.slice(start,end),context);
  }
  const membership=context.createPageSceneMembershipOperations();context.sceneMembership=membership;membership.attachHistory(edits);
  const original=context.mountProceduralMesh({id:'cube',type:PROCEDURAL_MESH_TYPE,source:'kaminos:geometry',
    label:'Cube',transform:pose,geometry:{kind:'box',parameters:{width:1,height:1,depth:1}}});
  membership.remove('cube');await edits.undo();
  assert.equal(workingScene.find('cube').object,original.object);
  assert.equal(edits.state().redoCount,1);
  const next=serializeSceneObject(workingScene.find('cube'));next.geometry.parameters.width=2;
  const target=context.ensureMeshDataTarget('cube');
  edits.begin(target,'Edit geometry');edits.preview(next);
  const replacement=workingScene.find('cube').object,manager=proceduralMeshes.get('cube'),disposed=[];
  assert.notEqual(replacement,original.object);
  replacement.geometry.addEventListener('dispose',()=>disposed.push('geometry'));
  replacement.material.addEventListener('dispose',()=>disposed.push('material'));
  edits.commit();
  assert.equal(edits.state().redoCount,0);
  assert.equal(workingScene.retained('cube'),undefined,'the old membership reference was released');
  assert.equal(replacement.parent,scene,'editing geometry after Undo must leave the replacement mesh mounted');
  assert.equal(proceduralMeshes.get('cube'),manager,'release must preserve the replacement manager');
  assert.deepEqual(disposed,[],'release must not dispose replacement geometry or material');
  membership.remove('cube');edits.clear();
  assert.equal(replacement.parent,null);
  assert.equal(proceduralMeshes.has('cube'),false,'final release must still remove the matching manager');
  assert.deepEqual(disposed,['geometry','material']);
});
