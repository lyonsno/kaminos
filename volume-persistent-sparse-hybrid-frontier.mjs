#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_MANIFEST_SHA256 = '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20';
export const FRONTIER_CONSUMER_IDENTITY = 'manifest-pinned-ownership-conserving-sparse-hybrid-frontier-consumer-v0';
export const OPTICAL_OWNERSHIP_IDENTITY = 'complementary-local-optical-coefficient-ownership-v0';

const ROW_COUNT = 481447;
const STATE_STEPS = [114, 116, 118, 120];
const ARRAY_LAYOUT = Object.freeze({
  sourceRowIndices: { dtype: '<u4', width: 1, bytes: 4 },
  nativeCellIndices: { dtype: '<u4', width: 1, bytes: 4 },
  coefficients: { dtype: '<f4', width: 8, bytes: 4 },
  kernelDescriptors: { dtype: '<f4', width: 8, bytes: 4 },
  features: { dtype: '<f4', width: 24, bytes: 4 },
  admission: { dtype: '<f4', width: 2, bytes: 4 },
  footprintScales: { dtype: '<f4', width: 1, bytes: 4 },
  depositMultiplicity: { dtype: '|u1', width: 1, bytes: 1 },
  retainedQuadratureWeight: { dtype: '<f4', width: 1, bytes: 4 },
});
const HEX_SHA256 = /^[a-f0-9]{64}$/;

function requireEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function expectedShape(rows, width) {
  return width === 1 ? [rows] : [rows, width];
}

function validateDescriptor(descriptor, name, rows, layout) {
  assert.ok(descriptor && typeof descriptor === 'object', `${name} descriptor missing`);
  assert.equal(typeof descriptor.path, 'string', `${name} path missing`);
  assert.match(descriptor.sha256 || '', HEX_SHA256, `${name} SHA-256 missing`);
  assert.equal(descriptor.dtype, layout.dtype, `${name} dtype drifted`);
  requireEqual(descriptor.shape, expectedShape(rows, layout.width), `${name} shape drifted`);
  assert.equal(descriptor.bytes, rows * layout.width * layout.bytes, `${name} byte count drifted`);
}

