import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export const TRACK_M_SOURCE_SCHEMA = 'kaminos.track-m-evidence-source.v0';
export const TRACK_M_PLAN_SCHEMA = 'kaminos.track-m-evidence-plan.v0';
export const TRACK_M_REPORT_SCHEMA = 'kaminos.track-m-evidence-report.v0';
export const TRACK_M_POINTER_SCHEMA = 'kaminos.track-m-evidence-current.v0';
export const TRACK_M_FAILURE_SCHEMA = 'kaminos.track-m-evidence-failure.v0';
export const TRACK_M_ROUTE_RECEIPT_SCHEMA = 'kaminos.track-m-route-receipt.v0';
export const TRACK_M_TRACK_ID = 'shape-bearing-musculature';
export const TRACK_M_COMPILER_ID = 'track-m-three-condition-evidence-bundle-v0';
export const TRACK_M_CONDITION_IDS = Object.freeze([
  'deep-geometry-absent',
  'deep-geometry-correctly-routed',
  'deep-geometry-matched-wrong-routing',
]);
export const TRACK_M_FAILURE_PHASES = Object.freeze([
  'source-validation',
  'bundle-dispatch',
  'product-validation',
  'publication',
]);

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value) {
  return hashBytes(Buffer.from(JSON.stringify(canonical(value))));
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes, expectedWidth, expectedHeight, label) {
  const data = Buffer.from(bytes);
  if (data.length < PNG_SIGNATURE.length || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} product has an invalid PNG signature`);
  }
  let offset = 8;
  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  let sawIhdr = false;
  let sawIend = false;
  const idat = [];
  while (offset < data.length) {
    if (offset + 12 > data.length) throw new Error(`${label} product has a truncated PNG chunk`);
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd + 4 > data.length) throw new Error(`${label} product has a truncated PNG chunk`);
    const expectedCrc = data.readUInt32BE(chunkEnd);
    const actualCrc = pngCrc32(data.subarray(offset + 4, chunkEnd));
    if (actualCrc !== expectedCrc) throw new Error(`${label} product has an invalid PNG chunk checksum`);
    if (!sawIhdr && type !== 'IHDR') throw new Error(`${label} product PNG does not start with IHDR`);
    if (type === 'IHDR') {
      if (sawIhdr || length !== 13) throw new Error(`${label} product has an invalid PNG IHDR`);
      sawIhdr = true;
      width = data.readUInt32BE(chunkStart);
      height = data.readUInt32BE(chunkStart + 4);
      bitDepth = data[chunkStart + 8];
      colorType = data[chunkStart + 9];
      const compression = data[chunkStart + 10];
      const filter = data[chunkStart + 11];
      const interlace = data[chunkStart + 12];
      if (compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`${label} product uses an unsupported PNG encoding`);
      }
    } else if (type === 'IDAT') {
      idat.push(data.subarray(chunkStart, chunkEnd));
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error(`${label} product has an invalid PNG IEND`);
      sawIend = true;
      offset = chunkEnd + 4;
      break;
    }
    offset = chunkEnd + 4;
  }
  if (!sawIhdr || !sawIend || idat.length === 0 || offset !== data.length) {
    throw new Error(`${label} product has an incomplete PNG chunk stream`);
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${label} product decoded PNG dimensions do not match the planned output`);
  }
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const allowedBitDepths = colorType === 3 ? [1, 2, 4, 8] : (colorType === 0 ? [1, 2, 4, 8, 16] : [8, 16]);
  if (!channels || !allowedBitDepths.includes(bitDepth)) {
    throw new Error(`${label} product uses an unsupported PNG color mode`);
  }
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idat));
  } catch {
    throw new Error(`${label} product PNG pixel stream is not decodable`);
  }
  const rowBytes = Math.ceil(width * channels * bitDepth / 8);
  if (decoded.length !== height * (rowBytes + 1)) {
    throw new Error(`${label} product PNG pixel stream has the wrong size`);
  }
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)] > 4) {
      throw new Error(`${label} product PNG uses an invalid row filter`);
    }
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !same(Object.keys(value).sort(), [...expected].sort())) {
    throw new Error(`${label} field set contains missing or unexpected fields`);
  }
}

