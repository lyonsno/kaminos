import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildVolumeSettingsPresetTarget,
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetDocument,
  validateVolumeSettingsPresetVisualTarget,
} from '../volume-settings-preset-contract.mjs';

const root = join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const witness = readFileSync(join(root, 'volume-settings-preset-witness.mjs'), 'utf8');
const loader = readFileSync(join(root, 'volume-settings-preset.html'), 'utf8');

assert.deepEqual(schema.presentationControls, [{
  key: 'raymarch-smoke-presentation',
  param: 'volume_raymarch_smoke',
  tagName: 'BUTTON',
  type: 'button-state',
  allowedValues: ['on', 'off'],
  additiveDefault: 'on',
}], 'Smoke On/Off has one schema-owned presentation persistence descriptor');

for (const [key, expectedDefault] of Object.entries({
  'emitter-assay-family': 'cluster',
  'volume-exposure': 1,
  'volume-reaction-boundary-fire-clean-color': '#4a86ff',
  'volume-reaction-boundary-fire-soot-color': '#ffc460',
  'volume-artistic-swirl': true,
  'volume-phased-sway': true,
})) {
  const descriptor = schema.controls.find(control => control.key === key);
  assert.ok(descriptor, `missing additive schema control ${key}`);
  assert.deepEqual(descriptor.additiveDefault, expectedDefault, `${key} does not own its migration default`);
}

assert.match(index, /function readVolumeSettingsPresentationControls\(\)[\s\S]*raymarch-smoke-presentation[\s\S]*normalizedRequestedMode/, 'preset capture reads the requested Smoke On/Off presentation state');
assert.match(index, /presentationControls[\s\S]*presentationControlCount/, 'preset payload carries its explicit presentation-control axis');
assert.doesNotMatch(index, /Number\(index\.controlCount\) !== 192|Number\(index\.rendererControlCount\) !== 3/, 'preset index admission does not duplicate canonical schema counts');
assert.doesNotMatch(index, /Number\(result\.effective\?\.controlCount\) !== 192|Number\(result\.effective\?\.rendererControlCount\) !== 3/, 'preset write admission does not duplicate canonical schema counts');
assert.match(witness, /expectedPresetControlCount[\s\S]*expectedRendererControlCount[\s\S]*expectedPresentationControlCount/, 'browser witness derives inventory counts from the live preset index');
assert.doesNotMatch(witness, /presetControlCount, 192|rendererControlCount, 3/, 'browser witness does not freeze additive schema counts');
assert.match(witness, /--expected-repo-root/, 'browser witness requires the reviewed repo root');
assert.match(witness, /--expected-commit/, 'browser witness requires the reviewed commit');
assert.match(witness, /presetDocument\.source/, 'browser witness binds the saved artifact to its effective server source');
assert.match(witness, /requestedSource[\s\S]*effectiveSource/, 'browser witness preserves requested and effective source identity');

const contractSchema = {
  identity: schema.identity,
  controlCount: 1,
  controls: [{ key: 'volume-scene', param: 'volume_scene', tagName: 'SELECT', type: 'select-one' }],
  rendererControls: [],
  presentationControls: schema.presentationControls,
  routeExtraParams: ['volume_quality_reason'],
  activationParam: { key: 'kaminos_volume_smoke', value: '1' },
  excludedStateFields: ['fluidField'],
  forbiddenPresetFields: ['fluidField'],
  allowedNativePresetFields: schema.allowedNativePresetFields,
};
const hash = 'c'.repeat(64);
const artifact = {
  identity: 'kaminos-volume-settings-preset-artifact-v2',
  presetId: `vsp-${hash}`,
  contentHash: `sha256:${hash}`,
  schemaIdentity: contractSchema.identity,
  controlCount: 1,
  preset: {
    identity: 'kaminos-volume-settings-preset-v2',
    kind: 'settings-preset',
    schemaIdentity: contractSchema.identity,
    savedAt: '2026-08-30T21:00:00Z',
    route: 'http://kaminos.invalid/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_raymarch_smoke=off&volume_quality_reason=presentation-persistence-contract',
    domControls: {
      'volume-scene': {
        id: 'volume-scene', param: 'volume_scene', tagName: 'SELECT', type: 'select-one', value: 'tall_plume',
      },
    },
    controlCount: 1,
    presentationControls: {
      'raymarch-smoke-presentation': {
        id: 'raymarch-smoke-presentation',
        param: 'volume_raymarch_smoke',
        tagName: 'BUTTON',
        type: 'button-state',
        value: 'off',
      },
    },
    presentationControlCount: 1,
    stateExclusions: { fluidField: true },
    note: 'settings plus explicit smoke presentation',
  },
};

