import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const a=html.indexOf(`function ${name}(`);assert.ok(a>=0);return html.slice(a,html.indexOf('\n}',a)+2);};
test('quality controls present grid, rays, adaptive and screen percentage together without duplicate aliases',()=>{
 const group=FLAME_PROPERTY_GROUPS.find(g=>g.name==='Quality');assert.ok(group,'quality belongs beside the simulation grid');
 assert.deepEqual(group.fields.map(([id])=>id),['volume-resolution','volume-steps','volume-adaptive-rays','volume-render-scale']);
 assert.equal(FLAME_PROPERTY_GROUPS.flatMap(g=>g.fields).filter(([id])=>id==='volume-resolution').length,1);
});
test('screen resolution has one exact full-range value rather than a hidden effective value and clipped slider',()=>{
 const control={value:'.3',dataset:{effectiveValue:'.3'}},ctx={document:{getElementById:id=>id==='volume-render-scale'?control:null}};vm.createContext(ctx);vm.runInContext(grab('readVolumeRenderScaleControlValue')+'\n'+grab('setVolumeRenderScaleControlValue'),ctx);
 ctx.setVolumeRenderScaleControlValue(.6554321);assert.equal(control.value,'0.6554321');assert.equal(ctx.readVolumeRenderScaleControlValue(),.6554321);
 control.value='.85';assert.equal(ctx.readVolumeRenderScaleControlValue(),.85,'normal slider changes own the value');
 ctx.setVolumeRenderScaleControlValue(1);assert.equal(control.value,'1');
});

import {flameControlDisplayValue,flameControlSourceValue} from '../flame-authoring.mjs';
test('screen percentage converts at the UI boundary while saved rendering keeps fractional scale',()=>{
 assert.equal(flameControlDisplayValue('volume-render-scale',.735),73.5);
 assert.equal(flameControlSourceValue('volume-render-scale',73.5),.735);
 assert.equal(flameControlDisplayValue('volume-steps',32),32);
 assert.equal(flameControlDisplayValue('volume-adaptive-rays',.45),.45);
});
