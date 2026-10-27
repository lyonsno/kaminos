// kaminos-test: node
import assert from 'node:assert/strict';
import {createHandContactState} from '../models/mobrecon/hand-contact-state.js';
import * as witness from '../models/mobrecon/hand-reach-witness.mjs';

const assertResponse=process.argv.includes('--baseline')?(before,after)=>{
  assert.ok(after.contactEvents>before.contactEvents);
  assert.equal(after.grabbed,false);
  assert.ok(Math.hypot(...after.cubePosition.map((v,i)=>v-before.cubePosition[i]))>.001);
}:witness.assertFingerContactResponse;

const separating=createHandContactState();
const proxy=x=>[{id:'index-3-4/4',finger:'index',position:[x,.6,0],radius:.007}];
separating.setProxies(proxy(0));separating.setProxies(proxy(-.05));separating.advance(.04);
const point=separating.read().proxies[0].position;
separating.setCube({position:point.map((v,i)=>v+(i===0?.025:0)),size:.045});
const before=separating.read();
for(let i=0;i<30;i++)separating.advance(1/120);
const after=separating.read();
assert.ok(after.contactEvents>before.contactEvents,'the negative case really has contact equations');
assert.ok(before.cubePosition[1]-after.cubePosition[1]>.3,'gravity supplies misleading motion');
assert.throws(()=>assertResponse(before,after),/normal impulse/,'separating contact plus gravity must not prove finger causality');
separating.dispose();

const supporting=createHandContactState({tableHeight:0,cube:{position:[0,.14,0],size:.045}});
supporting.setProxies([{id:'palm',finger:'palm',position:[0,.1,0],radius:.02}]);
const start=supporting.read();supporting.advance(.3);const end=supporting.read();
const response=assertResponse(start,end);
assert.ok(response.normalImpulse>1e-4);
assert.ok(response.contacts.some(c=>c.finger==='palm'&&c.object==='cube'));
assert.equal(end.fingerContactImpulses.reduce((n,c)=>n+c.normalImpulse,0),end.fingerContactNormalImpulse);
supporting.lose();const lost=supporting.read();supporting.advance(.1);
assert.throws(()=>assertResponse(lost,supporting.read()),/normal impulse/,'old impulses cannot satisfy a new interval');
supporting.dispose();
console.log('contact response rejects separating rows/gravity and accepts finger-attributed normal impulse');
