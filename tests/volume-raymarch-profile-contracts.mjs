import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { balancedWgslBlock } from './helpers/wgsl-guard-ownership.mjs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /async function sampleEmissiveRaymarchProfile\(/,
  'ordinary emissive camera raster has a held-state timing entry point');
const body = balancedWgslBlock(core.replace('sampleEmissiveRaymarchProfile(options = {})', 'sampleEmissiveRaymarchProfile(options)'), 'async function sampleEmissiveRaymarchProfile(');
assert.match(body, /!simulationPaused/, 'profiling refuses a moving simulation');
assert.match(body, /timestampQueriesAvailable\(\)/, 'missing GPU timing is not replaced with wall-clock timing');
assert.match(body, /prepareSharedSceneConsumers\(encoder\)/, 'profile prepares the real ordinary scene consumer');
assert.match(body, /encodeDraw\([\s\S]*timestampWrites:/, 'timestamps enclose the camera raster, not the source compute');
assert.match(body, /times\[0\] === 0n \|\| times\[1\] <= times\[0\]/, 'missing or reversed timestamps fail visibly');
assert.match(body, /validationError[\s\S]*ok: false/, 'GPU validation errors cannot pass the profile');
assert.match(body, /scope: 'camera-raymarch-raster-only-not-lighting-simulation-or-frame'/);
assert.match(body, /raymarchShaderSpecialization:[\s\S]*state\.raymarchShaderSpecialization/);
assert.match(body, /finally[\s\S]*query\.destroy\(\);[\s\S]*resolved\.destroy\(\);[\s\S]*readback\.destroy\(\);/);
assert.match(core, /sampleEmissiveRaymarchProfile,/);
assert.match(core, /supervisionFireOnlyTarget: uniforms\[305\] > 0/);
console.log('held emissive camera timing contracts passed');
