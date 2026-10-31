// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import definition from '../experiments/stage-pour.experiment.mjs';
import {stageWordMold,replaceStageMold} from '../stage-mold.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {createOwnerSceneSession} from '../owner-scene-session.mjs';
import {waterControlsFixture} from './helpers/water-controls.mjs';
class Element{children=[];events={};style={};value='';append(...items){this.children.push(...items);}setAttribute(){}addEventListener(k,f){this.events[k]=f;}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(){
 const entries=new Map();let count=0,hold=null;const source=()=>[...entries.values()].filter(o=>o.type==='local-liquid-emitter');
 const document={createElement(tag){if(tag!=='canvas')return new Element();const c={width:0,height:0};c.getContext=()=>({measureText:t=>({width:t.length*12}),fillText(){},getImageData(){const data=new Uint8ClampedArray(c.width*c.height*4);for(let z=28;z<58;z++)for(let x=16;x<c.width-16;x++)data[(z*c.width+x)*4+3]=255;return {data};}});return c;}};
 const app=document.defaultView={kaminosWaterSources:{read:()=>({sources:source().map(o=>({id:o.id})),runtime:null}),reset(){},edit(id,p){Object.assign(entries.get(id).localLiquidEmitter,p);},editSimulation(){}},kaminosLocalLiquidState:()=>({emitters:source()}),kaminosSceneAuthoring:{setStageWord(id,label){const row=entries.get(id);return replaceStageMold(row,stageWordMold(document,label,row.object.userData.kaminosStageMold));},async addWaterEmitter(){if(hold?.kind==='emitter'){const h=hold;hold=null;h.started.resolve();await h.release.promise;}const id='water-'+(++count);entries.set(id,{id,type:'local-liquid-emitter',localLiquidEmitter:{volumeRate:.008}});return id;}},removeSceneObject:id=>entries.delete(id),kaminosSetSceneObjectTransform(){},renameSceneObject(id,label){entries.get(id).label=label;},selectSceneObject(){}};
 const hooks={async attach(root,{owned,metadata}){if(hold?.kind==='attach'){const h=hold;hold=null;h.started.resolve();await h.release.promise;}let row=[...entries.values()].find(o=>o.object===root);if(!row){const id='mold-'+(++count);row={id,object:root,...metadata};entries.set(id,row);}return {id:row.id,root,owned};},remove:h=>entries.delete(h.id),loadAsset(){throw Error('unused');},readView:()=>({}),setView:v=>v,redraw(){},onFrame:()=>()=>{}};
 app.kaminosWaterSources.commitEdits=async()=>{};
 const host={controls:{document},scene:{open:async()=>createOwnerSceneSession(hooks),objects:()=>[...entries.values()]}};
 return {entries,host,document,hold(kind){const h={kind,started:deferred(),release:deferred()};hold=h;return h;},open:()=>openExperiment(definition,{host,record(){}})};
}
test('repeated word changes retain one pair and close releases it',async()=>{
 const f=fixture(),e=await f.open();
 await Promise.all([e.invoke('makeWord','ENCODER'),e.invoke('makeWord','DECODER')]);
 assert.equal(f.entries.size,2);assert.equal((await e.read()).label,'DECODER');await e.dispose();assert.equal(f.entries.size,0);
 const reopened=await f.open();await reopened.dispose();assert.equal(f.entries.size,0);
});
test('close waits for a pending native edit and leaves no owned resources',async()=>{
 const f=fixture(),e=await f.open(),started=deferred(),release=deferred();
 f.document.defaultView.kaminosWaterSources.commitEdits=async()=>{started.resolve();await release.promise;};
 const build=e.invoke('makeWord','DECODER');await started.promise;let done=false;
 const close=e.dispose().then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);
 release.resolve();await Promise.allSettled([build,close]);assert.equal(f.entries.size,0);
});
test('saved native pair can be borrowed without replacing it or deleting it on close',async()=>{
 const f=fixture(),first=await f.open();const saved=[...f.entries.values()];await first.dispose();for(const row of saved)f.entries.set(row.id,row);
 const reopened=await f.open();assert.equal((await reopened.read()).moldId,saved.find(r=>r.source==='kaminos:stage-mold-v1').id);assert.equal(f.entries.size,2);await reopened.dispose();assert.equal(f.entries.size,2,'closing a viewer preserves loaded authored objects');
});
test('pour consumes native source settings across stop, edit, resume and reset',async()=>{
 const f=fixture(),app=f.document.defaultView,water=app.kaminosWaterSources;
 let runtime=null,releases=0;const read=water.read;water.read=()=>({...read(),runtime});
 water.release=async()=>{releases++;runtime={paused:false,step:17};};
 water.reset=()=>{runtime=null;};app.kaminosPauseLocalLiquid=paused=>{runtime.paused=paused;};
 const e=await f.open(),id=(await e.read()).emitterId,settings=f.entries.get(id).localLiquidEmitter;
 water.edit(id,{volumeRate:.0023,baseRadius:.06,strength:.8});await e.invoke('pour');
 assert.equal(releases,1);assert.equal(settings.volumeRate,.0023);
 await e.invoke('stopPour');assert.equal(settings.volumeRate,.0023,'stopping leaves the chosen flow on the source');
 assert.equal(settings.emissionEnabled,false);
 water.edit(id,{volumeRate:.0031,emissionEnabled:false});await e.invoke('pour');
 assert.equal(settings.volumeRate,.0031);assert.equal(settings.emissionEnabled,true);
 assert.equal(settings.baseRadius,.06);assert.equal(settings.strength,.8);
 assert.equal(releases,1,'resuming preserves the existing water world');assert.equal(runtime.step,17);
 water.edit(id,{emissionEnabled:false,volumeRate:0});await e.invoke('pour');assert.equal(settings.volumeRate,0,'explicit zero survives');
 await e.invoke('reset');assert.equal(settings.volumeRate,0);await e.invoke('pour');assert.equal(releases,2);
 await e.dispose();
});
for(const live of [false,true])test('Pour commits the pending native flow before '+(live?'resuming':'releasing'),async()=>{
 const f=fixture(),app=f.document.defaultView,water=app.kaminosWaterSources,e=await f.open(),id=(await e.read()).emitterId;
 const native=waterControlsFixture(),row=f.entries.get(id),rawEdit=water.edit;
 let runtime=live?{paused:true,step:17}:null,releases=0;
 water.edit=(id,patch)=>{rawEdit(id,patch);native.controls.refresh();};
 water.read=()=>({sources:[{id}],runtime});
 water.release=async()=>{releases++;assert.equal(row.localLiquidEmitter.volumeRate,.0031);runtime={paused:false,step:0};};
 app.kaminosPauseLocalLiquid=paused=>{assert.equal(row.localLiquidEmitter.volumeRate,.0031);runtime.paused=paused;};
 native.api.read=()=>({selected:{id,settings:{mode:'continuous',...row.localLiquidEmitter}},runtime});
 native.api.edit=water.edit;
 water.commitEdits=async()=>{if(!await native.controls.flush())throw Error('Complete the pending water edits');};
 water.edit(id,{volumeRate:.0023,emissionEnabled:false});
 const field=native.input('[data-rate]');field.value='3.1';field.listeners.input();
 await e.invoke('pour');assert.equal(field.value,3.1);assert.equal(row.localLiquidEmitter.volumeRate,.0031);assert.equal(row.localLiquidEmitter.emissionEnabled,true);
 assert.equal(releases,live?0:1);if(live)assert.equal(runtime.step,17);
 field.value='';field.listeners.input();
 await assert.rejects(e.invoke('pour'),/pending water edits/);assert.equal(row.localLiquidEmitter.volumeRate,.0031);assert.equal(releases,live?0:1);
 native.controls.dispose();await e.dispose();
});

