import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyExpectedSourceStepIdentity } from '../volume-source-step-identity.mjs';

const computed = 'native-low-shared-device-step-12-frame-12';

assert.deepEqual(
  verifyExpectedSourceStepIdentity({ computedSourceStepIdentity: computed }),
  {
    identity: 'native-low-source-step-identity-verification-v0',
    expectedSourceStepIdentity: null,
    computedSourceStepIdentity: computed,
    effectiveSourceStepIdentity: computed,
    expectationSupplied: false,
    expectationMatched: null,
  },
  'a capture without an expectation preserves the independently computed identity',
);

assert.deepEqual(
  verifyExpectedSourceStepIdentity({
    expectedSourceStepIdentity: computed,
    computedSourceStepIdentity: computed,
  }),
  {
    identity: 'native-low-source-step-identity-verification-v0',
    expectedSourceStepIdentity: computed,
    computedSourceStepIdentity: computed,
    effectiveSourceStepIdentity: computed,
    expectationSupplied: true,
    expectationMatched: true,
  },
  'a matching expectation is recorded as a verified guard',
);

assert.throws(
  () => verifyExpectedSourceStepIdentity({
    expectedSourceStepIdentity: 'native-low-shared-device-step-11-frame-11',
    computedSourceStepIdentity: computed,
  }),
  (error) => {
    assert.equal(error.code, 'native-low-source-step-identity-mismatch');
    assert.equal(error.expectedSourceStepIdentity, 'native-low-shared-device-step-11-frame-11');
    assert.equal(error.computedSourceStepIdentity, computed);
    return true;
  },
  'a caller expectation cannot replace a different independently computed identity',
);

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(
  core,
  /failurePhase = 'native-low-source-step-identity-verification'[\s\S]*verifyExpectedSourceStepIdentity\(\{[\s\S]*expectedSourceStepIdentity,[\s\S]*computedSourceStepIdentity,[\s\S]*\}\)/,
  'the renderer routes expected and computed identities through the verified guard under a named failure phase',
);
assert.match(
  core,
  /errorCode: error\?\.code[\s\S]*expectedSourceStepIdentity: error\?\.expectedSourceStepIdentity[\s\S]*computedSourceStepIdentity: error\?\.computedSourceStepIdentity[\s\S]*lastTrustworthyEvidence/,
  'renderer failures preserve mismatch code plus expected/computed identities and last trustworthy evidence',
);
assert.doesNotMatch(
  core,
  /sourceStepIdentity\s*=\s*options\.expectedSourceStepIdentity\s*\|\|/,
  'caller expectation never substitutes for independently computed source identity',
);

console.log('source-step identity contracts passed');
