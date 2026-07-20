import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assertMotionReady719024EffectiveIdentity } from '../motion-ready-719024-live-identity.js';

const witness = readFileSync(new URL('../motion-ready-719024-live-witness.mjs', import.meta.url), 'utf8');
const identityContract = readFileSync(new URL('../motion-ready-719024-live-identity.js', import.meta.url), 'utf8');

assert.match(witness, /kaminos\.motion-ready-719024-live-witness\.v0/, 'witness writes a stable report schema');
assert.match(witness, /writeReport\(\{\s*ok: false/s, 'witness writes a durable report when it fails before primary output');
assert.match(witness, /--expected-cast-id/, 'witness exposes expected cast identity for false-closure probes');
assert.match(witness, /--expected-cast-hash/, 'witness exposes expected cast hash for false-closure probes');
assert.match(witness, /--expected-registration-hash/, 'witness exposes expected registration hash for false-closure probes');
assert.match(witness, /--expected-hill-source/, 'witness exposes expected Hill source identity for false-closure probes');
assert.match(witness, /requestedIdentity/, 'witness records requested identity');
assert.match(witness, /effectiveIdentity/, 'witness records effective identity');
assert.match(identityContract, /effective registration hash does not match requested registration hash/, 'witness compares requested and effective registration bytes');
assert.match(witness, /--cdp-timeout-ms/, 'witness bounds CDP readiness without capping playback evidence');
assert.match(witness, /--witness-timeout-ms/, 'witness bounds debug-state readiness without capping playback evidence');
assert.match(witness, /lastTrustworthyEvidence/, 'pre-output failures preserve the last trustworthy observation');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures the operator-facing viewport');
assert.match(witness, /lead-in/, 'witness samples the lead-in phase');
assert.match(witness, /travel/, 'witness samples the travel phase');
assert.match(witness, /settle/, 'witness samples the settle phase');
assert.match(witness, /consoleFailures/, 'witness rejects browser console failures');
assert.match(witness, /filmstrip\.png/, 'witness emits a named filmstrip artifact');
assert.doesNotMatch(witness, /Math\.min\([^)]*frameCount/, 'witness must not silently cap requested frames');
assert.match(witness, /Math\.hypot\(/, 'witness measures translation independently of world-space travel direction');
assert.doesNotMatch(witness, /root\[2\] < .*root\[2\]/, 'witness must not require travel toward a privileged world-space direction');
assert.match(witness, /assertMotionReady719024EffectiveIdentity/, 'live evidence uses a negative-testable effective rail identity contract');
assert.match(identityContract, /locomotionRailSchema/, 'live evidence binds the effective rail schema');
assert.match(identityContract, /transitionAdmission/, 'live evidence binds caller-evaluated transition admission');
assert.match(identityContract, /minimumSupportMargin/, 'live evidence binds nonnegative compiled support margin');

const expected = {
  castId: 'motion-ready-719024',
  castHash: 'cast-hash',
  registrationHash: 'registration-hash',
  hillSource: 'hill-source',
  routePlanId: 'strict-route',
  locomotionRailId: 'strict-rail',
};
const validDebug = {
  effective: {
    castId: expected.castId,
    castHash: expected.castHash,
    registrationHash: expected.registrationHash,
    deformationMode: 'axial-parallel-transport-wave-v1',
    hillSourceRef: expected.hillSource,
    hillAuthority: 'live_simulation',
    hillIdentityProjection: 'public-surface-identifiers-v0',
    dynamicContinuity: 'not-claimed',
    routePlanId: expected.routePlanId,
    routePointCount: 12,
    transitionAdmission: 'caller-evaluated',
    locomotionRailId: expected.locomotionRailId,
    locomotionRailSchema: 'kaminos.creature-scale-locomotion-rail.v0',
    locomotionRailAuthority: 'creature-scale-route-compilation',
    locomotionRailLength: 8,
    locomotionRailSampleCount: 64,
    locomotionRailEvidence: {
      transitionAdmission: 'caller-evaluated-dense-revalidation',
      denseTransitionCount: 63,
      minimumSupportMargin: 0.1,
      rejectedSampleCount: 0,
    },
    locomotionRailContinuity: {
      maximumHeadingDeltaRadians: 0.1,
      maximumCurvatureDelta: 0.2,
      maximumSupportCorrectionDelta: 0.01,
    },
  },
};
assert.doesNotThrow(() => assertMotionReady719024EffectiveIdentity(validDebug, expected));
assert.throws(
  () => assertMotionReady719024EffectiveIdentity({
    effective: { ...validDebug.effective, locomotionRailSchema: 'stale.pre-rail.v0' },
  }, expected),
  /rail schema is stale or missing/,
  'a stale pre-rail witness must fail the effective identity gate',
);

console.log('motion-ready-719024 live witness contracts passed');
