import assert from 'node:assert/strict';

import {
  buildConditioningRouteRequest,
} from '../conditioning-route-request.mjs';
import {
  addRouteRun,
  appendOutputArtifact,
  updateRouteRun,
  createTray,
} from '../route-composition-tray.mjs';
import {
  MOGE_DEPTH_NORMAL_ROUTE_ID,
  createMogeDepthNormalRouteReceipt,
} from '../webgpu-inference-kit/src/index.js';
import {
  createFixturePrimitiveSpecimenCheckpoint,
  exportSpecimenCheckpointViews,
} from '../specimen-checkpoint.mjs';
import {
  SPECIMEN_PACKET_COCKPIT_SCHEMA,
  buildSpecimenPacketCockpit,
  tagSpecimenPacketFailure,
  buildNextSpecimenPacketRouteRequest,
  refreshSpecimenPacketCockpitFromRouteEvidence,
  specimenPacketCockpitWitness,
} from '../specimen-packet-cockpit.mjs';

const checkpoint = createFixturePrimitiveSpecimenCheckpoint();
const viewArtifacts = exportSpecimenCheckpointViews(checkpoint);
const request = buildConditioningRouteRequest({
  requestId: 'fixture-red-lerm-conditioning-request-001',
  checkpoint,
  viewArtifacts,
  requestedRoute: 'image_conditioned_generation',
  intendedEffectiveRoute: 'request_only',
  prompt: 'matte red eyeless lerm, soft sensing nub, squat carrier body',
  seed: 270627,
  routeConfig: {
    scheduler: 'fixture-request',
    strength: 0.62,
  },
  runtimeIdentity: {
    runtime: 'node-contract-test',
    routeAdapter: 'none-request-only',
  },
});

let tray = createTray({ trayId: 'packet-cockpit-tray' });
tray = addRouteRun(tray, {
  runId: request.requestId,
  requestedRoute: request.requestedRoute,
  effectiveRoute: request.intendedEffectiveRoute,
  backendClass: request.runtimeIdentity.routeAdapter,
  statusBadge: 'fixture',
  routePhase: 'completed',
  receiptId: request.requestId,
  inputArtifactIds: request.inputArtifactIds,
  conditioningArtifactIds: Object.values(request.conditioningArtifactIds),
});
tray = updateRouteRun(tray, {
  runId: 'sharp-run-failed-for-packet',
  requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
  effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
  backendClass: 'browser-webgpu',
  statusBadge: 'failed',
  routePhase: 'failed',
  receiptId: '/tmp/kaminos/sharp-run-failed-for-packet/report.json',
  inputArtifactIds: [request.inputArtifactIds[0]],
  conditioningArtifactIds: Object.values(request.conditioningArtifactIds),
});

const packet = buildSpecimenPacketCockpit({
  packetId: 'packet-red-lerm-001',
  checkpoint,
  viewArtifacts,
  routeRequests: [request],
  tray,
});

assert.equal(SPECIMEN_PACKET_COCKPIT_SCHEMA, 'kaminos.kiln.specimen-packet-cockpit.v0');
assert.equal(packet.schema, SPECIMEN_PACKET_COCKPIT_SCHEMA);
assert.equal(packet.packetId, 'packet-red-lerm-001');
assert.equal(packet.specimenKind, 'red_lerm');
assert.equal(packet.firstVerticalRole, 'carrier_actor');
assert.deepEqual(packet.truthLayers.map(layer => layer.viewKind), ['beauty', 'depth', 'normal', 'silhouette', 'mask']);
assert.ok(packet.truthLayers.every(layer => layer.sourceTruthWarnings.includes('fixture_primitive_not_live_sculpt_truth')));
assert.ok(packet.regionLaw.some(region => region.role === 'sacred_no_face_cap'));
assert.ok(packet.negativeLaw.includes('no_visible_eyes'));
assert.equal(packet.routeRequests.length, 1);
assert.equal(packet.routeRuns.length, 2);
assert.ok(packet.activityStates.some(state => state.activityState === 'failed'));
assert.ok(packet.lineageReceipts.some(receipt => receipt.receiptId === '/tmp/kaminos/sharp-run-failed-for-packet/report.json'));
assert.ok(packet.sourceTruthWarnings.includes('route_request_not_generator_execution_truth'));

