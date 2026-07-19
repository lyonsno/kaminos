import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVolumeSettingsPresetVisualTarget,
  validateVolumeSettingsPresetDocument,
} from '../volume-settings-preset-contract.mjs';

const root = join(import.meta.dirname, '..');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));
const index = readFileSync(join(root, 'index.html'), 'utf8');

const expectedRendererControls = [
  ['volume-flow-kernel-strength', 'volume_flow_kernel_strength'],
  ['volume-flow-kernel-radius', 'volume_flow_kernel_radius'],
  ['volume-flow-kernel-coherence', 'volume_flow_kernel_coherence'],
];

assert.deepEqual(
  (schema.rendererControls || []).map(({ key, param }) => [key, param]),
  expectedRendererControls,
  'cotangent covariance authoring values have an explicit renderer-control persistence axis',
);
for (const [key] of expectedRendererControls) {
  assert.match(
    index,
    new RegExp(`id=["']${key}["'][^>]+data-volume-settings-role=["']renderer["']`),
    `${key} is visibly classified outside the basin-state control inventory`,
  );
}

const contractSchema = {
  identity: 'kaminos-volume-settings-preset-schema-v2',
  controlCount: 1,
  controls: [{ key: 'volume-scene', param: 'volume_scene', tagName: 'SELECT', type: 'select-one' }],
  rendererControls: schema.rendererControls,
  routeExtraParams: ['volume_quality_reason'],
  activationParam: { key: 'kaminos_volume_smoke', value: '1' },
  excludedStateFields: ['fluidField'],
  forbiddenPresetFields: ['fluidField'],
  allowedNativePresetFields: [
    'identity',
    'kind',
    'schemaIdentity',
    'savedAt',
    'route',
    'domControls',
    'controlCount',
    'rendererControls',
    'rendererControlCount',
    'stateExclusions',
    'note',
  ],
};
const rendererControls = Object.fromEntries(contractSchema.rendererControls.map(descriptor => [
  descriptor.key,
  {
    id: descriptor.key,
    param: descriptor.param,
    tagName: descriptor.tagName,
    type: descriptor.type,
    value: descriptor.param === 'volume_flow_kernel_radius' ? 0.03 : 1,
  },
]));
const route = new URL('http://kaminos.invalid/');
route.searchParams.set('kaminos_volume_smoke', '1');
route.searchParams.set('volume_scene', 'tall_plume');
route.searchParams.set('volume_quality_reason', 'renderer-control-roundtrip-contract');
for (const entry of Object.values(rendererControls)) route.searchParams.set(entry.param, String(entry.value));

const hash = 'b'.repeat(64);
const artifact = {
  identity: 'kaminos-volume-settings-preset-artifact-v2',
  presetId: `vsp-${hash}`,
  contentHash: `sha256:${hash}`,
  schemaIdentity: contractSchema.identity,
  controlCount: contractSchema.controlCount,
  preset: {
    identity: 'kaminos-volume-settings-preset-v2',
    kind: 'settings-preset',
    schemaIdentity: contractSchema.identity,
    savedAt: '2026-07-16T00:00:00Z',
    route: route.toString(),
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
    rendererControls,
    rendererControlCount: Object.keys(rendererControls).length,
    stateExclusions: { fluidField: true },
    note: 'basin state plus explicit renderer covariance controls',
  },
};

const receipt = validateVolumeSettingsPresetDocument(artifact, artifact.presetId, contractSchema);
const target = buildVolumeSettingsPresetVisualTarget(receipt, 'http://127.0.0.1:18780', 'splat-only');
assert.equal(target.searchParams.get('volume_flow_kernel_strength'), '1');
assert.equal(target.searchParams.get('volume_flow_kernel_radius'), '0.03');
assert.equal(target.searchParams.get('volume_flow_kernel_coherence'), '1');
assert.equal(receipt.rendererControlCount, 3);

console.log('volume settings renderer controls contracts passed');
