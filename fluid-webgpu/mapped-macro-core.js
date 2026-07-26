import {
  createFluidExchangeReceipt,
  createFluidRepresentationFrame,
  createFluidTerrainFeedbackFrame,
  createTerrainRemapReceipt,
  REPRESENTATION_OWNERSHIP_IDENTITY,
  validateFluidExchangeReceipt,
  validateFluidRepresentationFrame,
  validateFluidTerrainFeedbackFrame,
  validateTerrainRemapReceipt,
  validateTerrainFluidFrame,
} from '@kaminos/fluid-contracts';

export const MAPPED_MACRO_STATE_SCHEMA = 'kaminos.fluid.mapped-macro-state.v1';
export const MAPPED_MACRO_SOLVER_ROUTE = 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1';
export const MAPPED_MACRO_METHOD = 'orthogonal-heightfield-hydrostatic-reconstruction-hll-v1';
export const KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA = 'kaminos.fluid.package-descriptor.v1';
export const PORTABLE_MACRO_SOURCE_CAPABILITY = 'kaminos.fluid.portable-macro-source.v1';
export const PORTABLE_MACRO_SOURCE_ROUTE = 'kaminos/fluid/portable-macro-source';
export const PORTABLE_MACRO_SOURCE_HANDLE_SCHEMA = 'kaminos.fluid.portable-macro-source-handle.v1';
export const PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA = 'kaminos.fluid.portable-macro-source-snapshot.v1';
export const MACRO_WET_BOUNDARY_SCHEMA = 'kaminos.fluid.macro-wet-boundary.v1';
export const MACRO_WET_BOUNDARY_ROUTE = 'kaminos/fluid/macro-wet-boundary';

const KAMINOS_FLUID_PACKAGE_VERSION = '0.4.0';
const KAMINOS_FLUID_PRODUCER_REVISION = '4a863c6f9886fd113af9bc49a61b436f4dca571c';

export const KAMINOS_FLUID_PACKAGE_DESCRIPTOR = Object.freeze({
  schema: KAMINOS_FLUID_PACKAGE_DESCRIPTOR_SCHEMA,
  sourceAuthority: 'live_runtime',
  fallbackStatus: 'none',
  packageName: '@kaminos/fluid-webgpu',
  packageVersion: KAMINOS_FLUID_PACKAGE_VERSION,
  artifactRevision: `@kaminos/fluid-webgpu@${KAMINOS_FLUID_PACKAGE_VERSION}`,
  runtimeRevision: KAMINOS_FLUID_PRODUCER_REVISION,
  cacheKey: `@kaminos/fluid-webgpu@${KAMINOS_FLUID_PACKAGE_VERSION}:${KAMINOS_FLUID_PRODUCER_REVISION}`,
  runtimeRoute: MAPPED_MACRO_SOLVER_ROUTE,
  representationRoutes: Object.freeze(['kaminos/fluid/representation-frame']),
  sourceRoutes: Object.freeze([PORTABLE_MACRO_SOURCE_ROUTE, MACRO_WET_BOUNDARY_ROUTE]),
  outputRoutes: Object.freeze(['kaminos/fluid/terrain-feedback']),
});

const DEFAULT_GRAVITY = 9.81;
const DEFAULT_DRY_TOLERANCE = 1e-8;
const DEFAULT_CFL = 0.42;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value, label) {
  const number = Number(value);
  invariant(Number.isFinite(number), `${label} must be finite`);
  return number;
}

function nonEmptyString(value, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function integer(value, label) {
  const number = finite(value, label);
  invariant(Number.isInteger(number), `${label} must be an integer`);
  return number;
}

function freezeRecord(value) {
  if (value == null || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecord(child);
  return Object.freeze(value);
}

function portableSourceError(error, {
  phase,
  sourceHandleId = null,
  lastTrustworthyEvidence,
} = {}) {
  const failure = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(failure, 'report', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      schema: 'kaminos.fluid.portable-macro-source-failure.v1',
      status: 'failed',
      phase,
      sourceHandleId: typeof sourceHandleId === 'string' && sourceHandleId.length > 0 ? sourceHandleId : null,
      lastTrustworthyEvidence,
      message: failure.message,
    }),
  });
  return failure;
}

function validateExactPortableRoute(route) {
  invariant(route && typeof route === 'object', 'portable source route identity is required');
  nonEmptyString(route.requested, 'requested portable source route');
  nonEmptyString(route.effective, 'effective portable source route');
  invariant(
    route.requested === PORTABLE_MACRO_SOURCE_ROUTE,
    `requested portable source route mismatch: expected ${PORTABLE_MACRO_SOURCE_ROUTE}, received ${route.requested}`,
  );
  invariant(
    route.effective === route.requested,
    `effective portable source route mismatch: requested ${route.requested}, received ${route.effective}`,
  );
  return route;
}

function validatePortableCapability(requested, effective) {
  nonEmptyString(requested, 'requested portable source capability');
  nonEmptyString(effective, 'effective portable source capability');
  invariant(requested === PORTABLE_MACRO_SOURCE_CAPABILITY, `unsupported portable source capability: ${requested}`);
  invariant(effective === requested, `effective portable source capability mismatch: requested ${requested}, received ${effective}`);
}

function validatePhysicalMaterial(material) {
  invariant(material && typeof material === 'object', 'physical material descriptor is required');
  const supportedFields = new Set(['densityKgM3', 'dynamicViscosityPaS', 'absorptionPerMeter']);
  for (const key of Object.keys(material)) {
    invariant(supportedFields.has(key), `unsupported physical material field: ${key}`);
  }
  invariant(finite(material.densityKgM3, 'physicalMaterial.densityKgM3') > 0, 'physicalMaterial.densityKgM3 must be positive');
  if (material.dynamicViscosityPaS != null) {
    invariant(finite(material.dynamicViscosityPaS, 'physicalMaterial.dynamicViscosityPaS') >= 0, 'physicalMaterial.dynamicViscosityPaS must be non-negative');
  }
  invariant(
    Array.isArray(material.absorptionPerMeter) && material.absorptionPerMeter.length === 3,
    'physicalMaterial.absorptionPerMeter must contain 3 values',
  );
  for (let index = 0; index < 3; index += 1) {
    invariant(
      finite(material.absorptionPerMeter[index], `physicalMaterial.absorptionPerMeter[${index}]`) >= 0,
      `physicalMaterial.absorptionPerMeter[${index}] must be non-negative`,
    );
  }
  return material;
}

function copyPhysicalMaterial(material) {
  validatePhysicalMaterial(material);
  return {
    densityKgM3: material.densityKgM3,
    ...(material.dynamicViscosityPaS == null
      ? {}
      : { dynamicViscosityPaS: material.dynamicViscosityPaS }),
    absorptionPerMeter: [...material.absorptionPerMeter],
  };
}

function portableTypedArray(values, length, label, { nonNegative = false } = {}) {
  invariant(ArrayBuffer.isView(values) && !(values instanceof DataView), `${label} must be a typed array`);
  invariant(values.length === length, `${label} length ${values.length} does not match expected ${length}`);
  for (let index = 0; index < values.length; index += 1) {
    const value = finite(values[index], `${label}[${index}]`);
    if (nonNegative) invariant(value >= 0, `${label}[${index}] must be non-negative`);
  }
  return values;
}

function portableBinaryArray(values, length, label) {
  portableTypedArray(values, length, label, { nonNegative: true });
  for (let index = 0; index < values.length; index += 1) {
    invariant(values[index] === 0 || values[index] === 1, `${label}[${index}] must be 0 or 1`);
  }
  return values;
}

function validateWetBoundaryRoute(route) {
  invariant(route && typeof route === 'object', 'wet boundary route identity is required');
  invariant(route.requested === MACRO_WET_BOUNDARY_ROUTE, `wet boundary requested route mismatch: ${route.requested}`);
  invariant(route.effective === route.requested, `wet boundary effective route mismatch: requested ${route.requested}, received ${route.effective}`);
  return route;
}

function wetBoundaryThresholds(options = {}) {
  const effectiveDryDepthMeters = finite(
    options.dryDepthThresholdMeters ?? options.dryTolerance ?? DEFAULT_DRY_TOLERANCE,
    'effectiveDryDepthMeters',
  );
  const effectiveWetActivationDepthMeters = finite(
    options.wetActivationDepthThresholdMeters ?? Math.max(effectiveDryDepthMeters * 2, effectiveDryDepthMeters + Number.EPSILON),
    'effectiveWetActivationDepthMeters',
  );
  invariant(effectiveDryDepthMeters >= 0, 'effectiveDryDepthMeters must be non-negative');
  invariant(
    effectiveWetActivationDepthMeters > effectiveDryDepthMeters,
    'effectiveWetActivationDepthMeters must be greater than effectiveDryDepthMeters',
  );
  return Object.freeze({ effectiveDryDepthMeters, effectiveWetActivationDepthMeters });
}

function wetBoundaryCellSignature(wetState, width, x, y) {
  const topLeft = y * width + x;
  const topRight = topLeft + 1;
  const bottomLeft = topLeft + width;
  const bottomRight = bottomLeft + 1;
  return wetState[topLeft]
    | (wetState[topRight] << 1)
    | (wetState[bottomRight] << 2)
    | (wetState[bottomLeft] << 3);
}

function wetBoundaryResetId(topologyId, reset) {
  const remapIdentity = reset.remapReceiptId ?? 'initial';
  return `${topologyId}:reset:${reset.generation}:${reset.previousTerrainEpoch}->${reset.terrainEpoch}:${reset.kind}:${remapIdentity}`;
}

function updateWetBoundaryState(previous, state, terrainFrame, thresholds, reset = null) {
  const sampleCount = terrainFrame.grid.width * terrainFrame.grid.height;
  const cellWidth = Math.max(0, terrainFrame.grid.width - 1);
  const cellHeight = Math.max(0, terrainFrame.grid.height - 1);
  const cellCount = cellWidth * cellHeight;
  const topologyId = `${terrainFrame.terrainId}:${terrainFrame.transformId}:${terrainFrame.grid.width}x${terrainFrame.grid.height}`;
  const physicalDepthMeters = new Float64Array(sampleCount);
  const signedDryMarginMeters = new Float64Array(sampleCount);
  const wetState = new Uint8Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const depth = state.mappedDepth[index] / terrainFrame.fields.jacobian[index];
    physicalDepthMeters[index] = depth;
    signedDryMarginMeters[index] = depth - thresholds.effectiveDryDepthMeters;
    wetState[index] = previous?.wetState[index] === 1
      ? Number(depth > thresholds.effectiveDryDepthMeters)
      : Number(depth >= thresholds.effectiveWetActivationDepthMeters);
  }

  const stableId = new Uint32Array(cellCount);
  const signature = new Uint8Array(cellCount);
  const activeState = new Uint8Array(cellCount);
  const generation = new Uint32Array(cellCount);
  let changed = previous == null;
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const cellId = y * cellWidth + x;
      const nextSignature = wetBoundaryCellSignature(wetState, terrainFrame.grid.width, x, y);
      stableId[cellId] = cellId;
      signature[cellId] = nextSignature;
      activeState[cellId] = Number(nextSignature !== 0 && nextSignature !== 15);
      const cellChanged = previous != null && previous.signature[cellId] !== nextSignature;
      generation[cellId] = previous == null
        ? 0
        : previous.generation[cellId] + Number(cellChanged || reset != null);
      changed ||= cellChanged;
    }
  }

  const boundaryGeneration = previous == null
    ? 0
    : previous.boundaryGeneration + Number(changed || reset != null);
  const resetGeneration = previous == null ? 0 : previous.reset.generation + Number(reset != null);
  const resetRecord = reset == null
    ? previous?.reset ?? {
      generation: 0,
      kind: 'initial',
      previousTerrainEpoch: terrainFrame.priorEpoch,
      terrainEpoch: terrainFrame.currentEpoch,
      remapReceiptId: null,
      shockId: terrainFrame.shockId ?? null,
      boundaryGeneration,
      discontinuous: true,
    }
    : {
      generation: resetGeneration,
      kind: reset.kind,
      previousTerrainEpoch: reset.previousTerrainEpoch,
      terrainEpoch: terrainFrame.currentEpoch,
      remapReceiptId: reset.remapReceiptId,
      shockId: terrainFrame.shockId ?? null,
      boundaryGeneration,
      discontinuous: true,
    };
  return {
    topologyId,
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: state.fluidEpoch,
    ...thresholds,
    physicalDepthMeters,
    signedDryMarginMeters,
    wetState,
    cellWidth,
    cellHeight,
    stableId,
    signature,
    activeState,
    generation,
    boundaryGeneration,
    reset: {
      ...resetRecord,
      id: wetBoundaryResetId(topologyId, resetRecord),
    },
  };
}

