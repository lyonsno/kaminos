// kaminos-test: node
import assert from 'node:assert/strict';
import {installOwnerExperimentEntry,readOwnerExperimentAddress,writeOwnerExperimentAddress} from '../owner-experiment-entry.mjs';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
class Element {
  constructor(){this.children=[];this.nodes=new Map();this.value='';this.style={};this.ownerDocument=document;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){} addEventListener(){}
  querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
}
globalThis.Option=class extends Element {constructor(text,value){super();this.textContent=text;this.value=value;}};
let frame,points=1,pointSampling='all',sampling='fixed',quality={resolution:256,blockerSamples:9,filterSamples:16},href='http://localhost/index.html#scene=kiln.json';
const document={addEventListener(){},removeEventListener(){},getElementById:()=>null,createElement:()=>new Element(),defaultView:Object.assign(new EventTarget(),{Event,__kaminosSceneRadiance:{setShadowQuality:value=>{quality={...quality,...value};},setShadowSampling:value=>sampling=value,setPointCount:value=>points=value,setQuadrature:(value,mode)=>{points=value;pointSampling=mode;},debugState:()=>({pointCount:points,pointSampling,shadowSampling:sampling,shadowSoftness:1,shadowResolution:quality.resolution,blockerSamples:quality.blockerSamples,filterSamples:quality.filterSamples})}})};
const host={controls:{document},scene:{open:async()=>({onFrame:fn=>{frame=fn;return()=>{};},redraw(){},dispose(){}})}};
globalThis.document=document;globalThis.window={addEventListener(){}};
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
await entry.invoke('setQuadrature',{points:4,pointSampling:'paired'});
const pairedInputs=JSON.parse(readOwnerExperimentAddress(new URL(href)).inputsText);
assert.equal(pairedInputs.points,4);assert.equal(pairedInputs.pointSampling,'paired');assert.equal(pairedInputs.retained,'other input');
points=1;pointSampling='all';await entry.open('fire-shadow-sampling',pairedInputs);frame();
assert.equal(points,4);assert.equal(pointSampling,'paired');
const pairedHref=href;await assert.rejects(entry.invoke('setQuadrature',{points:2,pointSampling:'paired'}),/four/);assert.equal(href,pairedHref);
await entry.invoke('setPoints',2);assert.equal(JSON.parse(readOwnerExperimentAddress(new URL(href)).inputsText).pointSampling,'all');
await entry.invoke('setShadowQuality',{resolution:128,blockerSamples:3,filterSamples:8});
await entry.invoke('setSampling','complementary');
const qualityInputs=JSON.parse(readOwnerExperimentAddress(new URL(href)).inputsText);
assert.deepEqual(qualityInputs.shadowQuality,{resolution:128,blockerSamples:3,filterSamples:8});
assert.equal(qualityInputs.points,2);assert.equal(qualityInputs.retained,'other input');
quality={resolution:256,blockerSamples:9,filterSamples:16};
await entry.open('fire-shadow-sampling',qualityInputs);frame();
assert.deepEqual((await entry.read()).shadowQuality,{resolution:128,blockerSamples:3,filterSamples:8});
const beforeInvalid=href;
await assert.rejects(entry.invoke('setShadowQuality',{filterSamples:0}),/positive integer/);
assert.equal(href,beforeInvalid);
await entry.invoke('restoreShadowQuality');
assert.deepEqual((await entry.read()).shadowQuality,{resolution:256,blockerSamples:9,filterSamples:16});
let comparison={implementation:'shared',grain:'ordered',worldCellSize:.02};
const consumer=document.defaultView.__kaminosSceneRadiance,oldDebug=consumer.debugState;
consumer.setShadowComparison=value=>{comparison={...value};};
consumer.debugState=()=>({...oldDebug(),shadowImplementation:comparison.implementation,shadowGrain:comparison.grain,shadowWorldCellSize:comparison.worldCellSize});
await entry.invoke('setShadowComparison',{grain:'world',worldCellSize:.03});
await entry.invoke('setShadowComparison',{implementation:'legacy'});
const comparisonInputs=JSON.parse(readOwnerExperimentAddress(new URL(href)).inputsText);
assert.deepEqual(comparisonInputs.shadowComparison,{implementation:'legacy',grain:'world',worldCellSize:.03});
assert.equal(comparisonInputs.retained,'other input');
comparison={implementation:'shared',grain:'ordered',worldCellSize:.02};
await entry.open('fire-shadow-sampling',comparisonInputs);frame();
assert.deepEqual((await entry.read()).shadowComparison,comparisonInputs.shadowComparison);
const comparisonHref=href;
await assert.rejects(entry.invoke('setShadowComparison',{grain:'unknown'}),/grain/);
assert.equal(href,comparisonHref,'invalid grain must not poison shareable inputs');
await entry.close();delete globalThis.document;delete globalThis.window;
console.log('PASS actual owner operation/address/recovery preserves edited source count and sampling');
