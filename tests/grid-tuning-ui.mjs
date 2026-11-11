// kaminos-test: node
import assert from 'node:assert/strict';
import {createGridTuningInspector} from '../volume-grid-tuning-ui.mjs';
import {GRID_TUNING_FIELDS,gridTuningPlan} from '../volume-grid-tuning.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createFlameAuthoring} from '../flame-authoring.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.listeners={};this.value='';}
 append(...nodes){this.children.push(...nodes);} prepend(...nodes){this.children.unshift(...nodes);}
 setAttribute(){} addEventListener(type,fn){const previous=this.listeners[type];this.listeners[type]=previous?e=>{previous(e);fn(e);}:fn;}
 removeEventListener(){}
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

// Closing a hidden inspector must finish a focus-only live gesture even when
// its launcher lives in an inactive inspector tab and cannot receive focus.
document.body=new Element('body');
const edits=createSceneEdits({read:()=>({}),write:()=>{}});
const authoring=createFlameAuthoring({edits,read:()=>current,write:next=>{current=next;},check:x=>x});
current={...current,pressureSolverIterations:12};
const closing=createGridTuningInspector({document,host:new Element('div'),read:()=>current,validate:gridTuningPlan,apply:next=>authoring.apply(next),live:(key,value)=>authoring.preview({...current,[key]:value}),bindLiveField:input=>installSceneControlHistory({controls:[input],edits,id:'@flame-settings'}),installNumberDrag:()=>({dispose(){}})});
const number=key=>find('grid-draft-'+key,document.body);
const event=(input,type)=>input.listeners[type]?.({currentTarget:input,preventDefault(){}});
closing.open();const liveField=number('pressureSolverIterations');event(liveField,'focusin');liveField.value='7';event(liveField,'input');event(liveField,'change');assert.equal(edits.state().undoCount,1);
const focusOnly=number('intermediateIterations');event(focusOnly,'focusin');assert.equal(edits.state().active.id,'@flame-settings');closing.close();assert.equal(edits.state().active,null,'closing releases a focus-only live gesture before hiding controls');edits.undo();assert.equal(current.pressureSolverIterations,12,'Undo reaches the last actual live change after closing');

// World scale is a live authored value: one edit per gesture, with cancellation.
document.body=new Element('body');
current={...current,calibrationMode:'world',simulationWorldScale:2,calibrationMaterialCells:64,calibrationVelocityCells:32};
const calibrated=createGridTuningInspector({document,host:new Element('div'),read:()=>current,validate:gridTuningPlan,apply:next=>authoring.apply(next),calibration:{
 set:(patch,{preview=false}={})=>preview?authoring.preview({...current,...patch}):authoring.apply({...current,...patch}),capture:()=>{},
},bindLiveField:input=>installSceneControlHistory({controls:[input],edits,id:'@flame-settings'}),installNumberDrag:()=>({dispose(){}})});
calibrated.open();const width=find('grid-calibration-width',document.body),before=edits.state().undoCount;
event(width,'focusin');width.value='2.4';event(width,'input');width.value='2.8';event(width,'input');
assert.equal(current.simulationWorldScale,2.8,'world scale previews while the gesture owns history');assert.equal(edits.state().undoCount,before,'intermediate previews do not commit');
event(width,'change');assert.equal(edits.state().undoCount,before+1);edits.undo();assert.equal(current.simulationWorldScale,2);edits.redo();assert.equal(current.simulationWorldScale,2.8);
event(width,'focusin');width.value='3';event(width,'input');width.listeners.keydown({currentTarget:width,key:'Escape',preventDefault(){}});assert.equal(current.simulationWorldScale,2.8,'Escape restores the pre-gesture reference');
event(width,'focusin');width.value='3.2';event(width,'input');calibrated.close();assert.equal(edits.state().active,null,'closing releases the calibration gesture');assert.equal(current.simulationWorldScale,3.2);edits.undo();assert.equal(current.simulationWorldScale,2.8);
console.log('PASS world-scale preview, single undo entry, Escape cancellation and close commit');

