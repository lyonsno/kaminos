import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const host = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function body(name, nextName) {
  const pattern = new RegExp(`(?:fn|function) ${name}\\b[^]*?(?=\\n(?:fn|function) ${nextName}\\b)`);
  const match = core.match(pattern)?.[0];
  assert.ok(match, `missing source body: ${name}`);
  return match;
}

const beautyResolve = body(
  'boundarySplatOpticalPresentationFs',
  'boundarySplatOpticalDepthOrderDiagnosticFs',
);
const heldResolve = body(
  'fourArmHeldStateResolveFs',
  'fourArmResidualVs',
);

for (const [label, resolve] of [
  ['beauty', beautyResolve],
  ['held-state linear HDR', heldResolve],
]) {
  assert.match(resolve, /let rawSigma = accumulated\.a;/, `${label} resolve must preserve raw extinction`);
  assert.match(
    resolve,
    /let scaledEmission = accumulated\.rgb \* opticalPathScale\.requestedEffective\.y;/,
    `${label} diagnostic scale must apply symmetrically to emission`,
  );
  assert.match(
    resolve,
    /let opticalDepth = rawSigma \* opticalPathScale\.requestedEffective\.y;/,
    `${label} diagnostic scale must apply symmetrically to extinction`,
  );
  assert.match(resolve, /let binAlpha = 1\.0 - exp\(-opticalDepth\);/, `${label} resolve must use exponential attenuation`);
  assert.match(
    resolve,
    /let sourceScale = select\(1\.0, binAlpha \/ opticalDepth, opticalDepth > 1e-6\);/,
    `${label} resolve must preserve the low-extinction emission limit`,
  );
  assert.match(
    resolve,
    /color = scaledEmission \* sourceScale \+ color \* \(1\.0 - binAlpha\);/,
    `${label} resolve must use homogeneous emission/extinction transfer`,
  );
}

assert.match(
  core,
  /struct OpticalPathScaleUniforms \{\s*requestedEffective: vec4<f32>,\s*\};/,
  'resolve shaders must bind one requested/effective optical path scale uniform',
);
assert.match(
  core,
  /function setOpticalPathScale\(value\)[^]*?optical-path-scale-invalid:[^]*?requestedOpticalPathScale[^]*?effectiveOpticalPathScale/,
  'diagnostic runtime setter must fail loud and publish requested/effective scale',
);
assert.match(core, /setOpticalPathScale,/, 'runtime API must expose the optical path scale setter');
assert.match(
  host,
  /params\.has\('volume_optical_path_scale'\)[^]*?setOpticalPathScale\?\.\(requestedOpticalPathScale\)/,
  'the live route must apply an explicit optical path scale request through the validated runtime setter',
);
assert.match(
  core,
  /opticalPathScale:\s*\{\s*requested:\s*requestedOpticalPathScale,\s*effective:\s*effectiveOpticalPathScale,[^]*?physicalAuthority:\s*false/,
  'live presentation receipt must expose the path scale as nonphysical diagnostic state',
);
assert.match(
  core,
  /sampleFourArmHeldStateLedger[^]*?requestedOpticalPathScale[^]*?effectiveOpticalPathScale/,
  'held-state readback receipt must expose requested/effective optical path scale',
);
assert.match(
  core,
  /sampleFourArmHeldStateLedger[^]*?readBoundarySplatOpticalPayloadReceipt\(\)[^]*?depositionPayload/,
  'held-state readback must bind each arm to an exact raw deposition payload hash',
);
assert.match(
  core,
  /linearHdrStatistics:\s*\{[^]*?meanLuma[^]*?maxRgb[^]*?meanOpticalDepth[^]*?meanTransmittance/,
  'held-state readback must publish pre-presentation linear HDR statistics',
);

const gaussianDepositor = body('boundarySplatOpticalFs', 'boundarySplatBilinearOpticalFs');
const bilinearDepositor = core.match(/fn boundarySplatBilinearOpticalFs\b[^]*?(?=\n}\n`;)/)?.[0];
assert.ok(bilinearDepositor, 'missing source body: boundarySplatBilinearOpticalFs');
assert.doesNotMatch(gaussianDepositor, /opticalPathScale/, 'Gaussian deposition cannot consume the diagnostic global path scale');
assert.doesNotMatch(bilinearDepositor, /opticalPathScale/, 'bilinear deposition cannot consume the diagnostic global path scale');
assert.match(gaussianDepositor, /in\.opticalUnitScale/, 'Gaussian deposition must consume physical projected-area units');
assert.match(bilinearDepositor, /in\.opticalUnitScale/, 'bilinear deposition must consume physical projected-area units');

console.log('volume optical path scale contracts: passed');