export function validatePersistentSparseCohortManifest(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'persistent cohort manifest must be an object');
  assert.equal(manifest.schema, 'persistent-sparse-cohort-export-v0', 'persistent cohort schema drifted');
  assert.equal(manifest.status, 'complete', 'persistent cohort is not complete');
  assert.equal(manifest.failurePhase, null, 'persistent cohort retains a failure phase');
  assert.equal(manifest.authority, 'accepted-report-replayed-native-membership-consumer-arrays-v0', 'persistent cohort authority drifted');
  assert.equal(manifest.role, 'complete-image-selection-control', 'persistent cohort role drifted');
  assert.equal(manifest.policy, 'optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition', 'persistent cohort policy drifted');
  assert.equal(manifest.retargetingStatus, 'forbidden-until-analytical-hybrid-frontier-is-positive', 'residual retargeting became authorized');

  assert.equal(manifest.selection?.targetPixelsUsed, false, 'selection used target pixels');
  assert.equal(manifest.selection?.candidateBudget, ROW_COUNT, 'candidate budget drifted');
  assert.equal(manifest.selection?.membershipPolicy, 'optical-hysteresis-adaptive-mean', 'membership policy drifted');
  assert.equal(manifest.selection?.stableIdentity, 'native-cell-index', 'stable identity drifted');

  const ownership = manifest.opticalOwnership || {};
  assert.equal(ownership.authority, OPTICAL_OWNERSHIP_IDENTITY, 'optical ownership authority drifted');
  assert.equal(ownership.splatEmission, 'w_j * j', 'splat emission ownership drifted');
  assert.equal(ownership.residualEmission, '(1 - w_j) * j', 'residual emission ownership drifted');
  assert.equal(ownership.splatExtinction, 'w_sigma * sigma', 'splat extinction ownership drifted');
  assert.equal(ownership.residualExtinction, '(1 - w_sigma) * sigma', 'residual extinction ownership drifted');
  assert.equal(ownership.duplicationForbidden, true, 'duplicated optical ownership became admissible');
  assert.equal(ownership.imageResidualForbidden, true, 'image residual became admissible');

  assert.equal(manifest.arrayContract?.rowAlignment, 'all arrays share sourceRowIndices/nativeCellIndices order', 'row alignment contract drifted');
  assert.equal(manifest.arrayContract?.consumerSelection, 'do-not-rerun-selection', 'selection rerun became authorized');
  assert.equal(manifest.arrayContract?.consumerDeposition, 'fixed-five-flow-taps-with-exported-footprint-scales-and-top-three-bilinear-neighbors', 'consumer deposition contract drifted');
  requireEqual(manifest.arrayContract?.dtypes, Object.fromEntries(Object.entries(ARRAY_LAYOUT).map(([name, layout]) => [name, layout.dtype])), 'array dtype contract drifted');

  assert.equal(manifest.states?.length, 4, 'persistent cohort must contain exactly four held states');
  requireEqual(manifest.states.map(state => state.steps), STATE_STEPS, 'held state sequence drifted');
  const seenStateIds = new Set();
  for (const state of manifest.states) {
    assert.equal(state.stateId, `coefficient-state-${state.steps}`, 'state identity drifted');
    assert.equal(state.rowCount, ROW_COUNT, 'state row count drifted');
    assert.equal(seenStateIds.has(state.stateId), false, 'held state identity duplicated');
    seenStateIds.add(state.stateId);
    requireEqual(Object.keys(state.arrays || {}).sort(), Object.keys(ARRAY_LAYOUT).sort(), 'state array set drifted');
    for (const [name, layout] of Object.entries(ARRAY_LAYOUT)) validateDescriptor(state.arrays[name], name, ROW_COUNT, layout);
    assert.equal(state.selectionReceipt?.membershipPolicy, 'optical-hysteresis-adaptive-mean', 'state membership policy drifted');
    assert.equal(state.selectionReceipt?.bilinearNeighborLimit, 3, 'state selection is not top-three deposition');
    assert.equal(state.depositionReceipt?.bilinearNeighborLimit, 3, 'state deposition is not top-three');
    assert.equal(state.depositionReceipt?.maximumDepositsPerCandidate, 15, 'state deposition multiplicity drifted');
    const plan = state.depositionReceipt?.contributionPlan || {};
    assert.equal(plan.targetUsed, false, 'state deposition used target pixels');
    assert.equal(plan.tapCount, 5, 'state deposition is not fixed-five');
    assert.equal(plan.requestedMinimumFootprintScale, 0.6875, 'requested footprint floor drifted');
    assert.equal(plan.effectiveMinimumFootprintScale, 0.6875, 'effective footprint floor drifted');
    assert.equal(plan.bilinearNeighborLimit, 3, 'state deposition plan is not top-three');
    assert.equal(state.sourceRows?.coefficients?.shape?.[1], 8, 'source coefficient channel count drifted');
    assert.equal(state.sourceRows?.nativeCellIndices?.shape?.length, 1, 'source native-cell shape drifted');
  }

  for (const sourceHash of [
    manifest.source?.acceptedReportSha256,
    manifest.source?.manifestSha256,
    manifest.source?.motionReportSha256,
    manifest.source?.implementationBundle?.sha256,
  ]) assert.match(sourceHash || '', HEX_SHA256, 'source binding SHA-256 missing');

  return {
    ok: true,
    identity: FRONTIER_CONSUMER_IDENTITY,
    stateIds: manifest.states.map(state => state.stateId),
    rowsPerState: ROW_COUNT,
    selectionRerunAuthorized: false,
    residualRetargetingAuthorized: false,
    coefficientConservationEligible: false,
    opticalOwnershipIdentity: OPTICAL_OWNERSHIP_IDENTITY,
  };
}

