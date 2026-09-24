import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPECTED_RAYMARCH_COMPOSITION,
  EXPECTED_RAYMARCH_RENDERER_ROUTE,
  EXPECTED_RAYMARCH_WRAPPER_ROUTE,
  assertSpecializationSampleRoute,
  createEvidenceSourceManifest,
  runtimeAdmissionAccepted,
} from '../volume-raymarch-specialization-evidence.mjs';
import {
  retiredRaymarchControlReceiptPayload,
  stripRetiredRaymarchControls,
  updateRetiredRaymarchControlReceipt,
} from '../volume-core.js';

const root = new URL('..', import.meta.url).pathname;
const witness = join(root, 'volume-raymarch-specialization-witness.mjs');
const validAdmission = {
  wrapperRoute: EXPECTED_RAYMARCH_WRAPPER_ROUTE,
  wrapperStatus: 'running',
  wrapperFallbackReason: null,
  effectiveComposition: EXPECTED_RAYMARCH_COMPOSITION,
  active: true,
  effectiveRoute: EXPECTED_RAYMARCH_RENDERER_ROUTE,
  rendererFallbackReason: null,
  backend: 'WebGPU:apple',
  frameCount: 3,
  requestedRole: 'truthHigh',
  effectiveRole: 'truthHigh',
  roleAuthority: 'current-high-field-reference-no-learned-composition-v0',
};

assert.equal(runtimeAdmissionAccepted(validAdmission), true, 'exact nested WebGPU route is admitted');
assert.equal(runtimeAdmissionAccepted(validAdmission, { requestedRole: 'truthHigh' }), true, 'caller-requested role is admitted exactly');
assert.equal(runtimeAdmissionAccepted(validAdmission, { requestedRole: 'truthLow' }), false, 'caller-requested role mismatch fails admission');
for (const [label, mutation] of [
  ['missing wrapper', { wrapperRoute: null }],
  ['wrong wrapper', { wrapperRoute: 'direct-cockpit-v0' }],
  ['wrong renderer', { effectiveRoute: 'fallback-renderer-v0' }],
  ['wrapper fallback', { wrapperFallbackReason: 'substituted-loader' }],
  ['renderer fallback', { rendererFallbackReason: 'substituted-renderer' }],
  ['admission role substitution', { effectiveRole: 'truthLow' }],
  ['admission role authority missing', { roleAuthority: null }],
  ['admission role authority substitution', { roleAuthority: 'self-consistent-but-unauthorized-v0' }],
]) {
  assert.equal(runtimeAdmissionAccepted({ ...validAdmission, ...mutation }), false, `${label} must fail admission`);
}
for (const key of ['wrapperFallbackReason', 'rendererFallbackReason']) {
  const missing = { ...validAdmission };
  delete missing[key];
  assert.equal(runtimeAdmissionAccepted(missing), false, `missing ${key} must fail admission`);
}

