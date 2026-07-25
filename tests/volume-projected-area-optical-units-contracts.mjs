import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as volumeCore from '../volume-core.js';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

function body(name, nextName) {
  const pattern = new RegExp(`(?:fn|function) ${name}\\b[^]*?(?=\\n(?:fn|function) ${nextName}\\b)`);
  const match = core.match(pattern)?.[0];
  assert.ok(match, `missing source body: ${name}`);
  return match;
}

assert.equal(
  typeof volumeCore.projectedNativeCellAreaScale,
  'function',
  'projected native-cell area helper is missing',
);

const perspective = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, -1,
  0, 0, -1, 0,
];
const nearScale = volumeCore.projectedNativeCellAreaScale({
  viewProjElements: perspective,
  world: [0, 0, -2],
  viewportWidth: 100,
  viewportHeight: 100,
  sourceSpacing: [1, 1, 1],
});
const farScale = volumeCore.projectedNativeCellAreaScale({
  viewProjElements: perspective,
  world: [0, 0, -4],
  viewportWidth: 100,
  viewportHeight: 100,
  sourceSpacing: [1, 1, 1],
});
assert.ok(Math.abs(nearScale - 625) < 1e-9, `near projected area drifted: ${nearScale}`);
assert.ok(Math.abs(farScale - 156.25) < 1e-9, `far projected area drifted: ${farScale}`);
assert.ok(Math.abs(nearScale / farScale - 4) < 1e-9, 'projected area must follow inverse-square perspective');

const anisotropicScale = volumeCore.projectedNativeCellAreaScale({
  viewProjElements: perspective,
  world: [0, 0, -2],
  viewportWidth: 100,
  viewportHeight: 100,
  sourceSpacing: [0.5, 1, 2],
});
assert.ok(
  Math.abs(anisotropicScale - 625 * (1 / (3.5 / 3))) < 1e-9,
  'native transverse area must be product(spacing) / mean(spacing)',
);

