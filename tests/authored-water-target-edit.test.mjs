// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';import * as THREE from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {createLocalLiquidEmitterSceneRecord,createLocalLiquidEmitterObject} from '../local-liquid-scene-object.mjs';
import {normalizeLocalLiquidEmitter,normalizeLocalLiquidSetup,defaultLocalLiquidSetup,LOCAL_LIQUID_EMITTER_TYPE} from '../local-liquid-setup.mjs';
import {resolveAuthoredWaterSampling,describeAuthoredWaterDrop} from '../authored-water-drop.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
for(const widths of [[.0005],[.001,.001]]){
 const records=widths.map((width,i)=>createLocalLiquidEmitterSceneRecord({id:'drop'+i,transform:{position:[i*.8,1,0],rotation:[0,0,0],scale:[1,1,1]},settings:{schema:'kaminos.local-liquid-emitter.v1',mode:'finite_drop',drop:{width,samplesPerUnit:48}}}));
 const setup={...defaultLocalLiquidSetup(),waterSampling:{spacing:widths[0]/24,particleTarget:widths.length===1?13824:2000,container:{min:[-2,-1,-2],max:[2,3,2]}}};setup.waterSampling=resolveAuthoredWaterSampling(records,setup);
 const rows=records.map(r=>({...r,object:createLocalLiquidEmitterObject(THREE,r,{sampling:setup.waterSampling}).object}));
 const history=createSceneEdits({read:()=>null,write(){throw Error('Unexpected transform');}});
 let inspectorRefreshes=0;
 const c={THREE,structuredClone,LOCAL_LIQUID_EMITTER_TYPE,normalizeLocalLiquidEmitter,normalizeLocalLiquidSetup,resolveAuthoredWaterSampling,describeAuthoredWaterDrop,createLocalLiquidEmitterObject,
  sceneObjects:rows,localLiquidSetup:setup,localLiquidHost:null,authoredWaterControls:null,window:{_kaminosDirty(){}},scenePlacementTools:{edits:history},assertSceneConstructionAvailable(){},updateWaterSourceGuides(){},updateAuthoringPropertySelection(){inspectorRefreshes++;},
  sceneObjectTransformState:o=>({position:o.position.toArray(),rotation:[o.rotation.x,o.rotation.y,o.rotation.z],scale:o.scale.toArray()}),serializeSceneObject:r=>({...r,object:undefined}),localLiquidEmitterRecords:()=>rows.map(r=>({...r,transform:c.sceneObjectTransformState(r.object)})),
  syncLocalLiquidHostEmitters(){c.localLiquidSetup.waterSampling=resolveAuthoredWaterSampling(c.localLiquidEmitterRecords(),c.localLiquidSetup);}};
 vm.createContext(c);const a=html.indexOf('const waterSettingTargets='),b=html.indexOf('\nlet authoredWaterDraftPreview',a);vm.runInContext(html.slice(a,b),c);
 const check=(refreshExpected=0)=>{assert.equal(inspectorRefreshes,refreshExpected,'Committed particle count must refresh the shared inspector summary');const sampling=resolveAuthoredWaterSampling(c.localLiquidEmitterRecords(),c.localLiquidSetup);for(const r of rows){const expected=describeAuthoredWaterDrop(r.localLiquidEmitter.drop,c.sceneObjectTransformState(r.object),sampling),p=r.object.children.find(n=>n.userData.kaminosWaterPreview);assert.equal(p.count,expected.particleCount);assert.ok(Math.abs(p.userData.spacing-sampling.spacing)<1e-12);}};
 check();c.applyAuthoredWaterSettings(rows[0].id,{drop:{...rows[0].localLiquidEmitter.drop,width:.5}});assert.equal(rows[0].localLiquidEmitter.drop.width,.5);check(1);assert.equal(c.localLiquidSetup.waterSampling.particleTarget,setup.waterSampling.particleTarget);
 await history.undo();assert.equal(rows[0].localLiquidEmitter.drop.width,widths[0]);check(2);await history.redo();assert.equal(rows[0].localLiquidEmitter.drop.width,.5);check(3);
}
console.log('Actual source commit resolves whole-volume target before construction and keeps peer previews coherent through Undo/Redo');
