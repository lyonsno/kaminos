#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

assert.match(core, /BOUNDARY_SPLAT_COLOR_OPACITY_AUTHORITY\s*=\s*'survival-conditioned-color-opacity-grid-v0'/, 'runtime names the exact attribute-grid authority');
assert.match(core, /BOUNDARY_SPLAT_COLOR_OPACITY_APPLICATION_IDENTITY\s*=\s*'survival-fixed-color-opacity-override-v0'/, 'runtime names the render-only attribute application');
assert.match(core, /function boundarySplatColorOpacityBufferBytes\(grid\s*=\s*DEFAULT_GRID_SIZE\)[\s\S]*gridCellCount[\s\S]*4\s*\*\s*Float32Array\.BYTES_PER_ELEMENT/, 'attribute transport reserves four floats per receiver cell');
assert.match(core, /@group\(0\)\s*@binding\(8\)\s*var<storage,\s*read>\s*boundarySplatColorOpacityCue:\s*array<vec4<f32>>/, 'compaction receives color/opacity through an independent vec4 storage binding');
assert.match(core, /attributeOverrideControls:\s*vec4<f32>/, 'camera uniforms carry an independent attribute switch');
assert.match(core, /if\s*\(boundarySplatCamera\.attributeOverrideControls\.x\s*>\s*0\.5\)[\s\S]*composedColorOpacity\s*=\s*boundarySplatColorOpacityCue\[cellIndex\]/, 'enabled imported attributes override only the renderer-consumed color/opacity tuple');
assert.match(core, /binding:\s*8,\s*visibility:\s*GPUShaderStage\.COMPUTE,\s*buffer:\s*\{\s*type:\s*'read-only-storage'\s*\}/, 'compute layout declares the independent attribute binding');
assert.match(core, /beginDebugBoundarySplatColorOpacityImport/, 'runtime exposes a chunked color/opacity import begin phase');
assert.match(core, /writeDebugBoundarySplatColorOpacityImportChunk/, 'runtime exposes a chunked color/opacity import write phase');
assert.match(core, /finishDebugBoundarySplatColorOpacityImport/, 'runtime exposes a checksum-validating color/opacity import finish phase');
assert.match(core, /function boundarySplatColorOpacityAncestryStatus[\s\S]*fullFieldImportReceipt[\s\S]*scalarActivityCueImportReceipt[\s\S]*sourceFieldManifestSha256[\s\S]*survivalManifestSha256[\s\S]*survivalMaskSha256/, 'runtime binds imported attributes to the live full-field and survival receipts');
assert.match(core, /boundarySplatColorOpacityAncestryStatus\(upload\)[\s\S]*ancestry-mismatch/, 'runtime rechecks ancestry before applying uploaded values');
assert.match(core, /boundarySplatColorOpacityAncestryStatus\(\)[\s\S]*colorOpacityEnabled/, 'runtime requires live ancestry before enabling the shader override');
assert.match(core, /oracleActivitySplatColorOpacityRequested[\s\S]*oracleActivitySplatColorOpacityEffective[\s\S]*survival-fixed-color-opacity-override-v0/, 'frozen render receipt carries requested/effective attribute custody');

assert.match(exporter, /--boundary-splat-color-opacity-manifest/, 'exporter accepts the dedicated attribute manifest');
assert.match(exporter, /--boundary-splat-color-opacity-target-manifest/, 'exporter requires a caller-nominated checksum-valid high target');
assert.match(exporter, /kaminos\.volume\.boundary-splat-attribute-residual-probe\.v0/, 'exporter admits only the exact producer schema');
assert.match(exporter, /source-target-survival-bound-verified/, 'exporter requires source, target, and survival-bound checkpoint replay');
assert.match(exporter, /denseOutputByteParity/, 'exporter requires byte-exact dense checkpoint replay');
assert.match(exporter, /boundary splat color\/opacity source field mismatch/, 'exporter rejects attributes bound to another imported source field');
assert.match(exporter, /boundary splat color\/opacity survival binding mismatch/, 'exporter requires the exact survival manifest and mask used during training');
assert.match(exporter, /boundary splat color\/opacity values must be finite and inside channel ranges/, 'exporter rejects non-finite or out-of-range dense attributes before browser launch');
assert.match(exporter, /boundary-splat-color-opacity-gain-mismatch/, 'exporter fails loud when requested attributes are not effective');
assert.match(exporter, /main\(\)\s*\.then\(\(\) => process\.exit\(0\)\)/, 'completed exporter terminates after finally closes CDP resources');

