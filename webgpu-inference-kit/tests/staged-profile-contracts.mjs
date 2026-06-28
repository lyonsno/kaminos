import assert from 'node:assert/strict';

import {
  addStagedSubmitStage,
  createStagedSubmitProfile,
  finishStagedSubmitProfile,
  validateStagedSubmitProfile,
} from '../src/index.js';

const profile = createStagedSubmitProfile({
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['backbone', 'decoder-heads', 'output-readback'],
});

addStagedSubmitStage(profile, { name: 'backbone', ms: 1007.9, shape: [1024, 37, 37] });
addStagedSubmitStage(profile, { name: 'decoder-heads', ms: 854.2 });
addStagedSubmitStage(profile, { name: 'output-readback', ms: 1.8 });

const finished = finishStagedSubmitProfile(profile);
assert.equal(finished.schema, 'kaminos.webgpu-staged-profile.v0');
assert.equal(finished.totalMs, 1863.9);
assert.deepEqual(finished.stageNames, ['backbone', 'decoder-heads', 'output-readback']);
assert.equal(validateStagedSubmitProfile(finished).ok, true);

const missingStage = createStagedSubmitProfile({
  route: 'staged-submits',
  timingSource: 'queue-submit-wait',
  requiredStages: ['backbone', 'decoder-heads'],
});
addStagedSubmitStage(missingStage, { name: 'backbone', ms: 1000 });
const missingStageResult = validateStagedSubmitProfile(finishStagedSubmitProfile(missingStage));
assert.equal(missingStageResult.ok, false);
assert.match(missingStageResult.errors.join('\n'), /missing required stage decoder-heads/);

const timestampProfile = finishStagedSubmitProfile({
  schema: 'kaminos.webgpu-staged-profile.v0',
  route: 'timestamp-query',
  timingSource: 'timestamp-query',
  timestampQueryValidatedAgainstStaged: false,
  requiredStages: [],
  stages: [{ name: 'backbone', ms: 15.3 }],
});
const timestampResult = validateStagedSubmitProfile(timestampProfile);
assert.equal(timestampResult.ok, false);
assert.match(timestampResult.errors.join('\n'), /timestamp-query.*validated/i);

assert.throws(
  () => addStagedSubmitStage(profile, { name: 'bad-negative-stage', ms: -1 }),
  /non-negative/,
);

console.log('staged profile contracts passed');
