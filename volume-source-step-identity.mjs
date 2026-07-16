export function verifyExpectedSourceStepIdentity({
  expectedSourceStepIdentity = null,
  computedSourceStepIdentity,
} = {}) {
  const computed = String(computedSourceStepIdentity || '').trim();
  if (!computed) {
    const error = new Error('native-low-computed-source-step-identity-missing');
    error.code = 'native-low-computed-source-step-identity-missing';
    throw error;
  }
  const expected = expectedSourceStepIdentity === null || expectedSourceStepIdentity === undefined
    ? null
    : String(expectedSourceStepIdentity).trim();
  if (expected !== null && !expected) {
    const error = new Error('native-low-expected-source-step-identity-empty');
    error.code = 'native-low-expected-source-step-identity-empty';
    error.expectedSourceStepIdentity = expected;
    error.computedSourceStepIdentity = computed;
    throw error;
  }
  if (expected !== null && expected !== computed) {
    const error = new Error(`native-low-source-step-identity-mismatch:expected=${expected}:computed=${computed}`);
    error.code = 'native-low-source-step-identity-mismatch';
    error.expectedSourceStepIdentity = expected;
    error.computedSourceStepIdentity = computed;
    throw error;
  }
  return {
    identity: 'native-low-source-step-identity-verification-v0',
    expectedSourceStepIdentity: expected,
    computedSourceStepIdentity: computed,
    effectiveSourceStepIdentity: computed,
    expectationSupplied: expected !== null,
    expectationMatched: expected === null ? null : true,
  };
}
