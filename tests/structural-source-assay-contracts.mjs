import assert from 'node:assert/strict';

import * as structuralAssay from '../structural-source-assay-core.mjs';
import {
  STRUCTURAL_GENERATION_MANIFEST_SCHEMA,
  STRUCTURAL_SOURCE_ASSAY_SCHEMA,
  STRUCTURAL_SOURCE_VALIDATION_SCHEMA,
  buildStructuralSourceGenerationManifest,
  validateStructuralSourceAssay,
  validateStructuralSourceGate,
} from '../structural-source-assay-core.mjs';
import {
  ASSET_ARRIVAL_FAILURE_SCHEMA,
  ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA,
  ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
  ASSET_ARRIVAL_SOURCE_SCHEMA,
  buildAssetArrivalProjectionPlan,
} from '../asset-arrival-projection-compiler-core.mjs';

const HASH = {
  asset: '0'.repeat(64),
  hierarchy: '1'.repeat(64),
  topology: '2'.repeat(64),
  semantic: '3'.repeat(64),
  distal: '4'.repeat(64),
  attachment: '5'.repeat(64),
  unrelated: '6'.repeat(64),
  camera: '7'.repeat(64),
  crop: '8'.repeat(64),
  prompt: '9'.repeat(64),
  frame: 'a'.repeat(64),
  materialCoordinates: 'b'.repeat(64),
  station: 'c'.repeat(64),
  denominator: 'd'.repeat(64),
  roleCoreMask: 'e'.repeat(64),
  roleDilatedMask: 'f'.repeat(64),
};

const RELATION_PARENT = 0.3;
const RELATION_LOWER = 0.22;
const RELATION_UPPER = 0.38;
const RELATION_MAX_DELTA = 0.05;
const RELATION_DELTA = Math.min(
  RELATION_MAX_DELTA,
  0.5 * Math.min(RELATION_UPPER - RELATION_PARENT, RELATION_PARENT - RELATION_LOWER),
);
const variantValues = {
  parent: RELATION_PARENT,
  positive: RELATION_PARENT + RELATION_DELTA,
  negative: RELATION_PARENT - RELATION_DELTA,
};

function channelsFor(rungId) {
  if (rungId === 'L') {
    return [
      { id: 'clay', area: 1200, l1Energy: 0.8, l2Energy: 1, weight: 0.4 },
      { id: 'depth', area: 1200, l1Energy: 0.7, l2Energy: 1, weight: 0.35 },
      { id: 'normal', area: 1200, l1Energy: 0.5, l2Energy: 1, weight: 0.25 },
    ];
  }
  return [
    { id: 'clay', area: 1200, l1Energy: 0.8, l2Energy: 1, weight: 0.32 },
    { id: 'depth', area: 1200, l1Energy: 0.7, l2Energy: 1, weight: 0.28 },
    { id: 'normal', area: 1200, l1Energy: 0.5, l2Energy: 1, weight: 0.2 },
    { id: 'semantic-role-mask', area: 310, l1Energy: 1, l2Energy: 1, weight: 0.2 },
  ];
}

function makeCell(rungId, variant, index) {
  return {
    id: `${rungId}_${variant}`,
    rungId,
    variant,
    editSign: variant === 'positive' ? 1 : variant === 'negative' ? -1 : 0,
    relationValue: variantValues[variant],
    relationRegionId: 'left-posterior-hip-cup',
    sourceSpillover: 0.004,
    sourceChecks: {
      occupiedFit: true,
      rigidClearance: true,
      attachmentContinuity: true,
      distalSupportFixed: true,
      conservativeSweep: true,
    },
    identities: {
      hierarchyHash: HASH.hierarchy,
      topologyHash: HASH.topology,
      semanticIdsHash: HASH.semantic,
      distalSupportHash: HASH.distal,
      attachmentHash: HASH.attachment,
      unrelatedGeometryHash: HASH.unrelated,
    },
    projectionIdentity: {
      id: `hip-cup-station:${rungId}:${variant}`,
      trackId: 'hip-cup-relational-sensitivity-v0',
      sourceAssetId: 'lerm-adjacent-source-v0',
      sourceAssetHash: HASH.asset,
      stationInstanceId: 'golden-hip-cup-station-v0',
      stationHash: HASH.station,
      cameraHash: HASH.camera,
      cropHash: HASH.crop,
      denominatorHash: HASH.denominator,
      roleCoreMaskHash: HASH.roleCoreMask,
      roleDilatedMaskHash: HASH.roleDilatedMask,
      foregroundMaskContractId: 'foreground-alpha-mask-v0',
      topologyHash: HASH.topology,
      semanticRoleIdsHash: HASH.semantic,
      materialCoordinatesHash: HASH.materialCoordinates,
    },
    channels: channelsFor(rungId),
    inputHash: String({ parent: 10, positive: 11, negative: 12 }[variant]).repeat(64).slice(0, 64),
  };
}

