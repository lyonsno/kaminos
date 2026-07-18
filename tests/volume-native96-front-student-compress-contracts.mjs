#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, 'volume-native96-front-student-compress.py');
const runtime = join(root, 'native-low-selective-live-runtime.mjs');
const route = join(root, 'volume-native-low-selective-live.html');
const core = join(root, 'volume-core.js');
const witness = join(root, 'volume-native-low-selective-live-witness.mjs');
const f16ModelDir = join(root, 'models/native96-front-student-width48-f16-v0');
const f16Manifest = join(f16ModelDir, 'front-student-width48.manifest.json');
const f16Weights = join(f16ModelDir, 'front-student-width48.f16');
const f32MatrixDir = join(root, 'models/native96-front-student-f32-matrix-v0');
const f32MatrixManifest = join(f32MatrixDir, 'manifest.json');

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

const f32SelfTestRun = spawnSync('python3', [script, '--self-test', '--storage-dtype', 'float32-le'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30_000,
});
assert.equal(f32SelfTestRun.status, 0, `f32 compressor self-test failed:\n${f32SelfTestRun.stderr || f32SelfTestRun.stdout}`);
const f32SelfTest = JSON.parse(f32SelfTestRun.stdout);
assert.equal(f32SelfTest.weightStorageDtype, 'float32-le');
assert.equal(f32SelfTest.runtimeArithmeticDtype, 'f32');
assert.equal(f32SelfTest.metricArithmetic, 'float32-over-f32-package-v0');
assert.deepEqual(f32SelfTest.studentWidths, [16, 24, 32]);
assert.equal(f32SelfTest.featureCount, 185);
assert.equal(f32SelfTest.inputAblation, false);
assert.equal(f32SelfTest.rowAccounting, 'complete-uncapped-input-row-accounting-v0');

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

assert.ok(existsSync(f32MatrixManifest), 'complete f32 width matrix manifest must exist');
const f32Matrix = JSON.parse(readFileSync(f32MatrixManifest, 'utf8'));
assert.equal(f32Matrix.schema, 'kaminos.volume.native96-front-student-matrix.v0');
assert.equal(f32Matrix.status, 'captured');
assert.equal(f32Matrix.failurePhase, null);
assert.equal(f32Matrix.featureCount, 185);
assert.equal(f32Matrix.inputAblation, false);
assert.equal(f32Matrix.rowCount, 4096000);
assert.equal(f32Matrix.rowAccounting, 'complete-uncapped-input-row-accounting-v0');
assert.equal(f32Matrix.weightStorageDtype, 'float32-le');
assert.equal(f32Matrix.runtimeArithmeticDtype, 'f32');
assert.equal(f32Matrix.runtimeTruthUsed, false);
assert.deepEqual(f32Matrix.studentWidths, [16, 24, 32]);
assert.equal(f32Matrix.results.length, 3);
for (const result of f32Matrix.results) {
  assert.match(result.modelIdentity, new RegExp(`native96-front-student-width${result.width}-f32-v0`));
  assert.equal(result.rowCount, 4096000);
  assert.ok(result.packedByteLength > 0);
  assert.match(result.packedSha256, /^[0-9a-f]{64}$/);
  const modelManifest = JSON.parse(readFileSync(join(f32MatrixDir, `front-student-width${result.width}.manifest.json`), 'utf8'));
  assert.equal(modelManifest.packed.dtype, 'float32-le');
  assert.equal(modelManifest.packed.runtimeArithmeticDtype, 'f32');
  assert.equal(modelManifest.features.featureCount, 185);
  assert.equal(modelManifest.features.inputAblation, false);
  assert.equal(modelManifest.source.rowCount, 4096000);
  assert.equal(modelManifest.source.rowAccounting, 'complete-uncapped-input-row-accounting-v0');
  assert.equal(modelManifest.runtimeTruthUsed, false);
  const offsets = modelManifest.packed.offsets;
  assert.equal(offsets.featureMean, 0);
  assert.equal(offsets.featureStd, 185);
  assert.equal(offsets.w1, 370);
  assert.equal(offsets.b1, 370 + 185 * result.width);
  assert.equal(offsets.w2, offsets.b1 + result.width);
  assert.equal(offsets.b2TargetMeanTargetStd, offsets.w2 + result.width);
  assert.equal(modelManifest.packed.floatCount, offsets.b2TargetMeanTargetStd + 3);
  assert.ok(existsSync(join(f32MatrixDir, `front-student-width${result.width}.f32`)));
}

