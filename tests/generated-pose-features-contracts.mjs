import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const witnessPath = join(root, 'generated-pose-features.mjs');

assert.ok(existsSync(witnessPath), 'generated-pose-features.mjs must provide generated skeleton feature extraction');

const witness = readFileSync(witnessPath, 'utf8');

assert.match(witness, /kaminos\.generated-pose-features\.v0/, 'feature report declares the generated pose feature schema');
assert.match(witness, /--input/, 'feature extractor accepts an explicit input path');
assert.match(witness, /--report/, 'feature extractor writes a caller-owned report path');
assert.match(witness, /--fps/, 'feature extractor records an explicit effective FPS');
assert.match(witness, /inputSha256/, 'feature report records input content identity');
assert.match(witness, /npzKeys/, 'feature report records effective NPZ member keys');
assert.match(witness, /readNpyFromNpz/, 'feature extractor reads NPY arrays from an NPZ container');
assert.match(witness, /parseNpy/, 'feature extractor parses NumPy NPY headers and typed data');
assert.match(witness, /posed_joints\.npy/, 'v0 consumes Kimodo-style posed_joints output');
assert.match(witness, /root_positions\.npy/, 'v0 consumes Kimodo-style root_positions output when present');
assert.match(witness, /SOMA77_JOINTS/, 'v0 uses an explicit SOMA77 joint map');
assert.match(witness, /LeftHand/, 'joint map includes hands for limb-envelope extraction');
assert.match(witness, /RightFoot/, 'joint map includes feet for stance/contact extraction');
assert.match(witness, /rootMetrics/, 'feature report includes root metrics');
assert.match(witness, /torsoFrame/, 'feature report includes torso/head frame features');
assert.match(witness, /limbEnvelope/, 'feature report includes limb-envelope features');
assert.match(witness, /stanceContact/, 'feature report includes stance/contact proxy features');
assert.match(witness, /expansionCompression/, 'feature report includes expansion/compression features');
assert.match(witness, /eventSpikes/, 'feature report includes velocity/event spike candidates');
assert.match(witness, /outputMappingHints/, 'feature report names downstream orb/body mapping hints');
assert.match(witness, /ok:\s*false/, 'feature extractor writes loud failure reports');
assert.match(witness, /Unsupported generated pose feature input/, 'feature extractor refuses unsupported parameter-only motion packs');