function makeAssay() {
  const cells = [];
  let index = 0;
  for (const rungId of ['L', 'H']) {
    for (const variant of ['parent', 'positive', 'negative']) {
      cells.push(makeCell(rungId, variant, index));
      index += 1;
    }
  }
  const assay = {
    schema: STRUCTURAL_SOURCE_ASSAY_SCHEMA,
    id: 'lerm-adjacent-hip-cup-signed-scout-v0',
    track: {
      id: 'hip-cup-relational-sensitivity-v0',
      kind: 'generator-relational-sensitivity',
      sourceAssignment: {
        authority: 'composition-owner',
        sourceAssetId: 'lerm-adjacent-source-v0',
        sourceAssetHash: HASH.asset,
      },
    },
    sourceGate: {
      assetId: 'lerm-adjacent-source-v0',
      assetHash: HASH.asset,
      units: 'meters',
      rootId: 'root',
      neutralStateId: 'neutral-v0',
      posedStateId: 'conservative-pose-v0',
      frame: {
        id: 'source-anatomical-frame-v0',
        hash: HASH.frame,
        handedness: 'right',
        origin: [0, 0, 0],
        anterior: [1, 0, 0],
        up: [0, 1, 0],
      },
      bendFrame: {
        id: 'left-posterior-hip-bend-frame-v0',
        origin: [0.3, 0.42, -0.2],
        axis: [0, 0, 1],
      },
      conservativeMotion: {
        id: 'hip-clearance-sweep-v0',
        neutralStateId: 'neutral-v0',
        posedStateId: 'conservative-pose-v0',
        collisionFree: true,
        supportPreserved: true,
      },
      attachmentIds: ['left-posterior-hip-attachment'],
      supportIds: ['left-hind-support'],
      materialCoordinatesHash: HASH.materialCoordinates,
      topologyHash: HASH.topology,
      semanticRoleIdsHash: HASH.semantic,
    },
    measurementStation: {
      schema: 'golden_object_measurement_station_instance.v1',
      contractRef: 'golden_object_measurement_station.v1',
      id: 'golden-hip-cup-station-v0',
      hash: HASH.station,
      sourceAssetId: 'lerm-adjacent-source-v0',
      sourceAssetHash: HASH.asset,
      neutralStateId: 'neutral-v0',
      posedStateId: 'conservative-pose-v0',
      frameHash: HASH.frame,
      cameraHash: HASH.camera,
      cropHash: HASH.crop,
      denominatorHash: HASH.denominator,
      roleCoreMaskHash: HASH.roleCoreMask,
      roleDilatedMaskHash: HASH.roleDilatedMask,
      foregroundMaskContractId: 'foreground-alpha-mask-v0',
      primaryRelationId: 'left-posterior-hip-cup-lateral-position',
      positiveDirection: [1, 0, 0],
      constructionStatus: 'instantiated',
      missingFields: [],
      failureCodes: [],
      contract_ref: 'golden_object_measurement_station.v1',
      station_instance_id: 'golden-hip-cup-station-v0',
      station_hash: HASH.station,
      asset_id: 'lerm-adjacent-source-v0',
      asset_hash: HASH.asset,
      asset_units: 'meters',
      neutral_state_id: 'neutral-v0',
      posed_state_id_or_missing: 'conservative-pose-v0',
      root_id: 'root',
      T_asset_to_body: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      body_frame_origin: [0, 0, 0],
      body_frame_axes: { x: [1, 0, 0], y: [0, 0, 1], z: [0, 1, 0] },
      tested_side: 'left',
      midline_plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
      pelvic_envelope_role_ids: ['pelvis'],
      pelvic_width: 0.48,
      pelvic_extremal_point_ids: ['pelvis-left', 'pelvis-right'],
      body_envelope_role_ids_or_missing: ['body'],
      body_length_or_missing: 1.8,
      socket_center: [0.3, 0.42, -0.2],
      socket_axis: [1, 0, 0],
      head_center_or_missing: [0.34, 0.42, -0.2],
      primary_relation_id_or_unresolved: 'left-posterior-hip-cup-lateral-position',
      positive_direction_or_unresolved: [1, 0, 0],
      camera_id: 'posterior_ortho_body_frame_v1',
      camera_projection: 'orthographic',
      world_to_camera_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      camera_to_raster_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      camera_crop: [0, 0, 1024, 1024],
      near_far: [0.01, 10],
      image_width: 1024,
      image_height: 1024,
      socket_station_row: 512,
      socket_station_band_rows: [499, 525],
      projected_midline_u: 0.5,
      projected_pelvic_width_pixels: 240,
      posterior_quarter_role_ids: ['pelvis', 'left-posterior-hip-attachment', 'left-hind-support'],
      role_core_mask_hash: HASH.roleCoreMask,
      role_dilated_mask_hash: HASH.roleDilatedMask,
      foreground_mask_contract_id: 'foreground-alpha-mask-v0',
      primary_measurement_scalar_id_or_unresolved: 'silhouette_half_width_over_pelvis',
      spillover_metric_id: 'linear_rgb_l2_role_dilated_v1',
      construction_status: 'instantiated',
      missing_fields: [],
      failure_codes: [],
    },
    target: {
      family: 'robust-plantigrade-lerm-adjacent-quadruped',
      sourceKind: 'author-controlled-constructional-exemplar',
      prompt: 'A robust quadrupedal creature in neutral profile.',
    },
    relation: {
      id: 'left-posterior-hip-cup-lateral-position',
      axis: 'x',
      regionId: 'left-posterior-hip-cup',
      parentValue: RELATION_PARENT,
      lowerBound: RELATION_LOWER,
      upperBound: RELATION_UPPER,
      maxDelta: RELATION_MAX_DELTA,
      delta: RELATION_DELTA,
      measurement: {
        kind: 'posterior-silhouette-half-width',
        station: 'source-projected-socket-axis',
        normalization: 'body-length',
      },
    },
    tolerances: {
      numeric: 1e-9,
      carrier: 1e-9,
      sourceSpilloverMax: 0.02,
    },
    frozen: {
      cameraHash: HASH.camera,
      cropHash: HASH.crop,
      denominatorHash: HASH.denominator,
      promptHash: HASH.prompt,
      seed: 719024,
      model: 'frozen-generator-model',
      checkpoint: 'frozen-generator-checkpoint',
      sampler: 'frozen-sampler',
      guidance: 4,
      resolution: [1024, 1024],
    },
    route: {
      requestedRouteId: 'frozen-image-generation-route',
      supportsBudgetNormalization: true,
    },
    rungs: [
      { id: 'L', enrichment: null, channelIds: ['clay', 'depth', 'normal'] },
      {
        id: 'H',
        enrichment: {
          channelId: 'semantic-role-mask',
          relationId: 'left-posterior-hip-cup-lateral-position',
        },
        channelIds: ['clay', 'depth', 'normal', 'semantic-role-mask'],
      },
    ],
    cells,
  };
  const digests = structuralAssay.measurementStationDigests(assay.measurementStation);
  assay.measurementStation.station_hash = digests.stationHash;
  assay.measurementStation.hash = digests.stationHash;
  assay.measurementStation.cameraHash = digests.cameraHash;
  assay.measurementStation.cropHash = digests.cropHash;
  assay.frozen.cameraHash = digests.cameraHash;
  assay.frozen.cropHash = digests.cropHash;
  for (const cell of assay.cells) {
    cell.projectionIdentity.stationHash = digests.stationHash;
    cell.projectionIdentity.cameraHash = digests.cameraHash;
    cell.projectionIdentity.cropHash = digests.cropHash;
  }
  return assay;
}

