// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as flame from '../flame-authoring.mjs';

test('the contextual inspector includes current appearance, structure, motion and raymarch controls once',()=>{
  const ids=flame.FLAME_PROPERTY_GROUPS.flatMap(group=>group.fields.map(([id])=>id));
  for(const id of ['volume-tone-mapping','volume-physical-kelvin-per-heat',
    'volume-physical-soot-burnout-rate','volume-physical-soot-burnout-kelvin','volume-physical-ambient',
    'volume-boundary-sidecar-ridge','volume-microdetail','volume-fire-licks',
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
  assert.deepEqual(flame.FLAME_INSPECTOR_VIEWS?.map(view=>view.id),['look','motion','quality']);
  for(const id of ['volume-flow-kernel-strength','volume-flow-kernel-radius','volume-flow-kernel-coherence'])assert.equal(flame.FLAME_PROPERTY_GROUPS.some(group=>group.fields.some(([key])=>key===id)),false);
  for(const group of flame.FLAME_PROPERTY_GROUPS){
    assert.ok(group.scope==='emitter'||flame.FLAME_INSPECTOR_VIEWS.some(view=>view.id===group.view));
  }
  const emission=flame.FLAME_PROPERTY_GROUPS.find(group=>group.scope==='emitter');
  assert.ok(emission.fields.some(([id])=>id==='volume-immersed-fuel'));
});

test('applicability respects source law, AgX and effective physics without changing stored values',()=>{
  assert.equal(typeof flame.flamePropertyApplies,'function');
  const mode={sourceLaw:'immersed-source',toneMapping:'agx',physicsActive:false};
  assert.equal(flame.flamePropertyApplies('volume-physical-knee',mode),false);
  assert.equal(flame.flamePropertyApplies('volume-physical-knee',{...mode,toneMapping:'custom'}),true);
  // Physics is the material law: its calibration applies without a law select.
  assert.equal(flame.flamePropertyApplies('volume-physical-kelvin-per-heat',mode),true);
  assert.equal(flame.flamePropertyApplies('volume-physical-kelvin-per-heat',{...mode,physicsActive:true}),true);
  assert.equal(flame.flamePropertyApplies('volume-density',{...mode,physicsActive:true}),true);
  assert.equal(flame.flamePropertyApplies('volume-wind-gust-period',mode),true);
  for(const id of ['volume-boundary-sidecar-source','volume-boundary-sidecar-width','volume-boundary-sidecar-blur','volume-boundary-sidecar-ridge']) {
    assert.equal(flame.flamePropertyApplies(id,{...mode,supportActive:false}),false);
    assert.equal(flame.flamePropertyApplies(id,{...mode,supportActive:true}),true);
  }
  assert.deepEqual(mode,{sourceLaw:'immersed-source',toneMapping:'agx',physicsActive:false});
});

test('binary numerical sources become checkboxes without converting continuous amounts into switches',()=>{
  assert.equal(typeof flame.flamePropertyInputType,'function');
  assert.equal(flame.flamePropertyInputType({type:'range',min:'0',max:'1',step:'1'}),'checkbox');
  assert.equal(flame.flamePropertyInputType({type:'range',min:'0',max:'1',step:'.05'}),'number');
  assert.equal(flame.flamePropertyInputType({type:'range',min:'0',max:'1.5',step:'.05'}),'number');
  assert.equal(flame.flamePropertyInputType({type:'color'}),'color');
});

test('physics material status cannot promote a requested or stale mode into effective rendering',()=>{
  assert.equal(typeof flame.flameAppearanceStatus,'function');
  assert.equal(flame.flameAppearanceStatus(null).state,'pending');
  assert.equal(flame.flameAppearanceStatus(null).state,'pending');
  assert.equal(flame.flameAppearanceStatus({requested:false,effective:{render:true}}).state,'pending');
  const refused=flame.flameAppearanceStatus({requested:true,effective:{render:false},reason:'physics-appearance-requires-the-reactant-law'});
  assert.equal(refused.state,'inactive');assert.match(refused.text,/requires the reactant law/);
  assert.equal(flame.flameAppearanceStatus({requested:true,effective:{render:true}}).state,'active');
});
