// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createMountedWorkshopWater} from '../mounted-workshop-water.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(wait){let allocations=0,active=null,physicalStep=8,pose=null,source={emissionEnabled:false};const host={paused:true,setPaused(v){this.paused=v;},setPresentationFrame(v){pose=v;},setEmitters(){},state:()=>({step:physicalStep}),dispose(){this.disposed=true;}};
 const water=createMountedWorkshopWater({prepareHost:async()=>{allocations++;return wait?await wait.promise:host;},source:()=>source,editSource:p=>Object.assign(source,p),activate:h=>{active=h;},deactivate:h=>{if(active===h)active=null;},frame:()=>({translation:[1,2,3],scale:.2})});return {water,host,source,allocations:()=>allocations,active:()=>active,pose:()=>pose};}
test('Pour is an operation on the prepared owner; Return retains its physical state and prior pause',async()=>{const f=fixture();await f.water.prepare();f.water.present(true);await f.water.pour();assert.equal(f.allocations(),1);assert.equal(f.host.paused,false);assert.equal(f.source.emissionEnabled,true);f.water.present(false);assert.equal(f.host.paused,true);assert.equal(f.active(),null);assert.equal(f.water.read().runtime.step,8);f.water.present(true);assert.equal(f.active(),f.host);assert.equal(f.host.paused,false);assert.equal(f.allocations(),1);await f.water.stop();assert.equal(f.source.emissionEnabled,false);assert.equal(f.host.paused,false);await f.water.dispose();});
test('late preparation while hidden cannot resume or acquire foreground ownership',async()=>{const wait=deferred(),f=fixture(wait);const work=f.water.prepare();f.water.present(true);f.water.present(false);wait.resolve(f.host);await work;assert.equal(f.active(),null);assert.equal(f.host.paused,true);await f.water.dispose();});
test('disposal retires a late host instead of publishing it into a replacement document',async()=>{const wait=deferred(),f=fixture(wait);const work=f.water.prepare();const close=f.water.dispose();wait.resolve(f.host);await Promise.all([work,close]);assert.equal(f.host.disposed,true);assert.equal(f.active(),null);});
test('native Reset invalidates the old host and the next frame prepares the current owner before Pour',async()=>{
 let physical=null,serial=0;
 const make=()=>({id:++serial,paused:true,setPaused(v){this.paused=v;},setPresentationFrame(){},setEmitters(){},state(){return {id:this.id};},dispose(){this.disposed=true;}});
 const water=createMountedWorkshopWater({prepareHost:async()=>physical??=(make()),currentHost:()=>physical,retireHost:()=>{physical?.dispose();physical=null;},source:()=>({}),editSource(){}});
 await water.prepare();water.present(true);await water.pour();const first=physical;first.dispose();physical=null; // ordinary inspector Reset owns this change
 water.sync();assert.equal(water.read().runtime,null,'the disposed host must not remain a reported live runtime');assert.equal(water.read().phase,'preparing');
 await water.prepare();assert.notEqual(physical,first);await water.pour();assert.equal(physical.paused,false);await water.dispose();
});
