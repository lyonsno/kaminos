import {
  SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY,
  SMOKE_SPLAT_PACKING_IDENTITY,
  validateSmokeSplatGpuProduct,
} from './smoke-splat-gpu-product.mjs';
import { createSmokeSplatSlotCache } from './smoke-splat-slot-cache.mjs';

export const SMOKE_SPLAT_MOTION_MANIFEST_SCHEMA = 'kaminos.smoke-splat-motion-source.v0';
export const SMOKE_SPLAT_MOTION_ROUTE_IDENTITY = 'webgpu-real-field-hierarchical-smoke-motion-v0';
export const SMOKE_SPLAT_MOTION_TEMPORAL_AUTHORITY = 'velocity-carried-short-horizon-extrapolation-v0';
export const SMOKE_GAUSSIAN_PHASE_TEMPORAL_AUTHORITY = 'independent-adjacent-teacher-phase-products-v0';
export const SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA = 'kaminos.smoke-gaussian-oracle-phase-product.v0';
export const SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY = 'oracle-fitted-gaussian-smoke-splat-producer-v0';
export const SMOKE_GAUSSIAN_PHASE_ROLE_MAPPING_AUTHORITY = 'all-gaussians-transport-role-no-hierarchy-v0';
export const SMOKE_GAUSSIAN_PHASE_CONVERSION_AUTHORITY = 'full-covariance-to-axisymmetric-major-eigenvector-v0';
export const SMOKE_GAUSSIAN_PHASE_TRANSFER_REQUEST_SCHEMA = 'kaminos.smoke-gaussian-phase-transfer-request.v0';
export const SMOKE_SPLAT_FOOTPRINT_BILLBOARD_AUTHORITY = 'camera-upright-billboard-v0';
export const SMOKE_SPLAT_FOOTPRINT_PROJECTED_COVARIANCE_AUTHORITY = 'axisymmetric-projected-covariance-v1';

const PRODUCT_SCHEMA = 'kaminos-hierarchical-smoke-splats-v0';
const PRODUCER_AUTHORITY = 'real-field-hierarchical-smoke-splat-producer-v0';
const CHANNEL_COUNT = 16;
const CHANNEL_ORDER = [
  'positionX',
  'positionY',
  'positionZ',
  'principalAxisX',
  'principalAxisY',
  'principalAxisZ',
  'radiusX',
  'radiusY',
  'radiusZ',
  'extinctionMass',
  'densityWitness',
  'temperatureWitness',
  'velocityX',
  'velocityY',
  'velocityZ',
  'hierarchyRoleCode',
];
const GAUSSIAN_CHANNEL_COUNT = 28;
const GAUSSIAN_CHANNEL_ORDER = [
  'positionX', 'positionY', 'positionZ',
  'covXX', 'covXY', 'covXZ', 'covYY', 'covYZ', 'covZZ',
  'axis0X', 'axis0Y', 'axis0Z', 'axis1X', 'axis1Y', 'axis1Z', 'axis2X', 'axis2Y', 'axis2Z',
  'radius0', 'radius1', 'radius2',
  'extinctionMass', 'densityWitness', 'temperatureWitness',
  'velocityX', 'velocityY', 'velocityZ', 'sourceVoxelCount',
];

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireIdentity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function requireFinite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function requireNonNegative(value, label) {
  const number = requireFinite(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative`);
  return number;
}

function requireInteger(value, label) {
  const number = requireFinite(value, label);
  if (!Number.isInteger(number)) throw new TypeError(`${label} must be an integer`);
  return number;
}

function requireVector3(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} must be a vec3 array`);
  return value.map((component, index) => requireFinite(component, `${label}[${index}]`));
}

function subtract3(left, right) {
  return left.map((value, index) => value - right[index]);
}

function dot3(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize3(value, label) {
  const length = Math.hypot(...value);
  if (!(length > 1e-12)) throw new RangeError(`${label} must have nonzero length`);
  return value.map(component => component / length);
}

export function cameraFrame(eyeValue, targetValue, worldUpValue) {
  const eye = requireVector3(eyeValue, 'eye');
  const target = requireVector3(targetValue, 'target');
  const worldUp = normalize3(requireVector3(worldUpValue, 'worldUp'), 'worldUp');
  const backward = normalize3(subtract3(eye, target), 'eye-target');
  const right = normalize3(cross3(worldUp, backward), 'camera right');
  const up = normalize3(cross3(backward, right), 'camera up');
  return { right, up, backward };
}

export function projectAxisymmetricSmokeFootprint(request = {}) {
  const principalAxis = normalize3(requireVector3(request.principalAxis, 'principalAxis'), 'principalAxis');
  const cameraRight = normalize3(requireVector3(request.cameraRight, 'cameraRight'), 'cameraRight');
  const cameraUp = normalize3(requireVector3(request.cameraUp, 'cameraUp'), 'cameraUp');
  const radialRadius = requireFinite(request.radialRadius, 'radialRadius');
  const longitudinalRadius = requireFinite(request.longitudinalRadius, 'longitudinalRadius');
  if (!(radialRadius > 0) || !(longitudinalRadius > 0)) throw new RangeError('footprint radii must be positive');
  const axisRight = dot3(principalAxis, cameraRight);
  const axisUp = dot3(principalAxis, cameraUp);
  const radialVariance = radialRadius * radialRadius;
  const varianceDelta = longitudinalRadius * longitudinalRadius - radialVariance;
  const covarianceXX = radialVariance + varianceDelta * axisRight * axisRight;
  const covarianceYY = radialVariance + varianceDelta * axisUp * axisUp;
  const covarianceXY = varianceDelta * axisRight * axisUp;
  const discriminant = Math.hypot(covarianceXX - covarianceYY, 2 * covarianceXY);
  const majorVariance = Math.max(0, (covarianceXX + covarianceYY + discriminant) * 0.5);
  const minorVariance = Math.max(0, (covarianceXX + covarianceYY - discriminant) * 0.5);
  const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  const majorAxis = [Math.cos(angle), Math.sin(angle)];
  const minorAxis = [-majorAxis[1], majorAxis[0]];
  const majorRadius = Math.sqrt(majorVariance);
  const minorRadius = Math.sqrt(minorVariance);
  return {
    covariance: [covarianceXX, covarianceXY, covarianceYY],
    majorAxis,
    minorAxis,
    majorRadius,
    minorRadius,
    supportArea: Math.PI * majorRadius * minorRadius,
  };
}

function validateArtifact(artifact, productIndex, productSchema) {
  requireObject(artifact, `product ${productIndex} artifact`);
  requireIdentity(artifact.path, `product ${productIndex} artifact path`);
  if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
    throw new Error(`product ${productIndex} artifact sha256 must be a lowercase content hash`);
  }
  const byteLength = requireInteger(artifact.byteLength, `product ${productIndex} artifact byteLength`);
  const gaussianProduct = productSchema === SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA;
  const channelCount = gaussianProduct ? GAUSSIAN_CHANNEL_COUNT : CHANNEL_COUNT;
  const channelOrder = gaussianProduct ? GAUSSIAN_CHANNEL_ORDER : CHANNEL_ORDER;
  if (byteLength <= 0 || byteLength % (channelCount * 4) !== 0) {
    throw new Error(`product ${productIndex} artifact byteLength is not packed float32x${channelCount}`);
  }
  if (artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian') {
    throw new Error(`product ${productIndex} artifact encoding mismatch`);
  }
  if (!Array.isArray(artifact.shape) || artifact.shape.length !== 2 || artifact.shape[1] !== channelCount) {
    throw new Error(`product ${productIndex} artifact shape must be [count, ${channelCount}]`);
  }
  if (artifact.shape[0] * channelCount * 4 !== byteLength) {
    throw new Error(`product ${productIndex} artifact shape and byteLength disagree`);
  }
  if (!Array.isArray(artifact.channelOrder) || artifact.channelOrder.join('|') !== channelOrder.join('|')) {
    throw new Error(`product ${productIndex} artifact channel order mismatch`);
  }
  if (gaussianProduct && artifact.sourcePackingIdentity !== 'float32x28-full-covariance-gaussian-v0') {
    throw new Error(`product ${productIndex} Gaussian source packing identity mismatch`);
  }
}

