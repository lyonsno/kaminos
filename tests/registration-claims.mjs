// kaminos-test: node
import assert from 'node:assert/strict';
import {classifyClaims, solidDistance} from '../registration-claims.mjs';
assert.deepEqual(classifyClaims([.9,.8,.1],.5), {kind:'overlap',owners:[0,1]}, 'independent strong claims must coexist');
assert.deepEqual(classifyClaims([.2,.1],.5), {kind:'unclaimed',owners:[]});
assert.deepEqual(classifyClaims([.1,.9],.5), {kind:'single',owners:[1]});
assert.throws(()=>classifyClaims([NaN],.5), /claim/i);
assert.throws(()=>classifyClaims([1],-1), /threshold/i);
assert.equal(solidDistance({kind:'box',parameters:{width:2,height:2,depth:2}},[0,0,0]),0);
assert.equal(solidDistance({kind:'box',parameters:{width:2,height:2,depth:2}},[2,1,1]),1);
assert.equal(solidDistance({kind:'cylinder',parameters:{radius:1,height:2}},[0,2,0]),1);
assert.equal(solidDistance({kind:'cylinder',parameters:{radius:1,height:2}},[2,0,0]),1);
assert.throws(()=>solidDistance({kind:'unknown'},[0,0,0]),/unsupported/i);
console.log('registration claims: independent overlaps, residual and primitive distances pass');