const failed = tagSpecimenPacketFailure(packet, {
  tag: 'added_face',
  targetId: 'sharp-run-failed-for-packet',
  note: 'Candidate tried to install eyes and a mouth.',
});

assert.equal(failed.failureTags.length, 1);
assert.equal(failed.failureTags[0].tag, 'added_face');
assert.deepEqual(failed.negativeLawPatch.added, ['no_visible_eyes', 'no_mouth', 'do_not_install_face']);
assert.ok(failed.negativeLaw.includes('no_visible_eyes'));
assert.ok(failed.negativeLaw.includes('do_not_install_face'));
assert.ok(failed.cockpitSummary.nextRequestCarriesFailureLaw, 'failure tag must strengthen the next request law');

const nextRequest = buildNextSpecimenPacketRouteRequest(failed, request);
assert.equal(nextRequest.sourcePacketId, 'packet-red-lerm-001');
assert.equal(nextRequest.previousRouteRequestId, request.requestId);
assert.deepEqual(nextRequest.failureTagIds, [failed.failureTags[0].failureTagId]);
assert.ok(nextRequest.negativeLaw.includes('do_not_install_face'));
assert.ok(nextRequest.negativeLawPatch.added.includes('do_not_install_face'));
assert.ok(nextRequest.sourceTruthWarnings.includes('route_request_strengthened_by_failure_tags'));

const witness = specimenPacketCockpitWitness(failed);
assert.equal(witness.schema, 'kaminos.kiln.specimen-packet-cockpit-witness.v0');
assert.equal(witness.ok, true);
assert.equal(witness.packetId, 'packet-red-lerm-001');
assert.equal(witness.truthLayerCount, 5);
assert.equal(witness.routeRunCount, 2);
assert.equal(witness.failureTagCount, 1);
assert.equal(witness.nextRequestCarriesFailureLaw, true);

const liveTray = updateRouteRun(tray, {
  runId: 'sharp-live-run-001',
  requestedRoute: 'adapter.sharp-image-to-splat-live.v0',
  effectiveRoute: 'adapter.sharp-image-to-splat-live.v0',
  backendClass: 'browser-webgpu',
  statusBadge: 'real',
  routePhase: 'completed',
  receiptId: '/tmp/kaminos/sharp-live-run-001/report.json',
  inputArtifactIds: [request.inputArtifactIds[0]],
  conditioningArtifactIds: Object.values(request.conditioningArtifactIds),
  outputArtifactIds: ['sharp-live-run-001-splat'],
});

const livePacket = refreshSpecimenPacketCockpitFromRouteEvidence(failed, {
  checkpoint,
  viewArtifacts,
  routeRequests: [nextRequest],
  tray: {
    ...liveTray,
    outputArtifacts: [
      ...liveTray.outputArtifacts,
      {
        schema: 'kaminos.kiln.tray-artifact-entry.v0',
        artifactId: 'sharp-live-run-001-splat',
        title: 'SHARP live splat candidate',
        sourceKind: 'generated',
        routeRunId: 'sharp-live-run-001',
        mimeType: 'model/ply',
        source: '/tmp/kaminos/sharp-live-run-001/output.ply',
        sourceTruthWarnings: [],
      },
    ],
  },
});

assert.equal(livePacket.packetId, failed.packetId, 'live route refresh must preserve packet identity');
assert.ok(livePacket.routeRuns.some(run => run.runId === 'sharp-live-run-001' && run.statusBadge === 'real'));
assert.ok(livePacket.activityStates.some(state => state.activityState === 'cooled' && state.truthMode === 'live'));
assert.ok(livePacket.candidateArtifacts.some(candidate => candidate.candidateArtifactId === 'sharp-live-run-001-splat'));
assert.ok(livePacket.lineageReceipts.some(receipt => receipt.receiptId === '/tmp/kaminos/sharp-live-run-001/report.json'));
assert.ok(livePacket.failureTags.some(tag => tag.tag === 'added_face'), 'live route refresh must not erase prior failure tags');
assert.ok(livePacket.negativeLawPatch.added.includes('do_not_install_face'), 'live route refresh must preserve strengthened law');