function validateProduct(product, index, producerAuthority) {
  requireObject(product, `product ${index}`);
  requireIdentity(product.identity, `product ${index} identity`);
  if (![PRODUCT_SCHEMA, SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA].includes(product.schema)) {
    throw new Error(`product ${index} schema mismatch`);
  }
  if (product.producerAuthority !== producerAuthority) throw new Error(`product ${index} producer authority mismatch`);
  if (product.schema === SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA
      && product.roleMappingAuthority !== SMOKE_GAUSSIAN_PHASE_ROLE_MAPPING_AUTHORITY) {
    throw new Error(`product ${index} Gaussian role mapping authority mismatch`);
  }
  requireIdentity(product.producerKind, `product ${index} producerKind`);
  requireObject(product.slotIdentity, `product ${index} slotIdentity`);
  requireInteger(product.slotIdentity.historySlot, `product ${index} historySlot`);
  requireInteger(product.slotIdentity.slotWriteTick, `product ${index} slotWriteTick`);
  requireInteger(product.slotIdentity.simulatorGeneration, `product ${index} simulatorGeneration`);
  requireIdentity(product.slotIdentity.modelIdentity, `product ${index} modelIdentity`);
  const counts = requireObject(product.hierarchyCounts, `product ${index} hierarchyCounts`);
  const coarse = requireInteger(counts.coarse, `product ${index} coarse count`);
  const fine = requireInteger(counts.fine, `product ${index} fine count`);
  const total = requireInteger(counts.total, `product ${index} total count`);
  if (coarse <= 0 || fine < 0 || total !== coarse + fine) throw new Error(`product ${index} hierarchy counts are incoherent`);
  const accounting = requireObject(product.accounting, `product ${index} accounting`);
  requireNonNegative(accounting.sourceExtinctionMass, `product ${index} source extinction`);
  requireNonNegative(accounting.representedExtinctionMass, `product ${index} represented extinction`);
  if (requireNonNegative(accounting.rejectedExtinctionMass, `product ${index} rejected extinction`) !== 0) {
    throw new Error(`product ${index} rejected extinction mass is nonzero`);
  }
  const capacity = requireObject(product.capacity, `product ${index} capacity`);
  if (capacity.outputWasTruncated !== false) throw new Error(`product ${index} outputWasTruncated must be false`);
  if (requireNonNegative(capacity.overflowCount, `product ${index} overflow count`) !== 0) {
    throw new Error(`product ${index} cannot enter the first motion witness with overflow`);
  }
  validateArtifact(product.artifact, index, product.schema);
  if (product.artifact.shape[0] !== total) throw new Error(`product ${index} artifact count does not match hierarchy total`);
}

export function validateSmokeSplatMotionManifest(candidate) {
  const manifest = requireObject(candidate, 'motion manifest');
  if (manifest.schema !== SMOKE_SPLAT_MOTION_MANIFEST_SCHEMA) throw new Error('motion manifest schema mismatch');
  if (manifest.status !== 'passed') throw new Error('motion manifest is not passed source evidence');
  if (manifest.requestedRoute !== manifest.effectiveRoute) {
    throw new Error(`requested and effective route mismatch: ${manifest.requestedRoute} != ${manifest.effectiveRoute}`);
  }
  if (manifest.effectiveRoute !== SMOKE_SPLAT_MOTION_ROUTE_IDENTITY) throw new Error('effective route is not the WebGPU smoke motion route');
  if (manifest.fallbackReason !== null) throw new Error(`motion manifest declares fallback: ${manifest.fallbackReason}`);
  if (![SMOKE_SPLAT_MOTION_TEMPORAL_AUTHORITY, SMOKE_GAUSSIAN_PHASE_TEMPORAL_AUTHORITY].includes(manifest.temporalAuthority)) {
    throw new Error('temporal authority mismatch');
  }
  const producerAuthority = requireIdentity(manifest.producerAuthority, 'manifest producer authority');
  if (manifest.temporalAuthority === SMOKE_GAUSSIAN_PHASE_TEMPORAL_AUTHORITY
      && producerAuthority !== SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY) {
    throw new Error('Gaussian temporal authority requires the Gaussian phase producer');
  }
  if (manifest.temporalAuthority === SMOKE_SPLAT_MOTION_TEMPORAL_AUTHORITY
      && producerAuthority !== PRODUCER_AUTHORITY) {
    throw new Error('reference temporal authority requires the real-field hierarchy producer');
  }
  if (!Array.isArray(manifest.products) || manifest.products.length === 0) throw new Error('motion manifest products must be non-empty');
  manifest.products.forEach((product, index) => validateProduct(product, index, producerAuthority));
  const productIdentities = new Set(manifest.products.map(product => product.identity));
  if (productIdentities.size !== manifest.products.length) throw new Error('motion manifest contains duplicate product identities');
  return manifest;
}