function length3(values, offset) {
  return Math.hypot(values[offset], values[offset + 1], values[offset + 2]);
}

function dot3(left, leftOffset, right, rightOffset) {
  return left[leftOffset] * right[rightOffset]
    + left[leftOffset + 1] * right[rightOffset + 1]
    + left[leftOffset + 2] * right[rightOffset + 2];
}

function validateReferenceMetric(terrainFrame) {
  invariant(terrainFrame.supportClass === 'heightfield', 'mapped macro reference requires heightfield support');
  invariant(Math.abs(terrainFrame.worldMetersPerUnit - 1) <= 1e-9, 'mapped macro reference requires physical-meter-normalized terrain coordinates');
  const { tangentU, tangentV, normal, jacobian } = terrainFrame.fields;
  const sampleCount = terrainFrame.grid.width * terrainFrame.grid.height;
  const referenceDirections = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 3;
    const lengthU = length3(tangentU, offset);
    const lengthV = length3(tangentV, offset);
    const normalLength = length3(normal, offset);
    invariant(lengthU > 0 && lengthV > 0 && normalLength > 0, `orthogonal heightfield metric has a degenerate basis at sample ${index}`);
    const orthogonality = dot3(tangentU, offset, tangentV, offset) / (lengthU * lengthV);
    invariant(Math.abs(orthogonality) <= 1e-6, `orthogonal heightfield metric is non-orthogonal at sample ${index}`);
    invariant(Math.abs(jacobian[index] - lengthU * lengthV) <= 1e-6 * Math.max(1, jacobian[index]), `orthogonal heightfield metric Jacobian is inconsistent at sample ${index}`);
    const directions = [
      tangentU[offset] / lengthU, tangentU[offset + 1] / lengthU, tangentU[offset + 2] / lengthU,
      tangentV[offset] / lengthV, tangentV[offset + 1] / lengthV, tangentV[offset + 2] / lengthV,
      normal[offset] / normalLength, normal[offset + 1] / normalLength, normal[offset + 2] / normalLength,
    ];
    if (index === 0) referenceDirections.push(...directions);
    else {
      invariant(directions.every((value, component) => Math.abs(value - referenceDirections[component]) <= 1e-6), `orthogonal heightfield metric rotates its basis at sample ${index}`);
    }
  }
  return terrainFrame;
}

function sameVector(left, right, tolerance = 1e-9) {
  return left.length === right.length
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function normalizedDirection(values, offset) {
  const magnitude = length3(values, offset);
  return [
    values[offset] / magnitude,
    values[offset + 1] / magnitude,
    values[offset + 2] / magnitude,
  ];
}

function sameDirtyRegions(left, right) {
  return left.length === right.length
    && left.every((region, index) => {
      const candidate = right[index];
      return region.x === candidate.x
        && region.y === candidate.y
        && region.width === candidate.width
        && region.height === candidate.height;
    });
}

function sameOptionalVector(left, right, tolerance = 0) {
  if (left == null || right == null) return left == null && right == null;
  return sameVector(left, right, tolerance);
}

function validateSameEpochTerrain(previousTerrainFrame, terrainFrame) {
  const unchanged = terrainFrame.currentEpoch === previousTerrainFrame.currentEpoch
    && terrainFrame.priorEpoch === previousTerrainFrame.priorEpoch
    && terrainFrame.route.requested === previousTerrainFrame.route.requested
    && terrainFrame.route.effective === previousTerrainFrame.route.effective
    && terrainFrame.source.requested === previousTerrainFrame.source.requested
    && terrainFrame.source.effective === previousTerrainFrame.source.effective
    && terrainFrame.producer.id === previousTerrainFrame.producer.id
    && terrainFrame.producer.revision === previousTerrainFrame.producer.revision
    && terrainFrame.terrainId === previousTerrainFrame.terrainId
    && terrainFrame.supportClass === previousTerrainFrame.supportClass
    && terrainFrame.transformId === previousTerrainFrame.transformId
    && terrainFrame.worldMetersPerUnit === previousTerrainFrame.worldMetersPerUnit
    && sameVector(terrainFrame.gravity, previousTerrainFrame.gravity, 0)
    && terrainFrame.motionClass === previousTerrainFrame.motionClass
    && terrainFrame.shockId === previousTerrainFrame.shockId
    && terrainFrame.motionSubstepEnvelope === previousTerrainFrame.motionSubstepEnvelope
    && terrainFrame.complete === previousTerrainFrame.complete
    && terrainFrame.grid.width === previousTerrainFrame.grid.width
    && terrainFrame.grid.height === previousTerrainFrame.grid.height
    && sameVector(terrainFrame.grid.spacing, previousTerrainFrame.grid.spacing, 0)
    && sameVector(terrainFrame.grid.origin, previousTerrainFrame.grid.origin, 0)
    && sameDirtyRegions(terrainFrame.dirtyRegions, previousTerrainFrame.dirtyRegions)
    && [
      'bedHeight',
      'jacobian',
      'gradient',
      'tangentU',
      'tangentV',
      'normal',
      'supportVelocity',
      'valid',
    ].every(field => sameVector(terrainFrame.fields[field], previousTerrainFrame.fields[field], 0))
    && sameOptionalVector(
      terrainFrame.fields.worldPosition,
      previousTerrainFrame.fields.worldPosition,
      0,
    );
  invariant(
    unchanged,
    `same-epoch terrain frame ${terrainFrame.currentEpoch} changed; terrain changes require an exact successor remap`,
  );
}

function validateSequentialTerrain(previousTerrainFrame, terrainFrame) {
  invariant(terrainFrame.currentEpoch > previousTerrainFrame.currentEpoch, 'terrain remap requires a newer epoch');
  invariant(
    terrainFrame.priorEpoch === previousTerrainFrame.currentEpoch,
    `terrain frame prior epoch ${terrainFrame.priorEpoch} does not match current terrain epoch ${previousTerrainFrame.currentEpoch}`,
  );
  invariant(
    terrainFrame.currentEpoch === previousTerrainFrame.currentEpoch + 1,
    `terrain remap requires exact successor epoch ${previousTerrainFrame.currentEpoch + 1}, received ${terrainFrame.currentEpoch}`,
  );
  invariant(terrainFrame.route.effective === previousTerrainFrame.route.effective, 'terrain route identity changed');
  invariant(terrainFrame.source.effective === previousTerrainFrame.source.effective, 'terrain source identity changed');
  invariant(terrainFrame.producer.id === previousTerrainFrame.producer.id, 'terrain producer identity changed');
  invariant(terrainFrame.terrainId === previousTerrainFrame.terrainId, 'terrain identity changed');
  invariant(terrainFrame.supportClass === previousTerrainFrame.supportClass, 'terrain support class changed');
  invariant(terrainFrame.transformId === previousTerrainFrame.transformId, 'terrain chart transform changed');
  invariant(terrainFrame.worldMetersPerUnit === previousTerrainFrame.worldMetersPerUnit, 'terrain physical scale changed');
  invariant(sameVector(terrainFrame.gravity, previousTerrainFrame.gravity), 'terrain gravity changed');
  invariant(
    terrainFrame.grid.width === previousTerrainFrame.grid.width
      && terrainFrame.grid.height === previousTerrainFrame.grid.height,
    'terrain remap grid topology changed',
  );
  invariant(sameVector(terrainFrame.grid.spacing, previousTerrainFrame.grid.spacing), 'terrain remap grid spacing changed');
  invariant(sameVector(terrainFrame.grid.origin, previousTerrainFrame.grid.origin), 'terrain remap grid origin changed');
  const sampleCount = terrainFrame.grid.width * terrainFrame.grid.height;
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * 3;
    for (const field of ['tangentU', 'tangentV', 'normal']) {
      invariant(
        sameVector(
          normalizedDirection(terrainFrame.fields[field], offset),
          normalizedDirection(previousTerrainFrame.fields[field], offset),
          1e-6,
        ),
        `terrain chart basis rotation is unsupported at sample ${index} (${field})`,
      );
    }
  }
}

function conservationTotals(state, terrainFrame) {
  const coordinateArea = terrainFrame.grid.spacing[0] * terrainFrame.grid.spacing[1];
  let volume = 0;
  const momentum = [0, 0, 0];
  const materials = Object.fromEntries(Object.keys(state.materialMasses ?? {}).map(key => [key, 0]));
  for (let index = 0; index < state.mappedDepth.length; index += 1) {
    volume += state.mappedDepth[index] * coordinateArea;
    momentum[0] += state.mappedMomentumU[index] * coordinateArea;
    momentum[2] += state.mappedMomentumV[index] * coordinateArea;
    for (const [key, values] of Object.entries(state.materialMasses ?? {})) {
      materials[key] += values[index] * coordinateArea;
    }
  }
  return { volume, momentum, materials };
}

function finiteStateArray(values, count, label, nonNegative = false) {
  invariant(ArrayBuffer.isView(values) && !(values instanceof DataView), `${label} must be a typed array`);
  invariant(values.length === count, `${label} population mismatch`);
  for (let index = 0; index < count; index += 1) {
    const value = finite(values[index], `${label}[${index}]`);
    if (nonNegative) invariant(value >= 0, `${label}[${index}] must be non-negative`);
  }
}

function cloneState(state, terrainFrame) {
  validateState(state, terrainFrame);
  return {
    ...state,
    mappedDepth: new Float64Array(state.mappedDepth),
    mappedMomentumU: new Float64Array(state.mappedMomentumU),
    mappedMomentumV: new Float64Array(state.mappedMomentumV),
    referenceFreeSurface: state.referenceFreeSurface == null ? null : new Float64Array(state.referenceFreeSurface),
    materialMasses: Object.fromEntries(Object.entries(state.materialMasses ?? {}).map(([key, values]) => [key, new Float64Array(values)])),
  };
}