const runtimeSource = readFileSync(runtime, 'utf8');
const routeSource = readFileSync(route, 'utf8');
const coreSource = readFileSync(core, 'utf8');
const witnessSource = readFileSync(witness, 'utf8');
const combined = `${runtimeSource}\n${routeSource}\n${coreSource}\n${witnessSource}`;
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
assert.match(routeSource, /front_student_width/, 'operator route exposes explicit f32 student-width selection');
assert.match(combined, /NATIVE96_F32_FRONT_STUDENT_WIDTHS[\s\S]*16[\s\S]*24[\s\S]*32/, 'runtime admits exactly the measured f32 student-width matrix');
assert.match(combined, /unsupportedNative96FrontStudentWidth/, 'runtime rejects unknown student widths instead of silently falling back');
for (const result of f32Matrix.results) {
  assert.match(combined, new RegExp(result.modelIdentity), `runtime binds width-${result.width} model identity`);
  assert.match(combined, new RegExp(result.packedSha256), `runtime binds width-${result.width} model checksum`);
  assert.match(combined, new RegExp(String(result.packedByteLength)), `runtime binds width-${result.width} model byte length`);
  const modelManifest = JSON.parse(readFileSync(join(f32MatrixDir, `front-student-width${result.width}.manifest.json`), 'utf8'));
  const offsets = modelManifest.packed.offsets;
  assert.equal(modelManifest.packed.floatCount * Float32Array.BYTES_PER_ELEMENT, modelManifest.packed.byteLength, `width-${result.width} float count and byte length agree`);
  const runtimeStudentBlock = new RegExp(
    `width:\\s*${result.width},[\\s\\S]*?floatCount:\\s*${modelManifest.packed.floatCount},[\\s\\S]*?offsets:\\s*Object\\.freeze\\(\\{\\s*featureMean:\\s*${offsets.featureMean},\\s*featureStd:\\s*${offsets.featureStd},\\s*w1:\\s*${offsets.w1},\\s*b1:\\s*${offsets.b1},\\s*w2:\\s*${offsets.w2},\\s*b2:\\s*${offsets.b2TargetMeanTargetStd},\\s*targetMean:\\s*${offsets.b2TargetMeanTargetStd + 1},\\s*targetStd:\\s*${offsets.b2TargetMeanTargetStd + 2}\\s*\\}\\)`,
  );
  assert.match(runtimeSource, runtimeStudentBlock, `runtime binds the complete width-${result.width} manifest layout as one descriptor`);
}
assert.match(runtimeSource, /native96F32FrontStudentLayoutMismatch/, 'runtime rejects a package whose declared tensor layout disagrees with its byte length');
assert.match(combined, /requestedFrontStudentWidth[\s\S]*effectiveFrontStudentWidth/, 'receipt distinguishes requested and effective f32 student width');
assert.match(combined, /frontStudentModelIdentity[\s\S]*frontStudentModelSha256[\s\S]*frontStudentModelByteLength/, 'receipt preserves effective student package identity');
assert.match(combined, /frontStudentFeatureCount[\s\S]*185[\s\S]*frontStudentInputAblation[\s\S]*false/, 'runtime preserves all 185 inputs without ablation for every width');
assert.match(combined, /native96-front-student-width(?:16|24|32)-f32-candidates-v0/, 'runtime names explicit f32 student execution routes');
assert.match(combined, /native96-front-authority-gated-f32-front-student-width(?:16|24|32)-candidates-v0/, 'runtime names distinct gated f32 student execution routes');
assert.match(combined, /frontModelEvalGpuMs[\s\S]*frontModelEvalStage/, 'student timing uses neutral front-model stage fields');
assert.match(coreSource, /frontStudentWidth\s*==\s*null\s*\?\s*null\s*:\s*Number\(frontStudentWidth\)/, 'timing parser preserves an absent student width instead of coercing null to width zero');
assert.match(coreSource, /frontAuthorityGate[\s\S]*front-authority-gated-f32-front-student-width/, 'timing stage distinguishes gated and ungated student execution');
assert.match(witnessSource, /expectedFrontModelEvalStage/, 'witness verifies the exact model timing stage for the selected route');
assert.match(witnessSource, /requestedFrontStudentWidth[\s\S]*effectiveFrontStudentWidth/, 'witness verifies requested and effective student width');
assert.match(witnessSource, /frontStudentModelIdentity[\s\S]*frontStudentModelSha256/, 'witness verifies effective f32 student package identity and checksum');
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