const validSample = {
  effectiveRoute: EXPECTED_RAYMARCH_RENDERER_ROUTE,
  backend: 'WebGPU:apple',
  requestedRole: 'truthHigh',
  effectiveRole: 'truthHigh',
  roleAuthority: 'current-high-field-reference-no-learned-composition-v0',
  fallbackReason: null,
  boundarySplatFallbackReason: null,
  wrapperRoute: EXPECTED_RAYMARCH_WRAPPER_ROUTE,
  wrapperStatus: 'running',
  wrapperFallbackReason: null,
  wrapperEffectiveComposition: EXPECTED_RAYMARCH_COMPOSITION,
  selectiveHeadLivePassReceipt: {
    composition: EXPECTED_RAYMARCH_COMPOSITION,
    fallbackReason: null,
    raymarchApplied: true,
    splatApplied: false,
  },
};
assert.doesNotThrow(() => assertSpecializationSampleRoute(validSample, 'lean', validAdmission));
for (const [label, mutation] of [
  ['sample renderer drift', { effectiveRoute: 'substituted-renderer-v0' }],
  ['sample backend drift', { backend: 'WebGPU:fallback' }],
  ['sample composition drift', { selectiveHeadLivePassReceipt: { ...validSample.selectiveHeadLivePassReceipt, composition: 'splat-only-v0' } }],
  ['sample fallback', { selectiveHeadLivePassReceipt: { ...validSample.selectiveHeadLivePassReceipt, fallbackReason: 'fallback' } }],
  ['sample renderer fallback', { fallbackReason: 'frozen-model-runtime-unavailable' }],
  ['sample effective-role substitution', { effectiveRole: 'truthLow' }],
  ['sample role-authority drift', { roleAuthority: 'fallback-role-authority-v0' }],
  ['sample wrapper route drift', { wrapperRoute: 'direct-cockpit-v0' }],
  ['sample wrapper fallback', { wrapperFallbackReason: 'loader-fallback' }],
  ['sample wrapper composition drift', { wrapperEffectiveComposition: 'splat-only-v0' }],
]) {
  assert.throws(
    () => assertSpecializationSampleRoute({ ...validSample, ...mutation }, 'lean', validAdmission),
    undefined,
    `${label} must fail the captured sample`,
  );
}
for (const key of ['fallbackReason', 'boundarySplatFallbackReason', 'wrapperFallbackReason']) {
  const missing = { ...validSample };
  delete missing[key];
  assert.throws(
    () => assertSpecializationSampleRoute(missing, 'lean', validAdmission),
    undefined,
    `missing sample ${key} must fail the captured sample`,
  );
}
{
  const missingReceiptFallback = {
    ...validSample,
    selectiveHeadLivePassReceipt: { ...validSample.selectiveHeadLivePassReceipt },
  };
  delete missingReceiptFallback.selectiveHeadLivePassReceipt.fallbackReason;
  assert.throws(
    () => assertSpecializationSampleRoute(missingReceiptFallback, 'lean', validAdmission),
    undefined,
    'missing composition receipt fallbackReason must fail the captured sample',
  );
}

const manifestRepo = mkdtempSync(join(tmpdir(), 'kaminos-raymarch-manifest-contract-'));
execFileSync('git', ['init', '-q'], { cwd: manifestRepo });
execFileSync('git', ['config', 'user.email', 'raymarch-contract@example.invalid'], { cwd: manifestRepo });
execFileSync('git', ['config', 'user.name', 'Raymarch Contract'], { cwd: manifestRepo });
writeFileSync(join(manifestRepo, 'tracked.mjs'), 'export const tracked = true;\n');
execFileSync('git', ['add', 'tracked.mjs'], { cwd: manifestRepo });
execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: manifestRepo });
writeFileSync(join(manifestRepo, 'untracked-witness.mjs'), 'export const witness = 1;\n');
const manifestBefore = createEvidenceSourceManifest({ root: manifestRepo });
writeFileSync(join(manifestRepo, 'untracked-witness.mjs'), 'export const witness = 2;\n');
const manifestAfter = createEvidenceSourceManifest({ root: manifestRepo });
assert.notEqual(manifestAfter.sha256, manifestBefore.sha256, 'untracked participating source mutation invalidates old source identity');
assert.ok(manifestAfter.entries.some(entry => entry.path === 'untracked-witness.mjs' && entry.tracked === false), 'manifest names untracked participating source');

