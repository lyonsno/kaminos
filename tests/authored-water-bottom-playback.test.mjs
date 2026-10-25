// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {mountAuthoredWaterControls} from '../authored-water-controls.mjs';
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.listeners={};this.value='';this.textContent='';this.classList={add(){}};this.nodes=new Map();}
 append(...nodes){for(const n of nodes){n.remove?.();this.children.push(n);n.parent=this;}}
 prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))];}
 before(n){const p=this.parent,i=p.children.indexOf(this);p.children.splice(i,0,n);n.parent=p;}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
 setAttribute(k,v){this.attributes[k]=String(v);} addEventListener(k,f){this.listeners[k]=f;}
 querySelector(s){if(!this.nodes.has(s))this.nodes.set(s,new Element('div'));return this.nodes.get(s);}
 querySelectorAll(){return [];}
 style={};
}
const find=(node,predicate)=>predicate(node)?node:node.children.map(n=>find(n,predicate)).find(Boolean);
function fixture(){
 const document={createElement:t=>new Element(t)},root=new Element('div'),viewport=new Element('div');
 let runtime={step:24,dt:1/120,time:.2,paused:true,rate:1},dt=1/60,pending=null,epoch=0,lateDisposed=false;
 const source={id:'A',mode:'finite_drop',settings:{mode:'finite_drop',drop:{width:.5,samplesPerUnit:16}}};
 const api={read:()=>({selected:source,sources:[source],simulation:{present:true,settings:{simulationStepSeconds:dt,densityIterations:2}},runtime}),readStatus:()=>({runtime}),
  setPaused:p=>{if(runtime)runtime.paused=p;},setPlaybackRate:r=>{runtime.rate=r;},advanceTo:n=>{runtime.step=n;runtime.time=n*runtime.dt;},
  release:async(_,opts)=>{const own=epoch;if(pending)await pending;if(own!==epoch){lateDisposed=true;throw Error('Water release superseded or scene changed');}runtime={step:0,dt,time:0,paused:opts.paused,rate:1};},reset:()=>{epoch++;runtime=null;}
 };
 const controls=mountAuthoredWaterControls({document,root,viewport,controls:{installNumberDrag:()=>({stop(){}})},api});
 const bar=viewport.children[0],button=text=>find(bar,n=>n.tagName==='button'&&n.textContent===text),field=label=>find(bar,n=>n.attributes?.['aria-label']===label);
 return {controls,button,field,bar,read:()=>runtime,lateDisposed:()=>lateDisposed,hold:p=>pending=p};
}
await test('backward seek preserves seconds after a timestep edit',async()=>{
 const f=fixture();f.field('Seek time in seconds').value='.1';await f.button('Go').onclick();
 assert.equal(f.read().dt,1/60);assert.equal(f.read().time,.1,'Seek recalculates its tick on the effective restarted timestep');assert.equal(f.read().step,6);assert.equal(f.read().paused,true);f.controls.dispose();
});
await test('Reset suppresses superseded Replay error',async()=>{
 const f=fixture();let complete;f.hold(new Promise(r=>complete=r));const replay=f.button('↻ Replay').onclick();
 for(let i=0;i<6;i++)await Promise.resolve();await f.button('Reset').onclick();complete();await replay;
 assert.equal(f.read(),null);assert.equal(f.lateDisposed(),true);assert.equal(find(f.bar,n=>n.className==='playback-error').textContent,'','Reset suppresses obsolete bottom Replay errors');f.controls.dispose();
});
await test('current Replay failure stays visible',async()=>{
 const f=fixture();f.hold(Promise.reject(Error('Current allocation failed')));await f.button('↻ Replay').onclick();assert.equal(find(f.bar,n=>n.className==='playback-error').textContent,'Current allocation failed','Current failures remain visible');f.controls.dispose();
});
