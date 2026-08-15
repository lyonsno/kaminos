import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIBROUS_HEAD_RETURN_MANIFEST_SCHEMA,
  FIBROUS_HEAD_RETURN_REPORT_SCHEMA,
  evaluateFibrousHeadReturn,
} from '../fibrous-head-return-core.mjs';

const H = digit => digit.repeat(64);

function manifest() {
  return {
    schema: FIBROUS_HEAD_RETURN_MANIFEST_SCHEMA,
    receiptId: 'neutral-skull-head-fibrous-return-v0',
    source: {
      skull: { path: '/source/skull.png', sha256: H('a') },
      generatedImage: {
        path: '/source/head.png',
        sha256: H('b'),
        prompt: 'Complete this skull into a living animal head.',
        generation: {
          routeId: 'flux2-klein-9b-q4', seed: 81401, width: 512, height: 512,
          steps: 8, guidance: 1,
        },
      },
      camera: { id: 'source-image-camera-v0', authority: 'source-image' },
    },
    reconstruction: {
      jobId: 'cf9d1c7f96be',
      requestedRouteId: 'trellis2mlx_fast',
      config: { seed: 42, steps: 6, targetFaces: 200000, textureSize: 1024 },
    },
    observationContract: {
      requiredKinds: ['textured', 'clay', 'normal', 'depth', 'silhouette'],
      requiredViewIds: ['source-camera'],
    },
    regions: [
      { id: 'rear-jaw-neck-ruff', candidateDisposition: 'HYBRID' },
      { id: 'ear-shell-rim-fur', candidateDisposition: 'UNRESOLVED' },
      { id: 'brow-muzzle-short-coat', candidateDisposition: 'UNRESOLVED' },
      { id: 'whiskers', candidateDisposition: 'REPLACE' },
    ],
    claimCeiling: 'source-specific regional representation triage only',
  };
}

function sourceEvidence(overrides = {}) {
  return {
    skull: { exists: true, sha256: H('a'), byteLength: 100 },
    generatedImage: { exists: true, sha256: H('b'), byteLength: 200 },
    ...overrides,
  };
}

function status(overrides = {}) {
  return {
    schema: 'observed.greenroom_job_watch.v1',
    job_id: 'cf9d1c7f96be',
    state: 'pending',
    bucket: 'pending',
    terminal: false,
    succeeded: false,
    effective_route: null,
    timed_out: true,
    ...overrides,
  };
}

function completionReceipt(overrides = {}) {
  return {
    schema: 'kaminos.fibrous-head-return-completion-receipt.v0',
    jobId: 'cf9d1c7f96be',
    sourceSha256: H('b'),
    requestedRouteId: 'trellis2mlx_fast',
    effectiveRouteId: 'trellis2mlx_fast',
    config: { seed: 42, steps: 6, targetFaces: 200000, textureSize: 1024 },
    products: [
      { kind: 'textured', viewId: 'source-camera', path: '/out/textured.png', sha256: H('1'), byteLength: 101 },
      { kind: 'clay', viewId: 'source-camera', path: '/out/clay.png', sha256: H('2'), byteLength: 102 },
      { kind: 'normal', viewId: 'source-camera', path: '/out/normal.png', sha256: H('3'), byteLength: 103 },
      { kind: 'depth', viewId: 'source-camera', path: '/out/depth.png', sha256: H('4'), byteLength: 104 },
      { kind: 'silhouette', viewId: 'source-camera', path: '/out/silhouette.png', sha256: H('5'), byteLength: 105 },
    ],
    ...overrides,
  };
}

test('pending Greenroom input cannot become cast or scientific admission', () => {
  const report = evaluateFibrousHeadReturn({
    manifest: manifest(), status: status(), sourceEvidence: sourceEvidence(), completionReceipt: null,
  });
  assert.equal(report.schema, FIBROUS_HEAD_RETURN_REPORT_SCHEMA);
  assert.equal(report.state, 'pending_input');
  assert.equal(report.scientificAdmission, false);
  assert.equal(report.lastTrustworthyEvidence, 'source_and_generated_image_identity');
  assert.deepEqual(report.missing, ['terminal_reconstruction_receipt']);
});

test('source digest mismatch fails before route interpretation', () => {
  const report = evaluateFibrousHeadReturn({
    manifest: manifest(),
    status: status(),
    sourceEvidence: sourceEvidence({ generatedImage: { exists: true, sha256: H('c'), byteLength: 200 } }),
    completionReceipt: null,
  });
  assert.equal(report.state, 'invalid_source');
  assert.equal(report.failure.phase, 'source-binding');
  assert.match(report.failure.message, /generated image digest mismatch/);
});

test('wrong job or fallback route fails loud', () => {
  const wrongJob = evaluateFibrousHeadReturn({
    manifest: manifest(), status: status({ job_id: 'other-job' }), sourceEvidence: sourceEvidence(), completionReceipt: null,
  });
  assert.equal(wrongJob.state, 'invalid_identity');

  const fallback = evaluateFibrousHeadReturn({
    manifest: manifest(),
    status: status({ state: 'done', bucket: 'done', terminal: true, succeeded: true, effective_route: 'fallback-route' }),
    sourceEvidence: sourceEvidence(),
    completionReceipt: completionReceipt({ effectiveRouteId: 'fallback-route' }),
  });
  assert.equal(fallback.state, 'invalid_route');
  assert.match(fallback.failure.message, /effective route mismatch/);
});

test('terminal success with incomplete or blank observations is partial output', () => {
  const terminal = status({
    state: 'done', bucket: 'done', terminal: true, succeeded: true, effective_route: 'trellis2mlx_fast',
  });
  const missing = completionReceipt({ products: completionReceipt().products.slice(0, 3) });
  const missingReport = evaluateFibrousHeadReturn({
    manifest: manifest(), status: terminal, sourceEvidence: sourceEvidence(), completionReceipt: missing,
  });
  assert.equal(missingReport.state, 'partial_output');
  assert.deepEqual(missingReport.missing, ['depth@source-camera', 'silhouette@source-camera']);

  const blank = completionReceipt();
  blank.products.find(product => product.kind === 'depth').byteLength = 0;
  const blankReport = evaluateFibrousHeadReturn({
    manifest: manifest(), status: terminal, sourceEvidence: sourceEvidence(), completionReceipt: blank,
  });
  assert.equal(blankReport.state, 'partial_output');
  assert.deepEqual(blankReport.blank, ['depth@source-camera']);
});

test('complete bound observations permit triage but never self-admit the science', () => {
  const report = evaluateFibrousHeadReturn({
    manifest: manifest(),
    status: status({
      state: 'done', bucket: 'done', terminal: true, succeeded: true, effective_route: 'trellis2mlx_fast',
    }),
    sourceEvidence: sourceEvidence(),
    completionReceipt: completionReceipt(),
  });
  assert.equal(report.state, 'cast_ready_for_triage');
  assert.equal(report.scientificAdmission, false);
  assert.equal(report.visualAdmission, 'unreviewed');
  assert.equal(report.products.length, 5);
  assert.equal(report.lastTrustworthyEvidence, 'route_bound_complete_observation_set');
});
