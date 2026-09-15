export const LIQUID_FIRE_CONTACT_CONSUMER_SCHEMA = 'kaminos.pyro-liquid-contact-consumer.v0';
export const LIQUID_FIRE_CONTACT_SOURCE_SCHEMA = 'kaminos.liquid-fire-contact-descriptor.v1';
export const LIQUID_FIRE_CONTACT_SOURCE_PACKING = 'gpu-sparse-liquid-fire-contact-source-vec4x8-v1';
export const LIQUID_FIRE_CONTACT_RECEIVER_TRANSFORM_ID = 'shared-world-unit-cube-to-pyro-near-domain-v0';
export const LIQUID_FIRE_CONTACT_ACCUMULATION_LAYOUT = 'atomic-u32-wetness-heat-flame-vapor-per-near-cell-v0';
export const LIQUID_FIRE_CONTACT_MAGIC = 0x4b4c4643;
export const LIQUID_FIRE_CONTACT_VERSION = 1;
export const LIQUID_FIRE_CONTACT_FIXED_POINT_SCALE = 65536;
export const LIQUID_FIRE_SOURCE_STATE_MODEL = 'recoverable-wetness-thermal-ignition-v0';
export const LIQUID_FIRE_SOURCE_REIGNITION_POLICY = 'manual-reignition-v0';
export const LIQUID_FIRE_SOURCE_STATE_WORDS = 5;
export const LIQUID_FIRE_CONTACT_STATS_WORDS = 21;

function nonnegativeInteger(value, label) {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) throw new Error(`${label} must be a nonnegative integer`);
  return integer;
}