export function parsePackedSmokeSplatProduct(buffer, product) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('packed product must be an ArrayBuffer');
  const artifact = requireObject(product.artifact, 'product artifact');
  if (buffer.byteLength !== artifact.byteLength) {
    throw new Error(`packed product byteLength mismatch: ${buffer.byteLength} != ${artifact.byteLength}`);
  }
  const sourceValues = new Float32Array(buffer);
  const count = requireInteger(artifact.shape?.[0], 'artifact splat count');
  const gaussianProduct = product.schema === SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA;
  const sourceChannelCount = gaussianProduct ? GAUSSIAN_CHANNEL_COUNT : CHANNEL_COUNT;
  if (sourceValues.length !== count * sourceChannelCount) throw new Error('packed product float count mismatch');
  let values = sourceValues;
  let conversionAuthority = null;
  if (gaussianProduct) {
    if (product.roleMappingAuthority !== SMOKE_GAUSSIAN_PHASE_ROLE_MAPPING_AUTHORITY) {
      throw new Error('Gaussian product role mapping authority mismatch');
    }
    values = new Float32Array(count * CHANNEL_COUNT);
    for (let index = 0; index < count; index += 1) {
      const sourceOffset = index * GAUSSIAN_CHANNEL_COUNT;
      const outputOffset = index * CHANNEL_COUNT;
      values.set([
        sourceValues[sourceOffset], sourceValues[sourceOffset + 1], sourceValues[sourceOffset + 2],
        sourceValues[sourceOffset + 9], sourceValues[sourceOffset + 10], sourceValues[sourceOffset + 11],
        sourceValues[sourceOffset + 19], sourceValues[sourceOffset + 18], sourceValues[sourceOffset + 20],
        sourceValues[sourceOffset + 21], sourceValues[sourceOffset + 22], sourceValues[sourceOffset + 23],
        sourceValues[sourceOffset + 24], sourceValues[sourceOffset + 25], sourceValues[sourceOffset + 26],
        0,
      ], outputOffset);
    }
    conversionAuthority = SMOKE_GAUSSIAN_PHASE_CONVERSION_AUTHORITY;
  }
  const splats = [];
  let coarse = 0;
  let fine = 0;
  let extinctionMass = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * CHANNEL_COUNT;
    const role = values[offset + 15];
    if (role !== 0 && role !== 1) throw new Error(`packed splat ${index} hierarchy role must be 0 or 1`);
    if (role === 0) coarse += 1;
    else fine += 1;
    const mass = values[offset + 9];
    if (!Number.isFinite(mass) || mass < 0) throw new Error(`packed splat ${index} extinction mass is invalid`);
    extinctionMass += mass;
    splats.push({
      index,
      hierarchyRoleCode: role,
      extinctionMass: mass,
    });
  }
  if (coarse !== product.hierarchyCounts.coarse || fine !== product.hierarchyCounts.fine) {
    throw new Error(`packed hierarchy count mismatch: ${coarse}/${fine}`);
  }
  const representedExtinctionMass = requireNonNegative(
    requireObject(product.accounting, 'product accounting').representedExtinctionMass,
    'product represented extinction mass',
  );
  const extinctionTolerance = Math.max(1e-7, representedExtinctionMass * 5e-6);
  if (Math.abs(extinctionMass - representedExtinctionMass) > extinctionTolerance) {
    throw new Error(
      `packed extinction mass mismatch: ${extinctionMass} != ${representedExtinctionMass}`,
    );
  }
  return {
    ...product,
    packed: values,
    splats,
    packedExtinctionMass: extinctionMass,
    conversionAuthority,
  };
}

function deterministicFineUnit(index) {
  let value = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  return (value >>> 0) / 0xffffffff;
}

export function selectSmokeSplatIndices(product, options = {}) {
  const fineLodFraction = requireFinite(options.fineLodFraction ?? 1, 'fineLodFraction');
  if (fineLodFraction < 0 || fineLodFraction > 1) throw new RangeError('fineLodFraction must be between zero and one');
  if (!Array.isArray(product.splats)) throw new TypeError('product splats must be an array');
  const indices = [];
  for (const splat of product.splats) {
    if (splat.hierarchyRoleCode === 0 || deterministicFineUnit(splat.index ?? indices.length) < fineLodFraction) {
      indices.push(splat.index ?? indices.length);
    }
  }
  return indices;
}

