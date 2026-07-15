import assert from 'node:assert/strict';

import {
  STAGE_ATOMS_SCHEMA,
  STAGE_ATOMS_ROUTE_IDENTITY,
  MATERIAL_STAGE_FRAME_SCHEMA,
  MATERIAL_SPATIALIZATION_SCHEMA,
  buildStageAtoms,
  buildStageAtomsWitness,
  classifyAudioSourceAccess,
  simulateStageMaterialFrame,
  spatializeFromStageMaterial,
} from '../stage-atoms-core.mjs';

const ccmixterSource = classifyAudioSourceAccess({
  sourceKind: 'ccmixter',
  trackId: 'ccmixter:test-vocal-001',
  title: 'Lawful Test Vocal',
  artist: 'Example Artist',
  license: 'CC BY 3.0',
  attribution: 'Example Artist - Lawful Test Vocal - CC BY 3.0',
  downloadUrl: 'https://ccmixter.example.test/files/example/lawful-test-vocal.wav',
});

assert.equal(ccmixterSource.schema, 'kaminos.stage-audio-source-access.v0');
assert.equal(ccmixterSource.accessClass, 'open_transformable');
assert.equal(ccmixterSource.analysisAllowed, true);
assert.equal(ccmixterSource.transformAllowed, true);
assert.equal(ccmixterSource.syncAllowed, true);
assert.equal(ccmixterSource.publicDemoAllowed, true);
assert.deepEqual(ccmixterSource.receiptWarnings, []);

const bandcampSource = classifyAudioSourceAccess({
  sourceKind: 'bandcamp_purchase',
  trackId: 'bandcamp:private-taste-001',
  title: 'Private Taste Track',
  artist: 'Purchased Artist',
  license: 'personal_purchase',
  localPath: 'fixtures/audio/private-taste-track.flac',
});

assert.equal(bandcampSource.accessClass, 'private_local_taste');
assert.equal(bandcampSource.analysisAllowed, true);
assert.equal(bandcampSource.transformAllowed, true);
assert.equal(bandcampSource.syncAllowed, true);
assert.equal(bandcampSource.publicDemoAllowed, false);
assert.ok(bandcampSource.receiptWarnings.includes('public_demo_requires_separate_permission'));

const spotifyReference = classifyAudioSourceAccess({
  sourceKind: 'spotify_reference',
  trackId: 'spotify:track:example',
  title: 'Reference Only',
  artist: 'Streaming Artist',
  license: 'streaming_reference',
});

assert.equal(spotifyReference.accessClass, 'reference_only');
assert.equal(spotifyReference.analysisAllowed, false);
assert.equal(spotifyReference.transformAllowed, false);
assert.equal(spotifyReference.syncAllowed, false);
assert.equal(spotifyReference.publicDemoAllowed, false);
assert.ok(spotifyReference.receiptWarnings.includes('no_lawful_pcm_fuel'));

const stage = buildStageAtoms({
  sourceAccess: ccmixterSource,
  design: {
    schema: 'pulp.design-ir.stage-atoms-fixture.v0',
    sourceAdapter: 'pulp-design-ir-derived-fixture',
    controls: [
      {
        id: 'filter.cutoff',
        kind: 'knob',
        label: 'Cutoff',
        paramKey: 'filter.cutoff',
        rect: [410, 180, 64, 64],
        confidence: 0.92,
        sourceNodeId: 'figma-node-cutoff',
      },
      {
        id: 'delay.feedback',
        kind: 'xy_pad',
        label: 'Feedback Space',
        paramKey: 'delay.feedback',
        rect: [240, 310, 140, 120],
        confidence: 0.84,
        sourceNodeId: 'figma-node-feedback',
      },
    ],
    viewport: [800, 600],
  },
  graph: {
    schema: 'pulp.graph-runtime-plan-derived-fixture.v0',
    nodes: [
      { id: 1, kind: 'AudioInput', label: 'Input', level: 0, latencySamples: 0 },
      { id: 2, kind: 'Processor', label: 'Cutoff', level: 1, latencySamples: 64, paramKey: 'filter.cutoff' },
      { id: 3, kind: 'Processor', label: 'Feedback Space', level: 2, latencySamples: 128, paramKey: 'delay.feedback' },
      { id: 4, kind: 'AudioOutput', label: 'Output', level: 3, latencySamples: 0 },
    ],
    connections: [
      { sourceNode: 1, destNode: 2, kind: 'Audio', feedback: false },
      { sourceNode: 2, destNode: 3, kind: 'Automation', feedback: false },
      { sourceNode: 3, destNode: 2, kind: 'Audio', feedback: true },
      { sourceNode: 3, destNode: 4, kind: 'Audio', feedback: false },
    ],
  },
});

