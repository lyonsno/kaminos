// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {mountAuthoredWaterControls} from '../authored-water-controls.mjs';
function fixture({sourceRoot=null,simulationRoot=null}={}){
 const nodes=new Map(),numbers=[],boundInputs=[],drags=new Map();
 const input=selector=>{if(!nodes.has(selector)){const node={value:'',checked:false,dataset:{},classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}};nodes.set(selector,node);}return nodes.get(selector);};
 for(const name of ['width','samples','rate','radius','strength','passes'])numbers.push(input('[data-'+name+']'));
 const section={querySelector:input,querySelectorAll(selector){if(selector==='label')return [];if(selector==='input[type=number]')return [...numbers,...boundInputs];if(selector==='[data-bound]')return boundInputs;const kind=selector.match(/data-bound=(min|max)/)?.[1];return boundInputs.filter(n=>n.dataset.bound===kind);},remove(){}};
 input('[data-bounds]').append=row=>boundInputs.push(...row.children);
 const document={createElement(tag){if(tag==='section')return section;return {type:'',dataset:{},children:[],classList:{add(){}},listeners:{},setAttribute(){},addEventListener(k,fn){this.listeners[k]=fn;},append(child){this.children.push(child);}};}};
 const source=(id,width)=>({id,label:id,settings:{mode:'finite_drop',rate:1200,baseRadius:.08,strength:1.15,drop:{width,samplesPerUnit:32,container:{min:[-2,-1,-2],max:[2,3,2]}}}});
 let selected=source('A',.5),runtime=null,hold=null,historyListener=()=>{};const edits=[];
 const api={subscribeEdits(fn){historyListener=fn;return ()=>historyListener=()=>{};},read:()=>({selected,runtime}),edit:(id,settings)=>{edits.push({id,settings});return hold??Promise.resolve();},add(){},release(){},pause(){}};
 const timers=new Map();let timerId=0;const schedule=fn=>{timers.set(++timerId,fn);return timerId;},cancel=id=>timers.delete(id);
 const controls=mountAuthoredWaterControls({schedule,cancel,document,root:{prepend(){}},sourceRoot,simulationRoot,controls:{installNumberDrag:opts=>{drags.set(opts.input,opts);return {stop(){}};}},api});
 return {controls,input,edits,api,drags,historyChanged:s=>historyListener(s),async settle(){for(const [id,fn] of [...timers]){timers.delete(id);await fn();}},select(id,width){selected=source(id,width);controls.refresh();},draftWidth(width){input('[data-width]').value=width;input('[data-width]').listeners.input();},setRuntime(value){runtime=value;},hold(p){hold=p;}};
}
{
 const f=fixture();f.draftWidth(.75);f.draftWidth(1);assert.equal(f.edits.length,0);await f.settle();assert.equal(f.edits.length,1,'A burst of source input must automatically commit once without Apply');assert.equal(f.edits[0].settings.drop.width,1);
 f.draftWidth(.75);f.select('B',1);await f.settle();assert.equal(f.edits.length,1,'Selection change must cancel the previous source timer');
 f.draftWidth(1.25);f.controls.dispose();await f.settle();assert.equal(f.edits.length,1,'Disposed controls cannot edit sources later');
}

{
 const f=fixture(),drag=f.drags.get(f.input('[data-width]'));drag.onStart();f.draftWidth(.75);await f.settle();assert.equal(f.edits.length,0,'Do not publish tentative drag state');
 f.input('[data-width]').listeners.pointercancel();drag.onEnd();await f.settle();assert.equal(f.edits.length,0,'Escape cancels the whole uncommitted drag');assert.equal(Number(f.input('[data-width]').value),.5);
 drag.onStart();f.draftWidth(.75);drag.onEnd();await f.settle();assert.equal(f.edits.length,1);
}
{
 const f=fixture();let released=0;f.api.release=()=>released++;f.api.edit=()=>{throw Error('Invalid bounds');};f.draftWidth(.75);await f.settle();assert.match(f.input('[data-source-error]').textContent,/Invalid bounds/);await f.input('[data-release]').onclick();assert.equal(released,0,'Release must not silently use old settings when the visible draft is invalid');
 f.api.edit=()=>{};await f.input('[data-release]').onclick();assert.equal(released,1);assert.equal(f.input('[data-source-error]').textContent,'');
}
{
 const f=fixture();let passes=2;const read=f.api.read;f.api.read=()=>({...read(),simulation:{present:true,settings:{densityIterations:passes}}});f.api.editSimulation=patch=>{passes=patch.densityIterations;};f.controls.refresh();f.input('[data-passes]').value=4;f.input('[data-passes]').listeners.input();await f.settle();assert.equal(passes,4,'Simulation properties also commit automatically');
}
{
 const f=fixture();let complete;f.hold(new Promise(r=>complete=r));f.draftWidth(.75);const pending=f.settle();f.select('B',1);f.draftWidth(1.25);complete();await pending;assert.equal(Number(f.input('[data-width]').value),1.25,'Old source completion must not replace the newer draft');await f.settle();assert.equal(f.edits.at(-1).id,'B');
}
console.log('Automatic water properties coalesce, cancel, survive selection and disposal, recover errors and flush before release');

