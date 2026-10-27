import assert from 'node:assert/strict';
export function assertWholeObjectAtRest({initial,unloaded}){
 assert.equal(initial.material.broken,0,'Material was already fractured at construction');
 assert.equal(unloaded.material.broken,0,'Material fractures without an applied hand');
 assert.equal(unloaded.material.hand,null,'Unloaded control has an artificial hand');
 assert.equal(unloaded.material.bodies.length,initial.material.bodies.length,'Unloaded control replaced the material');
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
