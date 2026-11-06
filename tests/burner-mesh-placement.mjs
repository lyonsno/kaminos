// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as burners from '../burner-assembly.mjs';
import {flameSourceInputs} from '../scene-fire-domain.mjs';
const pose={position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},d=(id,value)=>({id,param:id.replaceAll('-','_'),value,type:typeof value==='string'?'select-one':'range'});
const settings=Object.fromEntries([['volume-emitter-source-law','immersed-source'],['volume-emitter-aperture-pattern','shape'],['volume-immersed-radius',.1],['volume-immersed-fuel',.56],['volume-immersed-speed',.1],['volume-immersed-yaw',0]].map(([id,value])=>[id,d(id,value)]));
const body={id:'body',type:'glb',source:'/accepted.glb',label:'Accepted rack',transform:pose},template={id:'existing',type:'flame-emitter',source:'kaminos:analytic-flame',transform:pose,emissionEnabled:true,emission:{domainId:'flame-field',settings}};
test('accepted meshes become ordinary burner assemblies with a separate source and preserved housing',()=>{
 assert.equal(typeof burners.meshBurnerPlan,'function','mesh must compose through native burner membership');
 for(const kind of ['rack','ring','nozzle']){
  const scene={objects:[body,template],groups:[],selection:{ids:['body'],activeId:'body'},liveIds:['live-investigation']};
  const result=burners.meshBurnerPlan({scene,bodyId:'body',template,kind,bounds:{min:[-.5,-.1,-.2],max:[.5,.1,.2]},sourceId:'outlet',groupId:'burner'});
  assert.deepEqual(result.objects.find(o=>o.id==='body'),{...body,groupId:'burner'});assert.deepEqual(result.objects.find(o=>o.id==='existing'),template);assert.deepEqual(result.liveIds,scene.liveIds);
  const outlet=result.objects.find(o=>o.id==='outlet');assert.equal(outlet.emission.settings['volume-emitter-aperture-pattern'].value,{rack:'slot',ring:'jets',nozzle:'shape'}[kind]);
  assert.equal(result.groups[0].assembly.kind,'burner');assert.deepEqual(result.groups[0].assembly.roles,{body:'body',outlet:'outlet'});assert.deepEqual(result.selection,{ids:['@group:burner'],activeId:'@group:burner'});
  const supply=flameSourceInputs([outlet],{controls:{resolution:32,gridHeightRatio:2}})[0];assert.equal(supply.controls.emitterAperturePattern,{rack:'slot',ring:'jets',nozzle:'shape'}[kind]);assert.ok(supply.controls.immersedRadius>0);
 }
});
test('authored outlet frames remain explicit and invalid profiles do not mutate the scene',()=>{
 const scene={objects:[body,template],groups:[],selection:{ids:[],activeId:null}},before=structuredClone(scene);
 const options={scene,bodyId:'body',template,kind:'nozzle',bounds:{min:[-.5,-.5,-.5],max:[.5,.5,.5]},sourceId:'outlet',groupId:'burner',outlet:{position:[.2,.3,.1],rotation:[0,0,-Math.PI/2],radius:.08}};
 const next=burners.meshBurnerPlan(options),outlet=next.objects.find(o=>o.id==='outlet');assert.deepEqual(outlet.transform.position,[.2,.3,.1]);assert.deepEqual(outlet.transform.rotation,[0,0,-Math.PI/2]);
 assert.throws(()=>burners.meshBurnerPlan({...options,kind:'guess-mouth'}),/kind/i);assert.deepEqual(scene,before);
});

test('a retained fire composition with no active sources supplies its owned source template',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('async function makeMeshBurner('),z=html.indexOf('async function openMeshBurnerDialog(',a);
 let saved;const scene={objects:[body],groups:[],selection:{ids:['body'],activeId:'body'}};
 const context={assertSceneConstructionAvailable(){},activeSceneComposition:{flame:{presetId:'retained-basin'}},workingScene:{find:()=>({object:{}})},THREE:{Box3:class{constructor(){this.min={toArray:()=>[-.5,-.1,-.2]};this.max={toArray:()=>[.5,.1,.2]};}setFromObject(){return this;}}},sceneMembershipBatch:{capture:()=>structuredClone(scene)},authoredFlameSourceRecords:()=>[],readVolumeSettingsValues:()=>({domControls:{...settings,'volume-resolution':d('volume-resolution',32)}}),fireControlOwner:id=>id==='volume-resolution'?'domain':'source',FIRE_DOMAIN_ID:'flame-field',FLAME_EMITTER_TYPE:'flame-emitter',FLAME_EMITTER_SOURCE:'kaminos:analytic-flame',makeSceneObjectId:prefix=>prefix,meshBurnerPlan:burners.meshBurnerPlan,scenePlacementTools:{edits:{applySettled:async(_,value)=>{saved=value;}}},setInfo(){},structuredClone};
 await runInNewContext(html.slice(a,z)+';makeMeshBurner("body",{kind:"rack"})',context);
 const result=saved.objects.find(o=>o.type==='flame-emitter');assert.equal(result.emission.settings['volume-immersed-fuel'].value,.56);assert.equal(result.emission.settings['volume-resolution'],undefined);assert.equal(saved.groups[0].assembly.kind,'burner');
});
