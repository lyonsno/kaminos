// kaminos-test: node
import assert from 'node:assert/strict';
import {compileSceneLighting} from '../scene-lighting-compile.mjs';
import {TSL} from '../lib/three.webgpu.js';
const initial={target:{screen:true},mrt:{screen:true},contextNode:TSL.context({base:1}),transparent:true,opaque:false,autoClear:false};
const renderer={...initial,getRenderTarget(){return this.target;},getMRT(){return this.mrt;},setRenderTarget(v){this.target=v;},setMRT(v){this.mrt=v;}};
const scene={name:'authored',overrideMaterial:null},camera={layers:{mask:1}};
const pass={scene,camera,renderTarget:{scene:true},_mrt:{normal:true},transparent:false,opaque:true,overrideMaterial:{depth:true},_layers:{mask:2},name:'beauty',contextNode:TSL.context({ao:2}),version:0};
let release,calls=0;
renderer.compileAsync=async(s,c)=>{
  calls++;assert.equal(s,scene);assert.equal(c,camera);
  assert.equal(renderer.target,pass.renderTarget);assert.equal(renderer.mrt,pass._mrt);
  assert.equal(renderer.transparent,false);assert.equal(renderer.opaque,true);
  assert.deepEqual(renderer.contextNode.getFlowContextData(),{base:1,ao:2});
  assert.equal(scene.overrideMaterial,pass.overrideMaterial);assert.equal(camera.layers.mask,2);
  await new Promise(resolve=>release=resolve);
};
const compilation=compileSceneLighting(renderer,[pass]);
assert.equal(calls,1);assert.equal(renderer.target,pass.renderTarget,'matching pass context survives across async compilation');
release();await compilation;
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key]);
assert.equal(camera.layers.mask,1);assert.equal(scene.name,'authored');assert.equal(scene.overrideMaterial,null);
renderer.compileAsync=async()=>{throw Error('compile failed');};
await assert.rejects(compileSceneLighting(renderer,[pass]),/compile failed/);
for(const key of Object.keys(initial))assert.equal(renderer[key],initial[key],'failure restores renderer state');
console.log('PASS async compile matches MRT, draw flags, AO context and restores state on failure');
