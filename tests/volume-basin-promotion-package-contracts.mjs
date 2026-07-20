#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'volume-basin-promotion-package.mjs');
assert.ok(existsSync(cli), 'basin promotion package CLI must exist');

const fixtureRoot = mkdtempSync(join(tmpdir(), 'kaminos-basin-promotion-'));
const schemaPath = join(fixtureRoot, 'schema.json');
const presetPath = join(fixtureRoot, 'preset.json');
const effectiveStatePath = join(fixtureRoot, 'effective-state.json');
const promotionRoot = join(fixtureRoot, 'author-repo', 'artifacts', 'basin-promotions');
const relocatedRoot = join(fixtureRoot, 'product-repo', 'basin-promotions');
const mountPath = join(fixtureRoot, 'product-repo', 'config', 'mounted-current.json');
const consumerSettingsStore = join(fixtureRoot, 'product-repo', 'runtime', 'settings-store');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const schema = {
  identity: 'kaminos-volume-settings-preset-schema-v2',
  controlCount: 1,
  controls: [
    { key: 'volume-scene', param: 'volume_scene', tagName: 'SELECT', type: 'select-one' },
  ],
  rendererControls: [
    { key: 'volume-flow-kernel-strength', param: 'volume_flow_kernel_strength', tagName: 'INPUT', type: 'range' },
  ],
  routeExtraParams: ['volume_quality_reason'],
  activationParam: { key: 'kaminos_volume_smoke', value: '1' },
  excludedStateFields: ['fluidField', 'frontField', 'historyBuffers'],
  forbiddenPresetFields: ['fluidField', 'frontField', 'historyBuffers'],
  allowedNativePresetFields: [
    'identity', 'kind', 'schemaIdentity', 'savedAt', 'route', 'domControls', 'controlCount',
    'rendererControls', 'rendererControlCount', 'stateExclusions', 'note',
  ],
};

const preset = {
  identity: 'kaminos-volume-settings-preset-v2',
  kind: 'settings-preset',
  schemaIdentity: schema.identity,
  savedAt: '2026-07-20T06:45:00.000Z',
  route: 'http://127.0.0.1:18782/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_flow_kernel_strength=0.56&volume_quality_reason=promotion-roundtrip',
  domControls: {
    'volume-scene': {
      id: 'volume-scene',
      param: 'volume_scene',
      tagName: 'SELECT',
      type: 'select-one',
      value: 'tall_plume',
    },
  },
  controlCount: 1,
  rendererControls: {
    'volume-flow-kernel-strength': {
      id: 'volume-flow-kernel-strength',
      param: 'volume_flow_kernel_strength',
      tagName: 'INPUT',
      type: 'range',
      value: 0.56,
    },
  },
  rendererControlCount: 1,
  stateExclusions: {
    fluidField: true,
    frontField: true,
    historyBuffers: true,
  },
  note: 'fixture settings only',
};

const presetContentHash = createHash('sha256')
  .update(canonicalJson({
    schemaIdentity: schema.identity,
    controls: { 'volume-scene': 'tall_plume' },
    rendererControls: { 'volume-flow-kernel-strength': 0.56 },
  }))
  .digest('hex');
const presetArtifact = {
  identity: 'kaminos-volume-settings-preset-artifact-v2',
  presetId: `vsp-${presetContentHash}`,
  requestedPresetRef: 'cheap-firebowl',
  alias: 'cheap-firebowl',
  label: 'Cheap Firebowl',
  contentHash: `sha256:${presetContentHash}`,
  schemaIdentity: schema.identity,
  controlCount: schema.controlCount,
  storePath: '/caller/addressed/settings-store',
  preset,
};

const effectiveState = {
  schema: 'kaminos.volume.effective-basin-state.v0',
  capturedAt: '2026-07-20T06:45:01.000Z',
  simulator: { identity: 'coefficient-state-120-f120-s120', grid: 160, simStepCount: 120 },
  renderer: { identity: 'native-3d-compute-fluid-raymarch-v0', backend: 'WebGPU:apple' },
  presentation: { volumePresentation: 'beauty', raymarchSmoke: 'on' },
  source: { requestedSource: 'learned-flow', effectiveSource: 'learned-flow' },
  initialization: { authority: 'shared-volume-settings-preset-v2', presetId: presetArtifact.presetId },
  route: { requestedPath: '/', effectivePath: '/', targetOrigin: 'http://127.0.0.1:18782' },
  composition: { requested: 'smoke-raymarch-under-splats-v0', effective: 'smoke-raymarch-under-splats-v0' },
  backend: { requested: 'WebGPU', effective: 'WebGPU:apple' },
  schemaIdentity: schema.identity,
};

writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
writeFileSync(presetPath, `${JSON.stringify(presetArtifact, null, 2)}\n`);
writeFileSync(effectiveStatePath, `${JSON.stringify(effectiveState, null, 2)}\n`);

const exported = spawnSync(process.execPath, [
  cli,
  'promote',
  '--handle', 'Cheap Firebowl',
  '--root', promotionRoot,
  '--settings-preset', presetPath,
  '--settings-schema', schemaPath,
  '--effective-state', effectiveStatePath,
  '--source-commit', '91374fa8297119d6513a927b00892bdbda7c9a45',
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(exported.status, 0, `${exported.stderr}\n${exported.stdout}`);
const exportReceipt = JSON.parse(exported.stdout);
assert.equal(exportReceipt.status, 'written');
assert.match(exportReceipt.handle, /^cheap-firebowl$/);
assert.match(exportReceipt.revision, /^basinrev-[a-f0-9]{64}$/);
const packagePath = join(
  promotionRoot,
  'cheap-firebowl',
  'revisions',
  exportReceipt.revision,
  'package.json',
);
const channelPath = join(promotionRoot, 'cheap-firebowl', 'current.json');
assert.equal(exportReceipt.packagePath, packagePath);
assert.equal(exportReceipt.channelPath, channelPath);
assert.equal(exportReceipt.packageRelativePath, `revisions/${exportReceipt.revision}/package.json`);

const packageDocument = JSON.parse(readFileSync(packagePath, 'utf8'));
assert.equal(packageDocument.schema, 'kaminos.volume.basin-promotion-package.v1');
assert.equal(packageDocument.handle, 'cheap-firebowl');
assert.equal(packageDocument.label, 'Cheap Firebowl');
assert.equal(packageDocument.revision, exportReceipt.revision);
assert.equal(packageDocument.sourceCommit, '91374fa8297119d6513a927b00892bdbda7c9a45');
assert.equal(packageDocument.settingsPreset.presetId, presetArtifact.presetId);
assert.deepEqual(
  packageDocument.settingsPreset.artifact,
  Object.fromEntries(Object.entries(presetArtifact).filter(([key]) => key !== 'storePath')),
  'promotion package must embed the exact loader-validated settings preset artifact',
);
assert.deepEqual(packageDocument.settingsPreset.schema, schema);
assert.equal(Object.hasOwn(packageDocument.effectiveState, 'capturedAt'), false);
assert.equal(packageDocument.effectiveState.renderer.backend, 'WebGPU:apple');
assert.equal(packageDocument.routes.loader, `/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_flow_kernel_strength=0.56&volume_quality_reason=promotion-roundtrip&settings_preset=${presetArtifact.presetId}&settings_preset_authority=shared-volume-settings-preset-v2`);
assert.equal(packageDocument.routing.controlPlane.schema, 'kaminos.volume.basin-promotion-routing.v1');
assert.equal(packageDocument.routing.controlPlane.sourceCommit, packageDocument.sourceCommit);
assert.equal(packageDocument.routing.consumer.mountContract, 'kaminos.volume.basin-promotion-mount.v1');
assert.equal(JSON.stringify(packageDocument).includes(fixtureRoot), false, 'immutable package must not embed author paths');

const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
assert.equal(channel.schema, 'kaminos.volume.basin-promotion-channel.v1');
assert.equal(channel.handle, 'cheap-firebowl');
assert.equal(channel.current.revision, exportReceipt.revision);
assert.equal(channel.current.packageRelativePath, `revisions/${exportReceipt.revision}/package.json`);
assert.equal(channel.history.length, 1);
assert.equal(JSON.stringify(channel).includes(fixtureRoot), false, 'channel must not embed author paths');

effectiveState.capturedAt = '2026-07-20T06:46:01.000Z';
writeFileSync(effectiveStatePath, `${JSON.stringify(effectiveState, null, 2)}\n`);
const repeated = spawnSync(process.execPath, [
  cli,
  'promote',
  '--handle', 'Cheap Firebowl',
  '--root', promotionRoot,
  '--settings-preset', presetPath,
  '--settings-schema', schemaPath,
  '--effective-state', effectiveStatePath,
  '--source-commit', '91374fa8297119d6513a927b00892bdbda7c9a45',
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(repeated.status, 0, `${repeated.stderr}\n${repeated.stdout}`);
const repeatedReceipt = JSON.parse(repeated.stdout);
assert.equal(repeatedReceipt.revision, exportReceipt.revision, 'capture time must not create a false basin revision');
assert.equal(JSON.parse(readFileSync(channelPath, 'utf8')).history.length, 1);

cpSync(promotionRoot, relocatedRoot, { recursive: true });
const relocatedChannelPath = join(relocatedRoot, 'cheap-firebowl', 'current.json');
const relocatedPackagePath = join(
  relocatedRoot,
  'cheap-firebowl',
  'revisions',
  exportReceipt.revision,
  'package.json',
);

const mounted = spawnSync(process.execPath, [
  cli,
  'mount',
  '--channel', relocatedChannelPath,
  '--handle', 'cheap-firebowl',
  '--revision', exportReceipt.revision,
  '--settings-store', consumerSettingsStore,
  '--origin', 'https://product.example/kaminos/',
  '--out', mountPath,
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(mounted.status, 0, `${mounted.stderr}\n${mounted.stdout}`);
const mountReceipt = JSON.parse(mounted.stdout);
assert.equal(mountReceipt.status, 'mounted');
assert.equal(mountReceipt.mountPath, mountPath);
assert.equal(mountReceipt.packagePath, relocatedPackagePath);
assert.equal(mountReceipt.revision, exportReceipt.revision);
assert.equal(
  mountReceipt.settingsPresetPath,
  join(consumerSettingsStore, 'presets', `${presetArtifact.presetId}.json`),
);

const mount = JSON.parse(readFileSync(mountPath, 'utf8'));
assert.equal(mount.schema, 'kaminos.volume.basin-promotion-mount.v1');
assert.equal(mount.handle, 'cheap-firebowl');
assert.equal(mount.revision, exportReceipt.revision);
assert.equal(mount.currentChannel.revision, exportReceipt.revision);
assert.equal(mount.sourcePackage.sha256, exportReceipt.packageSha256);
assert.equal(mount.loader.targetUrl, `https://product.example/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_flow_kernel_strength=0.56&volume_quality_reason=promotion-roundtrip&settings_preset=${presetArtifact.presetId}&settings_preset_authority=shared-volume-settings-preset-v2`);
assert.equal(mount.consumerContract.replaceRevisionByUpdatingChannel, true);
assert.equal(JSON.stringify(mount).includes(fixtureRoot), false, 'consumer mount must use relocatable source locators');
assert.deepEqual(
  JSON.parse(readFileSync(mountReceipt.settingsPresetPath, 'utf8')),
  packageDocument.settingsPreset.artifact,
  'consumer mount must install the embedded loader-valid preset',
);

const staleMount = spawnSync(process.execPath, [
  cli,
  'mount',
  '--channel', relocatedChannelPath,
  '--handle', 'cheap-firebowl',
  '--revision', 'basinrev-' + '0'.repeat(64),
  '--settings-store', consumerSettingsStore,
  '--origin', 'https://product.example/kaminos/',
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(staleMount.status, 0, 'consumer mount must reject stale or wrong revision claims');
assert.match(staleMount.stderr, /revision/i);

const escapedChannelPath = join(relocatedRoot, 'cheap-firebowl', 'escaped-current.json');
const escapedChannel = structuredClone(channel);
escapedChannel.current.packageRelativePath = '../../outside-package.json';
writeFileSync(escapedChannelPath, `${JSON.stringify(escapedChannel, null, 2)}\n`);
const escapedMount = spawnSync(process.execPath, [
  cli,
  'mount',
  '--channel', escapedChannelPath,
  '--handle', 'cheap-firebowl',
  '--revision', exportReceipt.revision,
  '--settings-store', consumerSettingsStore,
  '--origin', 'https://product.example/kaminos/',
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(escapedMount.status, 0, 'consumer mount must reject a channel that escapes its portable root');
assert.match(escapedMount.stderr, /not portable/i);

console.log('volume basin promotion package contracts passed');
