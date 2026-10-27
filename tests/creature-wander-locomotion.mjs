// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createWanderPath} from '../experiments/creature-motion/wander-path.mjs';
import {createWanderMotion} from '../experiments/creature-motion/wander-motion.mjs';
import {createWalkingPoseAdapter} from '../experiments/creature-motion/walking-pose.mjs';

const identity=()=>new THREE.Matrix4().toArray();
const adapter={frames:61,fps:60,frame(i){
 const root=new THREE.Matrix4().makeTranslation(0,.5,i/60).toArray();
 const head=new THREE.Matrix4().makeTranslation(0,.5,i/60+2).toArray();
 return {actorMatrix:identity(),frame:i,bones:[{name:'pelvis',parent:null,localMatrix:root,worldMatrix:root},{name:'head',parent:0,localMatrix:new THREE.Matrix4().makeTranslation(0,0,2).toArray(),worldMatrix:head}]};
}};
const walking=createWalkingPoseAdapter({THREE,adapter,blendFrames:0});
const locomotion={bodyLength:2};
const area={center:[0,0],radii:[9,6],yaw:0};
const make=options=>createWanderMotion({THREE,adapter,walking,sourceKey:'locomotion-one-unit-per-second',locomotion,area,position:[0,0],direction:[0,1],seed:1,...options});
const angle=(a,b)=>Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const inside=(p,a)=>{
 const x=p[0]-a.center[0],z=p[1]-a.center[1],c=Math.cos(a.yaw),s=Math.sin(a.yaw);
 return ((c*x+s*z)/a.radii[0])**2+((-s*x+c*z)/a.radii[1])**2<=1+1e-8;
};
// This exact contact-free seed produces the observed near-hairpin inside the
// first quadratic. Start from a retained journey so migration is exercised too.
const legacy=createWanderPath({area,areas:[{id:'only',preference:1,area}],position:[0,0],direction:[0,1],seed:1});
const migrated=make({pathSnapshot:legacy.snapshot()});
let previous=migrated.read();
for(let i=0;i<160;i++){
 const next=migrated.advance(.02);
 assert.ok(Math.abs(angle(previous.path.direction,next.path.direction))<=.02000001,'A contact-free wander goal demanded a hairpin faster than the body-scaled yaw rate');
 previous=next;
}
assert.equal(migrated.read().path.navigation.kind,'goal-steering','The live path must expose the effective locomotion controller');
assert.equal(migrated.read().path.navigation.bodyLength,2);

// Enlarging a zone must not enlarge the creature's turn or change its agility.
const small=make(),large=make({area:{...area,radii:[90,60]}});
for(const m of [small,large])m.setDestination([4,4]);
for(let i=0;i<60;i++){
 const a=small.advance(1/60),b=large.advance(1/60);
 assert.ok(distance(a.path.position,b.path.position)<1e-10);
 assert.ok(distance(a.path.direction,b.path.direction)<1e-10,'Zone dimensions changed locomotion toward the same destination');
}

// A goal behind the body needs reorientation, not an advancing backwards gait.
const behind=make();behind.setDestination([0,-4]);
const turning=behind.advance(.1);
assert.ok(distance(turning.path.position,[0,0])<1e-12,'The root slid while its walking direction faced away from its destination');
assert.equal(turning.elapsed,0,'Turning without forward travel must hold the walking phase');
assert.ok(Math.abs(angle([0,1],turning.path.direction))>.05,'A held gait must still allow deliberate reorientation');
behind.advance(15);
assert.equal(behind.read().path.status,'arrived','A nearby goal behind the body caused an endless orbit');
const arrived=behind.snapshot();behind.advance(5);
assert.equal(behind.read().elapsed,arrived.elapsed,'Arrival must hold the retained walking phase');
const lumped=make(),partitioned=make();
for(const m of [lumped,partitioned])m.setDestination([4,4]);
lumped.advance(4);for(let i=0;i<120;i++)partitioned.advance(1/30);
assert.ok(distance(lumped.read().path.position,partitioned.read().path.position)<.01,'Host frame partition changed the physical journey beyond integration accuracy');
assert.ok(Math.abs(angle(lumped.read().path.direction,partitioned.read().path.direction))<.01);
assert.deepEqual(lumped.read().path.target,partitioned.read().path.target);
const invalid=make(),retained=invalid.snapshot();
for(const seconds of [-1,NaN,Infinity])assert.throws(()=>invalid.advance(seconds),/time|delta/i);
assert.deepEqual(invalid.snapshot(),retained,'A rejected interval changed the ongoing goal');
assert.throws(()=>make({locomotion:{bodyLength:0}}),/body|length/i);
assert.throws(()=>make({snapshot:{...retained,path:{...retained.path,direction:[0,0]}}}),/heading/i);

