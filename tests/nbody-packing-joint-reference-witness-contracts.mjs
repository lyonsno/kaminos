import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deflateSync } from 'node:zlib';

import {
  NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE,
  NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
  NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE,
  admitNBodyPackingJointReferenceVisualInspection,
  writeNBodyPackingFrustratedComparisonWitness,
  writeNBodyPackingJointReferenceWitness,
  writeNBodyPackingSparseGlobalCandidateWitness,
} from '../nbody-packing-joint-reference-witness.mjs';

const VISUAL_STATES = [
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'joint-reference',
];
const VISUAL_MODES = ['volume', 'slice'];
const SPARSE_VISUAL_STATES = [
  'known-feasible',
  'crowded',
  'sequential-counterfeit',
  'sparse-global-candidate',
  'joint-reference',
];
const VISUAL_VERDICT = {
  nonblank:true,
  orbitable:true,
  statesLegible:true,
  opaqueOverlapTruthLegible:true,
  stableIdentityLegible:true,
  attachmentsBoneCompartmentLegible:true,
  metricsMatchMarkers:true,
  packingSemanticsNotInverted:true,
  jointReferenceLegible:true,
  textContained:true,
};
const SPARSE_VISUAL_VERDICT = {
  ...VISUAL_VERDICT,
  sparseCandidateLegible:true,
  candidateOracleDifferenceLegible:true,
};

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const CRC32_TABLE = Array.from({ length:256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function syntheticPng(seed, { width = 1400, height = 900 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  const color = [(seed * 53) % 256, (seed * 97) % 256, (seed * 193) % 256];
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 3;
      scanlines[pixel] = color[0];
      scanlines[pixel + 1] = color[1];
      scanlines[pixel + 2] = color[2];
    }
  }
  const idat = deflateSync(scanlines);
  return {
    bytes:Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', idat),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
    png: {
      width,
      height,
      bitDepth:8,
      colorType:2,
      compression:0,
      filter:0,
      interlace:0,
      chunkCount:3,
      idatBytes:idat.length,
    },
  };
}

async function fakeCapture(root, state, mode, {
  states = VISUAL_STATES,
  route = NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
  artifactDir = 'nbody-packing-joint-reference-v0',
  viewport = { width:1400, height:900 },
} = {}) {
  const seed = states.indexOf(state) * VISUAL_MODES.length +
    VISUAL_MODES.indexOf(mode) + 1;
  const { bytes, png } = syntheticPng(seed, viewport);
  const path = `${state}-${mode}.png`;
  const captureReportPath = `${state}-${mode}-capture-report.json`;
  const url = `http://127.0.0.1:18765/artifacts/${artifactDir}/?state=${state}&mode=${mode}`;
  await writeFile(join(root, path), bytes);
  await writeFile(join(root, captureReportPath), `${JSON.stringify({
    schema:'kaminos.receipt-bearing-browser-capture.v0',
    status:'complete',
    route: {
      requested:'independent-headless-screenshot-v0',
      effective:'independent-headless-screenshot-v0',
      fallbackUsed:false,
    },
    browser: {
      effective: {
        kind:'playwright-chromium-headless-shell',
        installedStableChrome:false,
      },
      fallbackPolicy:'independent-artifact-or-fail-no-stable-chrome',
    },
    domReceipt: {
      status:'complete',
      url,
      dataset: {
        witnessLoaded:'true',
        witnessState:state,
        witnessMode:mode,
        witnessRoute:route,
      },
    },
    invocation: { url, viewport },
    primaryOutput: {
      path:`repo://artifacts/${artifactDir}/${path}`,
      sizeBytes:bytes.length,
      sha256:digest(bytes),
      png,
    },
  }, null, 2)}\n`);
  return { state, mode, path, captureReportPath };
}

test('joint reference witness binds the four-state A/B/C/reference viewer to exact solver evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-joint-witness-'));
  try {
    const written = await writeNBodyPackingJointReferenceWitness({ outDir:root });
    const [fixtureBytes, assayBytes, referenceBytes, htmlBytes, reportBytes] =
      await Promise.all([
        readFile(join(root, 'fixture.json')),
        readFile(join(root, 'assay-result.json')),
        readFile(join(root, 'joint-reference.json')),
        readFile(join(root, 'index.html')),
        readFile(join(root, 'report.json')),
      ]);
    const fixture = JSON.parse(fixtureBytes);
    const assay = JSON.parse(assayBytes);
    const reference = JSON.parse(referenceBytes);
    const report = JSON.parse(reportBytes);
    const html = String(htmlBytes);

    assert.equal(written.report.status, 'complete-pending-visual-inspection');
    assert.deepEqual(report.route, {
      requested:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
      effective:NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE,
      fallbackUsed:false,
    });
    assert.equal(fixture.identity.sha256, reference.fixture.sha256);
    assert.equal(assay.status, 'counterfeit-rejected-global-debt');
    assert.equal(reference.status, 'converged-joint-reference');
    assert.equal(reference.config.fallbackUsed, false);
    assert.equal(reference.invariance.candidateEnumeration, 'passed');
    assert.equal(
      report.jointReference.candidateEnumerationReceipt.mechanism,
      'paired-full-solve-artifact-comparison',
    );
    assert.equal(report.jointReference.candidateEnumerationReceipt.rows.length, 2);
    assert.deepEqual(report.jointReference.candidateEnumerationReceipt.comparison, {
      selectedVectorEqual:true,
      selectedPhysicalStateEqual:true,
      selectedMetricsEqual:true,
      selectedBeltEqual:true,
    });
    assert.ok(reference.selected.maximumPhysicalResidual <= 1e-7);
    assert.ok(reference.stationarity.projectedGradientInfinityNorm <= 5e-5);
    assert.equal(report.claims.boundedJointReference, 'supported-by-kkt-and-continuous-admission');
    assert.equal(report.claims.scalableProductionSolver, 'not-assayed');
    assert.deepEqual(report.visualInspection.requiredStates, [
      'known-feasible',
      'crowded',
      'sequential-counterfeit',
      'joint-reference',
    ]);
    for (const state of report.visualInspection.requiredStates) {
      assert.match(html, new RegExp(`data-state="${state}"`));
    }
    assert.match(html, /Joint reference/);
    assert.match(html, /projected KKT/i);
    assert.match(html, /synthetic bounded reference/i);
    assert.match(html, new RegExp(NBODY_PACKING_JOINT_REFERENCE_WITNESS_ROUTE));
    for (const key of [
      'fixtureJsonSha256',
      'assayResultJsonSha256',
      'jointReferenceJsonSha256',
      'indexHtmlSha256',
    ]) assert.match(report.bindings[key], /^[0-9a-f]{64}$/);

    const witnessModule = await import('../nbody-packing-joint-reference-witness.mjs');
    assert.equal(
      typeof witnessModule.admitNBodyPackingJointReferenceVisualInspection,
      'function',
      'joint-reference witness must expose receipt-bound visual admission',
    );
    const images = [];
    for (const state of VISUAL_STATES) {
      for (const mode of VISUAL_MODES) images.push(await fakeCapture(root, state, mode));
    }
    const inspection = {
      observedAt:'2026-08-09T21:00:00-04:00',
      baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-joint-reference-v0/',
      images,
      verdict:VISUAL_VERDICT,
      summary:'All four states are distinct and the bounded joint reference is legible in volume and slice.',
    };
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection:{ ...inspection, images:images.slice(1) },
      }),
      /every state\/mode combination exactly once/,
    );
    const forgedImage = images[0];
    const forgedBytes = Buffer.from('forged non-PNG pixels with a matching report');
    await writeFile(join(root, forgedImage.path), forgedBytes);
    const forgedReportPath = join(root, forgedImage.captureReportPath);
    const forgedReport = JSON.parse(await readFile(forgedReportPath));
    forgedReport.primaryOutput.sizeBytes = forgedBytes.length;
    forgedReport.primaryOutput.sha256 = digest(forgedBytes);
    await writeFile(forgedReportPath, `${JSON.stringify(forgedReport, null, 2)}\n`);
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /PNG/,
    );
    images[0] = await fakeCapture(root, forgedImage.state, forgedImage.mode);
    const wrongDomImage = images[1];
    const wrongDomReportPath = join(root, wrongDomImage.captureReportPath);
    const wrongDomReport = JSON.parse(await readFile(wrongDomReportPath));
    wrongDomReport.domReceipt.dataset.witnessState = 'crowded';
    await writeFile(wrongDomReportPath, `${JSON.stringify(wrongDomReport, null, 2)}\n`);
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /effective DOM mismatch/,
    );
    images[1] = await fakeCapture(root, wrongDomImage.state, wrongDomImage.mode);
    const partialImage = images[0];
    images[0] = await fakeCapture(root, partialImage.state, partialImage.mode, {
      viewport:{ width:1, height:1 },
    });
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /viewport must be exactly 1400x900/,
    );
    images[0] = await fakeCapture(root, partialImage.state, partialImage.mode);
    const mixedImage = images[1];
    images[1] = await fakeCapture(root, mixedImage.state, mixedImage.mode, {
      viewport:{ width:1399, height:900 },
    });
    await assert.rejects(
      () => witnessModule.admitNBodyPackingJointReferenceVisualInspection({
        outDir:root,
        inspection,
      }),
      /viewport must be exactly 1400x900/,
    );
    images[1] = await fakeCapture(root, mixedImage.state, mixedImage.mode);
    const admitted = await witnessModule.admitNBodyPackingJointReferenceVisualInspection({
      outDir:root,
      inspection,
    });
    assert.equal(admitted.report.status, 'complete-visual-inspected');
    assert.equal(admitted.receipt.images.length, 8);
    assert.equal(new Set(admitted.receipt.images.map(image => image.sha256)).size, 8);
    assert.ok(admitted.receipt.images.every(
      image => image.capture.browser.installedStableChrome === false,
    ));
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('sparse global witness binds candidate and bounded oracle to ten admitted visual receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-sparse-witness-'));
  try {
    const written = await writeNBodyPackingSparseGlobalCandidateWitness({ outDir:root });
    const [problemBytes, candidateBytes, htmlBytes, reportBytes] = await Promise.all([
      readFile(join(root, 'sparse-problem.json')),
      readFile(join(root, 'sparse-candidate.json')),
      readFile(join(root, 'index.html')),
      readFile(join(root, 'report.json')),
    ]);
    const problem = JSON.parse(problemBytes);
    const candidate = JSON.parse(candidateBytes);
    const report = JSON.parse(reportBytes);
    const html = String(htmlBytes);

    assert.equal(written.report.status, 'complete-pending-visual-inspection');
    assert.deepEqual(report.route, {
      requested:NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE,
      effective:NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE,
      fallbackUsed:false,
    });
    assert.equal(candidate.status, 'converged-sparse-global-candidate');
    assert.equal(candidate.source.problemSha256, problem.identity.sha256);
    assert.equal(candidate.route.fallbackUsed, false);
    assert.equal(candidate.mechanism.oracleTargetCoordinatesConsumed, false);
    assert.equal(candidate.mechanism.pairwiseClosureAuthority, false);
    assert.equal(candidate.invariance.candidateEnumeration, 'passed');
    assert.equal(candidate.invariance.rows.length, 2);
    assert.ok(Object.values(candidate.invariance.comparison).every(Boolean));
    assert.ok(candidate.selected.maximumPhysicalResidual <= candidate.config.effective.convergenceTolerance);
    assert.equal(report.claims.scalableSyntheticCandidate, 'supported-only-on-bounded-five-body-assay');
    assert.equal(report.claims.scalableProductionSolver, 'not-assayed');
    assert.deepEqual(report.visualInspection.requiredStates, SPARSE_VISUAL_STATES);
    assert.match(html, /data-state="sparse-global-candidate"/);
    assert.match(html, /Scalable candidate evidence/i);
    assert.match(html, /joint reference evidence/i);
    assert.match(report.bindings.sparseProblemJsonSha256, /^[0-9a-f]{64}$/);
    assert.match(report.bindings.sparseCandidateJsonSha256, /^[0-9a-f]{64}$/);

    const images = [];
    for (const state of SPARSE_VISUAL_STATES) {
      for (const mode of VISUAL_MODES) {
        images.push(await fakeCapture(root, state, mode, {
          states:SPARSE_VISUAL_STATES,
          route:NBODY_PACKING_SPARSE_GLOBAL_WITNESS_ROUTE,
          artifactDir:'nbody-packing-sparse-global-v0',
        }));
      }
    }
    const admitted = await admitNBodyPackingJointReferenceVisualInspection({
      outDir:root,
      inspection: {
        observedAt:'2026-08-09T22:00:00-04:00',
        baseUrl:'http://127.0.0.1:18765/artifacts/nbody-packing-sparse-global-v0/',
        images,
        verdict:SPARSE_VISUAL_VERDICT,
        summary:'Candidate and oracle are distinct and legible in both volume and slice.',
      },
    });
    assert.equal(admitted.report.status, 'complete-visual-inspected');
    assert.equal(admitted.receipt.schema, 'kaminos.nbody-packing-sparse-global-comparison-visual-inspection.v0');
    assert.equal(admitted.receipt.images.length, 10);
    assert.equal(new Set(admitted.receipt.images.map(image => image.sha256)).size, 10);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});

test('frustrated comparison publishes the sparse failure without granting it admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kaminos-nbody-frustrated-witness-'));
  try {
    const written = await writeNBodyPackingFrustratedComparisonWitness({ outDir:root });
    const candidate = JSON.parse(await readFile(join(root, 'sparse-candidate.json')));
    const reference = JSON.parse(await readFile(join(root, 'joint-reference.json')));
    const report = JSON.parse(await readFile(join(root, 'report.json')));
    const html = String(await readFile(join(root, 'index.html')));

    assert.deepEqual(report.route, {
      requested:NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE,
      effective:NBODY_PACKING_FRUSTRATED_COMPARISON_WITNESS_ROUTE,
      fallbackUsed:false,
    });
    assert.equal(candidate.status, 'stalled-sparse-global-candidate');
    assert.equal(candidate.failure.phase, 'global-sparse-contact-projection');
    assert.ok(candidate.selected.metrics.pairwisePenetration > 1e-7);
    assert.ok(candidate.selected.metrics.skeletalPenetration > 1e-7);
    assert.equal(reference.status, 'converged-joint-reference');
    assert.ok(reference.selected.metrics.pairwisePenetration <= 1e-7);
    assert.ok(reference.selected.metrics.skeletalPenetration <= 1e-7);
    assert.equal(report.claims.scalableSyntheticCandidate, 'rejected-on-frustrated-bone-clearance-assay');
    assert.equal(report.sparseGlobalCandidate.admission, 'rejected-physical-residual');
    assert.equal(written.fixture.id, 'nbody-known-feasible-five-body-frustrated-rosette-assay-v0');
    assert.match(html, /contact-only candidate rejected/i);
    assert.match(html, /skeletal penetration/i);
  } finally {
    await rm(root, { recursive:true, force:true });
  }
});