export function descriptorPath(descriptor, manifestPath, localOnly) {
  const root = dirname(manifestPath);
  const path = resolve(root, descriptor.path);
  if (localOnly) {
    const realRoot = realpathSync(root);
    const realPath = realpathSync(path);
    const rel = relative(realRoot, realPath);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'cohort array path escaped the manifest root');
    return realPath;
  }
  return path;
}

function readAuthenticatedDescriptor(descriptor, path, label) {
  const bytes = readFileSync(path);
  assert.equal(bytes.byteLength, descriptor.bytes, `${label} on-disk byte count drifted`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), descriptor.sha256, `${label} on-disk SHA-256 drifted`);
  return bytes;
}

async function inFailurePhase(failurePhase, operation) {
  try {
    return await operation();
  } catch (error) {
    error.failurePhase ??= failurePhase;
    throw error;
  }
}

function typedBuffer(bytes, Type) {
  assert.equal(bytes.byteLength % Type.BYTES_PER_ELEMENT, 0, 'authenticated array byte alignment drifted');
  if (bytes.byteOffset % Type.BYTES_PER_ELEMENT === 0) {
    return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
  }
  const aligned = Uint8Array.from(bytes);
  return new Type(aligned.buffer, 0, aligned.byteLength / Type.BYTES_PER_ELEMENT);
}

function verifySelectedSourceRows(exportedArrays, sourceArrays) {
  const sourceRows = typedBuffer(exportedArrays.get('sourceRowIndices'), Uint32Array);
  const selectedNative = typedBuffer(exportedArrays.get('nativeCellIndices'), Uint32Array);
  const selectedCoefficients = typedBuffer(exportedArrays.get('coefficients'), Float32Array);
  const sourceNative = typedBuffer(sourceArrays.get('nativeCellIndices'), Uint32Array);
  const sourceCoefficients = typedBuffer(sourceArrays.get('coefficients'), Float32Array);
  assert.equal(sourceRows.length, ROW_COUNT, 'source row index count drifted');
  const nativeIds = new Set();
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const sourceRow = sourceRows[row];
    assert.ok(sourceRow < sourceNative.length, 'source row index escaped native source');
    assert.equal(selectedNative[row], sourceNative[sourceRow], 'selected native-cell row substitution');
    assert.equal(nativeIds.has(selectedNative[row]), false, 'selected native-cell identity duplicated');
    nativeIds.add(selectedNative[row]);
    const selectedBase = row * 8;
    const sourceBase = sourceRow * 8;
    for (let channel = 0; channel < 8; channel += 1) {
      const selected = selectedCoefficients[selectedBase + channel];
      assert.ok(Number.isFinite(selected) && selected >= 0, 'selected optical coefficient is negative or non-finite');
      assert.equal(selected, sourceCoefficients[sourceBase + channel], 'selected coefficient row substitution');
    }
  }
}

function verifyConsumerBounds(exportedArrays) {
  const footprint = typedBuffer(exportedArrays.get('footprintScales'), Float32Array);
  const multiplicity = typedBuffer(exportedArrays.get('depositMultiplicity'), Uint8Array);
  const retainedWeight = typedBuffer(exportedArrays.get('retainedQuadratureWeight'), Float32Array);
  for (let row = 0; row < ROW_COUNT; row += 1) {
    assert.ok(Number.isFinite(footprint[row]) && footprint[row] >= 0.6875 && footprint[row] <= 1, 'exported footprint scale is out of bounds');
    assert.ok(multiplicity[row] <= 15, 'exported deposit multiplicity exceeds fixed-five/top-three bound');
    assert.ok(Number.isFinite(retainedWeight[row]) && retainedWeight[row] >= 0 && retainedWeight[row] <= 1.000001, 'retained quadrature weight is out of bounds');
  }
}

