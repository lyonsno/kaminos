// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {FLAME_PROPERTY_GROUPS, flameEmissionControlApplies} from '../flame-authoring.mjs';
import {volumeControlTooltip} from '../volume-control-descriptions.mjs';

const groupFor=id=>FLAME_PROPERTY_GROUPS.filter(g=>g.fields.some(([key])=>key===id));
test('soot production, removal and optics have one home',()=>{
  for(const id of ['volume-reactant-soot-yield','volume-physical-soot-burnout-rate',
    'volume-physical-soot-burnout-kelvin','volume-density','volume-physical-smoke-extinction','volume-physical-smoke-albedo']) {
    assert.deepEqual(groupFor(id).map(g=>g.name),['Soot'],id);
  }
});
test('temperature, emission, simulation and sampling are distinct without duplicate controls',()=>{
  for(const [id,name] of [['volume-physical-kelvin-per-heat','Temperature & cooling'],
    ['volume-reactant-cooling-time','Temperature & cooling'],['volume-physical-thermal','Emission & image'],
    ['volume-resolution','Domain & simulation'],['volume-steps','Ray marching']])
    assert.deepEqual(groupFor(id).map(g=>g.name),[name]);
  assert.equal(groupFor('volume-heat-release-expansion')[0].fields.find(([id])=>id==='volume-heat-release-expansion')[1],'Combustion expansion');
  const ids=FLAME_PROPERTY_GROUPS.flatMap(g=>g.fields.map(([id])=>id));
  assert.equal(ids.length,new Set(ids).size);
});
test('immersed sources expose supported common inlet perturbations and patterns',()=>{
  for(const id of ['volume-emitter-inlet-turbulence','volume-emitter-inlet-turbulence-scale',
    'volume-emitter-puff','volume-emitter-puff-period','volume-emitter-aperture-pattern',
    'volume-emitter-aperture-count','volume-emitter-aperture-seed','volume-emitter-line-weight','volume-emitter-jet-jitter']) {
    assert.equal(flameEmissionControlApplies(id,'immersed-source'),true,id);
    assert.equal(flameEmissionControlApplies(id,'inflow-boundary'),true,id);
  }
  assert.equal(flameEmissionControlApplies('volume-emitter-inlet-temperature','immersed-source'),false);
  assert.equal(flameEmissionControlApplies('volume-immersed-temperature','inflow-boundary'),false);
});
test('temperature explanation identifies conversion and its two consumers',()=>{
  const text=volumeControlTooltip('volume-physical-kelvin-per-heat');
  assert.match(text,/300/);assert.match(text,/stored heat/i);assert.match(text,/burnout/i);
  assert.match(text,/does not.*(add heat|buoyancy)/i);
});
