import assert from 'node:assert/strict';
import {Vector3, Quaternion} from '../lib/three.core.js';

const vector = p => new Vector3(p.x, p.y, p.z);
function kinetic(body) {
 const q = new Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w).normalize();
 const w = vector(body.angularVelocity).applyQuaternion(q.clone().conjugate());
 const [x,y,z] = body.halfExtents;
 return .5*body.mass*(vector(body.velocity).lengthSq()+((y*y+z*z)*w.x*w.x+(x*x+z*z)*w.y*w.y+(x*x+y*y)*w.z*w.z)/3);
}

// Offline witness for an already detached body touching a stationary floor.
// Allow gravitational energy equal to recovery of its initial overlap; a
// cached supporting force must not become an additional launch energy source.
export function assertDetachedContactEnergy(before, after, index) {
 for (const state of [before,after]) {
  assert.equal(state.observation,'acquired','Witness needs acquired GPU state');
  assert.equal(state.backend,'webgpu-avbd','Witness needs the actual solver');
  assert.equal(state.config.collisions,'floor-only','Removing the floor cannot satisfy the contact witness');
  assert.ok(!state.hand?.indices?.includes(index),'Witness body must not be hand-loaded');
  assert.ok(!state.bonds.some(b=>b.alive&&(b.a===index||b.b===index)),'Witness body must already be detached');
 }
 assert.equal(after.step,before.step+1,'Witness needs consecutive physical steps');
 assert.equal(after.config.gravity,before.config.gravity);
 assert.equal(after.floorY,before.floorY);
 const a=before.bodies.find(b=>b.index===index),b=after.bodies.find(b=>b.index===index);
 assert.ok(a&&b&&!a.pinned&&!b.pinned,'Witness needs an unpinned body');
 assert.equal(b.mass,a.mass);assert.deepEqual(b.halfExtents,a.halfExtents);
 for(const body of [a,b])assert.ok([body.mass,...body.halfExtents,...Object.values(body.position),...Object.values(body.velocity),...Object.values(body.angularVelocity),...Object.values(body.quaternion)].every(Number.isFinite),'Witness body values must be finite');
 assert.ok(a.mass>0&&a.halfExtents.every(x=>x>0));
 const q=new Quaternion(a.quaternion.x,a.quaternion.y,a.quaternion.z,a.quaternion.w).normalize();
 const radius=[[1,0,0],[0,1,0],[0,0,1]].reduce((sum,axis,i)=>sum+Math.abs(new Vector3(...axis).applyQuaternion(q).y)*a.halfExtents[i],0);
 const overlap=Math.max(0,before.floorY-a.position.y+radius),gravity=before.config.gravity;
 const initial=kinetic(a),final=kinetic(b),potentialChange=a.mass*gravity*(b.position.y-a.position.y);
 const overlapAllowance=a.mass*gravity*overlap;
 // Float32 state quantization allowance, scaled by this body's energy scale.
 const roundoff=64*2**-23*Math.max(initial,a.mass*gravity*Math.hypot(...a.halfExtents),Number.MIN_VALUE);
 const excess=final+potentialChange-initial-overlapAllowance;
 assert.ok(excess<=roundoff,`Detached floor contact added mechanical energy: excess=${excess} J, overlap allowance=${overlapAllowance} J`);
 return {initialKinetic:initial,finalKinetic:final,potentialChange,overlap,overlapAllowance,excess,roundoff};
}
