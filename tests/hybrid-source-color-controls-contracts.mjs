import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

assert.match(index, /id="hybrid-control-preview-source-color"[^>]*data-hybrid-renderer-control/, 'Hybrid renderer popover exposes a global source-color preview toggle');
assert.match(index, /<label for="hybrid-control-preview-source-color">Source Radiance<\/label>/, 'source-radiance presentation toggle is operator-visible');
assert.match(index, /presentation:\s*\{\s*mode:\s*sourceRadiance \? 'source-radiance' : 'deferred-pbr',\s*\}/s, 'renderer controls payload sends an explicit presentation mode to the overlay');
assert.match(index, /preview:\s*\{\s*sourceColor:\s*sourceRadiance,\s*\}/s, 'renderer controls retain the compatibility source-color flag during package migration');
assert.match(index, /window\._kaminosDirty\?\.\(\);[\s\S]*return publishHybridSplatRendererControls\(\);/, 'source-radiance mode changes invalidate the live viewport before publishing');
assert.match(index, /function setHybridSourceColorPreviewEnabled\(enabled\)/, 'Kaminos exposes a helper for route/tooling to flip source-color preview');
assert.match(index, /window\.kaminosSetHybridSourceColorPreviewEnabled = setHybridSourceColorPreviewEnabled;/, 'debug bridge exposes source-color preview helper');
