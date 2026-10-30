// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrainIndex} from '../mineral-worlds/crust-spatial.mjs';
import {createCrustClock} from '../mineral-worlds/crust-clock.mjs';
import {createCrust,trackGeometry} from '../mineral-worlds/crust.mjs';
import {createCrustSurface} from '../mineral-worlds/crust-surface.mjs';
const grain=(id,x,z,size=.01)=>({id,x,z,angle:0,faces:[size/2,-size/2,size/2,-size/2,size,0]});
test('collision candidates stay local across grain scales and repeated updates are idempotent',()=>{
 const grains=Array.from({length:100},(_,i)=>grain(i,(i%10)*.03,Math.floor(i/10)*.03)),index=createGrainIndex(grains),g=grains[55];
 assert.equal(index.query(g).size,0,'separated micrograins must not all share collision candidates');
 const n=index.read().entries;for(let i=0;i<5;i++)index.update(g);assert.equal(index.read().entries,n,'updating an unchanged grain must not duplicate bucket entries');
 const neighbor=grains[56];g.faces[0]=.04;index.update(g);assert.ok(index.query(g).has(neighbor),'growth across a previous cell boundary must remain visible');
 g.faces[0]=.005;g.x=-3;index.update(g);assert.equal(index.query(neighbor).has(g),false,'old memberships must be removed after geometry changes');
 const large=grain(100,0,0,4);index.update(large);assert.ok(index.query(neighbor).has(large),'coarse and fine index levels must see each other');
});
test('playback yields overdue work without losing steps and stops queued work on hold',()=>{
 const queue=new Map();let id=0,total=0,changes=0;const clock=createCrustClock({advance:dt=>total+=dt,onChange:()=>changes++,requestIdle:fn=>{queue.set(++id,fn);return id;},cancelIdle:i=>queue.delete(i)});
 clock.configure(true,8);clock.frame(1);assert.equal(total,0,'the frame callback must not execute all overdue physics');
 let turn=queue.entries().next().value;queue.delete(turn[0]);let allowance=1;turn[1]({timeRemaining:()=>allowance-->0?1:0});
 assert.ok(Math.abs(total-.1)<1e-10);assert.ok(Math.abs(clock.read().pendingModelSeconds-7.9)<1e-10);assert.equal(changes,1);
 clock.configure(false,8);const held=total;for(const fn of queue.values())fn({timeRemaining:()=>50});queue.clear();assert.equal(total,held);assert.ok(clock.read().pendingModelSeconds>7);
 clock.configure(true,8);while(queue.size){const [key,fn]=queue.entries().next().value;queue.delete(key);fn({timeRemaining:()=>50});}
 assert.ok(Math.abs(total-8)<1e-9);assert.ok(clock.read().pendingModelSeconds<.1);
 clock.frame(1);clock.configure(true,0);for(const fn of queue.values())fn({timeRemaining:()=>50});queue.clear();assert.ok(Math.abs(total-8)<1e-9);clock.reset();assert.equal(clock.read().pendingModelSeconds,0);clock.dispose();
});
test('wet presentation keeps its buffers between same-size updates',()=>{
 const state=createCrust({rows:1}),surface=createCrustSurface(state),wet=surface.root.children.find(x=>x.name==='Retained brine films'),geometry=wet.geometry,positions=geometry.attributes.position;
 state.tick++;surface.update(state);assert.equal(wet.geometry,geometry);assert.equal(wet.geometry.attributes.position,positions);surface.dispose();
});

test('numeric overflow pauses requests while preserving the last finite pending queue',()=>{
 for(const [pending,rate,delta]of [[3,1e308,2],[1e308,1e308,1]]){
  const errors=[],tasks=new Map();let next=0;const clock=createCrustClock({advance(){throw Error('must not advance');},onError:e=>errors.push(e.message),requestIdle:cb=>{tasks.set(++next,cb);return next;},cancelIdle:id=>tasks.delete(id)});
  clock.reset(pending);clock.configure(true,rate);clock.frame(delta);assert.equal(clock.read().pendingModelSeconds,pending);assert.equal(clock.read().scheduled,false);assert.equal(tasks.size,0);assert.match(errors[0],/overflow/i);
  clock.frame(1);assert.equal(errors.length,1);assert.equal(clock.read().pendingModelSeconds,pending);assert.equal(JSON.parse(JSON.stringify(clock.read())).pendingModelSeconds,pending);clock.dispose();
 }
});

test('an anchored branch evaluates its retained attachment without reconstructing the parent passage',()=>{
 const state=createCrust({rows:3}),gap=state.pools.find(p=>p.kind==='gap'),film=state.pools.find(p=>p.kind==='film'&&!gap.walls.includes(p.carrier)),branch={...film,kind:'branch',a:gap.id,anchor:[.2,.018,.1]};
 const expected=trackGeometry(state,branch);let unrelatedReads=0;const grains=state.grains;
 state.grains=new Proxy(grains,{get(target,key){if(typeof key==='string'&&gap.walls.includes(Number(key)))unrelatedReads++;return Reflect.get(target,key);}});
 const actual=trackGeometry(state,branch);assert.deepEqual(actual,expected);assert.equal(unrelatedReads,0,'retained branch anchors must not rebuild their parent slot geometry');
});

test('gap geometry retains its endpoint semantics when a saved track has an anchor field',()=>{
 const state=createCrust({rows:3}),gap=state.pools.find(p=>p.kind==='gap'),before=trackGeometry(state,gap);gap.anchor=[20,0,20];assert.deepEqual(trackGeometry(state,gap),before);
});
