export const TERRAIN_FLUID_FRAME_SCHEMA = 'kaminos.fluid.terrain-fluid-frame.v1';
export const FLUID_TERRAIN_FEEDBACK_FRAME_SCHEMA = 'kaminos.fluid.terrain-feedback-frame.v1';
export const FLUID_REPRESENTATION_FRAME_SCHEMA = 'kaminos.fluid.representation-frame.v1';
export const FLUID_EXCHANGE_RECEIPT_SCHEMA = 'kaminos.fluid.exchange-receipt.v1';
export const REPRESENTATION_OWNERSHIP_LEDGER_SCHEMA = 'kaminos.fluid.ownership-ledger.v1';
export const REPRESENTATION_OWNERSHIP_IDENTITY = 'macro-local-parcel-exclusive-v1';

const MOTION_CLASSES = new Set(['stable', 'ordinary_morph', 'phase_morph', 'shock_reset']);
const REPRESENTATIONS = new Set(['macro', 'local', 'parcel']);
const RECEIPT_STATES = new Set(['requested', 'staged', 'committed', 'rejected']);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function string(value, label) {
  invariant(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function finite(value, label) {
  const number = Number(value);
  invariant(Number.isFinite(number), `${label} must be finite`);
  return number;
}

function nonNegative(value, label) {
  const number = finite(value, label);
  invariant(number >= 0, `${label} must be non-negative`);
  return number;
}

function integer(value, label) {
  const number = finite(value, label);
  invariant(Number.isInteger(number), `${label} must be an integer`);
  return number;
}

function vector(value, length, label) {
  invariant(value != null && typeof value.length === 'number' && value.length === length, `${label} must contain ${length} values`);
  const result = Array.from(value, (entry, index) => finite(entry, `${label}[${index}]`));
  return result;
}

function numericArray(value, length, label) {
  invariant(ArrayBuffer.isView(value) && !(value instanceof DataView), `${label} must be a typed array`);
  invariant(value.length === length, `${label} length ${value.length} does not match expected ${length}`);
  for (let index = 0; index < value.length; index += 1) finite(value[index], `${label}[${index}]`);
  return value;
}

function nonNegativeArray(value, length, label) {
  numericArray(value, length, label);
  for (let index = 0; index < value.length; index += 1) {
    invariant(value[index] >= 0, `${label}[${index}] must be non-negative`);
  }
  return value;
}

function identityRoute(requested, effective, label) {
  return {
    requested: string(requested, `requested ${label}`),
    effective: string(effective, `effective ${label}`),
  };
}

function validateRoute(route, expectedRoute, label = 'route') {
  invariant(route && typeof route === 'object', `${label} identity is required`);
  string(route.requested, `requested ${label}`);
  string(route.effective, `effective ${label}`);
  invariant(route.requested === route.effective, `effective ${label} mismatch: requested ${route.requested}, received ${route.effective}`);
  if (expectedRoute != null) invariant(route.effective === expectedRoute, `effective ${label} mismatch: expected ${expectedRoute}, received ${route.effective}`);
}

function gridShape(grid) {
  invariant(grid && typeof grid === 'object', 'grid is required');
  const width = integer(grid.width, 'grid.width');
  const height = integer(grid.height, 'grid.height');
  invariant(width > 0 && height > 0, 'grid dimensions must be positive');
  const spacing = vector(grid.spacing, 2, 'grid.spacing');
  invariant(spacing[0] > 0 && spacing[1] > 0, 'grid spacing must be positive');
  return {
    width,
    height,
    spacing,
    origin: vector(grid.origin, 3, 'grid.origin'),
    sampleCount: width * height,
  };
}

export function createTerrainFluidFrame(options = {}) {
  const grid = gridShape(options.grid);
  return {
    schema: TERRAIN_FLUID_FRAME_SCHEMA,
    route: identityRoute(options.requestedRoute, options.effectiveRoute, 'route'),
    producer: {
      id: string(options.producerId, 'producerId'),
      revision: string(options.producerRevision, 'producerRevision'),
    },
    source: identityRoute(options.requestedSourceId, options.effectiveSourceId, 'source'),
    worldMetersPerUnit: finite(options.worldMetersPerUnit, 'worldMetersPerUnit'),
    gravity: vector(options.gravity, 3, 'gravity'),
    terrainId: string(options.terrainId, 'terrainId'),
    supportClass: string(options.supportClass, 'supportClass'),
    transformId: string(options.transformId, 'transformId'),
    priorEpoch: integer(options.priorEpoch, 'priorEpoch'),
    currentEpoch: integer(options.currentEpoch, 'currentEpoch'),
    motionClass: string(options.motionClass, 'motionClass'),
    shockId: options.shockId == null ? null : string(options.shockId, 'shockId'),
    grid: { width: grid.width, height: grid.height, spacing: grid.spacing, origin: grid.origin },
    fields: options.fields,
    dirtyRegions: Array.isArray(options.dirtyRegions) ? options.dirtyRegions.map(region => ({ ...region })) : [],
    minimumFilteredSupportScale: options.minimumFilteredSupportScale == null ? null : nonNegative(options.minimumFilteredSupportScale, 'minimumFilteredSupportScale'),
    motionSubstepEnvelope: options.motionSubstepEnvelope == null ? null : nonNegative(options.motionSubstepEnvelope, 'motionSubstepEnvelope'),
    complete: options.complete === true,
    expectedSampleCount: grid.sampleCount,
    actualSampleCount: options.fields?.bedHeight?.length ?? 0,
  };
}

export function validateTerrainFluidFrame(frame, expectations = {}) {
  invariant(frame?.schema === TERRAIN_FLUID_FRAME_SCHEMA, `terrain frame schema mismatch: ${frame?.schema}`);
  validateRoute(frame.route, expectations.expectedRoute);
  validateRoute(frame.source, expectations.expectedSourceId, 'source');
  string(frame.producer?.id, 'producer.id');
  string(frame.producer?.revision, 'producer.revision');
  invariant(frame.worldMetersPerUnit > 0 && Number.isFinite(frame.worldMetersPerUnit), 'worldMetersPerUnit must be positive');
  vector(frame.gravity, 3, 'gravity');
  string(frame.terrainId, 'terrainId');
  string(frame.supportClass, 'supportClass');
  string(frame.transformId, 'transformId');
  integer(frame.priorEpoch, 'priorEpoch');
  integer(frame.currentEpoch, 'currentEpoch');
  invariant(frame.currentEpoch >= frame.priorEpoch, 'current epoch precedes prior epoch');
  if (expectations.minimumEpoch != null) invariant(frame.currentEpoch >= expectations.minimumEpoch, `terrain frame epoch ${frame.currentEpoch} is stale; minimum ${expectations.minimumEpoch}`);
  invariant(MOTION_CLASSES.has(frame.motionClass), `unsupported terrain motion class: ${frame.motionClass}`);
  if (frame.motionClass === 'shock_reset') string(frame.shockId, 'shockId');
  invariant(frame.complete === true, 'terrain frame is incomplete');
  const grid = gridShape(frame.grid);
  invariant(frame.expectedSampleCount === grid.sampleCount, 'terrain frame expected sample count mismatch');
  const fields = frame.fields;
  invariant(fields && typeof fields === 'object', 'terrain fields are required');
  numericArray(fields.bedHeight, grid.sampleCount, 'bedHeight');
  invariant(frame.actualSampleCount === grid.sampleCount, 'terrain frame actual sample count mismatch');
  numericArray(fields.jacobian, grid.sampleCount, 'jacobian');
  numericArray(fields.gradient, grid.sampleCount * 2, 'gradient');
  numericArray(fields.tangentU, grid.sampleCount * 3, 'tangentU');
  numericArray(fields.tangentV, grid.sampleCount * 3, 'tangentV');
  numericArray(fields.normal, grid.sampleCount * 3, 'normal');
  numericArray(fields.supportVelocity, grid.sampleCount * 3, 'supportVelocity');
  numericArray(fields.valid, grid.sampleCount, 'valid');
  for (let index = 0; index < grid.sampleCount; index += 1) {
    invariant(fields.jacobian[index] > 0, `jacobian[${index}] must be positive`);
    invariant(fields.valid[index] === 1, `terrain sample ${index} is invalid`);
  }
  return frame;
}

export function createRepresentationOwnershipLedger(options = {}) {
  const initialVolume = nonNegative(options.initialVolume, 'initialVolume');
  const externalSources = nonNegative(options.externalSources ?? 0, 'externalSources');
  const externalSinks = nonNegative(options.externalSinks ?? 0, 'externalSinks');
  const macroVolume = nonNegative(options.macroVolume ?? 0, 'macroVolume');
  const localVolume = nonNegative(options.localVolume ?? 0, 'localVolume');
  const parcelVolume = nonNegative(options.parcelVolume ?? 0, 'parcelVolume');
  return {
    schema: REPRESENTATION_OWNERSHIP_LEDGER_SCHEMA,
    identity: REPRESENTATION_OWNERSHIP_IDENTITY,
    fluidEpoch: integer(options.fluidEpoch, 'fluidEpoch'),
    terrainEpoch: integer(options.terrainEpoch, 'terrainEpoch'),
    initialVolume,
    externalSources,
    externalSinks,
    macroVolume,
    localVolume,
    parcelVolume,
    residual: initialVolume + externalSources - externalSinks - macroVolume - localVolume - parcelVolume,
    tolerance: nonNegative(options.tolerance ?? 1e-9, 'tolerance'),
  };
}

export function validateRepresentationOwnershipLedger(ledger) {
  invariant(ledger?.schema === REPRESENTATION_OWNERSHIP_LEDGER_SCHEMA, 'ownership ledger schema mismatch');
  invariant(ledger.identity === REPRESENTATION_OWNERSHIP_IDENTITY, 'ownership ledger identity mismatch');
  const recomputed = finite(ledger.initialVolume, 'initialVolume')
    + finite(ledger.externalSources, 'externalSources')
    - finite(ledger.externalSinks, 'externalSinks')
    - finite(ledger.macroVolume, 'macroVolume')
    - finite(ledger.localVolume, 'localVolume')
    - finite(ledger.parcelVolume, 'parcelVolume');
  const tolerance = nonNegative(ledger.tolerance, 'tolerance');
  invariant(Math.abs(recomputed) <= tolerance, `ownership residual exceeds tolerance: ${recomputed}`);
  return { ...ledger, residual: recomputed };
}

function materialMap(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [string(key, `${label} key`), nonNegative(entry, `${label}.${key}`)]));
}