function clone(value) {
  return structuredClone(value);
}

function makeProjectionSource(assay) {
  const frame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const partRoles = ['socket-cup', 'joint-head', 'socket-axis'];
  return {
    schema: ASSET_ARRIVAL_SOURCE_SCHEMA,
    trackId: 'generator-relational-sensitivity',
    receiptId: 'hip-cup-relational-source-receipt-v0',
    asset: {
      id: assay.sourceGate.assetId,
      blendPath: '/caller/assigned/hip-cup-source.blend',
      blendSha256: assay.sourceGate.assetHash,
    },
    parts: partRoles.map((roleId, index) => ({
      roleId,
      objectName: `caller_${roleId}`,
      localFrame: frame,
      geometrySha256: String(index + 1).repeat(64),
    })),
    camera: {
      id: assay.measurementStation.camera_id,
      objectName: 'caller_projection_camera',
      localFrame: frame,
      projection: 'orthographic',
      width: assay.measurementStation.image_width,
      height: assay.measurementStation.image_height,
      cameraSha256: assay.frozen.cameraHash,
    },
    contract: { requiredPartRoleIds: partRoles },
    relation: {
      id: assay.relation.id,
      regionId: assay.relation.regionId,
      scalarId: assay.measurementStation.primary_measurement_scalar_id_or_unresolved,
      axisPartRoleId: 'socket-axis',
      participantRoleIds: ['socket-cup', 'joint-head'],
      parentValue: assay.relation.parentValue,
      delta: assay.relation.delta,
      lowerBound: assay.relation.lowerBound,
      upperBound: assay.relation.upperBound,
      maxDelta: assay.relation.maxDelta,
    },
    variants: Object.fromEntries(['parent', 'positive', 'negative'].map(variant => {
      const lowCell = assay.cells.find(cell => cell.id === `L_${variant}`);
      return [variant, {
        relationValue: lowCell.relationValue,
        sourceSceneId: `caller_scene_${variant}`,
        sourceInputHash: lowCell.inputHash,
        sourceSpillover: lowCell.sourceSpillover,
        sourceChecks: structuredClone(lowCell.sourceChecks),
      }];
    })),
    roleRegistry: partRoles.map((roleId, index) => ({ roleId, maskValue: index + 1 })),
    route: {
      requestedRouteId: assay.route.requestedRouteId,
      supportsCpu: true,
      supportsRoleMask: true,
    },
  };
}

