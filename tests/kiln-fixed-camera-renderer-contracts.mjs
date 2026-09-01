import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const core = readFileSync(new URL('volume-core.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

assert.match(
  core,
  /onKilnFixedCameraCompositionReceipt/,
  'renderer exposes exact kiln receipt transitions to the cockpit instead of retaining private effective state',
);
assert.match(
  index,
  /onKilnFixedCameraCompositionReceipt:\s*receipt\s*=>/,
  'cockpit consumes renderer-owned effective and failed kiln receipts',
);
assert.match(
  core,
  /kiln-composition-initialization-failed/,
  'asset or GPU initialization failure publishes a durable failed receipt phase',
);
for (const failurePhase of ['asset-fetch', 'asset-sha256', 'asset-decode', 'asset-dimensions']) {
  assert.match(
    core,
    new RegExp(`kilnFailurePhase = '${failurePhase}'`),
    `asset initialization preserves a distinct ${failurePhase} failure phase`,
  );
}
assert.match(
  core,
  /kiln-composition-activation-failed/,
  'failure after verified assets but before the first frame replaces the public effective receipt',
);
assert.match(
  core,
  /kiln-composition-render-failed/,
  'failure after asset initialization cannot leave the public receipt effective',
);
assert.doesNotMatch(
  core,
  /return vec4<f32>\(displayRadiance \* alpha, alpha\)/,
  'already accumulated front-to-back radiance is not multiplied by alpha a second time',
);
assert.match(
  core,
  /fn kilnVisibleSourceCoverage\(result: RaymarchResult, displayRadiance: vec3<f32>\) -> f32[\s\S]*result\.residualFeature\.y[\s\S]*result\.residualFeature\.z[\s\S]*u\.boundary_fire_display\.z[\s\S]*smoothstep/,
  'kiln source derives a visible optical matte from fire/interface authority and the effective smoke presentation mode',
);
assert.match(
  core,
  /return vec4<f32>\(displayRadiance \* coverage, rawAlpha \* coverage\)/,
  'kiln source applies one coverage matte to premultiplied radiance and opacity',
);
assert.doesNotMatch(
  core,
  /fn fsKilnCompositeSource[\s\S]*?return vec4<f32>\(displayRadiance, alpha\)/,
  'kiln source cannot retain invisible extinction outside its visible optical support',
);
assert.match(
  core,
  /usage: GPUTextureUsage\.TEXTURE_BINDING \| GPUTextureUsage\.COPY_DST \| GPUTextureUsage\.RENDER_ATTACHMENT/,
  'external-image upload textures include Dawn-required render-attachment usage',
);
assert.match(
  core,
  /createImmutableKilnFixedCameraComposition\(kilnFixedCameraComposition\)/,
  'prototype construction takes private immutable composition custody before asynchronous GPU work',
);
assert.match(
  core,
  /detachedKilnFixedCameraCompositionReceipt\(state\.kilnFixedCameraComposition\)/,
  'renderer callbacks detach nested receipt state from private composition custody',
);
assert.match(
  core,
  /validateKilnFixedCameraCanonicalAssets\(kilnFixedCameraComposition\)/,
  'the asynchronous fetch boundary reasserts exact canonical asset tuples',
);
assert.match(
  core,
  /uniformUpload:\s*\{[\s\S]*identity:\s*'kiln-fixed-camera-uniform-upload-v0'[\s\S]*values:\s*Array\.from\(uniformData\)[\s\S]*byteLength:\s*uniformData\.byteLength/,
  'effective receipt records the exact uploaded kiln uniform array',
);
assert.match(
  index,
  /window\.__kaminosVolumeStatusReceipt\s*=\s*\{[\s\S]*kilnFixedCameraComposition:\s*detachedKilnFixedCameraCompositionReceipt/,
  'status callback publishes a detached kiln projection for behavioral alias probing',
);

console.log('kiln fixed-camera renderer contracts passed');