test('changing the word preserves the existing mold, spigot source and authored settings',async()=>{
 const f=fixture(),e=await f.open(),before=await e.read();
 const emitter=f.entries.get(before.emitterId),mold=f.entries.get(before.moldId);
 emitter.groupId='spigot';emitter.localLiquidEmitter.volumeRate=.0037;
 mold.object.position.set(2,3,4);
 await e.invoke('makeWord','DECODER');const after=await e.read();
 assert.equal(after.emitterId,before.emitterId,'editing the mold must not detach the spigot');
 assert.equal(after.moldId,before.moldId,'editing lettering must retain the mold object');
 assert.equal(after.label,'DECODER');assert.equal(emitter.groupId,'spigot');
 assert.equal(emitter.localLiquidEmitter.volumeRate,.0037);
 assert.deepEqual(mold.object.position.toArray(),[2,3,4]);await e.dispose();
});

test('mold changes refuse to erase existing liquid and reset preserves source identity',async()=>{
 const f=fixture(),e=await f.open(),water=f.document.defaultView.kaminosWaterSources;
 const before=await e.read(),read=water.read;let runtime={step:3};water.read=()=>({...read(),runtime});water.reset=()=>{runtime=null;};
 await assert.rejects(e.invoke('makeWord','DECODER'),/Reset water/);
 assert.equal((await e.read()).label,before.label);assert.equal(runtime.step,3);
 await e.invoke('reset');await e.invoke('makeWord','DECODER');assert.equal((await e.read()).emitterId,before.emitterId);await e.dispose();
});
test('flow is an agent-callable source edit and preserves explicit zero',async()=>{
 const f=fixture(),e=await f.open(),id=(await e.read()).emitterId;
 await e.invoke('setFlow',2.3);assert.equal(f.entries.get(id).localLiquidEmitter.volumeRate,.0023);
 await e.invoke('setFlow',0);assert.equal(f.entries.get(id).localLiquidEmitter.volumeRate,0);
 await assert.rejects(e.invoke('setFlow',-1),/zero or more/);await e.dispose();
});

test('an observed empty paused water world does not obstruct word editing',async()=>{
 const f=fixture(),e=await f.open(),water=f.document.defaultView.kaminosWaterSources,read=water.read;
 water.read=()=>({...read(),runtime:{paused:true,population:{active:0,authority:'completed_gpu_occupancy'}}});
 await e.invoke('makeWord','DECODER');assert.equal((await e.read()).label,'DECODER');await e.dispose();
});