function validateState(state, terrainFrame) {
  validateTerrainFluidFrame(terrainFrame);
  validateReferenceMetric(terrainFrame);
  invariant(state?.schema === MAPPED_MACRO_STATE_SCHEMA, `mapped macro state schema mismatch: ${state?.schema}`);
  invariant(state.route === MAPPED_MACRO_SOLVER_ROUTE, `mapped macro route mismatch: ${state.route}`);
  const count = terrainFrame.grid.width * terrainFrame.grid.height;
  invariant(state.width === terrainFrame.grid.width && state.height === terrainFrame.grid.height, 'mapped macro grid does not match terrain frame');
  invariant(state.method === MAPPED_MACRO_METHOD, `mapped macro method mismatch: ${state.method}`);
  finiteStateArray(state.mappedDepth, count, 'mappedDepth', true);
  finiteStateArray(state.mappedMomentumU, count, 'mappedMomentumU');
  finiteStateArray(state.mappedMomentumV, count, 'mappedMomentumV');
  invariant(state.materialMasses && typeof state.materialMasses === 'object', 'materialMasses must be an object');
  for (const [key, values] of Object.entries(state.materialMasses)) finiteStateArray(values, count, `materialMasses.${key}`, true);
  if (state.referenceFreeSurface != null) finiteStateArray(state.referenceFreeSurface, count, 'referenceFreeSurface');
  invariant(Number.isInteger(state.fluidEpoch) && state.fluidEpoch >= 0, 'fluidEpoch must be a non-negative integer');
  invariant(Number.isInteger(state.stepCount) && state.stepCount >= 0, 'stepCount must be a non-negative integer');
  invariant(finite(state.simulationTimeSeconds, 'simulationTimeSeconds') >= 0, 'simulationTimeSeconds must be non-negative');
  invariant(finite(state.positivityCorrection, 'positivityCorrection') >= 0, 'positivityCorrection must be non-negative');
  invariant(state.terrainEpoch === terrainFrame.currentEpoch, `mapped macro terrain epoch mismatch: state ${state.terrainEpoch}, frame ${terrainFrame.currentEpoch}`);
  return state;
}

function tangentLength(terrainFrame, index, axis) {
  return length3(axis === 0 ? terrainFrame.fields.tangentU : terrainFrame.fields.tangentV, index * 3);
}

function faceMeasure(terrainFrame, leftIndex, rightIndex, axis) {
  const transverseAxis = axis === 0 ? 1 : 0;
  return 0.5 * (
    tangentLength(terrainFrame, leftIndex, transverseAxis)
    + tangentLength(terrainFrame, rightIndex, transverseAxis)
  );
}

function physicalCell(state, terrainFrame, index, dryTolerance) {
  const jacobian = terrainFrame.fields.jacobian[index];
  const depth = Math.max(0, state.mappedDepth[index] / jacobian);
  if (depth <= dryTolerance) return { depth: 0, momentumU: 0, momentumV: 0, velocityU: 0, velocityV: 0 };
  const momentumU = state.mappedMomentumU[index] / jacobian;
  const momentumV = state.mappedMomentumV[index] / jacobian;
  return {
    depth,
    momentumU,
    momentumV,
    velocityU: momentumU / depth,
    velocityV: momentumV / depth,
  };
}

function hllFlux(left, right, gravity, axis) {
  const normalLeft = axis === 0 ? left.velocityU : left.velocityV;
  const normalRight = axis === 0 ? right.velocityU : right.velocityV;
  const cLeft = Math.sqrt(gravity * left.depth);
  const cRight = Math.sqrt(gravity * right.depth);
  const waveLeft = Math.min(normalLeft - cLeft, normalRight - cRight);
  const waveRight = Math.max(normalLeft + cLeft, normalRight + cRight);
  const stateLeft = [left.depth, left.momentumU, left.momentumV];
  const stateRight = [right.depth, right.momentumU, right.momentumV];
  const fluxLeft = axis === 0
    ? [left.momentumU, left.momentumU * left.velocityU + 0.5 * gravity * left.depth ** 2, left.momentumU * left.velocityV]
    : [left.momentumV, left.momentumV * left.velocityU, left.momentumV * left.velocityV + 0.5 * gravity * left.depth ** 2];
  const fluxRight = axis === 0
    ? [right.momentumU, right.momentumU * right.velocityU + 0.5 * gravity * right.depth ** 2, right.momentumU * right.velocityV]
    : [right.momentumV, right.momentumV * right.velocityU, right.momentumV * right.velocityV + 0.5 * gravity * right.depth ** 2];
  if (waveLeft >= 0) return fluxLeft;
  if (waveRight <= 0) return fluxRight;
  const inverseSpan = 1 / Math.max(waveRight - waveLeft, Number.EPSILON);
  return fluxLeft.map((value, component) => (
    waveRight * value
    - waveLeft * fluxRight[component]
    + waveLeft * waveRight * (stateRight[component] - stateLeft[component])
  ) * inverseSpan);
}

function reconstructedInterface(state, terrainFrame, leftIndex, rightIndex, axis, dryTolerance, gravity) {
  let left = physicalCell(state, terrainFrame, leftIndex, dryTolerance);
  let right = physicalCell(state, terrainFrame, rightIndex, dryTolerance);
  const bedLeft = terrainFrame.fields.bedHeight[leftIndex];
  const bedRight = terrainFrame.fields.bedHeight[rightIndex];
  const interfaceBed = Math.max(bedLeft, bedRight);
  const leftDepth = Math.max(0, left.depth + bedLeft - interfaceBed);
  const rightDepth = Math.max(0, right.depth + bedRight - interfaceBed);
  left = {
    depth: leftDepth,
    velocityU: left.velocityU,
    velocityV: left.velocityV,
    momentumU: leftDepth * left.velocityU,
    momentumV: leftDepth * left.velocityV,
  };
  right = {
    depth: rightDepth,
    velocityU: right.velocityU,
    velocityV: right.velocityV,
    momentumU: rightDepth * right.velocityU,
    momentumV: rightDepth * right.velocityV,
  };
  const flux = hllFlux(left, right, gravity, axis);
  const originalLeftDepth = physicalCell(state, terrainFrame, leftIndex, dryTolerance).depth;
  const originalRightDepth = physicalCell(state, terrainFrame, rightIndex, dryTolerance).depth;
  const leftCorrection = 0.5 * gravity * (originalLeftDepth ** 2 - leftDepth ** 2);
  const rightCorrection = 0.5 * gravity * (originalRightDepth ** 2 - rightDepth ** 2);
  const leftFlux = [...flux];
  const rightFlux = [...flux];
  leftFlux[axis + 1] += leftCorrection;
  rightFlux[axis + 1] += rightCorrection;
  return { leftFlux, rightFlux };
}

function reflectedBoundary(cell, axis) {
  if (axis === 0) return { ...cell, momentumU: -cell.momentumU, velocityU: -cell.velocityU };
  return { ...cell, momentumV: -cell.momentumV, velocityV: -cell.velocityV };
}

function boundaryInterface(state, terrainFrame, index, axis, side, dryTolerance, gravity) {
  const interior = physicalCell(state, terrainFrame, index, dryTolerance);
  const ghost = reflectedBoundary(interior, axis);
  const left = side === 'minimum' ? ghost : interior;
  const right = side === 'minimum' ? interior : ghost;
  const flux = hllFlux(left, right, gravity, axis);
  return { leftFlux: flux, rightFlux: flux };
}

function stableSubstepSeconds(state, terrainFrame, gravity, dryTolerance, cfl) {
  const [spacingU, spacingV] = terrainFrame.grid.spacing;
  let maximumRate = 0;
  for (let index = 0; index < state.mappedDepth.length; index += 1) {
    const cell = physicalCell(state, terrainFrame, index, dryTolerance);
    const wave = Math.sqrt(gravity * cell.depth);
    const jacobian = terrainFrame.fields.jacobian[index];
    const rateU = (Math.abs(cell.velocityU) + wave) * tangentLength(terrainFrame, index, 1) / (spacingU * jacobian);
    const rateV = (Math.abs(cell.velocityV) + wave) * tangentLength(terrainFrame, index, 0) / (spacingV * jacobian);
    maximumRate = Math.max(maximumRate, rateU + rateV);
  }
  return maximumRate > 0 ? cfl / maximumRate : Infinity;
}

