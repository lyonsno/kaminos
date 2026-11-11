// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
const module=await import('../scene-worker-view.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
const snapshot=camera=>({type:'PerspectiveCamera',position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),target:[0,1,0],fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far,zoom:camera.zoom,filmGauge:camera.filmGauge,filmOffset:camera.filmOffset,projectionMatrix:camera.projectionMatrix.toArray()});
function fixture(){
 assert.equal(typeof module.createSceneWorkerView,'function','actual worker needs to consume the page camera projection and viewport');
 const camera=new THREE.PerspectiveCamera(40,1,.01,100),calls=[];let viewport={width:32,height:32,pixelRatio:1};
 const owner=module.createSceneWorkerView({camera,readViewport:()=>viewport,writeViewport:value=>{viewport=value;},renderResources:{resize(){calls.push({...viewport});}}});
 return {camera,owner,calls,viewport:()=>viewport,context:{assertCurrent(){}}};
}
test('the actual worker camera preserves cropped projection and world rays from the page snapshot',()=>{
 const f=fixture(),page=new THREE.PerspectiveCamera(53,1.7,.15,700);page.position.set(2,4,7);page.lookAt(0,1,0);page.zoom=1.4;page.filmOffset=3;page.updateProjectionMatrix();page.setViewOffset(1200,800,100,50,900,600);page.updateMatrixWorld(true);
 const view=snapshot(page);f.owner.apply({viewport:{width:900,height:600,pixelRatio:2},camera:view},f.context);
 assert.deepEqual(f.camera.projectionMatrix.toArray(),page.projectionMatrix.toArray());
 assert.deepEqual(f.camera.projectionMatrixInverse.toArray(),page.projectionMatrixInverse.toArray());
 for(const point of [[0,0,.5],[-.8,.2,.5],[.4,-.7,.5]]){
  assert.ok(new THREE.Vector3(...point).unproject(f.camera).distanceTo(new THREE.Vector3(...point).unproject(page))<1e-10);
 }
 assert.deepEqual(f.calls,[{width:900,height:600,pixelRatio:2}]);
 assert.equal(f.camera.filmOffset,3);assert.equal(f.camera.zoom,1.4);
 view.position[0]=999;assert.equal(f.camera.position.x,2,'cloneable input does not become mutable live camera state');
});
test('camera updates avoid redundant allocation resize; actual viewport changes resize once',()=>{
 const f=fixture(),page=new THREE.PerspectiveCamera(60,2,.1,500);page.position.set(1,2,5);page.lookAt(0,0,0);
 const input={viewport:{width:32,height:32,pixelRatio:1},camera:snapshot(page)};
 f.owner.apply(input,f.context);f.owner.apply(input,f.context);assert.deepEqual(f.calls,[]);
 f.owner.apply({viewport:{width:64,height:32,pixelRatio:1}},f.context);assert.equal(f.calls.length,1);
 assert.deepEqual(f.camera.position.toArray(),[1,2,5]);assert.equal(f.camera.aspect,2,'authored camera aspect remains independent of canvas extent');
});
test('invalid camera or stale context cannot partially change viewport or retained camera',()=>{
 const f=fixture(),before=f.camera.position.toArray(),valid=snapshot(new THREE.PerspectiveCamera());
 for(const patch of [{projectionMatrix:Array(16).fill(0)},{quaternion:[0,0,0,0]},{position:[NaN,1,2]},{near:0},{type:'UnknownCamera'}]){
  assert.throws(()=>f.owner.apply({viewport:{width:64,height:64,pixelRatio:1},camera:{...valid,...patch}},f.context),/camera|projection|quaternion/i);
  assert.deepEqual(f.viewport(),{width:32,height:32,pixelRatio:1});assert.deepEqual(f.camera.position.toArray(),before);assert.equal(f.calls.length,0);
 }
 assert.throws(()=>f.owner.apply({camera:valid},{assertCurrent(){throw Error('stale');}}),/stale/);
 assert.throws(()=>f.owner.apply({viewport:{width:0,height:20,pixelRatio:1}},f.context),/viewport/i);
});
