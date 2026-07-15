import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertMatchedAudioTransductionEvidence,
  evaluateMatchedAudioTransductionEvidence,
} from '../stage-atoms-browser-witness-contract.mjs';

const root = resolve(import.meta.dirname, '..');
const htmlPath = resolve(root, 'stage-atoms-browser.html');
const modulePath = resolve(root, 'stage-atoms-browser.mjs');
const witnessPath = resolve(root, 'stage-atoms-browser-witness.mjs');

assert.ok(existsSync(htmlPath), 'Stage Atoms browser route must exist');
assert.ok(existsSync(modulePath), 'Stage Atoms browser runtime must exist');
assert.ok(existsSync(witnessPath), 'Stage Atoms reusable browser witness must exist');

const html = readFileSync(htmlPath, 'utf8');
const source = readFileSync(modulePath, 'utf8');
const witness = readFileSync(witnessPath, 'utf8');

const audioSample = ({
  startTime = 38.4,
  endTime = 39.04,
  outputRms = 0.2,
  spectralCentroidHz = 800,
  highBandRatio = 0.05,
  authority = 'role-ordered-material-dsp',
} = {}) => ({
  sampleCount: 8,
  startTime,
  endTime,
  outputRms,
  spectralCentroidHz,
  highBandRatio,
  effectiveParameters: { authority },
});
const validAudioScenarios = {
  closedAperture: audioSample(),
  openAperture: audioSample({ spectralCentroidHz: 1600, highBandRatio: 0.12 }),
  quietRelease: audioSample({ outputRms: 0.025 }),
  loudRelease: audioSample({ outputRms: 0.25 }),
};
const evaluatedAudioEvidence = evaluateMatchedAudioTransductionEvidence(validAudioScenarios);
assert.equal(evaluatedAudioEvidence.matchedWindows, true);
assert.equal(evaluatedAudioEvidence.effectiveRouteExecuted, true);
assert.doesNotThrow(() => assertMatchedAudioTransductionEvidence(validAudioScenarios));
assert.throws(
  () => assertMatchedAudioTransductionEvidence({ ...validAudioScenarios, openAperture: audioSample({ spectralCentroidHz: 900, highBandRatio: 0.055 }) }),
  /weak_aperture_spectral_delta/,
  'matched audio evidence fails when Aperture does not alter actual output spectrum',
);
assert.throws(
  () => assertMatchedAudioTransductionEvidence({ ...validAudioScenarios, loudRelease: audioSample({ outputRms: 0.03 }) }),
  /weak_release_output_delta/,
  'matched audio evidence fails when Release does not alter actual radiated output',
);
assert.throws(
  () => assertMatchedAudioTransductionEvidence({ ...validAudioScenarios, openAperture: audioSample({ startTime: 38.5, endTime: 39.14, spectralCentroidHz: 1600, highBandRatio: 0.12 }) }),
  /source_window_mismatch/,
  'matched audio evidence fails when scenarios sampled different source windows',
);
assert.throws(
  () => assertMatchedAudioTransductionEvidence({ ...validAudioScenarios, loudRelease: audioSample({ outputRms: 0.25, authority: 'parallel-raw-source-fallback' }) }),
  /effective_audio_route_mismatch/,
  'matched audio evidence fails when a fallback route produced the output',
);
assert.throws(
  () => assertMatchedAudioTransductionEvidence({
    closedAperture: audioSample({ outputRms: 0.000001 }),
    openAperture: audioSample({ outputRms: 0.000003, spectralCentroidHz: 1600, highBandRatio: 0.12 }),
    quietRelease: audioSample({ outputRms: 0.000001 }),
    loudRelease: audioSample({ outputRms: 0.000003 }),
  }),
  /silent_audio_scenario/,
  'large ratios cannot counterfeit matched output that is effectively silent',
);

assert.match(html, /stage-atoms-browser\.mjs/, 'route loads the Stage Atoms runtime');
assert.match(html, /id="stage-atoms-canvas"/, 'route exposes the material stage canvas');
assert.match(html, /id="stage-atoms-play"/, 'route exposes a stable transport handle');
assert.match(html, /id="stage-atoms-seek"/, 'route exposes an audio-clock seek handle');
assert.match(html, /id="stage-atoms-reset"/, 'route exposes a retained-state reset handle');
assert.match(html, /id="material-selected-name"/, 'rail identifies the directly selected material region');
assert.match(html, /id="material-selected-role"/, 'rail receipts the selected node-local control role');
assert.match(html, /id="material-selected-value"/, 'rail receipts the selected node-local control value');
assert.doesNotMatch(html, /id="stage-atoms-(coupling|memory|depth|history-a|history-b)"/, 'global performance controls no longer hide causal ownership in the rail');
assert.match(html, /id="material-memory"/, 'route exposes retained regional memory beside decoded drive');
assert.match(html, /id="material-coherence"/, 'route exposes population coherence beside decoded drive');
assert.match(html, /data-stage-source-authority/, 'operator surface exposes source authority');
assert.match(html, /data-stage-route-authority/, 'operator surface exposes route authority');
assert.match(html, /data-stage-fallback-authority/, 'operator surface exposes fallback authority');

