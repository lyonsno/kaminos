// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import definition from '../experiments/stage-pour.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {createOwnerSceneSession} from '../owner-scene-session.mjs';
class Element{children=[];events={};style={};value='';append(...items){this.children.push(...items);}setAttribute(){}addEventListener(k,f){this.events[k]=f;}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(){
 const entries=new Map();let count=0,hold=null;const source=()=>[...entries.values()].filter(o=>o.type==='local-liquid-emitter');
 const document={createElement(tag){if(tag!=='canvas')return new Element();const c={width:0,height:0};c.getContext=()=>({measureText:t=>({width:t.length*12}),fillText(){},getImageData(){const data=new Uint8ClampedArray(c.width*c.height*4);for(let z=28;z<58;z++)for(let x=16;x<c.width-16;x++)data[(z*c.width+x)*4+3]=255;return {data};}});return c;}};
 const app=document.defaultView={kaminosWaterSources:{read:()=>({sources:source().map(o=>({id:o.id})),runtime:null}),reset(){},edit(id,p){Object.assign(entries.get(id).localLiquidEmitter,p);},editSimulation(){}},kaminosLocalLiquidState:()=>({emitters:source()}),kaminosSceneAuthoring:{async addWaterEmitter(){if(hold?.kind==='emitter'){const h=hold;hold=null;h.started.resolve();await h.release.promise;}const id='water-'+(++count);entries.set(id,{id,type:'local-liquid-emitter',localLiquidEmitter:{volumeRate:.008}});return id;}},removeSceneObject:id=>entries.delete(id),kaminosSetSceneObjectTransform(){},renameSceneObject(id,label){entries.get(id).label=label;},selectSceneObject(){}};
 const hooks={async attach(root,{owned,metadata}){if(hold?.kind==='attach'){const h=hold;hold=null;h.started.resolve();await h.release.promise;}let row=[...entries.values()].find(o=>o.object===root);if(!row){const id='mold-'+(++count);row={id,object:root,...metadata};entries.set(id,row);}return {id:row.id,root,owned};},remove:h=>entries.delete(h.id),loadAsset(){throw Error('unused');},readView:()=>({}),setView:v=>v,redraw(){},onFrame:()=>()=>{}};
 const host={controls:{document},scene:{open:async()=>createOwnerSceneSession(hooks),objects:()=>[...entries.values()]}};
 return {entries,host,document,hold(kind){const h={kind,started:deferred(),release:deferred()};hold=h;return h;},open:()=>openExperiment(definition,{host,record(){}})};
}
test('mounted repeated Build callbacks retain one pair and close releases it',async()=>{
 const f=fixture(),e=await f.open(),root=new Element();await e.mount({root,document:f.document});const button=root.children.flatMap(x=>x.children??[]).find(x=>x.textContent==='Build word');
 await Promise.all([button.events.click(),button.events.click()]);assert.equal(f.entries.size,2,'one mold and emitter after both mounted builds');await e.dispose();assert.equal(f.entries.size,0);const reopened=await f.open();await reopened.dispose();assert.equal(f.entries.size,0);
});
for(const kind of ['attach','emitter'])test('close waits for pending '+kind+' and leaves no resources',async()=>{
 const f=fixture(),e=await f.open(),h=f.hold(kind);const build=e.invoke('makeWord','DECODER');await h.started.promise;let done=false;const close=e.dispose().then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);h.release.resolve();await Promise.allSettled([build,close]);assert.equal(f.entries.size,0,'late creation belongs to the closing lifecycle');
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
