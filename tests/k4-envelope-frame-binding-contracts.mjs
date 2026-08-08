import assert from 'node:assert/strict';
import test from 'node:test';

import {
  K4_ENVELOPE_FRAME_BINDING_SCHEMA,
  buildK4EnvelopeFrameBinding,
} from '../k4-envelope-frame-binding-core.mjs';

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function sourceExtraction() {
  return {
    schema: 'kaminos.track-m-blender-extraction.v0',
    source: {
      requestedPath: '/source.blend',
      effectivePath: '/source.blend',
      sha256: 'a'.repeat(64),
    },
    objects: [{ name: 'SRC_PELVIS', matrixWorld: identity }],
  };
}

function skeletonGltf({ duplicateAnchor = false, shear = false } = {}) {
  const anchor = {
    name: 'SRC_PELVIS',
    translation: [10, -20, 3],
    scale: shear ? [2, 3, 2] : [2, 2, 2],
  };
  return {
    asset: { version: '2.0' },
    nodes: duplicateAnchor ? [anchor, { ...anchor }] : [anchor, { name: 'Cube.002' }],
  };
}

function parentAtlas() {
  const routeInventory = ['muscle-34', 'muscle-13'].map((constructionId, routeIndex) => ({
    constructionId,
    state: 'candidate',
    fields: {
      centerline: {
        state: 'candidate',
        candidates: [{
          authority: 'candidate',
          kind: 'source-curve-centerline',
          value: {
            resampledSamples: [
              { arcFraction: 0, position: [routeIndex, 0, 0], radius: 1 },
              { arcFraction: 1, position: [routeIndex, 1, 0], radius: 1 },
            ],
          },
        }],
      },
    },
  }));
  return {
    schema: 'kaminos.authored-muscle-coordinate-parent-atlas.v0',
    id: 'atlas-test',
    atlasSha256: 'b'.repeat(64),
    source: {
      assetSha256: 'a'.repeat(64),
      requestedBlendPath: '/source.blend',
      effectiveBlendPath: '/source.blend',
    },
    routeInventory,
  };
}

function baseline() {
  return {
    id: 'baseline',
    source: {
      authority: { kind: 'synthetic-proxy', anatomicalAdmission: 'none' },
      muscles: [
        { id: 'muscle-34', centerline: [{ position: [0, 0, 0], radius: 1 }, { position: [0, 1, 0], radius: 1 }] },
        { id: 'muscle-13', centerline: [{ position: [1, 0, 0], radius: 1 }, { position: [1, 1, 0], radius: 1 }] },
      ],
    },
  };
}

function frameLink() {
  return {
    schema: 'kaminos.frame-link-receipt.v0',
    status: 'completed',
    inputs: {
      sourceSha256: 'c'.repeat(64),
      envelopeSha256: 'd'.repeat(64),
    },
    link: {
      transform: {
        rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        translation: [-5, 7, 11],
      },
      after: { sampleCount: 100, insideFraction: 0.99, outsideCount: 1 },
      iterations: 120,
      converged: false,
      scaleLocked: true,
    },
  };
}

function build(overrides = {}) {
  return buildK4EnvelopeFrameBinding({
    sourceExtraction: sourceExtraction(),
    sourceExtractionFileSha256: 'e'.repeat(64),
    skeletonGltf: skeletonGltf(),
    skeletonFileSha256: 'c'.repeat(64),
    envelopeFileSha256: 'd'.repeat(64),
    skeletonEnvelopeFrameLink: frameLink(),
    skeletonEnvelopeFrameLinkFileSha256: 'f'.repeat(64),
    parentAtlas: parentAtlas(),
    parentAtlasFileSha256: '1'.repeat(64),
    requestedConstructionIds: ['muscle-34', 'muscle-13'],
    baselineCondition: baseline(),
    baselineFileSha256: '2'.repeat(64),
    ...overrides,
  });
}

test('unique pelvis frame produces a measured source-to-skeleton similarity and provisional composite', () => {
  const receipt = build();
  assert.equal(receipt.schema, K4_ENVELOPE_FRAME_BINDING_SCHEMA);
  assert.equal(receipt.status, 'completed-provisional');
  assert.deepEqual(receipt.requestedConstructionIds, ['muscle-34', 'muscle-13']);
  assert.deepEqual(receipt.effectiveConstructionIds, ['muscle-34', 'muscle-13']);
  assert.equal(receipt.sourceToSkeleton.anchor.name, 'SRC_PELVIS');
  assert.equal(receipt.sourceToSkeleton.transform.scale, 2);
  assert.deepEqual(receipt.sourceToSkeleton.transform.translation, [10, -20, 3]);
  assert.equal(receipt.sourceToSkeleton.authority, 'measured-candidate');
  assert.equal(receipt.sourceToEnvelope.transform.scale, 2);
  assert.deepEqual(receipt.sourceToEnvelope.transform.translation, [5, -13, 14]);
  assert.equal(receipt.sourceToEnvelope.authority, 'fit-derived-provisional');
  assert.equal(receipt.claimCeiling, 'metric-mechanism-only');
  assert.equal(receipt.k4SourceWorldBinding.maximumPositionDelta, 0);
  assert.match(receipt.receiptSha256, /^[0-9a-f]{64}$/);
});

test('duplicate semantic anchors fail instead of choosing by order', () => {
  assert.throws(() => build({ skeletonGltf: skeletonGltf({ duplicateAnchor: true }) }), /exactly one SRC_PELVIS/);
});

test('non-similarity anchor relation fails instead of laundering shear as a frame', () => {
  assert.throws(() => build({ skeletonGltf: skeletonGltf({ shear: true }) }), /uniform positive similarity/);
});

test('changed K4 baseline coordinates fail source-world lineage even when route order is unchanged', () => {
  const changed = baseline();
  changed.source.muscles[1].centerline[1].position[1] = 1.01;
  assert.throws(() => build({ baselineCondition: changed }), /baseline centerline mismatch muscle-13/);
});

test('edited unselected atlas state still fails the declared parent file hash at the caller boundary', () => {
  assert.throws(() => build({ parentAtlasFileSha256: 'bad' }), /parentAtlasFileSha256/);
});