export function createFluidExchangeReceipt(options = {}) {
  const debitedMomentum = vector(options.debitedMomentum, 3, 'debitedMomentum');
  const creditedMomentum = vector(options.creditedMomentum, 3, 'creditedMomentum');
  const debitedMaterials = materialMap(options.debitedMaterials ?? {}, 'debitedMaterials');
  const creditedMaterials = materialMap(options.creditedMaterials ?? {}, 'creditedMaterials');
  const materialKeys = new Set([...Object.keys(debitedMaterials), ...Object.keys(creditedMaterials)]);
  return {
    schema: FLUID_EXCHANGE_RECEIPT_SCHEMA,
    transactionId: string(options.transactionId, 'transactionId'),
    lineageId: string(options.lineageId, 'lineageId'),
    sourceRepresentation: string(options.sourceRepresentation, 'sourceRepresentation'),
    destinationRepresentation: string(options.destinationRepresentation, 'destinationRepresentation'),
    terrainEpoch: integer(options.terrainEpoch, 'terrainEpoch'),
    fluidEpoch: integer(options.fluidEpoch, 'fluidEpoch'),
    allocationGeneration: integer(options.allocationGeneration, 'allocationGeneration'),
    supportId: string(options.supportId, 'supportId'),
    transformId: string(options.transformId, 'transformId'),
    debitedVolume: nonNegative(options.debitedVolume, 'debitedVolume'),
    creditedVolume: nonNegative(options.creditedVolume, 'creditedVolume'),
    debitedMomentum,
    creditedMomentum,
    debitedMaterials,
    creditedMaterials,
    residual: {
      volume: options.debitedVolume - options.creditedVolume,
      momentum: debitedMomentum.map((value, index) => value - creditedMomentum[index]),
      materials: Object.fromEntries(Array.from(materialKeys, key => [key, (debitedMaterials[key] ?? 0) - (creditedMaterials[key] ?? 0)])),
    },
    tolerance: nonNegative(options.tolerance ?? 1e-9, 'tolerance'),
    state: string(options.state, 'state'),
  };
}