function prepareProductUpload(product, fineLodFraction) {
  if (product?.packedBuffer) {
    if (fineLodFraction !== 1) {
      throw new Error('live GPU product fine LOD requires a dedicated GPU repack and cannot be applied implicitly');
    }
    validateSmokeSplatGpuProduct(product, { device: product.device });
    const total = requireInteger(product?.activeCount, 'live GPU product active count');
    const capacity = requireInteger(product?.capacity, 'live GPU product capacity');
    const coarse = requireInteger(product?.hierarchyCounts?.coarse, 'live GPU product coarse count');
    const fine = requireInteger(product?.hierarchyCounts?.fine, 'live GPU product fine count');
    if (coarse < 0 || fine < 0 || coarse + fine !== total) {
      throw new Error('live GPU product hierarchy counts are inconsistent');
    }
    return {
      productIdentity: requireIdentity(product.identity, 'live GPU product identity'),
      selectedIndices: null,
      selectedCount: total,
      sourceCount: capacity,
      capacity,
      activeCount: total,
      requestedRepresentation: product.representation.requestedIdentity,
      effectiveRepresentation: product.representation.effectiveIdentity,
      sourceRepresentation: product.representation.sourceIdentity ?? product.representation.requestedIdentity,
      conversionAuthority: product.representation.conversionAuthority ?? null,
      fallbackReason: product.representation.fallbackReason,
      coarseCount: coarse,
      fineCount: fine,
      sourceExtinctionMass: null,
      representedExtinctionMass: null,
      rejectedExtinctionMass: 0,
      coarseMassCompensation: 0,
      packed: null,
      packedBuffer: product.packedBuffer,
      productDevice: product.device,
      productOwnership: product.ownership,
      drawAuthority: product.draw.authority,
      drawMode: product.draw.mode,
    };
  }
  const selectedIndices = selectSmokeSplatIndices(product, { fineLodFraction });
  const coarseIndices = selectedIndices.filter(index => product.splats[index].hierarchyRoleCode === 0);
  if (coarseIndices.length !== product.hierarchyCounts.coarse) throw new Error('coarseSplatsAlwaysPresent invariant failed');
  const selectedMass = selectedIndices.reduce((sum, index) => sum + product.splats[index].extinctionMass, 0);
  const sourceMass = product.splats.reduce((sum, splat) => sum + splat.extinctionMass, 0);
  const coarseMass = coarseIndices.reduce((sum, index) => sum + product.splats[index].extinctionMass, 0);
  const compensation = coarseMass > 0 ? (sourceMass - selectedMass) / coarseMass : 0;
  let packed = null;
  if (product.packed instanceof Float32Array) {
    packed = new Float32Array(selectedIndices.length * CHANNEL_COUNT);
    for (let outputIndex = 0; outputIndex < selectedIndices.length; outputIndex += 1) {
      const sourceIndex = selectedIndices[outputIndex];
      const sourceOffset = sourceIndex * CHANNEL_COUNT;
      const outputOffset = outputIndex * CHANNEL_COUNT;
      packed.set(product.packed.subarray(sourceOffset, sourceOffset + CHANNEL_COUNT), outputOffset);
      if (product.splats[sourceIndex].hierarchyRoleCode === 0) packed[outputOffset + 9] *= 1 + compensation;
    }
  }
  const sourceRepresentation = product.artifact?.sourcePackingIdentity
    ?? product.producerKind
    ?? product.producerAuthority
    ?? 'offline-packed-product-v0';
  const conversionAuthority = product.conversionAuthority ?? null;
  const effectiveRepresentation = conversionAuthority
    ? SMOKE_SPLAT_PACKING_IDENTITY
    : (product.producerKind ?? product.producerAuthority ?? 'offline-packed-product-v0');
  return {
    productIdentity: product.identity,
    selectedIndices,
    selectedCount: selectedIndices.length,
    sourceCount: product.splats.length,
    capacity: product.splats.length,
    activeCount: selectedIndices.length,
    sourceRepresentation,
    conversionAuthority,
    requestedRepresentation: effectiveRepresentation,
    effectiveRepresentation,
    fallbackReason: null,
    coarseCount: coarseIndices.length,
    fineCount: selectedIndices.length - coarseIndices.length,
    sourceExtinctionMass: sourceMass,
    representedExtinctionMass: sourceMass,
    rejectedExtinctionMass: 0,
    coarseMassCompensation: compensation,
    packed,
  };
}

export function buildSmokeSplatDrawPlan({ products, instanceCount, fineLodFraction = 1 } = {}) {
  if (!Array.isArray(products) || products.length === 0) throw new TypeError('products must be non-empty');
  const count = requireInteger(instanceCount, 'instanceCount');
  if (count <= 0) throw new RangeError('instanceCount must be positive');
  const productUploads = products.map(product => prepareProductUpload(product, fineLodFraction));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const spacing = count <= 4 ? 2.15 : Math.max(1.55, 4.8 / Math.sqrt(count));
  const instanceBindings = Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const productIndex = index % products.length;
    return {
      instanceIndex: index,
      productIndex,
      productIdentity: products[productIndex].identity,
      translation: [
        (column - (columns - 1) * 0.5) * spacing,
        0,
        (row - (rows - 1) * 0.5) * spacing,
      ],
      phaseOffset: index / count,
    };
  });
  return {
    identity: 'smoke-splat-motion-draw-plan-v0',
    instanceCount: count,
    uniqueProductCount: products.length,
    fineLodFraction,
    coarseSplatsAlwaysPresent: productUploads.every(upload => upload.coarseCount > 0),
    rejectedExtinctionMass: productUploads.reduce((sum, upload) => sum + upload.rejectedExtinctionMass, 0),
    productUploads,
    instanceBindings,
  };
}