export function validateLiquidFireContactSourceDescriptor(descriptor, {
  device,
  expectedGeneration = null,
  expectedEpoch = null,
} = {}) {
  if (!descriptor || typeof descriptor !== 'object') throw new Error('Liquid fire contact descriptor is required');
  if (descriptor.schema !== LIQUID_FIRE_CONTACT_SOURCE_SCHEMA) throw new Error('Liquid fire contact descriptor schema mismatch');
  if (descriptor.packing !== LIQUID_FIRE_CONTACT_SOURCE_PACKING) throw new Error('Liquid fire contact descriptor packing mismatch');
  if (!device || descriptor.device !== device) throw new Error('Liquid fire contact descriptor must use the same GPUDevice as Pyro');
  if (descriptor.queue !== device.queue) throw new Error('Liquid fire contact descriptor must use the same GPUQueue as Pyro');
  if (!descriptor.headerBuffer || !descriptor.recordsBuffer) throw new Error('Liquid fire contact descriptor GPU buffers are unavailable');
  if (descriptor.headerBytes !== 80 || descriptor.recordBytes !== 128 || descriptor.recordFloats !== 32) {
    throw new Error('Liquid fire contact descriptor byte layout mismatch');
  }
  const capacity = nonnegativeInteger(descriptor.capacity, 'Liquid fire contact descriptor capacity');
  if (capacity < 1) throw new Error('Liquid fire contact descriptor must have positive capacity');
  const allocationGeneration = nonnegativeInteger(descriptor.allocationGeneration, 'Liquid fire contact allocation generation');
  const epoch = nonnegativeInteger(descriptor.epoch, 'Liquid fire contact epoch');
  if (expectedGeneration !== null && allocationGeneration !== nonnegativeInteger(expectedGeneration, 'Expected liquid fire contact generation')) {
    throw new Error(`Liquid fire contact generation mismatch: expected ${expectedGeneration}, received ${allocationGeneration}`);
  }
  if (expectedEpoch !== null && epoch !== nonnegativeInteger(expectedEpoch, 'Expected liquid fire contact epoch')) {
    throw new Error(`Liquid fire contact epoch mismatch: expected ${expectedEpoch}, received ${epoch}`);
  }
  if (!Number.isInteger(descriptor.sourceFrameHash) || descriptor.sourceFrameHash === 0 || typeof descriptor.sourceFrameId !== 'string' || descriptor.sourceFrameId.length === 0) {
    throw new Error('Liquid fire contact descriptor source frame identity is unavailable');
  }
  return descriptor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function stableFloat(value) {
  return Number(value.toFixed(8));
}

function smoothstep(minimum, maximum, value) {
  const t = clamp((value - minimum) / Math.max(1e-6, maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}

export function advanceLiquidFireSourceStateReference(state = {}, input = {}) {
  const contactWetness = clamp(input.contactWetness, 0, 1);
  const pilotEnabled = input.pilotEnabled === true;
  const previousWetness = clamp(state.wetness, 0, 1);
  const previousTemperature = clamp(state.temperature, 0, 1);
  const previousCombustion = clamp(state.combustion, 0, 1);
  const previousIgnited = clamp(state.ignited, 0, 1);
  const wetness = clamp(Math.max(previousWetness, contactWetness) * 0.997 - (0.0012 + previousTemperature * 0.0018), 0, 1);
  const heating = previousCombustion * 0.006 + (pilotEnabled ? 0.005 : 0);
  const cooling = wetness * (0.024 + previousTemperature * 0.014);
  const temperature = clamp(previousTemperature + heating - cooling - 0.0008, 0, 1);
  const wetSuppression = smoothstep(0.18, 0.68, wetness);
  const thermalSupport = smoothstep(0.24, 0.62, temperature);
  const ignitionAuthority = Math.max(previousIgnited, pilotEnabled ? 1 : 0);
  const combustionTarget = thermalSupport * (1 - wetSuppression) * ignitionAuthority;
  const response = combustionTarget < previousCombustion ? 0.020 : 0.028;
  const combustion = clamp(previousCombustion + (combustionTarget - previousCombustion) * response, 0, 1);
  const extinguished = combustion < 0.035 && temperature < 0.34;
  const ignited = pilotEnabled
    ? (wetness < 0.16 && temperature > 0.30 ? 1 : previousIgnited)
    : (previousIgnited > 0.5 && !extinguished ? 1 : 0);
  return {
    wetness: stableFloat(wetness),
    temperature: stableFloat(temperature),
    combustion: stableFloat(combustion),
    ignited,
  };
}

export function applyLiquidFireContactCellReference(cell, contact) {
  const wetness = clamp(contact?.wetness, 0, 2);
  const volume = clamp(contact?.volume, 0, 2);
  const removedHeat = stableFloat(Math.min(clamp(cell?.heat, 0, 4), wetness * 0.6));
  const removedFuel = stableFloat(Math.min(clamp(cell?.fuel, 0, 4), wetness * 0.3));
  const removedFlame = stableFloat(Math.min(clamp(cell?.flame, 0, 4), wetness * 0.75));
  const addedVapor = stableFloat(Math.min(1, wetness * volume));
  return {
    density: stableFloat(clamp(cell?.density, 0, 4) + addedVapor * 0.4),
    smoke: stableFloat(clamp(cell?.smoke, 0, 4) + addedVapor),
    heat: stableFloat(clamp(cell?.heat, 0, 4) - removedHeat),
    fuel: stableFloat(clamp(cell?.fuel, 0, 4) - removedFuel),
    flame: stableFloat(clamp(cell?.flame, 0, 4) - removedFlame),
    microSmoke: stableFloat(clamp(cell?.microSmoke, 0, 4) + addedVapor * 0.4),
    removedHeat,
    removedFuel,
    removedFlame,
    addedVapor,
  };
}

export function consumeLiquidFireContactTickReference(state = {}, source = {}) {
  const lastConsumedTick = nonnegativeInteger(state.lastConsumedTick || 0, 'Last consumed liquid fire contact tick');
  const writeTick = nonnegativeInteger(source.writeTick, 'Liquid fire contact write tick');
  const cell = { ...(state.cell || {}) };
  const evidence = {
    acceptedContacts: 0,
    rejectedContacts: 0,
    touchedCells: 0,
    removedHeat: 0,
    removedFuel: 0,
    removedFlame: 0,
    addedVapor: 0,
    sourceContactWetness: 0,
  };
  if (source.valid !== true) {
    return { ok: false, status: 'invalid-source-header', lastConsumedTick, cell, ...evidence };
  }
  if (writeTick <= lastConsumedTick) {
    return { ok: false, status: 'stale-source-tick', lastConsumedTick, cell, ...evidence };
  }
  if (!source.contact) {
    return { ok: false, status: 'fresh-no-exchange', lastConsumedTick: writeTick, cell, ...evidence };
  }
  const transfer = applyLiquidFireContactCellReference(cell, source.contact);
  const sourceContactWetness = source.contact.inSourceNeighborhood === true
    ? clamp(source.contact.wetness, 0, 1)
    : 0;
  const nextCell = {
    density: transfer.density,
    smoke: transfer.smoke,
    heat: transfer.heat,
    fuel: transfer.fuel,
    flame: transfer.flame,
    microSmoke: transfer.microSmoke,
  };
  return {
    ok: true,
    status: 'applied',
    lastConsumedTick: writeTick,
    cell: nextCell,
    acceptedContacts: 1,
    rejectedContacts: 0,
    touchedCells: 1,
    removedHeat: transfer.removedHeat,
    removedFuel: transfer.removedFuel,
    removedFlame: transfer.removedFlame,
    addedVapor: transfer.addedVapor,
    sourceContactWetness,
  };
}

export function createLiquidFireContactConsumerShaderWGSL(gridSize) {
  const grid = nonnegativeInteger(gridSize, 'Pyro near-field grid');
  if (grid < 4) throw new Error('Pyro near-field grid must be at least 4');
  return /* wgsl */`
const GRID: u32 = ${grid}u;
const GRID_CELL_COUNT: u32 = ${grid * grid * grid}u;
const SOURCE_WETNESS_INDEX: u32 = GRID_CELL_COUNT;
const SOURCE_TEMPERATURE_INDEX: u32 = GRID_CELL_COUNT + 1u;
const SOURCE_COMBUSTION_INDEX: u32 = GRID_CELL_COUNT + 2u;
const SOURCE_IGNITED_INDEX: u32 = GRID_CELL_COUNT + 3u;
const SOURCE_LAST_CONTACT_TICK_INDEX: u32 = GRID_CELL_COUNT + 4u;
const SOURCE_MAGIC: u32 = ${LIQUID_FIRE_CONTACT_MAGIC}u;
const SOURCE_VERSION: u32 = ${LIQUID_FIRE_CONTACT_VERSION}u;
const FIXED_POINT_SCALE: f32 = ${LIQUID_FIRE_CONTACT_FIXED_POINT_SCALE}.0;

struct LiquidFireContactHeader {
  magic: atomic<u32>,
  version: atomic<u32>,
  allocationGeneration: atomic<u32>,
  epoch: atomic<u32>,
  writeTick: atomic<u32>,
  valid: atomic<u32>,
  complete: atomic<u32>,
  sourceFrameHash: atomic<u32>,
  sourceCount: atomic<u32>,
  packedCount: atomic<u32>,
  contactCount: atomic<u32>,
  rejectedCount: atomic<u32>,
  capacity: atomic<u32>,
  overflowCount: atomic<u32>,
  malformedCount: atomic<u32>,
  recordWords: atomic<u32>,
  flags: atomic<u32>,
  reserved0: atomic<u32>,
  reserved1: atomic<u32>,
  reserved2: atomic<u32>,
};

struct LiquidFireContactRecord {
  worldPositionId: vec4<f32>,
  sourcePositionConfidence: vec4<f32>,
  normalThickness: vec4<f32>,
  velocityNormalSpeed: vec4<f32>,
  tangentVelocitySpeed: vec4<f32>,
  wetnessMaterialTracerVolume: vec4<f32>,
  sourceGenerationEpochTick: vec4<f32>,
  supportSourceFlags: vec4<f32>,
};

struct ContactAccumulation {
  wetness: atomic<u32>,
  heatRemoval: atomic<u32>,
  flameRemoval: atomic<u32>,
  vapor: atomic<u32>,
};

struct ConsumerStats {
  lastConsumedTick: atomic<u32>,
  status: atomic<u32>,
  acceptedContacts: atomic<u32>,
  rejectedContacts: atomic<u32>,
  touchedCells: atomic<u32>,
  removedHeat: atomic<u32>,
  removedFuel: atomic<u32>,
  removedFlame: atomic<u32>,
  addedVapor: atomic<u32>,
  sourceGeneration: atomic<u32>,
  sourceEpoch: atomic<u32>,
  sourceFrameHash: atomic<u32>,
  quenchDeposited: atomic<u32>,
  quenchedCells: atomic<u32>,
  sourceContactWetness: atomic<u32>,
  sourceWetness: atomic<u32>,
  sourceTemperature: atomic<u32>,
  sourceCombustion: atomic<u32>,
  sourceIgnited: atomic<u32>,
  sourceNearestContactDistance: atomic<u32>,
  sourceLastContactTick: atomic<u32>,
};

struct ConsumerParams {
  expectedIdentity: vec4<u32>,
  receiverScale: vec4<f32>,
  receiverOffset: vec4<f32>,
  transfer: vec4<f32>,
  sourceQuench: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> sourceHeader: LiquidFireContactHeader;
@group(0) @binding(1) var<storage, read> sourceRecords: array<LiquidFireContactRecord>;
@group(0) @binding(2) var<storage, read_write> accumulation: array<ContactAccumulation>;
@group(0) @binding(3) var<storage, read_write> consumerStats: ConsumerStats;
@group(0) @binding(4) var<uniform> consumerParams: ConsumerParams;
@group(0) @binding(5) var<storage, read_write> nearFluid: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> quenchField: array<atomic<u32>>;

fn fixedPoint(value: f32) -> u32 {
  return u32(clamp(value, 0.0, 65535.0) * FIXED_POINT_SCALE + 0.5);
}

fn floatPoint(value: u32) -> f32 {
  return f32(value) / FIXED_POINT_SCALE;
}

fn sourceHeaderIsConsumable() -> bool {
  return atomicLoad(&sourceHeader.magic) == SOURCE_MAGIC
    && atomicLoad(&sourceHeader.version) == SOURCE_VERSION
    && atomicLoad(&sourceHeader.valid) == 1u
    && atomicLoad(&sourceHeader.complete) == 1u
    && atomicLoad(&sourceHeader.allocationGeneration) == consumerParams.expectedIdentity.x
    && atomicLoad(&sourceHeader.epoch) == consumerParams.expectedIdentity.y
    && atomicLoad(&sourceHeader.sourceFrameHash) == consumerParams.expectedIdentity.z
    && atomicLoad(&sourceHeader.overflowCount) == 0u
    && atomicLoad(&sourceHeader.malformedCount) == 0u
    && atomicLoad(&sourceHeader.recordWords) == 32u;
}

@compute @workgroup_size(1)
fn clear_liquid_fire_contact_consumer_stats(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x != 0u) { return; }
  atomicStore(&consumerStats.status, 0u);
  atomicStore(&consumerStats.acceptedContacts, 0u);
  atomicStore(&consumerStats.rejectedContacts, 0u);
  atomicStore(&consumerStats.touchedCells, 0u);
  atomicStore(&consumerStats.removedHeat, 0u);
  atomicStore(&consumerStats.removedFuel, 0u);
  atomicStore(&consumerStats.removedFlame, 0u);
  atomicStore(&consumerStats.addedVapor, 0u);
  atomicStore(&consumerStats.sourceGeneration, 0u);
  atomicStore(&consumerStats.sourceEpoch, 0u);
  atomicStore(&consumerStats.sourceFrameHash, 0u);
  atomicStore(&consumerStats.quenchDeposited, 0u);
  atomicStore(&consumerStats.quenchedCells, 0u);
  atomicStore(&consumerStats.sourceContactWetness, 0u);
  atomicStore(&consumerStats.sourceWetness, 0u);
  atomicStore(&consumerStats.sourceTemperature, 0u);
  atomicStore(&consumerStats.sourceCombustion, 0u);
  atomicStore(&consumerStats.sourceIgnited, 0u);
  atomicStore(&consumerStats.sourceNearestContactDistance, 0xffffffffu);
  atomicStore(&consumerStats.sourceLastContactTick, 0u);
}

@compute @workgroup_size(64)
fn scatter_liquid_fire_contacts(@builtin(global_invocation_id) gid: vec3<u32>) {
  let sourceIndex = gid.x;
  if (!sourceHeaderIsConsumable()) {
    if (sourceIndex == 0u) { atomicStore(&consumerStats.status, 2u); }
    return;
  }
  let writeTick = atomicLoad(&sourceHeader.writeTick);
  if (writeTick <= atomicLoad(&consumerStats.lastConsumedTick)) {
    if (sourceIndex == 0u) { atomicStore(&consumerStats.status, 3u); }
    return;
  }
  if (sourceIndex == 0u) { atomicStore(&consumerStats.status, 4u); }
  let count = min(atomicLoad(&sourceHeader.packedCount), atomicLoad(&sourceHeader.capacity));
  if (sourceIndex >= count) { return; }
  let record = sourceRecords[sourceIndex];
  let sourceGeneration = u32(record.sourceGenerationEpochTick.x + 0.5);
  let sourceEpoch = u32(record.sourceGenerationEpochTick.y + 0.5);
  let sourceTick = u32(record.sourceGenerationEpochTick.z + 0.5);
  if (sourceGeneration != consumerParams.expectedIdentity.x || sourceEpoch != consumerParams.expectedIdentity.y || sourceTick != writeTick) {
    atomicAdd(&consumerStats.rejectedContacts, 1u);
    return;
  }
  let receiverUnit = record.sourcePositionConfidence.xyz * consumerParams.receiverScale.xyz + consumerParams.receiverOffset.xyz;
  if (any(receiverUnit < vec3<f32>(0.0)) || any(receiverUnit > vec3<f32>(1.0))) {
    atomicAdd(&consumerStats.rejectedContacts, 1u);
    return;
  }
  let wetness = clamp(record.wetnessMaterialTracerVolume.x, 0.0, 2.0);
  let sourceContactDistance = distance(receiverUnit, consumerParams.sourceQuench.xyz);
  atomicMin(&consumerStats.sourceNearestContactDistance, fixedPoint(sourceContactDistance));
  if (sourceContactDistance <= consumerParams.sourceQuench.w) {
    let sourceContactWetness = fixedPoint(min(1.0, wetness));
    atomicMax(&quenchField[SOURCE_WETNESS_INDEX], sourceContactWetness);
    atomicMax(&quenchField[SOURCE_LAST_CONTACT_TICK_INDEX], writeTick);
    atomicMax(&consumerStats.sourceContactWetness, sourceContactWetness);
  }
  let cell = min(vec3<u32>(receiverUnit * f32(GRID)), vec3<u32>(GRID - 1u));
  let cellIndex = cell.x + cell.y * GRID + cell.z * GRID * GRID;
  let volume = clamp(record.wetnessMaterialTracerVolume.w, 0.0, 2.0);
  let heatRemoval = wetness * consumerParams.transfer.x;
  let flameRemoval = wetness * consumerParams.transfer.z;
  let vapor = min(1.0, wetness * volume * consumerParams.transfer.w);
  if (atomicAdd(&accumulation[cellIndex].wetness, fixedPoint(wetness)) == 0u) {
    atomicAdd(&consumerStats.touchedCells, 1u);
  }
  atomicAdd(&accumulation[cellIndex].heatRemoval, fixedPoint(heatRemoval));
  atomicAdd(&accumulation[cellIndex].flameRemoval, fixedPoint(flameRemoval));
  atomicAdd(&accumulation[cellIndex].vapor, fixedPoint(vapor));
  atomicAdd(&consumerStats.acceptedContacts, 1u);
}

@compute @workgroup_size(64)
fn apply_liquid_fire_contact_transfer(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cellIndex = gid.x;
  if (cellIndex >= GRID_CELL_COUNT) { return; }
  if (atomicLoad(&consumerStats.status) != 4u) { return; }
  let wetness = min(0.24, floatPoint(atomicExchange(&accumulation[cellIndex].wetness, 0u)));
  var requestedHeatRemoval = min(0.010, floatPoint(atomicExchange(&accumulation[cellIndex].heatRemoval, 0u)));
  var requestedFlameRemoval = min(0.012, floatPoint(atomicExchange(&accumulation[cellIndex].flameRemoval, 0u)));
  let addedVapor = min(0.020, floatPoint(atomicExchange(&accumulation[cellIndex].vapor, 0u)));
  if (wetness <= 0.0 && addedVapor <= 0.0) {
    return;
  }
  let base = cellIndex * 4u;
  var cell0 = nearFluid[base];
  var cell1 = nearFluid[base + 1u];
  var cell2 = nearFluid[base + 2u];
  var cell3 = nearFluid[base + 3u];
  let priorQuench = clamp(floatPoint(atomicLoad(&quenchField[cellIndex])), 0.0, 1.0);
  let depositedQuench = min(1.0, priorQuench + wetness * 0.45);
  atomicStore(&quenchField[cellIndex], fixedPoint(depositedQuench));
  let quenchStrength = smoothstep(0.08, 0.55, depositedQuench);
  requestedHeatRemoval = max(requestedHeatRemoval, quenchStrength * 0.03);
  requestedFlameRemoval = max(requestedFlameRemoval, quenchStrength * 0.04);
  let removedHeat = min(cell1.y, requestedHeatRemoval);
  let removedFuel = min(cell1.z, max(wetness * consumerParams.transfer.y, quenchStrength * 0.025));
  let removedFlame = min(cell2.x, requestedFlameRemoval);
  let remainingFlameRemoval = max(0.0, requestedFlameRemoval - removedFlame);
  let removedFlameDetail = min(cell2.z, remainingFlameRemoval);
  let remainingFrontRemoval = max(0.0, remainingFlameRemoval - removedFlameDetail);
  let removedCombustionFront = min(cell2.w, remainingFrontRemoval);
  let remainingLickRemoval = max(0.0, remainingFrontRemoval - removedCombustionFront);
  let removedFireLick = min(cell3.z, remainingLickRemoval);
  let removedVisibleFire = removedFlame + removedFlameDetail + removedCombustionFront + removedFireLick;
  cell0.w = min(4.0, cell0.w + addedVapor * 0.4);
  cell1.x = min(4.0, cell1.x + addedVapor);
  cell1.y = max(0.0, cell1.y - removedHeat);
  cell1.z = max(0.0, cell1.z - removedFuel);
  cell2.x = max(0.0, cell2.x - removedFlame);
  cell2.z = max(0.0, cell2.z - removedFlameDetail);
  cell2.w = max(0.0, cell2.w - removedCombustionFront);
  cell3.x = min(4.0, cell3.x + addedVapor * 0.4);
  cell3.z = max(0.0, cell3.z - removedFireLick);
  nearFluid[base] = cell0;
  nearFluid[base + 1u] = cell1;
  nearFluid[base + 2u] = cell2;
  nearFluid[base + 3u] = cell3;
  atomicAdd(&consumerStats.removedHeat, fixedPoint(removedHeat));
  atomicAdd(&consumerStats.removedFuel, fixedPoint(removedFuel));
  atomicAdd(&consumerStats.removedFlame, fixedPoint(removedVisibleFire));
  atomicAdd(&consumerStats.addedVapor, fixedPoint(addedVapor));
  atomicAdd(&consumerStats.quenchDeposited, fixedPoint(depositedQuench - priorQuench));
  if (quenchStrength >= 0.5) {
    atomicAdd(&consumerStats.quenchedCells, 1u);
  }
}

@compute @workgroup_size(1)
fn finalize_liquid_fire_contact_transfer(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x != 0u || atomicLoad(&consumerStats.status) != 4u) { return; }
  atomicStore(&consumerStats.lastConsumedTick, atomicLoad(&sourceHeader.writeTick));
  atomicStore(&consumerStats.sourceGeneration, atomicLoad(&sourceHeader.allocationGeneration));
  atomicStore(&consumerStats.sourceEpoch, atomicLoad(&sourceHeader.epoch));
  atomicStore(&consumerStats.sourceFrameHash, atomicLoad(&sourceHeader.sourceFrameHash));
  atomicStore(&consumerStats.sourceWetness, atomicLoad(&quenchField[SOURCE_WETNESS_INDEX]));
  atomicStore(&consumerStats.sourceTemperature, atomicLoad(&quenchField[SOURCE_TEMPERATURE_INDEX]));
  atomicStore(&consumerStats.sourceCombustion, atomicLoad(&quenchField[SOURCE_COMBUSTION_INDEX]));
  atomicStore(&consumerStats.sourceIgnited, atomicLoad(&quenchField[SOURCE_IGNITED_INDEX]));
  atomicStore(&consumerStats.sourceLastContactTick, atomicLoad(&quenchField[SOURCE_LAST_CONTACT_TICK_INDEX]));
  let acceptedContacts = atomicLoad(&consumerStats.acceptedContacts);
  if (acceptedContacts > 0u) {
    atomicStore(&consumerStats.status, 1u);
  } else {
    atomicStore(&consumerStats.status, 5u);
  }
}
`;
}

export function liquidFireContactConsumerParams({
  allocationGeneration,
  epoch,
  sourceFrameHash,
  receiverScale = [0.5, 0.5, 0.5],
  receiverOffset = [0.5, 0.5, 0.5],
  sourceQuenchCenter = [0.5, 0.13, 0.5],
  sourceQuenchRadius = 0.42,
  heatRemoval = 0.6,
  fuelRemoval = 0.3,
  flameRemoval = 0.75,
  vaporYield = 1,
} = {}) {
  const buffer = new ArrayBuffer(80);
  const words = new Uint32Array(buffer);
  const floats = new Float32Array(buffer);
  words.set([
    nonnegativeInteger(allocationGeneration, 'Liquid fire contact generation'),
    nonnegativeInteger(epoch, 'Liquid fire contact epoch'),
    nonnegativeInteger(sourceFrameHash, 'Liquid fire contact source frame hash'),
    0,
  ], 0);
  floats.set([...receiverScale, 0], 4);
  floats.set([...receiverOffset, 0], 8);
  floats.set([heatRemoval, fuelRemoval, flameRemoval, vaporYield], 12);
  floats.set([...sourceQuenchCenter, sourceQuenchRadius], 16);
  return buffer;
}
