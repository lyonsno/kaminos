// kaminos-test: node
import assert from 'node:assert/strict';
import {followingDomainShift,shiftedCellIndex,emittedMotionVelocity} from '../moving-volume.mjs';

const start={anchor:[.4,.2,0],origin:[0,0,0],scale:1,grid:32};
assert.deepEqual(followingDomainShift({...start,target:[.41,.2,0],current:[0,0,0]}),{cells:[0,0,0],translation:[0,0,0],cellSize:.0625});
assert.deepEqual(followingDomainShift({...start,target:[.9,.2,-.25],current:[0,0,0]}).cells,[8,0,-4]);
assert.deepEqual(followingDomainShift({...start,target:[.9,.2,-.25],current:[.5,0,-.25]}).cells,[0,0,0]);
assert.equal(shiftedCellIndex([0,1,1],[1,0,0],[4,3,4]),17);
assert.equal(shiftedCellIndex([3,1,1],[1,0,0],[4,3,4]),null,'newly entered cells are ambient, never edge-clamped or wrapped');
assert.equal(shiftedCellIndex([0,0,0],[0,-1,0],[4,3,4]),null);
assert.throws(()=>followingDomainShift({...start,target:[NaN,0,0],current:[0,0,0]}),/finite/);
assert.deepEqual(emittedMotionVelocity({displacement:[.1,0,0],grid:32,scale:1,backtraceScale:3.1}),[.1*16/3.1,0,0]);
assert.deepEqual(emittedMotionVelocity({displacement:[0,0,0],grid:32,scale:1,backtraceScale:3.1}),[0,0,0]);