assert.equal(stage.schema, STAGE_ATOMS_SCHEMA);
assert.equal(stage.routeIdentity, STAGE_ATOMS_ROUTE_IDENTITY);
assert.equal(stage.sourceAccess.accessClass, 'open_transformable');
assert.equal(stage.atoms.length, 4);
assert.equal(stage.atoms.find(atom => atom.id === 'filter.cutoff').materialRegion.bindingAuthority, 'pulp-design-ir-param-key');
assert.equal(stage.atoms.find(atom => atom.id === 'delay.feedback').graph.feedbackIncoming, true);
assert.ok(stage.atoms.every(atom => atom.stage.position.length === 3), 'every atom has a 3D stage position');
assert.ok(stage.atoms.every(atom => atom.stage.position.every(Number.isFinite)), 'stage positions are finite');
assert.ok(stage.stageBounds.radius > 0.5, 'stage bounds expose a nonzero spatial extent');
assert.deepEqual(stage.falseCloseWarnings, []);
assert.equal(stage.atoms.find(atom => atom.id === '1').materialRegion.localControl?.role, 'drive');
assert.equal(stage.atoms.find(atom => atom.id === 'filter.cutoff').materialRegion.localControl?.role, 'aperture');
assert.equal(stage.atoms.find(atom => atom.id === 'delay.feedback').materialRegion.localControl?.role, 'recirculation');
assert.equal(stage.atoms.find(atom => atom.id === '4').materialRegion.localControl?.role, 'release');

const materialFrame = simulateStageMaterialFrame(stage, {
  t: 1.25,
  audioFeatures: {
    energy: 0.73,
    onsetStrength: 0.62,
    recurrenceConfidence: 0.48,
    spectralCentroid: 0.66,
  },
});

assert.equal(materialFrame.schema, MATERIAL_STAGE_FRAME_SCHEMA);
assert.equal(materialFrame.routeIdentity, STAGE_ATOMS_ROUTE_IDENTITY);
assert.equal(materialFrame.materialAuthority, 'stage-atoms-plus-lawful-audio-v0');
assert.ok(materialFrame.materialAtoms.find(atom => atom.id === 'delay.feedback').field.feedbackMemory > 0.3);
assert.ok(materialFrame.materialAtoms.find(atom => atom.id === '1').field.excitation > 0.2);
assert.ok(materialFrame.receipts.some(receipt => receipt.kind === 'audio_source_access'));
assert.ok(materialFrame.receipts.some(receipt => receipt.kind === 'stage_atom_binding'));

const spatial = spatializeFromStageMaterial(materialFrame, {
  rawAudioFeatures: { energy: 0.0, onsetStrength: 0.0, spectralCentroid: 0.0 },
});

assert.equal(spatial.schema, MATERIAL_SPATIALIZATION_SCHEMA);
assert.equal(spatial.spatializationAuthority, 'material-stage-atoms-v0');
assert.equal(spatial.rawAudioFeatureUse, 'ignored_after_material_frame');
assert.ok(spatial.emitters.length >= 2);
assert.ok(spatial.emitters.some(emitter => emitter.id === 'delay.feedback' && emitter.send.reverb > 0.1));
assert.ok(spatial.emitters.every(emitter => Number.isFinite(emitter.position[0]) && Number.isFinite(emitter.send.pan)));

const spatialWithDifferentRawAudio = spatializeFromStageMaterial(materialFrame, {
  rawAudioFeatures: { energy: 1.0, onsetStrength: 1.0, spectralCentroid: 1.0 },
});

assert.deepEqual(
  spatialWithDifferentRawAudio.emitters,
  spatial.emitters,
  'spatialization must read the material frame, not raw audio features supplied at the final stage',
);

function runNodeControlScenario(nodeControls) {
  let previousMaterialFrame = null;
  for (let index = 0; index < 28; index += 1) {
    previousMaterialFrame = simulateStageMaterialFrame(stage, {
      t: index * 0.05,
      dt: 0.05,
      previousMaterialFrame,
      nodeControls,
      audioFeatures: {
        energy: 0.58,
        onsetStrength: index % 5 === 0 ? 0.74 : 0.16,
        recurrenceConfidence: 0.62,
        spectralCentroid: 0.44,
      },
    });
  }
  return previousMaterialFrame;
}