export function buildPhaseMatchedHybridSmokePlan({
  products,
  flameInstances,
  fineLodFraction = 1,
  requestedRoute,
  effectiveRoute,
} = {}) {
  if (!Array.isArray(products) || products.length === 0) throw new TypeError('products must be non-empty');
  if (!Array.isArray(flameInstances) || flameInstances.length === 0) {
    throw new TypeError('flameInstances must be non-empty');
  }
  const requestedRouteIdentity = requireIdentity(requestedRoute, 'requestedRoute');
  const effectiveRouteIdentity = requireIdentity(effectiveRoute, 'effectiveRoute');
  if (requestedRouteIdentity !== effectiveRouteIdentity) {
    throw new Error(
      `requested and effective hybrid route mismatch: ${requestedRouteIdentity} != ${effectiveRouteIdentity}`,
    );
  }

  const chronologicalProducts = [...products].sort((left, right) => (
    requireInteger(left?.slotIdentity?.slotWriteTick, 'product slotWriteTick')
    - requireInteger(right?.slotIdentity?.slotWriteTick, 'product slotWriteTick')
  ));
  for (let index = 1; index < chronologicalProducts.length; index += 1) {
    const previousTick = chronologicalProducts[index - 1].slotIdentity.slotWriteTick;
    const currentTick = chronologicalProducts[index].slotIdentity.slotWriteTick;
    if (currentTick !== previousTick + 1) {
      throw new Error(`hybrid smoke products must have consecutive write ticks: ${previousTick} -> ${currentTick}`);
    }
  }

  const productUploads = chronologicalProducts.map(product => prepareProductUpload(product, fineLodFraction));
  const productsByRelativeAge = [...chronologicalProducts].reverse();
  const productIndexByIdentity = new Map(
    chronologicalProducts.map((product, index) => [product.identity, index]),
  );
  const instanceBindings = flameInstances.map((instance, instanceIndex) => {
    const relativeAgeSlots = requireInteger(
      instance?.phaseHistoryOffsetSlots,
      `flame instance ${instanceIndex} phaseHistoryOffsetSlots`,
    );
    if (relativeAgeSlots < 0) throw new RangeError(`flame instance ${instanceIndex} relative age must be non-negative`);
    if (relativeAgeSlots >= productsByRelativeAge.length) {
      throw new RangeError(
        `flame instance ${instanceIndex} relative age ${relativeAgeSlots} exceeds the ${productsByRelativeAge.length}-product temporal horizon`,
      );
    }
    const product = productsByRelativeAge[relativeAgeSlots];
    const translation = requireVector3(instance?.transform?.translate, `flame instance ${instanceIndex} translation`);
    const scale = requireFinite(instance?.transform?.scale, `flame instance ${instanceIndex} scale`);
    if (!(scale > 0)) throw new RangeError(`flame instance ${instanceIndex} scale must be positive`);
    const descriptorIndex = requireInteger(instance?.index ?? instanceIndex, `flame instance ${instanceIndex} index`);
    if (descriptorIndex !== instanceIndex) {
      throw new Error(
        `flame instance ${instanceIndex} dense descriptor index must be ${instanceIndex}, got ${descriptorIndex}`,
      );
    }
    return {
      instanceIndex: descriptorIndex,
      relativeAgeSlots,
      productIndex: productIndexByIdentity.get(product.identity),
      productIdentity: product.identity,
      productWriteTick: product.slotIdentity.slotWriteTick,
      translation,
      scale,
    };
  });

  const maxSelectedProductCount = Math.max(...productUploads.map(upload => upload.selectedCount));
  const drawAuthorities = new Set(productUploads.map(upload => upload.drawAuthority ?? SMOKE_SPLAT_DIRECT_DRAW_AUTHORITY));
  const drawModes = new Set(productUploads.map(upload => upload.drawMode ?? 'direct'));
  if (drawAuthorities.size !== 1 || drawModes.size !== 1) {
    throw new Error('hybrid smoke products must share one draw authority and mode');
  }
  const drawAuthority = [...drawAuthorities][0];
  const drawMode = [...drawModes][0];
  if (drawMode !== 'direct') {
    throw new Error('indirect smoke products require a renderer-owned instance-count draw plan');
  }
  const drawInstanceCount = maxSelectedProductCount * instanceBindings.length;
  if (!Number.isSafeInteger(drawInstanceCount) || drawInstanceCount > 0xffffffff) {
    throw new RangeError(`requested uncapped hybrid draw exceeds WebGPU draw instance address space: ${drawInstanceCount}`);
  }
  return {
    identity: 'phase-matched-spatial-strata-hybrid-plan-v0',
    status: 'bound',
    requestedRoute: requestedRouteIdentity,
    effectiveRoute: effectiveRouteIdentity,
    temporalAuthority: 'explicit-relative-age-consecutive-product-binding-v0',
    temporalHorizonProducts: chronologicalProducts.length,
    latestSlotWriteTick: chronologicalProducts.at(-1).slotIdentity.slotWriteTick,
    oldestSlotWriteTick: chronologicalProducts[0].slotIdentity.slotWriteTick,
    flameInstanceCount: instanceBindings.length,
    uniqueProductCount: productUploads.length,
    fineLodFraction,
    maxSelectedProductCount,
    drawAuthority,
    drawMode,
    drawInstanceCount,
    rejectedExtinctionMass: productUploads.reduce((sum, upload) => sum + upload.rejectedExtinctionMass, 0),
    productUploads,
    instanceBindings,
  };
}

