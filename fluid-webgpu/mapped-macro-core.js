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

const KAMINOS_FLUID_PACKAGE_VERSION = '0.2.0';
const KAMINOS_FLUID_PRODUCER_REVISION = 'a5662f6268a17dbeb35991f8c37ceef834be9629';

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
    ].every(field => sameVector(terrainFrame.fields[field], previousTerrainFrame.fields[field], 0));
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

export function createMappedMacroRuntime(options = {}) {
  let terrainFrame = validateTerrainFluidFrame(options.terrainFrame);
  let state = createMappedMacroState(options);
  const producerRevision = options.producerRevision;
  invariant(typeof producerRevision === 'string' && producerRevision.length > 0, 'producerRevision must be a non-empty string');
  const receiptIds = [];
  const lineageIds = [];

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
      const result = advanceMappedMacroState(state, terrainFrame, stepOptions);
      state = result.state;
      return terrainRemapReceipt == null
        ? result.receipt
        : { ...result.receipt, terrainRemapReceipt };
    },
    depositLocal(depositOptions = {}) {
      const result = depositLocalToMacro(state, terrainFrame, depositOptions);
      state = result.state;
      receiptIds.push(result.receipt.transactionId);
      if (!lineageIds.includes(result.receipt.lineageId)) lineageIds.push(result.receipt.lineageId);
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
  };
  return api;
}

export const createKaminosFluidRuntime = createMappedMacroRuntime;
