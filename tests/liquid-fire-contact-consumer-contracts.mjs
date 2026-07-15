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

assert.equal(typeof consumer.advanceLiquidFireQuenchReference, 'function', 'consumer exports a deterministic persistent-quench reference');
let sustainedQuench = { quench: 0, heat: 1, fuel: 1, flame: 1 };
for (let step = 0; step < 8; step += 1) {
  sustainedQuench = consumer.advanceLiquidFireQuenchReference(sustainedQuench, { wetness: 0.75 });
}
assert.ok(sustainedQuench.quench > 0.8, `sustained water must saturate persistent quench state: ${JSON.stringify(sustainedQuench)}`);
assert.ok(sustainedQuench.heat < 0.08 && sustainedQuench.fuel < 0.08 && sustainedQuench.flame < 0.03, `sustained water must defeat source replenishment: ${JSON.stringify(sustainedQuench)}`);
const retainedQuench = consumer.advanceLiquidFireQuenchReference({ ...sustainedQuench, heat: 1, fuel: 1, flame: 1 }, { wetness: 0 });
assert.ok(retainedQuench.flame < 0.08, 'persistent wetness suppresses immediate source reignition after one dry frame');

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
assert.equal(consumer.LIQUID_FIRE_CONTACT_STATS_WORDS, 15, 'consumer telemetry includes persistent-quench deposition, suppressed-cell, and source-quench evidence');
assert.match(consumerSource, /quenchDeposited:\s*atomic<u32>/, 'consumer telemetry records newly deposited persistent quench mass');
assert.match(consumerSource, /quenchedCells:\s*atomic<u32>/, 'consumer telemetry records cells under material combustion suppression');
assert.match(consumerSource, /atomicAdd\(&consumerStats\.quenchDeposited,\s*fixedPoint\(depositedQuench\s*-\s*priorQuench\)\)/, 'quench telemetry counts deposition rather than repeatedly counting retained state');
assert.match(consumerSource, /@group\(0\) @binding\(6\) var<storage, read_write> quenchField:\s*array<atomic<u32>>/, 'consumer uses atomic fixed-point quench storage shared with the simulator');
assert.match(consumerSource, /distance\(receiverUnit,\s*consumerParams\.sourceQuench\.xyz\)/, 'source quench is gated by physical contact with the authored burner neighborhood');
assert.match(consumerSource, /atomicMax\(&quenchField\[GRID_CELL_COUNT\],\s*fixedPoint/, 'burner contact latches source quench in the reserved field sentinel instead of adding a storage binding');
assert.match(volumeSource, /quenchDeposited:\s*words\[12\]/, 'composition witness exposes persistent-quench deposition');
assert.match(volumeSource, /quenchedCells:\s*words\[13\]/, 'composition witness exposes the suppressed-cell population');
assert.match(volumeSource, /sourceQuench:\s*words\[14\]/, 'composition witness exposes the latched source-quench strength');

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
assert.match(volumeSource, /@group\(0\) @binding\(11\) var<storage, read> quenchSrc:\s*array<u32>/, 'Pyro simulation reads persistent fixed-point quench state');
assert.match(volumeSource, /@group\(0\) @binding\(12\) var<storage, read_write> quenchDst:\s*array<u32>/, 'Pyro simulation transports persistent fixed-point quench state');
assert.match(volumeSource, /quenchBuffers\s*=\s*\[0,\s*1\]\.map/, 'Pyro allocates ping-ponged quench fields with the simulation state');
assert.match(volumeSource, /gridCellCount\(gridSize\)\s*\+\s*1/, 'quench allocation reserves one source-latch sentinel without adding a storage buffer');
assert.match(volumeSource, /let localQuenchSuppression\s*=\s*smoothstep/, 'simulator derives a continuous combustion suppression strength from persistent wetness');
assert.match(volumeSource, /sourceQuenchIndex\s*=\s*GRID\s*\*\s*GRID\s*\*\s*GRID[\s\S]*quenchSrc\[sourceQuenchIndex\]/, 'simulator reads the persistent burner-quench latch from the resolution-correct reserved quench sentinel');
assert.match(volumeSource, /max\(localQuenchSuppression,\s*sourceQuenchSuppression\)/, 'latched burner quench defeats continuous source reinjection throughout the flame manifold');
assert.match(volumeSource, /flame\s*=\s*flame\s*\*\s*\(1\.0\s*-\s*quenchSuppression/, 'persistent wetness suppresses source-replenished flame inside the simulation');
assert.match(volumeSource, /combustionFrontTopology\s*=\s*combustionFrontTopology\s*\*\s*\(1\.0\s*-\s*quenchSuppression/, 'persistent wetness suppresses transported combustion-front topology');
assert.match(volumeSource, /if\s*\(!liquidFireContactTransferEnabled\)[\s\S]*liquidFireContactSuppressedFrameCount\s*\+=\s*1[\s\S]*return;/, 'disabled transfer suppresses GPU contact dispatch and counts uncoupled frames');
assert.match(indexSource, /FINGER_FLUID_PYRO_CONTACT_DELAY_MS\s*=\s*5500/, 'composition owns an inspectable pre-contact observation window');
assert.match(indexSource, /setLiquidFireContactTransferEnabled\(false/, 'composition starts with liquid/fire transfer disabled');
assert.match(indexSource, /elapsedMs\s*>=\s*FINGER_FLUID_PYRO_CONTACT_DELAY_MS[\s\S]*setLiquidFireContactTransferEnabled\(true/, 'composition only opens the contact gate after the complete delay');
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
assert.match(witnessSource, /uncoupledFrameCount[^\n]+0/, 'visual witness requires frames rendered before coupling begins');
assert.match(witnessSource, /observedContactDelayMs[^\n]+contactDelayMs/, 'visual witness rejects a prematurely opened liquid/fire gate');
assert.match(witnessSource, /preContactOut/, 'visual witness owns a distinct pre-contact image artifact');
assert.match(indexSource, /kaminosFingerFluidPyroVolumeSample\s*=\s*\(\)\s*=>\s*volumePrototype\.sampleFrame\(\)/, 'composition exposes an explicit one-shot Pyro field sample instead of scheduling hidden readback');
assert.match(witnessSource, /preContactVolumeSample/, 'visual witness records the explicit pre-contact Pyro field sample');
assert.doesNotMatch(witnessSource, /const \{ preview, \.\.\.sample \}/, 'visual witness does not serialize unbounded GPU atlas arrays into its report');
assert.doesNotMatch(witnessSource, /reactionFrontAtlas/, 'visual witness report keeps scalar fire-support evidence instead of copying the full reaction-front atlas');
assert.match(witnessSource, /fireBounds:\s*sample\.fireBounds/, 'visual witness preserves rendered-fire bounds as compact source-honest evidence');
assert.match(witnessSource, /fireLayerMean:\s*sample\.simReadback\?\.fireLayerMean/, 'visual witness preserves scalar simulator fire support as compact source-honest evidence');
assert.match(witnessSource, /captureSelectiveHeadLiveFrame\([\s\S]*advanceSim:\s*false[\s\S]*presentToCanvas:\s*false/, 'visual witness reads the actual composed smoke-plus-splat frame without advancing simulation');
assert.match(witnessSource, /composedFireBounds\?\.pixelCount[^\n]+80/, 'visual witness requires a materially populated composed fire footprint before contact');
assert.match(witnessSource, /composedFireBounds\?\.height[^\n]+40/, 'visual witness requires a materially tall composed fire footprint before contact');
assert.doesNotMatch(witnessSource, /preContactVolumeSample\?\.fireBounds\?\.pixelCount[^\n]+80/, 'raymarch-only readback cannot gate the learned splat composition');
assert.match(witnessSource, /writeFileSync\(preContactOut[\s\S]*composedFireBounds\?\.pixelCount/, 'visual witness preserves the failed visual frame before enforcing the composed-fire gate');
assert.match(witnessSource, /preContactWitness\?\.contactPhase\s*!==\s*'uncoupled-observation'/, 'visual witness rejects a pre-contact capture from the wrong runtime phase');
assert.match(witnessSource, /writeFileSync\(preContactOut/, 'visual witness writes the uncoupled frame before waiting for coupled evidence');
assert.match(witnessSource, /--disable-background-timer-throttling/, 'visual witness keeps dynamic RAF evidence running when its Chrome window is occluded');
assert.match(witnessSource, /--disable-renderer-backgrounding/, 'visual witness does not let browser backgrounding freeze the GPU renderer');
assert.match(witnessSource, /lastDebugState\?\.status\s*===\s*'loading'[\s\S]*throw new Error/, 'visual witness fails loud when the primary bench hook never leaves loading');
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
assert.match(witnessSource, /postFireRatio[^\n]+0\.15/, 'visual witness requires decisive fixed-camera luminous-fire collapse rather than ordinary flame variance');
assert.match(witnessSource, /consumerWitness\.quenchDeposited\s*>\s*0/, 'visual witness requires persistent-quench deposition evidence');
assert.match(witnessSource, /consumerWitness\.quenchedCells\s*>\s*0/, 'visual witness requires materially suppressed Pyro cells');
assert.match(witnessSource, /consumerWitness\.sourceQuench\s*>=\s*0\.8/, 'visual witness requires the persistent burner-quench latch to engage materially');
assert.match(witnessSource, /sameDevice[^\n]+true/, 'visual witness rejects cross-device composition');
assert.match(witnessSource, /receiverTransformId\s*!==\s*'shared-world-unit-cube-to-pyro-near-domain-v0'/, 'visual witness rejects a receiver transform fallback');
assert.match(witnessSource, /acceptedContacts[^\n]+0/, 'visual witness requires consumed sparse contacts');
assert.match(witnessSource, /touchedCells[^\n]+0/, 'visual witness requires spatially touched Pyro cells');
assert.match(witnessSource, /addedVapor[^\n]+0/, 'visual witness requires local vapor addition');

console.log('liquid/fire contact consumer contracts: ok');
