import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const consumerUrl = new URL('../liquid-fire-contact-consumer.mjs', import.meta.url);
const coreUrl = new URL('../volume-core.js', import.meta.url);
const indexUrl = new URL('../index.html', import.meta.url);
const witnessUrl = new URL('../finger-fluid-bench-witness.mjs', import.meta.url);

const consumerSource = await readFile(consumerUrl, 'utf8');
const volumeSource = await readFile(coreUrl, 'utf8');
const indexSource = await readFile(indexUrl, 'utf8');
const witnessSource = await readFile(witnessUrl, 'utf8');
const consumer = await import(consumerUrl);

assert.equal(consumer.LIQUID_FIRE_CONTACT_CONSUMER_SCHEMA, 'kaminos.pyro-liquid-contact-consumer.v0');
assert.equal(consumer.LIQUID_FIRE_CONTACT_SOURCE_SCHEMA, 'kaminos.liquid-fire-contact-descriptor.v1');
assert.equal(consumer.LIQUID_FIRE_CONTACT_SOURCE_PACKING, 'gpu-sparse-liquid-fire-contact-source-vec4x8-v1');
assert.equal(consumer.LIQUID_FIRE_CONTACT_RECEIVER_TRANSFORM_ID, 'affine-liquid-world-to-pyro-near-domain-v0');
assert.equal(consumer.LIQUID_FIRE_CONTACT_ACCUMULATION_LAYOUT, 'atomic-u32-wetness-heat-flame-vapor-per-near-cell-v0');

const sharedDevice = { queue: {} };
const descriptor = {
  schema: consumer.LIQUID_FIRE_CONTACT_SOURCE_SCHEMA,
  packing: consumer.LIQUID_FIRE_CONTACT_SOURCE_PACKING,
  device: sharedDevice,
  queue: sharedDevice.queue,
  headerBuffer: { label: 'header' },
  recordsBuffer: { label: 'records' },
  headerBytes: 80,
  recordBytes: 128,
  recordFloats: 32,
  capacity: 24576,
  allocationGeneration: 7,
  epoch: 3,
  writeTick: 99,
  sourceFrameHash: 0x6c2673d1,
  sourceFrameId: 'kaminos/finger-fluid-bench:gpu-simulation-frame',
};

const validated = consumer.validateLiquidFireContactSourceDescriptor(descriptor, {
  device: sharedDevice,
  expectedGeneration: 7,
  expectedEpoch: 3,
});
assert.equal(validated.device, sharedDevice, 'consumer preserves the exact GPUDevice reference');
assert.equal(validated.headerBuffer, descriptor.headerBuffer, 'consumer preserves the authoritative GPU header');
assert.equal(validated.recordsBuffer, descriptor.recordsBuffer, 'consumer preserves the authoritative sparse records');
assert.throws(
  () => consumer.validateLiquidFireContactSourceDescriptor(descriptor, { device: { queue: sharedDevice.queue } }),
  /same GPUDevice/,
  'cross-device proxy buffers fail closed',
);
assert.throws(
  () => consumer.validateLiquidFireContactSourceDescriptor({ ...descriptor, schema: 'fallback' }, { device: sharedDevice }),
  /schema mismatch/,
  'fallback source schemas fail closed',
);
assert.throws(
  () => consumer.validateLiquidFireContactSourceDescriptor(descriptor, { device: sharedDevice, expectedGeneration: 8 }),
  /generation mismatch/,
  'stale allocation generations fail closed',
);
assert.throws(
  () => consumer.validateLiquidFireContactSourceDescriptor({ ...descriptor, capacity: 0 }, { device: sharedDevice }),
  /positive capacity/,
  'blank sparse products cannot masquerade as evidence',
);

assert.deepEqual(
  consumer.applyLiquidFireContactCellReference(
    { density: 0.4, smoke: 0.25, heat: 0.8, fuel: 0.7, flame: 0.9, microSmoke: 0.1 },
    { wetness: 0.75, volume: 0.5 },
  ),
  {
    density: 0.55,
    smoke: 0.625,
    heat: 0.35,
    fuel: 0.475,
    flame: 0.3375,
    microSmoke: 0.25,
    removedHeat: 0.45,
    removedFuel: 0.225,
    removedFlame: 0.5625,
    addedVapor: 0.375,
  },
  'reference transfer removes local combustion carriers and adds bounded vapor',
);