export function validateFluidExchangeReceipt(receipt) {
  invariant(receipt?.schema === FLUID_EXCHANGE_RECEIPT_SCHEMA, 'exchange receipt schema mismatch');
  string(receipt.transactionId, 'transactionId');
  string(receipt.lineageId, 'lineageId');
  const terrainEpoch = integer(receipt.terrainEpoch, 'terrainEpoch');
  const fluidEpoch = integer(receipt.fluidEpoch, 'fluidEpoch');
  const allocationGeneration = integer(receipt.allocationGeneration, 'allocationGeneration');
  invariant(terrainEpoch >= 0, 'terrainEpoch must be non-negative');
  invariant(fluidEpoch >= 0, 'fluidEpoch must be non-negative');
  invariant(allocationGeneration >= 0, 'allocationGeneration must be non-negative');
  string(receipt.supportId, 'supportId');
  string(receipt.transformId, 'transformId');
  invariant(REPRESENTATIONS.has(receipt.sourceRepresentation), `invalid source representation: ${receipt.sourceRepresentation}`);
  invariant(REPRESENTATIONS.has(receipt.destinationRepresentation), `invalid destination representation: ${receipt.destinationRepresentation}`);
  invariant(receipt.sourceRepresentation !== receipt.destinationRepresentation, 'exchange source and destination must differ');
  invariant(RECEIPT_STATES.has(receipt.state), `invalid exchange receipt state: ${receipt.state}`);
  const tolerance = nonNegative(receipt.tolerance, 'tolerance');
  const volumeResidual = finite(receipt.debitedVolume, 'debitedVolume') - finite(receipt.creditedVolume, 'creditedVolume');
  const debitedMomentum = vector(receipt.debitedMomentum, 3, 'debitedMomentum');
  const creditedMomentum = vector(receipt.creditedMomentum, 3, 'creditedMomentum');
  const momentumResidual = debitedMomentum.map((value, index) => value - creditedMomentum[index]);
  const debitedMaterials = materialMap(receipt.debitedMaterials, 'debitedMaterials');
  const creditedMaterials = materialMap(receipt.creditedMaterials, 'creditedMaterials');
  const materialKeys = new Set([...Object.keys(debitedMaterials), ...Object.keys(creditedMaterials)]);
  const materialsResidual = Object.fromEntries(Array.from(materialKeys, key => [key, (debitedMaterials[key] ?? 0) - (creditedMaterials[key] ?? 0)]));
  if (receipt.state === 'committed') {
    invariant(Math.abs(volumeResidual) <= tolerance, `volume residual exceeds tolerance: ${volumeResidual}`);
    invariant(momentumResidual.every(value => Math.abs(value) <= tolerance), `momentum residual exceeds tolerance: ${momentumResidual.join(',')}`);
    invariant(Object.values(materialsResidual).every(value => Math.abs(value) <= tolerance), 'material residual exceeds tolerance');
  }
  return { ...receipt, residual: { volume: volumeResidual, momentum: momentumResidual, materials: materialsResidual } };
}

