#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../volume-live-nonridge-union-witness.mjs', import.meta.url), 'utf8');

assert.match(
  core,
  /NONRIDGE_LIVE_SELECTOR_AUTHORITY\s*=\s*'explicit-source-field-operator-v0'/,
  'live union must name Vivisector selector authority exactly',
);
assert.match(
  core,
  /NONRIDGE_LIVE_SELECTOR_RECIPE_SHA256\s*=\s*'541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9'/,
  'live union must bind the exact reviewed selector recipe',
);
assert.match(
  core,
  /BOUNDARY_SPLAT_LIVE_UNION_COMPOSITION_IDENTITY\s*=\s*'separate-ridge-nonridge-shared-total-extinction-v0'/,
  'live union must expose the requested optical composition identity',
);
assert.match(
  page,
  /<option value="kernel_moment_full_flame_union">kernel moment full flame union<\/option>/,
  'cockpit must request the union explicitly instead of silently changing the covariance mode',
);

const compactor = core.match(/fn compactBoundarySplats[\s\S]*?(?=\n@compute @workgroup_size\(1\)\nfn finalizeBoundarySplats)/)?.[0] || '';
assert.match(
  compactor,
  /step\(0\.000001,\s*boundarySplatCamera\.unionControls\.y\)[\s\S]*clamp\(admissionFireSignal \/ 1\.5,\s*0\.0,\s*1\.0\)[\s\S]*smoothstep\(0\.00392156862745098,\s*0\.011764705882352941/,
  'GPU compactor must apply the exact gradient-gated bounded monotone selector',
);
for (const token of ['ridgeAdmitted', 'nonRidgeAdmitted', 'ridgeOnlyCount', 'nonRidgeOnlyCount', 'overlapCount', 'unionCount']) {
  assert.match(compactor, new RegExp(token), `compactor must preserve ${token} union telemetry`);
}
assert.match(
  compactor,
  /if \(!ridgeAdmitted && !nonRidgeAdmitted\) \{ return; \}[\s\S]*candidateCount/,
  'candidate append must be the uncapped Ridge/Non-Ridge union rather than Ridge-only admission',
);
assert.match(
  core,
  /positionCell = vec4<f32>\(world, f32\(cellIndex\)\)/,
  'each union candidate must retain its stable native-cell identity',
);
assert.match(
  core,
  /nativeCellMembership = vec4<f32>\([\s\S]*f32\(cellIndex\)[\s\S]*ridgeAdmitted[\s\S]*nonRidgeAdmitted[\s\S]*nonRidgeScore/,
  'live union candidates must carry stable native-cell ids and explicit membership without imported-field custody',
);
assert.match(core, /BOUNDARY_SPLAT_CANDIDATE_STRIDE_BYTES = 96/, 'candidate ABI must reserve the live identity row');
assert.match(core, /BOUNDARY_SPLAT_DRAW_STATE_BYTES = 80/, 'draw-state ABI must include every union telemetry atomic and WGSL tail padding');
for (const token of ['stableNativeCellIdSha256', 'stateWitnessSha256', 'controlSha256', 'decodedMembershipCounts']) {
  assert.match(core, new RegExp(token), `uncapped live witness must expose ${token}`);
}
assert.match(core, /channelMax/, 'uncapped live witness must diagnose candidate color, opacity, radius, and optical coefficients');
for (const token of ['descriptorFrameMetrics', 'projectionMetrics', 'centerInFrustumCount']) {
  assert.match(core, new RegExp(token), `uncapped live witness must expose ${token}`);
}
for (const token of ['ridgeEmissionCoefficient', 'nonRidgeEmissionCoefficient', 'ridgeExtinctionCoefficient', 'nonRidgeExtinctionCoefficient', 'sharedTotalExtinctionCoefficient']) {
  assert.match(core, new RegExp(token), `splat raster must retain ${token}`);
}
assert.match(
  core,
  /zeroGradientAdmissionCount/,
  'telemetry must expose an independent zero-gradient black-control falsifier',
);
for (const token of [
  'kernel_moment_full_flame_union',
  'explicit-source-field-operator-v0',
  'stableNativeCellIdSha256',
  'zeroGradientFalsifier',
  'failurePhase',
  'lastTrustworthyEvidence',
  'boundarySplatOverflowCount',
  'boundarySplatFallbackReason',
  'native-3d-compute-fluid-raymarch-v0',
  'flowKernelStrength: 1',
  'boundarySplatRadianceGain: 2',
  'operator-visible-cdp-canvas-screenshot-pixels-v0',
]) {
  assert.match(witness, new RegExp(token), `browser witness must preserve ${token}`);
}

const {
  classifyBoundarySplatUnionCell,
  composeBoundarySplatOpticalLayers,
} = await import('../volume-core.js');

const exactMidpoint = classifyBoundarySplatUnionCell({
  gradientGain: 1,
  fireEnergy: 0.00784313725490196 * 1.5 / 1.25,
  fireEmission: 0,
  fireDetail: 0,
  microZ: 0,
  materialHeat: 0,
  structuralSignal: 0,
});
assert.equal(exactMidpoint.nonRidgeAdmitted, true, 'selector midpoint must meet the reviewed 0.5 admission threshold');
assert.equal(exactMidpoint.ridgeAdmitted, false);
assert.equal(exactMidpoint.membership, 'nonridge-only');

const blackControl = classifyBoundarySplatUnionCell({
  gradientGain: 0,
  fireEnergy: 1,
  fireEmission: 1,
  fireDetail: 1,
  microZ: 1,
  materialHeat: 1,
  structuralSignal: 0,
});
assert.equal(blackControl.nonRidgeScore, 0);
assert.equal(blackControl.admitted, false, 'zero-gradient black control must veto even populated fire source fields');

const optical = composeBoundarySplatOpticalLayers({
  emission: [0.8, 0.4, 0.2],
  extinction: 0.6,
  ridgeOwnershipWeight: 0.25,
});
assert.deepEqual(optical.ridge.emission, [0.2, 0.1, 0.05]);
optical.nonRidge.emission.forEach((value, index) => assert.ok(Math.abs(value - [0.6, 0.3, 0.15][index]) < 1e-12));
assert.equal(optical.ridge.extinction, 0.15);
assert.ok(Math.abs(optical.nonRidge.extinction - 0.45) < 1e-12);
assert.equal(optical.sharedTotalExtinction, 0.6);
optical.recomposedEmission.forEach((value, index) => assert.ok(Math.abs(value - [0.8, 0.4, 0.2][index]) < 1e-12));

console.log('boundary splat live Non-Ridge union contracts passed');
