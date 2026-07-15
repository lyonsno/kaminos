#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const exporter = await readFile(new URL('../volume-full-grid-field-export.mjs', import.meta.url), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

assert.match(core, /BOUNDARY_SPLAT_SURVIVAL_CUE_AUTHORITY\s*=\s*'validation-selected-candidate-survival-mask-v0'/, 'runtime names the survival-mask authority');
assert.match(core, /BOUNDARY_SPLAT_SURVIVAL_APPLICATION_IDENTITY\s*=\s*'survival-only-remove-rejected-low-candidates-v0'/, 'runtime names the survival-only application');
assert.match(core, /function scalarActivityCueChannelOrderForAuthority\(cueAuthority\)[\s\S]*BOUNDARY_SPLAT_SURVIVAL_CUE_AUTHORITY[\s\S]*\['boundarySplatSurvivalMask'\]/, 'scalar transport binds survival authority to its exact channel');
assert.match(core, /splatSurvivalEnabled:\s*survivalOnly\s*\?\s*clampFinite\(snapshot\.oracleActivitySplatSurvival,\s*0,\s*1,\s*0\)\s*:\s*0/, 'survival gating is authority-bound and inert by default');
assert.match(core, /const survivalOnly\s*=\s*cueAuthority\s*===\s*BOUNDARY_SPLAT_SURVIVAL_CUE_AUTHORITY[\s\S]*splatOpacityGain:\s*survivalOnly\s*\?\s*0[\s\S]*splatRadiusConcentrationGain:\s*survivalOnly\s*\?\s*0[\s\S]*splatDisplacementEnabled:\s*survivalOnly\s*\?\s*0/, 'survival authority intrinsically disables every other shared scalar-cue splat consumer');
assert.match(core, /splatSurvivalEnabled:\s*survivalOnly\s*\?\s*clampFinite\(snapshot\.oracleActivitySplatSurvival,[\s\S]*:\s*0/, 'non-survival cue authorities cannot activate candidate removal');
assert.match(core, /fn boundarySplatSurvives[\s\S]*activityControls\.w\s*<\s*0\.5[\s\S]*scalarActivityCue\[boundarySplatCellIndex\(cell\)\]\s*>=\s*0\.5/, 'compaction retains all candidates unless the binary survival gate is enabled');
assert.match(core, /if \(!boundarySplatSurvives\(gid\)\) \{ return; \}[\s\S]*atomicAdd\(&boundarySplatDraw\.candidateCount/, 'rejected candidates are removed before draw allocation');
assert.match(core, /oracleActivitySplatSurvivalRequested[\s\S]*oracleActivitySplatSurvivalEffective[\s\S]*survival-only-remove-rejected-low-candidates-v0/, 'frozen render receipt preserves requested and effective survival custody');

assert.match(exporter, /--boundary-splat-survival-manifest/, 'exporter accepts a dedicated survival manifest');
assert.match(exporter, /kaminos\.volume\.boundary-splat-survival-probe\.v0/, 'exporter admits only the survival probe schema');
assert.match(exporter, /boundarySplatSurvivalMask/, 'exporter requires the exact survival-mask channel');
assert.match(exporter, /source-target-bound-verified/, 'exporter requires source/target-bound checkpoint replay');
assert.match(exporter, /boundary-splat-survival-gain-mismatch/, 'exporter fails loud when requested survival gating is not effective');
assert.match(exporter, /boundary splat survival assay requires --render-only, --initial-field-manifest, and --advance-imported-steps 0/, 'survival application is held-render-only');
assert.match(exporter, /boundary splat survival source field mismatch/, 'exporter rejects a survival mask whose low-export ancestor differs from the imported field');
assert.match(exporter, /boundary splat survival mask must contain finite binary values/, 'exporter rejects checksum-valid non-binary survival data');

const fixtureDir = await mkdtemp(join(tmpdir(), 'kaminos-survival-render-contract-'));
const invalidManifestPath = join(fixtureDir, 'invalid-survival.json');
const failurePath = join(fixtureDir, 'failure.json');
await writeFile(invalidManifestPath, `${JSON.stringify({
  schema: 'kaminos.volume.boundary-splat-survival-probe.v0',
  status: 'captured',
  failurePhase: null,
  checkpoint: { replay: { status: 'unbound' } },
})}\n`);
const rejected = spawnSync(process.execPath, [
  new URL('../volume-full-grid-field-export.mjs', import.meta.url).pathname,
  '--boundary-splat-survival-manifest', invalidManifestPath,
  '--manifest', failurePath,
  '--out-dir', fixtureDir,
], { encoding: 'utf8' });
assert.notEqual(rejected.status, 0, 'unbound survival evidence must fail before browser launch');
const failure = JSON.parse(await readFile(failurePath, 'utf8'));
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-capture-validation');
assert.match(failure.error, /checkpoint replay contract mismatch/);
assert.equal(failure.requestedBoundarySplatSurvivalManifest, invalidManifestPath);

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
const lowExportManifestPath = join(fixtureDir, 'bound-low-export.json');
const lowExportManifest = {
  schema: 'kaminos.volume.full-grid-field-export.v0',
  status: 'captured',
  failurePhase: null,
  initialFieldImport: { requested: { manifestSha256: 'f'.repeat(64) } },
};
const lowExportBytes = Buffer.from(`${JSON.stringify(lowExportManifest)}\n`);
await writeFile(lowExportManifestPath, lowExportBytes);
const maskPath = join(fixtureDir, 'survival-mask.f32');
const maskBytes = Buffer.alloc(Float32Array.BYTES_PER_ELEMENT);
await writeFile(maskPath, maskBytes);
const mismatchedManifestPath = join(fixtureDir, 'mismatched-survival.json');
await writeFile(mismatchedManifestPath, `${JSON.stringify({
  schema: 'kaminos.volume.boundary-splat-survival-probe.v0',
  status: 'captured',
  failurePhase: null,
  source: { lowManifest: { path: lowExportManifestPath, sha256: sha256(lowExportBytes) } },
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
})}\n`);
const ancestryFailurePath = join(fixtureDir, 'ancestry-failure.json');
const rejectMismatchedSource = spawnSync(process.execPath, [
  new URL('../volume-full-grid-field-export.mjs', import.meta.url).pathname,
  '--initial-field-manifest', initialManifestPath,
  '--advance-imported-steps', '0',
  '--render-only',
  '--render-png', join(fixtureDir, 'must-not-render.png'),
  '--boundary-splat-survival-manifest', mismatchedManifestPath,
  '--manifest', ancestryFailurePath,
  '--out-dir', fixtureDir,
], { encoding: 'utf8' });
assert.notEqual(rejectMismatchedSource.status, 0, 'survival evidence bound to another low field must fail before browser launch');
const ancestryFailure = JSON.parse(await readFile(ancestryFailurePath, 'utf8'));
assert.equal(ancestryFailure.status, 'failed');
assert.equal(ancestryFailure.failurePhase, 'source-capture-validation');
assert.match(ancestryFailure.error, /boundary splat survival source field mismatch/);

const boundLowExportManifestPath = join(fixtureDir, 'exact-low-export.json');
const boundLowExportManifest = {
  ...lowExportManifest,
  initialFieldImport: { requested: { manifestSha256: sha256(initialBytes) } },
};
const boundLowExportBytes = Buffer.from(`${JSON.stringify(boundLowExportManifest)}\n`);
await writeFile(boundLowExportManifestPath, boundLowExportBytes);
const nonBinaryMaskPath = join(fixtureDir, 'non-binary-survival-mask.f32');
const nonBinaryMaskBytes = Buffer.from(new Float32Array([Number.NaN]).buffer);
await writeFile(nonBinaryMaskPath, nonBinaryMaskBytes);
const nonBinaryManifestPath = join(fixtureDir, 'non-binary-survival.json');
await writeFile(nonBinaryManifestPath, `${JSON.stringify({
  schema: 'kaminos.volume.boundary-splat-survival-probe.v0',
  status: 'captured',
  failurePhase: null,
  source: { lowManifest: { path: boundLowExportManifestPath, sha256: sha256(boundLowExportBytes) } },
  checkpoint: { replay: {
    status: 'source-target-bound-verified',
    sourceBindingParity: true,
    targetBindingParity: true,
    thresholdParity: true,
    probabilityParity: true,
    keepMaskParity: true,
    outputSha256: sha256(nonBinaryMaskBytes),
  } },
  denseOutputs: { boundarySplatSurvivalMask: {
    path: nonBinaryMaskPath,
    sha256: sha256(nonBinaryMaskBytes),
    byteLength: nonBinaryMaskBytes.byteLength,
    shape: [1, 1, 1, 1],
    channelOrder: ['boundarySplatSurvivalMask'],
    authority: 'validation-selected-candidate-survival-mask-v0',
    applicationIdentity: 'survival-only-remove-rejected-low-candidates-v0',
    candidateMutationPolicy: 'keep-or-remove only; no birth, move, or attribute mutation',
  } },
})}\n`);
const nonBinaryFailurePath = join(fixtureDir, 'non-binary-failure.json');
const rejectNonBinary = spawnSync(process.execPath, [
  new URL('../volume-full-grid-field-export.mjs', import.meta.url).pathname,
  '--initial-field-manifest', initialManifestPath,
  '--advance-imported-steps', '0',
  '--render-only',
  '--render-png', join(fixtureDir, 'must-not-render-non-binary.png'),
  '--boundary-splat-survival-manifest', nonBinaryManifestPath,
  '--manifest', nonBinaryFailurePath,
  '--out-dir', fixtureDir,
], { encoding: 'utf8' });
assert.notEqual(rejectNonBinary.status, 0, 'checksum-valid NaN survival data must fail before browser launch');
const nonBinaryFailure = JSON.parse(await readFile(nonBinaryFailurePath, 'utf8'));
assert.equal(nonBinaryFailure.status, 'failed');
assert.equal(nonBinaryFailure.failurePhase, 'source-capture-validation');
assert.match(nonBinaryFailure.error, /boundary splat survival mask must contain finite binary values/);

console.log('boundary splat survival render contracts passed');
