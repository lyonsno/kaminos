import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const docs = readFileSync(new URL('../docs/splat-assets.md', import.meta.url), 'utf8');

assert.match(docs, /splat-inbox/, 'Splat asset docs name the experimental inbox root');
assert.match(docs, /splat-production/, 'Splat asset docs name the production root');
assert.match(docs, /<asset>\.kaminos-splat\.json/, 'Splat asset docs document the sidecar naming convention');
assert.match(docs, /corrected splat is not a new/i, 'Splat asset docs clarify corrections do not create a new splat file');
assert.match(docs, /Greenroom\s*->\s*Splat Assets/, 'Splat asset docs tell operators where corrected splats appear in Kaminos');
assert.match(docs, /Splat Correction panel/, 'Splat asset docs mention the selected-object correction panel');
assert.match(docs, /Pivot\/Crop/, 'Splat asset docs mention correction-mode Pivot/Crop controls');
assert.match(docs, /crop bounds box/, 'Splat asset docs mention the visible crop bounds box');
assert.match(docs, /hides points outside the enabled crop/i, 'Splat asset docs explain normal crop preview visibility');
assert.match(docs, /faint crop context/i, 'Splat asset docs explain edit-mode crop preview context');
assert.match(docs, /axis-flipped asset coordinates/i, 'Splat asset docs explain crop membership uses axis-flipped asset coordinates');
assert.match(docs, /before `centroidOffset`/i, 'Splat asset docs explain centroid offset does not translate crop membership');
assert.match(docs, /axisFlips/, 'Splat asset docs include correction axis flips');
assert.match(docs, /orientation\.rotation/, 'Splat asset docs include orientation correction');
assert.match(docs, /centroidOffset/, 'Splat asset docs include centroid correction');
assert.match(docs, /crop/, 'Splat asset docs include crop correction');
assert.match(docs, /not a real Gaussian renderer/i, 'Splat asset docs preserve the render-handoff honesty boundary');
assert.match(docs, /direct reingest/i, 'Splat asset docs explain direct reingest behavior');
