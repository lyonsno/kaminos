// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import definition from '../experiments/optical-particles.experiment.mjs';
import {opticalParticleSettings} from '../volume-optical-particles.mjs';

async function mounted(){
 const document=new EventTarget();document.activeElement=null;
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.value='';this.min='';this.max='';const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};}
  append(...els){for(let el of els){if(typeof el==='string'){const node=new Element('span');node.textContent=el;el=node;}el.parentNode=this;this.children.push(el);}}
  setAttribute(){}
  fire(type,init={}){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,init);this.dispatchEvent(event);}
 }
 document.createElement=t=>new Element(t);document.getElementById=()=>null;
 let accepted=opticalParticleSettings(),writes=[];
 const runtime={opticalParticleSettings:()=>accepted,setOpticalParticles:s=>{accepted=opticalParticleSettings(s);},splitIntegralSettings:()=>({mode:'off'}),setSplitIntegral(){},opticalParticleState:()=>({effective:'world-optical-particles',settings:accepted,simulationReaction:null,sourceRenderScale:1,sourceRaySteps:8})};
 document.defaultView={__kaminosVolumePrototype:runtime,Event};
 const owner=await definition.create({host:{controls:{document,installNumberDrag:()=>({dispose(){}})},scene:{open:async()=>({onFrame:()=>()=>{},redraw(){},dispose(){}})}},inputs:{particles:{acquisitionMode:1}},record(){},updateInputs:s=>writes.push(s)});
 const root=new Element('div');owner.mount({root,document,invoke:async(op,v)=>owner.operations[op](v)});
 const all=el=>[el,...el.children.flatMap(all)];const field=key=>all(root).find(el=>el.dataset.particle===key);
 return {owner,document,field,writes,accepted:()=>accepted,dispose:()=>owner.dispose()};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,220));

test('typed acquisition edits debounce complete values, retain invalid drafts and preserve accepted policy',async()=>{
 const x=await mounted();try{
  const input=x.field('sourceBias');x.document.activeElement=input;
  input.value='0.05';input.fire('input');await Promise.resolve();
  assert.equal(x.accepted().sourceBias,.75,'a typed prefix must not immediately redefine accepted placement');
  await settle();assert.equal(x.accepted().sourceBias,.05,'complete valid tuning applies automatically');
  input.value='2';input.fire('input');await settle();
  assert.equal(x.accepted().sourceBias,.05,'invalid placement leaves accepted runtime state intact');
  assert.equal(input.value,'2','an active invalid draft remains editable');
  x.document.activeElement=null;input.fire('blur');await Promise.resolve();
  assert.equal(Number(input.value),.05,'leaving an invalid draft restores the accepted value');
 }finally{await x.dispose();}
});
test('effective proposal shares expose normalized weights and an unassigned remainder',async()=>{
 const x=await mounted();try{
  x.owner.operations.setOptions({sourceBias:.9,fineCoverage:1,coarseCoverage:1});
  const p=x.owner.read().proposal;assert.ok(p,'effective placement is part of the agent and UI readout');
  assert.equal(p.source,.9);assert.ok(Math.abs(p.fine-.05)<1e-12);assert.ok(Math.abs(p.broad-.05)<1e-12);assert.equal(p.unassigned,0);
  x.owner.operations.setOptions({fineCoverage:0,coarseCoverage:0});assert.ok(Math.abs(x.owner.read().proposal.unassigned-.1)<1e-12);
  assert.equal(x.field('sourceBias').max,'1','scrubbing uses the same fraction bound as typed validation');
 }finally{await x.dispose();}
});
test('scrubbed values apply immediately and disposal cancels pending typed writes',async()=>{
 const x=await mounted();const input=x.field('sourceBias');
 input.classList.add('scrubbing');input.value='.4';input.fire('input');await Promise.resolve();assert.equal(x.accepted().sourceBias,.4);
 input.classList.remove('scrubbing');x.document.activeElement=input;input.value='.2';input.fire('input');const n=x.writes.length;await x.dispose();await settle();assert.equal(x.writes.length,n,'closed controls cannot publish an old delayed edit');
});

test('untouched numeric controls preserve accepted precision and one edit publishes once',async()=>{
 const x=await mounted();try{
  x.owner.operations.setOptions({cooling:30.4472070312505});const input=x.field('cooling'),before=x.writes.length;x.document.activeElement=input;input.fire('blur');await Promise.resolve();assert.equal(x.accepted().cooling,30.4472070312505,'tab navigation cannot write rounded display values');assert.equal(x.writes.length,before);
  input.value='27.25';input.fire('input');await settle();input.fire('change');input.fire('blur');await Promise.resolve();assert.equal(x.accepted().cooling,27.25);assert.equal(x.writes.length,before+1,'debounce/change/blur apply one draft once');
  const bias=x.field('sourceBias');x.document.activeElement=bias;bias.value='2';bias.fire('input');await settle();assert.ok(x.owner.read().error);bias.fire('keydown',{key:'Escape'});assert.equal(x.owner.read().error,null,'discarding an invalid draft clears its error');
 }finally{await x.dispose();}
});
