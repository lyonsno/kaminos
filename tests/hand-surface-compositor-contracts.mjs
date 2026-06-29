import assert from 'node:assert/strict';

import {
  buildFixturePerceptasiaHandPacket,
  composeTrackedHandSurface,
  renderTrackedHandSurfaceWitnessSvg,
} from '../hand-surface-compositor-core.mjs';

const REQUESTED_ENDPOINT = '/hand-control-sidecar-event';
const LIVE_BACKEND = 'native_wilor_mini_mlx_detector_sidecar_live';

function livePacket(overrides = {}) {
  return buildFixturePerceptasiaHandPacket({
    sourceBackend: LIVE_BACKEND,
    effectiveRoute: LIVE_BACKEND,
    timestampMs: 1000,
    ...overrides,
  });
}

function liveOptions(overrides = {}) {
  return {
    requestedEndpoint: REQUESTED_ENDPOINT,
    nowMs: 1042,
    maxFreshnessMs: 160,
    webcam: {
      source: 'live_webcam',
      visible: true,
      blank: false,
      frameId: 'operator-webcam-001',
      width: 1280,
      height: 720,
    },
    consumer: {
      id: 'lerms-hand-surface-field',
      schema: 'lerms.hand-surface-lerm-witness.v0',
      ownership: 'consumer',
    },
    attachments: [
      { id: 'red-lerm-palm', kind: 'lerm_placeholder', face: [0, 5, 9], barycentric: [0.22, 0.34, 0.44] },
      { id: 'yellow-lerm-index', kind: 'lerm_placeholder', face: [5, 6, 10], barycentric: [0.18, 0.48, 0.34] },
    ],
    sceneDepth: { requested: false },
    ...overrides,
  };
}

function assertDowngrade(report, code) {
  assert.ok(report.downgrades.some((entry) => entry.code === code), `expected downgrade ${code}`);
}

const report = composeTrackedHandSurface(livePacket(), liveOptions());

assert.equal(report.schema, 'kaminos.tracked-hand-surface-compositor.v0');
assert.equal(report.authority, 'live_tracked_hand_surface');
assert.equal(report.sourceTruth.sourceSchema, 'perceptasia.hand-control.v0');
assert.equal(report.sourceTruth.endpoint.requested, REQUESTED_ENDPOINT);
assert.equal(report.sourceTruth.endpoint.effective, REQUESTED_ENDPOINT);
assert.equal(report.sourceTruth.backendIdentity, LIVE_BACKEND);
assert.equal(report.surface.status, 'valid');
assert.equal(report.surface.surfaceSource, 'landmark_surface');
assert.equal(report.surface.landmarks2d.length, 21);
assert.ok(report.surface.faces.length > 0);
assert.equal(report.consumerBridge.consumerId, 'lerms-hand-surface-field');
assert.equal(report.consumerBridge.ownership, 'consumer');
assert.equal(report.consumerBridge.sourceTruthOwner, 'kaminos');
assert.equal(report.attachments.every((attachment) => attachment.mode === 'hand_surface'), true);
assert.deepEqual(report.falseAuthorityViolations, []);

const denseReport = composeTrackedHandSurface(
  livePacket({
    mano: {
      contract: 'wilor-mlx.mano.dense.v0',
      coordinate_space: 'wilor_camera_normalized',
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        { x: 0, y: 0.1, z: 0 },
      ],
      faces: [[0, 1, 2]],
    },
  }),
  liveOptions(),
);

assert.equal(denseReport.surface.surfaceSource, 'dense_mano');
assert.equal(denseReport.surface.denseMano.present, true);
assert.equal(denseReport.surface.denseMano.contract, 'wilor-mlx.mano.dense.v0');
assert.equal(denseReport.surface.denseMano.vertexCount, 3);
assert.equal(denseReport.surface.denseMano.faceCount, 1);

const replayReport = composeTrackedHandSurface(
  livePacket({
    sourceBackend: 'native_wilor_mini_mps_sidecar_replay',
    effectiveRoute: 'wilor_mini_mps_saved_image_replay',
  }),
  liveOptions(),
);

assert.equal(replayReport.authority, 'synthetic_or_replay_surface');
assertDowngrade(replayReport, 'hand_backend_not_live_wilor');
assert.ok(replayReport.falseAuthorityViolations.includes('consumer_must_not_claim_live_from_replay_backend'));

const staleReport = composeTrackedHandSurface(
  livePacket({ timestampMs: 700 }),
  liveOptions({ nowMs: 1042, maxFreshnessMs: 160 }),
);

assert.equal(staleReport.freshness.status, 'stale');
assert.equal(staleReport.authority, 'synthetic_or_replay_surface');
assertDowngrade(staleReport, 'stale_hand_packet');

const noGeometryReport = composeTrackedHandSurface(
  livePacket({ landmarks2d: [], worldLandmarks: [] }),
  liveOptions(),
);

assert.equal(noGeometryReport.authority, 'invalid');
assert.equal(noGeometryReport.surface.status, 'invalid');
assertDowngrade(noGeometryReport, 'missing_hand_surface_frame');

const stickerReport = composeTrackedHandSurface(
  livePacket(),
  liveOptions({
    attachments: [
      { id: 'screen-sticker', mode: 'screen_space', screen: { x: 0.5, y: 0.5 } },
    ],
  }),
);

assert.equal(stickerReport.authority, 'invalid');
assert.equal(stickerReport.attachments[0].mode, 'screen_space_rejected');
assertDowngrade(stickerReport, 'screen_space_attachment_rejected');

const sceneDepthReport = composeTrackedHandSurface(
  livePacket(),
  liveOptions({
    sceneDepth: { requested: true, effectiveRoute: null, ageMs: null },
  }),
);

assert.equal(sceneDepthReport.authority, 'live_tracked_hand_surface_scene_depth_downgraded');
assertDowngrade(sceneDepthReport, 'scene_depth_requested_unavailable');

const blankReport = composeTrackedHandSurface(
  livePacket(),
  liveOptions({
    webcam: {
      source: 'live_webcam',
      visible: true,
      blank: true,
      frameId: 'blank-webcam',
      width: 1280,
      height: 720,
    },
  }),
);

assert.equal(blankReport.authority, 'invalid');
assertDowngrade(blankReport, 'blank_or_hidden_webcam');

const svg = renderTrackedHandSurfaceWitnessSvg(report, { width: 960, height: 540 });
assert.match(svg, /kaminos-tracked-hand-surface-witness/);
assert.match(svg, /webcam-ground-truth/);
assert.match(svg, /hand-surface-frame/);
assert.match(svg, /consumer: lerms-hand-surface-field/);
assert.match(svg, /red-lerm-palm/);
assert.doesNotMatch(svg, /screen-space-sticker-success/);

console.log('ok - hand-surface compositor contracts');
