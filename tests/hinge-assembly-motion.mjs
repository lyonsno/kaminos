// kaminos-test: node
import assert from 'node:assert/strict';
import {hingePartPose} from '../hinge-assembly-motion.mjs';
import {Vector3,Quaternion} from '../lib/three.core.js';
const base={home:[3.2,1.25,0],exploded:[3.2,0,0],role:'axle-pin',origin:[0,1.25,0],axis:[1,0,0],angleDegrees:60,separation:0,offset:[2,0,0]};
const close=(a,b)=>assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-10),JSON.stringify({a,b}));
close(hingePartPose(base).position,[2,1.25,0]);
close(hingePartPose({...base,separation:1}).position,[5.2,1.25,0]);
const hub=hingePartPose({...base,home:[0,1.25,-1],exploded:[0,0,0],role:'rotating-hub',angleDegrees:90});
close(hub.position,[2,2.25,0]);
const axis=new Vector3(1,0,0).applyQuaternion(new Quaternion(...hub.quaternion));close(axis.toArray(),[1,0,0]);
close(hingePartPose({...base,role:'fixed-fork'}).quaternion,[0,0,0,1]);
assert.throws(()=>hingePartPose({...base,axis:[0,0,0]}),/axis/i);
assert.throws(()=>hingePartPose({...base,angleDegrees:NaN}),/finite/i);
assert.throws(()=>hingePartPose({...base,role:'missing'}),/role/i);
console.log('Known hinge assembles in its authored frame and rotates only the hub around the shared axis');
