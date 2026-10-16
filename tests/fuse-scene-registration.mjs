// kaminos-test: node
import assert from 'node:assert/strict';
import {canCollideWithFire,checkedObjectCollision} from '../scene-collider.mjs';
assert.equal(canCollideWithFire({type:'experiment-mesh'}),true,'owner-authored mesh experiments need ordinary collision membership');
assert.deepEqual(checkedObjectCollision({type:'experiment-mesh',collision:{domainId:'flame-field',enabled:true}}),{domainId:'flame-field',enabled:true});
assert.equal(canCollideWithFire({type:'experiment'}),false,'a generic experiment is not necessarily mesh geometry');
