import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  ASSET_ARRIVAL_FAILURE_SCHEMA,
  ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA,
  ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
  ASSET_ARRIVAL_SOURCE_SCHEMA,
  buildAssetArrivalProjectionPlan,
  validateAssetArrivalProjectionReport,
} from './asset-arrival-projection-compiler-core.mjs';

export const STRUCTURAL_SOURCE_ASSAY_SCHEMA = 'kaminos.structural-source-assay.v0';
export const STRUCTURAL_SOURCE_VALIDATION_SCHEMA = 'kaminos.structural-source-validation.v0';
export const STRUCTURAL_SOURCE_GATE_VALIDATION_SCHEMA = 'kaminos.structural-source-gate-validation.v0';
export const STRUCTURAL_GENERATION_MANIFEST_SCHEMA = 'kaminos.structural-generation-manifest.v0';
export const MEASUREMENT_STATION_INSTANCE_SCHEMA = 'golden_object_measurement_station_instance.v1';
export const ASSET_ARRIVAL_PROJECTION_POINTER_SCHEMA = 'kaminos.asset-arrival-projection-current.v0';

const VARIANTS = ['parent', 'positive', 'negative'];
const EXPECTED_RUNGS = ['L', 'H'];
const TRACK_KINDS = ['shape-bearing-musculature', 'generator-relational-sensitivity'];
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const REQUIRED_SOURCE_CHECKS = [
  'occupiedFit',
  'rigidClearance',
  'attachmentContinuity',
  'distalSupportFixed',
  'conservativeSweep',
];
const ASSET_ARRIVAL_FAILURE_PHASES = [
  'source-validation',
  'manifest-construction',
  'render-dispatch',
  'product-validation',
  'publication',
];

const STATION_DIGEST_FIELDS = [
  'contract_ref', 'station_instance_id', 'asset_id', 'asset_hash', 'asset_units',
  'neutral_state_id', 'posed_state_id_or_missing', 'root_id', 'T_asset_to_body',
  'body_frame_origin', 'body_frame_axes', 'tested_side', 'midline_plane',
  'pelvic_envelope_role_ids', 'pelvic_width', 'pelvic_extremal_point_ids',
  'body_envelope_role_ids_or_missing', 'body_length_or_missing', 'socket_center',
  'socket_axis', 'head_center_or_missing', 'primary_relation_id_or_unresolved',
  'positive_direction_or_unresolved', 'camera_id', 'camera_projection',
  'world_to_camera_matrix', 'camera_to_raster_matrix', 'camera_crop', 'near_far',
  'image_width', 'image_height', 'socket_station_row', 'socket_station_band_rows',
  'projected_midline_u', 'projected_pelvic_width_pixels', 'posterior_quarter_role_ids',
  'role_core_mask_hash', 'role_dilated_mask_hash', 'foreground_mask_contract_id',
  'primary_measurement_scalar_id_or_unresolved', 'spillover_metric_id',
];
const CAMERA_DIGEST_FIELDS = [
  'camera_id', 'camera_projection', 'world_to_camera_matrix', 'camera_to_raster_matrix',
  'near_far', 'image_width', 'image_height',
];
const CROP_DIGEST_FIELDS = ['camera_crop', 'image_width', 'image_height'];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function selectFields(source, fields) {
  return Object.fromEntries(fields.map(field => [field, source?.[field]]));
}

