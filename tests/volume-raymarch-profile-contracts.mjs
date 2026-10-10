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

const accountingStart = body.indexOf('if (times[0] === 0n');
const accountingEnd = body.indexOf('\n    } finally', accountingStart);
assert.ok(accountingStart >= 0 && accountingEnd > accountingStart);
const account = new Function('times', 'includeRenderFlow', 'identity', body.slice(accountingStart, accountingEnd));
const cached = { renderFlowCache: { refresh: 'each-draw-before-raster' } };
const direct = { renderFlowCache: { refresh: 'not-dispatched' } };
const timing = values => account(values.map(BigInt), true, cached);
assert.equal(timing([5000000, 9000000, 1000000, 3000000]).ms, 8,
  'net cache cost includes the two-millisecond transition gap');
assert.equal(timing([5000000, 9000000, 1000000, 3000000]).transitionMs, 2);
// Observed CFT1243/Apple timestamps from timing001; independent pass intervals overlap.
const nativeOverlap = timing(['188243188618270', '188243190788237', '188243188598146', '188243188667353']);
assert.equal(nativeOverlap.ok, true, 'valid individual intervals need not be disjoint');
assert.equal(nativeOverlap.ms, 2.190091);
assert.equal(nativeOverlap.transitionMs, -0.049083);
assert.equal(account([1000000n, 5000000n, 0n, 0n], true, direct).ms, 4);
for (const values of [[0,9,1,3], [5,5,1,3], [5,9,0,3], [5,9,3,3], [5,9,4,3]]) {
  assert.equal(timing(values).ok, false, 'missing or reversed individual timestamps cannot pass');
}
console.log('held emissive camera timing contracts passed');
