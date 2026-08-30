import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createWakeFirePresetMountReceipt,
} from '../wake-volume-settings-preset-mount.mjs';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(join(root, 'index.html'), 'utf8');
const mountContract = readFileSync(join(root, 'wake-volume-settings-preset-mount.mjs'), 'utf8');
const schema = JSON.parse(readFileSync(join(root, 'volume-settings-preset-schema-v2.json'), 'utf8'));

for (const entry of [...schema.controls, ...schema.rendererControls]) {
  assert.match(
    source,
    new RegExp(`id=["']${entry.key}["']`),
    `Wake host must expose canonical preset control ${entry.key}`,
  );
}

assert.match(
  mountContract,
  /wake_fire_preset/,
  'Wake must accept a stable caller-selected fire-preset handle',
);
assert.match(
  source + mountContract,
  /__kaminosWakeFirePresetMountReceipt/,
  'the product route must expose the exact requested/effective mount identity',
);
assert.match(
  source,
  /ensureKaminosVolumeRouteInitialized\(\)[\s\S]*mountWakeFirePreset[\s\S]*applyKilnContentionFireBudget\(\)/,
  'the authored basin must mount after the real engine initializes and before Wake reapplies its product budget',
);
assert.match(
  source,
  /mountWakeFirePreset[\s\S]*volume-boundary-splat-mode[\s\S]*['"]off['"]/,
  'the mounted product presentation must remove boundary splats instead of merely hiding them',
);
assert.match(
  source,
  /id="crucible-viewport-fire-preset"/,
  'the actual Crucible product surface must show which stable handle and immutable revision it mounted',
);
assert.match(
  source,
  /#crucible-viewport-fire-preset\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*\}/,
  'the complete immutable revision must wrap visibly inside the Wake firing mouth',
);
assert.match(
  mountContract,
  /kaminos\.wake-raymarch-preset-projection\.v1/,
  'Wake must name the projection that separates authored basin state from product-owned compute and presentation policy',
);
for (const id of [
  'volume-resolution',
  'volume-render-scale',
  'volume-adaptive-rays',
  'volume-boundary-splat-mode',
]) {
  assert.match(
    mountContract,
    new RegExp(`['"]${id}['"]`),
    `Wake must declare the consumer-owned override for ${id}`,
  );
}
assert.match(
  source,
  /<option value="">default<\/option>/,
  'Wake must represent the producer-authored empty/default shell-inspection value without silent substitution',
);
assert.match(
  source,
  /id="volume-steps"[^>]*step="1"/,
  'Wake must preserve caller-authored integer ray steps without four-step coercion',
);
assert.match(
  source,
  /\['color', 'text', 'url', 'search', 'password'\]\.includes\(el\.type\)/,
  'Wake must preserve empty text controls as strings instead of coercing them to numeric zero',
);
assert.match(
  source,
  /function clearWakeFirePresetMountState/,
  'Wake must own one explicit stale-identity revocation path',
);
assert.match(
  source,
  /async function mountWakeFirePresetControls[\s\S]*clearWakeFirePresetMountState\('mount-started'/,
  'every asynchronous remount must revoke the preceding identity before loading a new package',
);
assert.match(
  source,
  /volumePrototype\?\.setControls\(readVolumeControls\(\)\);[\s\S]*await waitForWakeFirePresetRendererFrame\(previousFrameCount\)[\s\S]*completeWakeFirePresetMount\(productBudget, rendererState\)/,
  'the success receipt must be derived only after the renderer consumes the merged controls',
);
assert.match(
  source,
  /completeWakeFirePresetMount\(productBudget, rendererState\)[\s\S]*get\('crucible_workspace'\) === 'operational'[\s\S]*setActiveTab\('generate'\)/,
  'the standalone Wake preset route must open the requested operational product surface even without a composition id',
);
assert.match(
  source,
  /catch \(err\) \{[\s\S]*clearWakeFirePresetMountState\('kiln-fire-start-failed'/,
  'a failed kiln start must revoke any provisional or preceding preset identity',
);
assert.match(
  source,
  /initKaminosVolumeRoute\(\)[\s\S]*mountWakeFirePresetForKiln/,
  'the scene-init fallback must preserve a requested Wake preset mount',
);

const sourceReceipt = {
  alias: 'fixture-fire',
  label: 'Fixture Fire',
  presetId: `vsp-${'a'.repeat(64)}`,
  contentHash: `sha256:${'a'.repeat(64)}`,
  schemaIdentity: 'kaminos-volume-settings-preset-schema-v2',
  sourcePresetAuthority: 'shared-volume-settings-preset-v2',
  storePath: '/fixture/store',
  rendererControlCount: 3,
  preset: {
    controlCount: 4,
    domControls: {
      'volume-density': { param: 'volume_density', value: 0.35 },
      'volume-resolution': { param: 'volume_resolution', value: '128' },
      'volume-render-scale': { param: 'volume_render_scale', value: 0.25 },
      'volume-adaptive-rays': { param: 'volume_adaptive_rays', value: 0.5 },
      'volume-boundary-splat-mode': { param: 'volume_boundary_splat_mode', value: 'kernel_moment_covariance' },
    },
    rendererControls: {
      'volume-flow-kernel-strength': { param: 'volume_flow_kernel_strength', value: 1 },
      'volume-flow-kernel-radius': { param: 'volume_flow_kernel_radius', value: 0.03 },
      'volume-flow-kernel-coherence': { param: 'volume_flow_kernel_coherence', value: 1 },
    },
  },
};
const productBudget = {
  requestedFireBudget: {
    identity: 'kaminos.kiln-contention-fire-budget.v0',
    resolution: 90,
    renderScale: 0.4,
    adaptiveRays: 1,
  },
  effectiveFireBudget: {
    identity: 'kaminos.kiln-contention-fire-budget.v0',
    resolution: 90,
    renderScale: 0.4,
    adaptiveRays: 1,
  },
};
const receipt = createWakeFirePresetMountReceipt({
  requestedPresetRef: 'fixture-fire',
  sourceReceipt,
  effectiveControlValues: {
    'volume-density': 0.35,
    'volume-resolution': 90,
    'volume-render-scale': 0.4,
    'volume-adaptive-rays': 1,
    'volume-boundary-splat-mode': 'off',
    'volume-flow-kernel-strength': 1,
    'volume-flow-kernel-radius': 0.03,
    'volume-flow-kernel-coherence': 1,
  },
  productBudget,
  rendererState: {
    prototypeIdentity: 'kaminos-volume-prototype-v0',
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    backend: 'webgpu',
    active: true,
    simGrid: 90,
    renderScale: 0.4,
    adaptiveRaymarch: 1,
    boundarySplatMode: 'off',
    flowKernelIdentity: 'flow-tangent-positive-symmetric-trilinear-v0',
    flowKernelEffective: {
      strength: 1,
      radiusWorld: 0.03,
      coherence: 1,
    },
  },
});
assert.equal(receipt.projection.identity, 'kaminos.wake-raymarch-preset-projection.v1');
assert.equal(receipt.effective.sourceControlCount, 8);
assert.equal(receipt.effective.exactAuthoredControlCount, 4);
assert.equal(receipt.effective.consumerOverrideCount, 4);
assert.deepEqual(
  receipt.projection.consumerOverrides.map(entry => entry.id).sort(),
  ['volume-adaptive-rays', 'volume-boundary-splat-mode', 'volume-render-scale', 'volume-resolution'],
);