function createOutputFrame(schema, options) {
  const grid = gridShape(options.grid);
  return {
    schema,
    route: identityRoute(options.requestedRoute, options.effectiveRoute, 'route'),
    producerRevision: string(options.producerRevision, 'producerRevision'),
    fluidEpoch: integer(options.fluidEpoch, 'fluidEpoch'),
    terrainEpoch: integer(options.terrainEpoch, 'terrainEpoch'),
    grid: { width: grid.width, height: grid.height, spacing: grid.spacing, origin: grid.origin },
    dirtyRegions: Array.isArray(options.dirtyRegions) ? options.dirtyRegions.map(region => ({ ...region })) : [],
    complete: options.complete === true,
    expectedSampleCount: grid.sampleCount,
  };
}

function validateOutputFrame(frame, schema, expectations = {}, label = 'output frame') {
  invariant(frame?.schema === schema, `${label} schema mismatch`);
  validateRoute(frame.route, expectations.expectedRoute);
  string(frame.producerRevision, 'producerRevision');
  const fluidEpoch = integer(frame.fluidEpoch, 'fluidEpoch');
  const terrainEpoch = integer(frame.terrainEpoch, 'terrainEpoch');
  invariant(fluidEpoch >= 0, 'fluidEpoch must be non-negative');
  invariant(terrainEpoch >= 0, 'terrainEpoch must be non-negative');
  invariant(frame.complete === true, `${label} is incomplete`);
  const grid = gridShape(frame.grid);
  invariant(frame.expectedSampleCount === grid.sampleCount, `${label} expected sample count mismatch`);
  if (expectations.expectedTerrainEpoch != null) {
    invariant(frame.terrainEpoch === expectations.expectedTerrainEpoch, `${label} epoch mismatch: expected ${expectations.expectedTerrainEpoch}, received ${frame.terrainEpoch}`);
  }
  return grid;
}

export function createFluidTerrainFeedbackFrame(options = {}) {
  return {
    ...createOutputFrame(FLUID_TERRAIN_FEEDBACK_FRAME_SCHEMA, options),
    representationIdentity: string(options.representationIdentity, 'representationIdentity'),
    fields: options.fields,
    conservationReceiptIds: Array.isArray(options.conservationReceiptIds) ? options.conservationReceiptIds.map((id, index) => string(id, `conservationReceiptIds[${index}]`)) : [],
  };
}

