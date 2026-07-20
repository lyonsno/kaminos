#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const packagePath = join(fixtureRoot, 'packages', 'cheap-firebowl.json');
const channelPath = join(fixtureRoot, 'channels', 'cheap-firebowl-current.json');
const mountPath = join(fixtureRoot, 'consumer', 'mounted-current.json');

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
  'export',
  '--handle', 'Cheap Firebowl',
  '--package', packagePath,
  '--settings-preset', presetPath,
  '--settings-schema', schemaPath,
  '--effective-state', effectiveStatePath,
  '--source-commit', '91374fa8297119d6513a927b00892bdbda7c9a45',
  '--origin', 'http://127.0.0.1:18782',
  '--channel', channelPath,
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(exported.status, 0, `${exported.stderr}\n${exported.stdout}`);
const exportReceipt = JSON.parse(exported.stdout);
assert.equal(exportReceipt.status, 'written');
assert.equal(exportReceipt.packagePath, packagePath);
assert.equal(exportReceipt.channelPath, channelPath);
assert.match(exportReceipt.handle, /^cheap-firebowl$/);
assert.match(exportReceipt.revision, /^basinrev-[a-f0-9]{64}$/);

const packageDocument = JSON.parse(readFileSync(packagePath, 'utf8'));
assert.equal(packageDocument.schema, 'kaminos.volume.basin-promotion-package.v0');
assert.equal(packageDocument.handle, 'cheap-firebowl');
assert.equal(packageDocument.label, 'Cheap Firebowl');
assert.equal(packageDocument.revision, exportReceipt.revision);
assert.equal(packageDocument.sourceCommit, '91374fa8297119d6513a927b00892bdbda7c9a45');
assert.equal(packageDocument.settingsPreset.presetId, presetArtifact.presetId);
assert.equal(packageDocument.effectiveState.renderer.backend, 'WebGPU:apple');
assert.equal(packageDocument.routes.loaderUrl, `http://127.0.0.1:18782/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_flow_kernel_strength=0.56&volume_quality_reason=promotion-roundtrip&settings_preset=${presetArtifact.presetId}&settings_preset_authority=shared-volume-settings-preset-v2`);
assert.equal(packageDocument.routing.controlPlane.schema, 'kaminos.volume.basin-promotion-routing.v0');
assert.equal(packageDocument.routing.controlPlane.sourceCommit, packageDocument.sourceCommit);
assert.equal(packageDocument.routing.consumer.mountContract, 'kaminos.volume.basin-promotion-mount.v0');

const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
assert.equal(channel.schema, 'kaminos.volume.basin-promotion-channel.v0');
assert.equal(channel.handle, 'cheap-firebowl');
assert.equal(channel.current.revision, exportReceipt.revision);
assert.equal(channel.current.packagePath, packagePath);
assert.equal(channel.history.length, 1);

const mounted = spawnSync(process.execPath, [
  cli,
  'mount',
  '--package', packagePath,
  '--channel', channelPath,
  '--handle', 'cheap-firebowl',
  '--revision', exportReceipt.revision,
  '--out', mountPath,
], { encoding: 'utf8', timeout: 30_000 });
assert.equal(mounted.status, 0, `${mounted.stderr}\n${mounted.stdout}`);
const mountReceipt = JSON.parse(mounted.stdout);
assert.equal(mountReceipt.status, 'mounted');
assert.equal(mountReceipt.mountPath, mountPath);
assert.equal(mountReceipt.packagePath, packagePath);
assert.equal(mountReceipt.revision, exportReceipt.revision);

const mount = JSON.parse(readFileSync(mountPath, 'utf8'));
assert.equal(mount.schema, 'kaminos.volume.basin-promotion-mount.v0');
assert.equal(mount.handle, 'cheap-firebowl');
assert.equal(mount.revision, exportReceipt.revision);
assert.equal(mount.currentChannel.path, channelPath);
assert.equal(mount.currentChannel.revision, exportReceipt.revision);
assert.equal(mount.sourcePackage.path, packagePath);
assert.equal(mount.sourcePackage.sha256, exportReceipt.packageSha256);
assert.equal(mount.loader.targetUrl, packageDocument.routes.loaderUrl);
assert.equal(mount.consumerContract.replaceRevisionByUpdatingChannel, true);

const staleMount = spawnSync(process.execPath, [
  cli,
  'mount',
  '--package', packagePath,
  '--channel', channelPath,
  '--handle', 'cheap-firebowl',
  '--revision', 'basinrev-' + '0'.repeat(64),
], { encoding: 'utf8', timeout: 30_000 });
assert.notEqual(staleMount.status, 0, 'consumer mount must reject stale or wrong revision claims');
assert.match(staleMount.stderr, /revision/i);

console.log('volume basin promotion package contracts passed');