export function measurementStationDigests(station) {
  return {
    stationHash: sha256(canonicalJson(selectFields(station, STATION_DIGEST_FIELDS))),
    cameraHash: sha256(canonicalJson(selectFields(station, CAMERA_DIGEST_FIELDS))),
    cropHash: sha256(canonicalJson(selectFields(station, CROP_DIGEST_FIELDS))),
  };
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeFinite(value) {
  return finite(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nearlyEqual(left, right, tolerance) {
  return finite(left) && finite(right) && Math.abs(left - right) <= tolerance;
}

function channelBudget(channels) {
  if (!Array.isArray(channels)) return Number.NaN;
  return channels.reduce((total, channel) => (
    nonNegativeFinite(channel?.weight) && nonNegativeFinite(channel?.l2Energy)
      ? total + channel.weight * channel.l2Energy
      : Number.NaN
  ), 0);
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function addFailure(failures, code, message, details = {}) {
  failures.push({ code, message, ...details });
}

function finiteVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}

function vectorLength(value) {
  return finiteVector3(value) ? Math.hypot(...value) : Number.NaN;
}

function independentVector3(left, right) {
  if (!finiteVector3(left) || !finiteVector3(right)) return false;
  const leftLength = vectorLength(left);
  const rightLength = vectorLength(right);
  if (!(leftLength > 0) || !(rightLength > 0)) return false;
  const crossLength = Math.hypot(
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  );
  return crossLength > leftLength * rightLength * 1e-4;
}

function validStringList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? '');
}

function matrix4(value) {
  return Array.isArray(value) && value.length === 16 && value.every(finite);
}

function stationValue(station, canonical, alias) {
  if (station && Object.hasOwn(station, canonical)) return station[canonical];
  return station?.[alias];
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compilerBindingFailures(assay, projectionPlan) {
  const failures = [];
  const source = assay?.projectionSource;
  const sourceGate = assay?.sourceGate;
  const station = assay?.measurementStation;
  const relation = assay?.relation;
  const expectedTrackId = 'generator-relational-sensitivity';
  const driftedFields = [];
  const compare = (field, actual, expected) => {
    if (!sameJsonValue(actual, expected)) driftedFields.push(field);
  };

  compare('source.schema', source?.schema, ASSET_ARRIVAL_SOURCE_SCHEMA);
  compare('source.trackId', source?.trackId, expectedTrackId);
  compare('source.asset.id', source?.asset?.id, sourceGate?.assetId);
  compare('source.asset.blendSha256', source?.asset?.blendSha256, sourceGate?.assetHash);
  compare('source.route.requestedRouteId', source?.route?.requestedRouteId, assay?.route?.requestedRouteId);
  compare('source.camera.cameraSha256', source?.camera?.cameraSha256, assay?.frozen?.cameraHash);
  compare('source.camera.id', source?.camera?.id, station?.camera_id);
  compare('source.camera.width', source?.camera?.width, station?.image_width);
  compare('source.camera.height', source?.camera?.height, station?.image_height);
  for (const field of ['id', 'regionId', 'parentValue', 'delta', 'lowerBound', 'upperBound', 'maxDelta']) {
    compare(`source.relation.${field}`, source?.relation?.[field], relation?.[field]);
  }
  compare(
    'source.relation.scalarId',
    source?.relation?.scalarId,
    station?.primary_measurement_scalar_id_or_unresolved,
  );

  for (const variant of VARIANTS) {
    const sourceVariant = source?.variants?.[variant];
    const low = assay?.cells?.find(cell => cell?.id === `L_${variant}`);
    const high = assay?.cells?.find(cell => cell?.id === `H_${variant}`);
    compare(`source.variants.${variant}.relationValue`, sourceVariant?.relationValue, low?.relationValue);
    compare(`source.variants.${variant}.sourceInputHash`, sourceVariant?.sourceInputHash, low?.inputHash);
    compare(`cells.${variant}.L/H.sourceInputHash`, high?.inputHash, low?.inputHash);
    compare(`source.variants.${variant}.sourceSpillover`, sourceVariant?.sourceSpillover, low?.sourceSpillover);
    compare(`cells.${variant}.L/H.sourceSpillover`, high?.sourceSpillover, low?.sourceSpillover);
    compare(`source.variants.${variant}.sourceChecks`, sourceVariant?.sourceChecks, low?.sourceChecks);
    compare(`cells.${variant}.L/H.sourceChecks`, high?.sourceChecks, low?.sourceChecks);
  }
  for (const cell of assay?.cells ?? []) {
    compare(
      `cells.${cell?.id}.channels`,
      cell?.channels?.map(channel => channel?.id),
      projectionPlan?.cells?.find(planCell => planCell?.id === cell?.id)?.channelIds,
    );
  }

  if (driftedFields.length > 0) {
    addFailure(
      failures,
      'compiler-source-binding-mismatch',
      'Compiler source does not preserve the exact Gate-0 source, relation, route, camera, or signed-cell identities.',
      { fields: driftedFields },
    );
  }
  if (projectionPlan && projectionPlan.schema !== ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA) {
    addFailure(failures, 'compiler-plan-schema-mismatch', 'Compiler did not return the reviewed projection-plan schema.');
  }
  return failures;
}

function stationIdentity(station) {
  return {
    id: stationValue(station, 'station_instance_id', 'id'),
    hash: stationValue(station, 'station_hash', 'hash'),
    sourceAssetId: stationValue(station, 'asset_id', 'sourceAssetId'),
    sourceAssetHash: stationValue(station, 'asset_hash', 'sourceAssetHash'),
    neutralStateId: stationValue(station, 'neutral_state_id', 'neutralStateId'),
    posedStateId: stationValue(station, 'posed_state_id_or_missing', 'posedStateId'),
    relationId: stationValue(station, 'primary_relation_id_or_unresolved', 'primaryRelationId'),
    positiveDirection: stationValue(station, 'positive_direction_or_unresolved', 'positiveDirection'),
    contractRef: stationValue(station, 'contract_ref', 'contractRef'),
    assetUnits: stationValue(station, 'asset_units', 'assetUnits'),
    rootId: stationValue(station, 'root_id', 'rootId'),
    primaryMeasurementScalarId: stationValue(
      station,
      'primary_measurement_scalar_id_or_unresolved',
      'primaryMeasurementScalarId',
    ),
    roleCoreMaskHash: stationValue(station, 'role_core_mask_hash', 'roleCoreMaskHash'),
    roleDilatedMaskHash: stationValue(station, 'role_dilated_mask_hash', 'roleDilatedMaskHash'),
    foregroundMaskContractId: stationValue(station, 'foreground_mask_contract_id', 'foregroundMaskContractId'),
  };
}

export function validateStructuralSourceGate({ track, sourceGate, expectedTrackKind = null } = {}) {
  const failures = [];

  if (!track || !nonEmptyString(track.id) || !TRACK_KINDS.includes(track.kind)) {
    addFailure(failures, 'track-scope-missing', 'Source Gate-0 requires an explicit known track identity.');
  } else if (expectedTrackKind && track.kind !== expectedTrackKind) {
    addFailure(failures, 'track-scope-mismatch', 'Source track does not match the assay comparison class.', {
      expectedTrackKind,
      actualTrackKind: track.kind,
    });
  }

  if (!sourceGate || typeof sourceGate !== 'object') {
    addFailure(failures, 'source-gate-missing', 'Gate-0 source identity and structural semantics are missing.');
    return {
      schema: STRUCTURAL_SOURCE_GATE_VALIDATION_SCHEMA,
      ok: false,
      status: 'source-gate-rejected',
      trackId: track?.id ?? null,
      trackKind: track?.kind ?? null,
      failures,
    };
  }

  if (!nonEmptyString(sourceGate.assetId)
    || !validHash(sourceGate.assetHash)
    || !nonEmptyString(sourceGate.rootId)
    || !nonEmptyString(sourceGate.units)) {
    addFailure(failures, 'source-identity-invalid', 'Source asset requires a stable id and content hash.');
  }
  if (!nonEmptyString(sourceGate.neutralStateId)
    || !nonEmptyString(sourceGate.posedStateId)
    || sourceGate.neutralStateId === sourceGate.posedStateId) {
    addFailure(failures, 'source-state-relation-invalid', 'Source requires distinct neutral and conservative posed state identities.');
  }

  const frame = sourceGate.frame;
  const frameValid = nonEmptyString(frame?.id)
    && validHash(frame?.hash)
    && finiteVector3(frame?.origin)
    && finiteVector3(frame?.anterior)
    && finiteVector3(frame?.up)
    && vectorLength(frame.anterior) > 0
    && vectorLength(frame.up) > 0
    && independentVector3(frame.anterior, frame.up)
    && frame?.handedness === 'right';
  if (!frameValid) {
    addFailure(failures, 'source-frame-missing', 'Source anatomical frame is missing or degenerate.');
  }

  const bendFrame = sourceGate.bendFrame;
  if (!nonEmptyString(bendFrame?.id)
    || !finiteVector3(bendFrame?.origin)
    || !finiteVector3(bendFrame?.axis)
    || !(vectorLength(bendFrame?.axis) > 0)) {
    addFailure(failures, 'bend-frame-missing', 'Source joint or bend frame is missing or degenerate.');
  }

  const motion = sourceGate.conservativeMotion;
  if (!nonEmptyString(motion?.id)
    || motion?.neutralStateId !== sourceGate.neutralStateId
    || motion?.posedStateId !== sourceGate.posedStateId
    || motion?.collisionFree !== true
    || motion?.supportPreserved !== true) {
    addFailure(failures, 'conservative-motion-failed', 'Conservative motion does not preserve clearance and support across the declared states.');
  }
  if (!validStringList(sourceGate.attachmentIds)) {
    addFailure(failures, 'attachment-identities-missing', 'Source requires one or more stable attachment identities.');
  }
  if (!validStringList(sourceGate.supportIds)) {
    addFailure(failures, 'support-identities-missing', 'Source requires one or more stable support identities.');
  }
  for (const [field, code] of [
    ['materialCoordinatesHash', 'material-coordinates-missing'],
    ['topologyHash', 'source-topology-missing'],
    ['semanticRoleIdsHash', 'semantic-role-identities-missing'],
  ]) {
    if (!validHash(sourceGate[field])) {
      addFailure(failures, code, `Source ${field} is missing or not content-addressable.`);
    }
  }

  if (track?.kind === 'generator-relational-sensitivity') {
    const assignment = track.sourceAssignment;
    if (assignment?.authority !== 'composition-owner'
      || assignment?.sourceAssetId !== sourceGate.assetId
      || assignment?.sourceAssetHash !== sourceGate.assetHash) {
      addFailure(failures, 'source-assignment-missing', 'Relational track source is not explicitly assigned by the composition owner.');
    }
  }

  return {
    schema: STRUCTURAL_SOURCE_GATE_VALIDATION_SCHEMA,
    ok: failures.length === 0,
    status: failures.length === 0 ? 'source-gate-validated' : 'source-gate-rejected',
    trackId: track?.id ?? null,
    trackKind: track?.kind ?? null,
    sourceAssetId: sourceGate.assetId ?? null,
    sourceAssetHash: sourceGate.assetHash ?? null,
    failures,
  };
}

function validateMeasurementStation(assay, failures) {
  const station = assay?.measurementStation;
  const sourceGate = assay?.sourceGate;
  const relation = assay?.relation;
  const identity = stationIdentity(station);
  const constructionStatus = stationValue(station, 'construction_status', 'constructionStatus');
  const missingFields = stationValue(station, 'missing_fields', 'missingFields');
  const failureCodes = stationValue(station, 'failure_codes', 'failureCodes');
  if (station?.schema !== MEASUREMENT_STATION_INSTANCE_SCHEMA
    || constructionStatus !== 'instantiated'
    || !Array.isArray(missingFields)
    || missingFields.length > 0
    || !Array.isArray(failureCodes)
    || failureCodes.length > 0) {
    addFailure(failures, 'measurement-station-not-instantiated', 'Relational assay requires a complete numeric measurement-station instance.');
    return;
  }

  const canonicalAliases = [
    ['contract_ref', 'contractRef'],
    ['station_instance_id', 'id'],
    ['station_hash', 'hash'],
    ['asset_id', 'sourceAssetId'],
    ['asset_hash', 'sourceAssetHash'],
    ['neutral_state_id', 'neutralStateId'],
    ['posed_state_id_or_missing', 'posedStateId'],
    ['primary_relation_id_or_unresolved', 'primaryRelationId'],
    ['positive_direction_or_unresolved', 'positiveDirection'],
    ['role_core_mask_hash', 'roleCoreMaskHash'],
    ['role_dilated_mask_hash', 'roleDilatedMaskHash'],
    ['foreground_mask_contract_id', 'foregroundMaskContractId'],
    ['construction_status', 'constructionStatus'],
    ['missing_fields', 'missingFields'],
    ['failure_codes', 'failureCodes'],
  ];
  const aliasConflicts = canonicalAliases
    .filter(([canonical, alias]) => Object.hasOwn(station, canonical)
      && Object.hasOwn(station, alias)
      && !sameJsonValue(station[canonical], station[alias]))
    .map(([canonical]) => canonical);
  if (aliasConflicts.length > 0) {
    addFailure(failures, 'measurement-station-alias-conflict', 'Station aliases contradict canonical receipt fields.', {
      fields: aliasConflicts,
    });
  }

  if (!nonEmptyString(identity.id)
    || !validHash(identity.hash)
    || identity.sourceAssetId !== sourceGate?.assetId
    || identity.sourceAssetHash !== sourceGate?.assetHash
    || identity.neutralStateId !== sourceGate?.neutralStateId
    || identity.posedStateId !== sourceGate?.posedStateId
    || identity.contractRef !== 'golden_object_measurement_station.v1'
    || identity.assetUnits !== sourceGate?.units
    || identity.rootId !== sourceGate?.rootId
    || identity.relationId !== relation?.id
    || !nonEmptyString(identity.primaryMeasurementScalarId)
    || !finiteVector3(identity.positiveDirection)
    || !(vectorLength(identity.positiveDirection) > 0)) {
    addFailure(failures, 'measurement-station-source-mismatch', 'Measurement station is not bound to the exact assigned source, states, frame, and relation.');
  }

  if (!validHash(identity.roleCoreMaskHash) || !validHash(identity.roleDilatedMaskHash)) {
    addFailure(failures, 'measurement-station-identity-invalid', 'Measurement station role-mask identities are missing or invalid.');
  }
  if (!nonEmptyString(identity.foregroundMaskContractId)) {
    addFailure(failures, 'measurement-station-identity-invalid', 'Measurement station foreground-mask route is missing.', {
      field: 'foregroundMaskContractId',
    });
  }

  const requiredFields = [
    'contract_ref', 'station_instance_id', 'station_hash', 'asset_id', 'asset_hash',
    'asset_units', 'neutral_state_id', 'posed_state_id_or_missing', 'root_id',
    'T_asset_to_body', 'body_frame_origin', 'body_frame_axes', 'tested_side',
    'midline_plane', 'pelvic_envelope_role_ids', 'pelvic_width',
    'pelvic_extremal_point_ids', 'body_envelope_role_ids_or_missing',
    'body_length_or_missing', 'socket_center', 'socket_axis', 'head_center_or_missing',
    'primary_relation_id_or_unresolved', 'positive_direction_or_unresolved',
    'camera_id', 'camera_projection', 'world_to_camera_matrix',
    'camera_to_raster_matrix', 'camera_crop', 'near_far', 'image_width',
    'image_height', 'socket_station_row', 'socket_station_band_rows',
    'projected_midline_u', 'projected_pelvic_width_pixels',
    'posterior_quarter_role_ids', 'role_core_mask_hash', 'role_dilated_mask_hash',
    'foreground_mask_contract_id', 'primary_measurement_scalar_id_or_unresolved',
    'spillover_metric_id', 'construction_status', 'missing_fields', 'failure_codes',
  ];
  const absentFields = requiredFields.filter(field => !Object.hasOwn(station, field));
  const invalidCanonicalIdentityFields = [
    'contract_ref', 'station_instance_id', 'station_hash', 'asset_id', 'asset_hash',
    'asset_units', 'neutral_state_id', 'posed_state_id_or_missing', 'root_id',
    'primary_relation_id_or_unresolved', 'foreground_mask_contract_id',
    'primary_measurement_scalar_id_or_unresolved',
  ].filter(field => !nonEmptyString(station?.[field]));
  const numericReceiptValid = matrix4(station.T_asset_to_body)
    && matrix4(station.world_to_camera_matrix)
    && matrix4(station.camera_to_raster_matrix)
    && finiteVector3(station.body_frame_origin)
    && finiteVector3(station.body_frame_axes?.x)
    && finiteVector3(station.body_frame_axes?.y)
    && finiteVector3(station.body_frame_axes?.z)
    && independentVector3(station.body_frame_axes?.x, station.body_frame_axes?.y)
    && independentVector3(station.body_frame_axes?.x, station.body_frame_axes?.z)
    && independentVector3(station.body_frame_axes?.y, station.body_frame_axes?.z)
    && finiteVector3(station.midline_plane?.origin)
    && finiteVector3(station.midline_plane?.normal)
    && vectorLength(station.midline_plane?.normal) > 0
    && finiteVector3(station.socket_center)
    && finiteVector3(station.socket_axis)
    && vectorLength(station.socket_axis) > 0
    && ['left', 'right'].includes(station.tested_side)
    && station.camera_id === 'posterior_ortho_body_frame_v1'
    && station.camera_projection === 'orthographic'
    && finite(station.pelvic_width) && station.pelvic_width > 0
    && validStringList(station.pelvic_envelope_role_ids)
    && validStringList(station.pelvic_extremal_point_ids)
    && validStringList(station.posterior_quarter_role_ids)
    && Array.isArray(station.camera_crop) && station.camera_crop.length === 4 && station.camera_crop.every(finite)
    && station.camera_crop[2] > station.camera_crop[0]
    && station.camera_crop[3] > station.camera_crop[1]
    && Array.isArray(station.near_far) && station.near_far.length === 2 && station.near_far.every(finite)
    && station.near_far[1] > station.near_far[0]
    && Number.isInteger(station.image_width) && station.image_width > 0
    && Number.isInteger(station.image_height) && station.image_height > 0
    && Number.isInteger(station.socket_station_row)
    && Array.isArray(station.socket_station_band_rows)
    && station.socket_station_band_rows.length === 2
    && station.socket_station_band_rows.every(Number.isInteger)
    && station.socket_station_band_rows[1] >= station.socket_station_band_rows[0]
    && finite(station.projected_midline_u)
    && finite(station.projected_pelvic_width_pixels)
    && station.projected_pelvic_width_pixels > 0
    && station.spillover_metric_id === 'linear_rgb_l2_role_dilated_v1';
  if (absentFields.length > 0 || invalidCanonicalIdentityFields.length > 0 || !numericReceiptValid) {
    addFailure(failures, 'measurement-station-fields-missing', 'Measurement station omits required numeric, camera, role, or scalar receipt fields.', {
      fields: [...new Set([...absentFields, ...invalidCanonicalIdentityFields])],
    });
  }

  if (absentFields.length === 0 && numericReceiptValid) {
    const digests = measurementStationDigests(station);
    const hashDrift = [];
    const compareHash = (field, actual, expected) => {
      if (actual !== expected) hashDrift.push(field);
    };
    compareHash('station.station_hash', station.station_hash, digests.stationHash);
    if (Object.hasOwn(station, 'hash')) compareHash('station.hash', station.hash, digests.stationHash);
    if (Object.hasOwn(station, 'cameraHash')) compareHash('station.cameraHash', station.cameraHash, digests.cameraHash);
    if (Object.hasOwn(station, 'cropHash')) compareHash('station.cropHash', station.cropHash, digests.cropHash);
    compareHash('frozen.cameraHash', assay?.frozen?.cameraHash, digests.cameraHash);
    compareHash('frozen.cropHash', assay?.frozen?.cropHash, digests.cropHash);
    if (hashDrift.length > 0) {
      addFailure(
        failures,
        'measurement-station-hash-mismatch',
        'Measurement-station, camera, or crop identity does not authenticate the canonical numeric receipt.',
        { fields: hashDrift },
      );
    }
  }
}

export function validateStructuralSourceAssay(assay) {
  const failures = [];
  const numericTolerance = finite(assay?.tolerances?.numeric) ? assay.tolerances.numeric : 1e-9;
  const carrierTolerance = finite(assay?.tolerances?.carrier) ? assay.tolerances.carrier : 1e-9;
  const spilloverMax = assay?.tolerances?.sourceSpilloverMax;
  const relation = assay?.relation;
  const cells = Array.isArray(assay?.cells) ? assay.cells : [];
  const rungs = Array.isArray(assay?.rungs) ? assay.rungs : [];

  if (assay?.schema !== STRUCTURAL_SOURCE_ASSAY_SCHEMA) {
    addFailure(failures, 'schema-mismatch', 'Source assay schema is not supported.');
  }

  const sourceGateValidation = validateStructuralSourceGate({
    track: assay?.track,
    sourceGate: assay?.sourceGate,
    expectedTrackKind: 'generator-relational-sensitivity',
  });
  failures.push(...sourceGateValidation.failures);
  validateMeasurementStation(assay, failures);

  let projectionPlan = null;
  try {
    projectionPlan = buildAssetArrivalProjectionPlan(assay?.projectionSource);
  } catch (error) {
    addFailure(failures, 'compiler-source-invalid', 'Relational source does not satisfy the reviewed projection compiler.', {
      detail: error.message,
    });
  }
  failures.push(...compilerBindingFailures(assay, projectionPlan));

  const frozenProjectionIdentity = {
    cameraHash: assay?.frozen?.cameraHash,
    cropHash: assay?.frozen?.cropHash,
    denominatorHash: assay?.frozen?.denominatorHash,
  };
  const invalidFrozenProjectionFields = Object.entries(frozenProjectionIdentity)
    .filter(([, value]) => !validHash(value))
    .map(([field]) => field);
  if (invalidFrozenProjectionFields.length > 0) {
    addFailure(failures, 'frozen-projection-identity-missing', 'Assay omits an independently frozen projection identity.', {
      fields: invalidFrozenProjectionFields,
    });
  }
  const stationProjectionAliases = {
    cameraHash: assay?.measurementStation?.cameraHash,
    cropHash: assay?.measurementStation?.cropHash,
    denominatorHash: assay?.measurementStation?.denominatorHash,
  };
  const stationProjectionConflicts = Object.entries(stationProjectionAliases)
    .filter(([field, value]) => value !== undefined && value !== frozenProjectionIdentity[field])
    .map(([field]) => field);
  if (stationProjectionConflicts.length > 0) {
    addFailure(failures, 'measurement-station-projection-conflict', 'Station projection aliases contradict the frozen assay receipt.', {
      fields: stationProjectionConflicts,
    });
  }

  if (!nonEmptyString(assay?.route?.requestedRouteId)) {
    addFailure(failures, 'requested-route-missing', 'Pre-generation eligibility requires a stable requested route identity.');
  }

  const expectedIds = EXPECTED_RUNGS.flatMap(rungId => VARIANTS.map(variant => `${rungId}_${variant}`));
  const cellIds = cells.map(cell => cell?.id);
  if (cells.length !== expectedIds.length
    || new Set(cellIds).size !== expectedIds.length
    || expectedIds.some(id => !cellIds.includes(id))) {
    addFailure(failures, 'cell-matrix-incomplete', 'Source assay must contain exactly one cell for every L/H signed variant.', {
      expectedCellIds: expectedIds,
      actualCellIds: cellIds,
    });
  }

  const roomAbove = finite(relation?.upperBound) && finite(relation?.parentValue)
    ? relation.upperBound - relation.parentValue
    : Number.NaN;
  const roomBelow = finite(relation?.lowerBound) && finite(relation?.parentValue)
    ? relation.parentValue - relation.lowerBound
    : Number.NaN;
  const derivedDelta = finite(relation?.maxDelta) && finite(roomAbove) && finite(roomBelow)
    ? Math.min(relation.maxDelta, 0.5 * Math.min(roomAbove, roomBelow))
    : Number.NaN;
  if (!nearlyEqual(relation?.delta, derivedDelta, numericTolerance) || !(derivedDelta > 0)) {
    addFailure(failures, 'relation-delta-invalid', 'Signed relation delta does not match the bounded assay rule.', {
      declaredDelta: relation?.delta,
      derivedDelta: finite(derivedDelta) ? derivedDelta : null,
    });
  }

  const expectedRelationValue = {
    parent: relation?.parentValue,
    positive: finite(relation?.parentValue) && finite(relation?.delta)
      ? relation.parentValue + relation.delta
      : Number.NaN,
    negative: finite(relation?.parentValue) && finite(relation?.delta)
      ? relation.parentValue - relation.delta
      : Number.NaN,
  };
  const expectedSign = { parent: 0, positive: 1, negative: -1 };

  const identityReference = cells.find(cell => cell?.id === 'L_parent')?.identities;
  const identityKeys = identityReference && typeof identityReference === 'object'
    ? Object.keys(identityReference)
    : [];

  const rungBudgets = {};
  const projectionIds = new Set();
  const measurementIdentity = stationIdentity(assay?.measurementStation);
  for (const cell of cells) {
    const cellId = cell?.id ?? null;
    const expectedId = `${cell?.rungId}_${cell?.variant}`;
    if (!EXPECTED_RUNGS.includes(cell?.rungId) || !VARIANTS.includes(cell?.variant) || cellId !== expectedId) {
      addFailure(failures, 'cell-identity-invalid', 'Cell id, rung, and variant do not form a known assay cell.', { cellId });
      continue;
    }
    if (cell.relationRegionId !== relation?.regionId) {
      addFailure(failures, 'relation-region-mismatch', 'Cell relation edit is not confined to the declared relation region.', { cellId });
    }
    if (cell.editSign !== expectedSign[cell.variant]
      || (cell.variant !== 'parent'
        && Math.sign(cell.relationValue - relation.parentValue) !== expectedSign[cell.variant])) {
      addFailure(failures, 'relation-sign-mismatch', 'Cell relation value does not carry the declared signed edit.', { cellId });
    }
    if (!nearlyEqual(cell.relationValue, expectedRelationValue[cell.variant], numericTolerance)) {
      addFailure(failures, 'relation-magnitude-mismatch', 'Cell relation value is not the exact symmetric bounded perturbation.', {
        cellId,
        expected: expectedRelationValue[cell.variant],
        actual: cell.relationValue,
      });
    }
    if (!finite(cell.sourceSpillover) || cell.sourceSpillover < 0) {
      addFailure(failures, 'source-spillover-invalid', 'Cell source spillover must be a finite non-negative energy ratio.', {
        cellId,
        actual: finite(cell.sourceSpillover) ? cell.sourceSpillover : null,
      });
    } else if (!finite(spilloverMax) || spilloverMax < 0 || cell.sourceSpillover > spilloverMax) {
      addFailure(failures, 'source-spillover-exceeded', 'Cell source edit exceeds the admitted spillover budget.', {
        cellId,
        limit: finite(spilloverMax) ? spilloverMax : null,
        actual: finite(cell.sourceSpillover) ? cell.sourceSpillover : null,
      });
    }
    const failedChecks = REQUIRED_SOURCE_CHECKS
      .filter(name => cell.sourceChecks?.[name] !== true);
    if (failedChecks.length > 0) {
      addFailure(failures, 'source-predecessor-failed', 'Cell failed one or more required source predecessor checks.', {
        cellId,
        failedChecks,
      });
    }
    const cellIdentityKeys = cell.identities && typeof cell.identities === 'object'
      ? Object.keys(cell.identities)
      : [];
    if (identityKeys.length === 0
      || !sameStringSet(cellIdentityKeys, identityKeys)
      || identityKeys.some(key => cell.identities?.[key] !== identityReference[key])
      || Object.values(cell.identities ?? {}).some(value => !HASH_PATTERN.test(value))) {
      addFailure(failures, 'frozen-identity-drift', 'Cell changed frozen geometry or semantic identity outside the signed relation.', { cellId });
    }
    if (!HASH_PATTERN.test(cell.inputHash ?? '')) {
      addFailure(failures, 'input-hash-invalid', 'Cell must carry a content-addressable source input hash.', { cellId });
    }

    const projection = cell.projectionIdentity;
    if (!nonEmptyString(projection?.id) || projectionIds.has(projection.id)) {
      addFailure(failures, 'projection-identity-invalid', 'Cell projection identity is missing or duplicated.', { cellId });
    } else {
      projectionIds.add(projection.id);
    }
    if (projection?.stationInstanceId !== measurementIdentity.id
      || projection?.stationHash !== measurementIdentity.hash) {
      addFailure(failures, 'station-identity-drift', 'Cell changed the bound measurement-station instance.', { cellId });
    }
    const expectedProjection = {
      trackId: assay?.track?.id,
      sourceAssetId: assay?.sourceGate?.assetId,
      sourceAssetHash: assay?.sourceGate?.assetHash,
      cameraHash: frozenProjectionIdentity.cameraHash,
      cropHash: frozenProjectionIdentity.cropHash,
      denominatorHash: frozenProjectionIdentity.denominatorHash,
      roleCoreMaskHash: measurementIdentity.roleCoreMaskHash,
      roleDilatedMaskHash: measurementIdentity.roleDilatedMaskHash,
      foregroundMaskContractId: measurementIdentity.foregroundMaskContractId,
      topologyHash: assay?.sourceGate?.topologyHash,
      semanticRoleIdsHash: assay?.sourceGate?.semanticRoleIdsHash,
      materialCoordinatesHash: assay?.sourceGate?.materialCoordinatesHash,
    };
    const driftedProjectionFields = Object.entries(expectedProjection)
      .filter(([field, expected]) => projection?.[field] !== expected)
      .map(([field]) => field);
    if (driftedProjectionFields.length > 0) {
      addFailure(failures, 'projection-identity-drift', 'Cell changed a frozen projection, topology, or semantic identity.', {
        cellId,
        fields: driftedProjectionFields,
      });
    }

    const rung = rungs.find(candidate => candidate?.id === cell.rungId);
    const channelIds = Array.isArray(cell.channels) ? cell.channels.map(channel => channel?.id) : [];
    if (!rung || !sameStringSet(channelIds, rung.channelIds)) {
      addFailure(failures, 'rung-channel-mismatch', 'Cell channels do not exactly match its declared rung.', { cellId });
    }
    const budget = channelBudget(cell.channels);
    if (!finite(budget)) {
      addFailure(failures, 'carrier-budget-invalid', 'Cell conditioning carrier budget is not finite.', { cellId });
    } else {
      rungBudgets[cell.rungId] ??= {};
      rungBudgets[cell.rungId][cell.variant] = budget;
    }
  }

  const lowRung = rungs.find(rung => rung?.id === 'L');
  const highRung = rungs.find(rung => rung?.id === 'H');
  const lowChannels = Array.isArray(lowRung?.channelIds) ? lowRung.channelIds : [];
  const highChannels = Array.isArray(highRung?.channelIds) ? highRung.channelIds : [];
  const addedChannels = highChannels.filter(channelId => !lowChannels.includes(channelId));
  const removedChannels = lowChannels.filter(channelId => !highChannels.includes(channelId));
  if (rungs.length !== 2
    || addedChannels.length !== 1
    || removedChannels.length !== 0
    || highRung?.enrichment?.channelId !== addedChannels[0]
    || highRung?.enrichment?.relationId !== relation?.id) {
    addFailure(failures, 'rung-enrichment-not-singular', 'H must differ from L by exactly one declared semantic enrichment channel.');
  }

  if (assay?.route?.supportsBudgetNormalization !== true) {
    addFailure(failures, 'carrier-normalization-unsupported', 'The requested route cannot preserve equal conditioning dose across cells.');
  } else {
    const budgets = cells
      .map(cell => rungBudgets[cell?.rungId]?.[cell?.variant])
      .filter(finite);
    if (budgets.length !== cells.length
      || budgets.some(budget => !nearlyEqual(budget, budgets[0], carrierTolerance))) {
      addFailure(failures, 'carrier-budget-mismatch', 'Conditioning dose is not equal across signed cells and rungs.', {
        budgets: rungBudgets,
      });
    }
  }

  return {
    schema: STRUCTURAL_SOURCE_VALIDATION_SCHEMA,
    assayId: assay?.id ?? null,
    ok: failures.length === 0,
    status: failures.length === 0 ? 'source-validated' : 'source-rejected',
    cellCount: cells.length,
    derivedDelta: finite(derivedDelta) && nearlyEqual(relation?.delta, derivedDelta, numericTolerance)
      ? relation.delta
      : (finite(derivedDelta) ? derivedDelta : null),
    failures,
    rungBudgets,
    sourceGateValidation,
    projectionPlan,
  };
}

export function buildStructuralSourceGenerationManifest(assay) {
  const sourceValidation = validateStructuralSourceAssay(assay);
  if (!sourceValidation.ok) {
    const error = new Error('Phase Three source assay failed validation');
    error.failurePhase = 'source-validation';
    error.validation = sourceValidation;
    throw error;
  }

  const projectionPlan = buildAssetArrivalProjectionPlan(assay.projectionSource);
  return {
    schema: STRUCTURAL_GENERATION_MANIFEST_SCHEMA,
    assayId: assay.id,
    status: 'awaiting-generation',
    sourceValidation,
    compilerInput: structuredClone(assay.projectionSource),
    projectionPlan,
    outcomeContract: {
      reportSchema: ASSET_ARRIVAL_PROJECTION_REPORT_SCHEMA,
      failureSchema: ASSET_ARRIVAL_FAILURE_SCHEMA,
      failurePhases: [...ASSET_ARRIVAL_FAILURE_PHASES],
      publicationPointerSchema: ASSET_ARRIVAL_PROJECTION_POINTER_SCHEMA,
    },
    requestedRouteId: projectionPlan.requestedRouteId,
    effectiveRouteId: null,
    track: structuredClone(assay.track),
    sourceGate: structuredClone(assay.sourceGate),
    measurementStation: structuredClone(assay.measurementStation),
    frozen: structuredClone(assay.frozen),
    jobs: projectionPlan.cells.map(planCell => ({
      id: planCell.id,
      rungId: planCell.rungId,
      variant: planCell.variant,
      inputHash: planCell.sourceInputHash,
      projectionIdentity: structuredClone(
        assay.cells.find(cell => cell.id === planCell.id).projectionIdentity,
      ),
      channelIds: [...planCell.channelIds],
      requestedRouteId: projectionPlan.requestedRouteId,
      effectiveRouteId: null,
      productConfigHash: null,
      products: null,
      publicationId: null,
      outputHash: null,
      failurePhase: null,
      status: 'source-validated',
      generationEligible: true,
    })),
  };
}

async function readJsonEvidence(path, label, fail) {
  if (!nonEmptyString(path)) return null;
  try {
    const bytes = await readFile(path);
    return { bytes, value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
  } catch (error) {
    fail('outcome-evidence-unreadable', `${label} evidence could not be read and parsed from the named path.`, {
      path,
      reason: error.message,
    });
    return null;
  }
}

export async function validateStructuralProjectionOutcome({
  manifest,
  reportPath = null,
  failurePath = null,
  publicationPointerPath = null,
} = {}) {
  const failures = [];
  const fail = (code, message, details = {}) => addFailure(failures, code, message, details);
  const plan = manifest?.projectionPlan;
  if (manifest?.schema !== STRUCTURAL_GENERATION_MANIFEST_SCHEMA
    || plan?.schema !== ASSET_ARRIVAL_PROJECTION_PLAN_SCHEMA) {
    fail('manifest-contract-invalid', 'Outcome admission requires the reviewed Gate-0 manifest and projection plan.');
  }

  const evidenceCount = Number(reportPath !== null) + Number(failurePath !== null);
  if (evidenceCount !== 1) {
    fail('outcome-evidence-ambiguous', 'Provide exactly one projection report path or durable failure-receipt path.');
  }

  const reportEvidence = reportPath !== null
    ? await readJsonEvidence(reportPath, 'Projection report', fail)
    : null;
  const pointerEvidence = reportPath !== null
    ? await readJsonEvidence(publicationPointerPath, 'Publication pointer', fail)
    : null;
  const failureEvidence = failurePath !== null
    ? await readJsonEvidence(failurePath, 'Projection failure receipt', fail)
    : null;

  if (reportEvidence !== null) {
    const report = reportEvidence.value;
    const publicationPointer = pointerEvidence?.value;
    const reportValidation = validateAssetArrivalProjectionReport(report);
    if (!reportValidation.ok) {
      fail('projection-report-invalid', 'Projection report failed the reviewed compiler validator.', {
        reportFailures: reportValidation.failures,
      });
    }
    const bindingDrift = [];
    const compare = (field, actual, expected) => {
      if (!sameJsonValue(actual, expected)) bindingDrift.push(field);
    };
    compare('compilerId', report?.compilerId, plan?.compilerId);
    compare('trackId', report?.trackId, plan?.trackId);
    compare('sourceReceiptId', report?.sourceReceiptId, plan?.sourceReceiptId);
    compare('assetId', report?.assetId, plan?.asset?.id);
    compare('source.assetSha256', report?.source?.assetSha256, plan?.frozenIdentities?.assetSha256);
    compare('source.cameraSha256', report?.source?.cameraSha256, plan?.frozenIdentities?.cameraSha256);
    compare('source.partSetSha256', report?.source?.partSetSha256, plan?.frozenIdentities?.partSetSha256);
    compare('source.roleRegistrySha256', report?.source?.roleRegistrySha256, plan?.frozenIdentities?.roleRegistrySha256);
    compare('relation', report?.relation, plan?.relation);
    compare('camera', report?.camera, plan?.camera);
    compare('route.requestedRouteId', report?.route?.requestedRouteId, plan?.requestedRouteId);
    for (const planCell of plan?.cells ?? []) {
      const reportCell = report?.cells?.find(cell => cell?.id === planCell.id);
      for (const field of [
        'id', 'rungId', 'variant', 'editSign', 'relationRegionId', 'relationValue', 'sourceInputHash',
      ]) {
        compare(`cells.${planCell.id}.${field}`, reportCell?.[field], planCell[field]);
      }
      compare(
        `cells.${planCell.id}.productKinds`,
        reportCell?.products?.map(product => product?.kind),
        planCell.channelIds,
      );
    }
    if (bindingDrift.length > 0) {
      fail('projection-report-binding-mismatch', 'Projection report belongs to a different plan, source, route, or cell matrix.', {
        fields: bindingDrift,
      });
    }

    const expectedVersionPath = `versions/${report?.publicationId}`;
    const expectedReportPath = `${expectedVersionPath}/projection-report.json`;
    if (publicationPointer?.schema !== ASSET_ARRIVAL_PROJECTION_POINTER_SCHEMA
      || publicationPointer?.status !== 'published'
      || publicationPointer?.publicationId !== report?.publicationId
      || publicationPointer?.relativeVersionPath !== expectedVersionPath
      || publicationPointer?.reportPath !== expectedReportPath
      || publicationPointer?.sourceReceiptId !== plan?.sourceReceiptId
      || publicationPointer?.requestedRouteId !== plan?.requestedRouteId
      || publicationPointer?.reportSha256 !== reportEvidence.sha256
      || resolve(reportPath) !== resolve(dirname(publicationPointerPath), expectedReportPath)) {
      fail('immutable-publication-binding-mismatch', 'Current pointer does not bind the exact immutable report publication and hash.');
    }
  }

  if (failureEvidence !== null) {
    const failure = failureEvidence.value;
    const invalidFailure = failure?.schema !== ASSET_ARRIVAL_FAILURE_SCHEMA
      || failure?.compilerId !== plan?.compilerId
      || failure?.status !== 'failed'
      || failure?.trackId !== plan?.trackId
      || failure?.sourceReceiptId !== plan?.sourceReceiptId
      || failure?.assetId !== plan?.asset?.id
      || failure?.requestedRouteId !== plan?.requestedRouteId
      || !nonEmptyString(failure?.attemptId)
      || !nonEmptyString(failure?.outputIdentity)
      || !ASSET_ARRIVAL_FAILURE_PHASES.includes(failure?.failure?.phase)
      || !nonEmptyString(failure?.failure?.name)
      || !nonEmptyString(failure?.failure?.message)
      || !nonEmptyString(failure?.lastTrustworthyEvidence);
    if (invalidFailure) {
      fail('projection-failure-binding-mismatch', 'Failure receipt does not preserve the exact compiler, source, route, and failure-phase identities.');
    }
    if (publicationPointerPath !== null) {
      fail('failed-outcome-publication-claimed', 'A failed attempt cannot claim immutable publication evidence.');
    }
  }

  return {
    schema: 'kaminos.structural-projection-outcome-validation.v0',
    ok: failures.length === 0,
    status: failures.length > 0
      ? 'outcome-rejected'
      : (reportEvidence !== null ? 'published-outcome-validated' : 'failed-outcome-validated'),
    evidenceSha256: reportEvidence?.sha256 ?? failureEvidence?.sha256 ?? null,
    failures,
  };
}
