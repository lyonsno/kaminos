// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {FLAME_PROPERTY_GROUPS} from '../flame-authoring.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const a=html.indexOf(`function ${name}(`);assert.ok(a>=0);return html.slice(a,html.indexOf('\n}',a)+2);};
test('quality controls present grid, rays, adaptive and screen percentage together without duplicate aliases',()=>{
 const group=FLAME_PROPERTY_GROUPS.find(g=>g.name==='Quality');assert.ok(group,'quality belongs beside the simulation grid');
 for(const id of ['volume-resolution','volume-grid-height-ratio','volume-pressure-solver-iterations','volume-steps','volume-adaptive-rays','volume-render-scale'])assert.ok(group.fields.some(([field])=>field===id));
 for(const id of ['volume-resolution','volume-pressure-solver-iterations'])assert.equal(FLAME_PROPERTY_GROUPS.flatMap(g=>g.fields).filter(([field])=>field===id).length,1);
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

import * as flameControls from '../flame-authoring.mjs';
test('an unbounded radius retains its value and expands the slider extent',()=>{
 const source={min:'.02',max:'.5',value:'135.764753512356'};
 flameControls.syncFlameRangeBounds(source,{min:.01,max:null});
 assert.equal(source.value,'135.764753512356');
 assert.equal(source.max,'135.764753512356');
 assert.equal(source.min,'0.01');
 flameControls.syncFlameRangeBounds(source,{min:.02,max:null});
 assert.equal(source.max,'135.764753512356','resync does not shrink the authored extent');
});
test('scaled radius bounds use the observed native range representation so legal endpoint values pass validation',()=>{
 assert.equal(typeof flameControls.syncFlameRangeBounds,'function');
 // Chrome for Testing154, actual saved kiln at31dc332f, report.radius-before-lower.json:
 // a drag to exact min is serialized by the source range below its declared min.
 const observed=new Map([['0.004694268020840052','0.00469426802084005'],['0.11735670052100129','0.117356700521001']]);
 let clones=0;const source={min:'0.02',max:'0.5',value:'0.03234375',cloneNode(){clones++;return{min:'',max:'',step:'any',set value(v){this.raw=observed.get(v)||v;},get value(){return this.raw;}};}};
 const bounds={min:.004694268020840052,max:.11735670052100129};
 flameControls.syncFlameRangeBounds(source,bounds);
 assert.equal(source.min,observed.get(String(bounds.min)));assert.equal(source.max,observed.get(String(bounds.max)));
 assert.equal(source.value,'0.03234375','updating valid limits does not replace the authored radius');
 assert.ok(Number(observed.get(String(bounds.min)))>=Number(source.min));
 assert.ok(Number(observed.get(String(bounds.max)))<=Number(source.max));
 flameControls.syncFlameRangeBounds(source,bounds);assert.equal(clones,1,'unchanged limits need no repeated clone or native writes');
 flameControls.syncFlameRangeBounds(source,{min:.01,max:.25});assert.equal(source.min,'0.01');assert.equal(source.max,'0.25');
});

test('the authoring quality panel exposes the landed grid-height control',()=>{assert.ok(FLAME_PROPERTY_GROUPS.find(g=>g.name==='Quality').fields.some(([id])=>id==='volume-grid-height-ratio'),'height editing belongs in the authoring field inspector');});