assert.match(
  core,
  /const BOUNDARY_SPLAT_PHYSICAL_OPTICAL_UNITS_IDENTITY = 'projected-native-cell-area-integral-normalized-v0';/,
  'physical optical-unit identity is missing',
);
assert.match(
  core,
  /const BOUNDARY_SPLAT_DIAGNOSTIC_OPTICAL_UNITS_IDENTITY = 'legacy-global-path-scale-diagnostic-v0';/,
  'legacy global scale is not explicitly diagnostic',
);
assert.match(
  core,
  /struct BoundarySplatCamera \{[^]*?opticalUnitControls: vec4<f32>,/,
  'camera uniforms do not carry source spacing and the effective optical-unit mode',
);
assert.match(
  core,
  /fn boundarySplatProjectedNativeCellAreaScale\([^]*?nativeTransverseArea[^]*?areaJacobian[^]*?return max\(0\.0, nativeTransverseArea \* areaJacobian\);/,
  'WGSL does not derive projected native-cell area from source spacing and the camera Jacobian',
);

const regularDepositor = body('boundarySplatOpticalFs', 'boundarySplatBilinearOpticalFs');
const bilinearDepositor = core.match(/fn boundarySplatBilinearOpticalFs\b[^]*?(?=\n}\n`;)/)?.[0];
assert.ok(bilinearDepositor, 'missing source body: boundarySplatBilinearOpticalFs');
const gaussianVertex = body('boundarySplatVs', 'boundarySplatBilinearTapOffset');
assert.match(
  gaussianVertex,
  /let persistentCohort = boundarySplatCamera\.instanceInfo\.w > 0\.5;/,
  'Gaussian deposition does not distinguish authenticated persistent-cohort rows',
);
assert.match(
  gaussianVertex,
  /if \(persistentCohort\) \{\s*ridgeOptical = splat\.colorOpacity;\s*nonRidgeOptical = splat\.ridgeNonRidgeOptical;\s*\}/,
  'Gaussian deposition does not preserve the persistent cohort coefficient packing',
);
assert.match(
  gaussianVertex,
  /out\.unionEnabled = select\(boundarySplatCamera\.unionControls\.x, 1\.0, persistentCohort\);/,
  'Gaussian covariance mode still controls persistent-cohort optical authority',
);
assert.match(
  gaussianVertex,
  /let gaussianMinorRadius = select\(splat\.shape\.y, splat\.shape\.x, persistentCohort\);/,
  'persistent-cohort Gaussian deposition leaks bilinear footprint scale into its round radius',
);
assert.match(
  gaussianVertex,
  /axisY \* corner\.y \* gaussianMinorRadius \* boundarySplatCamera\.controls\.x/,
  'persistent-cohort Gaussian deposition does not apply the round minor radius',
);
assert.match(
  core,
  /normalizationMechanism:\s*gaussianDeposition\s*\?\s*physicalOpticalUnits\s*\?\s*'per-splat-projected-gaussian-integral-divider-v0'\s*:\s*'legacy-unnormalized-gaussian-diagnostic-v0'/,
  'kernel receipt does not distinguish projected Gaussian normalization from the legacy diagnostic',
);
for (const [label, depositor] of [
  ['Gaussian', regularDepositor],
  ['bilinear', bilinearDepositor],
]) {
  assert.match(
    depositor,
    /sharedEmissionCoefficient \* opticalWeight/,
    `${label} deposition does not apply physical units to emission`,
  );
  assert.match(
    depositor,
    /sharedTotalExtinctionCoefficient \* opticalWeight/,
    `${label} deposition does not apply physical units to extinction`,
  );
}
assert.match(
  regularDepositor,
  /opticalWeight = in\.opticalUnitScale \* gaussian \/ max\(in\.projectedKernelIntegral, 1e-6\)/,
  'Gaussian deposition is not normalized by its effective projected kernel integral',
);
assert.doesNotMatch(
  regularDepositor,
  /if \(in\.unionEnabled > 0\.5\)/,
  'ordinary Gaussian splats cannot bypass coefficient-space physical units when union mode is off',
);
assert.doesNotMatch(
  regularDepositor,
  /in\.colorOpacity\.rgb \* alpha/,
  'ordinary Gaussian splats cannot fall back to premultiplied display color inside the optical recurrence',
);
assert.match(
  bilinearDepositor,
  /opticalWeight = in\.opticalUnitScale \* max\(in\.opticalDepositionWeight, 0\.0\)/,
  'bilinear deposition is not a normalized kernel weighted by projected native-cell area',
);

const beautyResolve = body(
  'boundarySplatOpticalPresentationFs',
  'boundarySplatOpticalDepthOrderDiagnosticFs',
);
const heldResolve = body(
  'fourArmHeldStateResolveFs',
  'fourArmResidualVs',
);
for (const [label, resolve] of [
  ['Beauty', beautyResolve],
  ['held-state linear HDR', heldResolve],
]) {
  assert.match(
    resolve,
    /let scaledEmission = accumulated\.rgb \* opticalPathScale\.requestedEffective\.y;/,
    `${label} diagnostic scale is not applied symmetrically to emission`,
  );
  assert.match(
    resolve,
    /let sourceScale = select\(1\.0, binAlpha \/ opticalDepth, opticalDepth > 1e-6\);/,
    `${label} resolve does not preserve the finite low-extinction emission limit`,
  );
  assert.match(
    resolve,
    /color = scaledEmission \* sourceScale \+ color \* \(1\.0 - binAlpha\);/,
    `${label} resolve does not use homogeneous emission/extinction transfer`,
  );
  assert.doesNotMatch(resolve, /let sourceColor = select/, `${label} still deletes low-extinction emission`);
}

assert.match(
  core,
  /function setBoundarySplatOpticalUnitMode\(value\)[^]*?requestedBoundarySplatOpticalUnitMode[^]*?effectiveBoundarySplatOpticalUnitMode/,
  'runtime lacks requested/effective optical-unit identity',
);
assert.match(
  core,
  /applicationIdentity: 'diagnostic-global-path-scale-or-physical-unity-v0'/,
  'global path scale still presents as production optical authority',
);
assert.match(
  core,
  /opticalUnits:\s*\{[^]*?requestedBoundarySplatOpticalUnitMode[^]*?effectiveBoundarySplatOpticalUnitMode[^]*?nativeTransverseArea[^]*?kernelNormalizationIdentity/,
  'operator receipt omits effective physical optical-unit and kernel-normalization identity',
);
assert.match(
  core,
  /async function sampleBoundarySplatOpticalUnitProbe\(options = \{\}\)/,
  'runtime lacks a same-state projected-area optical-unit probe',
);
assert.match(
  core,
  /emissionOnlyLinearLuma[^]*?extinctionOnlyMeanOpacity[^]*?combinedLinearLuma/,
  'optical-unit probe omits the component and combined linear statistics',
);
assert.match(
  core,
  /integralAuthority: 'analytical-construction-not-gpu-measured-v0'/,
  'kernel-integral receipt overstates analytical normalization as measured evidence',
);
assert.match(
  core,
  /requestedRoute: String\(options\.requestedRoute \|\| ''\)/,
  'optical-unit probe does not preserve its exact caller-requested route',
);
assert.match(
  core,
  /sampleBoundarySplatOpticalUnitProbe,/,
  'projected-area optical-unit probe is not exposed through the renderer API',
);
assert.match(
  core,
  /fullSupportSourceCandidateCount:\s*state\.boundarySplatInstanceCount/,
  'frozen canvas receipt does not report the source population used by its current draw',
);
assert.match(
  core,
  /fullSupportRasterDepositCount:\s*state\.fullSupportDepositionEffective === FULL_SUPPORT_BILINEAR_DEPOSITION_IDENTITY[^]*?state\.boundarySplatInstanceCount/,
  'frozen canvas receipt does not derive raster deposits from the current effective deposition path',
);

console.log('volume projected-area optical units contracts: passed');