function failureCodes(validation) {
  return validation.failures.map(failure => failure.code);
}

const validAssay = makeAssay();
validAssay.projectionSource = makeProjectionSource(validAssay);
const musculatureGate = validateStructuralSourceGate({
  track: {
    id: 'operator-authored-musculature-v0',
    kind: 'shape-bearing-musculature',
  },
  sourceGate: validAssay.sourceGate,
});
assert.equal(musculatureGate.ok, true, 'generic source Gate-0 must not require a relational station or hip assignment');
assert.equal(
  typeof structuralAssay.validateMusculatureSourceM0,
  'function',
  'Track M requires a dedicated caller-parameterized M0 validator rather than the generic source gate',
);
const validation = validateStructuralSourceAssay(validAssay);
assert.equal(validation.schema, STRUCTURAL_SOURCE_VALIDATION_SCHEMA);
assert.equal(validation.ok, true, JSON.stringify(validation.failures, null, 2));
assert.equal(validation.status, 'source-validated');
assert.equal(validation.cellCount, 6);
assert.deepEqual(validation.failures, []);
assert.equal(validation.derivedDelta, RELATION_DELTA);

const manifest = buildStructuralSourceGenerationManifest(validAssay);
assert.equal(manifest.schema, STRUCTURAL_GENERATION_MANIFEST_SCHEMA);
assert.equal(manifest.status, 'awaiting-generation');
assert.equal(manifest.sourceValidation.ok, true);
assert.deepEqual(manifest.compilerInput, validAssay.projectionSource);
assert.equal(manifest.projectionPlan.schema, ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA);
assert.deepEqual(
  manifest.projectionPlan,
  buildAssetArrivalProjectionPlan(validAssay.projectionSource),
  'the truthful six-cell manifest must be the compiler-owned plan without reinterpretation',
);
assert.deepEqual(manifest.outcomeContract, {
  reportSchema: ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
  failureSchema: ASSET_ARRIVAL_FAILURE_SCHEMA,
  failurePhases: [
    'source-validation',
    'manifest-construction',
    'render-dispatch',
    'product-validation',
    'publication',
  ],
  publicationPointerSchema: 'kaminos.asset-arrival-projection-current.v0',
});
assert.equal(manifest.jobs.length, 6);
assert.deepEqual(manifest.jobs.map(job => job.id), [
  'L_parent',
  'L_positive',
  'L_negative',
  'H_parent',
  'H_positive',
  'H_negative',
]);
for (const job of manifest.jobs) {
  assert.equal(job.status, 'source-validated');
  assert.equal(job.generationEligible, true);
  assert.equal(job.requestedRouteId, validAssay.route.requestedRouteId);
  assert.equal(job.effectiveRouteId, null, 'pre-generation manifest must not claim an effective route');
  assert.equal(job.outputHash, null, 'pre-generation manifest must not claim an output');
  assert.equal(job.failurePhase, null);
  assert.equal(job.productConfigHash, null, 'pre-generation manifest must not invent product config identity');
  assert.equal(job.publicationId, null, 'pre-generation manifest must not invent publication identity');
  assert.equal(job.products, null, 'pre-generation manifest must not invent rendered product receipts');
  assert.deepEqual(
    job.channelIds,
    manifest.projectionPlan.cells.find(cell => cell.id === job.id).channelIds,
  );
  assert.deepEqual(
    job.projectionIdentity,
    validAssay.cells.find(cell => cell.id === job.id).projectionIdentity,
    'each generation job must preserve its exact source/station projection identity',
  );
}