export function validateFluidTerrainFeedbackFrame(frame, expectations = {}) {
  const grid = validateOutputFrame(frame, FLUID_TERRAIN_FEEDBACK_FRAME_SCHEMA, expectations, 'terrain feedback frame');
  invariant(frame.representationIdentity === REPRESENTATION_OWNERSHIP_IDENTITY, 'terrain feedback representation identity mismatch');
  nonNegativeArray(frame.fields?.depth, grid.sampleCount, 'depth');
  numericArray(frame.fields?.wetness, grid.sampleCount, 'wetness');
  numericArray(frame.fields?.tangentMomentum, grid.sampleCount * 2, 'tangentMomentum');
  for (let index = 0; index < frame.fields.wetness.length; index += 1) {
    invariant(frame.fields.wetness[index] >= 0 && frame.fields.wetness[index] <= 1, `wetness[${index}] must be in [0, 1]`);
  }
  invariant(Array.isArray(frame.conservationReceiptIds), 'conservationReceiptIds must be an array');
  frame.conservationReceiptIds.forEach((id, index) => string(id, `conservationReceiptIds[${index}]`));
  return frame;
}

export function createFluidRepresentationFrame(options = {}) {
  return {
    ...createOutputFrame(FLUID_REPRESENTATION_FRAME_SCHEMA, {
      ...options,
      grid: options.macro?.grid,
      dirtyRegions: options.dirtyRegions ?? [],
    }),
    ownershipIdentity: string(options.ownershipIdentity, 'ownershipIdentity'),
    macro: options.macro,
    local: options.local,
    parcels: options.parcels,
    physicalMaterial: options.physicalMaterial,
  };
}

export function validateFluidRepresentationFrame(frame, expectations = {}) {
  const outputGrid = validateOutputFrame(frame, FLUID_REPRESENTATION_FRAME_SCHEMA, expectations, 'fluid representation frame');
  for (const forbidden of ['camera', 'view', 'projection', 'viewport', 'screenSpaceDemand']) {
    invariant(!(forbidden in frame), `fluid representation frame contains camera-owned state: ${forbidden}`);
  }
  invariant(frame.ownershipIdentity === REPRESENTATION_OWNERSHIP_IDENTITY, 'representation ownership identity mismatch');
  const grid = gridShape(frame.macro?.grid);
  invariant(grid.width === outputGrid.width && grid.height === outputGrid.height, 'macro grid dimensions do not match output grid');
  invariant(grid.spacing.every((value, index) => value === outputGrid.spacing[index]), 'macro grid spacing does not match output grid');
  invariant(grid.origin.every((value, index) => value === outputGrid.origin[index]), 'macro grid origin does not match output grid');
  string(frame.macro?.method, 'macro.method');
  nonNegativeArray(frame.macro?.mappedDepth, grid.sampleCount, 'macro.mappedDepth');
  numericArray(frame.macro?.mappedMomentumU, grid.sampleCount, 'macro.mappedMomentumU');
  numericArray(frame.macro?.mappedMomentumV, grid.sampleCount, 'macro.mappedMomentumV');
  invariant(frame.macro?.materialMasses && typeof frame.macro.materialMasses === 'object' && !Array.isArray(frame.macro.materialMasses), 'macro.materialMasses must be an object');
  for (const [key, values] of Object.entries(frame.macro.materialMasses)) {
    nonNegativeArray(values, grid.sampleCount, `macro.materialMasses.${string(key, 'macro.materialMasses key')}`);
  }
  invariant(frame.local && Number.isInteger(frame.local.count) && frame.local.count >= 0, 'local representation count is invalid');
  invariant(frame.parcels && Number.isInteger(frame.parcels.count) && frame.parcels.count >= 0, 'parcel representation count is invalid');
  invariant(frame.physicalMaterial && typeof frame.physicalMaterial === 'object', 'physical material descriptor is required');
  invariant(finite(frame.physicalMaterial.densityKgM3, 'physicalMaterial.densityKgM3') > 0, 'physicalMaterial.densityKgM3 must be positive');
  if (frame.physicalMaterial.dynamicViscosityPaS != null) nonNegative(frame.physicalMaterial.dynamicViscosityPaS, 'physicalMaterial.dynamicViscosityPaS');
  const absorption = vector(frame.physicalMaterial.absorptionPerMeter, 3, 'physicalMaterial.absorptionPerMeter');
  invariant(absorption.every(value => value >= 0), 'physicalMaterial.absorptionPerMeter must be non-negative');
  return frame;
}
