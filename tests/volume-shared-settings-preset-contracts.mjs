import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assessSharedVolumeSettingsApplication,
  buildSharedVolumeSettingsReplayPlan,
  buildSharedVolumeSettingsTarget,
  resolveSharedVolumeSettingsPreset,
} from '../volume-shared-settings-preset.mjs';

const schema = JSON.parse(readFileSync(
  new URL('../volume-settings-preset-schema-v2.json', import.meta.url),
  'utf8',
));

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function writeFixture(store, { alias = 'operator-latest', controlCount = 186 } = {}) {
  const controls = {};
  const params = new URLSearchParams({ kaminos_volume_smoke: '1' });
  for (const [index, canonical] of schema.controls.slice(0, controlCount).entries()) {
    const { key, param, tagName, type } = canonical;
    const value = index / 10;
    controls[key] = { id: key, param, tagName, type, value };
    params.set(param, String(value));
  }
  params.set('volume_quality_reason', 'operator-settings-only-capture');
  const canonical = {
    schemaIdentity: 'kaminos-volume-settings-preset-schema-v2',
    controls: Object.fromEntries(Object.entries(controls).map(([key, descriptor]) => [key, descriptor.value])),
  };
  const hash = createHash('sha256').update(canonicalJson(canonical)).digest('hex');
  const presetId = `vsp-${hash}`;
  const artifact = {
    identity: 'kaminos-volume-settings-preset-artifact-v2',
    presetId,
    contentHash: `sha256:${hash}`,
    schemaIdentity: 'kaminos-volume-settings-preset-schema-v2',
    controlCount,
    initialLabel: 'Operator latest',
    writtenAt: '2026-07-16T07:10:21Z',
    source: { branch: 'cc/operator-basin', commit: 'a'.repeat(40) },
    preset: {
      identity: 'kaminos-volume-settings-preset-v2',
      kind: 'settings-preset',
      schemaIdentity: 'kaminos-volume-settings-preset-schema-v2',
      route: `http://127.0.0.1:18780/?${params}`,
      domControls: controls,
      controlCount,
      stateExclusions: {
        fluidField: true,
        frontField: true,
        boundarySidecar: true,
        splatInstances: true,
        historyBuffers: true,
        pressureState: true,
        replayState: true,
      },
    },
  };
  const aliasDocument = {
    identity: 'kaminos-volume-settings-preset-alias-v1',
    alias,
    label: 'Operator latest',
    presetId,
    contentHash: artifact.contentHash,
    schemaIdentity: artifact.schemaIdentity,
    updatedAt: artifact.writtenAt,
    source: artifact.source,
  };
  mkdirSync(join(store, 'aliases'), { recursive: true });
  mkdirSync(join(store, 'presets'), { recursive: true });
  writeFileSync(join(store, 'aliases', `${alias}.json`), JSON.stringify(aliasDocument));
  writeFileSync(join(store, 'presets', `${presetId}.json`), JSON.stringify(artifact));
  return { alias, artifact, aliasDocument, presetId };
}

const store = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-contract-'));
const fixture = writeFixture(store);
const receipt = resolveSharedVolumeSettingsPreset({ storePath: store, presetRef: fixture.alias });
assert.equal(receipt.requestedPresetRef, fixture.alias);
assert.equal(receipt.alias, fixture.alias);
assert.equal(receipt.presetId, fixture.presetId);
assert.equal(receipt.controlCount, 186);
assert.equal(receipt.source.commit, 'a'.repeat(40));
assert.equal(receipt.authority, 'shared-volume-settings-preset-v2');
const appliedControls = receipt.controls.map(control => ({
  key: control.key,
  id: control.id,
  param: control.param,
  found: true,
  actualTagName: control.tagName,
  actualType: control.type,
  actualValue: control.expectedValue,
}));
const application = assessSharedVolumeSettingsApplication(receipt, appliedControls);
assert.equal(application.status, 'passed');
assert.equal(application.matchedControlCount, 186);
assert.equal(application.authority, 'effective-browser-dom-controls-v1');
const replayPlan = buildSharedVolumeSettingsReplayPlan(receipt);
assert.equal(replayPlan.length, 186);
assert.deepEqual(replayPlan[0], {
  key: schema.controls[0].key,
  id: schema.controls[0].key,
  param: schema.controls[0].param,
  tagName: schema.controls[0].tagName,
  type: schema.controls[0].type,
  expectedValue: 0,
});
assert.throws(
  () => assessSharedVolumeSettingsApplication(receipt, appliedControls.map((control, index) => (
    index === 17 ? { ...control, actualValue: 'silently-defaulted' } : control
  ))),
  /effective browser controls mismatch/i,
  'a stale or defaulted browser control must fail after a valid preset resolves',
);
assert.throws(
  () => assessSharedVolumeSettingsApplication(receipt, appliedControls.slice(0, -1)),
  /exactly 186 effective browser controls/i,
  'a missing DOM control must fail rather than weaken the effective preset receipt',
);

