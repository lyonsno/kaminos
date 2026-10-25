// kaminos-test: node
import assert from 'node:assert/strict';
import {createGoinPhysics} from '../experiments/lerms/goin-physics.mjs';
const floor={id:'authored-floor',position:[0,-.1,0],quaternion:[0,0,0,1],size:[40,.2,40]};
const quaternion=[Math.SQRT1_2,0,0,Math.SQRT1_2];
function released(){
 const physics=createGoinPhysics({support:()=>floor});
 physics.carried({time:0,position:[0,1,0],quaternion});
 physics.carried({time:.1,position:[.2,1,0],quaternion});
 physics.release({time:.1,position:[.2,1,0],quaternion});return physics;
}
const p=released();
assert.equal(p.read().backend,'cannon-es-cpu');assert.equal(p.read().engineVersion,'0.20.0');
assert.deepEqual(p.read().velocity,[2,0,0]);
const falling=p.advance(.3);assert.ok(falling.position[1]<.9);assert.ok(falling.velocity[1]<-1);assert.equal(falling.contactCount,0);
const rolling=p.advance(1.2);
assert.ok(rolling.contactSteps>0,'Observed engine contacts, not prescribed phases');
assert.ok(rolling.position[1]>.3&&rolling.position[1]<.4,'Cylinder rim is supported at its actual radius');
assert.ok(Math.hypot(...rolling.angularVelocity)>1,'Support friction produces rotation');
assert.ok(rolling.position[0]>1,'Released goin translates while contacting support');
const later=p.advance(2);assert.ok(later.position[0]>rolling.position[0]+.2);assert.notDeepEqual(later.quaternion,rolling.quaternion);
assert.equal(later.steps,228,'All elapsed owner time is integrated, without a catch-up cap');
const other=released();for(let n=1;n<=19;n++)other.advance(.1+n*.1);
for(const field of ['position','velocity','quaternion'])later[field].forEach((x,i)=>assert.ok(Math.abs(x-other.read()[field][i])<1e-10,field+' partition mismatch'));
const paused=other.read();other.advance(2);assert.deepEqual(other.read(),paused);
assert.throws(()=>other.advance(1),/monotonic/);
other.carried({time:2,position:[1,1,1],quaternion});assert.equal(other.read().active,false);
other.advance(3);assert.equal(other.read().steps,paused.steps,'Carried state must not integrate a second dynamic body');
p.dispose();other.dispose();assert.throws(()=>p.advance(3),/disposed/);
let support=floor;const absent=createGoinPhysics({support:()=>support});support=null;assert.throws(()=>absent.advance(1),/mounted visible box/);absent.dispose();
assert.throws(()=>createGoinPhysics({support:()=>({...floor,size:[1,-1,1]})}),/positive size/);
console.log('Actual cannon-es cylinder falls, contacts, rotates and preserves owner-time partition');
