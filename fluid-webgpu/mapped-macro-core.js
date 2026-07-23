import {
  createFluidExchangeReceipt,
  createFluidRepresentationFrame,
  createFluidTerrainFeedbackFrame,
  REPRESENTATION_OWNERSHIP_IDENTITY,
  validateFluidExchangeReceipt,
  validateFluidRepresentationFrame,
  validateFluidTerrainFeedbackFrame,
  validateTerrainFluidFrame,
} from '@kaminos/fluid-contracts';

export const MAPPED_MACRO_STATE_SCHEMA = 'kaminos.fluid.mapped-macro-state.v1';
export const MAPPED_MACRO_SOLVER_ROUTE = 'kaminos/fluid/mapped-orthogonal-heightfield-hll-reference-v1';
export const MAPPED_MACRO_METHOD = 'orthogonal-heightfield-hydrostatic-reconstruction-hll-v1';

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
  invariant(previousTerrainFrame.grid.width === terrainFrame.grid.width && previousTerrainFrame.grid.height === terrainFrame.grid.height, 'terrain remap grid topology mismatch');
  invariant(terrainFrame.currentEpoch > previousTerrainFrame.currentEpoch, 'terrain remap requires a newer epoch');
  const mode = options.mode ?? terrainFrame.motionClass;
  invariant(mode === 'ordinary_morph', `mapped macro reference currently supports ordinary_morph remap, received ${mode}`);
  const next = {
    ...cloneState(state, previousTerrainFrame),
    terrainEpoch: terrainFrame.currentEpoch,
  };
  if (next.referenceFreeSurface) {
    for (let index = 0; index < next.referenceFreeSurface.length; index += 1) {
      next.referenceFreeSurface[index] += terrainFrame.fields.bedHeight[index] - previousTerrainFrame.fields.bedHeight[index];
    }
  }
  return {
    state: next,
    receipt: {
      schema: 'kaminos.fluid.terrain-remap-receipt.v1',
      mode,
      previousTerrainEpoch: previousTerrainFrame.currentEpoch,
      terrainEpoch: terrainFrame.currentEpoch,
      displacedVolume: 0,
      volumeResidual: 0,
      supportWork: 0,
    },
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
    step(stepOptions = {}) {
      const nextTerrain = validateTerrainFluidFrame(stepOptions.terrainFrame ?? terrainFrame);
      if (nextTerrain.currentEpoch > terrainFrame.currentEpoch) {
        state = remapMappedMacroState(state, terrainFrame, nextTerrain, { mode: nextTerrain.motionClass }).state;
        terrainFrame = nextTerrain;
      } else {
        invariant(nextTerrain.currentEpoch === terrainFrame.currentEpoch, `runtime rejected stale terrain epoch ${nextTerrain.currentEpoch}`);
        terrainFrame = nextTerrain;
      }
      const result = advanceMappedMacroState(state, terrainFrame, stepOptions);
      state = result.state;
      return result.receipt;
    },
    depositLocal(depositOptions = {}) {
      const result = depositLocalToMacro(state, terrainFrame, depositOptions);
      state = result.state;
      receiptIds.push(result.receipt.transactionId);
      return result.receipt;
    },
    feedback(frameOptions = {}) {
      return createMacroFluidTerrainFeedbackFrame(state, terrainFrame, {
        ...frameOptions,
        producerRevision,
        conservationReceiptIds: frameOptions.conservationReceiptIds ?? receiptIds,
      });
    },
    representation(frameOptions = {}) {
      return createMacroFluidRepresentationFrame(state, terrainFrame, {
        ...frameOptions,
        producerRevision,
      });
    },
  };
  return api;
}
