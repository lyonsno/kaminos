import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {collectStaticBounceTriangles,createStaticDiffuseBounce,selectStaticBouncePatches} from '../fire-light-field-bounce.mjs';

const scene=new THREE.Scene();
const authoredRoot=new THREE.Group();
authoredRoot.userData.kaminosSceneObject={id:'authored-kiln'};
scene.add(authoredRoot);
const matte=new THREE.MeshStandardMaterial({color:0x804020,roughness:1,metalness:0,side:THREE.DoubleSide});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(4,4,2,2),matte);
floor.rotation.x=-Math.PI/2;floor.position.y=-1;floor.castShadow=true;authoredRoot.add(floor);
const wall=new THREE.Mesh(new THREE.PlaneGeometry(4,3,2,2),matte.clone());
wall.position.z=-2;wall.castShadow=true;authoredRoot.add(wall);
const glass=new THREE.Mesh(new THREE.PlaneGeometry(4,3),new THREE.MeshStandardMaterial({transparent:true,opacity:.5}));
glass.position.z=1;glass.castShadow=false;authoredRoot.add(glass);
const runtimeDistractor=new THREE.Mesh(new THREE.SphereGeometry(.2,32,16),matte.clone());
runtimeDistractor.position.set(0,0,.01);runtimeDistractor.castShadow=true;scene.add(runtimeDistractor);
scene.updateMatrixWorld(true);

const first=selectStaticBouncePatches(scene,{count:6,origin:new THREE.Vector3(0,0,0)});
const second=selectStaticBouncePatches(scene,{count:6,origin:new THREE.Vector3(0,0,0)});
const candidates=collectStaticBounceTriangles(scene,{origin:new THREE.Vector3(0,0,0)});
assert.equal(first.length,6,'requested patch count is filled from eligible static opaque triangles');
assert.deepEqual(first.map(p=>p.identity),second.map(p=>p.identity),'selection is deterministic');
assert.ok(first.every(p=>Number.isFinite(p.area)&&p.area>0),'every patch has positive finite area');
assert.ok(first.every(p=>p.position.distanceTo(new THREE.Vector3(0,0,0))>0),'patch positions are finite world-space surface points');
assert.ok(first.every(p=>p.normal.dot(new THREE.Vector3().subVectors(new THREE.Vector3(0,0,0),p.position))>=0),'two-sided patch normals face the nominal fire origin');
assert.ok(first.every(p=>p.albedo.distanceTo?.(matte.color)<1e-6||(
  Math.abs(p.albedo.r-matte.color.r)<1e-6&&Math.abs(p.albedo.g-matte.color.g)<1e-6&&Math.abs(p.albedo.b-matte.color.b)<1e-6
)),'material base color survives patch extraction');
assert.ok(first.every(p=>p.object!==glass),'transparent geometry cannot become an opaque bounce emitter');
assert.ok(candidates.every(p=>p.object!==runtimeDistractor),'runtime/helper geometry is excluded before static patch selection');
assert.ok(first.every(p=>p.object!==runtimeDistractor),'runtime/helper geometry outside an authored scene object cannot enter the static receiver cache');

