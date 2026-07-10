import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

assert.match(index, /id="hybrid-control-preview-source-color"[^>]*data-hybrid-renderer-control/, 'Hybrid renderer popover exposes a global source-color preview toggle');
assert.match(index, /<label for="hybrid-control-preview-source-color">Source colors<\/label>/, 'source-color preview toggle is operator-visible');
assert.match(index, /preview:\s*\{\s*sourceColor:\s*hybridControlCheckbox\('hybrid-control-preview-source-color',\s*true\),\s*\}/s, 'renderer controls payload sends preview.sourceColor to the overlay');
assert.match(index, /function setHybridSourceColorPreviewEnabled\(enabled\)/, 'Kaminos exposes a helper for route/tooling to flip source-color preview');
assert.match(index, /window\.kaminosSetHybridSourceColorPreviewEnabled = setHybridSourceColorPreviewEnabled;/, 'debug bridge exposes source-color preview helper');