assert.equal(typeof consumer.consumeLiquidFireContactTickReference, 'function', 'consumer exports a deterministic freshness reference');
const initialReferenceState = {
  lastConsumedTick: 0,
  cell: { density: 0.4, smoke: 0.25, heat: 0.8, fuel: 0.7, flame: 0.9, microSmoke: 0.1 },
};
const firstReferenceTransfer = consumer.consumeLiquidFireContactTickReference(initialReferenceState, {
  writeTick: 17,
  valid: true,
  contact: { wetness: 0.75, volume: 0.5 },
});
assert.equal(firstReferenceTransfer.ok, true, 'a fresh valid tick applies once');
assert.equal(firstReferenceTransfer.status, 'applied');
assert.equal(firstReferenceTransfer.lastConsumedTick, 17);
assert.equal(firstReferenceTransfer.acceptedContacts, 1);
assert.ok(firstReferenceTransfer.removedHeat > 0 && firstReferenceTransfer.addedVapor > 0);
const staleReferenceTransfer = consumer.consumeLiquidFireContactTickReference(firstReferenceTransfer, {
  writeTick: 17,
  valid: true,
  contact: { wetness: 0.75, volume: 0.5 },
});
assert.equal(staleReferenceTransfer.ok, false, 'the same source tick fails closed on second consumption');
assert.equal(staleReferenceTransfer.status, 'stale-source-tick');
assert.equal(staleReferenceTransfer.lastConsumedTick, 17);
assert.equal(staleReferenceTransfer.acceptedContacts, 0);
assert.equal(staleReferenceTransfer.touchedCells, 0);
assert.equal(staleReferenceTransfer.removedHeat, 0);
assert.equal(staleReferenceTransfer.removedFuel, 0);
assert.equal(staleReferenceTransfer.removedFlame, 0);
assert.equal(staleReferenceTransfer.addedVapor, 0);
assert.deepEqual(staleReferenceTransfer.cell, firstReferenceTransfer.cell, 'the repeated tick does not mutate the Pyro cell again');

