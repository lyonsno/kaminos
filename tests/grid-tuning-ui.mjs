// kaminos-test: node
import assert from 'node:assert/strict';
import {createGridTuningInspector} from '../volume-grid-tuning-ui.mjs';
import {GRID_TUNING_FIELDS,gridTuningPlan} from '../volume-grid-tuning.mjs';
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.listeners={};this.value='';}
 append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
 setAttribute(){} addEventListener(type,fn){this.listeners[type]=fn;}
 get options(){return this.children;} cloneNode(){const c=new Element(this.tagName);Object.assign(c,this);return c;}
 focus(){document.activeElement=this;} blur(){document.activeElement=null;}
}
const host=new Element('div'),body=new Element('body'),backing=Object.fromEntries(GRID_TUNING_FIELDS.map(([,id])=>[id,new Element('select')]));
backing['volume-pressure-solver-iterations'].min='4';backing['volume-pressure-solver-iterations'].max='240';
const document={body,activeElement:null,listeners:{},createElement:tag=>new Element(tag),getElementById:id=>backing[id],addEventListener(type,fn){this.listeners[type]=fn;}};
let dragCount=0,liveCount=0;
let current={pressureSolver:'converged-open-top',resolution:64,gridHeightRatio:2,fineVelocity:32,finePressure:16,pressureSolverIterations:12,worldSmoke:'on',worldSmokeFlow:16,worldSmokeMaterial:64,worldSmokePressure:8,worldSmokeExtent:4,worldSmokeTransition:2,worldSmokeIntermediate:'off',intermediateFlow:24,intermediateMaterial:48,intermediatePressure:12,intermediateExtent:1.5,intermediateIterations:12},applications=0;
const inspector=createGridTuningInspector({document,host,read:()=>current,validate:gridTuningPlan,apply:p=>{current={...current,...p};applications++;},live:(key,value)=>{current={...current,[key]:value};liveCount++;},installNumberDrag:()=>{dragCount++;return {dispose(){}};}});
const find=(id,node=body)=>node.id===id?node:node.children.map(child=>find(id,child)).find(Boolean);
const edit=(key,value)=>{const e=find('grid-draft-'+key);e.focus();e.value=String(value);e.listeners.input();return e;};
inspector.open();assert.equal(find('grid-tuning-editor').hidden,false);
const velocity=edit('fineVelocity',37);inspector.sync();assert.equal(velocity.value,'37','focused numeric draft survives live refresh');assert.equal(current.fineVelocity,32,'draft does not change simulation');
edit('finePressure',19);
document.listeners.keydown({ctrlKey:true,key:'Enter',preventDefault(){}});
assert.equal(applications,1);assert.equal(current.fineVelocity,37);assert.equal(current.finePressure,19);
edit('worldSmokeFlow',32);assert.equal(find('grid-draft-collarReach').value,'0.5','velocity change preserves physical collar reach');
find('grid-tuning-apply').onclick();assert.equal(current.worldSmokeTransition,4);
edit('fineVelocity',35);document.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(find('grid-tuning-editor').hidden,true);inspector.open();assert.equal(velocity.value,'35','closing retains unfinished draft');
current={...current,fineVelocity:24};inspector.sync();assert.equal(find('grid-tuning-apply').disabled,true,'stale draft cannot overwrite other edits');
find('grid-tuning-reset').onclick();assert.equal(velocity.value,'24','discard restores current applied values');
edit('finePressure',-1);assert.equal(find('grid-tuning-apply').disabled,true);find('grid-tuning-apply').onclick();assert.equal(applications,2,'invalid dimensions cannot mutate simulation');
console.log('PASS keyboard apply, preserved draft/focus, stale/invalid refusal, physical collar preservation');

find('grid-tuning-reset').onclick();edit('fineVelocity',33);edit('pressureSolverIterations',7);assert.equal(current.pressureSolverIterations,7,'iterations update live');assert.equal(current.fineVelocity,24,'live iterations do not apply pending dimensions');assert.equal(liveCount,1);assert.equal(find('grid-tuning-apply').disabled,false,'valid pending dimensions survive live iteration');assert.ok(dragCount>=16,'numeric fields share drag interaction');

find('grid-tuning-reset').onclick();edit('worldSmokeFlow','');edit('worldSmokeFlow',24);assert.equal(Number(find('grid-draft-collarReach').value),.5,'clearing velocity retains intended physical reach');find('grid-tuning-apply').onclick();assert.equal(current.worldSmokeTransition,3);
edit('worldSmokeExtent','');edit('worldSmokeExtent',6);assert.equal(Number(find('grid-draft-collarReach').value),.5,'clearing coverage retains intended reach');find('grid-tuning-apply').onclick();assert.equal(current.worldSmokeTransition,2);

find('grid-tuning-reset').onclick();const acceptedIterations=current.pressureSolverIterations;edit('fineVelocity',29);edit('pressureSolverIterations',1);assert.equal(current.pressureSolverIterations,acceptedIterations);assert.equal(find('grid-tuning-apply').disabled,true,'out-of-range live value refuses before Apply');edit('pressureSolverIterations',241);assert.equal(current.pressureSolverIterations,acceptedIterations);edit('pressureSolverIterations',8);assert.equal(current.pressureSolverIterations,8);assert.equal(current.fineVelocity,24,'live preview retains independent dimension draft');assert.equal(find('grid-tuning-apply').disabled,false);
current={...current,pressureSolverIterations:12};inspector.sync();assert.equal(find('grid-tuning-apply').disabled,false,'iteration Undo keeps the pending dimension draft usable');assert.equal(find('grid-draft-fineVelocity').value,'29');
