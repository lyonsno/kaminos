import * as CANNON from '../../node_modules/cannon-es/dist/cannon-es.js';

const v=p=>new CANNON.Vec3(...p),sub=(a,b)=>a.map((x,i)=>x-b[i]);
const rotate=(p,a)=>[Math.cos(a)*p[0]+Math.sin(a)*p[2],p[1],-Math.sin(a)*p[0]+Math.cos(a)*p[2]];
// Upright physical bodies, coupled by the engine's contact equations. Animation
// supplies a velocity drive, not an imposed pose. Dense flesh stays on WebGPU.
export function createPhysicalEncounterWorld(){
 const world=new CANNON.World({gravity:new CANNON.Vec3(0,0,0)}),bodies=new Map();
 world.solver.iterations=30;world.solver.tolerance=1e-8;
 world.defaultContactMaterial.friction=.15;world.defaultContactMaterial.restitution=0;
 let last={contacts:[],steps:0},disposed=false;
 function solve(rows,commands,seconds){
  if(disposed)throw Error('Physical encounter world disposed');
  if(!Number.isFinite(seconds)||seconds<0)throw Error('Finite nonnegative physical time required');
  const requested=new Map(commands.map(c=>[c.id,c]));
  if(requested.size!==commands.length)throw Error('Duplicate body command');
  const ids=new Set(rows.map(r=>r.id));for(const [id,b]of bodies)if(!ids.has(id)){world.removeBody(b);bodies.delete(id);}
  const prepared=[];
  for(const row of [...rows].sort((a,b)=>a.id.localeCompare(b.id))){
   const shapes=row.movementCores?.length?row.movementCores:row.capsules;
   if(!shapes?.length)throw Error('Physical body requires explicit contact shapes');
   const cmd=requested.get(row.id),motion=cmd?.motion??{pivot:[row.position[0],0,row.position[1]],translation:[0,0,0],angle:0};
   if(![...motion.pivot,...motion.translation,motion.angle].every(Number.isFinite)||motion.axis&&Math.hypot(...sub(motion.axis,[0,-1,0]))>1e-6)throw Error('Physical walking requires finite motion on the world horizontal plane');
   const spheres=shapes.flatMap(s=>{if(!(s.radius>0)||![...s.a,...s.b,s.radius].every(Number.isFinite))throw Error('Invalid physical sphere/capsule');const n=Math.ceil(Math.hypot(...sub(s.b,s.a))/s.radius);return Array.from({length:n+1},(_,i)=>({point:s.a.map((x,j)=>x+(s.b[j]-x)*(n?i/n:0)),radius:s.radius}));});
   const next=cmd?.nextBody?.movementCores?.length?cmd.nextBody.movementCores:null;
   if(next&&next.length!==shapes.length)throw Error('Physical articulation shape inventory changed');
   const offsets=spheres.map((s,i)=>next?rotate(sub(next[i].a,motion.pivot.map((x,j)=>x+motion.translation[j])),motion.angle).map((x,j)=>x+motion.pivot[j]-s.point[j]):[0,0,0]);
   const mass=spheres.reduce((n,s)=>n+s.radius**3,0),center=[0,1,2].map(j=>spheres.reduce((n,s)=>n+s.point[j]*s.radius**3,0)/mass);
   let body=bodies.get(row.id);if(!body){body=new CANNON.Body({mass:1,linearDamping:0,angularDamping:0,allowSleep:false});body.linearFactor.set(1,0,1);body.angularFactor.set(0,1,0);bodies.set(row.id,body);world.addBody(body);}
   body.type=cmd?CANNON.Body.DYNAMIC:CANNON.Body.STATIC;body.mass=cmd?mass:0;
   body.position.copy(v(center));body.quaternion.set(0,0,0,1);
   for(const shape of [...body.shapes])body.removeShape(shape);
   for(const s of spheres)body.addShape(new CANNON.Sphere(s.radius),v(sub(s.point,center)));
   body.updateMassProperties();body.aabbNeedsUpdate=true;
   if(!cmd){body.velocity.set(0,0,0);body.angularVelocity.set(0,0,0);}
   const yaw=-motion.angle,rotated=rotate(sub(center,motion.pivot),yaw),target=motion.pivot.map((x,i)=>x+motion.translation[i]+rotated[i]);
   const velocity=seconds?sub(target,center).map(x=>x/seconds):[0,0,0],omega=seconds?yaw/seconds:0;
   const radius=Math.max(...spheres.map(s=>Math.hypot(...sub(s.point,center))+s.radius)),minimum=Math.min(...spheres.map(s=>s.radius));
   prepared.push({row,body,motion,center,velocity,omega,radius,minimum,offsets,starts:body.shapeOffsets.map(o=>o.clone()),active:Boolean(cmd)});
  }
  world.broadphase.dirty=true;
  let remaining=seconds,steps=0;const contacts=[];
  while(remaining>1e-12){
   // Resolve angular travel too: no endpoint-only rotation or fixed catch-up
   // cap. Each substep moves the fastest body tip less than 1/5 of a sphere.
   let h=Math.min(remaining,1/120);
   for(const p of prepared){const speed=Math.max(p.body.velocity.length(),Math.hypot(...p.velocity))+Math.max(Math.abs(p.body.angularVelocity.y),Math.abs(p.omega))*p.radius+(seconds?Math.max(...p.offsets.map(d=>Math.hypot(...d)))/seconds:0);if(speed>0)h=Math.min(h,p.minimum*.2/speed);}
   for(const p of prepared)if(p.active){
    const t=(seconds-remaining+h)/seconds;
    for(let i=0;i<p.body.shapeOffsets.length;i++){const d=p.offsets[i],start=p.starts[i];p.body.shapeOffsets[i].set(start.x+d[0]*t,start.y+d[1]*t,start.z+d[2]*t);}
    p.body.updateBoundingRadius();p.body.aabbNeedsUpdate=true;
    // Implicit first-order motor; finite drive lets another body push back.
    const gain=1/(.08+h);p.body.force.set(p.body.mass*(p.velocity[0]-p.body.velocity.x)*gain,0,p.body.mass*(p.velocity[2]-p.body.velocity.z)*gain);
    p.body.torque.set(0,p.body.inertia.y*(p.omega-p.body.angularVelocity.y)*gain,0);
   }
   world.step(h);remaining=Math.max(0,remaining-h);steps++;
   for(const c of world.contacts){const a=prepared.find(p=>p.body===c.bi),b=prepared.find(p=>p.body===c.bj);contacts.push({a:a.row.id,b:b.row.id,point:c.bi.position.vadd(c.ri).toArray(),normal:c.ni.toArray(),force:c.multiplier});}
  }
  const motions=new Map();for(const p of prepared){const q=p.body.quaternion,yaw=2*Math.atan2(q.y,q.w),r=rotate(sub(p.motion.pivot,p.center),yaw),root=p.body.position.toArray().map((x,i)=>x+r[i]);motions.set(p.row.id,{pivot:[...p.motion.pivot],translation:sub(root,p.motion.pivot),angle:-yaw,axis:[0,-1,0]});}
  last={contacts,steps};return {motions,...last};
 }
 return {solve,read:()=>({backend:'cannon-es-cpu',engineVersion:'0.20.0',degreesOfFreedom:'world-xz-and-yaw',...last,bodies:bodies.size,shapes:[...bodies].flatMap(([id,b])=>b.shapes.map((s,i)=>({id,position:b.pointToWorldFrame(b.shapeOffsets[i]).toArray(),radius:s.radius})))}),dispose(){disposed=true;for(const b of bodies.values())world.removeBody(b);bodies.clear();}};
}
