// kaminos-test: node
import assert from 'node:assert/strict';
import {Scene,DirectionalLight} from '../lib/three.webgpu.js';
import {openFootprintFixture} from '../gi-footprint-fixture.mjs';
const scene=new Scene(),light=new DirectionalLight();scene.add(light);let gi={mode:'combined',steps:4,temporal:true},view={position:[1,2,3]},closed=0,opened=0;
const originalGI=structuredClone(gi),originalView=structuredClone(view),env={value:'.4',dispatchEvent(){}};
const host={controls:{document:{getElementById:()=>env,defaultView:{Event:class{}}}},rendering:{readGI:()=>structuredClone(gi),gi:value=>{gi=structuredClone(value);}},scene:{select(){},async open(){opened++;let root;return {readView:()=>structuredClone(view),setView:value=>{view=structuredClone(value);},async attach(value){root=value;scene.add(root);},redraw(){},async dispose(){if(root){scene.remove(root);root.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});}closed++;}};}}};
await assert.rejects(()=>openFootprintFixture(host,'unknown'),/Unknown/);assert.equal(opened,0,'Invalid fixture must preserve the scene');
for(const kind of ['plane','light']){
 const fixture=await openFootprintFixture(host,kind);assert.equal(light.visible,false);assert.equal(env.value,'0');assert.equal(gi.steps,16);assert.equal(gi.temporal,false);
 const state=fixture.read();assert.equal(state.kind,kind);assert.ok(state.parts.some(p=>p.name==='Flat receiving floor'));
 assert.equal(state.parts.filter(p=>p.name.startsWith('Thin blocker')).length,kind==='light'?3:0);
 await fixture.dispose();await fixture.dispose();assert.equal(light.visible,true);assert.equal(env.value,'.4');assert.deepEqual(gi,originalGI);assert.deepEqual(view,originalView);assert.deepEqual(scene.children,[light]);
}
assert.equal(closed,2,'Each fixture releases its own registration once');