const fixtureDir = await mkdtemp(join(tmpdir(), 'kaminos-color-opacity-render-contract-'));
const invalidManifestPath = join(fixtureDir, 'invalid-color-opacity.json');
const failurePath = join(fixtureDir, 'failure.json');
await writeFile(invalidManifestPath, `${JSON.stringify({
  schema: 'kaminos.volume.boundary-splat-attribute-residual-probe.v0',
  identity: 'survival-conditioned-exact-cell-color-opacity-residual-v0',
  status: 'captured',
  failurePhase: null,
  checkpoint: { replay: { status: 'unbound' } },
})}\n`);
const rejected = spawnSync(process.execPath, [
  new URL('../volume-full-grid-field-export.mjs', import.meta.url).pathname,
  '--boundary-splat-color-opacity-manifest', invalidManifestPath,
  '--manifest', failurePath,
  '--out-dir', fixtureDir,
], { encoding: 'utf8' });
assert.notEqual(rejected.status, 0, 'unbound attribute evidence must fail before browser launch');
const failure = JSON.parse(await readFile(failurePath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-capture-validation');
assert.match(failure.error, /color\/opacity checkpoint replay contract mismatch/);
assert.equal(failure.requestedBoundarySplatColorOpacityManifest, invalidManifestPath);

const fluidChannels = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];
const fluidPath = join(fixtureDir, 'initial-fluid.f32');
const frontPath = join(fixtureDir, 'initial-front.f32');
const fluidBytes = Buffer.alloc(16 * Float32Array.BYTES_PER_ELEMENT);
const frontBytes = Buffer.alloc(Float32Array.BYTES_PER_ELEMENT);
await writeFile(fluidPath, fluidBytes);
await writeFile(frontPath, frontBytes);
const initialManifestPath = join(fixtureDir, 'initial-field.json');
const initialManifest = {
  schema: 'kaminos.volume.coarse-receiver-initial.v0',
  status: 'captured',
  failurePhase: null,
  initializationAuthority: 'receiver-initialized-from-filtered-high-t-v0',
  filterIdentity: 'volume-overlap-box-filter-high-to-receiver-v0',
  layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
  receiver: {
    grid: 1,
    initialSimStepCount: 0,
    fluid: { path: fluidPath, sha256: sha256(fluidBytes), byteLength: fluidBytes.byteLength, shape: [1, 1, 1, 16], channelOrder: fluidChannels },
    front: { path: frontPath, sha256: sha256(frontBytes), byteLength: frontBytes.byteLength, shape: [1, 1, 1, 1], channelOrder: ['frontTopology'] },
  },
};
const initialBytes = Buffer.from(`${JSON.stringify(initialManifest)}\n`);
await writeFile(initialManifestPath, initialBytes);

const writeJsonFixture = async (name, value) => {
  const path = join(fixtureDir, name);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  await writeFile(path, bytes);
  return { path, bytes, sha256: sha256(bytes) };
};
const low = await writeJsonFixture('low-export.json', {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  initialFieldImport: { requested: { manifestSha256: sha256(initialBytes) } },
});
const wrongLow = await writeJsonFixture('wrong-low-export.json', {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  initialFieldImport: { requested: { manifestSha256: '0'.repeat(64) } },
});
const high = await writeJsonFixture('high-export.json', {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
});
const alternateHigh = await writeJsonFixture('alternate-high-export.json', {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  identity: 'checksum-valid-but-wrong-target-v0',
});
const maskPath = join(fixtureDir, 'survival-mask.f32');
const maskBytes = Buffer.from(new Float32Array([1]).buffer);
await writeFile(maskPath, maskBytes);
const survival = await writeJsonFixture('survival.json', {
  schema: 'kaminos.volume.boundary-splat-survival-probe.v0',
  status: 'captured',
  failurePhase: null,
  source: { lowManifest: { path: low.path, sha256: low.sha256 } },
  checkpoint: { replay: {
    status: 'source-target-bound-verified',
    sourceBindingParity: true,
    targetBindingParity: true,
    thresholdParity: true,
    probabilityParity: true,
    keepMaskParity: true,
    outputSha256: sha256(maskBytes),
  } },
  denseOutputs: { boundarySplatSurvivalMask: {
    path: maskPath,
    sha256: sha256(maskBytes),
    byteLength: maskBytes.byteLength,
    shape: [1, 1, 1, 1],
    channelOrder: ['boundarySplatSurvivalMask'],
    authority: 'validation-selected-candidate-survival-mask-v0',
    applicationIdentity: 'survival-only-remove-rejected-low-candidates-v0',
    candidateMutationPolicy: 'keep-or-remove only; no birth, move, or attribute mutation',
  } },
});
const validColorBytes = Buffer.from(new Float32Array([0.5, 0.25, 0.75, 0.04]).buffer);
const outOfRangeColorBytes = Buffer.from(new Float32Array([0.5, 0.25, 0.75, 0.081]).buffer);
const validColorPath = join(fixtureDir, 'color-opacity.f32');
const outOfRangeColorPath = join(fixtureDir, 'color-opacity-out-of-range.f32');
await writeFile(validColorPath, validColorBytes);
await writeFile(outOfRangeColorPath, outOfRangeColorBytes);

const colorManifest = ({
  lowBinding = low,
  highBinding = high,
  survivalManifestSha256 = survival.sha256,
  survivalMaskSha256 = sha256(maskBytes),
  colorPath = validColorPath,
  colorBytes = validColorBytes,
} = {}) => ({
  schema: 'kaminos.volume.boundary-splat-attribute-residual-probe.v0',
  identity: 'survival-conditioned-exact-cell-color-opacity-residual-v0',
  status: 'captured',
  failurePhase: null,
  source: {
    lowManifest: { path: lowBinding.path, sha256: lowBinding.sha256 },
    highManifest: { path: highBinding.path, sha256: highBinding.sha256 },
    survivalManifest: { path: survival.path, sha256: survivalManifestSha256 },
    survivalArtifact: { path: maskPath, sha256: survivalMaskSha256 },
  },
  checkpoint: {
    survivalBinding: {
      survivalManifestSha256,
      survivalMaskSha256,
      survivalAuthority: 'validation-selected-candidate-survival-mask-v0',
    },
    replay: {
      status: 'source-target-survival-bound-verified',
      sourceBindingParity: true,
      targetBindingParity: true,
      survivalBindingParity: true,
      contractParity: true,
      predictionParity: true,
      linearPredictionParity: true,
      denseOutputParity: true,
      denseOutputByteParity: true,
      outputSha256: sha256(colorBytes),
    },
  },
  denseOutputs: { colorOpacity: {
    path: colorPath,
    sha256: sha256(colorBytes),
    byteLength: colorBytes.byteLength,
    shape: [1, 1, 1, 4],
    channelOrder: ['color.r', 'color.g', 'color.b', 'opacity'],
    authority: 'survival-conditioned-color-opacity-grid-v0',
    applicationIdentity: 'survival-fixed-color-opacity-override-v0',
    nonSurvivorPolicy: 'zero',
    candidateMutationPolicy: 'attribute override only; no birth, movement, or simulator mutation',
  } },
});

const rejectFixture = async (name, manifest, expectedError) => {
  const attribute = await writeJsonFixture(`${name}.json`, manifest);
  const failureManifest = join(fixtureDir, `${name}-failure.json`);
  const result = spawnSync(process.execPath, [
    new URL('../volume-full-grid-field-export.mjs', import.meta.url).pathname,
    '--initial-field-manifest', initialManifestPath,
    '--advance-imported-steps', '0',
    '--render-only',
    '--render-png', join(fixtureDir, `${name}-must-not-render.png`),
    '--boundary-splat-survival-manifest', survival.path,
    '--boundary-splat-color-opacity-manifest', attribute.path,
    '--boundary-splat-color-opacity-target-manifest', high.path,
    '--manifest', failureManifest,
    '--out-dir', fixtureDir,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${name} evidence must fail before browser launch`);
  const receipt = JSON.parse(await readFile(failureManifest, 'utf8'));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.failurePhase, 'source-capture-validation');
  assert.match(receipt.error, expectedError);
};

await rejectFixture('wrong-source', colorManifest({ lowBinding: wrongLow }), /color\/opacity source field mismatch/);
await rejectFixture('wrong-target', colorManifest({ highBinding: alternateHigh }), /target manifest binding mismatch/);
await rejectFixture('wrong-survival-manifest', colorManifest({ survivalManifestSha256: '2'.repeat(64) }), /survival binding mismatch/);
await rejectFixture('wrong-survival-mask', colorManifest({ survivalMaskSha256: '3'.repeat(64) }), /survival binding mismatch/);
await rejectFixture('out-of-range-values', colorManifest({ colorPath: outOfRangeColorPath, colorBytes: outOfRangeColorBytes }), /values must be finite and inside channel ranges/);

console.log('boundary splat color opacity render contracts passed');