function advanceSubstep(state, terrainFrame, deltaSeconds, gravity, dryTolerance) {
  const { width, height, spacing } = terrainFrame.grid;
  const [spacingU, spacingV] = spacing;
  const count = width * height;
  const depthDelta = new Float64Array(count);
  const momentumUDelta = new Float64Array(count);
  const momentumVDelta = new Float64Array(count);
  const materialDelta = Object.fromEntries(Object.keys(state.materialMasses ?? {}).map(key => [key, new Float64Array(count)]));
  const addFlux = (index, sign, scale, flux) => {
    depthDelta[index] += sign * scale * flux[0];
    momentumUDelta[index] += sign * scale * flux[1];
    momentumVDelta[index] += sign * scale * flux[2];
  };
  const addMaterialFlux = (leftIndex, rightIndex, scale, massFlux) => {
    if (massFlux === 0) return;
    const sourceIndex = massFlux >= 0 ? leftIndex : rightIndex;
    const sourceDepth = state.mappedDepth[sourceIndex];
    if (sourceDepth <= dryTolerance) return;
    for (const [key, values] of Object.entries(state.materialMasses ?? {})) {
      const concentration = values[sourceIndex] / sourceDepth;
      const flux = massFlux * concentration;
      materialDelta[key][leftIndex] -= scale * flux;
      materialDelta[key][rightIndex] += scale * flux;
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let interfaceX = 0; interfaceX <= width; interfaceX += 1) {
      if (interfaceX === 0) {
        const rightIndex = y * width;
        const edge = boundaryInterface(state, terrainFrame, rightIndex, 0, 'minimum', dryTolerance, gravity);
        addFlux(rightIndex, 1, deltaSeconds * tangentLength(terrainFrame, rightIndex, 1) / spacingU, edge.rightFlux);
      } else if (interfaceX === width) {
        const leftIndex = y * width + width - 1;
        const edge = boundaryInterface(state, terrainFrame, leftIndex, 0, 'maximum', dryTolerance, gravity);
        addFlux(leftIndex, -1, deltaSeconds * tangentLength(terrainFrame, leftIndex, 1) / spacingU, edge.leftFlux);
      } else {
        const leftIndex = y * width + interfaceX - 1;
        const rightIndex = leftIndex + 1;
        const edge = reconstructedInterface(state, terrainFrame, leftIndex, rightIndex, 0, dryTolerance, gravity);
        const scale = deltaSeconds * faceMeasure(terrainFrame, leftIndex, rightIndex, 0) / spacingU;
        addFlux(leftIndex, -1, scale, edge.leftFlux);
        addFlux(rightIndex, 1, scale, edge.rightFlux);
        addMaterialFlux(leftIndex, rightIndex, scale, edge.leftFlux[0]);
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let interfaceY = 0; interfaceY <= height; interfaceY += 1) {
      if (interfaceY === 0) {
        const topIndex = x;
        const edge = boundaryInterface(state, terrainFrame, topIndex, 1, 'minimum', dryTolerance, gravity);
        addFlux(topIndex, 1, deltaSeconds * tangentLength(terrainFrame, topIndex, 0) / spacingV, edge.rightFlux);
      } else if (interfaceY === height) {
        const bottomIndex = (height - 1) * width + x;
        const edge = boundaryInterface(state, terrainFrame, bottomIndex, 1, 'maximum', dryTolerance, gravity);
        addFlux(bottomIndex, -1, deltaSeconds * tangentLength(terrainFrame, bottomIndex, 0) / spacingV, edge.leftFlux);
      } else {
        const topIndex = (interfaceY - 1) * width + x;
        const bottomIndex = topIndex + width;
        const edge = reconstructedInterface(state, terrainFrame, topIndex, bottomIndex, 1, dryTolerance, gravity);
        const scale = deltaSeconds * faceMeasure(terrainFrame, topIndex, bottomIndex, 1) / spacingV;
        addFlux(topIndex, -1, scale, edge.leftFlux);
        addFlux(bottomIndex, 1, scale, edge.rightFlux);
        addMaterialFlux(topIndex, bottomIndex, scale, edge.leftFlux[0]);
      }
    }
  }

  const next = cloneState(state, terrainFrame);
  let positivityCorrection = 0;
  for (let index = 0; index < count; index += 1) {
    let mappedDepth = state.mappedDepth[index] + depthDelta[index];
    let mappedMomentumU = state.mappedMomentumU[index] + momentumUDelta[index];
    let mappedMomentumV = state.mappedMomentumV[index] + momentumVDelta[index];
    if (mappedDepth < 0) {
      positivityCorrection += -mappedDepth;
      mappedDepth = 0;
    }
    if (mappedDepth / terrainFrame.fields.jacobian[index] <= dryTolerance) {
      mappedDepth = Math.max(0, mappedDepth);
      mappedMomentumU = 0;
      mappedMomentumV = 0;
    }
    next.mappedDepth[index] = mappedDepth;
    next.mappedMomentumU[index] = mappedMomentumU;
    next.mappedMomentumV[index] = mappedMomentumV;
    for (const key of Object.keys(materialDelta)) {
      const materialMass = state.materialMasses[key][index] + materialDelta[key][index];
      invariant(materialMass >= -1e-12, `material ${key} became negative at cell ${index}: ${materialMass}`);
      next.materialMasses[key][index] = Math.max(0, materialMass);
    }
  }
  next.stepCount += 1;
  next.simulationTimeSeconds += deltaSeconds;
  next.positivityCorrection += positivityCorrection;
  validateState(next, terrainFrame);
  return next;
}

export function createMappedMacroState(options = {}) {
  const terrainFrame = validateTerrainFluidFrame(options.terrainFrame);
  validateReferenceMetric(terrainFrame);
  const count = terrainFrame.grid.width * terrainFrame.grid.height;
  const depth = options.depth == null ? null : Array.from(options.depth);
  invariant(depth == null || depth.length === count, 'initial depth population mismatch');
  const mappedDepth = new Float64Array(count);
  const mappedMomentumU = new Float64Array(count);
  const mappedMomentumV = new Float64Array(count);
  const referenceFreeSurface = options.freeSurface == null ? null : new Float64Array(count);
  const initialMomentumU = options.momentumU == null ? null : Array.from(options.momentumU);
  const initialMomentumV = options.momentumV == null ? null : Array.from(options.momentumV);
  invariant(initialMomentumU == null || initialMomentumU.length === count, 'initial U momentum population mismatch');
  invariant(initialMomentumV == null || initialMomentumV.length === count, 'initial V momentum population mismatch');
  for (let index = 0; index < count; index += 1) {
    const jacobian = terrainFrame.fields.jacobian[index];
    const cellDepth = depth == null
      ? Math.max(0, finite(options.freeSurface, 'freeSurface') - terrainFrame.fields.bedHeight[index])
      : Math.max(0, finite(depth[index], `depth[${index}]`));
    mappedDepth[index] = jacobian * cellDepth;
    mappedMomentumU[index] = jacobian * (initialMomentumU?.[index] ?? 0);
    mappedMomentumV[index] = jacobian * (initialMomentumV?.[index] ?? 0);
    if (referenceFreeSurface) referenceFreeSurface[index] = terrainFrame.fields.bedHeight[index] + cellDepth;
  }
  return {
    schema: MAPPED_MACRO_STATE_SCHEMA,
    route: MAPPED_MACRO_SOLVER_ROUTE,
    method: MAPPED_MACRO_METHOD,
    width: terrainFrame.grid.width,
    height: terrainFrame.grid.height,
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: Number.isInteger(options.fluidEpoch) ? options.fluidEpoch : 0,
    stepCount: 0,
    simulationTimeSeconds: 0,
    mappedDepth,
    mappedMomentumU,
    mappedMomentumV,
    materialMasses: Object.fromEntries(Object.entries(options.materialMasses ?? {}).map(([key, values]) => {
      invariant(values?.length === count, `initial material ${key} population mismatch`);
      return [key, Float64Array.from(values, (value, index) => {
        const mass = finite(value, `materialMasses.${key}[${index}]`);
        invariant(mass >= 0, `materialMasses.${key}[${index}] must be non-negative`);
        return mass;
      })];
    })),
    referenceFreeSurface,
    positivityCorrection: 0,
  };
}

export function advanceMappedMacroState(state, terrainFrame, options = {}) {
  validateState(state, terrainFrame);
  const requestedSeconds = finite(options.deltaSeconds, 'deltaSeconds');
  invariant(requestedSeconds > 0, 'deltaSeconds must be positive');
  const gravity = finite(options.gravity ?? Math.abs(terrainFrame.gravity[1]) ?? DEFAULT_GRAVITY, 'gravity');
  invariant(gravity > 0, 'gravity must be positive');
  const dryTolerance = finite(options.dryTolerance ?? DEFAULT_DRY_TOLERANCE, 'dryTolerance');
  const cfl = finite(options.cfl ?? DEFAULT_CFL, 'cfl');
  invariant(cfl > 0 && cfl <= 1, 'cfl must be in (0, 1]');
  let next = cloneState(state, terrainFrame);
  let remaining = requestedSeconds;
  let substepCount = 0;
  while (remaining > 1e-15) {
    const stableSeconds = stableSubstepSeconds(next, terrainFrame, gravity, dryTolerance, cfl);
    const substepSeconds = Math.min(remaining, stableSeconds);
    invariant(Number.isFinite(substepSeconds) && substepSeconds > 0, 'macro solver could not choose a stable substep');
    next = advanceSubstep(next, terrainFrame, substepSeconds, gravity, dryTolerance);
    remaining -= substepSeconds;
    substepCount += 1;
    invariant(substepCount < 10_000, 'macro solver exceeded the uncapped-step liveness tripwire');
  }
  next.fluidEpoch += 1;
  return {
    state: next,
    receipt: {
      schema: 'kaminos.fluid.macro-step-receipt.v1',
      route: MAPPED_MACRO_SOLVER_ROUTE,
      terrainEpoch: terrainFrame.currentEpoch,
      fluidEpoch: next.fluidEpoch,
      requestedSeconds,
      effectiveSeconds: requestedSeconds,
      substepCount,
      cfl,
      dryTolerance,
      positivityCorrection: next.positivityCorrection - state.positivityCorrection,
    },
  };
}

export function summarizeMappedMacroState(state, terrainFrame, options = {}) {
  validateState(state, terrainFrame);
  const dryTolerance = options.dryTolerance ?? DEFAULT_DRY_TOLERANCE;
  const coordinateArea = terrainFrame.grid.spacing[0] * terrainFrame.grid.spacing[1];
  let volume = 0;
  let minimumDepth = Infinity;
  let maximumDepth = 0;
  let maximumSpeed = 0;
  let maximumFreeSurfaceError = 0;
  let wetCellCount = 0;
  const materialMasses = Object.fromEntries(Object.keys(state.materialMasses ?? {}).map(key => [key, 0]));
  for (let index = 0; index < state.mappedDepth.length; index += 1) {
    const cell = physicalCell(state, terrainFrame, index, dryTolerance);
    volume += state.mappedDepth[index] * coordinateArea;
    minimumDepth = Math.min(minimumDepth, cell.depth);
    maximumDepth = Math.max(maximumDepth, cell.depth);
    maximumSpeed = Math.max(maximumSpeed, Math.hypot(cell.velocityU, cell.velocityV));
    if (cell.depth > dryTolerance) wetCellCount += 1;
    if (state.referenceFreeSurface) {
      maximumFreeSurfaceError = Math.max(maximumFreeSurfaceError, Math.abs(
        terrainFrame.fields.bedHeight[index] + cell.depth - state.referenceFreeSurface[index]
      ));
    }
    for (const [key, values] of Object.entries(state.materialMasses ?? {})) materialMasses[key] += values[index] * coordinateArea;
  }
  return {
    schema: 'kaminos.fluid.mapped-macro-summary.v1',
    route: MAPPED_MACRO_SOLVER_ROUTE,
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: state.fluidEpoch,
    volume,
    minimumDepth: minimumDepth === Infinity ? 0 : minimumDepth,
    maximumDepth,
    maximumSpeed,
    maximumFreeSurfaceError,
    wetCellCount,
    materialMasses,
    positivityCorrection: state.positivityCorrection,
  };
}

export function remapMappedMacroState(state, previousTerrainFrame, terrainFrame, options = {}) {
  validateState(state, previousTerrainFrame);
  validateTerrainFluidFrame(terrainFrame);
  validateReferenceMetric(terrainFrame);
  validateSequentialTerrain(previousTerrainFrame, terrainFrame);
  const mode = options.mode ?? terrainFrame.motionClass;
  invariant(mode === terrainFrame.motionClass, `terrain remap mode ${mode} does not match frame motion class ${terrainFrame.motionClass}`);
  invariant(mode !== 'shock_reset', 'mapped macro reference rejects shock_reset terrain remap');
  invariant(mode === 'ordinary_morph' || mode === 'phase_morph', `mapped macro reference does not support terrain remap mode ${mode}`);
  const coordinateArea = terrainFrame.grid.spacing[0] * terrainFrame.grid.spacing[1];
  const before = conservationTotals(state, previousTerrainFrame);
  let maximumBedDisplacement = 0;
  let maximumSupportSpeed = 0;
  let displacedVolume = 0;
  let supportWork = 0;
  const gravity = Math.hypot(...terrainFrame.gravity);
  const fluidDensityKgM3 = finite(options.fluidDensityKgM3 ?? 997, 'fluidDensityKgM3');
  invariant(fluidDensityKgM3 > 0, 'fluidDensityKgM3 must be positive');
  for (let index = 0; index < state.mappedDepth.length; index += 1) {
    const bedDisplacement = terrainFrame.fields.bedHeight[index] - previousTerrainFrame.fields.bedHeight[index];
    const supportSpeed = length3(terrainFrame.fields.supportVelocity, index * 3);
    maximumBedDisplacement = Math.max(maximumBedDisplacement, Math.abs(bedDisplacement));
    maximumSupportSpeed = Math.max(maximumSupportSpeed, supportSpeed);
    if (state.mappedDepth[index] > DEFAULT_DRY_TOLERANCE) {
      const meanJacobian = 0.5 * (
        previousTerrainFrame.fields.jacobian[index]
        + terrainFrame.fields.jacobian[index]
      );
      const sweptVolume = bedDisplacement * meanJacobian * coordinateArea;
      const meanDepth = state.mappedDepth[index] / meanJacobian;
      displacedVolume += sweptVolume;
      supportWork += fluidDensityKgM3 * gravity * meanDepth * sweptVolume;
    }
  }
  let deltaSeconds = 0;
  let motionSubstepEnvelope = 0;
  if (mode === 'phase_morph') {
    deltaSeconds = finite(options.deltaSeconds, 'phase_morph deltaSeconds');
    invariant(deltaSeconds > 0, 'phase_morph deltaSeconds must be positive');
    motionSubstepEnvelope = finite(terrainFrame.motionSubstepEnvelope, 'phase_morph motionSubstepEnvelope');
    invariant(motionSubstepEnvelope > 0, 'phase_morph motionSubstepEnvelope must be positive');
    invariant(deltaSeconds <= motionSubstepEnvelope + 1e-12, `phase_morph deltaSeconds ${deltaSeconds} exceeds source substep envelope ${motionSubstepEnvelope}`);
    const allowedBedDisplacement = finite(options.maximumBedDisplacement, 'phase_morph maximumBedDisplacement');
    const allowedSupportSpeed = finite(options.maximumSupportSpeed, 'phase_morph maximumSupportSpeed');
    invariant(allowedBedDisplacement >= 0, 'phase_morph maximumBedDisplacement must be non-negative');
    invariant(allowedSupportSpeed >= 0, 'phase_morph maximumSupportSpeed must be non-negative');
    invariant(maximumBedDisplacement <= allowedBedDisplacement + 1e-12, `phase_morph bed displacement ${maximumBedDisplacement} exceeds limit ${allowedBedDisplacement}`);
    invariant(maximumSupportSpeed <= allowedSupportSpeed + 1e-12, `phase_morph support speed ${maximumSupportSpeed} exceeds limit ${allowedSupportSpeed}`);
  } else {
    deltaSeconds = finite(options.deltaSeconds ?? terrainFrame.motionSubstepEnvelope ?? 1, 'ordinary_morph deltaSeconds');
    motionSubstepEnvelope = finite(terrainFrame.motionSubstepEnvelope ?? deltaSeconds, 'ordinary_morph motionSubstepEnvelope');
  }
  const next = {
    ...cloneState(state, previousTerrainFrame),
    terrainEpoch: terrainFrame.currentEpoch,
  };
  if (next.referenceFreeSurface) {
    for (let index = 0; index < next.referenceFreeSurface.length; index += 1) {
      next.referenceFreeSurface[index] += terrainFrame.fields.bedHeight[index] - previousTerrainFrame.fields.bedHeight[index];
    }
  }
  const after = conservationTotals(next, terrainFrame);
  const materialKeys = new Set([...Object.keys(before.materials), ...Object.keys(after.materials)]);
  const receipt = createTerrainRemapReceipt({
    receiptId: options.receiptId ?? `terrain-remap:${terrainFrame.terrainId}:${previousTerrainFrame.currentEpoch}->${terrainFrame.currentEpoch}`,
    mode,
    state: 'committed',
    terrainId: terrainFrame.terrainId,
    sourceId: terrainFrame.source.effective,
    transformId: terrainFrame.transformId,
    previousTerrainEpoch: previousTerrainFrame.currentEpoch,
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: next.fluidEpoch,
    predecessorReceiptIds: options.predecessorReceiptIds ?? [],
    lineageIds: options.lineageIds ?? [],
    displacedVolume,
    supportWork,
    maximumBedDisplacement,
    maximumSupportSpeed,
    deltaSeconds,
    motionSubstepEnvelope,
    volumeResidual: before.volume - after.volume,
    momentumResidual: before.momentum.map((value, index) => value - after.momentum[index]),
    materialResiduals: Object.fromEntries(
      Array.from(materialKeys, key => [key, (before.materials[key] ?? 0) - (after.materials[key] ?? 0)]),
    ),
    tolerance: options.tolerance ?? 1e-9,
  });
  return {
    state: next,
    receipt: validateTerrainRemapReceipt(receipt),
  };
}

export function depositLocalToMacro(state, terrainFrame, options = {}) {
  const next = cloneState(state, terrainFrame);
  const deposits = Array.isArray(options.deposits) ? options.deposits : [];
  invariant(deposits.length > 0, 'local-to-macro deposit requires at least one destination sample');
  const coordinateArea = terrainFrame.grid.spacing[0] * terrainFrame.grid.spacing[1];
  let volume = 0;
  const momentum = [0, 0, 0];
  for (let depositIndex = 0; depositIndex < deposits.length; depositIndex += 1) {
    const deposit = deposits[depositIndex];
    invariant(Number.isInteger(deposit.x) && deposit.x >= 0 && deposit.x < state.width, `deposit[${depositIndex}].x is outside the macro grid`);
    invariant(Number.isInteger(deposit.y) && deposit.y >= 0 && deposit.y < state.height, `deposit[${depositIndex}].y is outside the macro grid`);
    const index = deposit.y * state.width + deposit.x;
    const cellVolume = finite(deposit.volume, `deposit[${depositIndex}].volume`);
    invariant(cellVolume > 0, `deposit[${depositIndex}].volume must be positive`);
    const cellMomentum = Array.from(deposit.momentum ?? [], (value, component) => finite(value, `deposit[${depositIndex}].momentum[${component}]`));
    invariant(cellMomentum.length === 3, `deposit[${depositIndex}].momentum must contain 3 values`);
    next.mappedDepth[index] += cellVolume / coordinateArea;
    next.mappedMomentumU[index] += cellMomentum[0] / coordinateArea;
    next.mappedMomentumV[index] += cellMomentum[2] / coordinateArea;
    volume += cellVolume;
    for (let component = 0; component < 3; component += 1) momentum[component] += cellMomentum[component];
  }
  next.fluidEpoch += 1;
  if (options.fluidEpoch != null) {
    invariant(options.fluidEpoch === next.fluidEpoch, `requested fluidEpoch ${options.fluidEpoch} does not match committed state epoch ${next.fluidEpoch}`);
  }
  next.referenceFreeSurface = null;
  const debitedMaterials = options.debitedMaterials ?? {};
  for (const [key, totalMassValue] of Object.entries(debitedMaterials)) {
    const totalMass = finite(totalMassValue, `debitedMaterials.${key}`);
    invariant(totalMass >= 0, `debitedMaterials.${key} must be non-negative`);
    const values = next.materialMasses[key] ?? new Float64Array(next.mappedDepth.length);
    for (const deposit of deposits) {
      const index = deposit.y * state.width + deposit.x;
      values[index] += (totalMass * deposit.volume / volume) / coordinateArea;
    }
    next.materialMasses[key] = values;
  }
  const receipt = createFluidExchangeReceipt({
    transactionId: options.transactionId,
    lineageId: options.lineageId,
    sourceRepresentation: 'local',
    destinationRepresentation: 'macro',
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: next.fluidEpoch,
    allocationGeneration: options.allocationGeneration,
    supportId: options.supportId,
    transformId: options.transformId,
    debitedVolume: volume,
    creditedVolume: volume,
    debitedMomentum: momentum,
    creditedMomentum: momentum,
    debitedMaterials,
    creditedMaterials: options.creditedMaterials ?? debitedMaterials,
    tolerance: options.tolerance ?? 1e-9,
    state: 'committed',
  });
  return { state: next, receipt: validateFluidExchangeReceipt(receipt) };
}

export function createMacroFluidTerrainFeedbackFrame(state, terrainFrame, options = {}) {
  validateState(state, terrainFrame);
  const count = state.mappedDepth.length;
  const depth = new Float32Array(count);
  const wetness = new Float32Array(count);
  const tangentMomentum = new Float32Array(count * 2);
  const dryTolerance = options.dryTolerance ?? DEFAULT_DRY_TOLERANCE;
  const saturationDepth = options.saturationDepth ?? Math.max(dryTolerance * 2, 0.05);
  for (let index = 0; index < count; index += 1) {
    const jacobian = terrainFrame.fields.jacobian[index];
    const cellDepth = Math.max(0, state.mappedDepth[index] / jacobian);
    depth[index] = cellDepth;
    wetness[index] = Math.min(1, cellDepth / saturationDepth);
    tangentMomentum[index * 2] = state.mappedMomentumU[index] / jacobian;
    tangentMomentum[index * 2 + 1] = state.mappedMomentumV[index] / jacobian;
  }
  const frame = createFluidTerrainFeedbackFrame({
    requestedRoute: options.requestedRoute ?? 'kaminos/fluid/terrain-feedback',
    effectiveRoute: options.effectiveRoute ?? 'kaminos/fluid/terrain-feedback',
    producerRevision: options.producerRevision,
    fluidEpoch: state.fluidEpoch,
    terrainEpoch: terrainFrame.currentEpoch,
    representationIdentity: REPRESENTATION_OWNERSHIP_IDENTITY,
    grid: terrainFrame.grid,
    fields: { depth, wetness, tangentMomentum },
    dirtyRegions: options.dirtyRegions ?? terrainFrame.dirtyRegions,
    conservationReceiptIds: options.conservationReceiptIds ?? [],
    lineageIds: options.lineageIds ?? [],
    complete: true,
  });
  return validateFluidTerrainFeedbackFrame(frame, {
    expectedRoute: options.effectiveRoute ?? 'kaminos/fluid/terrain-feedback',
    expectedTerrainEpoch: terrainFrame.currentEpoch,
  });
}

export function createMacroFluidRepresentationFrame(state, terrainFrame, options = {}) {
  validateState(state, terrainFrame);
  const frame = createFluidRepresentationFrame({
    requestedRoute: options.requestedRoute ?? 'kaminos/fluid/representation-frame',
    effectiveRoute: options.effectiveRoute ?? 'kaminos/fluid/representation-frame',
    producerRevision: options.producerRevision,
    fluidEpoch: state.fluidEpoch,
    terrainEpoch: terrainFrame.currentEpoch,
    ownershipIdentity: REPRESENTATION_OWNERSHIP_IDENTITY,
    macro: {
      grid: terrainFrame.grid,
      mappedDepth: Float32Array.from(state.mappedDepth),
      mappedMomentumU: Float32Array.from(state.mappedMomentumU),
      mappedMomentumV: Float32Array.from(state.mappedMomentumV),
      materialMasses: Object.fromEntries(Object.entries(state.materialMasses).map(([key, values]) => [key, Float32Array.from(values)])),
      method: MAPPED_MACRO_METHOD,
    },
    local: options.local ?? { sourceBuffer: null, count: 0, supportScale: 0 },
    parcels: options.parcels ?? { sourceBuffer: null, count: 0 },
    physicalMaterial: options.physicalMaterial ?? {
      densityKgM3: 997,
      dynamicViscosityPaS: 0.00089,
      absorptionPerMeter: [0.05, 0.02, 0.01],
    },
    dirtyRegions: options.dirtyRegions ?? terrainFrame.dirtyRegions,
    conservationReceiptIds: options.conservationReceiptIds ?? [],
    lineageIds: options.lineageIds ?? [],
    complete: true,
  });
  return validateFluidRepresentationFrame(frame, {
    expectedRoute: options.effectiveRoute ?? 'kaminos/fluid/representation-frame',
  });
}

function validatePortableMacroSourceDescriptor(descriptor) {
  invariant(descriptor?.schema === PORTABLE_MACRO_SOURCE_HANDLE_SCHEMA, `portable source handle schema mismatch: ${descriptor?.schema}`);
  validateExactPortableRoute(descriptor.route);
  validatePortableCapability(descriptor.requestedCapability, descriptor.effectiveCapability);
  invariant(descriptor.capability === descriptor.effectiveCapability, 'portable source descriptor capability identity mismatch');
  nonEmptyString(descriptor.sourceHandleId, 'sourceHandleId');
  invariant(descriptor.sourceAuthority === 'live_runtime', `unsupported portable source authority: ${descriptor.sourceAuthority}`);
  invariant(descriptor.fallbackStatus === 'none', `portable source fallback is forbidden: ${descriptor.fallbackStatus}`);
  invariant(descriptor.ownershipIdentity === REPRESENTATION_OWNERSHIP_IDENTITY, 'portable source ownership identity mismatch');
  invariant(
    descriptor.representationRoute?.requested === 'kaminos/fluid/representation-frame'
      && descriptor.representationRoute?.effective === descriptor.representationRoute.requested,
    'portable source representation route mismatch',
  );
  invariant(descriptor.producer?.runtimeRoute === MAPPED_MACRO_SOLVER_ROUTE, 'portable source runtime route mismatch');
  invariant(descriptor.producer?.method === MAPPED_MACRO_METHOD, 'portable source method mismatch');
  nonEmptyString(descriptor.producer?.revision, 'portable source producer revision');
  const support = descriptor.supportGeometry;
  invariant(support && typeof support === 'object', 'portable source support geometry descriptor is required');
  nonEmptyString(support.topologyId, 'supportGeometry.topologyId');
  nonEmptyString(support.terrainId, 'supportGeometry.terrainId');
  nonEmptyString(support.supportClass, 'supportGeometry.supportClass');
  nonEmptyString(support.transformId, 'supportGeometry.transformId');
  invariant(support.worldMetersPerUnit === 1, 'portable source support geometry must use physical SI meters');
  invariant(Number.isInteger(support.sampleCount) && support.sampleCount > 0, 'supportGeometry.sampleCount must be positive');
  invariant(support.coordinateSpace === 'world_meters', 'portable source support geometry must publish world-meter coordinates');
  invariant(
    support.mapping === 'explicit-world-position-buffer-v1',
    `unsupported portable source support mapping: ${support.mapping}`,
  );
  invariant(
    support.positionSource === 'terrain-fluid-frame.fields.worldPosition',
    `unsupported portable source position source: ${support.positionSource}`,
  );
  const wetBoundary = descriptor.wetBoundary;
  invariant(wetBoundary?.schema === MACRO_WET_BOUNDARY_SCHEMA, 'portable source wet boundary descriptor is required');
  validateWetBoundaryRoute(wetBoundary.route);
  invariant(wetBoundary.sourceAuthority === 'live_runtime', `unsupported wet boundary source authority: ${wetBoundary.sourceAuthority}`);
  invariant(wetBoundary.fallbackStatus === 'none', `wet boundary fallback is forbidden: ${wetBoundary.fallbackStatus}`);
  invariant(wetBoundary.hysteresis === 'schmitt-trigger-v1', `unsupported wet boundary hysteresis: ${wetBoundary.hysteresis}`);
  const boundaryThresholds = wetBoundaryThresholds({
    dryDepthThresholdMeters: wetBoundary.effectiveDryDepthMeters,
    wetActivationDepthThresholdMeters: wetBoundary.effectiveWetActivationDepthMeters,
  });
  invariant(
    boundaryThresholds.effectiveDryDepthMeters === wetBoundary.effectiveDryDepthMeters
      && boundaryThresholds.effectiveWetActivationDepthMeters === wetBoundary.effectiveWetActivationDepthMeters,
    'portable source wet boundary threshold identity mismatch',
  );
  invariant(descriptor.lifetime?.releasePolicy === 'explicit-release-v1', 'portable source lifetime requires explicit release');
  integer(descriptor.lifetime?.retainedTerrainEpoch, 'lifetime.retainedTerrainEpoch');
  integer(descriptor.lifetime?.retainedFluidEpoch, 'lifetime.retainedFluidEpoch');
  validatePhysicalMaterial(descriptor.physicalMaterial);
  for (const forbidden of ['camera', 'view', 'projection', 'viewport', 'screenSpaceDemand', 'opticalResidency']) {
    invariant(!(forbidden in descriptor), `portable source descriptor contains camera-owned state: ${forbidden}`);
  }
  return descriptor;
}

export function validatePortableMacroSourceSnapshot(snapshot, expectations = {}) {
  invariant(
    snapshot?.schema === PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA,
    `portable source snapshot schema mismatch: ${snapshot?.schema}`,
  );
  validateExactPortableRoute(snapshot.route);
  validatePortableCapability(snapshot.requestedCapability, snapshot.effectiveCapability);
  invariant(snapshot.capability === snapshot.effectiveCapability, 'portable source snapshot capability identity mismatch');
  invariant(snapshot.sourceAuthority === 'live_runtime', `unsupported portable source authority: ${snapshot.sourceAuthority}`);
  invariant(snapshot.fallbackStatus === 'none', `portable source fallback is forbidden: ${snapshot.fallbackStatus}`);
  invariant(snapshot.producer?.runtimeRoute === MAPPED_MACRO_SOLVER_ROUTE, 'portable source runtime route mismatch');
  invariant(snapshot.producer?.method === MAPPED_MACRO_METHOD, 'portable source method mismatch');
  nonEmptyString(snapshot.producer?.revision, 'portable source producer revision');
  nonEmptyString(snapshot.sourceHandleId, 'sourceHandleId');
  if (expectations.expectedSourceHandleId != null) {
    invariant(
      snapshot.sourceHandleId === expectations.expectedSourceHandleId,
      `portable source handle mismatch: expected ${expectations.expectedSourceHandleId}, received ${snapshot.sourceHandleId}`,
    );
  }
  const terrainEpoch = integer(snapshot.terrainEpoch, 'terrainEpoch');
  const fluidEpoch = integer(snapshot.fluidEpoch, 'fluidEpoch');
  invariant(terrainEpoch >= 0, 'terrainEpoch must be non-negative');
  invariant(fluidEpoch >= 0, 'fluidEpoch must be non-negative');
  if (expectations.minimumTerrainEpoch != null) {
    invariant(terrainEpoch >= expectations.minimumTerrainEpoch, `portable source has stale terrain epoch ${terrainEpoch}; minimum ${expectations.minimumTerrainEpoch}`);
  }
  if (expectations.minimumFluidEpoch != null) {
    invariant(fluidEpoch >= expectations.minimumFluidEpoch, `portable source has stale fluid epoch ${fluidEpoch}; minimum ${expectations.minimumFluidEpoch}`);
  }
  invariant(snapshot.ownershipIdentity === REPRESENTATION_OWNERSHIP_IDENTITY, 'portable source ownership identity mismatch');
  invariant(
    snapshot.representationRoute?.requested === 'kaminos/fluid/representation-frame'
      && snapshot.representationRoute?.effective === snapshot.representationRoute.requested,
    'portable source representation route mismatch',
  );
  const support = snapshot.supportGeometry;
  invariant(support && typeof support === 'object', 'portable source support geometry is required');
  nonEmptyString(support.geometryId, 'supportGeometry.geometryId');
  nonEmptyString(support.topologyId, 'supportGeometry.topologyId');
  nonEmptyString(support.terrainId, 'supportGeometry.terrainId');
  nonEmptyString(support.supportClass, 'supportGeometry.supportClass');
  nonEmptyString(support.transformId, 'supportGeometry.transformId');
  invariant(support.coordinateSpace === 'world_meters', 'portable source support geometry must publish world-meter coordinates');
  invariant(support.worldMetersPerUnit === 1, 'portable source support geometry must use physical SI meters');
  invariant(support.mapping === 'explicit-world-position-buffer-v1', `unsupported support geometry mapping: ${support.mapping}`);
  invariant(
    support.positionSource === 'terrain-fluid-frame.fields.worldPosition',
    `unsupported support geometry position source: ${support.positionSource}`,
  );
  const width = integer(support.grid?.width, 'supportGeometry.grid.width');
  const height = integer(support.grid?.height, 'supportGeometry.grid.height');
  invariant(width > 0 && height > 0, 'supportGeometry grid dimensions must be positive');
  invariant(
    Array.isArray(support.grid.spacing) && support.grid.spacing.length === 2
      && support.grid.spacing.every(value => Number.isFinite(value) && value > 0),
    'supportGeometry.grid.spacing must contain two positive finite values',
  );
  invariant(
    Array.isArray(support.grid.origin) && support.grid.origin.length === 3
      && support.grid.origin.every(Number.isFinite),
    'supportGeometry.grid.origin must contain three finite values',
  );
  const sampleCount = width * height;
  invariant(support.sampleCount === sampleCount, 'supportGeometry sample count mismatch');
  portableTypedArray(support.worldPosition, sampleCount * 3, 'supportGeometry.worldPosition');
  portableTypedArray(support.tangentU, sampleCount * 3, 'supportGeometry.tangentU');
  portableTypedArray(support.tangentV, sampleCount * 3, 'supportGeometry.tangentV');
  portableTypedArray(support.normal, sampleCount * 3, 'supportGeometry.normal');
  portableTypedArray(support.jacobian, sampleCount, 'supportGeometry.jacobian', { nonNegative: true });
  portableTypedArray(support.supportVelocity, sampleCount * 3, 'supportGeometry.supportVelocity');
  for (let index = 0; index < sampleCount; index += 1) {
    invariant(support.jacobian[index] > 0, `supportGeometry.jacobian[${index}] must be positive`);
  }
  invariant(snapshot.macro?.method === MAPPED_MACRO_METHOD, `portable macro method mismatch: ${snapshot.macro?.method}`);
  invariant(snapshot.source && typeof snapshot.source === 'object', 'portable source terrain identity is required');
  nonEmptyString(snapshot.source.requested, 'requested source');
  nonEmptyString(snapshot.source.effective, 'effective source');
  invariant(
    snapshot.source.effective === snapshot.source.requested,
    `effective source mismatch: requested ${snapshot.source.requested}, received ${snapshot.source.effective}`,
  );
  nonEmptyString(snapshot.source.producerId, 'source.producerId');
  nonEmptyString(snapshot.source.producerRevision, 'source.producerRevision');
  portableTypedArray(snapshot.macro?.mappedDepth, sampleCount, 'macro.mappedDepth', { nonNegative: true });
  portableTypedArray(snapshot.macro?.mappedMomentumU, sampleCount, 'macro.mappedMomentumU');
  portableTypedArray(snapshot.macro?.mappedMomentumV, sampleCount, 'macro.mappedMomentumV');
  invariant(snapshot.macro?.materialMasses && typeof snapshot.macro.materialMasses === 'object', 'macro.materialMasses must be an object');
  for (const [key, values] of Object.entries(snapshot.macro.materialMasses)) {
    portableTypedArray(values, sampleCount, `macro.materialMasses.${key}`, { nonNegative: true });
  }
  const wetBoundary = snapshot.wetBoundary;
  invariant(wetBoundary && typeof wetBoundary === 'object', 'wet boundary descriptor is required');
  invariant(wetBoundary.schema === MACRO_WET_BOUNDARY_SCHEMA, `wet boundary schema mismatch: ${wetBoundary.schema}`);
  validateWetBoundaryRoute(wetBoundary.route);
  invariant(wetBoundary.sourceAuthority === 'live_runtime', `unsupported wet boundary source authority: ${wetBoundary.sourceAuthority}`);
  invariant(wetBoundary.fallbackStatus === 'none', `wet boundary fallback is forbidden: ${wetBoundary.fallbackStatus}`);
  invariant(wetBoundary.complete === true, 'wet boundary descriptor is incomplete');
  invariant(wetBoundary.terrainEpoch === terrainEpoch, 'wet boundary terrain epoch mismatch');
  invariant(wetBoundary.fluidEpoch === fluidEpoch, 'wet boundary fluid epoch mismatch');
  invariant(wetBoundary.topologyId === support.topologyId, 'wet boundary topology identity mismatch');
  const effectiveDryDepthMeters = finite(wetBoundary.effectiveDryDepthMeters, 'effectiveDryDepthMeters');
  const effectiveWetActivationDepthMeters = finite(
    wetBoundary.effectiveWetActivationDepthMeters,
    'effectiveWetActivationDepthMeters',
  );
  invariant(effectiveDryDepthMeters >= 0, 'effectiveDryDepthMeters must be non-negative');
  invariant(
    effectiveWetActivationDepthMeters > effectiveDryDepthMeters,
    'effectiveWetActivationDepthMeters must be greater than effectiveDryDepthMeters',
  );
  portableTypedArray(wetBoundary.physicalDepthMeters, sampleCount, 'wetBoundary.physicalDepthMeters', { nonNegative: true });
  portableTypedArray(wetBoundary.signedDryMarginMeters, sampleCount, 'wetBoundary.signedDryMarginMeters');
  portableBinaryArray(wetBoundary.wetState, sampleCount, 'wetBoundary.wetState');
  for (let index = 0; index < sampleCount; index += 1) {
    const physicalDepth = snapshot.macro.mappedDepth[index] / support.jacobian[index];
    const tolerance = 1e-12 * Math.max(1, physicalDepth);
    invariant(
      Math.abs(wetBoundary.physicalDepthMeters[index] - physicalDepth) <= tolerance,
      `wetBoundary.physicalDepthMeters[${index}] disagrees with mapped depth and Jacobian`,
    );
    invariant(
      Math.abs(wetBoundary.signedDryMarginMeters[index] - (physicalDepth - effectiveDryDepthMeters)) <= tolerance,
      `wetBoundary.signedDryMarginMeters[${index}] disagrees with effective dry threshold`,
    );
    if (physicalDepth <= effectiveDryDepthMeters) {
      invariant(wetBoundary.wetState[index] === 0, `wetBoundary.wetState[${index}] is wet below the dry threshold`);
    }
    if (physicalDepth >= effectiveWetActivationDepthMeters) {
      invariant(wetBoundary.wetState[index] === 1, `wetBoundary.wetState[${index}] is dry above the activation threshold`);
    }
  }
  const cells = wetBoundary.cells;
  invariant(cells && typeof cells === 'object', 'wetBoundary.cells is required');
  invariant(cells.indexing === 'row-major-quad-v1', `unsupported wet boundary cell indexing: ${cells.indexing}`);
  const cellWidth = Math.max(0, width - 1);
  const cellHeight = Math.max(0, height - 1);
  const cellCount = cellWidth * cellHeight;
  invariant(cells.width === cellWidth && cells.height === cellHeight, 'wet boundary cell grid mismatch');
  portableTypedArray(cells.stableId, cellCount, 'wetBoundary.cells.stableId', { nonNegative: true });
  portableBinaryArray(cells.activeState, cellCount, 'wetBoundary.cells.activeState');
  portableTypedArray(cells.generation, cellCount, 'wetBoundary.cells.generation', { nonNegative: true });
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const cellId = y * cellWidth + x;
      invariant(cells.stableId[cellId] === cellId, `wetBoundary.cells.stableId[${cellId}] is unstable`);
      const signature = wetBoundaryCellSignature(wetBoundary.wetState, width, x, y);
      const expectedActive = Number(signature !== 0 && signature !== 15);
      invariant(cells.activeState[cellId] === expectedActive, `wetBoundary.cells.activeState[${cellId}] disagrees with wet state`);
      invariant(Number.isInteger(cells.generation[cellId]), `wetBoundary.cells.generation[${cellId}] must be an integer`);
    }
  }
  const boundaryGeneration = integer(wetBoundary.boundaryGeneration, 'wetBoundary.boundaryGeneration');
  invariant(boundaryGeneration >= 0, 'wetBoundary.boundaryGeneration must be non-negative');
  invariant(
    wetBoundary.boundaryId === `${support.topologyId}:boundary:${boundaryGeneration}`,
    'wet boundary identity does not match topology and generation',
  );
  const reset = wetBoundary.reset;
  invariant(reset && typeof reset === 'object', 'wetBoundary.reset is required');
  const resetGeneration = integer(reset.generation, 'wetBoundary.reset.generation');
  invariant(resetGeneration >= 0, 'wetBoundary.reset.generation must be non-negative');
  nonEmptyString(reset.id, 'wetBoundary.reset.id');
  invariant(reset.id === wetBoundaryResetId(support.topologyId, reset), 'wet boundary reset identity mismatch');
  invariant(
    ['initial', 'ordinary_morph', 'phase_morph', 'shock_reset'].includes(reset.kind),
    `unsupported wet boundary reset kind: ${reset.kind}`,
  );
  const resetPreviousTerrainEpoch = integer(
    reset.previousTerrainEpoch,
    'wetBoundary.reset.previousTerrainEpoch',
  );
  const resetTerrainEpoch = integer(reset.terrainEpoch, 'wetBoundary.reset.terrainEpoch');
  invariant(
    resetTerrainEpoch === terrainEpoch,
    'wet boundary terrain transition identity mismatch',
  );
  invariant(
    resetPreviousTerrainEpoch <= resetTerrainEpoch,
    'wet boundary reset previous terrain epoch is newer than its current epoch',
  );
  invariant(reset.remapReceiptId == null || typeof reset.remapReceiptId === 'string', 'wet boundary reset remapReceiptId must be null or a string');
  invariant(reset.shockId == null || typeof reset.shockId === 'string', 'wet boundary reset shockId must be null or a string');
  const resetBoundaryGeneration = integer(
    reset.boundaryGeneration,
    'wetBoundary.reset.boundaryGeneration',
  );
  invariant(
    resetBoundaryGeneration <= boundaryGeneration,
    'wet boundary reset generation is newer than the boundary state',
  );
  invariant(
    boundaryGeneration >= resetGeneration,
    'wet boundary generation cannot precede reset generation',
  );
  for (let cellId = 0; cellId < cellCount; cellId += 1) {
    invariant(
      cells.generation[cellId] >= resetGeneration,
      `wetBoundary.cells.generation[${cellId}] precedes the latest terrain reset`,
    );
  }
  if (reset.kind === 'initial') {
    invariant(
      resetGeneration === 0 && reset.remapReceiptId == null,
      'initial wet boundary reset cannot carry remap lineage',
    );
  } else {
    invariant(resetGeneration > 0, 'remapped wet boundary reset generation must be positive');
    nonEmptyString(reset.remapReceiptId, 'wetBoundary.reset.remapReceiptId');
    invariant(
      resetPreviousTerrainEpoch < resetTerrainEpoch,
      'remapped wet boundary reset must advance the terrain epoch',
    );
  }
  invariant(reset.discontinuous === true, 'wet boundary reset must declare its discontinuity');
  invariant(
    wetBoundary.derivation?.physicalDepth === 'mappedDepth / supportGeometry.jacobian'
      && wetBoundary.derivation?.signedMargin === 'physicalDepthMeters - effectiveDryDepthMeters'
      && wetBoundary.derivation?.hysteresis === 'schmitt-trigger-v1',
    'wet boundary derivation identity mismatch',
  );
  invariant(
    Number.isFinite(snapshot.confidence) && snapshot.confidence >= 0 && snapshot.confidence <= 1,
    'portable source confidence must be in [0, 1]',
  );
  invariant(Array.isArray(snapshot.dirtyRegions), 'portable source dirtyRegions must be an array');
  invariant(snapshot.complete === true, 'portable source snapshot is incomplete');
  validatePhysicalMaterial(snapshot.physicalMaterial);
  for (const forbidden of ['camera', 'view', 'projection', 'viewport', 'screenSpaceDemand', 'opticalResidency']) {
    invariant(!(forbidden in snapshot), `portable source snapshot contains camera-owned state: ${forbidden}`);
  }
  return snapshot;
}

