// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import experiment from '../experiments/optical-carriers.experiment.mjs';
import {opticalParticleSettings} from '../volume-optical-particles.mjs';

test('fresh carrier controls apply typed values, preserve zero and dispose back to prior mode',async()=>{
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.value='';this.classList={contains:()=>false,add(){},remove(){}};}
  append(...children){this.children.push(...children);for(const child of children)if(typeof child==='object')child.parentNode=this;}
  setAttribute(){} remove(){} closest(){return null;}
 }
 const document=new EventTarget();document.activeElement=null;document.createElement=tag=>new Element(tag);document.getElementById=()=>null;
 let settings=opticalParticleSettings(),callbacks=[];
 const runtime={opticalParticleSettings:()=>settings,setOpticalParticles:next=>{settings=opticalParticleSettings(next);},splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({settings,effective:'world-optical-particles'}),resetOpticalParticles(){}};
 document.defaultView={__kaminosVolumePrototype:runtime,Event};
 const session=()=>({onFrame:fn=>{callbacks.push(fn);return()=>{callbacks=callbacks.filter(x=>x!==fn);};},redraw(){},dispose(){}});
 const host={controls:{document,installNumberDrag:()=>({dispose(){}})},scene:{open:async()=>session()}};
 const owner=await experiment.create({host,inputs:{},record(){},updateInputs(){}}),root=new Element('div');
 try{
  owner.mount({root,document,invoke:async(key,arg)=>owner.operations[key](arg)});
  assert.equal(settings.carrierMode,1);assert.equal(settings.acquisitionEnabled,false);assert.equal(settings.exchangeEnabled,false);
  const all=node=>[node,...(node.children??[]).filter(x=>typeof x==='object').flatMap(all)];
  const rate=all(root).find(x=>x.dataset.carrier==='carrierRate');assert.ok(rate);rate.value='0';rate.dispatchEvent(new Event('input'));rate.dispatchEvent(new Event('change'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settings.carrierRate,0);
  owner.operations.setOptions({carrierRotation:0,carrierStrain:0,carrierRelaxation:0});assert.equal(settings.carrierRotation,0);assert.equal(settings.carrierStrain,0);assert.equal(settings.carrierRelaxation,0);
  assert.throws(()=>owner.operations.setOptions({fillExtinction:1}),/does not run/);
  assert.throws(()=>owner.operations.setOptions({capacity:0}),/positive explicit/);
 }finally{await owner.dispose();}
 assert.equal(settings.carrierMode,0);assert.equal(settings.enabled,false);assert.equal(callbacks.length,0);
});
