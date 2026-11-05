// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {planRingBurner,planBurnerBodyReplacement} from '../ring-burner.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {FLAME_EMITTER_SOURCE} from '../scene-flame-emitter.mjs';
import {assemblySelection,copyAssembly} from '../scene-assembly.mjs';
const pose={position:[1,2,3],rotation:[0,.3,0],scale:[2,2,2]};
const template={id:'existing-source',type:'flame-emitter',source:FLAME_EMITTER_SOURCE,transform:pose,emission:{domainId:'flame-field',settings:{'emitter-assay-family':{type:'select-one',value:'ribbon'},'volume-flow-rate':{type:'range',value:1.5}}}};
const mesh={kind:'mesh',source:'/api/read?root=generated-meshes&path=ring.glb',name:'ring.glb',label:'Gothic crown'};
const state={objects:[template],groups:[],selection:{ids:[template.id],activeId:template.id},liveIds:['live-experiment'],domain:[0,0,0]};
const options={groupId:'ring',bodyId:'housing',outletId:'outlet',template,pose,mesh};
test('ring creation owns independent body/outlet and preserves its existing neighbors',()=>{
 const before=structuredClone(state),next=planRingBurner(state,options);
 assert.deepEqual(state,before);assert.deepEqual(next.objects[0],template);assert.deepEqual(next.liveIds,state.liveIds);
 const group=next.groups[0],outlet=next.objects.find(o=>o.id==='outlet'),body=next.objects.find(o=>o.id==='housing');
 assert.deepEqual(group.assembly,{kind:'burner',roles:{housing:'body',outlet:'outlet'}});
 assert.deepEqual(next.selection,{ids:['@group:ring'],activeId:'@group:ring'});
 assert.equal(outlet.emission.settings['emitter-assay-family'].value,'ring');assert.equal(outlet.emission.settings['volume-flow-rate'].value,1.5);
 assert.equal(body.type,'glb');assert.equal(body.source,mesh.source);assert.equal(body.collision,undefined,'generated surface is not an inferred obstacle');
 assert.deepEqual(assemblySelection({ids:['housing'],activeId:'housing'},next.groups),next.selection);
 assert.deepEqual(copyAssembly(group,new Map([['housing','copy-body'],['outlet','copy-outlet']])),{kind:'burner',roles:{'copy-body':'body','copy-outlet':'outlet'}});
});
test('ring body has a procedural fallback and each additional ring gets its own source',()=>{
 const first=planRingBurner(state,{...options,mesh:null}),next=planRingBurner(first,{...options,groupId:'ring2',bodyId:'body2',outletId:'outlet2',mesh:null});
 assert.equal(first.objects.find(o=>o.id==='housing').geometry.kind,'annular');assert.equal(next.groups.length,2);
 assert.equal(next.objects.filter(o=>o.type==='flame-emitter').length,3);assert.equal(next.objects.find(o=>o.id==='outlet2').emission.settings['emitter-assay-family'].value,'ring');
});
test('body replacement keeps edited world pose, source settings, support members and assembly frame',()=>{
 const first=planRingBurner(state,options);first.objects.find(o=>o.id==='housing').transform.position=[4,5,6];
 const group=first.groups[0];group.objectIds.push('support');group.assembly.roles.support='collision';first.objects.push({id:'support',type:'glb',source:mesh.source,transform:pose});
 const next=planBurnerBodyReplacement(first,{groupId:'ring',oldBodyId:'housing',bodyId:'new-housing',mesh:{...mesh,source:'/api/read?root=generated-meshes&path=lance.glb'}});
 assert.deepEqual(next.objects.find(o=>o.id==='new-housing').transform.position,[4,5,6]);assert.deepEqual(next.objects.find(o=>o.id==='outlet'),first.objects.find(o=>o.id==='outlet'));
 assert.deepEqual(next.groups[0].transform,group.transform);assert.equal(next.groups[0].assembly.roles.support,'collision');assert.equal(next.groups[0].assembly.roles.housing,undefined);assert.equal(next.groups[0].assembly.roles['new-housing'],'body');assert.ok(!next.objects.some(o=>o.id==='housing'));
 const doc=buildSceneDocument({objects:next.objects,groups:next.groups,activeGroupId:'ring',composition:{schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:'vsp-'+'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}}}),restored=planSceneRestore(doc);
 assert.equal(restored.objects.find(o=>o.id==='new-housing').source,'/api/read?root=generated-meshes&path=lance.glb');assert.deepEqual(restored.groups[0].assembly,next.groups[0].assembly);
});
test('reusing the first mounted source is explicit and does not take a source from an existing assembly',()=>{
 const next=planRingBurner(state,{...options,outletId:template.id,reuseSource:true});assert.equal(next.objects.filter(o=>o.id===template.id).length,1);
 assert.throws(()=>planRingBurner({...state,groups:[{id:'other',objectIds:[template.id]}]},{...options,outletId:template.id,reuseSource:true}),/already.*group/i);
});
test('invalid or withheld body choices and identity collisions fail before changing membership',()=>{
 for(const mesh of [{...options.mesh,kind:'image'},{...options.mesh,source:''},{...options.mesh,visibility:{status:'withheld'}}])assert.throws(()=>planRingBurner(state,{...options,mesh}),/mesh|source|withheld/i);
 assert.throws(()=>planRingBurner(state,{...options,outletId:template.id}),/identity/i);
 const next=planRingBurner(state,options);assert.throws(()=>planBurnerBodyReplacement(next,{groupId:'ring',oldBodyId:'outlet',bodyId:'new',mesh}),/body/i);
});
