// kaminos-test: node
import assert from 'node:assert/strict';
import {createGridTuningInspector} from '../volume-grid-tuning-ui.mjs';
import {GRID_TUNING_FIELDS,gridTuningPlan} from '../volume-grid-tuning.mjs';

// Only the DOM operations used by this inspector; native popup behavior is
// exercised separately in Chromium. This contract checks refresh mutations.
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.listeners={};this.value='';}
 append(...nodes){this.children.push(...nodes);}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(){}
 addEventListener(type,fn){this.listeners[type]=fn;}
 get options(){return this.children;}
 cloneNode(){const copy=new Element(this.tagName);Object.assign(copy,this);return copy;}
}
const host=new Element('div'),backing=Object.fromEntries(GRID_TUNING_FIELDS.map(([,id])=>[id,new Element('select')]));
const document={activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>backing[id]};
let current={pressureSolver:'converged-open-top',resolution:128,gridHeightRatio:2,fineVelocity:16,finePressure:8,pressureSolverIterations:12,worldSmoke:'on',worldSmokeFlow:16,worldSmokeMaterial:32,worldSmokePressure:8,worldSmokeExtent:4,worldSmokeIntermediate:'fields',intermediateFlow:24,intermediateMaterial:48,intermediatePressure:12,intermediateExtent:1.5,intermediateIterations:12};
const inspector=createGridTuningInspector({document,host,read:()=>current,validate:gridTuningPlan,apply:patch=>{current={...current,...patch};}});
const find=(id,node=host)=>node.id===id?node:node.children.map(child=>find(id,child)).find(Boolean);
const velocity=find('grid-draft-fineVelocity'),pressure=find('grid-draft-finePressure'),world=find('grid-draft-worldSmokePressure');
for(const select of [velocity,pressure,world]){
 document.activeElement=select;
 const options=[...select.options];
 // Native selects can highlight a candidate before dispatching change.
 select.value='4';
 inspector.sync();
 assert.equal(select.options[0],options[0],'an unchanged refresh must retain native options while the menu is open');
 assert.equal(select.value,'4','unchanged draft must not overwrite a pending native choice');
 select.listeners.change();inspector.sync();
 assert.equal(select.value,'4','the selected draft survives refresh');
 find('grid-tuning-reset').onclick();
 assert.equal(select.value,String(current[select.id.replace('grid-draft-','')]),'Discard restores the applied selection even if focused');
}
document.activeElement=null;
velocity.value='8';velocity.listeners.change();
assert.deepEqual(pressure.options.map(o=>o.value),['0','2','4','8'],'dependent pressure options follow the velocity draft');
pressure.value='2';pressure.listeners.change();find('grid-tuning-apply').onclick();
assert.equal(current.fineVelocity,8);assert.equal(current.finePressure,2);assert.equal(current.resolution,128);
current={...current,fineVelocity:4};inspector.sync();
assert.equal(velocity.value,'4','clean inspector follows changes to applied state');
pressure.value='4';pressure.listeners.change();velocity.value='2';velocity.listeners.change();
assert.match(pressure.options.at(-1).textContent,/incompatible/,'retain an invalid draft visibly instead of silently choosing another value');
assert.equal(find('grid-tuning-apply').disabled,true);
console.log('PASS stable grid options, pending selection, independent widths, changed domains and invalid drafts');
