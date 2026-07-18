#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COEFFICIENT_ORDER = Object.freeze([
  'ridge.emission.r', 'ridge.emission.g', 'ridge.emission.b', 'ridge.extinction',
  'nonRidge.emission.r', 'nonRidge.emission.g', 'nonRidge.emission.b', 'nonRidge.extinction',
]);
const NATIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function buildGrid96OracleAdapter({ source, support, descriptors, coefficients }) {
  validate(source, support, descriptors, coefficients);
  const payload = {
    schema: 'kaminos.volume.layer-coefficient-training-manifest.v0',
    status: 'complete',
    authority: 'analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0',
    route: clone(source.route),
    cohort: {
      stateCount: 1,
      rowCount: support.rowCount,
      sampleCap: null,
      droppedRowCount: 0,
      overflowCount: 0,
      sameStateOnly: true,
    },
    admission: {
      identity: 'explicit-ridge-union-promoted-nonridge-source-selector-v0',
      authority: 'external-native-cell-index-list-v0',
      nativeCellIndexSha256: support.nativeCellIndexSha256,
    },
    coefficientTargets: {
      identity: 'separate-nonnegative-ridge-and-nonridge-local-coefficients-v0',
      coefficientBoundary: 'per-sample-pre-tone-map-emission-extinction-v0',
      order: [...COEFFICIENT_ORDER],
      outputTransform: 'none-exact-coefficients-v0',
    },
    transportEvaluation: {
      identity: 'one-shared-total-transmittance-v0',
      orderPolicy: 'global-order-one-stream-v0',
      independentlyRenderedToneMappedImageAdditivity: false,
    },
    states: [{
      id: 'coefficient-state-120-grid96',
      sameStateCaptureId: source.sameStateCaptureId,
      replay: {
        completedSteps: 120,
        grid: 96,
        fluidSha256: source.sidecars.fluid.sha256,
        frontSha256: source.sidecars.front.sha256,
      },
      rows: {
        count: support.rowCount,
        nativeCellIndices: clone(support.nativeCellIndices),
        features: clone(support.features),
        admission: clone(support.admission),
        coefficients: clone(coefficients.artifact),
        kernelDescriptors: clone(descriptors.artifact),
      },
    }],
    sourceOnlyOracleAdapter: true,
    learnerCampaign: false,
    trainingStarted: false,
    claimBoundary: {
      supports: 'Exact single-state grid96 CPU-oracle input over the complete admitted support.',
      doesNotSupport: ['learner training', 'learner evaluation', 'deposition adjudication', 'cheaper-demo operation'],
    },
  };
  return { ...payload, identity: `sha256:${sha256(Buffer.from(stableJson(payload)))}` };
}

