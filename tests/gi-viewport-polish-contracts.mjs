import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import * as flame from '../scene-flame-emitter.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('GI thickness accepts fine decimals and slices/filter stay in the primary controls',()=>{
  const thickness=html.match(/<input[^>]*id="scene-gi-thickness"[^>]*>/)?.[0];
  assert.match(thickness,/step="any"/);
  assert.match(thickness,/min="0"/);
  const start=html.indexOf('<div id="scene-gi-controls"'),end=html.indexOf('<details',start);
  const primary=html.slice(start,end);
  assert.ok(primary.includes('id="scene-gi-slices"'),'slices must not require opening advanced settings');
  assert.ok(primary.includes('id="scene-gi-denoise"'),'filter radius must not require opening advanced settings');
  assert.match(primary,/<input[^>]*id="scene-gi-denoise"[^>]*type="number"[^>]*step="any"/);
});

test('viewport exposes emitter checkbox and the existing numeric scrub primitive',()=>{
  const workspace=readFileSync(new URL('../authoring-workspace.mjs',import.meta.url),'utf8');
  assert.ok(/<input[^>]*id="viewport-show-emitter-guides"[^>]*type="checkbox"/.test(workspace),'missing emitter guide checkbox');
  assert.ok(/<input[^>]*id="viewport-emitter-opacity"[^>]*type="number"[^>]*step="any"/.test(workspace),'missing opacity scrub field');
});

test('actual viewport API changes flame guides without changing source pose or invalid-value state',()=>{
  const handle=flame.createFlameEmitterHandle(THREE);
  flame.updateFlameEmitterSupportOutline(THREE,handle,{family:'ring',inputRadius:.3});
  const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,checked:true,value:'',toggleAttribute(){}});return nodes.get(id);}};
  const window={};
  const context={window,document,transformControls:null,scenePlacementTools:{finish(){throw Error('guide adjustment must not finish a source transform');}},sceneObjects:[{type:flame.FLAME_EMITTER_TYPE,object:handle}],
    FLAME_EMITTER_TYPE:flame.FLAME_EMITTER_TYPE,resolveFlameEmitterGuideSettings:flame.resolveFlameEmitterGuideSettings,applyFlameEmitterGuideSettings:flame.applyFlameEmitterGuideSettings};
  const start=html.indexOf('let viewportGizmosVisible='),end=html.indexOf('let scenePlacementTools =',start);
  vm.runInNewContext(html.slice(start,end),context);
  const pose={position:handle.position.toArray(),rotation:handle.rotation.toArray(),scale:handle.scale.toArray()};
  const geometry=[];handle.traverse(node=>{if(node.geometry)geometry.push(node.geometry.uuid);});
  const settings=window.kaminosViewportSettings.set({emitterGuides:false,emitterGuideOpacity:.23});
  assert.equal(handle.visible,false,'wireframe checkbox must reach the mounted helper');
  assert.equal(settings.emitterGuideOpacity,.23);
  const before=window.kaminosViewportSettings.read();
  for(const emitterGuideOpacity of [NaN,-.1,1.1])assert.throws(()=>window.kaminosViewportSettings.set({emitterGuideOpacity}),/Invalid/);
  assert.deepEqual(window.kaminosViewportSettings.read(),before);
  window.kaminosViewportSettings.set({emitterGuides:true});
  assert.equal(handle.visible,true);
  handle.traverse(node=>{for(const material of node.material?[node.material].flat():[]){assert.equal(material.opacity,.23);assert.equal(material.transparent,true);assert.equal(material.depthWrite,false);}});
  assert.deepEqual({position:handle.position.toArray(),rotation:handle.rotation.toArray(),scale:handle.scale.toArray()},pose);
  const afterGeometry=[];handle.traverse(node=>{if(node.geometry)afterGeometry.push(node.geometry.uuid);});assert.deepEqual(afterGeometry,geometry);
});