const baselineNodeFrame = runNodeControlScenario({ '1': 1, 'filter.cutoff': 1, 'delay.feedback': 1, '4': 1 });
const drivenInputFrame = runNodeControlScenario({ '1': 1.9, 'filter.cutoff': 1, 'delay.feedback': 1, '4': 1 });
const openedCutoffFrame = runNodeControlScenario({ '1': 1, 'filter.cutoff': 1.9, 'delay.feedback': 1, '4': 1 });
const recirculatingFeedbackFrame = runNodeControlScenario({ '1': 1, 'filter.cutoff': 1, 'delay.feedback': 1.9, '4': 1 });
const releasedOutputFrame = runNodeControlScenario({ '1': 1, 'filter.cutoff': 1, 'delay.feedback': 1, '4': 1.9 });
const fieldFor = (frame, id) => frame.materialAtoms.find(atom => atom.id === id).field;

assert.deepEqual(drivenInputFrame.nodeControls, { '1': 1.9, '4': 1, 'filter.cutoff': 1, 'delay.feedback': 1 });
assert.ok(fieldFor(drivenInputFrame, '1').excitation > fieldFor(baselineNodeFrame, '1').excitation + 0.12, 'Input drive changes the touched region first');
assert.ok(fieldFor(drivenInputFrame, 'filter.cutoff').incomingFlux > fieldFor(baselineNodeFrame, 'filter.cutoff').incomingFlux + 0.04, 'Input drive changes lawful outgoing flux');
assert.ok(
  fieldFor(drivenInputFrame, '4').heat > fieldFor(baselineNodeFrame, '4').heat + 0.04,
  `Input drive changes downstream Output organization: baseline=${fieldFor(baselineNodeFrame, '4').heat} driven=${fieldFor(drivenInputFrame, '4').heat}`,
);
assert.ok(Math.abs(fieldFor(releasedOutputFrame, '1').heat - fieldFor(baselineNodeFrame, '1').heat) < 0.015, 'Output release cannot counterfeit upstream Input causation');
assert.ok(
  fieldFor(openedCutoffFrame, 'filter.cutoff').excitation > fieldFor(baselineNodeFrame, 'filter.cutoff').excitation + 0.08,
  `Cutoff aperture admits more routed excitation: baseline=${fieldFor(baselineNodeFrame, 'filter.cutoff').excitation} open=${fieldFor(openedCutoffFrame, 'filter.cutoff').excitation}`,
);
assert.ok(
  fieldFor(recirculatingFeedbackFrame, 'delay.feedback').feedbackMemory > fieldFor(baselineNodeFrame, 'delay.feedback').feedbackMemory + 0.08,
  `Feedback recirculation retains more memory: baseline=${fieldFor(baselineNodeFrame, 'delay.feedback').feedbackMemory} recirculating=${fieldFor(recirculatingFeedbackFrame, 'delay.feedback').feedbackMemory}`,
);
const baselineOutputSend = spatializeFromStageMaterial(baselineNodeFrame).emitters.find(emitter => emitter.id === '4').send;
const releasedOutputSend = spatializeFromStageMaterial(releasedOutputFrame).emitters.find(emitter => emitter.id === '4').send;
const baselineFeedbackSend = spatializeFromStageMaterial(baselineNodeFrame).emitters.find(emitter => emitter.id === 'delay.feedback').send;
const recirculatingFeedbackSend = spatializeFromStageMaterial(recirculatingFeedbackFrame).emitters.find(emitter => emitter.id === 'delay.feedback').send;
assert.ok(
  recirculatingFeedbackSend.reverb > baselineFeedbackSend.reverb + 0.04,
  `Feedback recirculation changes its spatial-memory send: baseline=${baselineFeedbackSend.reverb} recirculating=${recirculatingFeedbackSend.reverb}`,
);
assert.ok(
  releasedOutputSend.direct > baselineOutputSend.direct + 0.08,
  `Output release changes local audio radiation: baseline=${baselineOutputSend.direct} released=${releasedOutputSend.direct}`,
);

function runMaterialHistory(nodeControlHistory) {
  let previousMaterialFrame = null;
  for (const [index, nodeControls] of nodeControlHistory.entries()) {
    previousMaterialFrame = simulateStageMaterialFrame(stage, {
      t: index * 0.05,
      dt: 0.05,
      previousMaterialFrame,
      nodeControls,
      audioFeatures: {
        energy: 0.64,
        onsetStrength: index % 4 === 0 ? 0.78 : 0.12,
        recurrenceConfidence: 0.71,
        spectralCentroid: 0.46,
      },
    });
  }
  return previousMaterialFrame;
}