const renderer={
  toneMapping:THREE.NoToneMapping,toneMappingExposure:1,outputColorSpace:THREE.NoColorSpace,
  autoClear:true,coordinateSystem:THREE.WebGPUCoordinateSystem,reversedDepthBuffer:false,xr:{enabled:false},
  _target:null,_face:0,_mip:0,_renderObject:null,_pixelRatio:1,_mrt:null,_clearColor:new THREE.Color(),_clearAlpha:1,_scissor:false,
  getRenderTarget(){return this._target;},getActiveCubeFace(){return this._face;},getActiveMipmapLevel(){return this._mip;},
  getRenderObjectFunction(){return this._renderObject;},getPixelRatio(){return this._pixelRatio;},getMRT(){return this._mrt;},
  getClearColor(target){return target.copy(this._clearColor);},getClearAlpha(){return this._clearAlpha;},getScissorTest(){return this._scissor;},
  setMRT(value){this._mrt=value;},setRenderObjectFunction(value){this._renderObject=value;},
  setClearColor(value,alpha=1){this._clearColor.set(value);this._clearAlpha=alpha;},
  setRenderTarget(target,face=0,mip=0){this._target=target;this._face=face;this._mip=mip;},
  setPixelRatio(value){this._pixelRatio=value;},setScissorTest(value){this._scissor=value;},render(){},renderObject(){},
};
const {vec3}=THREE.TSL;
const cacheScene=new THREE.Scene();
const cacheRoot=new THREE.Group();
cacheRoot.userData.kaminosSceneObject={id:'cache-contract'};
cacheScene.add(cacheRoot);
const triangleMesh=(name,x,color)=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    x-.25,-.25,-1,x+.25,-.25,-1,x,.25,-1,
  ],3));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:1,metalness:0,side:THREE.DoubleSide}));
  mesh.name=name;mesh.castShadow=true;return mesh;
};
const firstCacheMesh=triangleMesh('first-cache-surface',-.5,0x804020);
cacheRoot.add(firstCacheMesh);
const bounce=createStaticDiffuseBounce({
  renderer,scene:cacheScene,requested:true,patchCount:4,resolution:8,
  fireShadow:{visibilityAt:()=>THREE.TSL.float(1)},fireCenterNode:vec3(0,0,0),
  fireIrradianceAtNode:()=>vec3(1,1,1),receiverNode:vec3(0,0,0),receiverNormalNode:vec3(0,1,0),
});
bounce.render('unchanged-external-revision');
const beforeTransform=bounce.debugState();
assert.equal(beforeTransform.patchCount,1,'the cache starts with one active authored patch');
bounce.render('unchanged-external-revision');
assert.deepEqual(bounce.debugState(),beforeTransform,'unchanged authored state reuses the effective bounce cache without rerendering visibility');
firstCacheMesh.position.x+=.75;
firstCacheMesh.updateMatrixWorld(true);
bounce.render('unchanged-external-revision');
const afterTransform=bounce.debugState();
assert.equal(afterTransform.renderCount,beforeTransform.renderCount+1,'an authored transform invalidates the effective bounce cache even when the external revision is stale');
assert.notDeepEqual(afterTransform.patches.map(p=>p.position),beforeTransform.patches.map(p=>p.position),'rebuilt patch positions follow the authored transform');
assert.equal(afterTransform.patches[0].visibility.renderCount,beforeTransform.patches[0].visibility.renderCount+1,'the transformed patch visibility cube is rerendered');

const runtimeCaster=new THREE.Mesh(new THREE.BoxGeometry(.25,.25,.25),new THREE.MeshStandardMaterial({color:0x303030}));
runtimeCaster.name='unregistered-runtime-caster';runtimeCaster.castShadow=true;runtimeCaster.position.set(0,0,-.5);
cacheScene.add(runtimeCaster);
bounce.render('unchanged-external-revision');
const afterRuntimeAdd=bounce.debugState();
assert.equal(afterRuntimeAdd.renderCount,afterTransform.renderCount+1,'adding an unregistered runtime caster invalidates the visibility cache');
assert.equal(afterRuntimeAdd.patches[0].visibility.meshCount,2,'patch visibility includes the same runtime caster that invalidated its cache');
runtimeCaster.position.x=8;
runtimeCaster.updateMatrixWorld(true);
bounce.render('unchanged-external-revision');
const afterRuntimeMove=bounce.debugState();
assert.equal(afterRuntimeMove.renderCount,afterRuntimeAdd.renderCount+1,'moving an unregistered runtime caster invalidates the visibility cache');
assert.ok(afterRuntimeMove.patches[0].visibility.far>afterRuntimeAdd.patches[0].visibility.far,'moving a runtime caster outside the prior bounds expands the visibility far plane');
runtimeCaster.visible=false;
bounce.render('unchanged-external-revision');
const afterRuntimeHide=bounce.debugState();
assert.equal(afterRuntimeHide.renderCount,afterRuntimeMove.renderCount+1,'hiding an unregistered runtime caster invalidates the visibility cache');
assert.equal(afterRuntimeHide.patches[0].visibility.meshCount,1,'hidden runtime casters leave the effective visibility set');
runtimeCaster.visible=true;
bounce.render('unchanged-external-revision');
const afterRuntimeShow=bounce.debugState();
assert.equal(afterRuntimeShow.renderCount,afterRuntimeHide.renderCount+1,'showing an unregistered runtime caster invalidates the visibility cache');
cacheScene.remove(runtimeCaster);
bounce.render('unchanged-external-revision');
const afterRuntimeRemove=bounce.debugState();
assert.equal(afterRuntimeRemove.renderCount,afterRuntimeShow.renderCount+1,'removing a visible runtime caster invalidates the visibility cache');
assert.equal(afterRuntimeRemove.patches[0].visibility.meshCount,1,'removed runtime casters leave the effective visibility set');

