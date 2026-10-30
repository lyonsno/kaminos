// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let feature={};try{feature=await import('../experiments/creature-motion/grounded-walk.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof feature.solveLegTarget,'function','Grounded gait needs length-preserving foot placement');
const group=new THREE.Group(),a=new THREE.Bone(),b=new THREE.Bone(),c=new THREE.Bone(),toe=new THREE.Bone();group.add(a);a.add(b);b.add(c);c.add(toe);b.position.set(.4,-.8,0);c.position.set(-.4,-.8,0);toe.position.set(0,0,.2);group.updateMatrixWorld(true);
const at=o=>o.getWorldPosition(new THREE.Vector3()),lengths=[at(a).distanceTo(at(b)),at(b).distanceTo(at(c)),at(c).distanceTo(at(toe))];
const target=new THREE.Vector3(.3,-1.3,.4),result=feature.solveLegTarget({THREE,chain:[a,b,c,toe],target});
assert.ok(at(toe).distanceTo(target)<1e-7,'Reachable planted toe must meet its world target');
assert.ok(result.residual<1e-7);assert.deepEqual(b.position.toArray(),[.4,-.8,0]);assert.deepEqual(c.position.toArray(),[-.4,-.8,0]);
const residual=feature.solveLegTarget({THREE,chain:[a,b,c,toe],target:new THREE.Vector3(10,-10,0)});
assert.ok(residual.residual>1,'Unreachable contacts must report error, never stretch');
for(const [i,nodes] of [[a,b],[b,c],[c,toe]].entries())assert.ok(Math.abs(at(nodes[0]).distanceTo(at(nodes[1]))-lengths[i])<1e-8);
assert.equal(typeof feature.sampleLegGroups,'function');
const matrix=x=>new THREE.Matrix4().makeTranslation(x,0,0).toArray();
const source={frames:5,fps:4,frame(i){return {actorMatrix:matrix(100+i),bones:['pelvis','spine-chest','forelimb-left-shoulder','forelimb-right-toe','hindlimb-left-hip','hindlimb-right-toe'].map(name=>({name,parent:null,localMatrix:matrix(i)}))};}};
const base=source.frame(1),mixed=feature.sampleLegGroups({THREE,walking:source,base,front:.625,rear:.125});
assert.deepEqual(mixed.actorMatrix,base.actorMatrix);assert.deepEqual(mixed.bones[0],base.bones[0]);assert.deepEqual(mixed.bones[1],base.bones[1]);
assert.equal(mixed.bones[2].localMatrix[12],2.5);assert.equal(mixed.bones[4].localMatrix[12],.5);
assert.deepEqual(source.frame(1),base,'Sampling must not mutate the retained source');
console.log('Separate limb sampling and nonstretching world-foot IK pass');
assert.equal(typeof feature.createGroundedWalk,'function','Grounded gait must retain per-foot targets across accepted root turns');
const rows=[{name:'pelvis',parent:null,p:[0,2,0]},{name:'spine-chest',parent:'pelvis',p:[0,0,2]}];
for(const kind of ['forelimb','hindlimb'])for(const side of ['left','right']){
 const prefix=`${kind}-${side}`,parts=kind==='forelimb'?['shoulder','elbow','wrist','toe']:['hip','stifle','hock','toe'];
 parts.forEach((part,i)=>rows.push({name:`${prefix}-${part}`,parent:i?`${prefix}-${parts[i-1]}`:kind==='forelimb'?'spine-chest':'pelvis',p:i===0?[side==='left'?.3:-.3,0,0]:i===3?[0,0,.2]:[i===1?.15:-.15,-.9,0]}));
}
const cycle={frames:61,fps:30,frame(i){return {actorMatrix:new THREE.Matrix4().toArray(),bones:rows.map(r=>({name:r.name,parent:r.parent,localMatrix:new THREE.Matrix4().makeTranslation(...r.p).multiply(new THREE.Matrix4().makeRotationX(r.name.endsWith('shoulder')||r.name.endsWith('hip')?.2*Math.sin(i/60*Math.PI*2+(r.name.includes('right')?Math.PI:0)):0)).toArray()}))};}};
const baseFrame=(time,path)=>{const p=cycle.frame(Math.floor(time*30)%60);p.actorMatrix=new THREE.Matrix4().makeTranslation(path.position[0],0,path.position[1]).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(path.direction[0],path.direction[1]))).toArray();return p;};
const initial={position:[0,0],direction:[0,1]},turn={position:[0,0],direction:[Math.sin(.2),Math.cos(.2)]};
const grounded=feature.createGroundedWalk({THREE,walking:cycle,baseFrame,forward:[0,1],speed:1,initial});
grounded.advance(initial,turn);
assert.ok(grounded.read().frontTime>grounded.read().rearTime*3,'Chest turning around pelvis must advance front steps more than rear steps');
const snapshot=grounded.snapshot(),copy=feature.createGroundedWalk({THREE,walking:cycle,baseFrame,forward:[0,1],speed:1,initial:turn,snapshot});
assert.deepEqual(copy.read(),grounded.read(),'Restoration must retain limb timing, contacts and release transitions');
const first=grounded.frame(baseFrame(0,turn));assert.deepEqual(first,grounded.frame(baseFrame(0,turn)),'Pose reads may not advance contact state');
assert.deepEqual(snapshot,grounded.snapshot());
const stationary=grounded.snapshot();grounded.advance(turn,turn);assert.deepEqual(grounded.snapshot(),stationary,'A held accepted body must not march in place');
console.log('Accepted turning drives distinct group timing; held state and restoration remain exact');
const next={position:[.02,.03],direction:[Math.sin(.25),Math.cos(.25)]};
grounded.advance(turn,next,.1);copy.advance(turn,next,.1);assert.deepEqual(copy.snapshot(),grounded.snapshot(),'Restored live continuation must preserve all clocks and contact memory');
const pose=grounded.frame(baseFrame(.1,next));
for(const name of ['pelvis','spine-chest'])assert.deepEqual(pose.bones.find(b=>b.name===name).localMatrix,baseFrame(.1,next).bones.find(b=>b.name===name).localMatrix,'Grounding may not move the physical torso');
for(const [name,foot] of Object.entries(grounded.read().feet))if(foot.stance){assert.deepEqual(foot.target,foot.anchor);assert.ok(pose.grounding.feet[name].residual<.01,'Fixture planted contact should be reachable');}
assert.throws(()=>feature.createGroundedWalk({THREE,walking:cycle,baseFrame,forward:[0,1],speed:1,initial:next,snapshot:{...grounded.snapshot(),frontTime:NaN}}),/snapshot/);