export async function authenticatePersistentSparseCohort({ manifestPath, expectedManifestSha256 = EXPECTED_MANIFEST_SHA256 }) {
  const resolvedManifestPath = resolve(manifestPath);
  const { manifest, manifestSha256, contract } = await inFailurePhase('manifest-admission', async () => {
    const manifestBytes = readFileSync(resolvedManifestPath);
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    assert.equal(expectedManifestSha256, EXPECTED_MANIFEST_SHA256, 'caller supplied an unauthorized manifest SHA-256');
    assert.equal(manifestSha256, EXPECTED_MANIFEST_SHA256, 'persistent cohort manifest SHA-256 drifted');
    const manifest = JSON.parse(manifestBytes);
    return { manifest, manifestSha256, contract: validatePersistentSparseCohortManifest(manifest) };
  });
  for (const state of manifest.states) {
    const exportedArrays = await inFailurePhase('exported-array-authentication', async () => {
      const authenticated = new Map();
      for (const [name, descriptor] of Object.entries(state.arrays)) {
        authenticated.set(name, readAuthenticatedDescriptor(
          descriptor,
          descriptorPath(descriptor, resolvedManifestPath, true),
          `${state.stateId}.${name}`,
        ));
      }
      return authenticated;
    });
    const sourceArrays = await inFailurePhase('source-array-authentication', async () => {
      const authenticated = new Map();
      for (const name of ['coefficients', 'nativeCellIndices']) {
        const descriptor = state.sourceRows[name];
        authenticated.set(name, readAuthenticatedDescriptor(
          descriptor,
          descriptorPath(descriptor, resolvedManifestPath, false),
          `${state.stateId}.sourceRows.${name}`,
        ));
      }
      return authenticated;
    });
    await inFailurePhase('source-row-replay', async () => verifySelectedSourceRows(exportedArrays, sourceArrays));
    await inFailurePhase('consumer-bounds', async () => verifyConsumerBounds(exportedArrays));
  }
  return {
    ...contract,
    coefficientConservationEligible: true,
    status: 'authenticated-build-contract-only',
    manifestPath: resolvedManifestPath,
    manifestSha256,
    arrayAuthentication: 'all-exported-arrays-sha256-plus-source-row-replay-v0',
    visualClaimEligible: false,
    productionEconomicsEligible: false,
    remainingGate: 'manifest-pinned-shared-transmittance-render-and-personal-dynamic-native-inspection',
  };
}

export function failedFrontierReceipt(error, fallbackPhase = 'manifest-admission') {
  return {
    identity: FRONTIER_CONSUMER_IDENTITY,
    status: 'failed',
    failurePhase: error?.failurePhase || fallbackPhase,
    reason: error?.message || String(error),
    coefficientConservationEligible: false,
    visualClaimEligible: false,
    productionEconomicsEligible: false,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    assert.ok(key.startsWith('--'), `unexpected argument ${key}`);
    assert.ok(index + 1 < argv.length, `missing value for ${key}`);
    options[key.slice(2)] = argv[++index];
  }
  return options;
}

async function main() {
  const argv = process.argv.slice(2);
  const reportOptionIndex = argv.indexOf('--report');
  let reportPath = reportOptionIndex >= 0 && argv[reportOptionIndex + 1] && !argv[reportOptionIndex + 1].startsWith('--')
    ? resolve(argv[reportOptionIndex + 1])
    : null;
  let failurePhase = 'argument-validation';
  try {
    const options = parseArgs(argv);
    assert.ok(options.report, '--report is required');
    reportPath = resolve(options.report);
    mkdirSync(dirname(reportPath), { recursive: true });
    assert.ok(options.manifest, '--manifest is required');
    failurePhase = 'manifest-admission';
    const receipt = await authenticatePersistentSparseCohort({
      manifestPath: options.manifest,
      expectedManifestSha256: options['expected-manifest-sha256'],
    });
    writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    const failure = failedFrontierReceipt(error, failurePhase);
    if (reportPath) {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    }
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
