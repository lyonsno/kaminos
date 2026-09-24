#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { validateVolumeSettingsPresetSourceIdentity } from '../volume-settings-preset-contract.mjs';

const requested = {
  repoRoot: resolve('/private/tmp/kaminos-reviewed-source'),
  commit: 'a'.repeat(40),
};

assert.equal(validateVolumeSettingsPresetSourceIdentity(requested, { ...requested, branch: 'feature' }), true);

assert.throws(
  () => validateVolumeSettingsPresetSourceIdentity(requested, {
    repoRoot: resolve('/private/tmp/kaminos-wrong-source'),
    commit: requested.commit,
  }),
  /wrong server repo root/,
  'source identity rejects and names a repo-root substitution',
);

assert.throws(
  () => validateVolumeSettingsPresetSourceIdentity(requested, {
    repoRoot: requested.repoRoot,
    commit: 'b'.repeat(40),
  }),
  /wrong server commit/,
  'source identity rejects and names a commit substitution',
);

const requestedReceipt = structuredClone(requested);
const effectiveReceipt = {
  repoRoot: resolve('/private/tmp/kaminos-wrong-source'),
  commit: 'b'.repeat(40),
};
try {
  validateVolumeSettingsPresetSourceIdentity(requestedReceipt, effectiveReceipt);
} catch (error) {
  const failureReport = {
    status: 'failed',
    requestedSource: requestedReceipt,
    effectiveSource: effectiveReceipt,
    error: error.message,
  };
  assert.deepEqual(failureReport.requestedSource, requested);
  assert.deepEqual(failureReport.effectiveSource, effectiveReceipt);
  assert.match(failureReport.error, /wrong server repo root/);
}

console.log('volume settings preset source identity contracts passed');
