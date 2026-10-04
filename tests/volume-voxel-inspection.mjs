import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {outerSmokeConfig,validateOuterSmokeDevice} from '../volume-outer-smoke.mjs';
import {reconcileVolumeCockpitLayoutDocument,VOLUME_COCKPIT_LAYOUT_IDENTITY} from '../volume-cockpit-layout.mjs';
const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
test('voxel inspection reads solver masks, not geometry or smoke opacity',()=>{
  assert.match(core,/raymarchCollisionVoxels\(ro, rd/,'dedicated collision-mask traversal exists');
  assert.match(core,/binding\(18\).*outerSceneSolidCells/);
  assert.match(core,/outerSmoke\?\.solids/,'bind actual coarse solver texture');
  assert.match(core,/uniforms\[333\] = .*collisionVoxelView/);
});
test('outer grid is a persisted live control and triggers rebuild',()=>{
  const item=schema.controls.find(c=>c.key==='volume-outer-resolution');
  assert.ok(item,'outer resolution must be roundtrippable');
  assert.equal(item.additiveDefault,'32');
  assert.equal(item.allowedValues,undefined,'custom route grids retain roundtrip support');
  assert.match(html,/<option value="64">64×128×64/);
  assert.match(html,/outerResolution: Number\(document.getElementById\('volume-outer-resolution'\).value\)/);
  assert.match(core,/outerGridChanged/,'outer changes rebuild actual resources');
  const listeners=html.slice(html.indexOf("for (const id of [\n    'volume-emitter-source-law'"));
  for(const id of ['volume-outer-resolution','volume-collision-voxels'])assert.ok(listeners.slice(0,listeners.indexOf(']) {')).includes(`'${id}'`),'actual input/change listeners');
  const ids=['volume-resolution','volume-outer-resolution','volume-collision-voxels'];
  const result=reconcileVolumeCockpitLayoutDocument({authorableControlIds:ids,document:{identity:VOLUME_COCKPIT_LAYOUT_IDENTITY,layoutId:'grid',label:'Grid',groups:[{id:'simulation',label:'Sim',surface:'primary',collapsed:false,controlIds:['volume-resolution']}]}});
  assert.deepEqual(result.document.groups[0].controlIds,ids);
});
test('denser comparison keeps extent while doubling cells across old box',()=>{
  const a=outerSmokeConfig({grid:32}),b=outerSmokeConfig({grid:64});
  assert.deepEqual(a.min,b.min);assert.deepEqual(a.max,b.max);
  assert.equal(2/a.cellWidth,8);assert.equal(2/b.cellWidth,16);
  assert.throws(()=>validateOuterSmokeDevice(b,{maxTextureDimension3D:64,maxBufferSize:1e9,maxStorageBufferBindingSize:1e9}),/capacity/i);
});
test('paused diagnostic draw refreshes replacement masks before claiming installation',()=>{
  // Execute the actual uniform/receipt boundary after a paused rebuild. No
  // encodeSim call is available to install the new masks in this scenario.
  const start=core.indexOf('    uniforms[332] = volumeExposure;')+'    uniforms[332] = volumeExposure;'.length;
  const end=core.indexOf('    uniforms[334]',start);
  let installed=false;
  const state={sceneCollision:{effective:'mesh-voxel-solid',outerGrid:32}};
  const context=vm.createContext({uniforms:new Float32Array(600),controlsSnapshot:{collisionVoxelView:'outer'},state,
    gridSize:64,gridHeight:128,outerSmoke:{config:{shape:[64,128,64]}},
    refreshSceneCollision(){installed=true;state.sceneCollision.outerGrid=64;}});
  vm.runInContext(core.slice(start,end),context);
  assert.equal(installed,true,'new mask installed without advancing simulation');
  assert.equal(state.sceneCollision.outerGrid,64);
  assert.equal(state.collisionVoxelView.effective,'outer');
});