function runFailureCase(name, args, options = {}) {
  const caseDir = mkdtempSync(join(tmpdir(), `kaminos-raymarch-${name}-`));
  const report = join(caseDir, 'report.json');
  const result = spawnSync(process.execPath, [witness, '--report', report, ...args], {
    cwd: options.cwd || root,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, `${name} must fail`);
  const payload = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(payload.status, 'failed', `${name} writes failed status`);
  assert.equal(payload.failurePhase, options.failurePhase, `${name} names its failure phase`);
}

runFailureCase('missing-url', [], { failurePhase: 'argument-validation' });
runFailureCase('invalid-number', ['--url', 'http://127.0.0.1:1/?role=truthHigh', '--samples', 'nope'], { failurePhase: 'argument-validation' });
const nongit = mkdtempSync(join(tmpdir(), 'kaminos-raymarch-nongit-'));
runFailureCase('git-provenance', ['--url', 'http://127.0.0.1:1/?role=truthHigh'], { cwd: nongit, failurePhase: 'source-provenance' });
const missingProfileRoot = join(mkdtempSync(join(tmpdir(), 'kaminos-raymarch-profile-parent-')), 'missing');
runFailureCase('profile-creation', ['--url', 'http://127.0.0.1:1/?role=truthHigh'], {
  env: { KAMINOS_RAYMARCH_WITNESS_PROFILE_ROOT: missingProfileRoot },
  failurePhase: 'profile-creation',
});
const unwritable = spawnSync(process.execPath, [
  witness,
  '--report',
  '/dev/null/report.json',
], { cwd: root, encoding: 'utf8' });
assert.notEqual(unwritable.status, 0, 'unwritable report destination fails');
assert.match(unwritable.stderr, /"failurePhase": "report-write"/, 'stderr names the last-resort report-write phase');
assert.match(unwritable.stderr, /"durableReportWritten": false/, 'stderr refuses to claim an unwritten durable report');

const volumeWitness = readFileSync(join(root, 'volume-witness.mjs'), 'utf8');
const volumeCore = readFileSync(join(root, 'volume-core.js'), 'utf8');
const sampleFrameSource = volumeCore.slice(
  volumeCore.indexOf('async function sampleFrame(options = {})'),
  volumeCore.indexOf('function compactRenderScaleSample(sample)'),
);
assert.match(
  sampleFrameSource,
  /\.\.\.retiredRaymarchControlReceiptPayload\(state\)/,
  'successful sampleFrame carries the strict shared retired-control receipt payload',
);
assert.match(
  volumeWitness,
  /\.\.\.retiredRaymarchControlReceiptPayload\(sample\)/,
  'general witness consumes the strict shared receipt payload from sampleFrame',
);
assert.doesNotMatch(volumeWitness, /retiredRaymarchControls\s*\|\|\s*\{\}/, 'general witness cannot substitute object receipt shape');
assert.deepEqual(stripRetiredRaymarchControls({ density: 1.5 }).retiredRaymarchControls, [], 'fresh runtime receipt is an empty ordered array');
assert.deepEqual(stripRetiredRaymarchControls({
  density: 1.5,
  majorantGrid: 32,
  temporalAccum: 0.4,
}).retiredRaymarchControls, [
  { key: 'majorantGrid', value: 32 },
  { key: 'temporalAccum', value: 0.4 },
], 'historical receipt preserves exact keys, values, and canonical retirement order');
const historicalReceipt = stripRetiredRaymarchControls({
  density: 1.5,
  majorantGrid: 32,
  temporalAccum: 0.4,
}).retiredRaymarchControls;
const activeOnlyReceipt = stripRetiredRaymarchControls({ density: 2.0 }).retiredRaymarchControls;
const retainedReceipt = updateRetiredRaymarchControlReceipt(historicalReceipt, activeOnlyReceipt);
assert.deepEqual(retainedReceipt, historicalReceipt, 'unrelated active control update preserves runtime-lifetime historical receipt rows');
const sampledReceipt = retiredRaymarchControlReceiptPayload({
  retiredRaymarchControls: retainedReceipt,
  retiredRaymarchControlReceiptLifetime: 'volume-prototype-runtime-v0',
});
assert.deepEqual(sampledReceipt.retiredRaymarchControls, historicalReceipt, 'actual sample/report helper preserves historical receipt rows');
assert.equal(sampledReceipt.retiredRaymarchControlReceiptLifetime, 'volume-prototype-runtime-v0', 'actual sample/report helper preserves receipt lifetime');
assert.throws(
  () => retiredRaymarchControlReceiptPayload({ retiredRaymarchControls: retainedReceipt }),
  /missing-retired-raymarch-control-receipt-lifetime/,
  'actual sample/report helper rejects a missing receipt lifetime',
);
assert.deepEqual(
  JSON.parse(JSON.stringify({ retiredRaymarchControls: retainedReceipt })).retiredRaymarchControls,
  historicalReceipt,
  'general witness JSON boundary preserves the runtime receipt rows unchanged',
);
console.log('volume raymarch specialization negative contracts passed');