export function assessControlledHybridSmokeMotion({
  sameTimeRepeatMeanAbsDiff,
  simulatorStepCounts,
  controlledTimesMs,
  rendererElapsedSeconds,
  frameHashes,
  adjacentMeanAbsDiffs,
  flameControlMeanAbsDiffs,
  determinismTolerance = 0.02,
  flameControlTolerance = 0.02,
  timeToleranceSeconds = 1e-6,
  motionThreshold = 0.1,
} = {}) {
  if (!Array.isArray(simulatorStepCounts) || simulatorStepCounts.length < 2) {
    throw new TypeError('simulatorStepCounts must contain at least two captures');
  }
  if (!Array.isArray(controlledTimesMs) || controlledTimesMs.length !== simulatorStepCounts.length) {
    throw new TypeError('controlledTimesMs must align with simulatorStepCounts');
  }
  if (!Array.isArray(frameHashes) || frameHashes.length !== simulatorStepCounts.length) {
    throw new TypeError('frameHashes must align with simulatorStepCounts');
  }
  if (!Array.isArray(rendererElapsedSeconds) || rendererElapsedSeconds.length !== simulatorStepCounts.length) {
    throw new TypeError('rendererElapsedSeconds must align with simulatorStepCounts');
  }
  if (!Array.isArray(adjacentMeanAbsDiffs) || adjacentMeanAbsDiffs.length !== simulatorStepCounts.length - 1) {
    throw new TypeError('adjacentMeanAbsDiffs must describe every adjacent capture pair');
  }
  if (!Array.isArray(flameControlMeanAbsDiffs) || flameControlMeanAbsDiffs.length !== simulatorStepCounts.length - 1) {
    throw new TypeError('flameControlMeanAbsDiffs must describe every adjacent capture pair');
  }
  const baseStep = requireInteger(simulatorStepCounts[0], 'simulatorStepCounts[0]');
  if (simulatorStepCounts.some((value, index) => requireInteger(value, `simulatorStepCounts[${index}]`) !== baseStep)) {
    throw new Error('simulator state moved during the controlled smoke-only timeline');
  }
  const times = controlledTimesMs.map((value, index) => requireFinite(value, `controlledTimesMs[${index}]`));
  for (let index = 1; index < times.length; index += 1) {
    if (!(times[index] > times[index - 1])) throw new Error('controlled smoke time must increase strictly');
  }
  const elapsedTimes = rendererElapsedSeconds.map((value, index) => requireFinite(value, `rendererElapsedSeconds[${index}]`));
  elapsedTimes.forEach((elapsed, index) => {
    const expected = times[index] * 0.001;
    if (Math.abs(elapsed - expected) > timeToleranceSeconds) {
      throw new Error(`renderer elapsed time disagreement at frame ${index}: ${elapsed} != ${expected}`);
    }
  });
  const repeatDiff = requireNonNegative(sameTimeRepeatMeanAbsDiff, 'sameTimeRepeatMeanAbsDiff');
  if (repeatDiff > determinismTolerance) {
    throw new Error(`same-time smoke determinism failed: ${repeatDiff} > ${determinismTolerance}`);
  }
  const diffs = adjacentMeanAbsDiffs.map((value, index) => requireNonNegative(value, `adjacentMeanAbsDiffs[${index}]`));
  const flameDiffs = flameControlMeanAbsDiffs.map((value, index) => requireNonNegative(value, `flameControlMeanAbsDiffs[${index}]`));
  const maxFlameControlMeanAbsDiff = Math.max(...flameDiffs);
  if (maxFlameControlMeanAbsDiff > flameControlTolerance) {
    throw new Error(`flame control moved during smoke-only motion proof: ${maxFlameControlMeanAbsDiff} > ${flameControlTolerance}`);
  }
  const maxMeanAbsDiff = Math.max(...diffs);
  const uniqueFrameHashCount = new Set(frameHashes.map((value, index) => requireIdentity(value, `frameHashes[${index}]`))).size;
  if (uniqueFrameHashCount < 2 || !(maxMeanAbsDiff > motionThreshold)) {
    throw new Error('cached or static hybrid output rejected: controlled smoke did not move in pixels');
  }
  return {
    status: 'passed',
    authority: 'frozen-simulator-controlled-smoke-time-pixel-delta-v0',
    simulatorStepCount: baseStep,
    controlledDurationMs: times.at(-1) - times[0],
    uniqueFrameHashCount,
    maxMeanAbsDiff,
    sameTimeRepeatMeanAbsDiff: repeatDiff,
    maxFlameControlMeanAbsDiff,
  };
}

export function assessLiveCoupledSmokeMotion({
  simulatorStepCounts,
  newestProductTicks,
  frameStateIdentities,
  smokeContributionMeanAbsDiffs,
  smokeResidualMotionMeanAbsDiffs,
  contributionThreshold = 0.02,
  motionThreshold = 0.02,
} = {}) {
  if (!Array.isArray(simulatorStepCounts) || simulatorStepCounts.length < 2) {
    throw new TypeError('simulatorStepCounts must contain at least two captures');
  }
  const frameCount = simulatorStepCounts.length;
  if (!Array.isArray(newestProductTicks) || newestProductTicks.length !== frameCount) {
    throw new TypeError('newestProductTicks must align with simulatorStepCounts');
  }
  if (!Array.isArray(frameStateIdentities) || frameStateIdentities.length !== frameCount) {
    throw new TypeError('frame state identities must align with simulatorStepCounts');
  }
  if (!Array.isArray(smokeContributionMeanAbsDiffs) || smokeContributionMeanAbsDiffs.length !== frameCount) {
    throw new TypeError('smokeContributionMeanAbsDiffs must describe every captured frame');
  }
  if (!Array.isArray(smokeResidualMotionMeanAbsDiffs)
      || smokeResidualMotionMeanAbsDiffs.length !== frameCount - 1) {
    throw new TypeError('smokeResidualMotionMeanAbsDiffs must describe every adjacent frame pair');
  }

  const steps = simulatorStepCounts.map((value, index) => requireInteger(value, `simulatorStepCounts[${index}]`));
  const ticks = newestProductTicks.map((value, index) => requireInteger(value, `newestProductTicks[${index}]`));
  const stateIds = frameStateIdentities.map((value, index) => requireIdentity(value, `frame state identity ${index}`));
  for (let index = 0; index < frameCount; index += 1) {
    if (ticks[index] !== steps[index]) {
      throw new Error(`live smoke product tick ${ticks[index]} does not match simulator step ${steps[index]} at frame ${index}`);
    }
  }
  for (let index = 1; index < frameCount; index += 1) {
    if (!(steps[index] > steps[index - 1])) throw new Error('live coupled simulator did not advance');
    if (!(ticks[index] > ticks[index - 1])) throw new Error('live smoke products did not advance');
    if (stateIds[index] === stateIds[index - 1]) throw new Error('frame state identity did not advance');
  }

  const contributions = smokeContributionMeanAbsDiffs.map((value, index) => (
    requireNonNegative(value, `smokeContributionMeanAbsDiffs[${index}]`)
  ));
  const minimumContribution = Math.min(...contributions);
  if (!(minimumContribution > contributionThreshold)) {
    throw new Error(`live smoke contribution is missing or composited away: ${minimumContribution} <= ${contributionThreshold}`);
  }
  const residualMotion = smokeResidualMotionMeanAbsDiffs.map((value, index) => (
    requireNonNegative(value, `smokeResidualMotionMeanAbsDiffs[${index}]`)
  ));
  const maxResidualMotion = Math.max(...residualMotion);
  if (!(maxResidualMotion > motionThreshold)) {
    throw new Error(`live smoke residual did not move: ${maxResidualMotion} <= ${motionThreshold}`);
  }

  return {
    status: 'passed',
    authority: 'frame-locked-live-smoke-residual-motion-v1',
    simulatorStepCounts: steps,
    newestProductTicks: ticks,
    frameStateIdentities: stateIds,
    minimumSmokeContributionMeanAbsDiff: minimumContribution,
    maxSmokeResidualMotionMeanAbsDiff: maxResidualMotion,
  };
}

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function exactUrl(value, baseUrl, label) {
  return new URL(requireIdentity(value, label), baseUrl);
}

