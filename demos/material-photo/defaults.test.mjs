import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_PRESET,superMatProductProfile} from './demo-defaults.js';
test('product profile degrades explicitly without shader-f16',()=>{
  assert.deepEqual(superMatProductProfile({features:new Set()}),{activations:'f32',fuseNorm:false,gemmPrecision:'f32',attention:'streaming'});
  assert.deepEqual(superMatProductProfile({features:new Set(['shader-f16'])}),{activations:'f16',fuseNorm:true,gemmPrecision:'f16-tiles',attention:'streaming'});
});
test('operator look preserves the chosen HDR, GI and manual contrast',()=>{
  assert.equal(DEFAULT_PRESET.environment,'warehouse');assert.equal(DEFAULT_PRESET.settings.gain,50);
  assert.equal(DEFAULT_PRESET.settings.screenSpaceSampling,true);assert.equal(DEFAULT_PRESET.lighting.rotation,146);
  assert.deepEqual(DEFAULT_PRESET.contrast,{mode:'manual',roughness:.49,metallic:.83});assert.equal(DEFAULT_PRESET.glow,false);
});
