import {
  CONDITIONING_ROUTE_REQUEST_SCHEMA,
} from './conditioning-route-request.mjs';
import {
  SPECIMEN_CHECKPOINT_SCHEMA,
  SPECIMEN_VIEW_KINDS,
} from './specimen-checkpoint.mjs';

export const SPECIMEN_PACKET_COCKPIT_SCHEMA = 'kaminos.kiln.specimen-packet-cockpit.v0';

export const SPECIMEN_PACKET_FAILURE_TAGS = [
  'added_face',
  'mascot_drift',
  'lost_silhouette',
  'wrong_limb_count',
  'material_glass_collapse',
  'pose_law_broken',
  'topology_unusable',
  'source_truth_too_weak',
  'good_reference_bad_identity',
  'route_failed',
];

const FAILURE_NEGATIVE_LAW_PATCHES = {
  added_face: ['no_visible_eyes', 'no_mouth', 'do_not_install_face'],
  mascot_drift: ['avoid_mascot_face', 'preserve_specimen_silhouette'],
  lost_silhouette: ['preserve_silhouette_from_mask'],
  wrong_limb_count: ['preserve_limb_count_from_region_law'],
  material_glass_collapse: ['matte_body_material_not_glass'],
  pose_law_broken: ['preserve_specimen_pose_law'],
  topology_unusable: ['prefer_smooth_low_appendage_topology'],
  source_truth_too_weak: ['require_stronger_source_truth'],
  good_reference_bad_identity: ['preserve_source_identity_over_reference_style'],
  route_failed: ['avoid_failed_route_until_backend_ready'],
};

function unique(values) {
  return [...new Set((values || []).map(value => String(value)).filter(Boolean))];
}

function receiptFromRouteReceipt(receipt, fallbackId) {
  if (!receipt) return null;
  if (receipt.schema === 'kaminos.webgpu-route-receipt.v0') {
    return {
      schema: receipt.schema,
      receiptId: fallbackId || receipt.receiptId || `${receipt.requestedRouteId}:${receipt.createdAt || 'unversioned'}`,
      requestedRoute: receipt.requestedRouteId || null,
      effectiveRoute: receipt.effectiveRouteId || null,
      runtime: [receipt.backend?.kind, receipt.backend?.runtime].filter(Boolean).join(':') || null,
      fallbackReason: receipt.fallbackReason || null,
      sourceTruthWarnings: [
        ...(receipt.sourceTruthWarnings || []),
        ...((receipt.outputs || []).some(output => output.status === 'partial') ? ['anonymous_imagedata_receipt_partial'] : []),
      ],
    };
  }
  return {
    schema: receipt.schema || null,
    receiptId: receipt.receiptId || fallbackId || receipt.requestedRoute || null,
    requestedRoute: receipt.requestedRoute || null,
    effectiveRoute: receipt.effectiveRoute || null,
    runtime: receipt.runtime || null,
    fallbackReason: receipt.fallbackReason || null,
    sourceTruthWarnings: receipt.sourceTruthWarnings || [],
  };
}

