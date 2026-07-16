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
assert.equal(consumer.LIQUID_FIRE_CONTACT_RECEIVER_TRANSFORM_ID, 'shared-world-unit-cube-to-pyro-near-domain-v0');
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

const sharedWorldParams = consumer.liquidFireContactConsumerParams({
  allocationGeneration: 7,
  epoch: 3,
  sourceFrameHash: 0x6c2673d1,
});
const sharedWorldFloats = new Float32Array(sharedWorldParams);
assert.deepEqual(Array.from(sharedWorldFloats.slice(4, 7)), [0.5, 0.5, 0.5], 'contact positions scale from the rendered shared-world cube into Pyro unit coordinates');
assert.deepEqual(Array.from(sharedWorldFloats.slice(8, 11)), [0.5, 0.5, 0.5], 'contact positions offset the rendered shared-world cube into Pyro unit coordinates');

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

assert.equal(consumer.LIQUID_FIRE_SOURCE_STATE_MODEL, 'recoverable-wetness-thermal-ignition-v0');
assert.equal(consumer.LIQUID_FIRE_SOURCE_REIGNITION_POLICY, 'manual-reignition-v0');
assert.equal(typeof consumer.advanceLiquidFireSourceStateReference, 'function', 'consumer exports a deterministic continuous source-state reference');
let sourceState = { wetness: 0, temperature: 1, combustion: 1, ignited: 1 };
const dryBurningState = consumer.advanceLiquidFireSourceStateReference(sourceState, { contactWetness: 0, pilotEnabled: false });
assert.ok(dryBurningState.combustion > 0.95, `an uncontacted burning source must remain established: ${JSON.stringify(dryBurningState)}`);
const firstWetState = consumer.advanceLiquidFireSourceStateReference(dryBurningState, { contactWetness: 0.72, pilotEnabled: false });
assert.ok(firstWetState.combustion > 0.2, `one wet step must not globally snap the established plume off: ${JSON.stringify(firstWetState)}`);
sourceState = firstWetState;
for (let step = 0; step < 192; step += 1) {
  sourceState = consumer.advanceLiquidFireSourceStateReference(sourceState, { contactWetness: 0.72, pilotEnabled: false });
}
assert.ok(sourceState.wetness > 0.55, `sustained source contact must establish material wetness: ${JSON.stringify(sourceState)}`);
assert.ok(sourceState.temperature < 0.28, `sustained source contact must cool the burner progressively: ${JSON.stringify(sourceState)}`);
assert.ok(sourceState.combustion < 0.05 && sourceState.ignited === 0, `sustained source contact must extinguish the burner: ${JSON.stringify(sourceState)}`);
let dryManualState = sourceState;
for (let step = 0; step < 240; step += 1) {
  dryManualState = consumer.advanceLiquidFireSourceStateReference(dryManualState, { contactWetness: 0, pilotEnabled: false });
}
assert.ok(dryManualState.wetness < sourceState.wetness, 'source wetness must dry instead of remaining a permanent latch');
assert.equal(dryManualState.ignited, 0, 'manual-reignition policy does not silently relight a dry extinguished source');
assert.ok(dryManualState.combustion < 0.05, 'drying alone does not impersonate an ignition event');
let pilotedState = dryManualState;
for (let step = 0; step < 320; step += 1) {
  pilotedState = consumer.advanceLiquidFireSourceStateReference(pilotedState, { contactWetness: 0, pilotEnabled: true });
}
assert.ok(pilotedState.ignited === 1 && pilotedState.combustion > 0.5, `the explicit pilot policy can recover after drying: ${JSON.stringify(pilotedState)}`);

