import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'volume-settings-preset-replay-capture.mjs');
const preset = join(root, 'fixtures/volume/settings-presets/big_raymarch_hero_flamebowl/semantic-fixture.json');
const provenance = join(root, 'fixtures/volume/settings-presets/big_raymarch_hero_flamebowl/semantic-fixture-provenance.json');
const fixture = mkdtempSync(join(tmpdir(), 'kaminos-grid96-full-flame-replay-'));
const capturePath = join(fixture, 'capture.json');
const reportPath = join(fixture, 'report.json');
const expectedPresetId = 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2';
const expectedSourceCommit = '1dfd4ca96164860fd983f7267856bccd91e322db';
const exactSourcePresetFileSha256 = '4928df29729e9316d059ccee6c46a946c07743d322363489d99518ecdd9a3172';
const expectedPresetFileSha256 = '87882933e928c1310f914bbe6507999449644ec7108a96da6e8adc470a97e3a8';
const requiredControlOverrides = { volume_resolution: '96', volume_render_scale: '1' };

assert.ok(existsSync(script), 'settings-preset replay-capture adapter exists');
assert.ok(existsSync(preset), 'exact Full Flame preset fixture exists');
assert.ok(existsSync(provenance), 'Full Flame detached provenance exists');
assert.equal(sha256(readFileSync(preset)), expectedPresetFileSha256, 'Full Flame fixture bytes drifted');
assert.notEqual(expectedPresetFileSha256, exactSourcePresetFileSha256, 'public semantic fixture impersonates the exact private transport artifact');

function runAdapter(...adapterArgs) {
  return spawnSync(process.execPath, [script, ...adapterArgs], { cwd: root, encoding: 'utf8' });
}

const run = runAdapter(
  '--preset', preset,
  '--provenance', provenance,
  '--out', capturePath,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:19996',
  '--control-overrides-json', JSON.stringify(requiredControlOverrides),
  '--expected-preset-id', expectedPresetId,
  '--expected-source-commit', expectedSourceCommit,
);
assert.equal(run.status, 0, run.stderr || run.stdout);

const capture = JSON.parse(readFileSync(capturePath, 'utf8'));
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(capture.schema, 'kaminos.operator-exact-live-splat-basin-capture.v1');
assert.equal(capture.identity, 'settings-preset-replay-capture-v0');
assert.equal(capture.controlCount, 188);
assert.equal(capture.sourcePreset.presetId, expectedPresetId);
assert.equal(capture.sourcePreset.sourceCommit, expectedSourceCommit);
assert.equal(capture.sourcePreset.artifactFileSha256, expectedPresetFileSha256);
assert.equal(capture.sourcePreset.sourceProvenance.historicalArtifactFileSha256, expectedPresetFileSha256);
assert.deepEqual(capture.sourcePreset.stateExclusions, {
  fluidField: true,
  frontField: true,
  boundarySidecar: true,
  splatInstances: true,
  historyBuffers: true,
  pressureState: true,
  replayState: true,
});
assert.deepEqual(capture.controlOverrides, {
  volume_resolution: { preset: '128', effective: '96' },
  volume_render_scale: { preset: '0.296917052331791', effective: '1' },
});
assert.deepEqual(capture.controlOverrideContract, {
  authority: 'exact-required-control-overrides-v0',
  required: requiredControlOverrides,
});
const replay = new URL(capture.replayRoute);
assert.equal(replay.origin, 'http://127.0.0.1:19996');
assert.equal(replay.pathname, '/');
assert.equal(replay.searchParams.get('volume_resolution'), '96');
assert.equal(replay.searchParams.get('volume_render_scale'), '1');
assert.equal([...replay.searchParams].length, 188);
const { payloadSha256, hashAuthority, ...payload } = capture;
assert.equal(payloadSha256, sha256(Buffer.from(JSON.stringify(payload, null, 2))));
assert.equal(hashAuthority, 'sha256-of-pre-hash-payload-json-utf8-pretty-printed-v0');
assert.equal(report.status, 'captured');
assert.equal(report.failurePhase, null);
assert.equal(report.capture.payloadSha256, payloadSha256);
assert.equal(report.requestedRouteControlCount, 188);
assert.equal(report.effectiveRouteControlCount, 188);

writeFileSync(capturePath, '{"stale":true}\n');
const rejected = runAdapter(
  '--preset', preset,
  '--provenance', provenance,
  '--out', capturePath,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:19996',
  '--control-overrides-json', JSON.stringify({ ...requiredControlOverrides, volume_density: '99' }),
  '--expected-preset-id', expectedPresetId,
  '--expected-source-commit', expectedSourceCommit,
);
assert.notEqual(rejected.status, 0, 'scope-expanding control override was accepted');
assert.equal(existsSync(capturePath), false, 'failed replay left stale primary capture in place');
const rejectedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(rejectedReport.status, 'failed');
assert.equal(rejectedReport.failurePhase, 'control-override-validation');
assert.match(rejectedReport.error, /must exactly match the required control override contract/);
assert.equal(rejectedReport.lastTrustworthyEvidence.presetId, expectedPresetId);