// The periodic flame readout also syncs this editor while its dialog is closed.
// Defer its reads/planning until open, then reconcile against the applied state.
document.body=new Element('body');document.activeElement=null;
let hiddenCurrent={...current},reads=0,plans=0,hiddenApplications=0;
const deferred=createGridTuningInspector({document,host:new Element('div'),
 read:()=>{reads++;return hiddenCurrent;},
 validate:c=>{plans++;return gridTuningPlan(c);},
 apply:patch=>{hiddenCurrent={...hiddenCurrent,...patch};hiddenApplications++;},
 installNumberDrag:()=>({dispose(){}}),
});
const hiddenField=key=>find('grid-draft-'+key,document.body);
const hiddenEdit=(key,value)=>{const input=hiddenField(key);input.focus();input.value=String(value);event(input,'input');};
const counts=()=>[reads,plans];
let idleCounts=counts();deferred.sync();deferred.sync();
assert.deepEqual(counts(),idleCounts,'closed editor sync must not read or validate simulation settings');
hiddenCurrent={...hiddenCurrent,fineVelocity:26};deferred.open();
assert.equal(hiddenField('fineVelocity').value,'26','first open reads the latest applied state');
assert.ok(reads>idleCounts[0]&&plans>idleCounts[1],'opening performs the deferred read and validation');
deferred.close();idleCounts=counts();hiddenCurrent={...hiddenCurrent,fineVelocity:27};deferred.sync();
assert.deepEqual(counts(),idleCounts,'external changes do not wake the closed editor');
deferred.open();assert.equal(hiddenField('fineVelocity').value,'27','clean reopen refreshes external changes');
hiddenEdit('fineVelocity',29);deferred.close();idleCounts=counts();
hiddenCurrent={...hiddenCurrent,pressureSolverIterations:16};deferred.sync();
assert.deepEqual(counts(),idleCounts,'pending drafts do not require hidden planning');
deferred.open();
assert.equal(hiddenField('fineVelocity').value,'29','reopen retains pending dimensions');
assert.equal(hiddenField('pressureSolverIterations').value,'16','reopen merges external live iterations');
assert.equal(find('grid-tuning-apply',document.body).disabled,false,'iteration change keeps the dimension draft applicable');
find('grid-tuning-apply',document.body).onclick();
assert.equal(hiddenApplications,1);assert.equal(hiddenCurrent.fineVelocity,29);assert.equal(hiddenCurrent.pressureSolverIterations,16);
hiddenEdit('fineVelocity',30);deferred.close();hiddenCurrent={...hiddenCurrent,fineVelocity:25};deferred.sync();deferred.open();
assert.equal(hiddenField('fineVelocity').value,'30','stale draft survives closing');
assert.equal(find('grid-tuning-apply',document.body).disabled,true,'reopen refuses a draft conflicting with external dimensions');
find('grid-tuning-apply',document.body).onclick();assert.equal(hiddenApplications,1,'stale draft cannot overwrite applied dimensions');
find('grid-tuning-reset',document.body).onclick();assert.equal(hiddenField('fineVelocity').value,'25','discard loads current applied dimensions');
console.log('PASS closed-editor idle work, fresh reopen, retained draft and external iteration/dimension reconciliation');

// The box join uses the same per-unit grid settings path as dimensions. Its
// string value must survive the editor rather than being coerced to NaN.
const join=hiddenField('worldSmokeJoin');
assert.ok(join,'World exposes a box-join comparison control');
join.value='projected-donor';event(join,'change');
find('grid-tuning-apply',document.body).onclick();
assert.equal(hiddenCurrent.worldSmokeJoin,'projected-donor');
assert.throws(()=>gridTuningPlan({...hiddenCurrent,worldSmokeJoin:'unknown'}),/box join/i);
