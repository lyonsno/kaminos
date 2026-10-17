// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
import {resolveBoundarySplatExecutionPlan} from '../volume-core.js';
import {OPTICAL_STEPPING_WGSL} from '../volume-optical-native.mjs';
import {RAY_START_WGSL} from '../volume-ray-start.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('Quality offers saved animation and flame guidance, preserving older basins',()=>{
 const fields=FLAME_PROPERTY_GROUPS.find(g=>g.name==='Quality').fields;
 const schema=JSON.parse(readFileSync(new URL('../volume-settings-preset-schema-v2.json',import.meta.url)));
 for(const [id,value] of [['volume-ray-noise-animated',false],['volume-flame-priority',0]]){
  assert.equal(fields.filter(([key])=>key===id).length,1,id);
  assert.equal(schema.rendererControls.find(c=>c.key===id)?.additiveDefault,value);
 }
});
test('noise stays available on every marcher; priority leaves both controls unmodified',()=>{
 const lines=html.split('\n').filter(l=>l.includes('.disabled=')&&l.includes('c.raymarchMode'));
 const ids=['volume-adaptive-rays','volume-occupancy-skip','volume-ray-start-noise','volume-optical-tolerance','volume-flame-priority'];
 for(const mode of ['current','fixed','numerical']){
  const nodes=Object.fromEntries(ids.map(id=>[id,{disabled:false}]));
  vm.runInNewContext(lines.join('\n'),{c:{raymarchMode:mode},document:{getElementById:id=>nodes[id]}});
  assert.equal(nodes['volume-ray-start-noise'].disabled,false,mode+' must allow blue noise');
  assert.equal(nodes['volume-flame-priority'].disabled,mode!=='numerical');
 }
});
test('priority requests fresh sidecar coverage even when appearance uses live support',()=>{
 const base={boundarySplatMode:'off',boundarySidecarSource:'live',renderComposition:'raymarch'};
 assert.equal(resolveBoundarySplatExecutionPlan({...base,flamePriority:0}).sidecarDispatch,false);
 const guided=resolveBoundarySplatExecutionPlan({...base,flamePriority:1,raymarchMode:'numerical'});
 assert.equal(guided.sidecarDispatch,true);
 assert.equal(guided.sidecarConsumer,'flame-guidance');
 for(const raymarchMode of ['current','fixed'])assert.equal(resolveBoundarySplatExecutionPlan({...base,flamePriority:1,raymarchMode}).sidecarDispatch,false);
});
test('phasing retains the optical entry and constraining cannot discard retained probes',()=>{
 assert.match(OPTICAL_STEPPING_WGSL,/fn opticalStepInitPhased\(/);
 assert.match(OPTICAL_STEPPING_WGSL,/fn opticalStepConstrain\(/);
 assert.match(OPTICAL_STEPPING_WGSL,/\(\*s\)\.mask > 1u/);
 assert.match(RAY_START_WGSL,/fn rayStartPhaseAtFrame\(/);
});
