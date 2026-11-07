// kaminos-test: node
import assert from 'node:assert/strict';
import {buildConvexRock} from '../experiments/hill-terrain/rock-geometry.mjs';
import {convexContact} from '../experiments/hill-terrain/convex-contact.mjs';
const solid=buildConvexRock([[1,0,0,1],[-1,0,0,1],[0,1,0,1],[0,-1,0,1],[0,0,1,1],[0,0,-1,1]]);
const a={solid,position:[0,1.9,0],rotation:[0,0,0,1]},b={solid,position:[0,0,0],rotation:[0,0,0,1]};
const contact=convexContact(a,b);assert.ok(contact,'aligned face overlap must be detected even with all penetrating vertices on side boundaries');assert.ok(Math.abs(contact.depth-.1)<1e-8);assert.ok(contact.normal[1]>.999);
assert.equal(convexContact({...a,position:[0,2.1,0]},b),null);assert.equal(convexContact({...a,position:[2.1,0,0]},b),null);
const q=[0,Math.sin(.31),0,Math.cos(.31)];assert.ok(convexContact({...a,position:[1.8,0,0],rotation:q},b));
console.log('convex face contact, separation and rotated contact passed');