async function fetchExactBytes(url, expectedSha256, label) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} fetch failed with ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  const digest = await sha256Hex(buffer);
  if (digest !== expectedSha256) throw new Error(`${label} sha256 mismatch: ${digest} != ${expectedSha256}`);
  return { response, buffer, digest };
}

function exactHash(value, label) {
  const hash = requireIdentity(value, label).replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return hash;
}

async function resolveSmokeGaussianPhaseTransferRequest(request, requestUrl, options) {
  if (request.status !== 'requested') throw new Error('Gaussian phase transfer request status must be requested');
  if (request.requestedRoute !== SMOKE_SPLAT_MOTION_ROUTE_IDENTITY) throw new Error('Gaussian phase transfer requested route mismatch');
  const budget = requireInteger(request.budget, 'Gaussian phase transfer budget');
  if (budget <= 0) throw new RangeError('Gaussian phase transfer budget must be positive');
  const simulatorGeneration = requireInteger(request.simulatorGeneration, 'Gaussian phase transfer simulator generation');
  const modelIdentity = requireIdentity(request.modelIdentity, 'Gaussian phase transfer model identity');
  const cameraIdentity = requireIdentity(request.cameraIdentity, 'Gaussian phase transfer camera identity');
  if (!Array.isArray(request.phases) || request.phases.length < 2) {
    throw new Error('Gaussian phase transfer request requires at least two phases');
  }

  const phases = [];
  for (const [index, phase] of request.phases.entries()) {
    requireObject(phase, `Gaussian phase ${index}`);
    const historySlot = requireInteger(phase.historySlot, `Gaussian phase ${index} historySlot`);
    const slotWriteTick = requireInteger(phase.slotWriteTick, `Gaussian phase ${index} slotWriteTick`);
    const fitReportUrl = exactUrl(phase.fitReportUrl, requestUrl, `Gaussian phase ${index} fitReportUrl`);
    const fitReportSha256 = exactHash(phase.fitReportSha256, `Gaussian phase ${index} fitReportSha256`);
    const fitReceipt = await fetchExactBytes(fitReportUrl, fitReportSha256, `Gaussian phase ${index} fit report`);
    const report = JSON.parse(new TextDecoder().decode(fitReceipt.buffer));
    if (report.schema !== 'kaminos.smoke-gaussian-oracle-static-fit-report.v0'
        || report.identity !== 'smoke-gaussian-oracle-static-fit-v0'
        || report.status !== 'passed') {
      throw new Error(`Gaussian phase ${index} fit report is not a passed oracle fit`);
    }
    if (report.hiddenBudgetCapApplied !== false) throw new Error(`Gaussian phase ${index} fit report hides or omits budget-cap accounting`);
    const teacher = requireObject(report.teacher, `Gaussian phase ${index} teacher`);
    if (teacher.sourceSchema !== 'kaminos.volume.full-grid-field-export.v0'
        || teacher.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
        || teacher.prototypeIdentity !== 'kaminos-volume-prototype-v0'
        || typeof teacher.backend !== 'string' || !teacher.backend.startsWith('WebGPU:')) {
      throw new Error(`Gaussian phase ${index} teacher authority mismatch`);
    }
    if (teacher.simStepCount !== slotWriteTick) throw new Error(`Gaussian phase ${index} teacher step does not match slot write tick`);
    if (teacher.cameraIdentity !== cameraIdentity) throw new Error(`Gaussian phase ${index} camera identity mismatch`);
    const effectiveCameraIdentity = `sha256:${await sha256Hex(new TextEncoder().encode(JSON.stringify(teacher.camera)).buffer)}`;
    if (effectiveCameraIdentity !== cameraIdentity) throw new Error(`Gaussian phase ${index} camera matrices do not match camera identity`);

    const entry = report.budgetCurve?.find(candidate => candidate.requestedBudget === budget);
    if (!entry || entry.activeGaussianCount !== budget) throw new Error(`Gaussian phase ${index} does not contain exact active budget ${budget}`);
    const artifact = requireObject(entry.artifact, `Gaussian phase ${index} artifact`);
    if (artifact.shape?.[0] !== budget || artifact.shape?.[1] !== GAUSSIAN_CHANNEL_COUNT
        || artifact.byteLength !== budget * GAUSSIAN_CHANNEL_COUNT * Float32Array.BYTES_PER_ELEMENT
        || artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian'
        || artifact.channelOrder?.join('|') !== GAUSSIAN_CHANNEL_ORDER.join('|')) {
      throw new Error(`Gaussian phase ${index} artifact layout mismatch`);
    }
    const artifactSha256 = exactHash(phase.artifactSha256, `Gaussian phase ${index} artifactSha256`);
    if (exactHash(artifact.sha256, `Gaussian phase ${index} fit artifact sha256`) !== artifactSha256) {
      throw new Error(`Gaussian phase ${index} request and fit artifact identities disagree`);
    }
    const artifactUrl = exactUrl(phase.artifactUrl, requestUrl, `Gaussian phase ${index} artifactUrl`);
    const artifactReceipt = await fetchExactBytes(artifactUrl, artifactSha256, `Gaussian phase ${index} artifact`);
    if (artifactReceipt.buffer.byteLength !== artifact.byteLength) throw new Error(`Gaussian phase ${index} artifact byteLength mismatch`);
    const representedExtinctionMass = requireNonNegative(entry.totalAssignedExtinction, `Gaussian phase ${index} assigned extinction`);
    const sourceExtinctionMass = requireNonNegative(teacher.totalSmokeExtinction, `Gaussian phase ${index} source extinction`);
    const relativeExtinctionError = Math.abs(representedExtinctionMass - sourceExtinctionMass) / Math.max(sourceExtinctionMass, 1e-12);
    if (relativeExtinctionError > 1e-6) throw new Error(`Gaussian phase ${index} optical accounting mismatch`);

    phases.push({
      historySlot,
      slotWriteTick,
      payload: {
        identity: `gaussian-phase-payload:${slotWriteTick}:sha256:${artifactSha256}`,
        buffer: artifactReceipt.buffer,
        descriptor: {
          schema: SMOKE_GAUSSIAN_PHASE_PRODUCT_SCHEMA,
          identity: `gaussian-phase-product:${slotWriteTick}:${budget}:sha256:${artifactSha256}`,
          producerAuthority: SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY,
          producerKind: 'oracle-fitted-adjacent-teacher-phase',
          roleMappingAuthority: SMOKE_GAUSSIAN_PHASE_ROLE_MAPPING_AUTHORITY,
          slotIdentity: { historySlot, slotWriteTick, simulatorGeneration, modelIdentity },
          hierarchyCounts: { coarse: budget, fine: 0, total: budget },
          accounting: { sourceExtinctionMass, representedExtinctionMass, rejectedExtinctionMass: 0 },
          capacity: { requested: budget, active: budget, overflowCount: 0, outputWasTruncated: false },
          artifact: {
            path: artifactUrl.href,
            sha256: artifactSha256,
            byteLength: artifact.byteLength,
            dtype: 'float32',
            byteOrder: 'little-endian',
            shape: [budget, GAUSSIAN_CHANNEL_COUNT],
            channelOrder: [...GAUSSIAN_CHANNEL_ORDER],
            sourcePackingIdentity: 'float32x28-full-covariance-gaussian-v0',
          },
          source: {
            fitReportUrl: fitReportUrl.href,
            fitReportSha256,
            simStepCount: slotWriteTick,
            cameraIdentity,
          },
          diagnostics: [],
        },
      },
    });
  }
  const historySlots = new Set(phases.map(phase => phase.historySlot));
  if (historySlots.size !== phases.length) throw new Error('Gaussian phase transfer history slots must be unique');
  const orderedTicks = phases.map(phase => phase.slotWriteTick).sort((left, right) => left - right);
  if (orderedTicks.some((tick, index) => index > 0 && tick !== orderedTicks[index - 1] + 1)) {
    throw new Error('Gaussian phase transfer slot write ticks must be consecutive');
  }

  const instanceCount = requireInteger(options.instanceCount ?? 4, 'instanceCount');
  if (instanceCount <= 0) throw new RangeError('instanceCount must be positive');
  const instances = Array.from({ length: instanceCount }, (_, index) => {
    const phase = phases[index % phases.length];
    return {
      index,
      phaseHistorySlot: phase.historySlot,
      slotWriteTick: phase.slotWriteTick,
      transform: null,
    };
  });
  const payloads = new Map(phases.map(phase => [phase.historySlot, phase.payload]));
  const cache = createSmokeSplatSlotCache({
    producerAuthority: SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY,
    decodeSlot({ slotIdentity, payload }) {
      if (slotIdentity.slotWriteTick !== payload.descriptor.slotIdentity.slotWriteTick) {
        throw new Error('Gaussian phase payload tick does not match requested slot');
      }
      return parsePackedSmokeSplatProduct(payload.buffer, payload.descriptor);
    },
  });
  const slotResolve = cache.resolve({
    instances,
    simulatorGeneration,
    modelIdentity,
    requestedProducerAuthority: SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY,
    payloadForSlot: historySlot => payloads.get(historySlot) ?? null,
    capacityForSlot: () => budget,
  });
  const products = slotResolve.slotProducts;
  const manifest = {
    schema: SMOKE_SPLAT_MOTION_MANIFEST_SCHEMA,
    status: 'passed',
    requestedRoute: request.requestedRoute,
    effectiveRoute: request.requestedRoute,
    fallbackReason: null,
    temporalAuthority: SMOKE_GAUSSIAN_PHASE_TEMPORAL_AUTHORITY,
    producerAuthority: SMOKE_GAUSSIAN_PHASE_PRODUCER_AUTHORITY,
    modelIdentity,
    cameraIdentity,
    budget,
    products: products.map(({ packed: _packed, splats: _splats, packedExtinctionMass: _mass, ...product }) => product),
  };
  validateSmokeSplatMotionManifest(manifest);
  const drawPlan = buildSmokeSplatDrawPlan({
    products,
    instanceCount,
    fineLodFraction: options.fineLodFraction ?? 1,
  });
  return { manifest, products, drawPlan, slotResolve };
}