const target = buildSharedVolumeSettingsTarget(receipt, 'http://127.0.0.1:18816/stale?volume_contract_000=wrong');
assert.equal(target.origin, 'http://127.0.0.1:18816');
assert.equal(target.pathname, '/');
assert.equal(target.searchParams.get(schema.controls[0].param), '0');
assert.equal(target.searchParams.get(schema.controls[185].param), '18.5');
assert.equal(target.searchParams.get('settings_preset'), fixture.presetId);
assert.equal(target.searchParams.get('settings_preset_authority'), receipt.authority);
assert.equal([...target.searchParams].filter(([key]) => key.startsWith('volume_')).length, 187);

const partialStore = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-partial-'));
const partial = writeFixture(partialStore);
const partialArtifactPath = join(partialStore, 'presets', `${partial.presetId}.json`);
const partialArtifact = JSON.parse(readFileSync(partialArtifactPath, 'utf8'));
delete partialArtifact.preset.domControls[schema.controls[185].key];
partialArtifact.preset.controlCount = 185;
writeFileSync(partialArtifactPath, JSON.stringify(partialArtifact));
assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: partialStore, presetRef: fixture.alias }),
  /exactly 186 controls/i,
  'a partial preset cannot silently fall back to live defaults',
);

const corruptAliasStore = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-alias-'));
const corruptAlias = writeFixture(corruptAliasStore);
const aliasPath = join(corruptAliasStore, 'aliases', `${corruptAlias.alias}.json`);
const aliasDocument = JSON.parse(readFileSync(aliasPath, 'utf8'));
aliasDocument.contentHash = `sha256:${'b'.repeat(64)}`;
writeFileSync(aliasPath, JSON.stringify(aliasDocument));
assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: corruptAliasStore, presetRef: corruptAlias.alias }),
  /alias content hash mismatch/i,
  'an alias cannot point at content other than its signed identity',
);

const routeMismatchStore = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-route-'));
const routeMismatch = writeFixture(routeMismatchStore);
const artifactPath = join(routeMismatchStore, 'presets', `${routeMismatch.presetId}.json`);
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
const route = new URL(artifact.preset.route);
route.searchParams.set(schema.controls[0].param, 'forged');
artifact.preset.route = route.toString();
writeFileSync(artifactPath, JSON.stringify(artifact));
assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: routeMismatchStore, presetRef: routeMismatch.alias }),
  /route\/control mismatch/i,
  'a stale or forged route cannot impersonate the immutable controls',
);

const renamedParamStore = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-renamed-param-'));
const renamedParam = writeFixture(renamedParamStore);
const renamedArtifactPath = join(renamedParamStore, 'presets', `${renamedParam.presetId}.json`);
const renamedArtifact = JSON.parse(readFileSync(renamedArtifactPath, 'utf8'));
const firstCanonicalControl = schema.controls[0];
renamedArtifact.preset.domControls[firstCanonicalControl.key].param = 'volume_inert_but_hash_preserving';
const renamedRoute = new URL(renamedArtifact.preset.route);
const renamedValue = renamedRoute.searchParams.get(firstCanonicalControl.param);
renamedRoute.searchParams.delete(firstCanonicalControl.param);
renamedRoute.searchParams.set('volume_inert_but_hash_preserving', renamedValue);
renamedArtifact.preset.route = renamedRoute.toString();
writeFileSync(renamedArtifactPath, JSON.stringify(renamedArtifact));
assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: renamedParamStore, presetRef: renamedParam.alias }),
  /canonical control inventory mismatch/i,
  'content identity cannot survive renaming a canonical route parameter to an inert control',
);

assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: store, presetRef: 'missing-preset' }),
  /not found/i,
  'a missing alias must fail instead of selecting a default basin',
);

const witness = readFileSync(new URL('../volume-boundary-splat-motion-witness.mjs', import.meta.url), 'utf8');
assert.match(witness, /--settings-preset/, 'hybrid witness must accept an immutable preset id or alias');
assert.match(witness, /--settings-store/, 'hybrid witness must surface the effective shared store path');
assert.match(witness, /settingsPresetReceipt/, 'success and failure evidence must retain preset resolution identity');
assert.match(witness, /settingsPresetApplication/, 'witness evidence must retain effective browser control admission');
assert.match(witness, /settingsPresetReplay/, 'witness evidence must retain exact DOM replay before admission');

console.log('shared volume settings preset contracts passed');
