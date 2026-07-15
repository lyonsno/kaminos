#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const corePath = join(root, 'volume-core.js');
const exporterPath = join(root, 'volume-full-grid-field-export.mjs');

assert.ok(existsSync(exporterPath), 'full-grid field export harness exists on the learned-splat integration branch');

const core = readFileSync(corePath, 'utf8');
const exporter = readFileSync(exporterPath, 'utf8');

assert.match(core, /beginDebugFullFieldExport/, 'volume prototype exposes full-field export begin custody');
assert.match(core, /readDebugFullFieldExportChunk/, 'volume prototype exposes uncapped chunked full-field export reads');
assert.match(core, /releaseDebugFullFieldExport/, 'volume prototype exposes explicit full-field export release custody');
assert.match(core, /boundaryDescriptor/, 'full-field export includes the live boundary sidecar');
assert.match(core, /materializeFullFieldDerivedBuffersForDebugExport/, 'full-field export rebuilds derived sidecar and splat buffers from the frozen field');
assert.match(core, /boundarySplatDescriptor/, 'full-field export includes the effective compact learned-splat output');
assert.match(core, /beginDebugScalarActivityCueImport/, 'volume prototype exposes chunked scalar activity cue import custody');
assert.match(core, /writeDebugScalarActivityCueImportChunk/, 'scalar activity cue import accepts sequential checksum-bound chunks');
assert.match(core, /finishDebugScalarActivityCueImport/, 'scalar activity cue import validates and publishes the complete field');
assert.match(core, /learned-fire-flow-visibility-carrier-v0/, 'scalar cue receiver distinguishes learned fire carrier authority from truth oracle authority');
assert.match(core, /validation-selected-residual-gate-derived-carrier-v0/, 'scalar cue receiver admits the validation-calibrated carrier authority');
assert.match(core, /frozen-earlier-replay-constant-residual-scale-derived-carrier-v0/, 'scalar cue runtime admits the frozen fixed-gain carrier authority validated by the exporter');
assert.match(core, /\['splat-only-v0', 'raymarch-under-splats-v0', 'raymarch-only-v0'\]/, 'frozen renderer admits an explicit raymarch-only carrier display');
assert.match(core, /scalar-activity-cue-isolated-raymarch-display-v0/, 'scalar cue display identifies its isolated cue-opacity projection');
assert.match(core, /alpha\s*=\s*mix\(alpha,\s*oracleDisplayAlpha,\s*oracleDisplay\)/, 'isolated scalar cue display replaces unrelated smoke opacity with cue-controlled opacity');
assert.match(
  core,
  /deterministicReplay:\s*replaySample\s*\?\s*\{[\s\S]*identity:\s*replaySample\.identity[\s\S]*completedSteps:\s*replaySample\.completedSteps/,
  'full-field export records the effective top-level deterministic replay receipt rather than a nonexistent nested field',
);

assert.match(exporter, /--source-capture/, 'exporter accepts an operator exact-tab source capture');
assert.match(exporter, /--target-origin/, 'exporter can rebind the captured route to a caller-owned server origin');
assert.match(exporter, /--render-composition/, 'exporter accepts an invocation-scoped frozen render composition');
assert.match(exporter, /raymarch-only-v0/, 'exporter admits a raymarch-only carrier display without silently requesting splats');
assert.match(exporter, /--render-control-overrides-json/, 'exporter accepts structured invocation-scoped render controls');
assert.match(exporter, /--scalar-activity-cue-manifest/, 'exporter accepts a checksum-addressed derived carrier manifest');
assert.match(exporter, /--scalar-activity-cue-role/, 'exporter requires an explicit semantic carrier role');
assert.match(exporter, /scalarActivityCueImport/, 'render receipt preserves effective scalar activity cue import authority');
assert.match(exporter, /validation-selected-residual-gate-derived-carrier-v0/, 'exporter admits the validation-calibrated dense carrier role');
assert.match(exporter, /kaminos\.volume\.fire-flow-carrier-frozen-transfer\.v0/, 'exporter admits the checksum-bound frozen transfer schema');
assert.match(exporter, /kaminos\.volume\.fire-flow-carrier-composition\.v0/, 'exporter explicitly admits the held fireLick composition schema');
assert.match(exporter, /frozen-fire-flow-carrier-fire-lick-composition-v0/, 'exporter binds the fireLick composition authority');
assert.match(exporter, /frozen-earlier-replay-constant-residual-scale-derived-carrier-v0/, 'exporter admits the frozen fixed-gain carrier authority');
assert.match(exporter, /targetDataUsedForTraining/, 'exporter validates target-blind transfer authority before import');
assert.match(exporter, /JSON\.parse\(String\(args\.get\('--render-control-overrides-json'\)/, 'render control overrides use structured JSON parsing instead of ad hoc text splitting');
assert.match(
  exporter,
  /Object\.hasOwn\(renderControlOverrides,\s*'oracleActivityDisplay'\)[\s\S]*?renderControlOverrides\.oracleActivityDisplay[\s\S]*?:\s*1/,
  'an explicit scalar cue display override, including zero for beauty and flow-debug witnesses, wins over the isolated-cue default',
);
assert.match(
  exporter,
  /oracleActivityFireDetailRequested[\s\S]*?oracleActivityFireDetailEffective[\s\S]*?scalar-activity-fire-detail-gain-mismatch/,
  'scalar-cue witnesses fail loud unless the requested signed fire-detail gain is the effective bounded gain',
);
assert.match(
  exporter,
  /oracleActivitySplatOpacityRequested[\s\S]*?oracleActivitySplatOpacityEffective[\s\S]*?scalar-activity-splat-opacity-gain-mismatch/,
  'scalar-cue witnesses fail loud unless the requested signed learned-splat opacity gain is the effective bounded gain',
);
assert.match(
  exporter,
  /oracleActivitySplatRadiusConcentration[\s\S]*?outside \[-2, 2\][\s\S]*?splat-radius concentration assay requires a splat render composition/,
  'scalar-cue radius witnesses reject out-of-range gains and raymarch-only compositions before capture',
);
assert.match(
  exporter,
  /oracleActivitySplatRadiusConcentrationRequested[\s\S]*?oracleActivitySplatRadiusConcentrationEffective[\s\S]*?scalar-activity-splat-radius-concentration-gain-mismatch/,
  'scalar-cue witnesses fail loud unless requested and effective splat-radius concentration match',
);
assert.match(exporter, /sourceCapture/, 'export manifest records source-capture custody');
assert.match(exporter, /payloadSha256/, 'exporter validates and records the exact capture payload hash');
assert.match(exporter, /deterministicReplay/, 'exporter preserves deterministic replay identity');
assert.match(exporter, /boundarySidecar/, 'exporter drains the active boundary-sidecar field authority');
assert.match(exporter, /boundary-splats\.f32/, 'exporter drains the effective compact learned-splat output');
assert.match(exporter, /failurePhase/, 'exporter writes a durable failure phase');
assert.match(exporter, /boundarySplatComposition:\s*renderComposition/, 'imported render invocation passes the requested composition to the frozen renderer');
assert.match(exporter, /controlOverrides:\s*renderControlOverrides/, 'imported render invocation passes structured control overrides to the frozen renderer');
assert.match(exporter, /renderCompositionExplicit[\s\S]*boundarySplatCompositionEffective\s*!==\s*renderComposition/, 'an explicitly requested hybrid composition fails loud when the renderer reports another effective composition');
assert.match(
  exporter,
  /boundarySplatEvidenceComplete\s*!==\s*true[\s\S]*boundary-splat-evidence-incomplete/,
  'the exporter rejects a splat witness unless its final same-state draw is explicitly exhaustive',
);
assert.match(
  exporter,
  /boundarySplatOverflowCount\s*!==\s*0[\s\S]*boundary-splat-evidence-incomplete/,
  'the exporter rejects nonzero final splat overflow instead of preserving a truncated image as evidence',
);
assert.match(
  exporter,
  /post-render-canvas-geometry-v0[\s\S]*Page\.captureScreenshot/,
  'the witness recomputes capture geometry from the post-render intrinsic canvas before screenshotting',
);
assert.match(
  exporter,
  /post-render-canvas-geometry-mismatch/,
  'the witness rejects post-render CSS geometry that distorts the intrinsic canvas aspect ratio',
);

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-exact-basin-export-contract-'));
const capturePath = join(fixtureRoot, 'corrupt-capture.json');
const outDir = join(fixtureRoot, 'out');
writeFileSync(capturePath, `${JSON.stringify({
  schema: 'kaminos.operator-exact-live-splat-basin-capture.v1',
  identity: 'corrupt-capture-fixture',
  replayRoute: 'http://127.0.0.1:9/?kaminos_volume_smoke=1',
  controls: {},
  payloadSha256: '0'.repeat(64),
  hashAuthority: 'fixture-intentionally-corrupt',
}, null, 2)}\n`);

assert.throws(() => execFileSync(process.execPath, [
  exporterPath,
  '--source-capture', capturePath,
  '--target-origin', 'http://127.0.0.1:9',
  '--out-dir', outDir,
], { stdio: 'pipe' }), /Command failed/, 'exporter refuses a corrupt exact-tab source capture before browser launch');

const failed = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
assert.equal(failed.status, 'failed', 'corrupt source capture writes a failed manifest');
assert.equal(failed.failurePhase, 'source-capture-validation', 'corrupt source capture fails during source-capture validation');
assert.match(failed.error, /payload SHA-256 mismatch/, 'failure report names the source payload hash mismatch');

const compositionFluidPath = join(fixtureRoot, 'composition.fluid.f32');
const compositionFrontPath = join(fixtureRoot, 'composition.front.f32');
const compositionFluid = Buffer.alloc(16 * Float32Array.BYTES_PER_ELEMENT);
const compositionFront = Buffer.alloc(Float32Array.BYTES_PER_ELEMENT);
writeFileSync(compositionFluidPath, compositionFluid);
writeFileSync(compositionFrontPath, compositionFront);
const compositionManifestPath = join(fixtureRoot, 'composition.json');
writeFileSync(compositionManifestPath, `${JSON.stringify({
  schema: 'kaminos.volume.fire-flow-carrier-composition.v0',
  identity: 'low-upsampled-plus-fire-flow-carrier-fire-lick-v0',
  status: 'captured',
  failurePhase: null,
  compositionAuthority: 'frozen-fire-flow-carrier-fire-lick-composition-v0',
  runtimeTruthAvailable: false,
  layoutIdentity: 'x-fastest-zyx-c-interleaved-v0',
  source: {
    carrierRole: 'frozenConstant',
    targetDataUsedForTraining: false,
    targetDataUsedForCalibration: false,
    targetLabelsUsedForModelSelection: false,
    route: { effective: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:fixture' },
  },
  policy: {
    identity: 'positive-carrier-residual-to-fire-lick-v0',
    channel: 'fireLick',
    channelIndex: 14,
    subtractiveResidualApplied: false,
    clippingApplied: false,
  },
  verification: {
    unchangedFluidChannelCount: 15,
    unchangedFluidMismatchCount: 0,
    frontByteIdenticalToLowUpsampled: true,
    frontMismatchCount: 0,
  },
  receiver: {
    grid: 1,
    initialSimStepCount: 0,
    fluid: {
      path: compositionFluidPath,
      shape: [1, 1, 1, 16],
      channelOrder: ['velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail', 'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck'],
      byteLength: compositionFluid.byteLength,
      sha256: createHash('sha256').update(compositionFluid).digest('hex'),
    },
    front: {
      path: compositionFrontPath,
      shape: [1, 1, 1, 1],
      channelOrder: ['frontTopology'],
      byteLength: compositionFront.byteLength,
      sha256: createHash('sha256').update(compositionFront).digest('hex'),
    },
  },
  consumptionContract: {
    requiresExplicitSchemaAdmission: true,
    mustNotBeAcceptedAs: 'kaminos.volume.coarse-receiver-initial.v0',
    heldOnly: true,
    smokeChannelsPredicted: false,
    physicalTruth: false,
    mustNotBePromotedAs: 'full-field reconstruction, smoke closure, native-low deployment, or simulation-force truth',
  },
}, null, 2)}\n`);
const compositionAdmissionOut = join(fixtureRoot, 'composition-admission-out');
assert.throws(() => execFileSync(process.execPath, [
  exporterPath,
  '--initial-field-manifest', compositionManifestPath,
  '--advance-imported-steps', '0',
  '--source-capture', capturePath,
  '--target-origin', 'http://127.0.0.1:9',
  '--out-dir', compositionAdmissionOut,
], { stdio: 'pipe' }), /Command failed/, 'admitted composition reaches the independently corrupt source-capture gate');
const compositionAdmission = JSON.parse(readFileSync(join(compositionAdmissionOut, 'manifest.json'), 'utf8'));
assert.equal(compositionAdmission.failurePhase, 'source-capture-validation');
assert.match(compositionAdmission.error, /payload SHA-256 mismatch/, 'composition admission does not bypass source-capture authority');

const badFrozenCuePath = join(fixtureRoot, 'bad-frozen-cue.json');
const badFrozenCueOutDir = join(fixtureRoot, 'bad-frozen-cue-out');
const badFrozenCueDataPath = join(fixtureRoot, 'bad-frozen-cue.f32');
writeFileSync(badFrozenCueDataPath, Buffer.alloc(8 * Float32Array.BYTES_PER_ELEMENT));
writeFileSync(badFrozenCuePath, `${JSON.stringify({
  schema: 'kaminos.volume.fire-flow-carrier-frozen-transfer.v0',
  status: 'captured',
  failurePhase: null,
  transfer: {
    distinctReplay: true,
    targetDataUsedForTraining: false,
    targetDataUsedForCalibration: false,
    targetLabelsUsedForModelSelection: false,
  },
  derivedTarget: {
    contract: {
      identity: 'fire-flow-visibility-carrier-v0',
      authority: 'exact-high-field-renderer-coupled-derived-target-v0',
      physicalTruth: false,
    },
  },
  denseDerivedTargets: {
    fireFlowVisibilityCarrier: {
      frozenConstant: {
        path: badFrozenCueDataPath,
        sha256: '0'.repeat(64),
        byteLength: 8 * Float32Array.BYTES_PER_ELEMENT,
        shape: [2, 2, 2, 1],
        channelOrder: ['fireFlowVisibilityCarrier'],
        authority: 'unrecognized-frozen-carrier-authority',
      },
    },
  },
}, null, 2)}\n`);
assert.throws(() => execFileSync(process.execPath, [
  exporterPath,
  '--scalar-activity-cue-manifest', badFrozenCuePath,
  '--scalar-activity-cue-role', 'frozenConstant',
  '--out-dir', badFrozenCueOutDir,
], { stdio: 'pipe' }), /Command failed/, 'exporter rejects an unrecognized frozen cue authority before browser launch');
const badFrozenCueReport = JSON.parse(readFileSync(join(badFrozenCueOutDir, 'manifest.json'), 'utf8'));
assert.equal(badFrozenCueReport.status, 'failed');
assert.equal(badFrozenCueReport.failurePhase, 'source-capture-validation');
assert.match(badFrozenCueReport.error, /unsupported scalar activity cue authority/);

console.log('exact-basin full-grid export contracts passed');