export async function loadSmokeSplatMotionSource(manifestUrl, options = {}) {
  const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`motion manifest fetch failed with ${manifestResponse.status}`);
  const candidate = await manifestResponse.json();
  if (candidate.schema === SMOKE_GAUSSIAN_PHASE_TRANSFER_REQUEST_SCHEMA) {
    return resolveSmokeGaussianPhaseTransferRequest(candidate, manifestResponse.url || manifestUrl, options);
  }
  const manifest = validateSmokeSplatMotionManifest(candidate);
  const products = [];
  for (const product of manifest.products) {
    const artifactUrl = new URL(product.artifact.path, manifestResponse.url || manifestUrl);
    const response = await fetch(artifactUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`smoke product fetch failed with ${response.status}: ${artifactUrl}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength !== product.artifact.byteLength) throw new Error(`smoke product byteLength mismatch: ${artifactUrl}`);
    const digest = await sha256Hex(buffer);
    if (digest !== product.artifact.sha256) throw new Error(`smoke product sha256 mismatch: ${artifactUrl}`);
    products.push(parsePackedSmokeSplatProduct(buffer, product));
  }
  const drawPlan = buildSmokeSplatDrawPlan({
    products,
    instanceCount: options.instanceCount ?? 4,
    fineLodFraction: options.fineLodFraction ?? 1,
  });
  return { manifest, products, drawPlan };
}