assert.equal(
  typeof structuralAssay.validateStructuralProjectionOutcome,
  'function',
  'Gate-0 must expose one plan-bound report/failure admission function',
);

const projectionSourceAssetDrift = clone(validAssay);
projectionSourceAssetDrift.projectionSource.asset.id = 'different-source';
assert.ok(
  failureCodes(validateStructuralSourceAssay(projectionSourceAssetDrift))
    .includes('compiler-source-binding-mismatch'),
  'a valid but different compiler source cannot borrow Gate-0 admission',
);

const projectionSourceRouteDrift = clone(validAssay);
projectionSourceRouteDrift.projectionSource.route.requestedRouteId = 'different-route';
assert.ok(
  failureCodes(validateStructuralSourceAssay(projectionSourceRouteDrift))
    .includes('compiler-source-binding-mismatch'),
  'the compiler input must preserve the exact requested route admitted by Gate-0',
);

const inventedProjectionPredecessor = clone(validAssay);
delete inventedProjectionPredecessor.projectionSource.variants.parent.sourceChecks.conservativeSweep;
inventedProjectionPredecessor.projectionSource.variants.parent.sourceChecks.looksFine = true;
assert.throws(
  () => buildAssetArrivalProjectionPlan(inventedProjectionPredecessor.projectionSource),
  /source predecessor checks/,
  'the compiler source must enforce the same exact predecessor vocabulary as Gate-0',
);

const missingTrack = clone(validAssay);
delete missingTrack.track;
assert.ok(failureCodes(validateStructuralSourceAssay(missingTrack)).includes('track-scope-missing'));

