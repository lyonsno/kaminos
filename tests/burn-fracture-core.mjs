// kaminos-test: node
import assert from 'node:assert/strict';
import {burnJointState} from '../burn-fracture-core.mjs';
const bond={id:'cut:0',area:2,linearStiffness:120,rotationalStiffness:80};
const half=burnJointState(bond,{mapped:true,fraction:.5});
assert.equal(half.area,1,'Consumed material must reduce the material area carrying a joint');
assert.equal(half.linearStiffness,60);
assert.equal(half.rotationalStiffness,20,'Bending stiffness scales with the square of remaining area');
assert.equal(burnJointState(bond,{mapped:true,fraction:0}).active,false,'Exhausted sections cannot retain a mechanical constraint');
assert.equal(burnJointState(bond,{mapped:false,fraction:null}).active,true,'Unknown material is not evidence of a break');
assert.equal(burnJointState(bond,{mapped:false,fraction:null}).fraction,null);
for(const fraction of [-1,2,NaN,Infinity,null])assert.throws(()=>burnJointState(bond,{mapped:true,fraction}),/fraction/);
