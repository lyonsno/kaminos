import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /orbShellFocus === 'aperture-orbit-capture'/, 'browser route must recognize aperture-orbit-capture focus');
assert.match(index, /enableApertureOrbitCaptureWitness\(\)/, 'browser route must activate aperture orbit capture overlay from URL focus');
assert.match(index, /frameApertureOrbitCaptureWitness\(\)/, 'browser route must frame aperture orbit capture overlay from URL focus');
assert.match(index, /Aperture Orbit Capture/, 'browser route status must name the aperture orbit capture diagnostic');
