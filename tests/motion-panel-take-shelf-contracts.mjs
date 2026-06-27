import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /id="motion-panel-take-shelf"/, 'Motion panel exposes a generated-take shelf');
assert.match(index, /id="motion-panel-take-count"/, 'Motion panel exposes a take count readout');
assert.match(index, /kaminos\.motion-panel-take\.v0/, 'take shelf stores takes with a stable schema');
assert.match(index, /const motionPanelTakes = \[\]/, 'take shelf has session-local take storage');
assert.match(index, /function motionPanelTakeMetadata/, 'take shelf extracts compact take metadata');
assert.match(index, /function recordMotionPanelTake/, 'generated and fixture previews record takes');
assert.match(index, /function renderMotionPanelTakeShelf/, 'take shelf renders the current take list');
assert.match(index, /function previewMotionPanelTake/, 'take shelf can re-preview prior generated takes');
assert.match(index, /function motionPanelSelectedTakeEvidence/, 'export can identify the selected take');
assert.match(index, /window\.kaminosMotionPanelTakeShelfDebugState/, 'take shelf exposes debug state for smoke automation');
assert.match(index, /recordMotionPanelTake\(\{\s*clip,\s*sourceResult: result/s, 'preview bridge records generated server results as takes');
assert.match(index, /data-motion-panel-take-preview/, 'take shelf rows expose a re-preview action');
assert.match(index, /selectedTake: motionPanelSelectedTakeEvidence\(\)/, 'current-view export records selected take evidence');
