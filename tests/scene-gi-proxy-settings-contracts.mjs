// kaminos-test: node — an object's render settings: whether its GI proxy is on, and which stored tier it uses;
// they persist with the scene (the load allowlist keeps them) and drive the GI proxy registry
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {checkedGiProxySetting,giProxySettingFor,DEFAULT_GI_PROXY_SETTING} from '../scene-gi-proxy-settings.mjs';
import {getSceneObjectRecords} from '../scene-persistence-core.js';
const normalizeSceneObjectRecord=record=>getSceneObjectRecords({version:10,objects:[record]})[0];
import {createGiProxyRegistry} from '../scene-gi-proxies.mjs';

test('a mesh object defaults to its GI proxy on at the 1000-face tier; other objects have no setting',()=>{
  assert.deepEqual(giProxySettingFor({type:'glb'}),{enabled:true,selection:{faces:1000}});
  assert.deepEqual(DEFAULT_GI_PROXY_SETTING,{enabled:true,selection:{faces:1000}});
  assert.equal(giProxySettingFor({type:'light'}),null);
  assert.deepEqual(giProxySettingFor({type:'glb',giProxy:{enabled:false,selection:{faces:500}}}),{enabled:false,selection:{faces:500}});
});

test('a setting chooses a stored tier by faces or by error, and anything else is refused',()=>{
  const glb={type:'glb'};
  assert.deepEqual(checkedGiProxySetting(glb,{enabled:true,selection:{maxError:.005,stat:'p95'}}),{enabled:true,selection:{maxError:.005,stat:'p95'}});
  for(const bad of [{enabled:'yes',selection:{faces:1000}},{enabled:true,selection:{faces:777}},{enabled:true,selection:{faces:1000,maxError:.01,stat:'p95'}},
    {enabled:true,selection:{maxError:-1,stat:'p95'}},{enabled:true,selection:{maxError:.01,stat:'median'}},{enabled:true}])
    assert.throws(()=>checkedGiProxySetting(glb,bad),/GI proxy/,JSON.stringify(bad));
  assert.throws(()=>checkedGiProxySetting({type:'light'},{enabled:true,selection:{faces:1000}}),/mesh object/);
});

test('a saved scene keeps a mesh object\'s render settings through the load allowlist',()=>{
  const record=normalizeSceneObjectRecord({id:'m1',type:'glb',source:'/x.glb',fileName:'x.glb',giProxy:{enabled:false,selection:{faces:5000}}});
  assert.deepEqual(record.giProxy,{enabled:false,selection:{faces:5000}});
  assert.equal(normalizeSceneObjectRecord({id:'m2',type:'glb',source:'/y.glb',fileName:'y.glb'}).giProxy,undefined,'no stored setting: the default applies at registration');
  assert.throws(()=>normalizeSceneObjectRecord({id:'m3',type:'glb',source:'/z.glb',fileName:'z.glb',giProxy:{enabled:true,selection:{faces:7}}}),/GI proxy/);
});

test('a disabled object holds no proxy and its handle says it is disabled',async()=>{
  const registry=createGiProxyRegistry({THREE,fetchJson:async()=>{throw Error('no fetch for a disabled object');},fetchBytes:async()=>new ArrayBuffer(0),parseGlb:async()=>new THREE.Group()});
  const root=new THREE.Group();root.userData.kaminosSceneObject={source:`/api/read?root=generated-meshes&path=${'a'.repeat(64)}.glb`};
  registry.disable(root);
  assert.equal(registry.get(root).state,'disabled');assert.equal(registry.get(root).proxyRoot,null);
});

import {giProxySettingFromControls} from '../scene-gi-proxy-settings.mjs';
test('RENDER-02: inspector edits keep an existing error statistic; choosing By error fresh uses p95',()=>{
  const mean={enabled:true,selection:{maxError:.005,stat:'mean'}};
  assert.deepEqual(giProxySettingFromControls({enabled:false,detail:'error',maxError:'0.005'},mean),{enabled:false,selection:{maxError:.005,stat:'mean'}});
  assert.deepEqual(giProxySettingFromControls({enabled:true,detail:'error',maxError:'0.02'},mean),{enabled:true,selection:{maxError:.02,stat:'mean'}});
  assert.deepEqual(giProxySettingFromControls({enabled:true,detail:'error',maxError:'0.01'},{enabled:true,selection:{faces:1000}}),{enabled:true,selection:{maxError:.01,stat:'p95'}});
  assert.deepEqual(giProxySettingFromControls({enabled:true,detail:'faces:500',maxError:'0.01'},mean),{enabled:true,selection:{faces:500}});
});
