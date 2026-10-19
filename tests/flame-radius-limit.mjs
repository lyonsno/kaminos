// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {immersedControlsForFlamePose,immersedRadiusClamp,immersedRadiusBounds,defaultFlameEmitterPose} from '../scene-flame-emitter.mjs';
import {resolveImmersedSourceConfig} from '../volume-core.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('pose scaling preserves radii on both sides of the former upper bound',()=>{
 const pose={...defaultFlameEmitterPose(),scale:Array(3).fill(1.0000000000000002)};
 assert.equal(immersedControlsForFlamePose({immersedRadius:.5},pose).immersedRadius,.5*pose.scale[0]);
 assert.equal(immersedControlsForFlamePose({immersedRadius:.501},pose).immersedRadius,.501*pose.scale[0]);
});
// Operator, 2026-10-19: no upper radius cap; retain the positive numerical floor.
test('only the positive radius floor clamps; large finite radii remain exact',()=>{
 const pose=defaultFlameEmitterPose();
 assert.equal(immersedControlsForFlamePose({immersedRadius:.001},pose).immersedRadius,.02);
 assert.equal(immersedRadiusClamp({immersedRadius:.9},pose),null);
 assert.equal(immersedRadiusClamp({immersedRadius:.2},pose),null);
 assert.throws(()=>immersedControlsForFlamePose({immersedRadius:NaN},pose),/radius/);
});
test('large saved aperture survives pose conversion and reaches the actual source',()=>{
 const radius=135.764753512356,pose={...defaultFlameEmitterPose(),scale:[2,2,2]};
 const mapped=immersedControlsForFlamePose({immersedRadius:radius},pose);
 assert.equal(mapped.immersedRadius,radius*2);
 assert.equal(immersedRadiusBounds(pose).max,null,'no authored upper bound');
 const gas=resolveImmersedSourceConfig({...mapped,emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top'},{grid:32});
 assert.equal(gas.effective.admitted,true);
 assert.equal(gas.requested.radius,radius*2);
 assert.equal(gas.effective.radiusCells,radius*32);
});
test('saved radius expands the range before the browser can clamp it',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const fn=html.slice(html.indexOf('function applyVolumeRangeSavedValue(')).split('\n}')[0]+'\n}';
 const apply=vm.runInNewContext(fn+';applyVolumeRangeSavedValue',{window:{}});
 const input={id:'volume-immersed-radius',min:'.02',max:'.5',step:'any',
  set value(v){this.raw=String(Math.min(Number(this.max),Math.max(Number(this.min),Number(v))));},get value(){return this.raw;}};
 apply(input,135.764753512356);assert.equal(Number(input.value),135.764753512356);
 apply(input,200);assert.equal(Number(input.value),200);
});
