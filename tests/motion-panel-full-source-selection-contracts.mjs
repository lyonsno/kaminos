import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(index, /function motionPanelExplicitSelectedClipletSegment/, 'Motion panel has a strict selected-cliplet helper');
assert.match(index, /function motionPanelFallbackClipletSegment/, 'Motion panel keeps fallback cliplet selection isolated for interrupt targeting');

const explicitHelper = index.match(/function motionPanelExplicitSelectedClipletSegment[\s\S]*?^}/m)?.[0] || '';
assert.ok(explicitHelper, 'strict selected-cliplet helper block is discoverable');
assert.match(explicitHelper, /selectedId === 'full'[\s\S]*return null/, 'Full source selection must not resolve to the first generated cliplet');
assert.doesNotMatch(explicitHelper, /cliplets\.segments\[0\]/, 'strict selected-cliplet helper must not fall back to segment zero');
assert.doesNotMatch(explicitHelper, /includes\('brake'\)/, 'strict selected-cliplet helper must not fall back to a heuristic brake segment');

const fallbackHelper = index.match(/function motionPanelFallbackClipletSegment[\s\S]*?^}/m)?.[0] || '';
assert.ok(fallbackHelper, 'fallback cliplet helper block is discoverable');
assert.match(fallbackHelper, /includes\('brake'\)/, 'interrupt fallback may still choose a brake segment when no explicit cliplet is selected');

const interruptBlock = index.match(/function motionPanelClipletInterruptFromInputs[\s\S]*?^}/m)?.[0] || '';
assert.match(interruptBlock, /motionPanelFallbackClipletSegment\(cliplets\)/, 'path interrupt uses the isolated fallback helper');

const selectedExportBlock = index.match(/async function exportMotionPanelSelectedClipletFilmstrip[\s\S]*?window\.exportMotionPanelSelectedClipletFilmstrip = exportMotionPanelSelectedClipletFilmstrip;/)?.[0] || '';
assert.match(selectedExportBlock, /motionPanelExplicitSelectedClipletSegment\(motionTemporalState\?\.generatedMotionCliplets\)/, 'selected-cliplet export uses strict selection and cannot export Full source as cliplet zero');
assert.match(selectedExportBlock, /Select a generated motion cliplet before exporting a cliplet sheet/, 'selected-cliplet export fails loud when Full source is selected');