assert.match(source, /ccmixter-geppetto-decoded-stage-atoms-witness\.json/, 'browser consumes the decoded witness report');
assert.match(source, /coruscate-geppetto-dry-main\.mp3/, 'browser consumes the local verified audio cache');
assert.match(source, /simulateStageMaterialFrame/, 'browser derives current material state from Stage Atoms');
assert.match(source, /previousMaterialFrame/, 'browser advances from retained material state instead of recomputing stateless frames');
assert.match(source, /materialFlows/, 'browser renders activity from lawful Pulp-routed material transfer');
assert.match(source, /resetMaterialState/, 'browser lets the operator clear retained organization explicitly');
assert.match(source, /nodeControlValues/, 'browser owns explicit per-node control state');
assert.match(source, /nodeControls/, 'browser passes per-node controls into the material transition');
assert.match(source, /hitTestStageAtom/, 'browser resolves direct canvas contact to one material region');
assert.match(source, /pointerdown/, 'material regions accept direct pointer contact');
assert.match(source, /pointermove/, 'vertical material-region gestures change the local control');
assert.match(source, /setPointerCapture/, 'direct manipulation remains stable while the pointer leaves the body');
assert.match(source, /spatializeFromStageMaterial/, 'browser derives audio placement from current material state');
assert.match(source, /decodeAudioData/, 'browser decodes the verified source bytes into its live audio clock substrate');
assert.match(source, /createBufferSource/, 'browser transport uses recreatable WebAudio buffer sources');
assert.match(source, /audioContext\.currentTime/, 'WebAudio clock is the live feature-frame authority');
assert.match(source, /transportOffsetSeconds/, 'browser preserves representative start and operator seeks as explicit clock state');
assert.match(source, /crypto\.subtle\.digest/, 'browser verifies fetched audio bytes against the decoded source hash');
assert.match(source, /representativeSelection/, 'browser debug state exposes the requested representative feature frame');
assert.match(source, /performance\.now\(\)/, 'visual clock remains explicit and separate');
assert.match(source, /createStereoPanner/, 'material emitters produce audible spatial sends');
assert.match(source, /createWaveShaper/, 'Input Drive owns a real bounded saturation stage');
assert.match(source, /role-ordered-material-dsp/, 'browser receipts the single-entry role-ordered audible path');
assert.doesNotMatch(source, /audioInputBus\.connect\(filter\)/, 'decoded source is not copied directly into every spatial emitter');
assert.match(source, /audioTransduction/, 'browser exposes effective material-derived DSP parameters');
assert.match(source, /connectionContract/, 'browser exposes expected-versus-effective WebAudio edge accounting');
assert.equal((source.match(/\.connect\(/g) || []).length, 1, 'every WebAudio connection is routed through one audited receipt helper');
assert.match(source, /getFloatTimeDomainData/, 'browser measures post-spatialization audio output instead of inferring audibility from clock motion');
assert.match(source, /outputRms/, 'browser debug state exposes measured post-spatialization RMS');
assert.match(source, /window\.kaminosStageAtomsDebugState/, 'browser exposes route, clock, state, and fallback receipts');
assert.match(source, /decoded-audio-clock-frame-v0/, 'browser rejects non-decoded feature authority');
assert.match(source, /stage-atoms-pulp-shaped-material-spatializer-v0/, 'browser rejects a fallback route identity');
assert.doesNotMatch(source, /synthetic.*fallback|fallback.*oscillator/i, 'browser must not counterfeit missing source audio');

assert.match(witness, /window\.kaminosStageAtomsDebugState/, 'witness reads explicit Stage Atoms browser state');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the operator-facing viewport');
assert.match(witness, /Network\.responseReceived/, 'witness observes effective report and audio requests');
assert.match(witness, /activePixels/, 'witness rejects a visually blank material canvas');
assert.match(witness, /controlBounds/, 'witness rejects controls clipped outside their rail or viewport');
assert.match(witness, /selectedControlCollision/, 'witness rejects overlapping selected-role and selected-value receipts');
assert.match(witness, /fallbackAuthority/, 'witness rejects hidden fallback authority');
assert.match(witness, /outputRms/, 'witness requires measurable post-spatialization output');
assert.match(witness, /nodeInterfaceEvidence/, 'witness proves direct node contact changes the selected local control');
assert.match(witness, /directionalCascadeEvidence/, 'witness distinguishes upstream cascade effects from downstream-local effects');
assert.match(witness, /audioTransductionEvidence/, 'witness preserves matched same-window audible output evidence');
assert.match(witness, /connectionContract/, 'witness rejects a missing effective role-ordered WebAudio edge');
assert.match(witness, /spectralCentroidRatio/, 'witness rejects an Aperture gesture that does not change actual output spectrum');
assert.match(witness, /outputRmsRatio/, 'witness rejects a Release gesture that does not change actual radiated output');
assert.match(witness, /JSON\.stringify\(outputNode\.id\)/, 'witness serializes Pulp-derived node IDs before CDP evaluation');
assert.doesNotMatch(witness, /SetNodeControl\('\$\{outputNode\.id\}'/, 'witness never interpolates a Pulp-derived node ID as raw JavaScript');
assert.match(witness, /inputScenarioOutputWritten/, 'witness preserves the upstream-driven comparison frame separately');
assert.match(witness, /outputScenarioOutputWritten/, 'witness preserves the downstream-local comparison frame at the same decoded state');
assert.match(witness, /primaryOutputWritten/, 'witness records whether its screenshot landed');
assert.match(witness, /effectiveUrl/, 'witness records the effective browser route');

console.log('stage atoms browser contracts passed');
