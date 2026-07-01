import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /id="motion-panel-generate-section"/, 'Motion panel has a primary Generate section');
assert.match(index, /id="motion-panel-current-take-section"/, 'Motion panel separates the current take from saved takes');
assert.match(index, /id="motion-panel-current-take"/, 'Motion panel exposes a dedicated current-take surface');
assert.match(index, /id="motion-panel-saved-takes-section"/, 'Motion panel separates saved takes into a library section');
assert.match(index, /id="motion-panel-saved-takes"/, 'Motion panel exposes a dedicated saved-takes surface');
assert.match(index, /id="motion-panel-export-section"/, 'Motion panel groups export controls as a compact operator section');
assert.match(index, /id="motion-panel-export-options"/, 'Motion panel places export options behind a collapsible details group');
assert.match(index, /id="motion-panel-source-options"/, 'Motion panel places source ghost/orientation knobs behind a collapsible details group');
assert.match(index, /id="motion-panel-debug-routes"/, 'Motion panel places route/debug controls behind a collapsible details group');
assert.match(index, /id="motion-panel-phrase-controls-details"/, 'Motion panel places phrase-control sliders behind a collapsible details group');
assert.doesNotMatch(index, /id="motion-panel-procedural-clips-details"/, 'Motion panel does not expose opaque procedural clip presets');

assert.match(index, /<details[^>]+id="motion-panel-source-options"/, 'source controls use native collapsed details');
assert.match(index, /<details[^>]+id="motion-panel-debug-routes"/, 'debug routes use native collapsed details');
assert.match(index, /<details[^>]+id="motion-panel-export-options"/, 'export options use native collapsed details');
assert.match(index, /<details[^>]+id="motion-panel-phrase-controls-details"/, 'phrase controls use native collapsed details');
assert.doesNotMatch(index, />Procedural Clips</, 'Motion panel has no dead Procedural Clips drawer label');

assert.match(index, /function renderMotionPanelCurrentTake/, 'Motion panel renders current take separately from saved takes');
assert.match(index, /function renderMotionPanelSavedTakes/, 'Motion panel renders saved takes separately from current takes');
assert.match(index, /renderMotionPanelCurrentTake\(\)/, 'take shelf render refreshes the current-take surface');
assert.match(index, /renderMotionPanelSavedTakes\(\)/, 'take shelf render refreshes the saved-take surface');
assert.match(index, /operatorLayout:/, 'debug state exposes operator layout evidence');
