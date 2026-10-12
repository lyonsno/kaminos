import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
const source={id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]}};
const descriptor=value=>({value,rawValue:String(value)});
const settings={domControls:{'volume-immersed-fuel':descriptor(.7131234567),'volume-physical-temperature':descriptor(2851.856),'volume-resolution':descriptor(32),'future-transport':{value:{a:7}}},rendererControls:{'volume-steps':descriptor(24)},presentationControls:{'raymarch-smoke-presentation':{value:'on'}}};
function save(objects=[source]){return buildSceneDocument({objects,composition,fireSettings:settings,flameDomainTranslation:[.2,-.5,0],flameDomainScale:1.5,flameDomainFollowSource:false});}
test('saved fire has explicit source, domain, material and scene-render ownership, preserving exact descriptors',()=>{
 const doc=save(),domain=doc.objects.find(o=>o.type==='simulation-domain');
 assert.ok(domain,'fire domain must be an authored object');
 assert.equal(doc.version,9);
 assert.equal(doc.objects.find(o=>o.id===source.id).emission.domainId,domain.id);
 assert.deepEqual(domain.transform.position,[.2,1,0]);
 assert.equal(doc.flameDomainTranslation,undefined,'no competing top-level domain authority');
 assert.equal(domain.simulation.settings['volume-resolution'].value,32);
 assert.equal(domain.volumeMaterial.settings['volume-physical-temperature'].value,2851.856);
 assert.equal(doc.objects.find(o=>o.id===source.id).emission.settings['volume-immersed-fuel'].value,.7131234567);
 const plan=planSceneRestore(doc);
 assert.deepEqual(plan.fireSettings,settings);
 assert.deepEqual(plan.flameDomainTranslation,[.2,-.5,0]);
 assert.equal(plan.flameDomainScale,1.5);
 assert.ok(plan.authoredObjects.some(o=>o.id===domain.id));
});
test('source removal keeps field and re-add template, without losing settings',()=>{
 const doc=save([]);assert.ok(doc.objects.some(o=>o.type==='simulation-domain'));
 assert.equal(planSceneRestore(doc).flameSourcePresent,false);
 assert.deepEqual(planSceneRestore(doc).fireSettings,settings);
});
test('conflicting domain identity and unsupported multiplicity fail before restore',()=>{
 const doc=save();doc.objects.push({...structuredClone(doc.objects.find(o=>o.type==='simulation-domain')),id:'other-domain'});
 assert.throws(()=>planSceneRestore(doc),/one.*domain|multiple.*domain|Unsupported fire domain identity/i);
 const bad=save();bad.objects.find(o=>o.id===source.id).emission.domainId='missing';
 assert.throws(()=>planSceneRestore(bad),/domain.*reference/i);
});
test('ray budget and render scale are scene rendering data rather than simulation coefficients',()=>{
 const values=structuredClone(settings);values.domControls['volume-steps']=descriptor(24);values.domControls['volume-render-scale']=descriptor(.5);
 const doc=buildSceneDocument({objects:[source],composition,fireSettings:values});
 assert.equal(doc.fireRendering.domControls?.['volume-steps']?.value,24);
 assert.equal(doc.objects.find(o=>o.type==='simulation-domain').simulation.settings['volume-steps'],undefined);
 assert.deepEqual(planSceneRestore(doc).fireSettings,values);
});
