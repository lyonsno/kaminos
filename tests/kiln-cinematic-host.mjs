// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('    cinematic: {')+'    cinematic: '.length;
const code=source.slice(start,source.indexOf('    setForegroundServiceActive',start)).trim().replace(/,$/,'');
const object={visible:false};
const scene={environmentIntensity:0.2};
const camera={position:{fromArray(value){this.value=value;}}};
const controls={target:{fromArray(value){this.value=value;}},enabled:false,update(){}};
const snapshot={controls:{},sourceEnabled:true,intensity:2,position:[1,2,3],target:[0,0,0],orbit:true,visibility:new Map([[object,true]])};
const host=new Function('kilnPerformanceSnapshot','applyKilnPerformanceEmitter','scene','camera','controls','window',
  `const host=${code};return {host,snapshot:()=>kilnPerformanceSnapshot};`)(snapshot,()=>{throw new Error('device lost');},scene,camera,controls,{});
assert.throws(()=>host.host.end(),/device lost/);
assert.equal(host.snapshot(),null,'failed GPU restoration still releases scene ownership');
assert.equal(controls.enabled,true);
assert.equal(object.visible,true);
assert.equal(scene.environmentIntensity,2);
assert.deepEqual(camera.position.value,[1,2,3]);
console.log('Cinematic host releases authored state after device failure');
const domainHelper={visible:true},emitterHelper={visible:false};
const helperSnapshot={...snapshot,tune:{},visibility:new Map(),transforms:new Map()};
const helperCamera=new THREE.PerspectiveCamera();
const helperControls={target:new THREE.Vector3(),enabled:false,update(){}};
const refreshHelpers=()=>{domainHelper.visible=true;emitterHelper.visible=true;};
const helperHost=new Function('kilnPerformanceSnapshot','applyKilnPerformanceEmitter','writeFlameSettingsState','readVolumeControls',
  'scene','camera','controls','window','sceneObjects','THREE','transformControls','flameDomainGuide','FLAME_EMITTER_ID','RIM_LIGHT_ID',
  `return ${code};`)(helperSnapshot,refreshHelpers,refreshHelpers,()=>({}),scene,helperCamera,helperControls,{},
    [{id:'source',object:emitterHelper}],THREE,null,domainHelper,'source','rim');
helperHost.sample({tune:{},radius:0.5,flow:1,sourceEnabled:true,light:1,push:0.1});
assert.equal(domainHelper.visible,false,'tune refresh cannot reveal a cinematic domain guide');
assert.equal(emitterHelper.visible,false,'emitter refresh cannot reveal a cinematic source helper');
helperHost.end();
assert.equal(domainHelper.visible,true,'exit restores the visible domain guide');
assert.equal(emitterHelper.visible,false,'exit restores the hidden source helper');
const dirtyLine=source.split('\n').find(line=>line.includes('window._kaminosDirty = '));
let syncs=0,dirtyMarks=0;const dirtyWindow={};
const dirtyHost=new Function('window','sceneCameras','markDirty',`let cameraSyncing=false,kilnPerformanceSnapshot={};${dirtyLine};return {end(){kilnPerformanceSnapshot=null;}};`)(
  dirtyWindow,{state:()=>({mode:'camera',writing:false}),sync:()=>syncs++},()=>dirtyMarks++);
dirtyWindow._kaminosDirty();assert.equal(syncs,0,'authored-camera sync must not overwrite temporary playback view');
dirtyHost.end();dirtyWindow._kaminosDirty();assert.equal(syncs,1);assert.equal(dirtyMarks,2);
const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1));
mesh.position.set(3,4,5);mesh.scale.setScalar(2);
let edits=0;
const poseSnapshot={...snapshot,visibility:new Map(),transforms:new Map()};
const poseHost=new Function('kilnPerformanceSnapshot','applyKilnPerformanceEmitter','scene','camera','controls','window','sceneObjects','THREE','flameEmitterPose',
  `return ${code};`)(poseSnapshot,()=>{},scene,camera,controls,{kaminosSetSceneObjectTransform(){edits++;}},[{id:'chair',object:mesh}],THREE,{position:[0,0,0]});
poseHost.stage('chair',{temporary:true});
assert.notDeepEqual(mesh.position.toArray(),[3,4,5]);
poseHost.end();
assert.deepEqual(mesh.position.toArray(),[3,4,5]);assert.deepEqual(mesh.scale.toArray(),[2,2,2]);
assert.equal(edits,0,'temporary replay adds no authored transform history');

const showSource=source.slice(source.indexOf('async function showGLB('),source.indexOf('// --- OBJ Inspector ---'));
let loaded,registered=0,disposed=0;
const abort=new AbortController();
const show=new Function('shouldClearSceneForImport','sceneMutationToken','GLTFLoader','disposeObjectTree','greenroomPreviewIsActive','modelSourceUrl','modelSourceType','glbFileName','resolveAssetArrivalMode',
 `${showSource};return showGLB;`)(()=>false,1,class {load(url,callback){loaded=callback;}},()=>{disposed++;},()=>false,'','','',()=>({}));
const pending=show('asset.glb',{clear:false,signal:abort.signal});
abort.abort();loaded({scene:{}});
await assert.rejects(pending,/stale async GLB/);assert.equal(disposed,1);
console.log('Replay pose and cancelled GLB load preserve authored scene');
