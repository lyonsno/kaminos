// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const start=html.indexOf(`function ${name}(`);assert.ok(start>=0,`missing ${name}`);return html.slice(start,html.indexOf('\n}',start)+2);};
test('selecting the water field exposes its native placement target',()=>{
 const root=new THREE.Object3D(),c={sceneComponents:null,workingScene:{selection:{ids:['water-field']},activeFieldId:'water-field'},waterDomainEditObject:()=>root,selectedSceneGroupEntry:()=>null,selectedSceneObjectEntry:()=>null,GROUP_TYPE:'group'};
 vm.createContext(c);vm.runInContext(grab('selectedPlacementEntry'),c);
 const target=c.selectedPlacementEntry();
 assert.equal(target?.id,'@water-domain','Water simulation must be editable with native Move/Scale');assert.equal(target.object,root);
});
test('water guide follows authored bounds instead of the retired playground',()=>{
 const bounds={min:[1,2,3],max:[4,6,8]},c={THREE,localLiquidSetup:{},localLiquidDomainGuide:null,localLiquidRunningDomainGuide:null,waterDomainProxy:null,waterDomainDraft:null,localLiquidHost:null,
 waterDomainBounds:()=>bounds,acceptedWaterDomainPose:()=>({position:[2.5,4,5.5],rotation:[0,0,0],scale:[3,4,5]}),
 fingerFluidAnalyticalSupportGeometry:()=>({boundsMin:[-10,-10,-10],boundsMax:[10,10,10]}),
 transformControls:null,scene:new THREE.Scene(),isSceneItemVisible:()=>true,selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainOpacity:1},styleSimulationDomainGuide(){},styleHelperLines(){},applySceneObjectTransformState(){}};
 vm.createContext(c);vm.runInContext(grab('syncWaterDomainGuide'),c);c.syncWaterDomainGuide();
 assert.deepEqual(c.localLiquidDomainGuide.box.min.toArray(),bounds.min);assert.deepEqual(c.localLiquidDomainGuide.box.max.toArray(),bounds.max);
 bounds.min=[2,3,4];c.syncWaterDomainGuide();assert.deepEqual(c.localLiquidDomainGuide.box.min.toArray(),bounds.min,'already mounted guide must refresh');
});

import {waterDomainPose,checkedWaterDomainPose,waterDomainSampling} from '../authored-water-domain.mjs';
import {resolveAuthoredWaterSampling} from '../authored-water-drop.mjs';
import {normalizeLocalLiquidSetup,defaultLocalLiquidSetup} from '../local-liquid-setup.mjs';
import {authoredMlsCellSize,authoredMlsSetup} from '../authored-mls-water.mjs';
import {mlsConfig} from '../mls-juice-contract.mjs';
import {createSceneEdits,transformPose} from '../scene-edit-session.mjs';
const source={id:'inlet',type:'local-liquid-emitter',transform:{position:[.25,.5,0],rotation:[Math.PI/2,0,0],scale:[1,1,1]},localLiquidEmitter:{schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',baseRadius:.04,strength:1,rate:240}};
test('native pose history edits only bounds, preserving sources, sampling and evolved run',()=>{
 const sampling={spacing:1/48,particleTarget:1234,container:{min:[-.5,0,-.5],max:[.5,1,.5]}};
 const initial={...defaultLocalLiquidSetup(),waterSampling:sampling},running=authoredMlsSetup([source],initial),pending=[];
 const c={localLiquidSetup:structuredClone(initial),localLiquidEmitterRecords:()=>[source],normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,authoredMlsCellSize,waterDomainPose,checkedWaterDomainPose,waterDomainSampling,
 waterDomainProxy:null,localLiquidHost:{setSetup:value=>pending.push(structuredClone(value))},syncWaterDomainGuide(){},authoredWaterControls:null,window:{},structuredClone};
 vm.createContext(c);vm.runInContext(['acceptedWaterDomainPose','checkWaterDomainPose','writeWaterDomainPose'].map(grab).join('\n'),c);
 const edits=createSceneEdits({read(){},write(){}});edits.register('@water-domain',{read:c.acceptedWaterDomainPose,write:c.writeWaterDomainPose,check:c.checkWaterDomainPose});
 edits.begin('@water-domain');edits.preview({position:[2,3,4],scale:[2,3,4]});edits.cancel();assert.deepEqual(c.localLiquidSetup,initial);
 edits.apply('@water-domain',{position:[.25,.6,0],scale:[2,1.5,3]});
 for(const [side,values] of Object.entries({min:[-.75,-.15,-1.5],max:[1.25,1.35,1.5]}))values.forEach((v,i)=>assert.ok(Math.abs(c.localLiquidSetup.waterSampling.container[side][i]-v)<1e-12));
 assert.equal(c.localLiquidSetup.waterSampling.particleTarget,1234);assert.equal(c.localLiquidSetup.particleCount,12000);
 assert.deepEqual(source.transform.position,[.25,.5,0]);assert.deepEqual(running.solver.originWorld,[-.6,-.1,-.6],'existing run remains unchanged');
 assert.equal(edits.state().undoCount,1);edits.undo();assert.deepEqual(c.localLiquidSetup,initial);edits.redo();
 const saved=JSON.parse(JSON.stringify(c.localLiquidSetup)),next=authoredMlsSetup([source],saved),grid=mlsConfig(next.solver);
 for(let axis=0;axis<3;axis++)assert.ok(Math.abs(grid.bounds.min[axis]-saved.waterSampling.container.min[axis])<1e-12);
 assert.deepEqual(grid.dimensions,[45,35,65]);assert.ok(pending.length>0);
 assert.throws(()=>edits.apply('@water-domain',{rotation:[0,.1,0]}),/world axes/);assert.equal(edits.state().active,null);
});
test('open bounds preserve wall policy and sampling; scaling has no authored upper ceiling',()=>{
 const sampling={spacing:.02,particleTarget:321,container:null,worldBounds:{min:[-1,-1,-1],max:[1,1,1]}};
 const pose=waterDomainPose(sampling);assert.deepEqual(pose.scale,[2,2,2]);
 const resized=waterDomainSampling(sampling,{...pose,scale:[123,0,-2]},.05);
 assert.equal(resized.container,null);assert.equal(resized.particleTarget,321);assert.equal(resized.spacing,.02);
 assert.deepEqual(waterDomainPose(resized).scale,[123,3*.05,3*.05]);
 assert.throws(()=>waterDomainSampling(sampling,{...pose,scale:[Infinity,1,1]},.05),/finite/);
});
test('native world-axis scaling can reach and cross zero before the water minimum clamps',()=>{
 const base={position:[.25,.5,0],rotation:[0,0,0],scale:[2,1,1]};
 for(const amount of [0,-.25]){
  const pose=transformPose(base,{operation:'scale',axis:'x',frame:'world',amount});
  assert.deepEqual(checkedWaterDomainPose(pose,.05).scale,[3*.05,1,1]);
 }
});
