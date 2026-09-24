#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const emitterBasis = readFileSync(new URL('../volume-emitter-basis.mjs', import.meta.url), 'utf8');

function assertDeadRenderClockRetired(source) {
  const updateUniforms = balancedWgslBlock(source, 'function updateUniforms(now)', {
    label: 'updateUniforms',
  });
  assert.doesNotMatch(
    source,
    /u\.cameraPos_time\.w/,
    'the product shader must not retain dead render-time authority',
  );
  assert.match(
    updateUniforms,
    /uniforms\[19\]\s*=\s*0\s*;/,
    'the camera time ABI component must upload explicit zero authority',
  );
  assert.match(
    updateUniforms,
    /uniforms\[47\]\s*=\s*0\s*;/,
    'the reserved render-control component must upload explicit zero authority',
  );
  assert.doesNotMatch(
    updateUniforms,
    /renderPhaseFrame\s*%/,
    'the product uniform route must not retain an unused repeating frame sawtooth',
  );
  assert.match(
    updateUniforms,
    /writeAnalyticEmitterInjectionUniform\([\s\S]*?renderPhaseTimeMs \* 0\.001,[\s\S]*?controlsSnapshot\.speed,[\s\S]*?\);/,
    'explicit analytic-emitter temporal descriptors retain their isolated render-time input',
  );
}

assertDeadRenderClockRetired(core);

assert.match(
  emitterBasis,
  /if \(temporal\.mode === 'steady'\) return 1;/,
  'analytic emitter temporal behavior remains default-steady and bypasses phase evaluation',
);
assert.match(
  emitterBasis,
  /const cycles = timestampMs \* 0\.001 \* temporal\.frequencyHz \+ temporal\.phase \/ \(Math\.PI \* 2\);[\s\S]*const phase01 = \(\(cycles % 1\) \+ 1\) % 1;[\s\S]*return phase01 < temporal\.dutyCycle \? 1 : 0;/,
  'the only retained time-cycle is the explicit caller-authored analytic-emitter pulse law',
);

const restoredShaderClock = core
  .replace('uniforms[19] = 0;', 'uniforms[19] = renderPhaseTimeMs * 0.001;')
  .replace(
    'let windStrength = clamp(u.scene_controls.y, 0.0, 1.5);',
    'let restoredTime = u.cameraPos_time.w;\n  let windStrength = clamp(u.scene_controls.y, 0.0, 1.5);',
  );
assert.throws(
  () => assertDeadRenderClockRetired(restoredShaderClock),
  /must not retain dead render-time authority/,
  'the retirement barrier rejects restored shader clock authority',
);

const restoredFrameSawtooth = core.replace(
  'uniforms[47] = 0;',
  'uniforms[47] = renderPhaseFrame % 4096;',
);
assert.throws(
  () => assertDeadRenderClockRetired(restoredFrameSawtooth),
  /must upload explicit zero authority|must not retain an unused repeating frame sawtooth/,
  'the retirement barrier rejects restoration of the unused repeating frame sawtooth',
);

console.log('volume dead render clock retirement contracts passed');
