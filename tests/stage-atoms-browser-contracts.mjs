import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

assert.match(html, /stage-atoms-browser\.mjs/, 'route loads the Stage Atoms runtime');
assert.match(html, /id="stage-atoms-canvas"/, 'route exposes the material stage canvas');
assert.match(html, /id="stage-atoms-play"/, 'route exposes a stable transport handle');
assert.match(html, /id="stage-atoms-seek"/, 'route exposes an audio-clock seek handle');
assert.match(html, /id="stage-atoms-coupling"/, 'route exposes an interior coupling handle');
assert.match(html, /id="stage-atoms-memory"/, 'route exposes a recurrence-memory handle');
assert.match(html, /id="stage-atoms-depth"/, 'route exposes a spatial-depth handle');
assert.match(html, /data-stage-source-authority/, 'operator surface exposes source authority');
assert.match(html, /data-stage-route-authority/, 'operator surface exposes route authority');
assert.match(html, /data-stage-fallback-authority/, 'operator surface exposes fallback authority');

assert.match(source, /ccmixter-geppetto-decoded-stage-atoms-witness\.json/, 'browser consumes the decoded witness report');
assert.match(source, /coruscate-geppetto-dry-main\.mp3/, 'browser consumes the local verified audio cache');
assert.match(source, /simulateStageMaterialFrame/, 'browser derives current material state from Stage Atoms');
assert.match(source, /spatializeFromStageMaterial/, 'browser derives audio placement from current material state');
assert.match(source, /decodeAudioData/, 'browser decodes the verified source bytes into its live audio clock substrate');
assert.match(source, /createBufferSource/, 'browser transport uses recreatable WebAudio buffer sources');
assert.match(source, /audioContext\.currentTime/, 'WebAudio clock is the live feature-frame authority');
assert.match(source, /transportOffsetSeconds/, 'browser preserves representative start and operator seeks as explicit clock state');
assert.match(source, /crypto\.subtle\.digest/, 'browser verifies fetched audio bytes against the decoded source hash');
assert.match(source, /representativeSelection/, 'browser debug state exposes the requested representative feature frame');
assert.match(source, /performance\.now\(\)/, 'visual clock remains explicit and separate');
assert.match(source, /createStereoPanner/, 'material emitters produce audible spatial sends');
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
assert.match(witness, /fallbackAuthority/, 'witness rejects hidden fallback authority');
assert.match(witness, /outputRms/, 'witness requires measurable post-spatialization output');
assert.match(witness, /handleEvidence/, 'witness proves live handles change material and spatial state');
assert.match(witness, /primaryOutputWritten/, 'witness records whether its screenshot landed');
assert.match(witness, /effectiveUrl/, 'witness records the effective browser route');

console.log('stage atoms browser contracts passed');
