// kaminos-test: node
import assert from 'node:assert/strict';
let implementation = {};
try { implementation = await import('../experiments/creature-motion/wander-path.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof implementation.createWanderPath, 'function', 'A sustained source-distance wander path is not implemented');
const {createWanderPath} = implementation;
const area = {center: [0, 0], radii: [9, 6], yaw: .3};
const input = {area, position: [0, 0], direction: [0, 1], seed: 123};
const close = (a,b,label) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i]) < 1e-7, label));
const inside = (p,a) => {
  const x=p[0]-a.center[0],z=p[1]-a.center[1],c=Math.cos(a.yaw),s=Math.sin(a.yaw);
  return ((c*x+s*z)/a.radii[0])**2+((-s*x+c*z)/a.radii[1])**2 <= 1+1e-9;
};
const path = createWanderPath(input);
close(path.read().position, input.position, 'Starting must not relocate the creature');
path.advance(.4);
assert.ok(Math.hypot(...path.read().position) > .3, 'Walking source distance must produce scene movement');
assert.equal(path.read().distance, .4);
const targets = new Set();
for(let i=0;i<1200;i++) {
  const r=path.advance(.2); targets.add(r.target.join(','));
  assert.ok(inside(r.position,area), 'The root left the authored convex wander area');
  assert.ok(inside(r.target,area), 'The next destination is outside the area');
  assert.ok(Math.abs(Math.hypot(...r.direction)-1)<1e-9);
  assert.ok([...r.position,...r.direction].every(Number.isFinite));
}
assert.ok(targets.size>8, 'Wander must choose new destinations, not repeat a fixed circle');
const one=createWanderPath(input), partitioned=createWanderPath(input);
one.advance(37);for(let i=0;i<370;i++)partitioned.advance(.1);
close(one.read().position,partitioned.read().position,'Host frame partition changed the route');
close(one.read().direction,partitioned.read().direction,'Host frame partition changed heading');
const restored=createWanderPath({snapshot:JSON.parse(JSON.stringify(path.snapshot()))});
close(restored.advance(13).position,path.advance(13).position,'Reconstruction lost the ongoing path');
const before=path.read().position;
const moved={center:[90,-20],radii:[7,9],yaw:-.4};path.setArea(moved);
close(path.read().position,before,'Editing the area teleported the creature');
assert.equal(path.read().status,'returning-to-area');
assert.ok(inside(path.read().target,moved));
path.advance(300);assert.ok(inside(path.read().position,moved));
assert.equal(path.read().status,'wandering');
const unchanged=path.snapshot();
for(const distance of [-1,NaN,Infinity])assert.throws(()=>path.advance(distance),/distance/i);
assert.throws(()=>path.setArea({...moved,radii:[0,9]}),/area/i);
assert.deepEqual(path.snapshot(),unchanged,'Rejected edits mutated current path');
assert.throws(()=>createWanderPath({snapshot:{...unchanged,rng:NaN}}),/snapshot|random/i);
// A nearly straight quadratic can still have nonlinear parameter speed. Check
// the rendered geometric travel, not the controller's distance counter.
for(const offset of [0,.01,.02]){
 const angle=Math.atan2(.017188196681616738,.9998522720356412)+offset;
 const straight=createWanderPath({area:{center:[0,0],radii:[10,10],yaw:0},position:[0,0],direction:[Math.cos(angle),Math.sin(angle)],seed:1});
 let prior=straight.read().position,travel=0;
 for(let i=0;i<1000;i++){const next=straight.advance(.001).position;travel+=Math.hypot(...next.map((v,k)=>v-prior[k]));prior=next;}
 assert.ok(Math.abs(travel-1)<.001,'Arc-distance inversion changed actual geometric source-paced travel: '+travel);
}
console.log('Wander follows source distance, stays in its area, reconstructs and redirects without teleporting');

// Feeding an accepted physical root back into the route must not choose a new
// curve. Exercise many steps and destination transitions, including restored
// paths, rather than only comparing the first coincident position.
for(const destination of [null,[2,2]]){
 const plain=createWanderPath(input),accepted=createWanderPath(input);
 if(destination){plain.setDestination(destination);accepted.setDestination(destination);}
 for(let i=0;i<300;i++){
  plain.advance(.03);const proposed=accepted.advance(.03);
  accepted.contact(proposed.position,proposed.direction,proposed.distance);
  assert.deepEqual(accepted.snapshot(),plain.snapshot(),'Identity physical acceptance changed the remaining route or RNG');
 }
}
// A tiny real correction should deform the remaining quadratic continuously,
// rather than reinstalling the zone-sized tangent handle after each step.
const remaining=createWanderPath(input);remaining.advance(.8);
const original=remaining.snapshot(),current=remaining.read(),ahead=createWanderPath({snapshot:original});
const expected=ahead.advance(.1),shift=[1e-6,-1e-6];
remaining.contact(current.position.map((x,i)=>x+shift[i]),current.direction,current.distance);
assert.deepEqual(remaining.read().target,current.target);
close(remaining.read().position,current.position.map((x,i)=>x+shift[i]),'Physical displacement must remain authoritative');
// This fixture's first two x coordinates are zero, so x = end.x * t².
const t=Math.sqrt(current.position[0]/original.points[2][0]);
const rightControl=original.points[1].map((x,i)=>x+(original.points[2][i]-x)*t);
const expectedHandle=Math.hypot(...rightControl.map((x,i)=>x-current.position[i]));
const correctedPoints=remaining.snapshot().points;
assert.ok(Math.abs(Math.hypot(...correctedPoints[1].map((x,i)=>x-correctedPoints[0][i]))-expectedHandle)<1e-10,'Physical correction must retain the subdivided tangent handle');
const corrected=remaining.advance(.1);
// Rebuilding the arc lookup has the existing area-scaled 6e-5 inversion
// tolerance; allow that numerical error while rejecting the old handle reset.
assert.ok(Math.hypot(...corrected.position.map((x,i)=>x-expected.position[i]))<1e-4,'Small physical correction reset the remaining curve');
const continued=createWanderPath({snapshot:remaining.snapshot()});
close(continued.advance(.2).position,remaining.advance(.2).position,'Corrected route did not round trip');
const rounded=createWanderPath(input);rounded.advance(.3);const roundState=rounded.snapshot(),roundRead=rounded.read();
rounded.contact(roundRead.position.map(x=>x+Number.EPSILON),roundRead.direction.map(x=>x*(1+Number.EPSILON)),roundRead.distance);
assert.deepEqual(rounded.snapshot(),roundState,'Transform roundoff must not trigger curve reconstruction');