const {createSceneEdits}=await import('../scene-edit-session.mjs');
const {normalizeAuthoredWaterDrop}=await import('../authored-water-drop.mjs');
function historyFixture(){
 const f=fixture(),edits=createSceneEdits({read:()=>null,write(){throw Error('Unexpected transform');}});
 edits.register('@water',{read:()=>structuredClone(f.api.read().selected.settings),check:value=>({...value,drop:normalizeAuthoredWaterDrop(value.drop)}),write:value=>{f.api.read().selected.settings=structuredClone(value);f.controls.refresh();}});
 edits.subscribe(f.historyChanged);f.api.edit=(id,patch)=>edits.apply('@water',{...f.api.read().selected.settings,...patch},'Edit water');return {...f,history:edits};
}
test('SWC-1 pending typing respects Undo and Redo',async()=>{
 const f=historyFixture();f.draftWidth(.75);await f.settle();f.draftWidth(1);await f.history.undo();await f.settle();assert.equal(f.api.read().selected.settings.drop.width,.5,'A pending draft must not overwrite ordinary Undo');assert.equal(f.history.state().redoCount,1,'Undo must retain Redo after the old debounce');await f.history.redo();assert.equal(f.api.read().selected.settings.drop.width,.75);
});
test('SWC-2 consecutive drags own separate edits and cancellation',async()=>{
 const f=historyFixture(),drag=f.drags.get(f.input('[data-width]'));
 drag.onStart();f.draftWidth(.75);drag.onEnd();await Promise.resolve();
 drag.onStart();f.draftWidth(1);f.input('[data-width]').listeners.pointercancel();drag.onEnd();await f.settle();
 assert.equal(f.api.read().selected.settings.drop.width,.75,'Cancelling drag two must preserve completed drag one');assert.equal(f.history.state().undoCount,1);
 drag.onStart();f.draftWidth(1);drag.onEnd();await f.controls.flush();assert.equal(f.history.state().undoCount,2,'Completed numeric drags each own one edit');await f.history.undo();assert.equal(f.api.read().selected.settings.drop.width,.75);
});
for(const container of [true,false])test('SWC-3 blank bounds preserve accepted source, container='+container,async()=>{
 const f=historyFixture();f.input('[data-container]').checked=container;
 const source=f.api.read().selected.settings.drop,originalMin=(source.container??source.worldBounds).min;
 // fixture exposes generated bounds through the installer callbacks.
 const minX=[...f.drags.keys()].find(i=>i.dataset.bound==='min'&&i.dataset.axis===0);
 minX.value='';minX.listeners.input();await f.settle();assert.equal(f.history.state().undoCount,0,'Blank bounds cannot mutate history');assert.match(f.input('[data-source-error]').textContent,/Complete/);assert.deepEqual((f.api.read().selected.settings.drop.container??f.api.read().selected.settings.drop.worldBounds).min,originalMin);
 minX.value='-1.5';minX.listeners.input();await f.settle();const accepted=f.api.read().selected.settings.drop;assert.equal((accepted.container??accepted.worldBounds).min[0],-1.5);assert.equal(f.input('[data-source-error]').textContent,'');
});

test('SWC-1 pending water edit respects Undo on another scene target',async()=>{
 const f=historyFixture();let other=0;f.history.register('@other',{read:()=>({value:other}),check:v=>v,write:v=>{other=v.value;}});f.history.apply('@other',{value:1},'Other');f.draftWidth(.75);await f.history.undo();await f.settle();assert.equal(f.api.read().selected.settings.drop.width,.5);assert.equal(f.history.state().redoCount,1);await f.history.redo();assert.equal(other,1);
});