const mogeReceipt = createMogeDepthNormalRouteReceipt({
  input: {
    artifactId: request.inputArtifactIds[0],
    sha256: 'sha256:source-image',
    shape: [518, 518, 3],
  },
  outputs: {
    depth: { artifactId: 'moge-depth-red-lerm-001', sha256: 'sha256:depth', shape: [592, 592], status: 'partial' },
    normal: { artifactId: 'moge-normal-red-lerm-001', sha256: 'sha256:normal', shape: [3, 592, 592], status: 'partial' },
    pointMap: { artifactId: 'moge-pointmap-red-lerm-001', sha256: 'sha256:pointmap', shape: [3, 592, 592], status: 'partial' },
  },
  backend: {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: 'Apple M4 Max',
    browser: 'Chrome Headless',
    features: ['shader-f16'],
    requestedFeatures: [],
    limits: { maxBufferSize: 4294967296 },
    timestampQuery: 'unavailable',
  },
  model: {
    revision: 'local-vitl-normal',
    weightsHash: 'sha256:weights',
    dtype: 'fp16',
  },
  kernel: {
    profile: 'conv-transpose2d-stride2',
    commit: '15d2dea',
  },
  profile: {
    schema: 'kaminos.webgpu-staged-profile.v0',
    route: 'staged-submits',
    timingSource: 'queue-submit-wait',
    requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
    stages: [
      { name: 'backbone', ms: 997.6 },
      { name: 'decoder-heads', ms: 854.3 },
      { name: 'output-readback', ms: 1.9 },
    ],
    stageNames: ['backbone', 'decoder-heads', 'output-readback'],
    totalMs: 1853.8,
  },
});

let mogeTray = updateRouteRun(tray, {
  runId: 'moge-depth-normal-red-lerm-001',
  requestedRoute: MOGE_DEPTH_NORMAL_ROUTE_ID,
  effectiveRoute: MOGE_DEPTH_NORMAL_ROUTE_ID,
  backendClass: 'webgpu-local',
  statusBadge: 'partial',
  routePhase: 'completed',
  receiptId: 'moge-depth-normal-red-lerm-001-receipt',
  inputArtifactIds: [request.inputArtifactIds[0]],
  outputArtifactIds: ['moge-depth-red-lerm-001', 'moge-normal-red-lerm-001', 'moge-pointmap-red-lerm-001'],
  routeReceipt: mogeReceipt,
});
for (const artifact of mogeReceipt.outputs) {
  mogeTray = appendOutputArtifact(mogeTray, {
    artifactId: artifact.artifactId,
    title: `MoGE ${artifact.role}`,
    sourceKind: 'browser-local',
    routeRunId: 'moge-depth-normal-red-lerm-001',
    mimeType: artifact.role === 'pointmap' ? 'application/x-kaminos-pointmap' : 'image/png',
    conditioningRoles: artifact.role === 'depth'
      ? ['depth_source']
      : artifact.role === 'normal'
        ? ['normal_source']
        : ['pointmap_source'],
    viewKind: artifact.role,
    packetBindingRole: 'truth-layer',
    routeReceipt: mogeReceipt,
    sourceTruthWarnings: ['anonymous_imagedata_receipt_partial'],
  });
}

const mogePacket = refreshSpecimenPacketCockpitFromRouteEvidence(failed, {
  checkpoint,
  viewArtifacts,
  routeRequests: [nextRequest],
  tray: mogeTray,
});

assert.ok(mogePacket.routeRuns.some(run => run.requestedRoute === MOGE_DEPTH_NORMAL_ROUTE_ID && run.backendClass === 'webgpu-local'));
assert.ok(mogePacket.truthLayers.some(layer => layer.viewKind === 'depth' && layer.artifactId === 'moge-depth-red-lerm-001'));
assert.ok(mogePacket.truthLayers.some(layer => layer.viewKind === 'normal' && layer.artifactId === 'moge-normal-red-lerm-001'));
assert.ok(mogePacket.truthLayers.some(layer => layer.viewKind === 'pointmap' && layer.artifactId === 'moge-pointmap-red-lerm-001'));
assert.ok(!mogePacket.candidateArtifacts.some(candidate => candidate.candidateArtifactId === 'moge-depth-red-lerm-001'), 'MoGE truth-layer outputs must not masquerade as candidate concept artifacts');
assert.ok(mogePacket.lineageReceipts.some(receipt => receipt.schema === 'kaminos.webgpu-route-receipt.v0' && receipt.requestedRoute === MOGE_DEPTH_NORMAL_ROUTE_ID));
assert.ok(mogePacket.sourceTruthWarnings.includes('anonymous_imagedata_receipt_partial'));