function validate(source, support, descriptors, coefficients) {
  for (const [role, component] of [['source', source], ['support', support], ['descriptors', descriptors], ['coefficients', coefficients]]) {
    assert.equal(component?.status, 'complete', `${role} is not complete`);
    assert.equal(component.failurePhase, null, `${role} carries a failure phase`);
    assert.equal(component.grid, 96, `${role} is not native grid96`);
    assert.equal(component.simStepCount, 120, `${role} state step drifted`);
    assert.equal(component.sameStateCaptureId, source.sameStateCaptureId, `${role} same-state identity drifted`);
    assert.equal(component.requestedControlIdentity, source.requestedControlIdentity, `${role} requested controls drifted`);
    assert.equal(component.effectiveControlIdentity, source.effectiveControlIdentity, `${role} effective controls drifted`);
    assert.equal(component.route?.effective, NATIVE_ROUTE, `${role} source route fell back`);
    assert.ok(component.route?.backend?.startsWith('WebGPU:'), `${role} source backend is not WebGPU`);
    assert.ok(component.route?.fallbackReason == null, `${role} source route carries a fallback reason`);
    assert.equal(component.route?.requested, source.route?.requested, `${role} requested source route drifted`);
  }
  assert.equal(source.requestedControlIdentity, source.effectiveControlIdentity, 'source controls were substituted');
  assert.equal(support.sampleCap, null, 'support applied a sampleCap');
  assert.equal(support.droppedRowCount, 0, 'support dropped rows');
  assert.equal(support.overflowCount, 0, 'support overflowed');
  assert.equal(support.admissionIdentity, 'explicit-ridge-union-promoted-nonridge-source-selector-v0', 'support admission identity drifted');
  for (const [role, component] of [['descriptors', descriptors], ['coefficients', coefficients]]) {
    assert.equal(component.nativeCellIndexSha256, support.nativeCellIndexSha256, `${role} support index drifted`);
    assert.equal(component.rowCount, support.rowCount, `${role} row count drifted`);
  }
  assert.equal(descriptors.identity, 'flow-kernel-local-descriptor-socket-v0', 'descriptor socket identity drifted');
  assert.equal(descriptors.kernelIdentity, 'flow-tangent-positive-symmetric-trilinear-v0', 'descriptor kernel identity drifted');
  assert.equal(coefficients.identity, 'exact-local-layer-emission-extinction-v0', 'coefficient source is not exact');
  assert.equal(coefficients.coefficientBoundary, 'per-sample-pre-tone-map-emission-extinction-v0', 'coefficient boundary drifted');
  assert.equal(descriptors.artifact?.candidateAdmissionAuthority, 'external-native-cell-index-list-v0', 'descriptor admission authority drifted');
  const indexAuthority = descriptors.artifact?.admissionIndexAuthority;
  assert.equal(indexAuthority?.identity, 'external-native-cell-index-list-v0', 'descriptor index authority drifted');
  assert.equal(indexAuthority?.indexSha256, support.nativeCellIndexSha256, 'descriptor support index drifted');
  assert.equal(indexAuthority?.count, support.rowCount, 'descriptor support count drifted');
  assert.equal(indexAuthority?.duplicatePolicy, 'forbidden', 'descriptor duplicate policy drifted');
  assert.equal(indexAuthority?.orderIdentity, 'caller-ordered', 'descriptor row order drifted');
  assert.equal(indexAuthority?.runtimeReceipt?.status, 'applied', 'descriptor runtime population was not applied');
  assert.ok(indexAuthority?.runtimeReceipt?.fallbackReason == null, 'descriptor runtime population used fallback');
  assert.equal(indexAuthority?.runtimeReceipt?.grid, 96, 'descriptor runtime population was not grid96');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const outPath = resolve(arg('--out') || 'grid96-oracle-adapter-manifest.json');
  const reportPath = resolve(arg('--report') || 'grid96-oracle-adapter-report.json');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { argv: process.argv.slice(2) };
  try {
    const paths = {
      source: resolve(arg('--source-manifest')),
      support: resolve(arg('--support-manifest')),
      descriptors: resolve(arg('--descriptor-manifest')),
      coefficients: resolve(arg('--coefficient-manifest')),
    };
    lastTrustworthyEvidence = { paths };
    failurePhase = 'component-validation';
    const manifest = buildGrid96OracleAdapter(Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, readJson(path)])));
    failurePhase = 'artifact-write';
    writeJsonAtomic(outPath, manifest);
    writeJsonAtomic(reportPath, {
      schema: 'kaminos.volume.grid96-oracle-adapter-report.v0', status: 'complete', failurePhase: null,
      output: { path: outPath, sha256: sha256(readFileSync(outPath)) },
      inputs: Object.fromEntries(Object.entries(paths).map(([role, path]) => [role, { path, sha256: sha256(readFileSync(path)) }])),
      learnerCampaign: false,
      trainingStarted: false,
    });
  } catch (error) {
    writeJsonAtomic(reportPath, {
      schema: 'kaminos.volume.grid96-oracle-adapter-report.v0', status: 'failed', failurePhase,
      error: String(error?.stack || error), lastTrustworthyEvidence,
      learnerCampaign: false, trainingStarted: false,
    });
    throw error;
  }
}

if (isCli) main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