const crossTrackSubstitution = clone(validAssay);
crossTrackSubstitution.track.kind = 'shape-bearing-musculature';
assert.ok(failureCodes(validateStructuralSourceAssay(crossTrackSubstitution)).includes('track-scope-mismatch'));

const unassignedRelationalSource = clone(validAssay);
delete unassignedRelationalSource.track.sourceAssignment;
assert.ok(failureCodes(validateStructuralSourceAssay(unassignedRelationalSource)).includes('source-assignment-missing'));

const missingSourceFrame = clone(validAssay);
delete missingSourceFrame.sourceGate.frame;
assert.ok(failureCodes(validateStructuralSourceAssay(missingSourceFrame)).includes('source-frame-missing'));

const parallelSourceFrame = clone(validAssay);
parallelSourceFrame.sourceGate.frame.up = parallelSourceFrame.sourceGate.frame.anterior.map(value => value * 2);
assert.ok(
  failureCodes(validateStructuralSourceAssay(parallelSourceFrame)).includes('source-frame-missing'),
  'parallel anatomical axes must not pass Gate-0 as a usable source frame',
);

const brokenConservativeMotion = clone(validAssay);
brokenConservativeMotion.sourceGate.conservativeMotion.supportPreserved = false;
assert.ok(failureCodes(validateStructuralSourceAssay(brokenConservativeMotion)).includes('conservative-motion-failed'));

const missingStationInstance = clone(validAssay);
missingStationInstance.measurementStation.schema = 'golden_object_measurement_station.v1';
assert.ok(failureCodes(validateStructuralSourceAssay(missingStationInstance)).includes('measurement-station-not-instantiated'));

const incompleteStationInstance = clone(validAssay);
delete incompleteStationInstance.measurementStation.world_to_camera_matrix;
assert.ok(failureCodes(validateStructuralSourceAssay(incompleteStationInstance)).includes('measurement-station-fields-missing'));

const canonicalStationOnly = clone(validAssay);
for (const alias of [
  'contractRef', 'id', 'hash', 'sourceAssetId', 'sourceAssetHash', 'neutralStateId',
  'posedStateId', 'cameraHash', 'cropHash', 'denominatorHash', 'roleCoreMaskHash',
  'roleDilatedMaskHash', 'foregroundMaskContractId', 'primaryRelationId',
  'positiveDirection', 'constructionStatus', 'missingFields', 'failureCodes',
]) {
  delete canonicalStationOnly.measurementStation[alias];
}
assert.equal(validateStructuralSourceAssay(canonicalStationOnly).ok, true, 'canonical Phantom station fields must require no alias adapter');

const stationDrift = clone(validAssay);
stationDrift.cells.find(cell => cell.id === 'H_positive').projectionIdentity.stationHash = '0'.repeat(64);
assert.ok(failureCodes(validateStructuralSourceAssay(stationDrift)).includes('station-identity-drift'));

const projectionDrift = clone(validAssay);
projectionDrift.cells.find(cell => cell.id === 'L_negative').projectionIdentity.cameraHash = '0'.repeat(64);
assert.ok(failureCodes(validateStructuralSourceAssay(projectionDrift)).includes('projection-identity-drift'));

for (const field of ['cameraHash', 'cropHash', 'denominatorHash']) {
  const coherentProjectionDrift = clone(validAssay);
  coherentProjectionDrift.cells.forEach(cell => {
    cell.projectionIdentity[field] = '0'.repeat(64);
  });
  assert.ok(
    failureCodes(validateStructuralSourceAssay(coherentProjectionDrift)).includes('projection-identity-drift'),
    `all-cell ${field} drift must not self-certify against L_parent`,
  );

  const coherentProjectionOmission = clone(validAssay);
  coherentProjectionOmission.cells.forEach(cell => {
    delete cell.projectionIdentity[field];
  });
  assert.ok(
    failureCodes(validateStructuralSourceAssay(coherentProjectionOmission)).includes('projection-identity-drift'),
    `all-cell ${field} omission must fail against the frozen receipt`,
  );
}

