// kaminos-test: node
import assert from 'node:assert/strict';
import * as api from '../experiments/creature-motion/encounters.mjs';
assert.equal(typeof api.createPhysicalEncounterWorld,'function','Encounters need mutual contact response, not scalar admission');
const sphere=(x,z,r=.3)=>({a:[x,0,z],b:[x,0,z],radius:r});
const body=(id,x,z=0)=>({id,mounted:true,position:[x,z],direction:[1,0],radius:.5,movementCores:[sphere(x,z)]});
const world=api.createPhysicalEncounterWorld();
let rows=[body('a',-.31),body('b',.31)];
let touched=false;
for(let k=0;k<120;k++){
 const result=world.solve(rows,rows.map(b=>({id:b.id,motion:{pivot:[...b.position.slice(0,1),0,b.position[1]],translation:b.id==='a'?[.01,0,0]:[0,0,0],angle:0}})),1/120);
 touched ||= result.contacts.length>0;
 rows=rows.map(b=>api.moveTorso(b,result.motions.get(b.id)));
}
assert.ok(touched,'Actual engine contacts required');
assert.ok(rows[1].position[0]>.45,'The other body must yield instead of the mover freezing');
assert.ok(api.movementContactGap(...rows)>-.015,'Bodies remain mutually solid while pushing');
world.dispose();
// An off-center strike must exchange angular response as well as translation.
const turn=api.createPhysicalEncounterWorld();let rod={...body('rod',0),movementCores:[sphere(-1,0,.25),sphere(0,0,.25),sphere(1,0,.25)]},pusher=body('pusher',.8,-.55),yaw=0;
for(let k=0;k<100;k++){
 const out=turn.solve([rod,pusher],[{id:'rod',motion:{pivot:[0,0,0],translation:[0,0,0],angle:0}},{id:'pusher',motion:{pivot:[pusher.position[0],0,pusher.position[1]],translation:[0,0,.01],angle:0}}],1/120);
 yaw+=out.motions.get('rod').angle;rod=api.moveTorso(rod,out.motions.get('rod'));pusher=api.moveTorso(pusher,out.motions.get('pusher'));
}
assert.ok(Math.abs(yaw)>.03,'Off-center contact must rotate the body');turn.dispose();
console.log('Compound body contacts exchange translation and yaw');
// Both callbacks submit before solving: engine order cannot change the answer.
function ordered(reverse){const w=api.createPhysicalEncounterWorld(),a=body('a',-.31),b=body('b',.31),rows=reverse?[b,a]:[a,b],commands=rows.map(row=>({id:row.id,motion:{pivot:[row.position[0],0,0],translation:[row.id==='a'?.04:-.04,0,0],angle:.1}}));const result=w.solve(rows,commands,1/30);const value=[...result.motions].sort(([a],[b])=>a.localeCompare(b));w.dispose();return value;}
assert.deepEqual(ordered(false),ordered(true));
// A long compound turning about its rear must be moved by an obstacle rather
// than tunnel through it just because its requested endpoint is clear.
const spinning=api.createPhysicalEncounterWorld(),long={...body('long',0),movementCores:Array.from({length:13},(_,i)=>sphere(i/6-1,0,.18))},wall={...body('wall',0,.65),movementCores:[sphere(0,.65,.25)]};
const spun=spinning.solve([long,wall],[{id:'long',motion:{pivot:[-1,0,0],translation:[0,0,0],angle:Math.PI}}],.2);
assert.ok(spun.contacts.length,'Turning body must make actual contacts during its sweep');assert.ok(spun.steps>24,'Tip travel must refine temporal resolution for a fast turn');
assert.ok(api.movementContactGap(api.moveTorso(long,spun.motions.get('long')),wall)>-.04,'Turning leaves the end of the body outside the obstacle');spinning.dispose();
// The grounding consumer needs the accepted sweep, including angular motion.
const traced=api.createPhysicalEncounterWorld(),single=body('trace',0),trace=traced.solve([single],[{id:'trace',motion:{pivot:[0,0,0],translation:[.2,0,.1],angle:.3}}],.1),accepted=trace.motions.get('trace');
assert.equal(accepted.journey?.length,trace.steps,'Every accepted physical substep must reach the foot consumer');
assert.deepEqual(accepted.journey.at(-1).translation,accepted.translation);assert.equal(accepted.journey.at(-1).angle,accepted.angle);
assert.ok(Math.abs(accepted.journey.at(-1).seconds-.1)<1e-12);assert.ok(accepted.journey.every((s,i,a)=>s.seconds>0&&(!i||s.seconds>a[i-1].seconds)));traced.dispose();
