// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrainIndex} from '../mineral-worlds/crust-spatial.mjs';
import {createCrustClock} from '../mineral-worlds/crust-clock.mjs';
import {createCrust} from '../mineral-worlds/crust.mjs';
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