const posedSemanticDrift = clone(validAssay);
posedSemanticDrift.cells.find(cell => cell.id === 'H_negative').projectionIdentity.semanticRoleIdsHash = '0'.repeat(64);
assert.ok(failureCodes(validateStructuralSourceAssay(posedSemanticDrift)).includes('projection-identity-drift'));

const missingCell = clone(validAssay);
missingCell.cells.pop();
assert.ok(failureCodes(validateStructuralSourceAssay(missingCell)).includes('cell-matrix-incomplete'));

const wrongSign = clone(validAssay);
wrongSign.cells.find(cell => cell.id === 'L_positive').relationValue = 0.26;
assert.ok(failureCodes(validateStructuralSourceAssay(wrongSign)).includes('relation-sign-mismatch'));

const asymmetric = clone(validAssay);
asymmetric.cells.find(cell => cell.id === 'H_negative').relationValue = 0.27;
assert.ok(failureCodes(validateStructuralSourceAssay(asymmetric)).includes('relation-magnitude-mismatch'));

const identityDrift = clone(validAssay);
identityDrift.cells.find(cell => cell.id === 'L_positive').identities.unrelatedGeometryHash = 'a'.repeat(64);
assert.ok(failureCodes(validateStructuralSourceAssay(identityDrift)).includes('frozen-identity-drift'));

const identityKeyGrowth = clone(validAssay);
identityKeyGrowth.cells.find(cell => cell.id === 'H_positive').identities.unregisteredHash = 'a'.repeat(64);
assert.ok(failureCodes(validateStructuralSourceAssay(identityKeyGrowth)).includes('frozen-identity-drift'));

const spillover = clone(validAssay);
spillover.cells.find(cell => cell.id === 'H_positive').sourceSpillover = 0.2;
assert.ok(failureCodes(validateStructuralSourceAssay(spillover)).includes('source-spillover-exceeded'));

const negativeSpillover = clone(validAssay);
negativeSpillover.cells.find(cell => cell.id === 'H_positive').sourceSpillover = -Number.EPSILON;
assert.ok(failureCodes(validateStructuralSourceAssay(negativeSpillover)).includes('source-spillover-invalid'));

const failedPredecessor = clone(validAssay);
failedPredecessor.cells.find(cell => cell.id === 'L_negative').sourceChecks.rigidClearance = false;
assert.ok(failureCodes(validateStructuralSourceAssay(failedPredecessor)).includes('source-predecessor-failed'));

const inventedPredecessor = clone(validAssay);
inventedPredecessor.cells.forEach(cell => {
  cell.sourceChecks = { inventedCheck: true };
});
assert.ok(failureCodes(validateStructuralSourceAssay(inventedPredecessor)).includes('source-predecessor-failed'));

for (const mutate of [
  assay => { assay.track.id = ''; },
  assay => { assay.sourceGate.assetId = ''; },
  assay => { assay.sourceGate.neutralStateId = ''; },
  assay => { assay.sourceGate.posedStateId = ''; },
  assay => { assay.sourceGate.frame.id = ''; },
  assay => { assay.sourceGate.bendFrame.id = ''; },
  assay => { assay.sourceGate.conservativeMotion.id = ''; },
]) {
  const emptyIdentity = clone(validAssay);
  mutate(emptyIdentity);
  assert.equal(validateStructuralSourceAssay(emptyIdentity).ok, false, 'empty stable identities must fail Gate-0');
}

const nullCanonicalIdentity = clone(validAssay);
nullCanonicalIdentity.measurementStation.asset_id = null;
nullCanonicalIdentity.measurementStation.asset_hash = null;
assert.ok(
  failureCodes(validateStructuralSourceAssay(nullCanonicalIdentity)).some(code => code.startsWith('measurement-station-')),
  'aliases must not hide null canonical station identity',
);