const receipt = validateVolumeSettingsPresetDocument(artifact, artifact.presetId, contractSchema);
assert.equal(receipt.presentationControlCount, 1);
const target = buildVolumeSettingsPresetTarget(receipt, 'http://127.0.0.1:18414');
assert.equal(target.searchParams.get('volume_raymarch_smoke'), 'off', 'ordinary preset target restores Smoke Off');

for (const view of ['splat-only', 'raymarch-only', 'smoke-hybrid', 'full-hybrid-diagnostic']) {
  const visualTarget = buildVolumeSettingsPresetVisualTarget(receipt, 'http://127.0.0.1:18414', view);
  assert.equal(
    validateVolumeSettingsPresetVisualTarget(receipt, visualTarget.searchParams),
    true,
    `${view} accepts a complete saved route with authored Smoke state`,
  );
}

const diagnosticVisualTarget = buildVolumeSettingsPresetVisualTarget(
  receipt,
  'http://127.0.0.1:18414',
  'smoke-hybrid',
  { assayToolbar: true },
);
assert.equal(diagnosticVisualTarget.searchParams.get('assay_toolbar'), '1');
assert.equal(
  validateVolumeSettingsPresetVisualTarget(receipt, diagnosticVisualTarget.searchParams),
  true,
  'the strict visual target admits the explicit diagnostic-toolbar route without weakening preset identity',
);
assert.match(
  loader,
  /buildVolumeSettingsPresetVisualTarget\(receipt, location\.origin, view, \{ assayToolbar: assayToolbarRequested \}\)/,
  'the preset loader forwards diagnostic-toolbar intent through its rebuilt selective-head target',
);
assert.match(
  witness,
  /effectiveAssayUrl[\s\S]*assay_toolbar[\s\S]*diagnosticAssayUrl:/,
  'the browser witness records the effective selective-head route after loader forwarding',
);

const partialVisualTarget = buildVolumeSettingsPresetVisualTarget(receipt, 'http://127.0.0.1:18414', 'raymarch-only');
partialVisualTarget.searchParams.delete('volume_scene');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(receipt, partialVisualTarget.searchParams),
  /partial|mismatch/,
  'visual preset validation rejects partial basin state',
);

const duplicateVisualTarget = buildVolumeSettingsPresetVisualTarget(receipt, 'http://127.0.0.1:18414', 'raymarch-only');
duplicateVisualTarget.searchParams.append('volume_scene', 'duplicate');
assert.throws(
  () => validateVolumeSettingsPresetVisualTarget(receipt, duplicateVisualTarget.searchParams),
  /partial|mismatch/,
  'visual preset validation rejects duplicate basin state',
);

const invalid = structuredClone(artifact);
invalid.preset.presentationControls['raymarch-smoke-presentation'].value = 'maybe';
invalid.preset.route = invalid.preset.route.replace('volume_raymarch_smoke=off', 'volume_raymarch_smoke=maybe');
assert.throws(
  () => validateVolumeSettingsPresetDocument(invalid, invalid.presetId, contractSchema),
  /unsupported value.*raymarch-smoke-presentation/,
  'presentation persistence rejects unsupported smoke states',
);

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-volume-settings-witness-failure-'));
try {
  const failureReportPath = join(failureRoot, 'failure.json');
  const expectedCommit = 'd'.repeat(40);
  const failure = spawnSync(process.execPath, [
    join(root, 'volume-settings-preset-witness.mjs'),
    '--url', 'not-a-valid-url',
    '--expected-repo-root', root,
    '--expected-commit', expectedCommit,
    '--report', failureReportPath,
  ], { encoding: 'utf8' });
  assert.notEqual(failure.status, 0, 'invalid source witness unexpectedly succeeded');
  assert.equal(existsSync(failureReportPath), true, 'pre-browser witness failure did not write its report');
  const failureReport = JSON.parse(readFileSync(failureReportPath, 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'argument-validation');
  assert.deepEqual(failureReport.requestedSource, { repoRoot: root, commit: expectedCommit });
  assert.equal(failureReport.effectiveSource, null);
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('volume settings presentation persistence contracts passed');
