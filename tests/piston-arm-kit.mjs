// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {pistonArmScene} from '../piston-arm-kit.mjs';
import {checkedProceduralMesh} from '../scene-geometry.mjs';
import {checkedActuators,solveActuator} from '../scene-actuator.mjs';
import {flamePoseToDomain,immersedControlsForFlamePose} from '../scene-flame-emitter.mjs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]};
const source=()=>({objects:[{id:'old-cast',type:'glb'},{id:'fire',type:'flame-emitter',transform:pose,emission:{settings:{}}},{id:'domain',type:'simulation-domain',transform:pose}],groups:[],actuators:[],model:{source:'old.glb'},composition:{flame:{presetId:'retained'}},camera:{position:[4,0,0]}});
test('primitive carrier replaces cast geometry, retains fire recipe, and names all four moving roles',()=>{
 const input=source(),before=structuredClone(input),s=pistonArmScene(input);assert.deepEqual(input,before);
 assert.equal(s.objects.some(o=>o.type==='glb'),false);assert.equal(s.model,null);assert.deepEqual(s.composition,input.composition);
 const meshes=s.objects.filter(o=>o.type==='procedural-mesh');assert.ok(meshes.length>10);for(const o of meshes)checkedProceduralMesh(o);
 const foot=meshes.find(o=>o.id.endsWith('-foot'));assert.equal(foot.transform.position[1]-foot.geometry.parameters.height/2,s.environment.ground.height);
 const [r]=checkedActuators(s.actuators);assert.equal(s.actuators.length,1);const ids=[r.fixedId,r.followerId,r.barrelId,r.rodId];assert.equal(new Set(ids).size,4);
 for(const id of ids){const g=s.groups.find(g=>'@group:'+g.id===id);assert.ok(g);assert.ok(g.objectIds.length);for(const id of g.objectIds)assert.ok(s.objects.some(o=>o.id===id));}
 assert.ok(s.groups.find(g=>'@group:'+g.id===r.followerId).objectIds.includes('fire'));
 for(const length of [r.drive.min,r.length,r.drive.max])assert.ok(Object.values(solveActuator(r,length).poses).every(p=>p.scale.every(v=>Math.abs(v-1)<1e-9)));
});
test('dimension changes alter the carrier and mounts coherently; invalid input refuses',()=>{
 const a=pistonArmScene(source()),b=pistonArmScene(source(),{height:.9,reach:1.5,prefix:'long'});
 assert.notDeepEqual(a.actuators[0].hinge,b.actuators[0].hinge);assert.notDeepEqual(a.actuators[0].movingMount,b.actuators[0].movingMount);
 assert.ok(b.objects.filter(o=>o.type==='procedural-mesh').every(o=>o.id.startsWith('long-')));
 assert.throws(()=>pistonArmScene(source(),{reach:0}),/reach/);assert.throws(()=>pistonArmScene({objects:[]}),/flame/);
});
test('moving the source updates the pose-derived saved supply controls rather than contradicting them',()=>{
 const t=source();t.objects.find(o=>o.type==='flame-emitter').emission.settings=Object.fromEntries(['centre-x','centre-y','centre-z','yaw','pitch'].map(key=>['volume-immersed-'+key,{value:-.3}]));
 const s=pistonArmScene(t),f=s.objects.find(o=>o.type==='flame-emitter'),d=s.objects.find(o=>o.type==='simulation-domain'),scale=d.transform.scale[0],translation=d.transform.position.map((v,i)=>v-(i===1?scale:0));
 const expected=immersedControlsForFlamePose({},flamePoseToDomain(f.transform,translation,scale),false);
 for(const [suffix,key]of [['centre-x','immersedCentreX'],['centre-y','immersedCentreY'],['centre-z','immersedCentreZ'],['yaw','immersedYaw'],['pitch','immersedPitch']]){const c=f.emission.settings['volume-immersed-'+suffix];assert.equal(c.value,Number(expected[key].toPrecision(15)));assert.ok(Math.abs(c.value-expected[key])<1e-12);assert.equal(Object.hasOwn(c,'rawValue'),false);}
});
