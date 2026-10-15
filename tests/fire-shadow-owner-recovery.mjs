// kaminos-test: node
import assert from 'node:assert/strict';
import {installOwnerExperimentEntry,readOwnerExperimentAddress,writeOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
class Element {
  constructor(){this.children=[];this.nodes=new Map();this.value='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){} addEventListener(){}
  querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
}
globalThis.Option=class extends Element {constructor(text,value){super();this.textContent=text;this.value=value;}};
let frame,points=1,sampling='fixed',href='http://localhost/index.html#scene=kiln.json';
const document={createElement:()=>new Element(),defaultView:{__kaminosSceneRadiance:{setShadowSampling:value=>sampling=value,setPointCount:value=>points=value,debugState:()=>({pointCount:points,shadowSampling:sampling,shadowSoftness:1})}}};
const host={controls:{document},scene:{open:async()=>({onFrame:fn=>{frame=fn;return()=>{};},redraw(){},dispose(){}})}};
const entry=await installOwnerExperimentEntry({document,root:new Element(),host,discover:async()=>[new URL('../experiments/fire-shadow-sampling.experiment.mjs',import.meta.url).href],onChange:value=>{href=writeOwnerExperimentAddress(href,value);}});
await entry.open('fire-shadow-sampling',{sampling:'complementary',points:1,retained:'other input'});frame();
await entry.invoke('setPoints',2);assert.equal(points,2);
const owner=readOwnerExperimentAddress(new URL(href));
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},route:{volume_light_field:'1'},lightGainStops:0};
const restored=new URL(compositionRestoreUrl(composition,'kiln.json','http://localhost','workbench',owner));
const inputs=JSON.parse(readOwnerExperimentAddress(restored).inputsText);
assert.equal(inputs.points,2,'saved owner must contain the selected count, not the opening count');
assert.equal(inputs.retained,'other input');
await entry.open('fire-shadow-sampling',inputs);frame();assert.equal(points,2);
await entry.invoke('setSampling','fixed');
assert.equal(JSON.parse(readOwnerExperimentAddress(new URL(href)).inputsText).sampling,'fixed');
const prior=href;await assert.rejects(entry.invoke('setPoints',0),/point count/);assert.equal(href,prior,'invalid selection must not poison recovery');
await entry.close();console.log('PASS actual owner operation/address/recovery preserves edited source count and sampling');
