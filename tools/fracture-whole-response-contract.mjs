import assert from 'node:assert/strict';
export function assertWholeObjectAtRest({initial,unloaded}){
 assert.equal(initial.material.broken,0,'Material was already fractured at construction');
 assert.equal(unloaded.material.broken,0,'Material fractures without an applied hand');
 assert.equal(unloaded.material.hand,null,'Unloaded control has an artificial hand');
 assert.equal(unloaded.material.bodies.length,initial.material.bodies.length,'Unloaded control replaced the material');
 const vector=(v,label)=>{assert.ok(v&&['x','y','z'].every(k=>Number.isFinite(v[k])),`Missing finite ${label} in unloaded state`);return[v.x,v.y,v.z];},length=v=>Math.hypot(...v),distance=(a,b)=>length(a.map((v,k)=>v-b[k]));
 const positions=initial.material.bodies.map(b=>vector(b.position,'position')),span=[0,1,2].map(k=>Math.max(...positions.map(p=>p[k]))-Math.min(...positions.map(p=>p[k]))),dimensions=initial.material.dimensions;
 const scale=dimensions?Math.min(dimensions.dx,dimensions.dy,dimensions.dz):length(span);
 assert.ok(Number.isFinite(scale)&&scale>0,'Unloaded comparison needs a material length scale');
 const elapsed=unloaded.material.time!==undefined&&initial.material.time!==undefined?unloaded.material.time-initial.material.time:(unloaded.material.step-initial.material.step)*(initial.material.config?.timeStep??1/60);
 assert.ok(elapsed>0,'Unloaded comparison needs elapsed physical steps');
 const positionBudget=scale*.05,angleBudget=.1;let maxPositionDelta=0,maxAngleDelta=0,maxLinearSpeed=0,maxAngularSpeed=0;
 for(let i=0;i<positions.length;i++){
  const a=initial.material.bodies[i],b=unloaded.material.bodies[i],drift=distance(positions[i],vector(b.position,'position'));
  assert.ok(drift<=positionBudget,`Unloaded shape displacement exceeds elastic settling allowance: cell ${i}, ${drift} > ${positionBudget}`);maxPositionDelta=Math.max(maxPositionDelta,drift);
  const quaternion=q=>{assert.ok(q&&['x','y','z','w'].every(k=>Number.isFinite(q[k])), 'Missing finite orientation in unloaded state');const v=[q.x,q.y,q.z,q.w],n=length(v);assert.ok(n>0,'Zero unloaded orientation');return v.map(x=>x/n);};
  const qa=quaternion(a.quaternion),qb=quaternion(b.quaternion),angle=2*Math.acos(Math.min(1,Math.abs(qa.reduce((s,x,k)=>s+x*qb[k],0))));assert.ok(angle<=angleBudget,`Unloaded rotation exceeds elastic settling allowance: cell ${i}`);maxAngleDelta=Math.max(maxAngleDelta,angle);
  const speed=length(vector(b.velocity,'velocity')),angular=length(vector(b.angularVelocity,'angular velocity'));assert.ok(speed*elapsed<=positionBudget,`Unloaded continuing motion exceeds settling allowance: cell ${i}`);assert.ok(angular*elapsed<=angleBudget,`Unloaded continuing angular motion exceeds settling allowance: cell ${i}`);maxLinearSpeed=Math.max(maxLinearSpeed,speed);maxAngularSpeed=Math.max(maxAngularSpeed,angular);
 }
 return {scale,elapsed,positionBudget,angleBudget,maxPositionDelta,maxAngleDelta,maxLinearSpeed,maxAngularSpeed};
}
export function assertGrabbedMaterialFractures({before,after,hand=before.material.hand}){
 assert.ok(hand,'A drag needs an actual surface hand');
 const members=new Set([hand.index]);let changed=true;
 while(changed){changed=false;for(const b of before.material.bonds)if(b.alive&&(members.has(b.a)||members.has(b.b))){if(!members.has(b.a)||!members.has(b.b))changed=true;members.add(b.a);members.add(b.b);}}
 const old=new Map(before.material.bonds.map(b=>[b.id,b])),fresh=after.material.events.filter(e=>e.kind==='crack'&&e.step>before.material.step);
 const loaded=fresh.filter(e=>{const b=old.get(e.id);return b?.alive&&members.has(b.a)&&members.has(b.b)&&e.handActive&&(e.reaction>0||e.bendingReaction>0)&&e.stress>after.material.config.strength;});
 assert.ok(loaded.length,'No new stress-generated fracture on the grabbed material load path');
 return {grabbedCell:hand.index,loadedCells:[...members],loadedCracks:loaded.map(e=>e.id),otherCracks:fresh.filter(e=>!loaded.includes(e)).map(e=>e.id)};
}