const secondCacheMesh=triangleMesh('second-cache-surface',.5,0x204080);
cacheRoot.add(secondCacheMesh);
bounce.render('unchanged-external-revision');
const afterAdd=bounce.debugState();
assert.equal(afterAdd.patchCount,2,'adding an authored surface refreshes the active patch count');
assert.ok(afterAdd.patches.some(p=>p.identity.startsWith(secondCacheMesh.uuid)),'the rebuilt identities include the added authored surface');

secondCacheMesh.material.color.set(0x40c080);
bounce.render('unchanged-external-revision');
const afterAlbedo=bounce.debugState();
const recoloredPatch=afterAlbedo.patches.find(p=>p.identity.startsWith(secondCacheMesh.uuid));
assert.deepEqual(recoloredPatch.albedo,secondCacheMesh.material.color.toArray(),'material albedo changes refresh the cached patch payload');

firstCacheMesh.material.opacity=.5;
assert.throws(()=>bounce.render('unchanged-external-revision'),/fire-shadow-unsupported-caster: first-cache-surface/,'sub-opaque material state fails immediately under the shared caster contract');
firstCacheMesh.material.opacity=1;
firstCacheMesh.material.alphaHash=true;
assert.throws(()=>bounce.render('unchanged-external-revision'),/fire-shadow-unsupported-caster: first-cache-surface/,'alpha-hash cutouts fail immediately under the shared caster contract');
firstCacheMesh.material.alphaHash=false;
firstCacheMesh.material.alphaTestNode=THREE.TSL.float(.5);
assert.throws(()=>bounce.render('unchanged-external-revision'),/fire-shadow-unsupported-caster: first-cache-surface/,'node alpha tests fail immediately under the shared caster contract');
firstCacheMesh.material.alphaTestNode=null;
assert.deepEqual(bounce.debugState(),afterAlbedo,'failed unsupported states do not replace the last valid effective cache');

const replacement=new THREE.BufferGeometry();
replacement.setAttribute('position',new THREE.Float32BufferAttribute([
  1.5,-.25,-1,2,-.25,-1,1.75,.25,-1,
],3));
secondCacheMesh.geometry=replacement;
bounce.render('unchanged-external-revision');
const afterGeometryReplacement=bounce.debugState();
assert.equal(afterGeometryReplacement.renderCount,afterAlbedo.renderCount+1,'geometry replacement invalidates the effective bounce cache');
assert.notDeepEqual(afterGeometryReplacement.patches.map(p=>p.position),afterAlbedo.patches.map(p=>p.position),'rebuilt patch positions follow replacement geometry');

replacement.attributes.position.setX(0,2.5);
replacement.attributes.position.needsUpdate=true;
bounce.render('unchanged-external-revision');
const afterGeometryMutation=bounce.debugState();
assert.equal(afterGeometryMutation.renderCount,afterGeometryReplacement.renderCount+1,'versioned in-place position changes invalidate the effective bounce cache');
assert.notDeepEqual(afterGeometryMutation.patches.map(p=>p.position),afterGeometryReplacement.patches.map(p=>p.position),'rebuilt patch positions follow versioned in-place geometry changes');
assert.ok(afterGeometryMutation.patches[0].visibility.far>afterGeometryReplacement.patches[0].visibility.far,'versioned in-place geometry changes recompute bounds and expand visibility far');

cacheRoot.remove(secondCacheMesh);
bounce.render('unchanged-external-revision');
const afterRemove=bounce.debugState();
assert.equal(afterRemove.patchCount,1,'removing an authored surface refreshes the active patch count');
assert.equal(afterRemove.renderCount,afterGeometryMutation.renderCount+1,'authored removal rebuilds the cache');
cacheRoot.remove(firstCacheMesh);
bounce.render('unchanged-external-revision');
const afterFinalRemove=bounce.debugState();
assert.equal(afterFinalRemove.patchCount,0,'removing the final eligible authored surface clears the active patch cache');
assert.equal(afterFinalRemove.renderCount,afterRemove.renderCount+1,'the final removal is a cache rebuild even when no eligible patches remain');
bounce.dispose();
console.log('static bounce patches are deterministic, material-bearing, and opaque-only');