assert.match(consumerSource, /atomicLoad\(&sourceHeader\.valid\)\s*==\s*1u/, 'GPU scatter requires a valid producer header');
assert.match(consumerSource, /atomicLoad\(&sourceHeader\.complete\)\s*==\s*1u/, 'GPU scatter requires a complete producer header');
assert.match(consumerSource, /writeTick\s*<=\s*atomicLoad\(&consumerStats\.lastConsumedTick\)/, 'GPU scatter rejects repeated or stale write ticks');
assert.match(consumerSource, /atomicStore\(&consumerStats\.acceptedContacts,\s*0u\)/, 'each transfer clears prior accepted-contact evidence');
assert.match(consumerSource, /atomicStore\(&consumerStats\.addedVapor,\s*0u\)/, 'each transfer clears prior vapor evidence');
assert.match(consumerSource, /atomicStore\(&consumerStats\.status,\s*4u\)/, 'freshness is published as an explicit scatter-to-apply gate');
assert.match(consumerSource, /atomicLoad\(&consumerStats\.status\)\s*!=\s*4u[\s\S]*return;/, 'apply preserves invalid and stale source status rather than overwriting it');
assert.match(consumerSource, /acceptedContacts\s*>\s*0u[\s\S]*atomicStore\(&consumerStats\.status,\s*1u\)/, 'applied status requires current-transfer accepted contacts');
assert.match(consumerSource, /fn finalize_liquid_fire_contact_transfer/, 'status and source receipts finalize in a distinct ordered dispatch');
assert.match(consumerSource, /atomicAdd\(&accumulation\[cellIndex\]\.wetness/, 'contacts scatter wetness into local Pyro cells');
assert.match(consumerSource, /atomicExchange\(&accumulation\[cellIndex\]\.heatRemoval/, 'apply pass consumes and clears transient heat removal');
assert.match(consumerSource, /cell1\.y\s*=\s*max\(0\.0,\s*cell1\.y\s*-\s*removedHeat\)/, 'apply pass removes local heat');
assert.match(consumerSource, /cell1\.z\s*=\s*max\(0\.0,\s*cell1\.z\s*-\s*removedFuel\)/, 'apply pass removes local fuel');
assert.match(consumerSource, /cell2\.x\s*=\s*max\(0\.0,\s*cell2\.x\s*-\s*removedFlame\)/, 'apply pass removes local flame');
assert.match(consumerSource, /cell1\.x\s*=\s*min\([^;]+\+\s*addedVapor/, 'apply pass adds local vapor/smoke');

assert.match(volumeSource, /sharedGpuContext\s*=\s*null/, 'Pyro constructor accepts an explicitly shared GPU context');
assert.match(volumeSource, /transparentCanvas\s*=\s*false/, 'Pyro canvas transparency is an explicit route-owned option');
assert.match(volumeSource, /1\.0\s*-\s*trans/, 'raymarch exports extinction-derived alpha for real canvas composition');
assert.match(volumeSource, /mix\(1\.0,\s*0\.0,\s*TRANSPARENT_CANVAS\)/, 'ray misses become transparent instead of clipping the lower liquid canvas');
assert.match(volumeSource, /alphaMode:\s*transparentCanvas\s*\?\s*'premultiplied'\s*:\s*'opaque'/, 'only composition routes opt into browser alpha blending');
assert.match(volumeSource, /setLiquidFireContactDescriptor\(descriptor/, 'Pyro exposes the sparse contact binding API');
assert.match(volumeSource, /encodeLiquidFireContactTransfer\(encoder\);[\s\S]*encodeMajorant\(encoder\)/, 'liquid transfer is ordered after simulation and before majorant/render');
assert.match(volumeSource, /setPipeline\(liquidFireContactApplyPipeline\)[\s\S]*dispatchWorkgroups\(Math\.ceil\(gridCellCount\(gridSize\) \/ 64\)\)[\s\S]*setPipeline\(liquidFireContactFinalizePipeline\)[\s\S]*dispatchWorkgroups\(1\)/, 'a separate one-thread finalize dispatch runs after every apply workgroup');
assert.match(volumeSource, /device\s*!==\s*descriptor\.device[\s\S]*same GPUDevice/, 'Pyro rejects a descriptor from another device');
assert.match(indexSource, /finger_fluid_pyro_composition/, 'the composition route is explicit and inspectable');
assert.match(indexSource, /transparentCanvas:\s*fingerFluidPyroCompositionRequested\(\)/, 'composition route requests transparent Pyro output explicitly');
assert.match(indexSource, /getLiquidFireContactDescriptor\(\)/, 'the route binds the live solver-owned sparse descriptor');
assert.match(indexSource, /volumePrototype\.setLiquidFireContactDescriptor/, 'the route hands the descriptor to the real Pyro simulator');
assert.match(indexSource, /volumePrototype\.setActive\(true\)/, 'the route runs the Pyro simulator for visual smoke');
assert.match(witnessSource, /kaminosFingerFluidPyroCompositionSample\(\)/, 'visual witness samples authoritative GPU transfer accounting');
assert.match(witnessSource, /sameDevice[^\n]+true/, 'visual witness rejects cross-device composition');
assert.match(witnessSource, /acceptedContacts[^\n]+0/, 'visual witness requires consumed sparse contacts');
assert.match(witnessSource, /touchedCells[^\n]+0/, 'visual witness requires spatially touched Pyro cells');
assert.match(witnessSource, /removedHeat[^\n]+0/, 'visual witness requires local heat removal');
assert.match(witnessSource, /removedFlame[^\n]+0/, 'visual witness requires local flame removal');
assert.match(witnessSource, /addedVapor[^\n]+0/, 'visual witness requires local vapor addition');

console.log('liquid/fire contact consumer contracts: ok');
