import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const liveWitness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

const pathWorldSection = index.indexOf('id="motion-panel-path-world-section"');
const phraseSection = index.indexOf('id="motion-panel-phrase-section"');
const takeShelfSection = index.indexOf('id="motion-panel-take-shelf"');

assert.ok(pathWorldSection > 0, 'Motion panel exposes a visible Path World section');
assert.ok(phraseSection > 0, 'Motion panel still exposes the phrase section');
assert.ok(takeShelfSection > 0, 'Motion panel still exposes the take shelf');
assert.ok(
  pathWorldSection < phraseSection,
  'Path World section appears before Phrases so the world behavior is not buried under cliplet chips',
);
assert.ok(
  pathWorldSection < takeShelfSection,
  'Path World section appears before Takes so it is discoverable during normal operator scan',
);

const surroundingMarkup = index.slice(Math.max(0, pathWorldSection - 180), pathWorldSection + 1200);
assert.doesNotMatch(
  surroundingMarkup,
  /<details[\s\S]*id="motion-panel-path-world-section"/,
  'Path World section is not hidden behind collapsed details',
);
assert.match(surroundingMarkup, />Path World</, 'Path World section has a literal visible heading');
assert.match(index, /id="motion-panel-path-world-active-source"/, 'Path World readout shows active source');
assert.match(index, /id="motion-panel-path-world-trigger-state"/, 'Path World readout shows trigger state');
assert.match(index, /id="motion-panel-path-world-obstacle"/, 'Path World readout shows obstacle identity');
assert.match(index, /id="motion-panel-preview-path-world"/, 'Path World section exposes a Preview World button');
assert.match(index, /id="motion-panel-frame-path-world"/, 'Path World section exposes a Frame World button');
assert.match(index, /function updateMotionPanelPathWorldReadout/, 'browser updates Path World readout from live route state');
assert.match(index, /function previewMotionPanelPathWorld/, 'browser exposes a direct Path World preview action');
assert.match(index, /function frameMotionPanelPathWorld/, 'browser exposes a direct Path World framing action');
assert.match(index, /window\.kaminosMotionPanelPathWorldDebugState/, 'browser exposes scriptable Path World panel debug state');
assert.match(index, /motion-panel-preview-path-world'\)\?\.addEventListener\('click'/, 'Preview World button is wired');
assert.match(index, /motion-panel-frame-path-world'\)\?\.addEventListener\('click'/, 'Frame World button is wired');

assert.match(liveWitness, /kaminosMotionPanelPathWorldDebugState/, 'live witness records Path World panel evidence');
assert.match(liveWitness, /pathWorldPanel/, 'live witness report carries Path World panel evidence');
