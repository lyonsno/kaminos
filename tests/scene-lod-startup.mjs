// kaminos-test: node
import assert from 'node:assert/strict';
import {lodPreparationContext,captureLodPreparation,cachedLodPreparation} from '../scene-lod-startup.mjs';
const input={camera:{position:[1,2,3]},viewport:[1000,900],settings:{faceBudget:350000},objects:[{type:'glb',id:'x',source:'hero-a',transform:{scale:[1,1,1]}}]};
const key=lodPreparationContext(input),sha='a'.repeat(64),hint=captureLodPreparation(key,{enabled:true,objects:[{id:'x',targetTier:sha}]});assert.equal(cachedLodPreparation(hint,key).get('x'),sha);
for(const patch of [{viewport:[2000,1800]},{camera:{position:[4,5,6]}},{settings:{faceBudget:100000}},{objects:[{...input.objects[0],source:'hero-b'}]}])assert.equal(cachedLodPreparation(hint,lodPreparationContext({...input,...patch})).size,0);
assert.equal(cachedLodPreparation({...hint,extra:'compatible'},key).size,1);assert.equal(cachedLodPreparation({...hint,levels:[{id:'x',sha:'bad'}]},key).size,0);assert.equal(cachedLodPreparation(null,key).size,0);
console.log('Saved LOD preparation is portable, additive, and invalidated by view, budget or asset changes');
const repeated={...input,objects:[{...input.objects[0],repetition:{mode:'line',count:3}}]};
assert.notEqual(lodPreparationContext(repeated),key,'repetition changes must invalidate the download allocation hint');
const {createCoarseRepetition}=await import('../scene-lod-startup.mjs');
const THREE=await import('../lib/three.core.js');
const root=new THREE.Group().add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
const reps=createCoarseRepetition({previews:()=>[{root,record:{id:'a',type:'glb',repetition:{mode:'line',count:3}}}],groups:()=>[{id:'g',objectIds:['a'],transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},repetition:{mode:'line',count:2}}]});
reps.sync();assert.equal(root.children.filter(row=>row.userData.kaminosRepetitionCopy).length,5,'coarse view retains object and group repetition');reps.clear(root);assert.equal(root.children.length,1);
console.log('Coarse proxies exercise the existing object/group repetition owner');
// Native save/reopen r4: the serializer writes null repetition while restore
// omits it. Both mean one instance and must preserve a preparation hint.
const rawGroup={id:'lights',objectIds:['key','rim'],transform:input.objects[0].transform,repetition:null};
assert.equal(lodPreparationContext({...input,groups:[rawGroup]}),lodPreparationContext({...input,groups:[{...rawGroup,repetition:undefined}]}),'Absent and null group repetition are the same allocation context');
