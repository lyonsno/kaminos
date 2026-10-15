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
console.log('Wander follows source distance, stays in its area, reconstructs and redirects without teleporting');
