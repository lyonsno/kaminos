// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as flame from '../flame-authoring.mjs';

test('the contextual inspector includes current appearance, structure, motion and raymarch controls once',()=>{
  const ids=flame.FLAME_PROPERTY_GROUPS.flatMap(group=>group.fields.map(([id])=>id));
  for(const id of ['volume-tone-mapping','volume-physical-material-law','volume-physical-kelvin-per-heat',
    'volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin','volume-physical-ambient',
    'volume-reaction-boundary-fire-ridge','volume-reaction-boundary-fire-clean-color','volume-reaction-boundary-support-interface',
    'volume-reaction-boundary-softness','volume-boundary-sidecar-ridge','volume-microdetail','volume-fire-licks',
    'volume-wind-model','volume-wind-gust-period','volume-reactant-mixing-time','volume-reactant-cooling-time',
    'volume-heat-release-expansion','volume-ray-start-noise','volume-occupancy-skip',
    'volume-emitter-fuel-fraction','volume-emitter-aperture-pattern','volume-emitter-inlet-turbulence']){
    assert.equal(ids.filter(value=>value===id).length,1,`active control ${id} has one contextual alias`);
  }
  assert.equal(new Set(ids).size,ids.length);
  const schema=JSON.parse(fs.readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
  const supported=new Set([...schema.controls,...schema.rendererControls].map(entry=>entry.key));
  for(const id of ids)assert.ok(supported.has(id),`no invented source control ${id}`);
  assert.ok(!ids.some(id=>id.startsWith('volume-pyro-')||id==='volume-emitter-aperture-ratio'),'retired appearance and aperture experiments stay out');
});

test('field views partition controls while keeping source supply on the selected emitter',()=>{
  assert.deepEqual(flame.FLAME_INSPECTOR_VIEWS?.map(view=>view.id),['look','shape','motion','quality']);
  for(const group of flame.FLAME_PROPERTY_GROUPS){
    assert.ok(group.name==='Emission'||flame.FLAME_INSPECTOR_VIEWS.some(view=>view.id===group.view));
  }
  const emission=flame.FLAME_PROPERTY_GROUPS.find(group=>group.name==='Emission');
  assert.ok(emission.fields.some(([id])=>id==='volume-immersed-fuel'));
});

test('applicability respects source law, AgX and effective physics without changing stored values',()=>{
  assert.equal(typeof flame.flamePropertyApplies,'function');
  const mode={sourceLaw:'immersed-source',toneMapping:'agx',physicsActive:false,materialLaw:'1'};
  assert.equal(flame.flamePropertyApplies('volume-physical-knee',mode),false);
  assert.equal(flame.flamePropertyApplies('volume-physical-knee',{...mode,toneMapping:'custom'}),true);
  assert.equal(flame.flamePropertyApplies('volume-physical-temperature',mode),true);
  assert.equal(flame.flamePropertyApplies('volume-reaction-boundary-fire-ridge',mode),true);
  assert.equal(flame.flamePropertyApplies('volume-reaction-boundary-fire-ridge',{...mode,physicsActive:true,materialLaw:'2'}),false);
  assert.equal(flame.flamePropertyApplies('volume-physical-kelvin-per-heat',{...mode,materialLaw:'2'}),true);
  assert.equal(flame.flamePropertyApplies('volume-physical-kelvin-per-heat',mode),false);
  assert.equal(flame.flamePropertyApplies('volume-density',{...mode,physicsActive:true}),true);
  assert.equal(flame.flamePropertyApplies('volume-wind-gust-period',mode),true);
  assert.deepEqual(mode,{sourceLaw:'immersed-source',toneMapping:'agx',physicsActive:false,materialLaw:'1'});
});
