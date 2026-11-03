// kaminos-test: node
import assert from 'node:assert/strict';
import * as core from '../burn-fracture-core.mjs';
assert.equal(typeof core.remainingBurnBody,'function','Live remaining material must update mass, center and contact, not just fracture bonds');
const input={points:[[0,0,0],[0,1,0]],fuel:[1,1],pitch:[1,1,1],mass:4};
assert.deepEqual(core.remainingBurnBody(input),{mass:4,center:[0,.5,0],halfExtents:[.5,1,.5],inverseInertia:[.6,1.5,.6]});
const bounded=core.remainingBurnBody({...input,bounds:{min:[-.3,-.4,-.2],max:[.4,1.2,.2]}});
assert.deepEqual(bounded.halfExtents,[.35,.8,.2],'Whole occupied voxels must not enlarge the original mechanical envelope');
assert.deepEqual(bounded.center,[.05000000000000002,.39999999999999997,0]);
const half=core.remainingBurnBody({...input,fuel:[0,1]});
assert.deepEqual(half,{mass:2,center:[0,1,0],halfExtents:[.5,.5,.5],inverseInertia:[3,3,3]});
assert.equal(core.remainingBurnBody({...input,fuel:[0,0]}),null,'Exhausted regions cannot remain collision supports');
const rotatedOldCenter=[3,4,5],rotation=[0,0,Math.SQRT1_2,Math.SQRT1_2];
// A recentered rigid representation must leave every unconsumed material point
// at the same world point; it changes the body origin, not the object's pose.
assert.equal(typeof core.recenterBurnBody,'function');
const moved=core.recenterBurnBody({position:rotatedOldCenter,quaternion:rotation,oldCenter:[0,.5,0],newCenter:half.center});
assert.ok(Math.abs(moved[0]-2.5)<1e-12);assert.equal(moved[1],4);assert.equal(moved[2],5);
for(const patch of [{mass:NaN},{fuel:[1]},{pitch:[0,1,1]},{fuel:[1,NaN]}])assert.throws(()=>core.remainingBurnBody({...input,...patch}));
