import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateWitnessDom } from '../tools/capture-source-shaped-k4-profile-comparison.mjs';

const TOOL = path.resolve(
  new URL('../tools/capture-source-shaped-k4-profile-comparison.mjs', import.meta.url).pathname,
);
const SHA = 'a'.repeat(64);

test('profile capture accepts only the exact loaded viewer state', () => {
  const exact = `<html data-requested-route="source-shaped-k4-packing-visual-v0"
    data-effective-route="source-shaped-k4-packing-visual-v0"
    data-fallback-used="false" data-profile="belly" data-condition="moderate"
    data-state="packed" data-witness-loaded="true" data-result-sha256="${SHA}"></html>`;
  assert.doesNotThrow(() => validateWitnessDom(exact, {
    profile: 'belly',
    condition: 'moderate',
    state: 'packed',
    resultSha256: SHA,
  }));
  assert.throws(
    () => validateWitnessDom(exact.replace('data-witness-loaded="true"', ''), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /witness-loaded/i,
  );
  assert.throws(
    () => validateWitnessDom(exact.replace('data-profile="belly"', 'data-profile="tube"'), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /profile.*belly/i,
  );
  assert.throws(
    () => validateWitnessDom(exact.replace(SHA, 'b'.repeat(64)), {
      profile: 'belly', condition: 'moderate', state: 'packed', resultSha256: SHA,
    }),
    /result.*sha/i,
  );
});

test('profile capture writes a durable failure report before any screenshot exists', async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'kaminos-profile-capture-failure-'));
  const result = spawnSync(process.execPath, [
    TOOL,
    '--browser', '/usr/bin/false',
    '--url', 'http://127.0.0.1:1/unreachable',
    '--output-dir', outputDirectory,
    '--tube-sha', SHA,
    '--belly-sha', 'b'.repeat(64),
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(outputDirectory, 'capture-report.json'), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.primaryOutput, null);
  assert.match(report.failurePhase, /capture/i);
  assert.equal(report.lastTrustworthyEvidence.phase, 'browser-identity-bound');
  assert.equal(report.requestedProfiles.belly.resultSha256, 'b'.repeat(64));
});
