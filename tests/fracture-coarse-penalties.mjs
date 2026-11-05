// kaminos-test: node
import assert from 'node:assert/strict';
import {coarseInitialJointPenalties} from '../fracture-coarse-penalties.mjs';
const base={masses:[1,1],halfExtents:[[.5,.5,.5],[.5,.5,.5]],timeStep:.01,linearStiffness:1e9,rotationalStiffness:1e9,torqueArm:1};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const equal=coarseInitialJointPenalties(base);close(equal.linear,5000);equal.angular.forEach(x=>close(x,2500/3));
const pinned=coarseInitialJointPenalties({...base,masses:[0,1]});close(pinned.linear,10000);pinned.angular.forEach(x=>close(x,5000/3));
const heavier=coarseInitialJointPenalties({...base,masses:[3,3]});close(heavier.linear,15000);heavier.angular.forEach(x=>close(x,2500));
const halfStep=coarseInitialJointPenalties({...base,timeStep:.005});close(halfStep.linear,20000);halfStep.angular.forEach(x=>close(x,10000/3));
const longerArm=coarseInitialJointPenalties({...base,torqueArm:2});close(longerArm.linear,equal.linear);longerArm.angular.forEach(x=>close(x,625/3));
assert.deepEqual(coarseInitialJointPenalties({...base,linearStiffness:10,rotationalStiffness:5}),{linear:10,angular:[5,5,5]},'Starting penalties respect unchanged material maxima');
assert.deepEqual(coarseInitialJointPenalties({...base,masses:[0,0]}),{linear:1,angular:[1,1,1]});
for(const change of [{masses:[-1,1]},{timeStep:0},{halfExtents:[[0,.5,.5],[.5,.5,.5]]},{torqueArm:NaN}])assert.throws(()=>coarseInitialJointPenalties({...base,...change}),/Finite pair/);
console.log('Initial joint penalties preserve reduced mass/inertia, substep scaling and authored maxima');
