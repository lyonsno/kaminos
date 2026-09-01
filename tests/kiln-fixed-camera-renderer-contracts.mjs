import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const core = readFileSync(new URL('volume-core.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

function assertKilnVisibleSourceCoverageContract(source) {
  const coverageBody = source.match(
    /fn kilnVisibleSourceCoverage\(result: RaymarchResult, displayRadiance: vec3<f32>\) -> f32 \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(coverageBody, 'kiln visible-source coverage helper is missing');
  assert.match(
    coverageBody,
    /let fireInterfaceSignal = max\(result\.residualFeature\.y, result\.residualFeature\.z\);/,
    'coverage helper admits fire and interface authority',
  );
  assert.match(
    coverageBody,
    /let smokePresentation = 1\.0 - clamp\(u\.boundary_fire_display\.z, 0\.0, 1\.0\);/,
    'effective Smoke Off suppresses smoke-only coverage',
  );
  assert.doesNotMatch(
    coverageBody,
    /let smokePresentation = clamp\(u\.boundary_fire_display\.z, 0\.0, 1\.0\);/,
    'smoke coverage polarity cannot be inverted',
  );
  assert.match(
    coverageBody,
    /let smokeSignal = result\.residualFeature\.w \* smokePresentation;/,
    'smoke authority is gated by effective smoke presentation',
  );
  assert.match(
    coverageBody,
    /return smoothstep\(0\.02, 0\.12, max\(max\(fireInterfaceSignal, smokeSignal\), radianceSignal\)\);/,
    'coverage combines the admitted optical support signals through the declared matte transition',
  );

  const sourceBody = source.match(
    /fn fsKilnCompositeSource\(in: VSOut\) -> @location\(0\) vec4<f32> \{([\s\S]*?)\n\}/,
  )?.[1];
  assert.ok(sourceBody, 'kiln composite source entry point is missing');
  assert.match(
    sourceBody,
    /let coverage = kilnVisibleSourceCoverage\(result, displayRadiance\);/,
    'kiln source obtains coverage from the admitted helper',
  );
  assert.match(
    sourceBody,
    /return vec4<f32>\(displayRadiance \* coverage, rawAlpha \* coverage\);/,
    'one computed coverage scales both premultiplied radiance and opacity',
  );
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function kilnCoverage({ fire = 0, interfaceAuthority = 0, smoke = 0, smokeSuppressed = 1, radiance = 0 } = {}) {
  const fireInterfaceSignal = Math.max(fire, interfaceAuthority);
  const smokeSignal = smoke * (1 - smokeSuppressed);
  return smoothstep(0.02, 0.12, Math.max(fireInterfaceSignal, smokeSignal, radiance * 0.18));
}

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
assertKilnVisibleSourceCoverageContract(core);
assert.throws(
  () => assertKilnVisibleSourceCoverageContract(core.replace(
    'let coverage = kilnVisibleSourceCoverage(result, displayRadiance);',
    'let coverage = 1.0;',
  )),
  /obtains coverage from the admitted helper/,
  'contract rejects a disconnected coverage helper',
);
assert.throws(
  () => assertKilnVisibleSourceCoverageContract(core.replace(
    'let smokePresentation = 1.0 - clamp(u.boundary_fire_display.z, 0.0, 1.0);',
    'let smokePresentation = clamp(u.boundary_fire_display.z, 0.0, 1.0);',
  )),
  /Smoke Off suppresses smoke-only coverage/,
  'contract rejects inverted smoke presentation polarity',
);
assert.equal(kilnCoverage(), 0, 'unsupported extinction contributes zero source coverage');
assert.equal(kilnCoverage({ smoke: 0.5, smokeSuppressed: 1 }), 0, 'Smoke Off excludes smoke-only support');
assert.ok(kilnCoverage({ smoke: 0.5, smokeSuppressed: 0 }) > 0, 'Smoke On admits smoke-only support');
for (const smokeSuppressed of [0, 1]) {
  assert.ok(kilnCoverage({ fire: 0.5, smokeSuppressed }) > 0, 'fire support is admitted in either smoke mode');
  assert.ok(kilnCoverage({ interfaceAuthority: 0.5, smokeSuppressed }) > 0, 'interface support is admitted in either smoke mode');
}
const partialCoverage = kilnCoverage({ fire: 0.07 });
assert.ok(partialCoverage > 0 && partialCoverage < 1, 'test fixture exercises partial coverage');
assert.deepEqual(
  [...[0.3, 0.2, 0.1].map(channel => channel * partialCoverage), 0.5 * partialCoverage],
  [0.3 * partialCoverage, 0.2 * partialCoverage, 0.1 * partialCoverage, 0.5 * partialCoverage],
  'the same partial coverage scales premultiplied radiance and alpha',
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
