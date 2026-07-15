import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const witnessUrl = new URL('../boundary-splat-destination-state-witness.mjs', import.meta.url);
const witness = await import(witnessUrl);
const source = await readFile(witnessUrl, 'utf8');

assert.match(source, /kaminos-boundary-splat-destination-state-witness-v0/, 'witness must publish a stable schema');
assert.match(source, /kaminos-boundary-splat-phase-destination-state-evaluation-v0/, 'witness must require the explicit one-step evaluation schema');
assert.match(source, /frozen-destination-state-one-step-on-oracle-support-v0/, 'predicted role must name one-step oracle-support authority');
assert.match(source, /oracle-support-carried-donor-control-v0/, 'control role must name copied donor authority');
assert.match(source, /exact-heldout-valid-local-donor-support-v0/, 'reference role must name eligible exact target authority');
assert.match(source, /pending-direct-operator-visual-smoke/, 'report must preserve operator motion authority');
assert.match(source, /unsupported births are excluded from all three roles/i, 'guide must explain the eligible-support boundary');
assert.doesNotMatch(source, /-stream_loop/, 'encoding must not loop frames or clips');
assert.doesNotMatch(source, /slice\(0,\s*\d+\)/, 'witness must not silently cap the temporal sequence');

const sortedRoleAuthorities = {
  control: 'oracle-support-carried-donor-control-v0',
  predicted: 'frozen-destination-state-one-step-on-oracle-support-v0',
  reference: 'exact-heldout-valid-local-donor-support-v0',
};
assert.doesNotThrow(
  () => witness.validateRoleAuthorities(sortedRoleAuthorities),
  'JSON key sorting must not invalidate structurally exact role authority',
);
assert.throws(
  () => witness.validateRoleAuthorities({ ...sortedRoleAuthorities, predicted: 'copied-control' }),
  /role authority mismatch/,
  'role authority substitution must still fail',
);

assert.equal(witness.detectExactPeriod(['a', 'b', 'a', 'b']), 2, 'exact periodic replay must be detected');
assert.equal(witness.detectExactPeriod(['a', 'b', 'c', 'd']), null, 'nonrepeating bounded motion must remain nonperiodic evidence');

const sites = [
  { splat: [0, 0, 0, 1, 0.2, 0.3, 0.4, 0.8, 0, 0, 0, 0] },
  { splat: [0, 0, 0, 1, 0.2, 0.3, 0.4, 0.8, 0, 0, 0, 0] },
];
const beauty = witness.buildCohortRows(sites, ['stable-q1', 'birth']);
assert.ok(Math.abs(beauty[0][7] - 0.08) < 1e-12, 'static support must be attenuated to ten percent');
assert.equal(beauty[1][7], 0.8, 'motion-bearing support must retain full opacity');
const debug = witness.buildCohortRows(sites, ['stable-q4', 'transported'], 0.625);
assert.notDeepEqual(debug[0].slice(4, 7), sites[0].splat.slice(4, 7), 'debug mix must color Q4');
assert.notDeepEqual(debug[1].slice(4, 7), sites[1].splat.slice(4, 7), 'debug mix must color transported support');
assert.throws(() => witness.buildCohortRows(sites, ['birth', 'birth'], 0.5), /exactly 0\.625/, 'debug gain substitution must fail');

console.log('boundary splat destination state witness contracts passed');
