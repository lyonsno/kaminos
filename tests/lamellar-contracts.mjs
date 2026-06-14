import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="lamellar"/, 'sidebar exposes a Lamellar tab');
assert.match(index, /id="tab-lamellar"/, 'Lamellar tab content is present');
assert.match(index, /kaminos_lamellar_witness/, 'URL route gate names the Lamellar witness');
assert.match(index, /lamellar-core\.js/, 'index imports the Lamellar witness module');
assert.match(index, /createKaminosLamellarWitness/, 'index initializes the Lamellar route explicitly');
assert.match(index, /function setActiveTab\(/, 'route initialization can activate the Lamellar tab without a click event');
assert.match(index, /id="lamellar-cut-radius"/, 'Lamellar tab exposes cut radius control');
assert.match(index, /id="lamellar-view"/, 'Lamellar tab exposes witness view selector');
assert.match(index, /id="lamellar-layer-count"/, 'Lamellar tab exposes layer count control');
assert.match(index, /id="lamellar-seed"/, 'Lamellar tab exposes procedural seed control');
assert.match(index, /id="lamellar-chirality"/, 'Lamellar tab exposes chirality control');
assert.match(index, /id="lamellar-chirality-pattern"/, 'Lamellar tab exposes chirality pattern through layers');
assert.match(index, /id="lamellar-depth-spacing"/, 'Lamellar tab exposes layer depth spacing control');
assert.match(index, /id="lamellar-chunkiness"/, 'Lamellar tab exposes layer chunkiness control');
assert.match(index, /id="lamellar-chunkiness-variance"/, 'Lamellar tab exposes chunkiness variance control');
assert.match(index, /id="lamellar-layer-rows"/, 'Lamellar tab exposes per-layer authoring rows');
assert.match(index, /id="lamellar-layer-0-chirality"/, 'Lamellar tab exposes layer 0 chirality override');
assert.match(index, /id="lamellar-layer-0-chunkiness"/, 'Lamellar tab exposes layer 0 chunkiness override');
assert.match(index, /id="lamellar-layer-0-strip-count"/, 'Lamellar tab exposes layer 0 strip-count override');
assert.match(index, /id="lamellar-layer-detail"/, 'Lamellar tab exposes selected-layer authoring detail panel');
assert.match(index, /id="lamellar-layer-select-0"/, 'Lamellar tab exposes layer 0 selection control');
assert.match(index, /id="lamellar-layer-select-3"/, 'Lamellar tab exposes layer 3 selection control');
assert.match(index, /id="lamellar-selected-layer-index"/, 'Lamellar tab reports the selected layer identity');
assert.match(index, /id="lamellar-selected-layer-strip-count"/, 'Lamellar tab exposes selected-layer strip-count editor');
assert.match(index, /id="lamellar-add-strip"/, 'Lamellar tab exposes add-strip control for the selected layer');
assert.match(index, /id="lamellar-remove-strip"/, 'Lamellar tab exposes remove-strip control for the selected layer');
assert.match(index, /id="lamellar-selected-layer-strips"/, 'Lamellar tab reports selected-layer strip instances');
assert.match(index, /id="lamellar-strip-profile"/, 'Lamellar tab exposes selected-strip profile authoring panel');
assert.match(index, /id="lamellar-strip-select"/, 'Lamellar tab exposes selected-strip selector');
assert.match(index, /id="lamellar-selected-strip-index"/, 'Lamellar tab reports the selected strip identity');
assert.match(index, /id="lamellar-selected-strip-width"/, 'Lamellar tab exposes selected-strip width control');
assert.match(index, /id="lamellar-selected-strip-thickness"/, 'Lamellar tab exposes selected-strip thickness control');
assert.match(index, /id="lamellar-selected-strip-width-variance"/, 'Lamellar tab exposes selected-strip width variance control');
assert.match(index, /id="lamellar-selected-strip-thickness-variance"/, 'Lamellar tab exposes selected-strip thickness variance control');
assert.match(index, /id="lamellar-selected-strip-gap-pattern"/, 'Lamellar tab exposes selected-strip gap pattern preset');
assert.match(index, /id="lamellar-overlap-bias"/, 'Lamellar tab exposes overlap bias control');
assert.match(index, /id="lamellar-slice-t"/, 'Lamellar tab exposes slice position control');
assert.match(index, /id="lamellar-slice-angle"/, 'Lamellar tab exposes slice angle control');
assert.match(index, /lamellar_cut_radius/, 'URL route can override Lamellar cut radius');
assert.match(index, /lamellar_view/, 'URL route can override Lamellar witness view');
assert.match(index, /lamellar_layers/, 'URL route can override Lamellar placeholder layer count');
assert.match(index, /lamellar_seed/, 'URL route can override Lamellar procedural seed');
assert.match(index, /lamellar_chirality/, 'URL route can override Lamellar chirality');
assert.match(index, /lamellar_chirality_pattern/, 'URL route can override Lamellar layer chirality pattern');
assert.match(index, /lamellar_depth_spacing/, 'URL route can override Lamellar depth spacing');
assert.match(index, /lamellar_chunkiness/, 'URL route can override Lamellar layer chunkiness');
assert.match(index, /lamellar_chunkiness_variance/, 'URL route can override Lamellar chunkiness variance');
assert.match(index, /lamellar_layer_chiralities/, 'URL route can override per-layer chirality values');
assert.match(index, /lamellar_layer_chunkiness/, 'URL route can override per-layer chunkiness values');
assert.match(index, /lamellar_layer_strip_counts/, 'URL route can override per-layer strip counts');
assert.match(index, /lamellar_overlap_bias/, 'URL route can override Lamellar overlap bias');
assert.match(index, /lamellar_slice_t/, 'URL route can override Lamellar slice position');
assert.match(index, /lamellar_slice_angle/, 'URL route can override Lamellar slice angle');
assert.match(index, /function isLamellarRouteActive\(/, 'Lamellar route active check is centralized');
assert.match(index, /selectedLamellarLayerIndex/, 'Lamellar UI tracks selected layer state');
assert.match(index, /selectedLamellarStripIndex/, 'Lamellar UI tracks selected strip state');
assert.match(index, /function setSelectedLamellarLayer\(/, 'Lamellar UI can switch selected layer explicitly');
assert.match(index, /function syncSelectedLamellarLayer\(/, 'Lamellar UI syncs selected-layer authoring controls');
assert.match(index, /function nudgeSelectedLayerStripCount\(/, 'Lamellar UI can add or remove strips from the selected layer');
assert.match(index, /function setSelectedLamellarStrip\(/, 'Lamellar UI can switch selected strip explicitly');
assert.match(index, /function syncSelectedLamellarStrip\(/, 'Lamellar UI syncs selected-strip profile controls');
assert.match(index, /function applySelectedStripProfileOverride\(/, 'Lamellar UI writes selected-strip profile overrides');
assert.match(index, /if \(!isLamellarRouteActive\(\)\) restoreSettings\(\)/, 'Lamellar route starts blank instead of restoring persisted scene/material state');
assert.doesNotMatch(index, /loadDemo\(DEMO_ASSETS\[0\]\)/, 'Kaminos starts blank and only loads demo assets by explicit user action');
assert.match(index, /kaminos-lamellar-witness-v0/, 'UI carries stable Lamellar witness identity');
assert.match(index, /sphere-domain-section-segment-witness-v0/, 'UI carries effective Lamellar route identity');

const corePath = join(root, 'lamellar-core.js');
assert.ok(existsSync(corePath), 'lamellar-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';
assert.match(core, /export function createKaminosLamellarWitness/, 'Lamellar module exports createKaminosLamellarWitness');
assert.match(core, /build\(\{ frame = false \} = \{\}\)/, 'Lamellar rebuild can preserve the current human camera');
assert.match(core, /setControls[\s\S]*build\(\{ frame: false \}\)/, 'slider/control changes rebuild without reframing the camera');
assert.match(core, /setActive[\s\S]*build\(\{ frame: false \}\)/, 'enabling Lamellar builds without moving the current human camera');
assert.match(core, /return \{ setActive, setControls, update, frameCamera, debugState \}/, 'explicit Frame button remains the only camera-framing command');
assert.match(core, /kaminos-lamellar-witness-v0/, 'Lamellar module exposes stable witness identity');
assert.match(core, /sphere-domain-section-segment-witness-v0/, 'Lamellar module records effective route identity');
assert.match(core, /cap_profile/, 'Lamellar module supports the cap-profile witness view');
assert.match(core, /cut_radius_coupling/, 'Lamellar module supports the cut-radius coupling witness view');
assert.match(core, /perpendicular-cutting-edge/, 'Lamellar module exposes the cut-causing perpendicular edge as its own witness actor');
assert.match(core, /cuttingEdgeDescriptor/, 'Lamellar debug state reports the cut-causing edge descriptor');
assert.match(core, /cutAuthorEnvelopeDescriptor/, 'Lamellar debug state reports the neighbor cut-author envelope descriptor');
assert.match(core, /channelCutReceipt/, 'Lamellar debug state reports the channel-cut receipt');
assert.match(core, /neighbor-offset-envelope-terminal-channel-cut/, 'Lamellar core names the neighbor-offset envelope channel-cut mode');
assert.match(core, /neighbor-offset-envelope-rail-contour/, 'Lamellar core names the neighbor-derived terminal rail contour source');
assert.match(core, /selected-neighbor-channel-closeup/, 'Lamellar core records the cut-author witness anchor mode');
assert.match(core, /terminalRailStopCount/, 'Lamellar cut-author receipt records terminal rail stop count');
assert.match(core, /sampledClearanceBand/, 'Lamellar cut-author receipt records sampled clearance band');
assert.match(core, /makeCuttingEdgeGeometry/, 'Lamellar module builds a visible cross-cut edge instead of implying causality through parallel bands');
assert.match(core, /makeCutAuthorEnvelopeGeometry/, 'Lamellar module builds a visible thin neighbor envelope instead of a broad diagnostic slab');
assert.match(core, /stable-strip-width-cut-radius-only-changes-window-caps-gap/, 'Lamellar module preserves width/radius decoupling identity');
assert.match(core, /zero-lift-closed-terminal-cap-slab/, 'Lamellar module preserves closed end-cap sealing identity');
assert.match(core, /temporary-aesthetic-composition-primitive-not-final-lamellar-topology/, 'Lamellar module marks nested shells as placeholder composition only');
assert.match(core, /LamellarSectionSegment/, 'Lamellar core names procedural section descriptors explicitly');
assert.match(core, /LayerStackDescriptor/, 'Lamellar core names the authored layer-stack descriptor explicitly');
assert.match(core, /LayerShellDescriptor/, 'Lamellar core names layer shells as assemblages explicitly');
assert.match(core, /LamellarLayerSpec/, 'Lamellar core names per-layer specs explicitly');
assert.match(core, /LamellarStripInstance/, 'Lamellar core names per-strip instances explicitly');
assert.match(core, /StripProfileDescriptor/, 'Lamellar core names selected-strip profile descriptors explicitly');
assert.match(core, /stripProfileOverrides/, 'Lamellar debug state reports selected-strip profile override inputs');
assert.match(core, /widthVariance/, 'Lamellar core supports strip-local width variance independent of layer chunkiness');
assert.match(core, /thicknessVariance/, 'Lamellar core supports strip-local thickness variance independent of layer thickness');
assert.match(core, /gapPattern/, 'Lamellar core supports strip-local gap pattern presets');
assert.match(core, /splitStripByGapPattern/, 'Lamellar core splits selected strip descriptors by gap-pattern presets before mesh emission');
assert.match(core, /generateLamellarLayerSpecs/, 'Lamellar core generates per-layer specs before section descriptors');
assert.match(core, /generateLamellarStripInstances/, 'Lamellar core expands layer specs into strip instances before mesh emission');
assert.match(core, /generateLamellarSectionSegments/, 'Lamellar core generates data-first section descriptors before mesh emission');
assert.match(core, /sliceLamellarSectionSegments/, 'Lamellar core slices section descriptors before mesh emission');
assert.match(core, /composerDescriptor/, 'Lamellar debug state reports procedural composer descriptor');
assert.match(core, /layerStackDescriptor/, 'Lamellar debug state reports authored layer-stack descriptor');
assert.match(core, /layerSpecs/, 'Lamellar debug state reports per-layer specs');
assert.match(core, /stripInstances/, 'Lamellar debug state reports layer-owned strip instances');
assert.match(core, /stripIds/, 'Lamellar layer specs report their owned strip ids');
assert.match(core, /stripCount/, 'Lamellar layer specs report their authored strip count');
assert.match(core, /chiralityPattern/, 'Lamellar debug state reports chirality pattern through layers');
assert.match(core, /chunkinessBase/, 'Lamellar debug state reports layer chunkiness base');
assert.match(core, /chunkinessVariance/, 'Lamellar debug state reports layer chunkiness variance');
assert.match(core, /layerOverrides/, 'Lamellar debug state reports per-layer override inputs');
assert.match(core, /layerSpecId/, 'Lamellar section descriptors carry layer-spec ancestry');
assert.match(core, /stripInstanceId/, 'Lamellar section descriptors carry strip-instance ancestry');
assert.match(core, /sliceToolDescriptor/, 'Lamellar debug state reports slicing tool descriptor');
assert.match(core, /sliceApplicationReceipt/, 'Lamellar debug state reports effective slice application receipt');
assert.match(core, /generatedSegmentDescriptors/, 'Lamellar debug state reports generated segment descriptors');
assert.match(core, /sectionSegments/, 'Lamellar debug state reports section segment descriptors');
assert.match(core, /capTValues/, 'Lamellar debug state reports cut cap T-values');
assert.match(core, /openEdgeCount/, 'Lamellar debug state reports open-edge evidence');
assert.match(core, /lightHooks/, 'Lamellar debug state reports exported light hooks');
assert.match(core, /effectiveRoute/, 'Lamellar debug state reports effective route identity');
assert.match(core, /cameraPosition/, 'Lamellar debug state reports camera position for slider-preservation witnesses');
assert.match(core, /cameraTarget/, 'Lamellar debug state reports camera target for slider-preservation witnesses');

const witnessPath = join(root, 'lamellar-witness.mjs');
assert.ok(existsSync(witnessPath), 'lamellar-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_lamellar_witness=1/, 'witness captures the explicit Lamellar route');
assert.match(witness, /effectiveRoute/, 'witness records effective route identity');
assert.match(witness, /sphere-domain-section-segment-witness-v0/, 'witness requires the Lamellar route identity');
assert.match(witness, /requestedView/, 'witness records requested view');
assert.match(witness, /effectiveView/, 'witness records effective view');
assert.match(witness, /requestedCutRadius/, 'witness records requested cut radius');
assert.match(witness, /effectiveCutRadius/, 'witness records effective cut radius');
assert.match(witness, /capTValues/, 'witness records cap T-values');
assert.match(witness, /cuttingEdgeDescriptor/, 'witness records cut-causing edge descriptor');
assert.match(witness, /cutAuthorEnvelopeDescriptor/, 'witness records cut-author envelope descriptor');
assert.match(witness, /channelCutReceipt/, 'witness records channel-cut receipt');
assert.match(witness, /composerDescriptor/, 'witness records procedural composer descriptor');
assert.match(witness, /layerStackDescriptor/, 'witness records layer-stack descriptor');
assert.match(witness, /layerSpecs/, 'witness records per-layer specs');
assert.match(witness, /stripInstances/, 'witness records layer-owned strip instances');
assert.match(witness, /selectedLayerUi/, 'witness records selected-layer UI state');
assert.match(witness, /lamellar-selected-layer-strips/, 'witness inspects selected-layer strip readout');
assert.match(witness, /selectedStripUi/, 'witness records selected-strip profile UI state');
assert.match(witness, /lamellar-selected-strip-width/, 'witness inspects selected-strip width control');
assert.match(witness, /stripProfileOverrides/, 'witness records selected-strip profile override inputs');
assert.match(witness, /stripProfileDescriptors/, 'witness records selected-strip profile descriptors');
assert.match(witness, /layerOverrides/, 'witness records per-layer override inputs');
assert.match(witness, /sliceToolDescriptor/, 'witness records slicing tool descriptor');
assert.match(witness, /sliceApplicationReceipt/, 'witness records slice application receipt');
assert.match(witness, /segmentDescriptorCount/, 'witness records generated descriptor count');
assert.match(witness, /lightHookCount/, 'witness records exported light hook count');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
assert.match(witness, /assertVisualDiversity/, 'witness checks screenshot pixel diversity, not only file size');

const coreModule = await import(`${pathToFileURL(corePath).href}?contract=${Date.now()}`);
const lowChunk = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.05,
  chunkinessVariance: 0,
  overlapBias: 1,
});
const highChunk = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.96,
  chunkinessVariance: 0,
  overlapBias: 1,
});

function shapeSignature(generated) {
  return generated.descriptors.map(d => ({
    id: d.id,
    layerSpecId: d.layerSpecId,
    stripInstanceId: d.stripInstanceId,
    stripIndex: d.stripIndex,
    role: d.materialRole,
    layerIndex: d.layerIndex,
    chirality: d.chirality,
    interval: d.interval,
    theta0: d.theta0,
    thetaTwist: d.thetaTwist,
    phi0: d.phi0,
    phiSlope: d.phiSlope,
    phase: d.phase,
    radius: d.radius,
    waviness: d.waviness,
    segmentCount: d.segmentCount,
  }));
}

function massSignature(generated) {
  return generated.descriptors.map(d => ({
    id: d.id,
    layerSpecId: d.layerSpecId,
    stripInstanceId: d.stripInstanceId,
    stripIndex: d.stripIndex,
    chunkiness: d.chunkiness,
    width: d.width,
    thickness: d.thickness,
  }));
}

assert.deepEqual(
  shapeSignature(lowChunk),
  shapeSignature(highChunk),
  'chunkiness changes mass/width only, not layer shape, centerline law, intervals, or descriptor count'
);
assert.notDeepEqual(
  massSignature(lowChunk),
  massSignature(highChunk),
  'chunkiness still changes authored layer mass fields'
);

const assembled = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 1,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.22, stripCount: 3 },
    { layerIndex: 1, chirality: -1, chunkiness: 1, stripCount: 2 },
    { layerIndex: 2, chirality: 1, chunkiness: 0.36, stripCount: 2 },
    { layerIndex: 3, chirality: -1, chunkiness: 0.58, stripCount: 1 },
  ],
});
assert.equal(assembled.layerSpecs.length, 4, 'assembler preserves requested layer count');
assert.ok(assembled.stripInstances.length > assembled.layerSpecs.length, 'layer shells expand to more strip instances than layer specs');
assert.deepEqual(
  assembled.layerSpecs.map(layer => layer.stripIds.length),
  [3, 2, 2, 1],
  'each layer spec owns the requested strip ids'
);
assert.ok(
  assembled.stripInstances.every(strip => strip.kind === 'LamellarStripInstance' && strip.layerSpecId && Number.isInteger(strip.stripIndex)),
  'every strip instance carries kind, layer ancestry, and strip index'
);
assert.ok(
  assembled.descriptors.every(descriptor => descriptor.stripInstanceId && Number.isInteger(descriptor.stripIndex)),
  'every emitted descriptor carries strip-instance ancestry'
);

const profiled = coreModule.generateLamellarSectionSegments({
  seed: 31,
  layerCount: 4,
  chiralityPattern: 'alternating',
  depthSpacing: 0.09,
  chunkinessBase: 0.4,
  chunkinessVariance: 0,
  overlapBias: 1,
  layerOverrides: [
    { layerIndex: 0, chirality: 1, chunkiness: 0.22, stripCount: 3 },
    { layerIndex: 1, chirality: -1, chunkiness: 1, stripCount: 2 },
    { layerIndex: 2, chirality: 1, chunkiness: 0.36, stripCount: 2 },
    { layerIndex: 3, chirality: -1, chunkiness: 0.58, stripCount: 1 },
  ],
  stripProfileOverrides: [
    {
      stripInstanceId: 'seed-31-layer-0-strip-1',
      width: 0.044,
      thickness: 0.031,
      widthVariance: 0.4,
      thicknessVariance: 0.2,
      gapPattern: 'dashed',
    },
  ],
});
const profiledStrip = profiled.stripInstances.find(strip => strip.id === 'seed-31-layer-0-strip-1');
assert.equal(profiledStrip?.stripProfileDescriptor?.kind, 'StripProfileDescriptor', 'profiled strip carries a named strip profile descriptor');
assert.equal(profiledStrip.stripProfileDescriptor.width, 0.044, 'strip profile width override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.thickness, 0.031, 'strip profile thickness override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.widthVariance, 0.4, 'strip profile width variance override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.thicknessVariance, 0.2, 'strip profile thickness variance override is preserved independently');
assert.equal(profiledStrip.stripProfileDescriptor.gapPattern, 'dashed', 'strip profile gap pattern override is preserved');
const profiledDescriptors = profiled.descriptors.filter(descriptor => descriptor.stripInstanceId === 'seed-31-layer-0-strip-1');
assert.ok(profiledDescriptors.length > 1, 'dashed selected-strip profile emits multiple descriptor spans for authored gaps');
assert.ok(
  profiledDescriptors.every(descriptor =>
    descriptor.stripProfileDescriptor?.kind === 'StripProfileDescriptor'
    && descriptor.width === 0.044
    && descriptor.thickness === 0.031
    && descriptor.widthVariance === 0.4
    && descriptor.thicknessVariance === 0.2
    && descriptor.gapPattern === 'dashed'
  ),
  'profiled descriptors carry selected-strip width, thickness, variance, and gap pattern receipts'
);

const sliced = coreModule.sliceLamellarSectionSegments(highChunk.descriptors, {
  cutRadius: 0.052,
  sliceT: 0.352,
  sliceAngle: -11,
});
assert.equal(
  sliced.channelCutReceipt.mode,
  'neighbor-offset-envelope-terminal-channel-cut',
  'slice receipt identifies B offset envelope as the cut author'
);
assert.equal(
  sliced.channelCutReceipt.terminalContourSource,
  'neighbor-offset-envelope-rail-contour',
  'slice receipt identifies the neighbor-derived terminal contour source'
);
assert.ok(
  sliced.channelCutReceipt.channelGapRadius > 0,
  'slice receipt records a positive channel gap radius'
);
assert.equal(
  sliced.channelCutReceipt.terminalRailStopCount,
  30,
  'slice receipt keeps a stable rail-stop count for the channel contour'
);
assert.equal(
  sliced.channelCutReceipt.witnessAnchorMode,
  'selected-neighbor-channel-closeup',
  'slice receipt records the cut-author witness anchor mode'
);
assert.match(
  sliced.channelCutReceipt.sourceStripInstanceId,
  /^seed-31-layer-1-strip-/,
  'channel-cut receipt points at a specific cut-author strip instance'
);
