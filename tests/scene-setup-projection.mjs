// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument, planSceneRestore} from '../scene-persistence-core.js';
import {projectEmitterSetup} from '../scene-setup-projection.mjs';
const descriptor = value => ({value, rawValue: String(value)});
const make = (x = 0, fuel = 1, translation = [0, 0, 0]) => buildSceneDocument({
  objects: [{id: 'flame-emitter', type: 'flame-emitter', source: 'kaminos:analytic-flame',
    transform: {position: [x, -.76, 0], rotation: [0, 0, 0], scale: [1, 1, 1]}}],
  composition: {schema: 'kaminos.stationary-flame-composition.v1', flame: {presetId: `vsp-${'a'.repeat(64)}`, stationary: true}, lightGainStops: 0, route: {volume_light_field: '1'}},
  fireSettings: {domControls: {'volume-immersed-fuel': descriptor(fuel), 'volume-resolution': descriptor(32)}, rendererControls: {}, presentationControls: {}},
  flameDomainTranslation: translation, flameDomainScale: 1, flameDomainFollowSource: true,
});
test('selectively retain emission without moving source or domain, preserving unrelated state', () => {
  const baseline = make(), observed = make(.3, 2); baseline.custom = {retained: true};
  const result = projectEmitterSetup({baseline, observed, choices: {emission: true, placement: false, domain: false}});
  const plan = planSceneRestore(result.document);
  assert.equal(plan.fireSettings.domControls['volume-immersed-fuel'].value, 2);
  assert.equal(result.document.objects[0].transform.position[0], 0);
  assert.deepEqual(result.document.custom, {retained: true});
  assert.equal(baseline.objects[0].emission.settings['volume-immersed-fuel'].value, 1);
});
test('moving a source outside saved bounds requires an explicitly selected domain change', () => {
  const baseline = make(), observed = make(4, 2, [4, 0, 0]);
  assert.throws(() => projectEmitterSetup({baseline, observed, choices: {placement: true, domain: false}}), /domain/i);
  const result = projectEmitterSetup({baseline, observed, choices: {placement: true, domain: true, emission: false}});
  assert.deepEqual(planSceneRestore(result.document).flameDomainTranslation, [4, 0, 0]);
  assert.equal(result.document.objects[0].transform.position[0], 4);
  assert.equal(result.document.objects[0].emission.settings['volume-immersed-fuel'].value, 1);
});
test('domain retention only updates placement and follow behavior, preserving solver and material choices', () => {
  const baseline = make(), observed = make(.2, 2, [.2, 0, 0]);
  observed.objects.find(o => o.type === 'simulation-domain').simulation.settings['volume-resolution'] = descriptor(64);
  const result = projectEmitterSetup({baseline, observed, choices: {placement: true, domain: true}});
  assert.equal(planSceneRestore(result.document).fireSettings.domControls['volume-resolution'].value, 32);
});
test('absent source and conflicting identity fail visibly', () => {
  const baseline = make(), observed = make(); observed.objects[0].emission.domainId = 'other';
  assert.throws(() => projectEmitterSetup({baseline, observed, choices: {emission: true}}), /domain/i);
  baseline.objects = baseline.objects.filter(o => o.type !== 'flame-emitter');
  assert.throws(() => projectEmitterSetup({baseline, observed: make(), choices: {placement: true}}), /source|emitter/i);
});
test('pose-derived source controls follow retained placement when only emission is kept', () => {
  const baseline = make(), observed = make(.4, 2);
  for (const doc of [baseline, observed]) {
    const settings = doc.objects[0].emission.settings;
    settings['volume-emitter-source-law'] = descriptor('immersed-source');
    settings['volume-immersed-radius'] = descriptor(.2);
    for (const [key, value] of Object.entries({'centre-x':doc.objects[0].transform.position[0],'centre-y':-.76,'centre-z':0,yaw:0,pitch:90})) settings['volume-immersed-'+key] = descriptor(value);
  }
  const result = projectEmitterSetup({baseline, observed, choices:{emission:true,placement:false,domain:false}});
  assert.equal(result.document.objects[0].emission.settings['volume-immersed-centre-x'].value, 0);
});
test('fixed-domain source outside the box preserves suspended-injection placement',()=>{
 const baseline=make(),observed=make(0,2);
 for(const d of [baseline,observed]){d.objects.find(o=>o.type==='simulation-domain').simulation.followSource=false;d.objects.find(o=>o.type==='flame-emitter').transform.position[0]=4;}
 assert.doesNotThrow(()=>planSceneRestore(baseline));
 const next=projectEmitterSetup({baseline,observed,choices:{emission:true,placement:false,domain:false}}).document;
 assert.equal(planSceneRestore(next).fireSettings.domControls['volume-immersed-fuel'].value,2);
});
