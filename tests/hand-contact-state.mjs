// kaminos-test: node
import assert from 'node:assert/strict';
import {NaiveBroadphase} from '../node_modules/cannon-es/dist/cannon-es.js';
const baseline = process.argv.includes('--baseline');
const create = baseline
  ? (await import('../models/mobrecon/hand-reach-state.js')).createHandReachState
  : (await import('../models/mobrecon/hand-contact-state.js')).createHandContactState;
const options={cube:{position:[0,.25,0],size:.045},tableHeight:0};
const falling=create(options);
const step=(s,t)=>{if(s.advance)s.advance(t);};
step(falling,.1);
assert.ok(falling.read().cubePosition[1]<.23,'a released cube must fall under gravity, not hover at its last pinch position');
if(baseline)process.exit(0);
// A thin table's enclosing sphere covers empty space well above its surface.
// Reject those separated pairs before sphere-box contact generation.
const collisionPairs=NaiveBroadphase.prototype.collisionPairs;
let separatedTablePairs=0;
NaiveBroadphase.prototype.collisionPairs=function(w,a,b){
  collisionPairs.call(this,w,a,b);
  for(let i=0;i<a.length;i++)if((a[i].handProxy&&b[i].material?.name==='table')||(b[i].handProxy&&a[i].material?.name==='table'))separatedTablePairs++;
};
try{
  const separate=create({cube:{position:[.2,.1825,0],size:.045}});
  separate.setProxies(Array.from({length:20},(_,i)=>({id:`index-${i}`,finger:'index',position:[i*.001,.4,0],radius:.007})));
  separate.advance(1/120);separate.dispose();
  assert.equal(separatedTablePairs,0,'separated finger/table AABBs must not enter narrowphase');
}finally{NaiveBroadphase.prototype.collisionPairs=collisionPairs;}
step(falling,1);
assert.ok(Math.abs(falling.read().cubePosition[1]-.0225)<.002,'table supports a resting cube');
const offTable=create({cube:{position:[.4,.3,0],size:.045}});
step(offTable,1);assert.ok(offTable.read().cubePosition[1]<0,'a cube beyond the visible table falls instead of finding invisible support');offTable.dispose();
assert.equal(falling.read().backend,'cannon-es-cpu');
assert.equal(falling.read().grabbed,false,'there is no hidden attachment');

// Deterministic collision fixture: one measured index fingertip. This tests the
// actual engine adapter without claiming anything about neural reconstruction.
const world=create({cube:{position:[0,.0225,0],size:.045},tableHeight:0});
const finger=(x,y=.026,z=.014)=>[{id:'index-tip',finger:'index',position:[x,y,z],radius:.008}];
world.setProxies(finger(-.065));
for(let i=0;i<120;i++){world.setProxies(finger(-.065+i*.00065));step(world,1/120);}
const pushed=world.read();
assert.ok(pushed.cubePosition[0]>.01,'an open index fingertip pushes the cube by more than 10mm');
assert.ok(Math.abs(pushed.cubeQuaternion[1])+Math.abs(pushed.cubeQuaternion[2])>.015,'off-centre contact produces rotation');
assert.ok(pushed.contactEvents>0,'solver contacts are observed');
assert.ok(pushed.maximumMotorForce<=pushed.motorForce+1e-9,'proxy motors have finite force');
assert.ok(pushed.maximumProxyError>0,'measured targets and physical proxies are not silently identical');
world.lose();
const released=world.read();assert.equal(released.tracking,false);assert.equal(released.proxies.length,0);
step(world,.5);assert.ok(world.read().cubePosition.every(Number.isFinite));
assert.equal(world.read().contacts.some(c=>c.finger),false,'lost hand has no contact authority');
assert.throws(()=>world.advance(NaN),/time/);
assert.throws(()=>world.setProxies([{...finger(0)[0],position:[NaN,0,0]}]),/proxy/);
assert.throws(()=>world.setProxies([{...finger(0)[0],finger:'unknown'}]),/proxy/);
assert.throws(()=>world.setCube({position:[0,0,0],size:0}),/cube/);
assert.equal(world.configure({friction:0}).friction,0,'frictionless contact is a supported physical comparison');

// A held pose generates support through contact; loss releases the support.
const supported=create({cube:{position:[0,.14,0],size:.045},tableHeight:0});
supported.setProxies([{id:'palm',finger:'palm',position:[0,.1,0],radius:.02}]);
step(supported,1);const high=supported.read().cubePosition[1];
assert.ok(high>.13,'palm surface supports cube above table');
supported.lose();step(supported,.5);
assert.ok(supported.read().cubePosition[1]<high-.05,'tracking loss removes support');

const joints=new Float32Array(63);
for(let i=0;i<21;i++)joints.set([.1+i*.002,.2+i*.002,-.1],i*3);
world.update({valid:true,joints});
assert.equal(world.read().tracking,true);
assert.ok(new Set(world.read().proxies.map(p=>p.finger)).size===6,'all five fingers and palm have contact geometry');
assert.equal(world.update({valid:false,joints}).tracking,false);
for(const s of [falling,world,supported]){s.dispose();assert.throws(()=>s.advance(.01),/disposed/);}
console.log('hand contact: gravity, support, open-finger push, torque, finite drive and loss pass');