function lineageReceipts({ checkpoint, viewArtifacts, routeRequests, routeRuns }) {
  const receipts = [];
  const pushReceipt = (receipt, fallbackId, kind) => {
    const normalized = receiptFromRouteReceipt(receipt, fallbackId);
    if (!normalized?.receiptId && !normalized?.requestedRoute) return;
    receipts.push({ ...normalized, kind });
  };
  pushReceipt(checkpoint?.routeReceipt, checkpoint?.specimenId, 'specimen-checkpoint');
  for (const artifact of viewArtifacts || []) {
    pushReceipt(artifact.routeReceipt, artifact.artifactId, 'truth-layer');
  }
  for (const request of routeRequests || []) {
    pushReceipt(request.routeReceipt, request.requestId, 'route-request');
  }
  for (const run of routeRuns || []) {
    const normalized = receiptFromRouteReceipt(run.routeReceipt, run.receiptId || run.runId);
    receipts.push(normalized ? {
      ...normalized,
      kind: 'route-run',
      sourceTruthWarnings: unique([...(normalized.sourceTruthWarnings || []), ...(run.sourceTruthWarnings || [])]),
    } : {
      kind: 'route-run',
      receiptId: run.receiptId || run.runId,
      requestedRoute: run.requestedRoute || null,
      effectiveRoute: run.effectiveRoute || null,
      runtime: run.backendClass || null,
      fallbackReason: null,
      sourceTruthWarnings: run.sourceTruthWarnings || [],
    });
  }
  const seen = new Set();
  return receipts.filter(receipt => {
    const key = `${receipt.kind}:${receipt.receiptId}:${receipt.requestedRoute}:${receipt.effectiveRoute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truthLayersFromViews(viewArtifacts) {
  return SPECIMEN_VIEW_KINDS.map(viewKind => {
    const artifact = (viewArtifacts || []).find(candidate => candidate.viewKind === viewKind);
    if (!artifact) return null;
    return {
      truthLayerId: artifact.artifactId,
      viewKind,
      sourceKind: artifact.sourceKind || artifact.imageArtifact?.sourceKind || null,
      artifactId: artifact.artifactId,
      imageArtifactId: artifact.imageArtifact?.artifactId || artifact.artifactId,
      conditioningRoles: artifact.conditioningRoles || [],
      routeReceipt: artifact.routeReceipt || artifact.imageArtifact?.routeReceipt || null,
      sourceTruthWarnings: artifact.sourceTruthWarnings || artifact.imageArtifact?.sourceTruthWarnings || [],
    };
  }).filter(Boolean);
}

function truthLayersFromTrayOutputs(tray) {
  return (tray?.outputArtifacts || [])
    .filter(artifact => artifact.packetBindingRole === 'truth-layer')
    .map(artifact => ({
      truthLayerId: artifact.artifactId,
      viewKind: artifact.viewKind || artifact.outputRole || null,
      sourceKind: artifact.sourceKind || null,
      artifactId: artifact.artifactId,
      imageArtifactId: artifact.artifactId,
      conditioningRoles: artifact.conditioningRoles || [],
      routeReceipt: artifact.routeReceipt || null,
      sourceTruthWarnings: artifact.sourceTruthWarnings || [],
      shape: artifact.shape || null,
      sha256: artifact.sha256 || null,
      status: artifact.status || null,
    }))
    .filter(layer => layer.viewKind);
}

function candidateArtifactsFromTray(tray) {
  return (tray?.outputArtifacts || [])
    .filter(artifact => artifact.packetBindingRole !== 'truth-layer')
    .map(artifact => ({
      candidateArtifactId: artifact.artifactId,
      title: artifact.title || artifact.artifactId,
      sourceKind: artifact.sourceKind || null,
      routeRunId: artifact.routeRunId || null,
      sourceTruthWarnings: artifact.sourceTruthWarnings || [],
    }));
}

function activityStatesFromRuns(routeRuns) {
  return (routeRuns || []).map(run => run.kilnActivity).filter(Boolean);
}

function cockpitSummary(packet) {
  const negativeLawPatchAdded = packet.negativeLawPatch?.added || [];
  return {
    northStar: 'one specimen gets smarter after a bad route pass',
    currentRouteAttemptId: packet.routeRuns.at(-1)?.runId || packet.routeRuns[0]?.runId || null,
    currentActivityState: packet.activityStates.at(-1)?.activityState || packet.activityStates[0]?.activityState || 'cold',
    hasCandidateOrFailure: packet.candidateArtifacts.length > 0 || packet.failureTags.length > 0 || packet.routeRuns.some(run => run.statusBadge === 'failed'),
    nextRequestCarriesFailureLaw: negativeLawPatchAdded.length > 0,
  };
}

export function buildSpecimenPacketCockpit({
  packetId,
  checkpoint,
  viewArtifacts = [],
  routeRequests = [],
  routeRuns = null,
  tray = null,
  candidateArtifacts = null,
  failureTags = [],
  negativeLawPatch = { added: [] },
  promotionState = 'bench_evidence',
} = {}) {
  if (!packetId) throw new Error('packetId is required');
  if (checkpoint?.schema !== SPECIMEN_CHECKPOINT_SCHEMA) throw new Error('valid specimen checkpoint is required');
  const truthLayers = [
    ...truthLayersFromViews(viewArtifacts),
    ...truthLayersFromTrayOutputs(tray),
  ];
  const runs = routeRuns || tray?.routeRuns || [];
  const candidates = candidateArtifacts || candidateArtifactsFromTray(tray);
  const sourceArtifacts = truthLayers
    .filter(layer => layer.viewKind === 'beauty')
    .map(layer => ({
      artifactId: layer.imageArtifactId || layer.artifactId,
      truthLayerId: layer.truthLayerId,
      sourceKind: layer.sourceKind,
      sourceTruthWarnings: layer.sourceTruthWarnings,
    }));
  const sourceTruthWarnings = unique([
    ...(checkpoint.sourceTruthWarnings || []),
    ...truthLayers.flatMap(layer => layer.sourceTruthWarnings || []),
    ...routeRequests.flatMap(request => request.sourceTruthWarnings || []),
    ...runs.flatMap(run => run.sourceTruthWarnings || []),
    ...candidates.flatMap(candidate => candidate.sourceTruthWarnings || []),
  ]);
  const packet = {
    schema: SPECIMEN_PACKET_COCKPIT_SCHEMA,
    packetId,
    specimenKind: checkpoint.specimenKind,
    firstVerticalRole: checkpoint.firstVerticalRole,
    checkpointId: checkpoint.specimenId,
    sourceArtifacts,
    truthLayers,
    regionLaw: checkpoint.regionMasks || [],
    negativeLaw: unique([
      ...(checkpoint.negativeLaw || []),
      ...(negativeLawPatch.added || []),
    ]),
    routeRequests: routeRequests.filter(request => request?.schema === CONDITIONING_ROUTE_REQUEST_SCHEMA),
    routeRuns: runs,
    candidateArtifacts: candidates,
    failureTags,
    activityStates: activityStatesFromRuns(runs),
    promotionState,
    negativeLawPatch: {
      added: unique(negativeLawPatch.added || []),
    },
    lineageReceipts: lineageReceipts({ checkpoint, viewArtifacts, routeRequests, routeRuns: runs }),
    sourceTruthWarnings,
  };
  packet.cockpitSummary = cockpitSummary(packet);
  return packet;
}

export function tagSpecimenPacketFailure(packet, { tag, targetId, note = '' } = {}) {
  if (!packet?.packetId) throw new Error('valid specimen packet is required');
  if (!SPECIMEN_PACKET_FAILURE_TAGS.includes(tag)) throw new Error(`unknown specimen failure tag: ${tag}`);
  const failureTag = {
    failureTagId: `${packet.packetId}-failure-${String(packet.failureTags?.length || 0).padStart(2, '0')}-${tag}`,
    tag,
    targetId: targetId || null,
    note,
    createdAt: new Date().toISOString(),
  };
  const added = unique([
    ...(packet.negativeLawPatch?.added || []),
    ...(FAILURE_NEGATIVE_LAW_PATCHES[tag] || []),
  ]);
  const updated = {
    ...packet,
    failureTags: [...(packet.failureTags || []), failureTag],
    negativeLawPatch: { added },
    negativeLaw: unique([...(packet.negativeLaw || []), ...added]),
  };
  updated.cockpitSummary = cockpitSummary(updated);
  return updated;
}

export function buildNextSpecimenPacketRouteRequest(packet, previousRequest) {
  if (!packet?.packetId) throw new Error('valid specimen packet is required');
  if (!previousRequest?.requestId) throw new Error('previous route request is required');
  const failureTagIds = (packet.failureTags || []).map(tag => tag.failureTagId);
  return {
    ...previousRequest,
    requestId: `${packet.packetId}-next-request-${String(failureTagIds.length).padStart(2, '0')}`,
    sourcePacketId: packet.packetId,
    previousRouteRequestId: previousRequest.requestId,
    failureTagIds,
    negativeLaw: unique([...(previousRequest.negativeLaw || []), ...(packet.negativeLawPatch?.added || [])]),
    negativeLawPatch: { added: unique(packet.negativeLawPatch?.added || []) },
    sourceTruthWarnings: unique([
      ...(previousRequest.sourceTruthWarnings || []),
      'route_request_strengthened_by_failure_tags',
    ]),
  };
}

export function refreshSpecimenPacketCockpitFromRouteEvidence(packet, {
  checkpoint,
  viewArtifacts = [],
  routeRequests = null,
  routeRuns = null,
  tray = null,
  candidateArtifacts = null,
} = {}) {
  if (!packet?.packetId) throw new Error('valid specimen packet is required');
  return buildSpecimenPacketCockpit({
    packetId: packet.packetId,
    checkpoint,
    viewArtifacts,
    routeRequests: routeRequests || packet.routeRequests || [],
    routeRuns,
    tray,
    candidateArtifacts,
    failureTags: packet.failureTags || [],
    negativeLawPatch: packet.negativeLawPatch || { added: [] },
    promotionState: packet.promotionState || 'bench_evidence',
  });
}

export function specimenPacketCockpitWitness(packet) {
  const viewKinds = (packet?.truthLayers || []).map(layer => layer.viewKind);
  const nextRequestCarriesFailureLaw = Boolean(packet?.cockpitSummary?.nextRequestCarriesFailureLaw);
  const ok = packet?.schema === SPECIMEN_PACKET_COCKPIT_SCHEMA
    && Boolean(packet.packetId)
    && SPECIMEN_VIEW_KINDS.every(kind => viewKinds.includes(kind))
    && (packet.routeRequests?.length || 0) >= 1
    && (packet.routeRuns?.length || 0) >= 1
    && ((packet.candidateArtifacts?.length || 0) >= 1 || (packet.failureTags?.length || 0) >= 1 || packet.routeRuns.some(run => run.statusBadge === 'failed'))
    && nextRequestCarriesFailureLaw;
  return {
    schema: 'kaminos.kiln.specimen-packet-cockpit-witness.v0',
    ok,
    packetId: packet?.packetId || null,
    specimenKind: packet?.specimenKind || null,
    firstVerticalRole: packet?.firstVerticalRole || null,
    truthLayerCount: packet?.truthLayers?.length || 0,
    routeRequestCount: packet?.routeRequests?.length || 0,
    routeRunCount: packet?.routeRuns?.length || 0,
    candidateArtifactCount: packet?.candidateArtifacts?.length || 0,
    failureTagCount: packet?.failureTags?.length || 0,
    nextRequestCarriesFailureLaw,
    sourceTruthWarnings: packet?.sourceTruthWarnings || [],
  };
}
