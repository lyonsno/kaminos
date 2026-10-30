import assert from 'node:assert/strict';
import {BURN_FRACTURE_IDENTITY} from '../burn-fracture-core.mjs';
export function checkBurnFractureObservation(read,snapshot){
 assert.equal(read.identity,'kaminos.burn-fracture.replay.v1');assert.equal(read.effective.backend,'WebGPU');assert.equal(read.effective.adapter?.vendor,'apple');
 assert.equal(read.thermal,'frozen-not-live-coupled');assert.equal(read.mechanics.identity,BURN_FRACTURE_IDENTITY);assert.equal(read.mechanics.runtimeReadbacks,0);
 if(read.sceneContact==='finite-editable-support'){
  assert.deepEqual(read.mechanics.supports,[],'No material region may be artificially pinned');
  assert.ok(read.mechanics.finiteSupports.length>0,'A finite support must exist');
  assert.equal(read.mechanics.contact,'finite-support-boxes-no-piece-self-contact');
  assert.equal(read.mechanics.failureModel,'equivalent-circular-section-brittle-max-stress-char-strength');
 }
 const n=read.mechanics.regions,m=read.mechanics.connections;
 assert.ok(n>1&&m>0);assert.equal(snapshot.matrices.length,n*16);assert.ok(snapshot.matrices.every(Number.isFinite));
 for(let i=0;i<n;i++){const a=snapshot.matrices.slice(i*16,i*16+16);assert.ok(Math.abs(a[15]-1)<1e-6&&[3,7,11].every(j=>Math.abs(a[j])<1e-6),'Resident presentation matrix must be affine, not blank');
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs(Math.hypot(...a.slice(axis*4,axis*4+3))-1)<1e-3,'Resident rigid pose must preserve unit basis vectors');
 }
 for(const name of ['positions','quaternions','velocities','angularVelocities']){assert.equal(snapshot[name].length,n*4);assert.ok(snapshot[name].every(Number.isFinite));}
 assert.equal(snapshot.alive.length,m);assert.equal(snapshot.geometry.length,m*12);assert.ok(snapshot.geometry.every(Number.isFinite));
 for(let i=0;i<n;i++)assert.ok(Math.abs(Math.hypot(...snapshot.quaternions.slice(i*4,i*4+4))-1)<1e-3);
 return {regions:n,connections:m,broken:snapshot.alive.filter(x=>!x).length,seconds:snapshot.state.seconds};
}
