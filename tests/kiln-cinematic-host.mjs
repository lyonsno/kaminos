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