const sourceLatchTick = consumer.consumeLiquidFireContactTickReference(
  { lastConsumedTick: 0, cell: { density: 0, smoke: 0, heat: 1, fuel: 1, flame: 1, microSmoke: 0 } },
  { writeTick: 1, valid: true, contact: { wetness: 0.25, volume: 0.2, inSourceNeighborhood: true } },
);
assert.ok(sourceLatchTick.sourceContactWetness > 0, 'the transfer that wets the burner reports current source-neighborhood wetness');
const unrelatedContactTick = consumer.consumeLiquidFireContactTickReference(
  sourceLatchTick,
  { writeTick: 2, valid: true, contact: { wetness: 0.25, volume: 0.2, inSourceNeighborhood: false } },
);
assert.equal(unrelatedContactTick.sourceContactWetness, 0, 'a later accepted contact outside the burner cannot inherit current source-contact evidence');
const noExchangeTick = consumer.consumeLiquidFireContactTickReference(unrelatedContactTick, { writeTick: 3, valid: true });
assert.equal(noExchangeTick.sourceContactWetness, 0, 'a fresh no-exchange tick cannot inherit current source-contact evidence');

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
assert.match(consumerSource, /@group\(0\) @binding\(6\) var<storage, read_write> quenchField:\s*array<atomic<u32>>/, 'contact consumer owns a persistent fixed-point Pyro wetness field');
assert.match(consumerSource, /atomicStore\(&quenchField\[cellIndex\],\s*fixedPoint\(depositedQuench\)\)/, 'liquid contact deposits persistent wetness instead of discarding it each frame');
assert.match(consumerSource, /requestedHeatRemoval\s*=\s*max\([^;]*quenchStrength/, 'persistent quench can remove reinjected source heat decisively');
assert.match(consumerSource, /requestedFlameRemoval\s*=\s*max\([^;]*quenchStrength/, 'persistent quench can remove all visible fire carriers decisively');
assert.match(consumerSource, /requestedHeatRemoval\s*=\s*max\(requestedHeatRemoval,\s*quenchStrength\s*\*\s*0\.03\)/, 'wet-cell heat removal is a bounded progressive rate');
assert.match(consumerSource, /requestedFlameRemoval\s*=\s*max\(requestedFlameRemoval,\s*quenchStrength\s*\*\s*0\.04\)/, 'wet-cell flame removal preserves a visible cooling horizon');
assert.doesNotMatch(consumerSource, /quenchStrength\s*\*\s*8\.0/, 'wet cells cannot delete the entire local flame field in one transfer');
assert.equal(consumer.LIQUID_FIRE_SOURCE_STATE_WORDS, 5, 'source allocation reserves a monotonic exact-contact tick beside continuous thermal state');
assert.equal(consumer.LIQUID_FIRE_CONTACT_STATS_WORDS, 21, 'consumer telemetry separates current contact, continuous source state, nearest geometry, and exact-contact event identity');
assert.match(consumerSource, /quenchDeposited:\s*atomic<u32>/, 'consumer telemetry records newly deposited persistent quench mass');
assert.match(consumerSource, /quenchedCells:\s*atomic<u32>/, 'consumer telemetry records cells under material combustion suppression');
assert.match(consumerSource, /sourceContactWetness:\s*atomic<u32>/, 'consumer telemetry records current-transfer burner-neighborhood wetness separately');
assert.match(consumerSource, /sourceWetness:\s*atomic<u32>/, 'consumer telemetry records recoverable source wetness');
assert.match(consumerSource, /sourceTemperature:\s*atomic<u32>/, 'consumer telemetry records source thermal state');
assert.match(consumerSource, /sourceCombustion:\s*atomic<u32>/, 'consumer telemetry records continuous source combustion');
assert.match(consumerSource, /sourceIgnited:\s*atomic<u32>/, 'consumer telemetry records explicit ignition state');
assert.match(consumerSource, /sourceNearestContactDistance:\s*atomic<u32>/, 'consumer telemetry records the nearest accepted liquid record to the burner');
assert.match(consumerSource, /sourceLastContactTick:\s*atomic<u32>/, 'consumer telemetry exposes the monotonic exact-contact event tick');
assert.match(consumerSource, /atomicStore\(&consumerStats\.sourceContactWetness,\s*0u\)/, 'current source-contact evidence resets before every transfer');
assert.match(consumerSource, /atomicAdd\(&consumerStats\.quenchDeposited,\s*fixedPoint\(depositedQuench\s*-\s*priorQuench\)\)/, 'quench telemetry counts deposition rather than repeatedly counting retained state');
assert.match(consumerSource, /@group\(0\) @binding\(6\) var<storage, read_write> quenchField:\s*array<atomic<u32>>/, 'consumer uses atomic fixed-point quench storage shared with the simulator');
assert.match(consumerSource, /let sourceContactDistance\s*=\s*distance\(receiverUnit,\s*consumerParams\.sourceQuench\.xyz\)/, 'source quench is measured from exact sparse-record geometry');
assert.match(consumerSource, /atomicMin\(&consumerStats\.sourceNearestContactDistance,\s*fixedPoint\(sourceContactDistance\)\)/, 'source telemetry preserves the nearest accepted liquid record');
assert.match(consumerSource, /sourceContactDistance\s*<=\s*consumerParams\.sourceQuench\.w[\s\S]*atomicMax\(&quenchField\[SOURCE_WETNESS_INDEX\]/, 'exact record overlap, not quantized receiver-cell overlap, wets the burner');
assert.match(consumerSource, /sourceContactDistance\s*<=\s*consumerParams\.sourceQuench\.w[\s\S]*atomicMax\(&quenchField\[SOURCE_LAST_CONTACT_TICK_INDEX\],\s*writeTick\)/, 'the exact overlap branch durably records its source write tick');
assert.match(consumerSource, /atomicMax\(&quenchField\[SOURCE_WETNESS_INDEX\],\s*sourceContactWetness\)/, 'burner contact raises recoverable source wetness without adding a storage binding');
assert.match(consumerSource, /atomicMax\(&consumerStats\.sourceContactWetness,\s*sourceContactWetness\)/, 'the current transfer separately records burner-neighborhood wetness');
assert.match(volumeSource, /quenchDeposited:\s*words\[12\]/, 'composition witness exposes persistent-quench deposition');
assert.match(volumeSource, /quenchedCells:\s*words\[13\]/, 'composition witness exposes the suppressed-cell population');
assert.match(volumeSource, /sourceContactWetness:\s*words\[14\]/, 'composition witness exposes current-transfer source wetness');
assert.match(volumeSource, /sourceWetness:\s*words\[15\]/, 'composition witness exposes recoverable source wetness');
assert.match(volumeSource, /sourceTemperature:\s*words\[16\]/, 'composition witness exposes source thermal state');
assert.match(volumeSource, /sourceCombustion:\s*words\[17\]/, 'composition witness exposes continuous source combustion');
assert.match(volumeSource, /sourceIgnited:\s*words\[18\]/, 'composition witness exposes explicit ignition state');
assert.match(volumeSource, /sourceNearestContactDistance:\s*words\[19\]/, 'composition witness exposes nearest accepted-contact geometry');
assert.match(volumeSource, /sourceLastContactTick:\s*words\[20\]/, 'composition witness exposes monotonic exact-contact event identity');

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
const compositionActivationSource = indexSource.match(/async function activateFingerFluidPyroComposition\(\)[\s\S]*?\n}\n\nasync function sampleFingerFluidPyroComposition/)?.[0] || '';
assert.match(compositionActivationSource, /volumeScene:\s*'tall_plume'/, 'composition requests the only currently valid Pyro fire preset');
assert.match(compositionActivationSource, /\.\.\.VOLUME_SCENE_PRESETS\.tall_plume/, 'composition installs the complete canonical tall-plume preset instead of retaining stale compact-plume controls');
assert.match(compositionActivationSource, /resolution:\s*96[\s\S]*renderScale:\s*0\.85/, 'composition keeps its proven shared-scene resolution and render budget instead of importing the standalone 160-cubed basin cost');
assert.match(compositionActivationSource, /fireRenderMode:\s*'stock'/, 'composition bypasses the topology-shell diagnostic and renders the actual tall-plume fire field');
assert.match(compositionActivationSource, /boundarySplatMode:\s*'learned'/, 'composition explicitly activates the learned live boundary-splat renderer instead of inheriting the operator panel default');
assert.match(compositionActivationSource, /setSelectiveHeadLiveRole\('truthHigh'\)/, 'composition renders the current live high field without substituting the checksum-bound selective residual replay');
assert.match(compositionActivationSource, /setSelectiveHeadLiveRenderComposition\('smoke-raymarch-under-splats-v0'\)/, 'composition assigns broad smoke to raymarch and fire authority to learned boundary sheets');
assert.doesNotMatch(compositionActivationSource, /bonfire_plume/, 'composition cannot silently retain the invalid bonfire preset');
assert.match(indexSource, /requestedVolumeScene:\s*'tall_plume'/, 'composition state records the requested fire preset');
assert.match(indexSource, /effectiveVolumeScene:\s*volumePrototype\.debugState\(\)\.volumeScene/, 'composition state records the effective simulator preset');
assert.match(indexSource, /requestedBoundarySplatMode:\s*'learned'/, 'composition state records the requested render route');
assert.match(indexSource, /requestedLiveFieldRole:\s*'truthHigh'/, 'composition state records the current-field render authority');
assert.match(indexSource, /requestedRenderComposition:\s*'smoke-raymarch-under-splats-v0'/, 'composition state records the non-double-counted renderer composition');
assert.match(indexSource, /installFingerFluidCompositionCameraControls\(panel\)/, 'camera controls bind to the top-level composition surface instead of the occluded liquid canvas');
assert.match(indexSource, /#finger-fluid-bench-operator-panel\[data-pyro-composition="active"\] #kaminos-volume-canvas\.active\s*\{[^}]*pointer-events:\s*auto;/, 'the visible Pyro composition canvas is the physical browser hit target');
assert.match(indexSource, /composition-camera-orbit-wheel-zoom-v0/, 'camera evidence names the effective orbit and wheel-zoom contract');
assert.match(indexSource, /fingerFluidBenchCamera\.yaw\s*-=/, 'composition pointer drag changes camera yaw');
assert.match(indexSource, /fingerFluidBenchCamera\.pitch\s*=\s*Math\.max/, 'composition pointer drag changes camera pitch');
assert.match(indexSource, /fingerFluidBenchCamera\.distance\s*=\s*Math\.max/, 'composition wheel input changes bounded camera distance');
assert.match(volumeSource, /setLiquidFireContactTransferEnabled\(enabled/, 'Pyro exposes an explicit liquid contact transfer gate');
assert.match(volumeSource, /updateVolumePrimitiveTransform\(id,\s*nextTransform\)/, 'Pyro exposes a live primitive transform path for physical contact choreography');
const livePrimitiveTransformSource = volumeSource.match(/updateVolumePrimitiveTransform\(id,\s*nextTransform\)[\s\S]*?\n\s*},\n\s*setLiquidFireContactDescriptor/)?.[0] || '';
assert.match(livePrimitiveTransformSource, /publishVolumePrimitiveState\(\)/, 'live source motion publishes its effective primitive transform');
assert.match(livePrimitiveTransformSource, /writeLiquidFireContactParams\(\)/, 'live source motion keeps the physical contact neighborhood synchronized');
assert.doesNotMatch(livePrimitiveTransformSource, /rebuildFluidState/, 'moving the burner cannot reset the established Pyro field');
assert.match(volumeSource, /@group\(0\) @binding\(11\) var<storage, read> quenchSrc:\s*array<u32>/, 'Pyro simulation reads persistent fixed-point quench state');
assert.match(volumeSource, /@group\(0\) @binding\(12\) var<storage, read_write> quenchDst:\s*array<u32>/, 'Pyro simulation transports persistent fixed-point quench state');
assert.match(volumeSource, /quenchBuffers\s*=\s*\[0,\s*1\]\.map/, 'Pyro allocates ping-ponged quench fields with the simulation state');
assert.match(volumeSource, /let currentQuench\s*=\s*0/, 'quench ping-pong ownership is independent from projected fluid ownership');
assert.match(volumeSource, /function fluidBindGroup\(fluidIndex\s*=\s*currentFluid,\s*quenchIndex\s*=\s*currentQuench\)/, 'fluid passes resolve all fluid/quench ownership combinations explicitly');
assert.match(volumeSource, /currentQuench\s*=\s*1\s*-\s*currentQuench/, 'the main simulation advances quench ownership exactly once per step');
assert.match(volumeSource, /liquidFireContactBindGroups\[currentFluid\s*\*\s*2\s*\+\s*currentQuench\]/, 'liquid transfer writes the independently current fluid and quench destinations');
assert.match(volumeSource, /liquidFireContactBindGroups\.length\s*!==\s*4/, 'liquid transfer requires every fluid/quench ownership combination');
const pressureProjectionSource = volumeSource.match(/function encodePressureProjection\(encoder\)[\s\S]*?\n\s*function encodeMajorant/)?.[0] || '';
assert.doesNotMatch(pressureProjectionSource, /currentQuench\s*=/, 'pressure projection cannot advance or rewind quench ownership');
assert.match(volumeSource, /gridCellCount\(gridSize\)\s*\+\s*LIQUID_FIRE_SOURCE_STATE_WORDS/, 'quench allocation reserves continuous source state without adding a storage buffer');
assert.match(volumeSource, /let localQuenchSuppression\s*=\s*smoothstep/, 'simulator derives a continuous combustion suppression strength from persistent wetness');
assert.match(volumeSource, /sourceWetnessIndex\s*=\s*GRID\s*\*\s*GRID\s*\*\s*GRID[\s\S]*sourceTemperatureIndex[\s\S]*sourceCombustionIndex[\s\S]*sourceIgnitedIndex/, 'simulator reads continuous source state from resolution-correct reserved words');
assert.match(volumeSource, /let sourceFlowEnvelope\s*=\s*sqrt\(sourceCombustion\)/, 'source flow uses a monotone perceptual response that preserves a diminishing plume through intermediate combustion');
assert.match(volumeSource, /let inputFlow\s*=\s*rawInputFlow\s*\*\s*sourceFlowEnvelope/, 'continuous source combustion modulates new source injection rather than deleting the existing plume');
assert.doesNotMatch(volumeSource, /max\(localQuenchSuppression,\s*sourceQuenchSuppression\)/, 'source state cannot globally erase every transported flame cell');
assert.match(volumeSource, /flame\s*=\s*flame\s*\*\s*\(1\.0\s*-\s*localQuenchSuppression/, 'persistent wetness suppresses flame only in locally wetted cells');
assert.match(volumeSource, /nextSourceWetness[\s\S]*nextSourceTemperature[\s\S]*nextSourceCombustion[\s\S]*nextSourceIgnited/, 'simulator advances wetness, thermal, combustion, and ignition state continuously');
assert.match(volumeSource, /let sourcePilotEnabled\s*=\s*false/, 'live source policy defaults the explicit pilot to disabled');
assert.match(volumeSource, /let sourcePilot\s*=\s*clamp\(u\.source_controls\.w,\s*0\.0,\s*1\.0\)/, 'WGSL source evolution consumes the explicit live pilot input');
assert.match(volumeSource, /sourcePilotCanIgnite[\s\S]*nextSourceIgnited/, 'the live source can recover ignition only through the explicit pilot policy');
assert.match(volumeSource, /setLiquidFireSourcePilotEnabled\(enabled\)/, 'Pyro exposes a live source-pilot control');
const livePilotControlSource = volumeSource.match(/setLiquidFireSourcePilotEnabled\(enabled\)[\s\S]*?\n\s*},\n\s*setLiquidFireContactTransferEnabled/)?.[0] || '';
assert.match(livePilotControlSource, /sourcePilotEnabled\s*=\s*enabled\s*===\s*true/, 'live pilot control normalizes its policy input');
assert.doesNotMatch(livePilotControlSource, /rebuildFluidState/, 'changing pilot policy cannot reset the established fluid or Pyro field');
assert.match(indexSource, /function setFingerFluidPyroCompositionPilotEnabled\(enabled\)[\s\S]*setLiquidFireSourcePilotEnabled\(enabled\s*===\s*true\)[\s\S]*fingerFluidPyroCompositionState\.sourcePilotEnabled\s*=\s*receipt\.enabled/, 'composition mirrors the live pilot receipt into its operator-facing summary authority');
assert.match(indexSource, /kaminosFingerFluidPyroSetPilotEnabled\s*=\s*enabled\s*=>\s*setFingerFluidPyroCompositionPilotEnabled\(enabled\)/, 'composition exposes the state-coherent pilot policy to the dynamic witness and operator');
assert.match(indexSource, /kaminosFingerFluidPyroSetSourcePosition\s*=\s*position\s*=>\s*setFingerFluidPyroCompositionSourcePosition\(position\)/, 'composition exposes live source placement for a dry same-field pilot recovery witness');
assert.match(indexSource, /fingerFluidPyroCompositionSourceTrajectoryEnabled\s*=\s*false/, 'explicit source placement cannot be overwritten by the authored one-shot trajectory');
assert.match(volumeSource, /sourceCombustionResponse\s*=\s*select\(0\.028,\s*0\.020,/, 'source extinction has a visibly progressive multi-frame response horizon');
assert.match(volumeSource, /flame\s*=\s*flame\s*\*\s*\(1\.0\s*-\s*localQuenchSuppression\s*\*\s*0\.025\)/, 'persistent wetness decays local flame without outrunning the continuous source state');
assert.match(indexSource, /setLiquidFireContactTransferEnabled\(true,\s*\{\s*reason:\s*'physical-contact-from-start'/, 'composition enables physical transfer from startup');
assert.doesNotMatch(indexSource, /FINGER_FLUID_PYRO_CONTACT_DELAY_MS|FINGER_FLUID_PYRO_CONTACT_MIN_SIM_STEPS/, 'composition no longer substitutes a clock gate for physical contact timing');
assert.match(indexSource, /FINGER_FLUID_PYRO_PRE_CONTACT_CAPTURE_MIN_SIM_STEPS\s*=\s*180/, 'pre-contact capture still waits for a materially established flame without delaying physical transfer');
assert.match(compositionActivationSource, /compositionSourcePrimitive\.transform\s*=\s*\{[\s\S]*position:\s*\[[^\]]+\]/, 'composition authors a downstream source position so first contact is delayed by geometry');
assert.match(indexSource, /FINGER_FLUID_PYRO_SOURCE_MOTION_START_STEP\s*=\s*220/, 'the burner remains on its dry ridge after the mature pre-contact witness threshold');
assert.match(indexSource, /FINGER_FLUID_PYRO_SOURCE_MOTION_END_STEP\s*=\s*230/, 'the burner enters the liquid through a bounded continuous trajectory that is insensitive to wall-clock GPU contention');
assert.match(indexSource, /FINGER_FLUID_PYRO_SOURCE_DRY_POSITION\s*=\s*\[0\.65,\s*-0\.35,\s*0\.51\]/, 'the pre-contact burner stays inside the tall-plume envelope while remaining laterally separated from early liquid spray');
assert.match(indexSource, /FINGER_FLUID_PYRO_SOURCE_WET_POSITION\s*=\s*\[0\.54,\s*-0\.81,\s*0\.29\]/, 'the trajectory ends inside the mature stable support neighborhood observed by full-population GPU diagnostics');
assert.match(indexSource, /FINGER_FLUID_PYRO_SOURCE_WET_POSITION_PROVENANCE\s*=\s*'step-238-stable-contact-record-v0'/, 'the authored contact endpoint preserves the diagnostic evidence that selected it');
assert.match(compositionActivationSource, /sourceWetPositionProvenance:\s*FINGER_FLUID_PYRO_SOURCE_WET_POSITION_PROVENANCE/, 'composition state exposes the effective wet endpoint provenance to the witness');
assert.match(indexSource, /advanceFingerFluidPyroCompositionSource\(volumePrototype\.debugState\(\)\.simStepCount\)/, 'the Pyro simulation clock drives source geometry in the same domain as flame maturity');
assert.match(indexSource, /volumePrototype\.updateVolumePrimitiveTransform\([\s\S]*position/, 'the burner trajectory moves the live source without rebuilding the established Pyro field');
assert.match(indexSource, /kaminosFingerFluidPyroCompositionDebugState/, 'composition exposes cheap live state without forcing a GPU readback');
assert.match(volumeSource, /setSimulationPaused\(paused\)/, 'Pyro exposes a compute-only pause that leaves composed rendering active');
assert.match(indexSource, /kaminosFingerFluidPyroSetSimulationPaused/, 'composition exposes an explicit render-live witness checkpoint control');
assert.match(witnessSource, /kaminosFingerFluidPyroCompositionDebugState[\s\S]*kaminosFingerFluidPyroSetSimulationPaused\(true\)/, 'visual witness pauses Pyro compute from cheap state before the mature dry frame can be skipped');
assert.match(witnessSource, /kaminosFingerFluidPyroSetSimulationPaused\(false\)[\s\S]*progressionDeadline/, 'visual witness resumes the unchanged simulation before waiting for physical contact');
assert.match(compositionActivationSource, /sourceRadius:\s*VOLUME_SCENE_PRESETS\.tall_plume\.inputRadius[\s\S]*flowRate:\s*VOLUME_SCENE_PRESETS\.tall_plume\.flowRate/, 'downstream geometry preserves the valid tall-plume source dynamics');
assert.match(volumeSource, /const sourceContactRadius\s*=\s*Math\.max\(0\.12,\s*sourcePrimitive\.radius \* 1\.5\)[\s\S]*sourceQuenchRadius:\s*sourceContactRadius/, 'burner contact follows source scale with only a bounded sparse-carrier support margin');
assert.match(volumeSource, /sourceContactRadius:\s*state\.liquidFireSourceContactRadius/, 'composition witness exposes the effective physical burner neighborhood');
assert.match(witnessSource, /sourceContactWetness[^\n]+0/, 'visual witness detects the first actual burner contact instead of waiting on a clock gate');
assert.match(witnessSource, /preContactWitness\?\.consumerWitness\?\.sourceWetness[^\n]+!==\s*0/, 'visual witness dry baseline rejects retained burner wetness as well as current contact');
assert.match(witnessSource, /preContactWitness\?\.consumerWitness\?\.sourceLastContactTick[^\n]+!==\s*0/, 'visual witness dry baseline rejects a stale prior exact-contact event');
assert.doesNotMatch(witnessSource, /midContactWitness\.consumerWitness\.sourceContactWetness\s*>\s*0/, 'visual witness cannot require a transient contact pulse to survive into a later asynchronous readback');
assert.match(witnessSource, /observedPhysicalSourceContact[\s\S]*midContactWitness\.consumerWitness\.sourceWetness\s*>\s*0\.15/, 'visual witness accepts retained source wetness only after the dry baseline proved zero wetness');
assert.match(witnessSource, /sourceCombustion[^\n]+0\.65[^\n]+sourceCombustion[^\n]+0\.50/, 'visual witness enters a bounded intermediate-combustion band before judging temporal flame continuity');
assert.match(witnessSource, /midContactComposedSamples[\s\S]*materialMidFrameCount[\s\S]*>=\s*2/, 'intermediate visual acceptance requires repeated material flame support instead of one lucky frame');
assert.match(witnessSource, /__kaminosCaptureComposedFireSample\s*=\s*async\s*\(presentToCanvas\s*=\s*false\)/, 'composed witness can explicitly present an authoritative readback frame for operator-visible evidence');
assert.match(witnessSource, /kaminosFingerFluidPyroSetSimulationPaused\(true\)[\s\S]*__kaminosCaptureComposedFireSample\(true\)[\s\S]*Page\.captureScreenshot[\s\S]*kaminosFingerFluidPyroSetSimulationPaused\(false\)/, 'intermediate PNG is captured from a paused material frame before the unchanged simulation resumes');
assert.match(witnessSource, /sourceCombustion[^\n]+0\.08/, 'visual witness requires combustion to decay materially before final extinction');
assert.match(witnessSource, /kaminosFingerFluidPyroCompositionSample\(\)/, 'visual witness samples authoritative GPU transfer accounting');
assert.match(witnessSource, /requestedVolumeScene\s*!==\s*'tall_plume'/, 'visual witness rejects the wrong requested Pyro scene');
assert.match(witnessSource, /effectiveVolumeScene\s*!==\s*'tall_plume'/, 'visual witness rejects fallback or stale effective Pyro scenes');
assert.match(witnessSource, /boundarySplatMode\s*!==\s*'learned'/, 'visual witness rejects a disabled or analytic fallback splat route');
assert.match(witnessSource, /boundarySplatRendererIdentity\s*!==\s*'live-boundary-sidecar-learned-attribute-splats-v0'/, 'visual witness requires the learned live renderer identity');
assert.match(witnessSource, /selectiveHeadLiveEffectiveRole\s*!==\s*'truthHigh'/, 'visual witness requires current live field authority rather than replay inference');
assert.match(witnessSource, /selectiveHeadLiveCompositionEffective\s*!==\s*'smoke-raymarch-under-splats-v0'/, 'visual witness rejects composition fallback or an off route');
assert.match(witnessSource, /selectiveHeadLivePassReceipt\?\.raymarchApplied\s*!==\s*true/, 'visual witness requires the smoke raymarch pass to apply');
assert.match(witnessSource, /selectiveHeadLivePassReceipt\?\.splatApplied\s*!==\s*true/, 'visual witness requires the learned fire splat pass to apply');
assert.match(witnessSource, /selectiveHeadLivePassReceipt\?\.fallbackReason/, 'visual witness fails loud on renderer fallback');
assert.match(witnessSource, /contactTransferEnabled\s*!==\s*true/, 'visual witness requires physical transfer to be active from startup');
assert.match(witnessSource, /observedPhysicalSourceContact/, 'visual witness distinguishes dispatch from actual burner overlap');
assert.match(witnessSource, /if\s*\(\(source\?\.sourceLastContactTick\s*\|\|\s*0\)\s*>\s*preContactSourceLastContactTick\)\s*\{[\s\S]*observedPhysicalSourceContact\s*=\s*true/, 'visual witness latches only an exact-contact event newer than its zero baseline');
assert.doesNotMatch(witnessSource, /source\?\.sourceContactWetness[^\n]+\|\|[^\n]+source\?\.sourceWetness/, 'retained source wetness cannot impersonate a fresh physical-contact observation');
assert.match(witnessSource, /verify_manual_pilot_recovery[\s\S]*kaminosFingerFluidPyroSetPilotEnabled\(false\)[\s\S]*sourceWetness[\s\S]*kaminosFingerFluidPyroSetPilotEnabled\(true\)/, 'dynamic witness proves a dry no-auto-reignite interval before applying the explicit pilot');
assert.match(witnessSource, /sourceIgnited[^\n]+0\.5[^\n]+sourceCombustion[^\n]+0\.45/, 'pilot recovery waits for materially restored combustion before judging the recovered flame body');
assert.match(witnessSource, /recoveryWitness\.consumerWitness\?\.sourcePilotEnabled\s*!==\s*true/, 'dynamic recovery must report the live pilot as effective authority');
assert.match(witnessSource, /recoveryWitness\.sourcePilotEnabled\s*!==\s*recoveryWitness\.consumerWitness\?\.sourcePilotEnabled/, 'dynamic recovery rejects contradictory top-level and live-consumer pilot authority');
assert.match(witnessSource, /recoveryComposedSample\.recoveryFireRatio\s*>\s*0\.15/, 'pilot recovery must restore a material fixed-view luminous flame, not only a state bit');
assert.match(witnessSource, /lastCompositionSample/, 'visual witness preserves the latest source geometry and thermal state when contact fails');
assert.match(witnessSource, /preContactOut/, 'visual witness owns a distinct pre-contact image artifact');
assert.match(witnessSource, /midContactOut/, 'visual witness owns a distinct intermediate-contact image artifact');
assert.match(witnessSource, /postContactOut/, 'visual witness owns a distinct final-contact image artifact');
assert.match(indexSource, /kaminosFingerFluidPyroVolumeSample\s*=\s*\(\)\s*=>\s*volumePrototype\.sampleFrame\(\)/, 'composition exposes an explicit one-shot Pyro field sample instead of scheduling hidden readback');
assert.match(witnessSource, /preContactVolumeSample/, 'visual witness records the explicit pre-contact Pyro field sample');
assert.doesNotMatch(witnessSource, /const \{ preview, \.\.\.sample \}/, 'visual witness does not serialize unbounded GPU atlas arrays into its report');
assert.doesNotMatch(witnessSource, /reactionFrontAtlas/, 'visual witness report keeps scalar fire-support evidence instead of copying the full reaction-front atlas');
assert.match(witnessSource, /fireBounds:\s*sample\.fireBounds/, 'visual witness preserves rendered-fire bounds as compact source-honest evidence');
assert.match(witnessSource, /fireLayerMean:\s*sample\.simReadback\?\.fireLayerMean/, 'visual witness preserves scalar simulator fire support as compact source-honest evidence');
assert.match(witnessSource, /captureSelectiveHeadLiveFrame\([\s\S]*advanceSim:\s*false[\s\S]*presentToCanvas,/, 'visual witness reads or explicitly presents the actual composed smoke-plus-splat frame without advancing simulation');
assert.match(witnessSource, /composedFireBounds\?\.pixelCount[^\n]+80/, 'visual witness requires a materially populated composed fire footprint before contact');
assert.match(witnessSource, /composedFireBounds\?\.height[^\n]+40/, 'visual witness requires a materially tall composed fire footprint before contact');
assert.doesNotMatch(witnessSource, /preContactVolumeSample\?\.fireBounds\?\.pixelCount[^\n]+80/, 'raymarch-only readback cannot gate the learned splat composition');
assert.match(witnessSource, /writeFileSync\(preContactOut[\s\S]*composedFireBounds\?\.pixelCount/, 'visual witness preserves the failed visual frame before enforcing the composed-fire gate');
assert.match(witnessSource, /preContactWitness\?\.contactPhase\s*!==\s*'physical-contact-awaiting-overlap'/, 'visual witness rejects a pre-contact capture after physical burner overlap');
assert.match(witnessSource, /writeFileSync\(preContactOut/, 'visual witness writes the no-overlap frame before waiting for physical contact');
assert.match(witnessSource, /--disable-background-timer-throttling/, 'visual witness keeps dynamic RAF evidence running when its Chrome window is occluded');
assert.match(witnessSource, /--disable-renderer-backgrounding/, 'visual witness does not let browser backgrounding freeze the GPU renderer');
assert.match(witnessSource, /lastDebugState\?\.status\s*===\s*'loading'[\s\S]*throw new Error/, 'visual witness fails loud when the primary bench hook never leaves loading');
assert.match(witnessSource, /diagnosticsStateDeadline[\s\S]*diagnosticsCompletionCount[\s\S]*explicitDiagnosticsReceipt/, 'visual witness waits for cached debug state to publish its completed explicit diagnostics receipt');
assert.match(witnessSource, /finalDiagnosticsReceipt[\s\S]*phase\s*=\s*'final_diagnostics_refresh'[\s\S]*kaminosFingerFluidBenchRequestDiagnostics/, 'visual witness requests final diagnostics after composition and cadence work');
assert.match(witnessSource, /FINAL_DIAGNOSTICS_MAX_LAG_STEPS\s*=\s*16/, 'final diagnostics permit measured in-flight simulation progress without accepting an unbounded step lag');
assert.match(witnessSource, /finalDiagnosticsLagSteps[\s\S]*FINAL_DIAGNOSTICS_MAX_LAG_STEPS/, 'visual witness bounds final published diagnostic step lag');
assert.match(witnessSource, /finalDiagnosticsAgeMs[^\n]+3000[\s\S]*phase\s*=\s*null;[\s\S]*writeReport\(\{[\s\S]*ok:\s*true/, 'visual witness validates final published diagnostic freshness immediately before success');
assert.match(witnessSource, /main\(\)\s*\.then\([\s\S]*process\.exit\(0\)/, 'successful visual witness exits after its synchronous report and image writes instead of retaining a CDP socket');
assert.match(witnessSource, /\.catch\(error\s*=>[\s\S]*process\.exit\(1\)/, 'failed visual witness exits nonzero after preserving its durable failure report');
assert.match(witnessSource, /cameraWitness\?\.orbitChanged[^\n]+true/, 'visual witness requires an actual orbit input delta');
assert.match(witnessSource, /cameraWitness\?\.zoomChanged[^\n]+true/, 'visual witness requires an actual zoom input delta');
assert.match(witnessSource, /document\.elementFromPoint\(/, 'visual witness resolves the browser physical hit target instead of dispatching directly to a non-hit-testable proxy');
assert.match(witnessSource, /hitTargetId\s*!==\s*'kaminos-volume-canvas'/, 'visual witness rejects a composition whose physical input lands on the underlying liquid canvas');
assert.match(witnessSource, /dragMoves\.length\s*!==\s*1/, 'visual witness rejects duplicated physical drag delivery');
assert.match(witnessSource, /wheelEvents\.length\s*!==\s*1/, 'visual witness rejects duplicated physical wheel delivery');
assert.match(witnessSource, /wheelEvents\[0\]\.deltaY/, 'visual witness derives expected zoom from the DOM delta actually delivered by the browser');
assert.match(witnessSource, /yawDeltaError[^\n]+CAMERA_DELTA_EPSILON/, 'visual witness rejects doubled or otherwise incorrect orbit deltas');
assert.match(witnessSource, /distanceDeltaError[^\n]+CAMERA_DELTA_EPSILON/, 'visual witness rejects doubled or otherwise incorrect zoom deltas');
assert.match(witnessSource, /cameraWitness\.restoredError[^\n]+CAMERA_DELTA_EPSILON/, 'visual witness restores the original camera before comparing flame states');
assert.match(witnessSource, /postContactComposedSample/, 'visual witness samples the actual composed fire product after sustained contact');
assert.match(witnessSource, /writeFileSync\(postContactOut,\s*Buffer\.from\(postContactScreenshot\.data,\s*'base64'\)\)/, 'visual witness persists the fixed-camera final composition before unrelated downstream diagnostics');
assert.match(witnessSource, /postFireRatio[^\n]+0\.15/, 'visual witness requires decisive fixed-camera luminous-fire collapse rather than ordinary flame variance');
assert.match(witnessSource, /if \(!compositionRequested && quietSupportedPoolCount < 2\)/, 'continuous composition does not impersonate a quiet-pool rest experiment while the generic bench retains its rest gate');
assert.match(witnessSource, /consumerWitness\.quenchDeposited\s*>\s*0/, 'visual witness requires persistent-quench deposition evidence');
assert.match(witnessSource, /consumerWitness\.quenchedCells\s*>\s*0/, 'visual witness requires materially suppressed Pyro cells');
assert.match(witnessSource, /observedPhysicalSourceContact[\s\S]*midContactWitness\.consumerWitness\.sourceWetness\s*>\s*0\.15/, 'visual witness requires retained burner wetness after the exact-contact path was observed');
assert.match(witnessSource, /consumerWitness\.sourceWetness\s*>\s*0\.15/, 'visual witness requires recoverable source wetness');
assert.match(witnessSource, /midContactComposedSample\?\.midFireRatio\s*>\s*0\.15/, 'visual witness requires a material intermediate flame body across its temporal sample');
assert.match(witnessSource, /sameDevice[^\n]+true/, 'visual witness rejects cross-device composition');
assert.match(witnessSource, /receiverTransformId\s*!==\s*'shared-world-unit-cube-to-pyro-near-domain-v0'/, 'visual witness rejects a receiver transform fallback');
assert.match(witnessSource, /acceptedContacts[^\n]+0/, 'visual witness requires consumed sparse contacts');
assert.match(witnessSource, /touchedCells[^\n]+0/, 'visual witness requires spatially touched Pyro cells');
assert.match(witnessSource, /addedVapor[^\n]+0/, 'visual witness requires local vapor addition');

console.log('liquid/fire contact consumer contracts: ok');