for (const [field, value] of [
  ['root_id', 'different-root'],
  ['asset_units', 'centimeters'],
  ['primary_measurement_scalar_id_or_unresolved', null],
]) {
  const contradictoryStation = clone(validAssay);
  contradictoryStation.measurementStation[field] = value;
  assert.ok(
    failureCodes(validateStructuralSourceAssay(contradictoryStation)).some(code => code.startsWith('measurement-station-')),
    `station ${field} contradiction must fail`,
  );
}

const missingRequestedRoute = clone(validAssay);
delete missingRequestedRoute.route.requestedRouteId;
assert.ok(failureCodes(validateStructuralSourceAssay(missingRequestedRoute)).includes('requested-route-missing'));

for (const field of ['weight', 'l2Energy']) {
  const negativeCarrier = clone(validAssay);
  negativeCarrier.cells[0].channels[0][field] = -1;
  assert.ok(failureCodes(validateStructuralSourceAssay(negativeCarrier)).includes('carrier-budget-invalid'));
}

const hiddenDose = clone(validAssay);
hiddenDose.cells.find(cell => cell.id === 'H_positive').channels.find(channel => channel.id === 'semantic-role-mask').weight = 0.4;
assert.ok(failureCodes(validateStructuralSourceAssay(hiddenDose)).includes('carrier-budget-mismatch'));

const extraEnrichment = clone(validAssay);
extraEnrichment.rungs[1].channelIds.push('support-pressure');
extraEnrichment.cells
  .filter(cell => cell.rungId === 'H')
  .forEach(cell => cell.channels.push({ id: 'support-pressure', area: 200, l1Energy: 1, l2Energy: 1, weight: 0 }));
assert.ok(failureCodes(validateStructuralSourceAssay(extraEnrichment)).includes('rung-enrichment-not-singular'));

const coherentlyRenamedBaseChannels = clone(validAssay);
for (const rung of coherentlyRenamedBaseChannels.rungs) {
  rung.channelIds = rung.channelIds.map(channelId => channelId === 'clay' ? 'albedo' : channelId);
}
for (const cell of coherentlyRenamedBaseChannels.cells) {
  cell.channels = cell.channels.map(channel => ({
    ...channel,
    id: channel.id === 'clay' ? 'albedo' : channel.id,
  }));
}
assert.ok(
  failureCodes(validateStructuralSourceAssay(coherentlyRenamedBaseChannels))
    .includes('compiler-source-binding-mismatch'),
  'Gate-0 channel names must bind exactly to the reviewed compiler plan instead of self-certifying',
);

const unauthenticatedStationNumerics = clone(validAssay);
unauthenticatedStationNumerics.measurementStation.camera_crop = [8, 8, 1016, 1016];
assert.ok(
  failureCodes(validateStructuralSourceAssay(unauthenticatedStationNumerics))
    .includes('measurement-station-hash-mismatch'),
  'changing station numerics without changing its content identities must fail',
);

const compilerExactAssay = clone(validAssay);
compilerExactAssay.tolerances.numeric = 1e-4;
compilerExactAssay.relation.delta += 1e-6;
for (const variant of ['positive', 'negative']) {
  const sign = variant === 'positive' ? 1 : -1;
  compilerExactAssay.cells
    .filter(cell => cell.variant === variant)
    .forEach(cell => { cell.relationValue = compilerExactAssay.relation.parentValue + sign * compilerExactAssay.relation.delta; });
  compilerExactAssay.projectionSource.variants[variant].relationValue = compilerExactAssay.relation.parentValue
    + sign * compilerExactAssay.relation.delta;
}
compilerExactAssay.projectionSource.relation.delta = compilerExactAssay.relation.delta;
assert.ok(
  failureCodes(validateStructuralSourceAssay(compilerExactAssay)).includes('compiler-source-invalid'),
  'assay diagnostics must not loosen the published asset-arrival-source.v0 exact numeric contract',
);

assert.throws(
  () => buildStructuralSourceGenerationManifest(missingCell),
  error => error?.failurePhase === 'source-validation'
    && error?.validation?.failures.some(failure => failure.code === 'cell-matrix-incomplete'),
  'invalid source must not become a generation-eligible manifest',
);
