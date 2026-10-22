import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const root = join(import.meta.dirname, '..');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');

function assertOccupancyRidgeContract(source) {
  const raymarchStart = source.indexOf('let expensiveSampleBudget =');
  assert.ok(raymarchStart >= 0, 'production raymarch budget is discoverable');
  const allRaymarch = balancedWgslBlock(source.slice(raymarchStart), 'loop {', { label: 'production raymarch loop' });
  // These two arms consume supported samples through their own transfer/trace
  // law. Remove only the complete, verified arms from the ordinary occupancy
  // analysis; an extra discard in any arm still fails its continuation count.
  const opticalStepArm = balancedWgslBlock(allRaymarch,
    'if (opticalStepping) {\n        opticalStepObserve', { label: 'optical transfer arm' });
  assert.match(opticalStepArm,
    /opticalStepObserveWithTolerance\(&opticalStep, vec4<f32>\(emission, sigma\), u\.reserved_render_controls\.y\);[\s\S]*color = opticalStep.transfer.xyz;[\s\S]*trans = opticalStep.transfer.w;[\s\S]*continue;/,
    'optical stepping composes the supported material before continuing');
  const opticalTraceArm = balancedWgslBlock(allRaymarch,
    'if (opticalTrace) {\n        let row =', { label: 'optical trace arm' });
  const channels = balancedWgslBlock(opticalTraceArm, 'for (var channel=0u; channel<3u; channel++) {');
  assert.match(channels, /nonRidgeOpticalCaptureRows\[base\+17u\+channel\]\s*=\s*select\(0\.0, medium\.emission\[channel\], supported\);/,
    'trace must record every emission coefficient');
  assert.match(channels, /nonRidgeOpticalCaptureRows\[base\+20u\+channel\]\s*=\s*select\(0\.0, scatteredSource\[channel\], supported\);/,
    'trace must record every scattered-source coefficient');
  assert.match(opticalTraceArm,
    /nonRidgeOpticalCaptureRows\[base\+16u\] = select\(0.0, sigma, supported\);[\s\S]*atomicAdd\(&nonRidgeOpticalCaptureHeader.rowCount, 1u\);[\s\S]*continue;/,
    'the trace arm publishes its supported-material row before continuing');
  for (const arm of [opticalStepArm, opticalTraceArm]) {
    assert.equal((arm.match(/\bcontinue\s*;/g) || []).length, 1,
      'each optical arm has one continuation after consumption');
  }
  const raymarch = allRaymarch.replace(opticalStepArm, '').replace(opticalTraceArm, '');
  const reconstructionStart = raymarch.indexOf('var reconstructed: FlowReconstructionSample;');
  assert.ok(reconstructionStart >= 0, 'supported-sample reconstruction boundary is discoverable');
  const emptyCellBranch = raymarch.match(
    /if \(!opticalStepping && !fullGridCapture && !opticalTrace && directSupport <= 0\.0001\) \{([^{}]*)\}/,
  );
  assert.ok(emptyCellBranch, 'conservative empty-cell branch has a stable non-nested boundary');
  const branchStart = emptyCellBranch.index;
  const branchEnd = branchStart + emptyCellBranch[0].length;
  assert.ok(branchEnd < reconstructionStart, 'empty-cell acceleration ends before supported-sample reconstruction');

  assert.match(
    raymarch,
    /let occupancySkipStrength = clamp\(u\.occupancy_controls\.x,[\s\S]*directSupport = raymarchNeighborhoodSupport\(neighborhood\);[\s\S]*directSupport = directCellOpticalSupport\(p\);/,
    'occupancy strength is available at the conservative empty-cell decision',
  );
  assert.match(
    emptyCellBranch[1],
    /directCellExitDistance\(p, rd\)[\s\S]*occupancySkipStrength[\s\S]*continue;/,
    'occupancy acceleration acts only inside a conservatively proven-empty cell',
  );
  assert.equal(
    (raymarch.match(/\bcontinue\s*;/g) || []).length,
    1,
    'the production raymarch has exactly one early continuation',
  );
  assert.doesNotMatch(
    raymarch.slice(branchEnd),
    /\bcontinue\s*;/,
    'supported reconstructed samples cannot take an early continuation before composition',
  );
  assert.match(
    raymarch.slice(reconstructionStart),
    /let extinctionStep =[\s\S]*trans = trans \* exp\(-extinctionStep\);[\s\S]*t = t \+ localDt;/,
    'supported reconstruction reaches optical evaluation, composition, and ordinary advancement',
  );
  assert.doesNotMatch(
    raymarch,
    /emptySpanScale[\s\S]*continue;/,
    'a reconstructed low-occupancy sample cannot be discarded before compositing',
  );
  assert.doesNotMatch(
    source,
    /fn occupancySkipStepScale\(/,
    'the retired low-support discard operator cannot remain as a second occupancy authority',
  );
}

assertOccupancyRidgeContract(core);

for (const write of [
  'nonRidgeOpticalCaptureRows[base+16u] = select(0.0, sigma, supported);',
  'nonRidgeOpticalCaptureRows[base+17u+channel] = select(0.0, medium.emission[channel], supported);',
  'nonRidgeOpticalCaptureRows[base+20u+channel] = select(0.0, scatteredSource[channel], supported);',
]) {
  const missingCoefficient = core.replace(write, '/* dropped coefficient write */');
  assert.notEqual(missingCoefficient, core, 'coefficient-loss mutation reaches the trace');
  assert.throws(() => assertOccupancyRidgeContract(missingCoefficient),
    /trace.*coefficient|trace arm/, 'trace continuation cannot omit a coefficient while retaining its completion counter');
}

assert.throws(() => assertOccupancyRidgeContract(core.replace(
  'opticalStepObserveWithTolerance(&opticalStep, vec4<f32>(emission, sigma), u.reserved_render_controls.y);', '/* dropped optical sample */')),
  /optical transfer|optical stepping|missing/, 'numerical continuation cannot silently discard the sample');
assert.throws(() => assertOccupancyRidgeContract(core.replace(
  'atomicAdd(&nonRidgeOpticalCaptureHeader.rowCount, 1u);\n        continue;', 'continue;')),
  /trace arm/, 'trace continuation cannot bypass its completion record');

const reconstructionAdvance = '    expensiveSamples = expensiveSamples + 1u;';
const renamedHelperMutation = core.replace(
  reconstructionAdvance,
  `${reconstructionAdvance}\n    if (!fullGridCapture && alternateLowSupportDiscard(reconstructed.material.x)) { continue; }`,
);
assert.notEqual(renamedHelperMutation, core, 'renamed-helper mutation fixture reaches the production loop');
assert.throws(
  () => assertOccupancyRidgeContract(renamedHelperMutation),
  /supported|continu|composition|occupancy/i,
  'a renamed post-reconstruction low-support discard must fail the occupancy contract',
);

assert.equal(
  [...core.matchAll(/occupancyAcceleration:\s*\{\s*identity:\s*['"]conservative-empty-native-support-cells-v1['"],\s*strength:\s*state\.occupancySkip,?\s*\}/g)].length,
  2,
  'success and failure receipts expose the empty-space-only semantic identity alongside the legacy state key',
);

const inlineDiscardMutation = core.replace(
  reconstructionAdvance,
  `${reconstructionAdvance}\n    if (!fullGridCapture && reconstructed.fireLayer.x < 0.0001) { continue; }`,
);
assert.notEqual(inlineDiscardMutation, core, 'inline-discard mutation fixture reaches the production loop');
assert.throws(
  () => assertOccupancyRidgeContract(inlineDiscardMutation),
  /supported|continu|composition|occupancy/i,
  'an inline post-reconstruction low-support discard must fail the occupancy contract',
);

const supportedSampleBranchMutation = core.replace(
  '    let extinction = rawExtinction + flameTransitionWisps * absorptionGain * 0.34;',
  '    if (!fullGridCapture && directSupport > 0.0001) { continue; }\n    let extinction = rawExtinction + flameTransitionWisps * absorptionGain * 0.34;',
);
assert.notEqual(supportedSampleBranchMutation, core, 'supported-sample mutation fixture reaches the production loop');
assert.throws(
  () => assertOccupancyRidgeContract(supportedSampleBranchMutation),
  /supported|continu|composition|occupancy/i,
  'an alternate supported-sample branch before composition must fail the occupancy contract',
);

console.log('volume occupancy skip: conservative empty cells accelerate without deleting supported ridge samples');
