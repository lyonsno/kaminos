// kaminos-test: node
import assert from 'node:assert/strict';
import {emptyMechanism,appendJoint,connectPiston} from '../experiments/link-workshop/model.mjs';
import {createMechanismView} from '../experiments/link-workshop/view.mjs';
import * as T from '../lib/three.core.js';
let m=emptyMechanism();
m=appendJoint(m,null,[0,0]);m=appendJoint(m,0,[0,2]);m=appendJoint(m,1,[2,2]);m=appendJoint(m,1,[-1,3]);
m=connectPiston(m,0,2);m.nodes[2].angles[1]+=.3;
const root=new T.Group(),v=createMechanismView(root);v.update(m,0,2,false);
// A rigid body may move but its geometry and scale cannot change with pose.
assert.equal(typeof v.bodyManifest,'function','view must expose constructed rigid bodies');
const before=v.bodyManifest();
assert(before.bodies.some(b=>b.id==='link:3'),'branches are first-class bodies');
assert(before.bodies.some(b=>b.id==='piston:0:rod'));
const packet=v.exportBodies();
for(const t of [0,.2,.5,.7,1]){v.update(m,t,2,false);assert.deepEqual(v.bodyManifest().bodies.map(b=>[b.id,b.geometryKey]),before.bodies.map(b=>[b.id,b.geometryKey]));}
v.importBodies(JSON.parse(JSON.stringify(packet)));v.update(m,.4,2,false);
assert.equal(v.bodyManifest().replacements,before.bodies.length);
const wrong=structuredClone(packet);wrong.bodies[0].geometryKey='wrong';assert.throws(()=>v.importBodies(wrong),/geometry|recipe|match/i);
const old=v.bodyManifest().replacements;m.nodes[2].length+=1;v.update(m,0,2,false);assert(v.bodyManifest().replacements<old,'changed bodies retire stale shells');
v.dispose();console.log('constructed bodies pass');

// A midpoint distance extremum must affect the construction, not just pose A/B.
const {travelEnvelope,constructBodies}=await import('../experiments/link-workshop/bodies.mjs');
const arc={schema:'kaminos.links.v1',period:3,nodes:[{parent:null,point:[0,0]},{parent:0,length:2,angles:[-Math.PI/2,Math.PI/2]},{parent:null,point:[3,0]}],pistons:[{a:1,b:2}]};
const range=travelEnvelope(arc,1,2);assert(range.min<=1&&range.min>.995);assert(range.max>=Math.sqrt(13)&&range.max<Math.sqrt(13)+.005);
const built=constructBodies(m),pose0=framesForTest(m,0),pose1=framesForTest(m,1);
function framesForTest(m,t){const f=[];for(const n of m.nodes){if(n.parent===null)f.push({point:n.point,angle:0});else{const p=f[n.parent],angle=p.angle+n.angles[0]+(n.angles[1]-n.angles[0])*t;f.push({point:[p.point[0]+Math.cos(angle)*n.length,p.point[1]+Math.sin(angle)*n.length],angle});}}return f;}
const rod=built.defs.find(b=>b.id==='piston:0:rod');assert.deepEqual(rod.pose(pose1).position.slice(0,2),pose1[2].point);
const barrel=built.defs.find(b=>b.id==='piston:0:barrel');assert.deepEqual(barrel.pose(pose0).position.slice(0,2),pose0[0].point);
const branch=built.defs.find(b=>b.id==='link:3');assert.deepEqual(branch.pose(pose1).position.slice(0,2),pose1[1].point);
const v2=createMechanismView(new T.Group());v2.update(m,0,0,false);const bad=v2.exportBodies();bad.bodies.at(-1).object.object.children=[];assert.throws(()=>v2.importBodies(bad),/Empty/);assert.equal(v2.bodyManifest().replacements,0,'partial failure must not replace earlier bodies');v2.dispose();
console.log('travel and atomic return pass');
const v3=createMechanismView(new T.Group());v3.update(m,.3,0,false);
assert.equal(typeof v3.replacementState,'function','geometry replacement must be restorable independently of the recipe');
const analytic=v3.replacementState(),returned=v3.exportBodies();v3.importBodies(returned);const skins=v3.replacementState();v3.setBodies(analytic);assert.equal(v3.bodyManifest().replacements,0);v3.setBodies(skins);assert.equal(v3.bodyManifest().replacements,skins.bodies.length);v3.dispose();