export function validatePortableMacroSourceHandle(handle) {
  invariant(handle && typeof handle === 'object', 'portable source handle is required');
  invariant(Object.isFrozen(handle), 'portable source handle must be immutable');
  invariant(handle.descriptor && typeof handle.descriptor === 'object', 'portable source descriptor is required');
  invariant(Object.isFrozen(handle.descriptor), 'portable source descriptor must be immutable');
  validatePortableMacroSourceDescriptor(handle.descriptor);
  invariant(typeof handle.read === 'function', 'portable source handle requires a read function');
  invariant(typeof handle.release === 'function', 'portable source handle requires a release function');
  return handle;
}

function validateSupportWorldPositions(terrainFrame) {
  validateReferenceMetric(terrainFrame);
  const sampleCount = terrainFrame.grid.width * terrainFrame.grid.height;
  invariant(
    terrainFrame.fields.worldPosition != null,
    'portable macro source requires explicit world-position support in terrainFrame.fields.worldPosition',
  );
  portableTypedArray(
    terrainFrame.fields.worldPosition,
    sampleCount * 3,
    'terrainFrame.fields.worldPosition',
  );
  return terrainFrame.fields.worldPosition;
}

function supportWorldPositions(terrainFrame) {
  validateSupportWorldPositions(terrainFrame);
  return Float64Array.from(terrainFrame.fields.worldPosition);
}

