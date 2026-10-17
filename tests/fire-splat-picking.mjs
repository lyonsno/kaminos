// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as picking from '../fire-splat-picking.mjs';

const snapshot=(rows,generation=1)=>({kind:'heat-blocks',floatsPerBlock:7,count:rows.length,
  data:new Float32Array(rows.flat()),fieldGeneration:generation,heatReference:1,writeTick:16});
const ray=(x=0,y=0)=>({origin:[x,y,5],direction:[0,0,-1]});
const block=(x=0,y=0,z=0,heat=1,smoke=0,size=1)=>[x,y,z,heat,smoke,0,size];
const pick=(s,r=ray(),options={})=>picking.pickFireSplats(s,r,[0,0,5],options);

test('hot or smoky splats select material, not the empty space inside a domain',()=>{
  const s=snapshot([block()]);
  assert.equal(pick(s)?.block,0);
  assert.equal(pick(s,ray(3)),null);
  assert.equal(pick(snapshot([block(0,0,0,0,0)])),null);
  assert.ok(pick(snapshot([block(0,0,0,0,.5)])));
});

test('soft splat corners and weak tails do not act like rectangular hit targets',()=>{
  const s=snapshot([block()]);
  assert.equal(pick(s,ray(1.1,1.6)),null);
  assert.equal(pick(s,ray(1.1)),null);
  assert.ok(pick(s,ray(0,.7)),'stretched footprint follows the rendered splat');
});

test('opaque scene depth clips material before opacity accumulation',()=>{
  const s=snapshot([block(0,0,0,1,0),block(0,0,-2,1,0)]);
  assert.equal(pick(s,ray(),{maxDistance:4}),null);
  assert.ok(pick(s,ray(),{maxDistance:6}));
  assert.equal(pick(s,ray(),{near:6,maxDistance:6.5}),null,'no material before the camera near plane');
});

test('several translucent splats contribute together, sorted along the click ray',()=>{
  const s=snapshot([block(0,0,-1,0,.025),block(0,0,0,0,.025)]);
  assert.equal(pick(snapshot([block(0,0,0,0,.025)])),null);
  assert.ok(pick(s));
  assert.equal(pick(s,ray(),{maxDistance:5.5}),null,'occluded material cannot complete the hit');
});

test('a camera above the flame has a finite billboard basis',()=>{
  const s=snapshot([block()]);
  assert.ok(picking.pickFireSplats(s,{origin:[0,5,0],direction:[0,-1,0]},[0,5,0]));
});

test('empty, malformed or retired snapshots never masquerade as a current flame hit',()=>{
  assert.equal(pick(null),null);
  assert.equal(pick(snapshot([])),null);
  assert.equal(pick({...snapshot([block()]),data:new Float32Array(2)}),null);
  assert.equal(pick(snapshot([block()],1),ray(),{fieldGeneration:2}),null);
  assert.equal(pick(snapshot([block()],2),ray(),{fieldGeneration:2})?.block,0);
});