// Natural, uncurated seeds span small, ordinary and large zones. All time is
// consumed, while actual forward travel alone advances the gait.
for(const radius of [3,9,27])for(const seed of [1,22,123]){
 const zone={center:[0,0],radii:[radius,radius*2/3],yaw:.3},m=make({area:zone,seed});
 let prior=m.read();
 for(let i=0;i<1800;i++){
  const next=m.advance(1/30),heading=Math.abs(angle(prior.path.direction,next.path.direction));
  assert.ok(heading<=1/30+1e-8,'An autonomous goal switch exceeded the creature yaw rate');
  assert.ok(inside(next.path.position,zone),'Locomotion left its authored convex zone');
  assert.ok(next.path.distance>=prior.path.distance);
  assert.ok(Math.abs(next.elapsed-next.path.distance)<1e-7,'Straight walking phase differs from consumed forward travel');
  prior=next;
 }
 assert.ok(prior.path.distance>5,'The controller achieved its bounded turns by remaining stationary');
 assert.ok(prior.path.segments>0,'The creature never finished an autonomous journey');
 const restored=make({snapshot:JSON.parse(JSON.stringify(m.snapshot()))});
 assert.deepEqual(restored.advance(.17),m.advance(.17),'Locomotion lost its ongoing goal, pose or random state on reconstruction');
}

// The same actual pose accepted by physics must not alter goals or RNG.
const free=make(),accepted=make({snapshot:free.snapshot()});
for(let i=0;i<120;i++){
 free.advance(1/60);const before=accepted.snapshot(),proposed=accepted.advance(1/60);
 accepted.contact(before,{position:proposed.path.position,direction:proposed.path.direction});
 assert.deepEqual(accepted.snapshot(),free.snapshot());
}
const before=accepted.snapshot(),goal=[...accepted.read().path.target];accepted.advance(.1);
accepted.contact(before,{position:before.path.position,direction:before.path.direction});
assert.deepEqual(accepted.read().path.target,goal,'Obstruction chose a replacement goal');
assert.equal(accepted.snapshot().path.rng,before.path.rng);
assert.ok(accepted.read().contactRate<1e-8);

// Real clips contain zero/nonuniform root-travel intervals. Steering must
// integrate their phase together with travel, not invert one whole host frame.
const z=[0,.01,.01,.01,.02,.03];
const plateau={frames:z.length,fps:30,frame(i){
 const root=new THREE.Matrix4().makeTranslation(0,.5,z[i]).toArray();
 return {actorMatrix:identity(),frame:i,bones:[{name:'pelvis',parent:null,localMatrix:root,worldMatrix:root},{name:'head',parent:0,localMatrix:new THREE.Matrix4().makeTranslation(0,0,1).toArray(),worldMatrix:new THREE.Matrix4().makeTranslation(0,.5,z[i]+1).toArray()}]};
}};
const plateauWalking=createWalkingPoseAdapter({THREE,adapter:plateau,blendFrames:0});
const rates=[30,60,120,240].map(hz=>{
 const m=createWanderMotion({THREE,adapter:plateau,walking:plateauWalking,sourceKey:'nonuniform-source-with-stationary-interval',locomotion:true,area:{center:[0,0],radii:[10,10],yaw:0},position:[0,0],direction:[0,1],seed:1});
 m.setDestination([4,4]);for(let i=0;i<4*hz;i++)m.advance(1/hz);
 return {hz,...m.read()};
});
for(const r of rates.slice(1)){
 assert.ok(distance(r.path.position,rates[0].path.position)<.001,'Stationary source intervals made root travel depend on host update frequency');
 assert.ok(Math.abs(r.path.distance-rates[0].path.distance)<.001,'Achieved source travel depends on host update frequency');
 assert.ok(Math.abs(r.elapsed-rates[0].elapsed)<1/plateau.fps/8,'Stationary source intervals made gait phase depend on host update frequency');
}

console.log('Goal-owned wandering bounds body-scale turns, holds gait during reorientation, stays in zones and reconstructs physical feedback');
