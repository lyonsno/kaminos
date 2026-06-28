import assert from 'node:assert/strict';

import {
  buildConditioningRouteRequest,
} from '../conditioning-route-request.mjs';
import {
  addRouteRun,
  updateRouteRun,
  createTray,
} from '../route-composition-tray.mjs';
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