const selfAuthorizedExpanded = runAdapter(
  '--preset', preset,
  '--provenance', provenance,
  '--out', capturePath,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:19996',
  '--control-overrides-json', JSON.stringify({ ...requiredControlOverrides, volume_density: '99' }),
  '--required-control-overrides-json', JSON.stringify({ ...requiredControlOverrides, volume_density: '99' }),
  '--expected-preset-id', expectedPresetId,
  '--expected-source-commit', expectedSourceCommit,
);
assert.notEqual(selfAuthorizedExpanded.status, 0, 'caller self-authorized an expanded required override contract');
assert.equal(existsSync(capturePath), false, 'self-authorized expansion left a primary capture');
assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).failurePhase, 'control-override-validation');

const originalPreset = JSON.parse(readFileSync(preset, 'utf8'));
const originalProvenance = JSON.parse(readFileSync(provenance, 'utf8'));

const samePathPreset = join(fixture, 'same-path-preset.json');
writeFileSync(samePathPreset, readFileSync(preset));
const samePathRejected = runAdapter(
  '--preset', samePathPreset,
  '--provenance', provenance,
  '--out', samePathPreset,
  '--report', reportPath,
  '--target-origin', 'http://127.0.0.1:19996',
  '--control-overrides-json', JSON.stringify(requiredControlOverrides),
  '--expected-preset-id', expectedPresetId,
  '--expected-source-commit', expectedSourceCommit,
);
assert.notEqual(samePathRejected.status, 0, 'adapter overwrote its authoritative preset source');
assert.equal(sha256(readFileSync(samePathPreset)), expectedPresetFileSha256, 'same-path rejection destroyed preset bytes');
const samePathReport = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(samePathReport.failurePhase, 'argument-validation');
assert.match(samePathReport.error, /must not resolve to the same path/);

function expectPresetValidationFailure({ label, presetValue = originalPreset, provenanceValue = originalProvenance, errorPattern }) {
  const mutatedPresetPath = join(fixture, `${label}-preset.json`);
  const mutatedProvenancePath = join(fixture, `${label}-provenance.json`);
  const mutatedPresetBytes = Buffer.from(`${JSON.stringify(presetValue, null, 2)}\n`);
  const effectiveProvenance = typeof provenanceValue === 'function'
    ? provenanceValue(mutatedPresetBytes)
    : provenanceValue;
  writeFileSync(mutatedPresetPath, mutatedPresetBytes);
  writeFileSync(mutatedProvenancePath, `${JSON.stringify(effectiveProvenance, null, 2)}\n`);
  const result = runAdapter(
    '--preset', mutatedPresetPath,
    '--provenance', mutatedProvenancePath,
    '--out', capturePath,
    '--report', reportPath,
    '--target-origin', 'http://127.0.0.1:19996',
    '--control-overrides-json', JSON.stringify(requiredControlOverrides),
    '--expected-preset-id', expectedPresetId,
    '--expected-source-commit', expectedSourceCommit,
  );
  assert.notEqual(result.status, 0, `${label} source mutation was accepted`);
  assert.equal(existsSync(capturePath), false, `${label} failure left a primary capture`);
  const failureReport = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'preset-validation');
  assert.match(failureReport.error, errorPattern);
}

expectPresetValidationFailure({
  label: 'historical-artifact-hash',
  provenanceValue: { ...originalProvenance, historicalArtifactFileSha256: '0'.repeat(64) },
  errorPattern: /preset artifact bytes do not match detached provenance/,
});

expectPresetValidationFailure({
  label: 'embedded-source-commit',
  presetValue: { ...originalPreset, source: { ...originalPreset.source, commit: '0'.repeat(40) } },
  provenanceValue: presetBytes => ({ ...originalProvenance, historicalArtifactFileSha256: sha256(presetBytes) }),
  errorPattern: /embedded source commit does not match detached provenance/,
});

expectPresetValidationFailure({
  label: 'captured-replay-state',
  presetValue: {
    ...originalPreset,
    preset: {
      ...originalPreset.preset,
      stateExclusions: { ...originalPreset.preset.stateExclusions, replayState: false },
    },
  },
  provenanceValue: presetBytes => ({ ...originalProvenance, historicalArtifactFileSha256: sha256(presetBytes) }),
  errorPattern: /settings-only state exclusions are incomplete/,
});

console.log('Grid96 Full Flame preset replay contracts passed');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