const finalNodeControls = { '1': 1, '4': 1, 'filter.cutoff': 1, 'delay.feedback': 1 };
const pathAFrame = runMaterialHistory([
  ...Array.from({ length: 18 }, () => ({ ...finalNodeControls, '1': 1.8, 'delay.feedback': 0.2 })),
  ...Array.from({ length: 18 }, () => ({ ...finalNodeControls, '1': 0.35, 'delay.feedback': 1.8 })),
  ...Array.from({ length: 2 }, () => finalNodeControls),
]);
const pathBFrame = runMaterialHistory([
  ...Array.from({ length: 18 }, () => ({ ...finalNodeControls, '1': 0.35, 'delay.feedback': 1.8 })),
  ...Array.from({ length: 18 }, () => ({ ...finalNodeControls, '1': 1.8, 'delay.feedback': 0.2 })),
  ...Array.from({ length: 2 }, () => finalNodeControls),
]);

assert.deepEqual(pathAFrame.nodeControls, finalNodeControls, 'path A receipts the shared final node controls');
assert.deepEqual(pathBFrame.nodeControls, finalNodeControls, 'path B receipts the shared final node controls');
assert.equal('materialControls' in pathAFrame, false, 'the simulator does not preserve a hidden global-control contract');
assert.notDeepEqual(
  pathAFrame.materialAtoms.map(atom => atom.field.feedbackMemory),
  pathBFrame.materialAtoms.map(atom => atom.field.feedbackMemory),
  'reversed gestures must leave different bounded regional memory at identical final controls',
);
const materialStateDistance = pathAFrame.materialAtoms.reduce((sum, atom, index) => {
  const other = pathBFrame.materialAtoms[index];
  return sum + ['excitation', 'feedbackMemory', 'coherence', 'refractory']
    .reduce((fieldSum, key) => fieldSum + Math.abs(atom.field[key] - other.field[key]), 0);
}, 0);
assert.ok(materialStateDistance > 0.12, `history distance must be material, received ${materialStateDistance}`);
const pathASpatial = spatializeFromStageMaterial(pathAFrame);
const pathBSpatial = spatializeFromStageMaterial(pathBFrame);
assert.notDeepEqual(
  pathASpatial.emitters,
  pathBSpatial.emitters,
  'history-bearing material organization must alter the spatial-audio projection',
);
const spatialSendDistance = pathASpatial.emitters.reduce((sum, emitter, index) => {
  const other = pathBSpatial.emitters[index];
  return sum + ['direct', 'reverb', 'spread']
    .reduce((fieldSum, key) => fieldSum + Math.abs(emitter.send[key] - other.send[key]), 0);
}, 0);
assert.ok(spatialSendDistance > 0.05, `history-derived send distance must be material, received ${spatialSendDistance}`);

let rawAudioOnlyFailure;
assert.throws(
  () => buildStageAtomsWitness({
    sourceAccess: spotifyReference,
    design: { controls: [] },
    graph: { nodes: [], connections: [] },
    audioFeatures: { energy: 1 },
  }),
  error => {
    rawAudioOnlyFailure = error;
    return /analysis_not_allowed/.test(error.message);
  },
  /analysis_not_allowed/,
);
assert.equal(rawAudioOnlyFailure.code, 'analysis_not_allowed');

const witness = buildStageAtomsWitness({
  sourceAccess: ccmixterSource,
  design: stage.sourceDesign,
  graph: stage.sourceGraph,
  audioFeatures: { energy: 0.73, onsetStrength: 0.62, recurrenceConfidence: 0.48, spectralCentroid: 0.66 },
  t: 1.25,
});

assert.equal(witness.schema, 'kaminos.stage-atoms-witness.v0');
assert.equal(witness.stage.schema, STAGE_ATOMS_SCHEMA);
assert.equal(witness.materialFrame.schema, MATERIAL_STAGE_FRAME_SCHEMA);
assert.equal(witness.spatialization.schema, MATERIAL_SPATIALIZATION_SCHEMA);
assert.equal(witness.falseCloseChecks.spotifyReferenceRejected, true);
assert.equal(witness.falseCloseChecks.spatializerIgnoresRawAudio, true);
assert.equal(witness.operatorHandle.sourcePanel.primarySourceKind, 'ccmixter');
assert.equal(witness.operatorHandle.nextVisibleRoute, 'stage-atoms-browser-witness-v0');
