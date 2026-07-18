#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, 'volume-native96-front-student-compress.py');
const runtime = join(root, 'native-low-selective-live-runtime.mjs');
const core = join(root, 'volume-core.js');
const witness = join(root, 'volume-native-low-selective-live-witness.mjs');
const f16ModelDir = join(root, 'models/native96-front-student-width48-f16-v0');
const f16Manifest = join(f16ModelDir, 'front-student-width48.manifest.json');
const f16Weights = join(f16ModelDir, 'front-student-width48.f16');

assert.ok(existsSync(script), 'native96 front-student compressor must exist');

const run = spawnSync('python3', [script, '--self-test'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30_000,
});
assert.equal(run.status, 0, `compressor self-test failed:\n${run.stderr || run.stdout}`);

const receipt = JSON.parse(run.stdout);
assert.equal(receipt.schema, 'kaminos.volume.native96-front-student-compressor-self-test.v0');
assert.equal(receipt.status, 'passed');
assert.equal(receipt.failurePhase, null);
assert.equal(receipt.featureCount, 185, 'student must preserve all 185 teacher inputs');
assert.equal(receipt.teacherHiddenWidth, 48);
assert.equal(receipt.maximumRuntimeWidth, 48, 'matrix must admit a width-48 f16 quantization control');
assert.deepEqual(receipt.studentWidths, [16, 24, 32]);
assert.equal(receipt.rowAccounting, 'complete-uncapped-input-row-accounting-v0');
assert.equal(receipt.weightStorageDtype, 'float16-le');
assert.equal(receipt.runtimeArithmeticDtype, 'f16');
assert.equal(receipt.runtimeTruthUsed, false);
assert.equal(receipt.inputAblation, false);
assert.ok(receipt.results.every(item => item.selectedHiddenUnits === item.width));
assert.ok(receipt.results.every(item => item.outputFinite === true));
assert.ok(receipt.results.every(item => item.quantizedByteLength > 0));
assert.ok(receipt.results.every(item => item.quantizedByteLength < receipt.teacherFloat32ByteLength));
assert.ok(receipt.results.every(item => item.rmseVsTeacher >= 0));
assert.ok(receipt.deterministicSelection === true);

assert.ok(existsSync(f16Manifest), 'width-48 f16 control manifest must exist');
assert.ok(existsSync(f16Weights), 'width-48 f16 control weights must exist');
const model = JSON.parse(readFileSync(f16Manifest, 'utf8'));
assert.equal(model.identity, 'native96-front-student-width48-f16-v0');
assert.equal(model.features.featureCount, 185);
assert.equal(model.features.inputAblation, false);
assert.equal(model.architecture.hiddenWidth, 48);
assert.equal(model.packed.dtype, 'float16-le');
assert.equal(model.packed.runtimeArithmeticDtype, 'f16');
assert.ok(model.metrics.correlationVsTeacher > 0.99999);
assert.ok(model.metrics.errorReductionVsZeroTeacher > 0.99999);

const runtimeSource = readFileSync(runtime, 'utf8');
const coreSource = readFileSync(core, 'utf8');
const witnessSource = readFileSync(witness, 'utf8');
const combined = `${runtimeSource}\n${coreSource}`;
assert.match(coreSource, /adapter\.features[\s\S]*shader-f16[\s\S]*requiredFeatures/, 'renderer device requests shader-f16 when supported');
assert.match(combined, /native96-front-student-width48-f16-v0/, 'runtime names exact f16 package identity');
assert.match(combined, /native96-f16-front-teacher-candidates-v0/, 'runtime names explicit f16 execution route');
assert.match(combined, /array<f16>/, 'runtime binds f16 model storage');
assert.match(combined, /runtimeArithmeticDtype[\s\S]*f16/, 'receipt records effective f16 arithmetic');
assert.match(combined, /shaderF16Required[\s\S]*true/, 'receipt makes shader-f16 requirement explicit');
assert.match(combined, /f16FrontTeacherEvalGpuMs/, 'runtime reports separate f16 teacher timing');
assert.match(combined, /f16-fallback-forbidden/, 'runtime forbids f32 fallback under an f16 request');
assert.match(combined, /native96-front-authority-gated-f32-front-teacher-candidates-v0/, 'runtime names the truth-free front-authority admission route');
assert.match(combined, /teacherFrontAuthorityAdmittedCount/, 'runtime reports the actual front-authority teacher population');
assert.match(combined, /frontAuthorityThresholdEffective/, 'runtime reports the effective front-authority threshold');
assert.match(combined, /runtimeTruthUsed[\s\S]*false/, 'front-authority admission explicitly forbids runtime truth');
assert.match(witnessSource, /f16FrontTeacherRequested/, 'witness identifies an explicit f16 request');
assert.match(witnessSource, /native96-f16-front-teacher-candidates-v0/, 'witness requires the f16 execution route');
assert.match(witnessSource, /native96-front-student-width48-f16-v0/, 'witness requires the f16 model identity');
assert.match(witnessSource, /8650b2231cf4fd0d8e1a6414ff25a4aeee1ca143f3cb70905299e74c5942b4be/, 'witness requires the f16 model checksum');
assert.match(witnessSource, /f16Fallback/, 'witness rejects f16 fallback');
assert.match(witnessSource, /shaderF16Available/, 'witness requires shader-f16 availability');
assert.match(witnessSource, /frontAuthorityGateRequested/, 'witness identifies an explicit front-authority gate request');
assert.match(witnessSource, /teacherFrontAuthorityAdmittedCount/, 'witness requires the admitted teacher population');
assert.match(witnessSource, /teacherFrontAuthorityCountSampledThisFrame/, 'witness requires gate-count freshness identity');
assert.match(witnessSource, /teacherFrontAuthorityCountSampleAgeFrames/, 'witness requires gate-count sample age');
assert.match(witnessSource, /ungated sparse-front route reported a teacher admission count/, 'witness rejects fabricated ungated gate metrics');
assert.match(
  runtimeSource,
  /teacherFrontAuthorityAdmittedCount:\s*currentFrontAuthorityGateEffective\s*\?\s*teacherFrontAuthorityAdmittedCount\s*:\s*null/,
  'lower-level admission receipt nulls the front-authority count when the gate did not execute',
);
assert.match(
  runtimeSource,
  /teacherFrontAuthorityAdmittedCoverage:\s*currentFrontAuthorityGateEffective[\s\S]*?teacherFrontAuthorityAdmittedCount\s*\/\s*highCells[\s\S]*?:\s*null/,
  'lower-level admission receipt nulls front-authority coverage when the gate did not execute',
);
assert.match(
  runtimeSource,
  /currentFrontAuthorityGateEffective\s*=\s*options\.native96SparseFrontContinuityEnabled\s*===\s*true\s*&&\s*options\.native96FrontAuthorityGateEnabled\s*===\s*true/,
  'each encode derives gate authority from current options rather than a stale prior receipt',
);
assert.match(
  coreSource,
  /nativeLowHeadCostProfile\s*=\s*\{[\s\S]*?\.\.\.timestampHeadCostProfile,[\s\S]*?sampledThisFrame:\s*true,[\s\S]*?sampleAgeFrames:\s*0,[\s\S]*?\};/,
  'timestamp-backed head-cost profiles retain current-frame freshness metadata',
);

console.log('native96 front-student compressor contracts passed');