function requireHash(value, label) {
  if (!HASH_PATTERN.test(value ?? '')) throw new Error(`${label} must be a SHA-256 identity`);
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function requireBudget(value, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} is required`);
  const fields = ['primitiveCount', 'vertexCount', 'triangleCount', 'parameterCount'];
  requireExactKeys(value, fields, label);
  for (const field of fields) {
    requirePositiveInteger(value[field], `${label}.${field}`);
  }
}

function requireTransform(condition, expectedKind, label) {
  requireExactKeys(condition?.transform, ['id', 'kind', 'sha256'], `${label} transform`);
  requireString(condition?.transform?.id, `${label} transform id`);
  requireHash(condition?.transform?.sha256, `${label} transform hash`);
  if (condition.transform.kind !== expectedKind) {
    throw new Error(`${label} transform must be ${expectedKind}`);
  }
}

function requireFrozenOverride(condition, field, expected) {
  if (Object.hasOwn(condition, field) && condition[field] !== expected) {
    throw new Error(`condition ${field} drifts from the frozen comparison identity`);
  }
}

function assertTrackMSource(source) {
  requireExactKeys(source, [
    'schema', 'trackId', 'receiptId', 'asset', 'pose', 'camera', 'material',
    'illumination', 'renderConfig', 'route', 'productContract', 'testedRelation', 'conditions',
  ], 'Track M source');
  if (source?.schema !== TRACK_M_SOURCE_SCHEMA) throw new Error('Track M source schema mismatch');
  if (source.trackId !== TRACK_M_TRACK_ID) {
    throw new Error(`Track M evidence bundle serves only ${TRACK_M_TRACK_ID}`);
  }
  requireString(source.receiptId, 'source receipt id');
  requireExactKeys(source.asset, ['id', 'path', 'sha256'], 'asset');
  requireString(source.asset?.id, 'asset id');
  requireString(source.asset?.path, 'asset path');
  requireHash(source.asset?.sha256, 'asset hash');
  requireExactKeys(source.pose, ['id', 'kind', 'authorityId', 'sha256'], 'pose');
  requireString(source.pose?.id, 'pose id');
  if (source.pose?.kind !== 'conservative') throw new Error('pose must be the conservative comparison pose');
  requireString(source.pose?.authorityId, 'external pose authority id');
  requireHash(source.pose?.sha256, 'pose hash');
  requireExactKeys(source.camera, ['id', 'projection', 'width', 'height', 'sha256'], 'camera');
  requireString(source.camera?.id, 'camera id');
  if (!['orthographic', 'perspective'].includes(source.camera?.projection)) {
    throw new Error('camera projection must be orthographic or perspective');
  }
  requireHash(source.camera?.sha256, 'camera hash');
  requirePositiveInteger(source.camera?.width, 'camera width');
  requirePositiveInteger(source.camera?.height, 'camera height');
  requireExactKeys(source.material, ['id', 'sha256'], 'material');
  requireString(source.material?.id, 'material id');
  requireHash(source.material?.sha256, 'material hash');
  requireExactKeys(source.illumination, ['id', 'sha256'], 'illumination');
  requireString(source.illumination?.id, 'illumination id');
  requireHash(source.illumination?.sha256, 'illumination hash');
  requireExactKeys(source.renderConfig, ['id', 'width', 'height', 'sha256'], 'render config');
  requireString(source.renderConfig?.id, 'render config id');
  requireHash(source.renderConfig?.sha256, 'render config hash');
  requirePositiveInteger(source.renderConfig?.width, 'render width');
  requirePositiveInteger(source.renderConfig?.height, 'render height');
  if (source.camera.width !== source.renderConfig.width
    || source.camera.height !== source.renderConfig.height) {
    throw new Error('camera and render output dimensions must match');
  }
  requireExactKeys(source.route, [
    'requestedRouteId', 'executionClass', 'requiresGpu', 'adapterContractSha256',
  ], 'route');
  requireString(source.route?.requestedRouteId, 'requested route id');
  if (source.route.executionClass !== 'cpu' || source.route.requiresGpu !== false) {
    throw new Error('Track M evidence route must be CPU-only and must not require a GPU');
  }
  requireHash(source.route.adapterContractSha256, 'route adapter contract hash');

  if (!Array.isArray(source.productContract) || source.productContract.length === 0) {
    throw new Error('product contract is required');
  }
  const productKinds = source.productContract.map(product => product?.kind);
  if (new Set(productKinds).size !== source.productContract.length) {
    throw new Error('product contract kinds must be unique');
  }
  for (const product of source.productContract) {
    requireExactKeys(product, ['kind', 'mimeType'], 'product contract entry');
    requireString(product?.kind, 'product kind');
    requireString(product?.mimeType, `${product?.kind ?? 'product'} mime type`);
  }

  const relation = source.testedRelation;
  requireExactKeys(relation, [
    'id', 'deepGeometryIds', 'deepGeometryContentSetSha256',
    'attachmentEndpointMultisetSha256', 'expectedRoutingGraphSha256',
    'representationalBudget',
  ], 'tested relation');
  requireString(relation?.id, 'tested relation id');
  if (!Array.isArray(relation?.deepGeometryIds) || relation.deepGeometryIds.length === 0
    || new Set(relation.deepGeometryIds).size !== relation.deepGeometryIds.length) {
    throw new Error('tested relation deep geometry ids are missing or duplicated');
  }
  relation.deepGeometryIds.forEach(id => requireString(id, 'deep geometry id'));
  requireHash(relation.deepGeometryContentSetSha256, 'deep geometry content-set hash');
  requireHash(relation.attachmentEndpointMultisetSha256, 'attachment endpoint multiset hash');
  requireHash(relation.expectedRoutingGraphSha256, 'expected routing graph hash');
  requireBudget(relation.representationalBudget, 'tested relation representational budget');

  const conditionKeys = Object.keys(source.conditions ?? {});
  if (!same(conditionKeys.sort(), [...TRACK_M_CONDITION_IDS].sort())) {
    throw new Error('Track M source must define exactly the three canonical conditions');
  }
  const frozen = {
    sourceIdentitySha256: hashJson(source.asset),
    poseSha256: source.pose.sha256,
    cameraSha256: source.camera.sha256,
    materialSha256: source.material.sha256,
    illuminationSha256: source.illumination.sha256,
    renderConfigSha256: source.renderConfig.sha256,
  };
  for (const condition of Object.values(source.conditions)) {
    for (const [field, expected] of Object.entries(frozen)) requireFrozenOverride(condition, field, expected);
  }

  const absent = source.conditions['deep-geometry-absent'];
  requireExactKeys(absent, [
    'transform', 'deepGeometryPresent', 'testedRelationPresent', 'removedGeometryIds',
  ], 'absent condition');
  requireTransform(absent, 'remove-deep-geometry', 'absent condition');
  if (absent.deepGeometryPresent !== false || absent.testedRelationPresent !== false) {
    throw new Error('absent condition must remove deep geometry and the tested relation');
  }
  if (!same([...(absent.removedGeometryIds ?? [])].sort(), [...relation.deepGeometryIds].sort())) {
    throw new Error('absent condition must remove exactly the tested deep geometry ids');
  }

  const correct = source.conditions['deep-geometry-correctly-routed'];
  requireExactKeys(correct, [
    'transform', 'deepGeometryPresent', 'testedRelationPresent',
    'deepGeometryContentSetSha256', 'attachmentEndpointMultisetSha256',
    'routingGraphSha256', 'representationalBudget',
  ], 'correct-routing condition');
  requireTransform(correct, 'preserve-correct-routing', 'correct-routing condition');
  if (correct.deepGeometryPresent !== true || correct.testedRelationPresent !== true) {
    throw new Error('correct-routing condition must preserve deep geometry and the tested relation');
  }
  if (correct.deepGeometryContentSetSha256 !== relation.deepGeometryContentSetSha256
    || correct.attachmentEndpointMultisetSha256 !== relation.attachmentEndpointMultisetSha256
    || correct.routingGraphSha256 !== relation.expectedRoutingGraphSha256) {
    throw new Error('correct-routing condition does not preserve the tested route identities');
  }
  if (!same(correct.representationalBudget, relation.representationalBudget)) {
    throw new Error('correct-routing representational budget does not match the source');
  }

  const wrong = source.conditions['deep-geometry-matched-wrong-routing'];
  requireExactKeys(wrong, [
    'transform', 'deepGeometryPresent', 'testedRelationPresent', 'destroyedRelationId',
    'deepGeometryContentSetSha256', 'attachmentEndpointMultisetSha256',
    'routingGraphSha256', 'routingPermutationSha256', 'representationalBudget',
  ], 'wrong-routing condition');
  requireTransform(wrong, 'matched-wrong-routing', 'wrong-routing condition');
  if (wrong.deepGeometryPresent !== true) {
    throw new Error('wrong-routing condition must retain deep geometry');
  }
  if (wrong.testedRelationPresent !== false || wrong.destroyedRelationId !== relation.id
    || wrong.routingGraphSha256 === relation.expectedRoutingGraphSha256) {
    throw new Error('wrong-routing condition must destroy only the tested routing relation');
  }
  requireHash(wrong.routingGraphSha256, 'wrong-routing graph hash');
  requireHash(wrong.routingPermutationSha256, 'wrong-routing permutation hash');
  if (wrong.deepGeometryContentSetSha256 !== correct.deepGeometryContentSetSha256) {
    throw new Error('wrong-routing deep geometry content set must match correct routing');
  }
  if (wrong.attachmentEndpointMultisetSha256 !== correct.attachmentEndpointMultisetSha256) {
    throw new Error('wrong-routing attachment endpoint multiset must match correct routing');
  }
  if (!same(wrong.representationalBudget, correct.representationalBudget)) {
    throw new Error('wrong-routing representational budget must match correct routing');
  }

  return frozen;
}

export function buildTrackMEvidencePlan(source) {
  const frozen = assertTrackMSource(source);
  const conditions = TRACK_M_CONDITION_IDS.map(id => {
    const condition = source.conditions[id];
    return {
      id,
      sourceIdentitySha256: frozen.sourceIdentitySha256,
      poseSha256: frozen.poseSha256,
      cameraSha256: frozen.cameraSha256,
      materialSha256: frozen.materialSha256,
      illuminationSha256: frozen.illuminationSha256,
      renderConfigSha256: frozen.renderConfigSha256,
      outputDimensions: [source.renderConfig.width, source.renderConfig.height],
      conditionTransformId: condition.transform.id,
      conditionTransformKind: condition.transform.kind,
      conditionTransformSha256: condition.transform.sha256,
      deepGeometryPresent: condition.deepGeometryPresent,
      testedRelationPresent: condition.testedRelationPresent,
      removedGeometryIds: structuredClone(condition.removedGeometryIds ?? []),
      destroyedRelationId: condition.destroyedRelationId ?? null,
      deepGeometryContentSetSha256: condition.deepGeometryContentSetSha256 ?? null,
      attachmentEndpointMultisetSha256: condition.attachmentEndpointMultisetSha256 ?? null,
      routingGraphSha256: condition.routingGraphSha256 ?? null,
      routingPermutationSha256: condition.routingPermutationSha256 ?? null,
      representationalBudget: structuredClone(condition.representationalBudget ?? null),
      outputIdentity: hashJson({
        compilerId: TRACK_M_COMPILER_ID,
        sourceReceiptId: source.receiptId,
        conditionId: id,
        transformSha256: condition.transform.sha256,
        renderConfigSha256: source.renderConfig.sha256,
        productContract: source.productContract,
      }),
    };
  });
  const planCore = {
    compilerId: TRACK_M_COMPILER_ID,
    trackId: TRACK_M_TRACK_ID,
    sourceReceiptId: source.receiptId,
    asset: structuredClone(source.asset),
    pose: structuredClone(source.pose),
    camera: structuredClone(source.camera),
    material: structuredClone(source.material),
    illumination: structuredClone(source.illumination),
    renderConfig: structuredClone(source.renderConfig),
    requestedRouteId: source.route.requestedRouteId,
    executionClass: source.route.executionClass,
    requiresGpu: source.route.requiresGpu,
    adapterContractSha256: source.route.adapterContractSha256,
    productContract: structuredClone(source.productContract),
    testedRelationId: source.testedRelation.id,
    outputDimensions: [source.renderConfig.width, source.renderConfig.height],
    conditions,
  };
  const id = hashJson(planCore);
  return {
    schema: TRACK_M_PLAN_SCHEMA,
    id,
    ...planCore,
    bundleOutputIdentity: hashJson({ planId: id, conditionOutputs: conditions.map(item => item.outputIdentity) }),
  };
}

const PLAN_CORE_FIELDS = Object.freeze([
  'asset',
  'adapterContractSha256',
  'camera',
  'compilerId',
  'conditions',
  'illumination',
  'material',
  'outputDimensions',
  'pose',
  'productContract',
  'renderConfig',
  'requestedRouteId',
  'executionClass',
  'requiresGpu',
  'sourceReceiptId',
  'testedRelationId',
  'trackId',
]);

const PLAN_CONDITION_FIELDS = Object.freeze([
  'attachmentEndpointMultisetSha256',
  'cameraSha256',
  'conditionTransformId',
  'conditionTransformKind',
  'conditionTransformSha256',
  'deepGeometryContentSetSha256',
  'deepGeometryPresent',
  'destroyedRelationId',
  'id',
  'illuminationSha256',
  'materialSha256',
  'outputDimensions',
  'outputIdentity',
  'poseSha256',
  'removedGeometryIds',
  'renderConfigSha256',
  'representationalBudget',
  'routingGraphSha256',
  'routingPermutationSha256',
  'sourceIdentitySha256',
  'testedRelationPresent',
]);

function assertPersistedPlanNestedFieldSets(plan) {
  requireExactKeys(plan.asset, ['id', 'path', 'sha256'], 'plan asset');
  requireExactKeys(plan.pose, ['id', 'kind', 'authorityId', 'sha256'], 'plan pose');
  requireExactKeys(plan.camera, ['id', 'projection', 'width', 'height', 'sha256'], 'plan camera');
  requireExactKeys(plan.material, ['id', 'sha256'], 'plan material');
  requireExactKeys(plan.illumination, ['id', 'sha256'], 'plan illumination');
  requireExactKeys(plan.renderConfig, ['id', 'width', 'height', 'sha256'], 'plan render config');
  if (!Array.isArray(plan.productContract) || plan.productContract.length === 0) {
    throw new Error('plan product contract field set is required');
  }
  for (const product of plan.productContract) {
    requireExactKeys(product, ['kind', 'mimeType'], 'plan product contract entry');
  }
  if (!Array.isArray(plan.conditions)) throw new Error('plan condition field set is required');
  for (const condition of plan.conditions) {
    requireExactKeys(condition, PLAN_CONDITION_FIELDS, 'plan condition');
    if (condition.representationalBudget !== null) {
      requireBudget(condition.representationalBudget, 'plan condition representational budget');
    }
  }
}

function assertPersistedPlanSemantics(plan) {
  if (plan.compilerId !== TRACK_M_COMPILER_ID) throw new Error('compiler identity drifted');
  const [absent, correct, wrong] = plan.conditions;
  const reconstructedSource = {
    schema: TRACK_M_SOURCE_SCHEMA,
    trackId: plan.trackId,
    receiptId: plan.sourceReceiptId,
    asset: structuredClone(plan.asset),
    pose: structuredClone(plan.pose),
    camera: structuredClone(plan.camera),
    material: structuredClone(plan.material),
    illumination: structuredClone(plan.illumination),
    renderConfig: structuredClone(plan.renderConfig),
    route: {
      requestedRouteId: plan.requestedRouteId,
      executionClass: plan.executionClass,
      requiresGpu: plan.requiresGpu,
      adapterContractSha256: plan.adapterContractSha256,
    },
    productContract: structuredClone(plan.productContract),
    testedRelation: {
      id: plan.testedRelationId,
      deepGeometryIds: structuredClone(absent.removedGeometryIds),
      deepGeometryContentSetSha256: correct.deepGeometryContentSetSha256,
      attachmentEndpointMultisetSha256: correct.attachmentEndpointMultisetSha256,
      expectedRoutingGraphSha256: correct.routingGraphSha256,
      representationalBudget: structuredClone(correct.representationalBudget),
    },
    conditions: {
      'deep-geometry-absent': {
        transform: {
          id: absent.conditionTransformId,
          kind: absent.conditionTransformKind,
          sha256: absent.conditionTransformSha256,
        },
        deepGeometryPresent: absent.deepGeometryPresent,
        testedRelationPresent: absent.testedRelationPresent,
        removedGeometryIds: structuredClone(absent.removedGeometryIds),
      },
      'deep-geometry-correctly-routed': {
        transform: {
          id: correct.conditionTransformId,
          kind: correct.conditionTransformKind,
          sha256: correct.conditionTransformSha256,
        },
        deepGeometryPresent: correct.deepGeometryPresent,
        testedRelationPresent: correct.testedRelationPresent,
        deepGeometryContentSetSha256: correct.deepGeometryContentSetSha256,
        attachmentEndpointMultisetSha256: correct.attachmentEndpointMultisetSha256,
        routingGraphSha256: correct.routingGraphSha256,
        representationalBudget: structuredClone(correct.representationalBudget),
      },
      'deep-geometry-matched-wrong-routing': {
        transform: {
          id: wrong.conditionTransformId,
          kind: wrong.conditionTransformKind,
          sha256: wrong.conditionTransformSha256,
        },
        deepGeometryPresent: wrong.deepGeometryPresent,
        testedRelationPresent: wrong.testedRelationPresent,
        destroyedRelationId: wrong.destroyedRelationId,
        deepGeometryContentSetSha256: wrong.deepGeometryContentSetSha256,
        attachmentEndpointMultisetSha256: wrong.attachmentEndpointMultisetSha256,
        routingGraphSha256: wrong.routingGraphSha256,
        routingPermutationSha256: wrong.routingPermutationSha256,
        representationalBudget: structuredClone(wrong.representationalBudget),
      },
    },
  };
  const frozen = assertTrackMSource(reconstructedSource);
  const expectedDimensions = [plan.renderConfig.width, plan.renderConfig.height];
  if (!same(plan.outputDimensions, expectedDimensions)) {
    throw new Error('plan output dimensions drifted from the render contract');
  }
  const canonicalNullFields = [
    absent.destroyedRelationId,
    absent.deepGeometryContentSetSha256,
    absent.attachmentEndpointMultisetSha256,
    absent.routingGraphSha256,
    absent.routingPermutationSha256,
    absent.representationalBudget,
    correct.destroyedRelationId,
    correct.routingPermutationSha256,
  ];
  if (canonicalNullFields.some(value => value !== null)
    || !same(correct.removedGeometryIds, [])
    || !same(wrong.removedGeometryIds, [])) {
    throw new Error('condition carries non-canonical comparison semantics');
  }
  for (const condition of plan.conditions) {
    if (condition.sourceIdentitySha256 !== frozen.sourceIdentitySha256
      || condition.poseSha256 !== frozen.poseSha256
      || condition.cameraSha256 !== frozen.cameraSha256
      || condition.materialSha256 !== frozen.materialSha256
      || condition.illuminationSha256 !== frozen.illuminationSha256
      || condition.renderConfigSha256 !== frozen.renderConfigSha256
      || !same(condition.outputDimensions, expectedDimensions)) {
      throw new Error(`${condition.id} drifted from the frozen comparison identity`);
    }
    const expectedOutputIdentity = hashJson({
      compilerId: TRACK_M_COMPILER_ID,
      sourceReceiptId: plan.sourceReceiptId,
      conditionId: condition.id,
      transformSha256: condition.conditionTransformSha256,
      renderConfigSha256: plan.renderConfig.sha256,
      productContract: plan.productContract,
    });
    if (condition.outputIdentity !== expectedOutputIdentity) {
      throw new Error(`${condition.id} output identity does not authenticate its comparison inputs`);
    }
  }
}

function validatePlanIntegrity(plan, failures) {
  if (!plan || typeof plan !== 'object') return;
  const { schema, id, bundleOutputIdentity, ...planCore } = plan;
  if (schema !== TRACK_M_PLAN_SCHEMA || !same(Object.keys(planCore).sort(), [...PLAN_CORE_FIELDS].sort())) {
    addFailure(failures, 'plan-integrity-mismatch', 'plan schema or exact top-level field set drifted');
    return;
  }
  try {
    assertPersistedPlanNestedFieldSets(plan);
  } catch (error) {
    addFailure(failures, 'plan-nested-field-set-mismatch', `plan nested field set drifted: ${error.message}`);
    return;
  }
  try {
    assertPersistedPlanSemantics(plan);
  } catch (error) {
    addFailure(failures, 'plan-semantic-contract-mismatch', `plan semantic comparison contract drifted: ${error.message}`);
    return;
  }
  if (!HASH_PATTERN.test(id ?? '') || hashJson(planCore) !== id) {
    addFailure(failures, 'plan-integrity-mismatch', 'plan id does not authenticate its current contents');
  }
  if (plan.executionClass !== 'cpu' || plan.requiresGpu !== false
    || !HASH_PATTERN.test(plan.adapterContractSha256 ?? '')) {
    addFailure(failures, 'plan-route-contract-invalid', 'plan does not preserve the authenticated CPU-only route contract');
  }
  const conditionIds = Array.isArray(plan.conditions) ? plan.conditions.map(item => item?.id) : [];
  if (!same(conditionIds, TRACK_M_CONDITION_IDS)) {
    addFailure(failures, 'plan-integrity-mismatch', 'plan does not preserve the exact three-condition order');
  }
  const expectedBundleIdentity = hashJson({
    planId: id,
    conditionOutputs: Array.isArray(plan.conditions)
      ? plan.conditions.map(item => item?.outputIdentity)
      : [],
  });
  if (!HASH_PATTERN.test(bundleOutputIdentity ?? '') || bundleOutputIdentity !== expectedBundleIdentity) {
    addFailure(failures, 'plan-integrity-mismatch', 'bundle output identity does not authenticate the plan outputs');
  }
}

function addFailure(failures, code, message, details = {}) {
  failures.push({ code, message, ...details });
}

function checkExactKeys(value, expected, label, failures) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !same(Object.keys(value).sort(), [...expected].sort())) {
    addFailure(failures, 'schema-field-set-mismatch', `${label} contains missing or unexpected fields`);
    return false;
  }
  return true;
}

function isSafeSegment(value) {
  return typeof value === 'string'
    && value !== '.'
    && value !== '..'
    && SAFE_SEGMENT_PATTERN.test(value);
}

async function readContainedBytes(root, relativePath, label, failures) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    addFailure(failures, 'contained-path-missing', `${label} path is required`);
    return null;
  }
  const lexicalRoot = resolve(root);
  const lexicalPath = resolve(lexicalRoot, relativePath);
  if (!lexicalPath.startsWith(`${lexicalRoot}${sep}`)) {
    addFailure(failures, 'contained-path-escape', `${label} escapes its immutable publication`);
    return null;
  }
  try {
    const [actualRoot, actualPath] = await Promise.all([realpath(lexicalRoot), realpath(lexicalPath)]);
    if (!actualPath.startsWith(`${actualRoot}${sep}`)) {
      addFailure(failures, 'contained-realpath-escape', `${label} resolves outside its immutable publication`);
      return null;
    }
    return await readFile(actualPath);
  } catch (error) {
    addFailure(failures, 'contained-evidence-unreadable', `${label} could not be read`, {
      reason: error.message,
    });
    return null;
  }
}

async function validateRouteReceipt({ plan, planned, condition, versionDir, failures }) {
  const bytes = await readContainedBytes(
    versionDir,
    condition.routeReceiptPath,
    `${planned.id} route receipt`,
    failures,
  );
  if (!bytes) return;
  if (!HASH_PATTERN.test(condition.routeReceiptSha256 ?? '')
    || hashBytes(bytes) !== condition.routeReceiptSha256) {
    addFailure(failures, 'route-receipt-byte-mismatch', `${planned.id} route receipt hash drifted`);
    return;
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    addFailure(failures, 'route-receipt-invalid', `${planned.id} route receipt is not valid JSON`, {
      reason: error.message,
    });
    return;
  }
  checkExactKeys(receipt, [
    'schema', 'status', 'trackId', 'planId', 'sourceReceiptId', 'conditionId',
    'outputIdentity', 'requestedRouteId', 'effectiveRouteId', 'executionClass',
    'requiresGpu', 'adapterContractSha256', 'backendIdentity', 'products',
  ], `${planned.id} route receipt`, failures);
  checkExactKeys(receipt.backendIdentity, ['id', 'sha256'], `${planned.id} backend identity`, failures);
  for (const [actual, expected, field] of [
    [receipt.schema, TRACK_M_ROUTE_RECEIPT_SCHEMA, 'schema'],
    [receipt.status, 'completed', 'status'],
    [receipt.trackId, plan.trackId, 'track id'],
    [receipt.planId, plan.id, 'plan id'],
    [receipt.sourceReceiptId, plan.sourceReceiptId, 'source receipt id'],
    [receipt.conditionId, planned.id, 'condition id'],
    [receipt.outputIdentity, planned.outputIdentity, 'output identity'],
    [receipt.requestedRouteId, plan.requestedRouteId, 'requested route id'],
    [receipt.effectiveRouteId, plan.requestedRouteId, 'effective route id'],
    [receipt.executionClass, 'cpu', 'execution class'],
    [receipt.requiresGpu, false, 'GPU requirement'],
    [receipt.adapterContractSha256, plan.adapterContractSha256, 'adapter contract hash'],
  ]) {
    if (actual !== expected) {
      addFailure(failures, 'route-receipt-binding-mismatch', `${planned.id} route receipt ${field} drifted`);
    }
  }
  if (typeof receipt.backendIdentity?.id !== 'string' || receipt.backendIdentity.id.length === 0
    || !HASH_PATTERN.test(receipt.backendIdentity?.sha256 ?? '')) {
    addFailure(failures, 'route-receipt-backend-invalid', `${planned.id} route receipt lacks backend identity`);
  }
  if (!same(receipt.products, condition.products)) {
    addFailure(failures, 'route-receipt-product-mismatch', `${planned.id} route receipt does not authenticate the report products`);
  }
}

async function readJsonEvidence(path, label, failures) {
  if (typeof path !== 'string' || path.length === 0) {
    addFailure(failures, 'evidence-path-missing', `${label} path is required`);
    return null;
  }
  try {
    const bytes = await readFile(path);
    return { bytes, value: JSON.parse(bytes.toString('utf8')), sha256: hashBytes(bytes) };
  } catch (error) {
    addFailure(failures, 'evidence-unreadable', `${label} could not be read and parsed`, {
      path,
      reason: error.message,
    });
    return null;
  }
}

async function validatePublishedReport({ plan, reportPath, pointerPath, failures }) {
  const reportEvidence = await readJsonEvidence(reportPath, 'Track M evidence report', failures);
  const pointerEvidence = await readJsonEvidence(pointerPath, 'Track M publication pointer', failures);
  if (!reportEvidence || !pointerEvidence) return reportEvidence?.sha256 ?? null;
  const report = reportEvidence.value;
  const pointer = pointerEvidence.value;
  const versionDir = dirname(reportPath);

  checkExactKeys(report, [
    'schema', 'compilerId', 'status', 'trackId', 'planId', 'sourceReceiptId',
    'assetId', 'publicationId', 'requestedRouteId', 'conditions',
  ], 'Track M evidence report', failures);
  checkExactKeys(pointer, [
    'schema', 'status', 'publicationId', 'relativeVersionPath', 'reportPath',
    'reportSha256', 'planId', 'sourceReceiptId', 'requestedRouteId',
  ], 'Track M publication pointer', failures);

  for (const [actual, expected, field] of [
    [report.schema, TRACK_M_REPORT_SCHEMA, 'report schema'],
    [report.compilerId, plan.compilerId, 'compiler id'],
    [report.status, 'completed', 'report status'],
    [report.trackId, plan.trackId, 'track id'],
    [report.planId, plan.id, 'plan id'],
    [report.sourceReceiptId, plan.sourceReceiptId, 'source receipt id'],
    [report.assetId, plan.asset.id, 'asset id'],
    [report.requestedRouteId, plan.requestedRouteId, 'requested route id'],
  ]) {
    if (actual !== expected) addFailure(failures, 'report-binding-mismatch', `${field} does not match the plan`);
  }
  if (!Array.isArray(report.conditions) || report.conditions.length !== plan.conditions.length) {
    addFailure(failures, 'condition-set-mismatch', 'report does not contain exactly the planned conditions');
  } else {
    for (const planned of plan.conditions) {
      const condition = report.conditions.find(item => item?.id === planned.id);
      if (!condition) {
        addFailure(failures, 'condition-missing', `report omits ${planned.id}`);
        continue;
      }
      checkExactKeys(condition, [
        'id', 'outputIdentity', 'conditionTransformSha256', 'requestedRouteId',
        'effectiveRouteId', 'routeReceiptPath', 'routeReceiptSha256', 'products',
      ], `${planned.id} condition receipt`, failures);
      if (condition.outputIdentity !== planned.outputIdentity
        || condition.conditionTransformSha256 !== planned.conditionTransformSha256) {
        addFailure(failures, 'condition-binding-mismatch', `${planned.id} output or transform identity drifted`);
      }
      if (condition.requestedRouteId !== plan.requestedRouteId
        || condition.effectiveRouteId !== plan.requestedRouteId) {
        addFailure(failures, 'route-mismatch', `${planned.id} did not execute the exact requested route`);
      }
      const products = condition.products;
      if (!Array.isArray(products) || products.length !== plan.productContract.length) {
        addFailure(failures, 'product-set-mismatch', `${planned.id} product set is incomplete`);
        continue;
      }
      for (const contract of plan.productContract) {
        const product = products.find(item => item?.kind === contract.kind);
        if (product) {
          checkExactKeys(product, [
            'kind', 'mimeType', 'width', 'height', 'relativePath', 'byteLength', 'sha256',
          ], `${planned.id}/${contract.kind} product receipt`, failures);
        }
        if (!product || product.mimeType !== contract.mimeType
          || product.width !== plan.outputDimensions[0]
          || product.height !== plan.outputDimensions[1]
          || !HASH_PATTERN.test(product.sha256 ?? '')
          || !Number.isInteger(product.byteLength) || product.byteLength <= 0
          || typeof product.relativePath !== 'string' || product.relativePath.length === 0) {
          addFailure(failures, 'product-contract-mismatch', `${planned.id}/${contract.kind} product receipt is invalid`);
          continue;
        }
        const bytes = await readContainedBytes(
          versionDir,
          product.relativePath,
          `${planned.id}/${contract.kind} product`,
          failures,
        );
        if (!bytes) continue;
        if (bytes.length !== product.byteLength || hashBytes(bytes) !== product.sha256) {
          addFailure(failures, 'product-byte-mismatch', `${planned.id}/${contract.kind} product hash or byte length drifted`);
        } else if (product.mimeType === 'image/png') {
          try {
            validatePng(bytes, product.width, product.height, `${planned.id}/${contract.kind}`);
          } catch (error) {
            addFailure(failures, 'product-png-invalid', error.message);
          }
        }
      }
      await validateRouteReceipt({ plan, planned, condition, versionDir, failures });
    }
  }

  if (!isSafeSegment(report.publicationId)) {
    addFailure(failures, 'publication-id-invalid', 'publication id must be one safe path segment');
  }
  const expectedVersion = `versions/${report.publicationId}`;
  const expectedReport = `${expectedVersion}/evidence-report.json`;
  if (pointer.schema !== TRACK_M_POINTER_SCHEMA
    || pointer.status !== 'published'
    || pointer.publicationId !== report.publicationId
    || pointer.relativeVersionPath !== expectedVersion
    || pointer.reportPath !== expectedReport
    || pointer.reportSha256 !== reportEvidence.sha256
    || pointer.planId !== plan.id
    || pointer.sourceReceiptId !== plan.sourceReceiptId
    || pointer.requestedRouteId !== plan.requestedRouteId
    || resolve(reportPath) !== resolve(dirname(pointerPath), expectedReport)) {
    addFailure(failures, 'publication-binding-mismatch', 'pointer does not authenticate the exact immutable report publication');
  }
  try {
    const [actualVersionDir, actualReportPath] = await Promise.all([
      realpath(versionDir),
      realpath(reportPath),
    ]);
    if (!actualReportPath.startsWith(`${actualVersionDir}${sep}`)) {
      addFailure(failures, 'publication-realpath-escape', 'report resolves outside its immutable version directory');
    }
  } catch (error) {
    addFailure(failures, 'publication-realpath-unreadable', 'publication realpath could not be authenticated', {
      reason: error.message,
    });
  }
  return reportEvidence.sha256;
}

async function validateFailure({ plan, failurePath, failures }) {
  const evidence = await readJsonEvidence(failurePath, 'Track M failure receipt', failures);
  if (!evidence) return null;
  const failure = evidence.value;
  checkExactKeys(failure, [
    'schema', 'compilerId', 'status', 'trackId', 'planId', 'sourceReceiptId',
    'requestedRouteId', 'attemptId', 'outputIdentity', 'failure', 'lastTrustworthyEvidence',
  ], 'Track M failure receipt', failures);
  checkExactKeys(failure.failure, ['phase', 'name', 'message'], 'Track M failure identity', failures);
  if (failure.schema !== TRACK_M_FAILURE_SCHEMA
    || failure.compilerId !== plan.compilerId
    || failure.status !== 'failed'
    || failure.trackId !== plan.trackId
    || failure.planId !== plan.id
    || failure.sourceReceiptId !== plan.sourceReceiptId
    || failure.requestedRouteId !== plan.requestedRouteId
    || failure.outputIdentity !== plan.bundleOutputIdentity
    || typeof failure.attemptId !== 'string' || failure.attemptId.length === 0
    || !TRACK_M_FAILURE_PHASES.includes(failure.failure?.phase)
    || typeof failure.failure?.name !== 'string' || failure.failure.name.length === 0
    || typeof failure.failure?.message !== 'string' || failure.failure.message.length === 0
    || typeof failure.lastTrustworthyEvidence !== 'string' || failure.lastTrustworthyEvidence.length === 0) {
    addFailure(failures, 'failure-binding-mismatch', 'failure receipt does not bind the exact Track M plan and failure phase');
  }
  return evidence.sha256;
}

export async function validateTrackMEvidenceOutcome({
  plan,
  reportPath = null,
  publicationPointerPath = null,
  failurePath = null,
} = {}) {
  const failures = [];
  if (plan?.schema !== TRACK_M_PLAN_SCHEMA || plan?.compilerId !== TRACK_M_COMPILER_ID
    || plan?.trackId !== TRACK_M_TRACK_ID) {
    addFailure(failures, 'plan-contract-invalid', 'outcome admission requires the exact Track M plan');
  }
  validatePlanIntegrity(plan, failures);
  if (failures.some(failure => failure.code === 'plan-contract-invalid'
    || failure.code === 'plan-integrity-mismatch'
    || failure.code === 'plan-route-contract-invalid')) {
    return { ok: false, status: 'outcome-rejected', evidenceSha256: null, failures };
  }
  const evidenceCount = Number(reportPath !== null) + Number(failurePath !== null);
  if (evidenceCount !== 1) {
    addFailure(failures, 'outcome-evidence-ambiguous', 'provide exactly one report path or failure receipt path');
    return { ok: false, status: 'outcome-rejected', evidenceSha256: null, failures };
  }
  let evidenceSha256 = null;
  if (reportPath !== null) {
    evidenceSha256 = await validatePublishedReport({
      plan,
      reportPath,
      pointerPath: publicationPointerPath,
      failures,
    });
  } else {
    if (publicationPointerPath !== null) {
      addFailure(failures, 'failed-outcome-publication-claimed', 'a failed attempt cannot claim publication');
    }
    evidenceSha256 = await validateFailure({ plan, failurePath, failures });
  }
  return {
    ok: failures.length === 0,
    status: failures.length > 0
      ? 'outcome-rejected'
      : (reportPath !== null ? 'published-outcome-validated' : 'failed-outcome-validated'),
    evidenceSha256,
    failures,
  };
}
