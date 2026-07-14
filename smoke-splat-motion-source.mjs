export const SMOKE_SPLAT_MOTION_MANIFEST_SCHEMA = 'kaminos.smoke-splat-motion-source.v0';
export const SMOKE_SPLAT_MOTION_ROUTE_IDENTITY = 'webgpu-real-field-hierarchical-smoke-motion-v0';
export const SMOKE_SPLAT_MOTION_TEMPORAL_AUTHORITY = 'velocity-carried-short-horizon-extrapolation-v0';
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

function validateArtifact(artifact, productIndex) {
  requireObject(artifact, `product ${productIndex} artifact`);
  requireIdentity(artifact.path, `product ${productIndex} artifact path`);
  if (!/^[a-f0-9]{64}$/.test(String(artifact.sha256 || ''))) {
    throw new Error(`product ${productIndex} artifact sha256 must be a lowercase content hash`);
  }
  const byteLength = requireInteger(artifact.byteLength, `product ${productIndex} artifact byteLength`);
  if (byteLength <= 0 || byteLength % (CHANNEL_COUNT * 4) !== 0) {
    throw new Error(`product ${productIndex} artifact byteLength is not packed float32x${CHANNEL_COUNT}`);
  }
  if (artifact.dtype !== 'float32' || artifact.byteOrder !== 'little-endian') {
    throw new Error(`product ${productIndex} artifact encoding mismatch`);
  }
  if (!Array.isArray(artifact.shape) || artifact.shape.length !== 2 || artifact.shape[1] !== CHANNEL_COUNT) {
    throw new Error(`product ${productIndex} artifact shape must be [count, ${CHANNEL_COUNT}]`);
  }
  if (artifact.shape[0] * CHANNEL_COUNT * 4 !== byteLength) {
    throw new Error(`product ${productIndex} artifact shape and byteLength disagree`);
  }
  if (!Array.isArray(artifact.channelOrder) || artifact.channelOrder.join('|') !== CHANNEL_ORDER.join('|')) {
    throw new Error(`product ${productIndex} artifact channel order mismatch`);
  }
}

function validateProduct(product, index) {
  requireObject(product, `product ${index}`);
  requireIdentity(product.identity, `product ${index} identity`);
  if (product.schema !== PRODUCT_SCHEMA) throw new Error(`product ${index} schema mismatch`);
  if (product.producerAuthority !== PRODUCER_AUTHORITY) throw new Error(`product ${index} producer authority mismatch`);
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
  validateArtifact(product.artifact, index);
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
  if (manifest.temporalAuthority !== SMOKE_SPLAT_MOTION_TEMPORAL_AUTHORITY) throw new Error('temporal authority mismatch');
  if (manifest.producerAuthority !== PRODUCER_AUTHORITY) throw new Error('manifest producer authority mismatch');
  if (!Array.isArray(manifest.products) || manifest.products.length === 0) throw new Error('motion manifest products must be non-empty');
  manifest.products.forEach(validateProduct);
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
  const values = new Float32Array(buffer);
  const count = requireInteger(artifact.shape?.[0], 'artifact splat count');
  if (values.length !== count * CHANNEL_COUNT) throw new Error('packed product float count mismatch');
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
  return {
    productIdentity: product.identity,
    selectedIndices,
    selectedCount: selectedIndices.length,
    sourceCount: product.splats.length,
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

export async function sha256Hex(buffer) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function loadSmokeSplatMotionSource(manifestUrl, options = {}) {
  const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`motion manifest fetch failed with ${manifestResponse.status}`);
  const manifest = validateSmokeSplatMotionManifest(await manifestResponse.json());
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
