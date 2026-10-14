// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';

const source=readFileSync(new URL('../local-liquid-host.mjs',import.meta.url),'utf8');
function depthDraw() {
  const start=source.indexOf('renderer.setRenderObjectFunction((...args)=>{');
  assert.ok(start>=0);
  const end=source.indexOf('\n      });',start);
  const callback=source.slice(start,end).slice(source.slice(start,end).indexOf('{')+1);
  const drawn=[];
  const renderer={renderObject:(...args)=>drawn.push(args[0])};
  const depthMaterial={side:THREE.DoubleSide};
  const draw=new Function('renderer','depthMaterial',`return (...args)=>{${callback}}`)(renderer,depthMaterial);
  return {draw:object=>draw(object,null,null,object.geometry,object.material),drawn};
}

test('water depth ignores overlay and transparent helper meshes while retaining opaque scene occluders',()=>{
  const {draw,drawn}=depthDraw();
  const box=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshBasicMaterial({depthWrite:false,depthTest:false}));
  const transparent=new THREE.Mesh(new THREE.SphereGeometry(),new THREE.MeshBasicMaterial({transparent:true,opacity:0.5}));
  const helperParent=new THREE.Group();helperParent.userData.kaminosEditorHelper=true;
  const helper=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());helperParent.add(helper);
  draw(box);draw(overlay);draw(transparent);draw(helper);
  assert.equal(drawn.length,1,'only opaque scene geometry contributes hard water occlusion');
  assert.equal(drawn[0],box);
});

test('the water depth draw clears both Three background inputs and restores them after failure',()=>{
  const start=source.indexOf('  function render({advance=true}={}) {');
  const end=source.indexOf('\n  return {group,render,',start);
  const code=source.slice(start,end);
  const background={},backgroundNode={},priorOverride={},priorTarget={};
  const scene={background,backgroundNode,overrideMaterial:priorOverride};
  let target=priorTarget,callback=()=>{},during;
  const renderer={backend:{},getRenderTarget:()=>target,getRenderObjectFunction:()=>callback,
    getClearColor:c=>c.setRGB(0.1,0.2,0.3),getClearAlpha:()=>1,
    getDrawingBufferSize:v=>v.set(20,10),initRenderTarget:()=>{},
    setRenderTarget:v=>{target=v;},setRenderObjectFunction:v=>{callback=v;},setClearColor:()=>{},
    copyTextureToTexture:()=>{},render:()=>{during={background:scene.background,backgroundNode:scene.backgroundNode};throw Error('depth draw failed');}};
  const fixture={setSize:()=>{},texture:{}},camera={far:100};
  const bindings={THREE,renderer,scene,camera,disposed:false,failure:null,paused:true,solver:{},
    renderEnvironment:()=>{},pipeline:{outputColorTransform:false,render:()=>{}},
    colorTarget:fixture,depthTarget:fixture,outputTarget:fixture,depthMaterial:{}};
  const render=new Function('bindings',`with(bindings){return (${code});}`)(bindings);
  assert.throws(()=>render({advance:false}),/depth draw failed/);
  assert.equal(during.background,null);
  assert.equal(during.backgroundNode,null,'environment node cannot write radiance into water depth');
  assert.equal(scene.background,background);
  assert.equal(scene.backgroundNode,backgroundNode);
  assert.equal(scene.overrideMaterial,priorOverride);
  assert.equal(target,priorTarget);
});