function createPortableMacroSourceSnapshot(state, terrainFrame, descriptor, boundaryState) {
  validateState(state, terrainFrame);
  validatePortableMacroSourceDescriptor(descriptor);
  const sampleCount = terrainFrame.grid.width * terrainFrame.grid.height;
  const snapshot = {
    schema: PORTABLE_MACRO_SOURCE_SNAPSHOT_SCHEMA,
    route: { ...descriptor.route },
    requestedCapability: descriptor.requestedCapability,
    effectiveCapability: descriptor.effectiveCapability,
    capability: descriptor.capability,
    sourceHandleId: descriptor.sourceHandleId,
    sourceAuthority: descriptor.sourceAuthority,
    fallbackStatus: descriptor.fallbackStatus,
    representationRoute: { ...descriptor.representationRoute },
    producer: { ...descriptor.producer },
    ownershipIdentity: REPRESENTATION_OWNERSHIP_IDENTITY,
    terrainEpoch: terrainFrame.currentEpoch,
    fluidEpoch: state.fluidEpoch,
    source: {
      requested: terrainFrame.source.requested,
      effective: terrainFrame.source.effective,
      producerId: terrainFrame.producer.id,
      producerRevision: terrainFrame.producer.revision,
    },
    supportGeometry: {
      geometryId: `${terrainFrame.transformId}:terrain-${terrainFrame.currentEpoch}`,
      topologyId: descriptor.supportGeometry.topologyId,
      terrainId: terrainFrame.terrainId,
      supportClass: terrainFrame.supportClass,
      transformId: terrainFrame.transformId,
      coordinateSpace: 'world_meters',
      worldMetersPerUnit: terrainFrame.worldMetersPerUnit,
      mapping: 'explicit-world-position-buffer-v1',
      positionSource: 'terrain-fluid-frame.fields.worldPosition',
      sampleCount,
      grid: {
        width: terrainFrame.grid.width,
        height: terrainFrame.grid.height,
        spacing: [...terrainFrame.grid.spacing],
        origin: [...terrainFrame.grid.origin],
      },
      worldPosition: supportWorldPositions(terrainFrame),
      tangentU: Float64Array.from(terrainFrame.fields.tangentU),
      tangentV: Float64Array.from(terrainFrame.fields.tangentV),
      normal: Float64Array.from(terrainFrame.fields.normal),
      jacobian: Float64Array.from(terrainFrame.fields.jacobian),
      supportVelocity: Float64Array.from(terrainFrame.fields.supportVelocity),
    },
    macro: {
      method: MAPPED_MACRO_METHOD,
      mappedDepth: Float64Array.from(state.mappedDepth),
      mappedMomentumU: Float64Array.from(state.mappedMomentumU),
      mappedMomentumV: Float64Array.from(state.mappedMomentumV),
      materialMasses: Object.fromEntries(
        Object.entries(state.materialMasses).map(([key, values]) => [key, Float64Array.from(values)]),
      ),
    },
    wetBoundary: {
      schema: MACRO_WET_BOUNDARY_SCHEMA,
      route: {
        requested: MACRO_WET_BOUNDARY_ROUTE,
        effective: MACRO_WET_BOUNDARY_ROUTE,
      },
      sourceAuthority: 'live_runtime',
      fallbackStatus: 'none',
      terrainEpoch: boundaryState.terrainEpoch,
      fluidEpoch: boundaryState.fluidEpoch,
      topologyId: boundaryState.topologyId,
      effectiveDryDepthMeters: boundaryState.effectiveDryDepthMeters,
      effectiveWetActivationDepthMeters: boundaryState.effectiveWetActivationDepthMeters,
      physicalDepthMeters: Float64Array.from(boundaryState.physicalDepthMeters),
      signedDryMarginMeters: Float64Array.from(boundaryState.signedDryMarginMeters),
      wetState: Uint8Array.from(boundaryState.wetState),
      cells: {
        indexing: 'row-major-quad-v1',
        width: boundaryState.cellWidth,
        height: boundaryState.cellHeight,
        stableId: Uint32Array.from(boundaryState.stableId),
        activeState: Uint8Array.from(boundaryState.activeState),
        generation: Uint32Array.from(boundaryState.generation),
      },
      boundaryGeneration: boundaryState.boundaryGeneration,
      boundaryId: `${boundaryState.topologyId}:boundary:${boundaryState.boundaryGeneration}`,
      reset: { ...boundaryState.reset },
      derivation: {
        physicalDepth: 'mappedDepth / supportGeometry.jacobian',
        signedMargin: 'physicalDepthMeters - effectiveDryDepthMeters',
        hysteresis: 'schmitt-trigger-v1',
      },
      complete: true,
    },
    physicalMaterial: copyPhysicalMaterial(descriptor.physicalMaterial),
    confidence: 1,
    dirtyRegions: terrainFrame.dirtyRegions.map(region => ({ ...region })),
    complete: true,
  };
  return validatePortableMacroSourceSnapshot(snapshot, {
    expectedSourceHandleId: descriptor.sourceHandleId,
    minimumTerrainEpoch: descriptor.lifetime.retainedTerrainEpoch,
    minimumFluidEpoch: descriptor.lifetime.retainedFluidEpoch,
  });
}

