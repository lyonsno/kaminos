import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSharedVolumeSettingsTarget,
  resolveSharedVolumeSettingsPreset,
} from '../volume-shared-settings-preset.mjs';

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
  for (let index = 0; index < controlCount; index += 1) {
    const key = `control-${String(index).padStart(3, '0')}`;
    const param = `volume_contract_${String(index).padStart(3, '0')}`;
    const value = index / 10;
    controls[key] = { id: key, param, tagName: 'INPUT', type: 'range', value };
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

const target = buildSharedVolumeSettingsTarget(receipt, 'http://127.0.0.1:18816/stale?volume_contract_000=wrong');
assert.equal(target.origin, 'http://127.0.0.1:18816');
assert.equal(target.pathname, '/');
assert.equal(target.searchParams.get('volume_contract_000'), '0');
assert.equal(target.searchParams.get('volume_contract_185'), '18.5');
assert.equal(target.searchParams.get('settings_preset'), fixture.presetId);
assert.equal(target.searchParams.get('settings_preset_authority'), receipt.authority);
assert.equal([...target.searchParams].filter(([key]) => key.startsWith('volume_contract_')).length, 186);

const partialStore = mkdtempSync(join(tmpdir(), 'kaminos-shared-preset-partial-'));
const partial = writeFixture(partialStore);
const partialArtifactPath = join(partialStore, 'presets', `${partial.presetId}.json`);
const partialArtifact = JSON.parse(readFileSync(partialArtifactPath, 'utf8'));
delete partialArtifact.preset.domControls['control-185'];
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
artifact.preset.route = artifact.preset.route.replace('volume_contract_000=0', 'volume_contract_000=forged');
writeFileSync(artifactPath, JSON.stringify(artifact));
assert.throws(
  () => resolveSharedVolumeSettingsPreset({ storePath: routeMismatchStore, presetRef: routeMismatch.alias }),
  /route\/control mismatch/i,
  'a stale or forged route cannot impersonate the immutable controls',
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

console.log('shared volume settings preset contracts passed');