export function createMappedMacroRuntime(options = {}) {
  let terrainFrame = validateTerrainFluidFrame(options.terrainFrame);
  let state = createMappedMacroState(options);
  const boundaryThresholds = wetBoundaryThresholds(options);
  let wetBoundaryState = updateWetBoundaryState(null, state, terrainFrame, boundaryThresholds);
  const producerRevision = options.producerRevision;
  invariant(typeof producerRevision === 'string' && producerRevision.length > 0, 'producerRevision must be a non-empty string');
  const receiptIds = [];
  const lineageIds = [];
  const portableSourceHandles = new Map();

  function updateTerrain(updateOptions = {}) {
    const nextTerrain = validateTerrainFluidFrame(updateOptions.terrainFrame);
    const result = remapMappedMacroState(state, terrainFrame, nextTerrain, {
      ...updateOptions,
      predecessorReceiptIds: receiptIds,
      lineageIds,
    });
    state = result.state;
    terrainFrame = nextTerrain;
    receiptIds.push(result.receipt.receiptId);
    wetBoundaryState = updateWetBoundaryState(
      wetBoundaryState,
      state,
      terrainFrame,
      boundaryThresholds,
      {
        kind: result.receipt.mode,
        previousTerrainEpoch: result.receipt.previousTerrainEpoch,
        remapReceiptId: result.receipt.receiptId,
      },
    );
    return result.receipt;
  }

  const api = {
    get identity() {
      return {
        schema: 'kaminos.fluid.mapped-macro-runtime-identity.v1',
        route: MAPPED_MACRO_SOLVER_ROUTE,
        method: MAPPED_MACRO_METHOD,
        producerRevision,
        terrainEpoch: terrainFrame.currentEpoch,
        fluidEpoch: state.fluidEpoch,
      };
    },
    snapshot() {
      return cloneState(state, terrainFrame);
    },
    updateTerrain,
    step(stepOptions = {}) {
      if (stepOptions.dryTolerance != null) {
        invariant(
          stepOptions.dryTolerance === boundaryThresholds.effectiveDryDepthMeters,
          `runtime dryTolerance ${stepOptions.dryTolerance} disagrees with retained wet-boundary threshold ${boundaryThresholds.effectiveDryDepthMeters}`,
        );
      }
      const nextTerrain = validateTerrainFluidFrame(stepOptions.terrainFrame ?? terrainFrame);
      let terrainRemapReceipt = null;
      if (nextTerrain.currentEpoch > terrainFrame.currentEpoch) {
        terrainRemapReceipt = updateTerrain({
          ...(stepOptions.remap ?? stepOptions),
          terrainFrame: nextTerrain,
          mode: nextTerrain.motionClass,
        });
      } else {
        invariant(nextTerrain.currentEpoch === terrainFrame.currentEpoch, `runtime rejected stale terrain epoch ${nextTerrain.currentEpoch}`);
        validateSameEpochTerrain(terrainFrame, nextTerrain);
      }
      const result = advanceMappedMacroState(state, terrainFrame, {
        ...stepOptions,
        dryTolerance: boundaryThresholds.effectiveDryDepthMeters,
      });
      state = result.state;
      wetBoundaryState = updateWetBoundaryState(
        wetBoundaryState,
        state,
        terrainFrame,
        boundaryThresholds,
      );
      return terrainRemapReceipt == null
        ? result.receipt
        : { ...result.receipt, terrainRemapReceipt };
    },
    depositLocal(depositOptions = {}) {
      const result = depositLocalToMacro(state, terrainFrame, depositOptions);
      state = result.state;
      receiptIds.push(result.receipt.transactionId);
      if (!lineageIds.includes(result.receipt.lineageId)) lineageIds.push(result.receipt.lineageId);
      wetBoundaryState = updateWetBoundaryState(
        wetBoundaryState,
        state,
        terrainFrame,
        boundaryThresholds,
      );
      return result.receipt;
    },
    feedback(frameOptions = {}) {
      return createMacroFluidTerrainFeedbackFrame(state, terrainFrame, {
        ...frameOptions,
        producerRevision,
        conservationReceiptIds: frameOptions.conservationReceiptIds ?? receiptIds,
        lineageIds: frameOptions.lineageIds ?? lineageIds,
      });
    },
    representation(frameOptions = {}) {
      return createMacroFluidRepresentationFrame(state, terrainFrame, {
        ...frameOptions,
        producerRevision,
        conservationReceiptIds: frameOptions.conservationReceiptIds ?? receiptIds,
        lineageIds: frameOptions.lineageIds ?? lineageIds,
      });
    },
    retainPortableMacroSource(sourceOptions = {}) {
      const sourceHandleId = sourceOptions.sourceHandleId;
      try {
        for (const forbidden of ['camera', 'view', 'projection', 'viewport', 'screenSpaceDemand', 'opticalResidency']) {
          invariant(!(forbidden in sourceOptions), `portable source retain contains camera-owned state: ${forbidden}`);
        }
        nonEmptyString(sourceHandleId, 'sourceHandleId');
        const route = {
          requested: sourceOptions.requestedRoute ?? PORTABLE_MACRO_SOURCE_ROUTE,
          effective: sourceOptions.effectiveRoute ?? sourceOptions.requestedRoute ?? PORTABLE_MACRO_SOURCE_ROUTE,
        };
        validateExactPortableRoute(route);
        const requestedCapability = sourceOptions.requestedCapability ?? PORTABLE_MACRO_SOURCE_CAPABILITY;
        const effectiveCapability = sourceOptions.effectiveCapability ?? requestedCapability;
        validatePortableCapability(requestedCapability, effectiveCapability);
        invariant(!portableSourceHandles.has(sourceHandleId), `portable source handle ${sourceHandleId} is already retained`);
        validateState(state, terrainFrame);
        validateSupportWorldPositions(terrainFrame);
        const physicalMaterial = validatePhysicalMaterial(sourceOptions.physicalMaterial ?? {
          densityKgM3: 997,
          dynamicViscosityPaS: 0.00089,
          absorptionPerMeter: [0.05, 0.02, 0.01],
        });
        const descriptor = freezeRecord({
          schema: PORTABLE_MACRO_SOURCE_HANDLE_SCHEMA,
          route,
          requestedCapability,
          effectiveCapability,
          capability: effectiveCapability,
          sourceHandleId,
          sourceAuthority: 'live_runtime',
          fallbackStatus: 'none',
          representationRoute: {
            requested: 'kaminos/fluid/representation-frame',
            effective: 'kaminos/fluid/representation-frame',
          },
          producer: {
            revision: producerRevision,
            runtimeRoute: MAPPED_MACRO_SOLVER_ROUTE,
            method: MAPPED_MACRO_METHOD,
          },
          ownershipIdentity: REPRESENTATION_OWNERSHIP_IDENTITY,
          supportGeometry: {
            topologyId: `${terrainFrame.terrainId}:${terrainFrame.transformId}:${terrainFrame.grid.width}x${terrainFrame.grid.height}`,
            terrainId: terrainFrame.terrainId,
            supportClass: terrainFrame.supportClass,
            transformId: terrainFrame.transformId,
            coordinateSpace: 'world_meters',
            worldMetersPerUnit: terrainFrame.worldMetersPerUnit,
            mapping: 'explicit-world-position-buffer-v1',
            positionSource: 'terrain-fluid-frame.fields.worldPosition',
            sampleCount: terrainFrame.grid.width * terrainFrame.grid.height,
          },
          wetBoundary: {
            schema: MACRO_WET_BOUNDARY_SCHEMA,
            route: {
              requested: MACRO_WET_BOUNDARY_ROUTE,
              effective: MACRO_WET_BOUNDARY_ROUTE,
            },
            sourceAuthority: 'live_runtime',
            fallbackStatus: 'none',
            effectiveDryDepthMeters: boundaryThresholds.effectiveDryDepthMeters,
            effectiveWetActivationDepthMeters: boundaryThresholds.effectiveWetActivationDepthMeters,
            hysteresis: 'schmitt-trigger-v1',
          },
          physicalMaterial: copyPhysicalMaterial(physicalMaterial),
          lifetime: {
            releasePolicy: 'explicit-release-v1',
            retainedTerrainEpoch: terrainFrame.currentEpoch,
            retainedFluidEpoch: state.fluidEpoch,
          },
        });
        validatePortableMacroSourceDescriptor(descriptor);
        let released = false;
        let readGeneration = 0;
        const handle = {
          descriptor,
          get status() {
            return {
              state: released ? 'released' : 'retained',
              readGeneration,
            };
          },
          read(readOptions = {}) {
            try {
              invariant(!released, `portable source handle ${sourceHandleId} has been released`);
              if (readOptions.minimumTerrainEpoch != null) {
                invariant(
                  terrainFrame.currentEpoch >= readOptions.minimumTerrainEpoch,
                  `portable source has stale terrain epoch ${terrainFrame.currentEpoch}; minimum ${readOptions.minimumTerrainEpoch}`,
                );
              }
              if (readOptions.minimumFluidEpoch != null) {
                invariant(
                  state.fluidEpoch >= readOptions.minimumFluidEpoch,
                  `portable source has stale fluid epoch ${state.fluidEpoch}; minimum ${readOptions.minimumFluidEpoch}`,
                );
              }
              const snapshot = createPortableMacroSourceSnapshot(
                state,
                terrainFrame,
                descriptor,
                wetBoundaryState,
              );
              readGeneration += 1;
              return snapshot;
            } catch (error) {
              throw portableSourceError(error, {
                phase: 'read-live-source',
                sourceHandleId,
                lastTrustworthyEvidence: released ? 'source-handle-released' : 'descriptor-validated',
              });
            }
          },
          release() {
            if (released) return false;
            released = true;
            portableSourceHandles.delete(sourceHandleId);
            return true;
          },
        };
        Object.freeze(handle);
        portableSourceHandles.set(sourceHandleId, handle);
        return validatePortableMacroSourceHandle(handle);
      } catch (error) {
        if (error?.report) throw error;
        throw portableSourceError(error, {
          phase: 'retain-source',
          sourceHandleId,
          lastTrustworthyEvidence: 'runtime-identity-validated',
        });
      }
    },
  };
  return api;
}

export const createKaminosFluidRuntime = createMappedMacroRuntime;
