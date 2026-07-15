#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const core = readFileSync(join(root, 'volume-core.js'), 'utf8');
const viewer = readFileSync(join(root, 'volume-held-field-viewer.html'), 'utf8');

function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${name} exists as a deterministic custody helper`);
  return Function(`"use strict"; return (${match[0]});`)();
}

const summarizeHeldFluidChannelStatistics = extractFunction(core, 'summarizeHeldFluidChannelStatistics');
const summarizeHeldRenderPixels = extractFunction(core, 'summarizeHeldRenderPixels');
const summarizeHeldFeatureSmokeAuthority = extractFunction(core, 'summarizeHeldFeatureSmokeAuthority');
const heldRenderTargetEvidenceIsMaterial = extractFunction(core, 'heldRenderTargetEvidenceIsMaterial');
const heldSmokeAuthorityEvidenceIsMaterial = extractFunction(core, 'heldSmokeAuthorityEvidenceIsMaterial');

const fluid = new Float32Array(3 * 16);
fluid[4] = 0;
fluid[16 + 4] = 2;
fluid[32 + 4] = 1;
const fluidStats = summarizeHeldFluidChannelStatistics(new Uint8Array(fluid.buffer));
assert.deepEqual(fluidStats.smokeDensity, {
  channelIndex: 4,
  sampleCount: 3,
  nonZeroCount: 2,
  min: 0,
  max: 2,
  sum: 3,
  mean: 1,
});

const pixels = new Uint8Array([
  4, 5, 6, 255,
  4, 5, 6, 255,
  44, 55, 66, 255,
  84, 105, 126, 255,
]);
const pixelStats = summarizeHeldRenderPixels(pixels, 2, 2);
assert.equal(pixelStats.pixelCount, 4);
assert.equal(pixelStats.nonBackgroundPixelCount, 2);
assert.ok(pixelStats.luminanceStdDev > 0);
assert.ok(pixelStats.luminanceRange > 0);

const featureStats = summarizeHeldFeatureSmokeAuthority(new Uint8Array([
  0, 0, 0, 0,
  0, 0, 0, 12,
  0, 0, 0, 28,
]));
assert.deepEqual(featureStats, {
  sampleCount: 3,
  nonZeroCount: 2,
  max: 28,
  sum: 40,
  mean: 40 / 3,
});
assert.equal(heldRenderTargetEvidenceIsMaterial({
  pixelCount: 10000,
  nonBackgroundPixelCount: 1,
  luminanceStdDev: 8,
  luminanceRange: 80,
}), false, 'one stray target pixel cannot satisfy the render evidence floor');
assert.equal(heldSmokeAuthorityEvidenceIsMaterial({
  sampleCount: 10000,
  nonZeroCount: 1,
  max: 255,
  mean: 255 / 10000,
}), false, 'one stray smoke-authority sample cannot satisfy the shader evidence floor');
assert.equal(heldSmokeAuthorityEvidenceIsMaterial({
  sampleCount: 10000,
  nonZeroCount: 100,
  max: 32,
  mean: 0.32,
}), true, 'distributed shader smoke authority satisfies the material evidence floor');

assert.match(
  core,
  /finishDebugFullFieldImport[\s\S]*summarizeHeldFluidChannelStatistics\(upload\.fluid\.bytes\)[\s\S]*fluidChannelStatistics/,
  'import completion records exact material-channel statistics from checksum-verified bytes',
);
assert.match(
  core,
  /fluidReadBindingIdentity[\s\S]*currentFluid[\s\S]*fluidSha256/,
  'the applied import receipt binds the selected fluid read buffer to the imported digest',
);
assert.match(
  core,
  /renderFrozenScaleToCanvas[\s\S]*includePixelEvidence[\s\S]*copyTextureToBuffer[\s\S]*renderTargetPixelEvidence/,
  'the frozen renderer can read back the exact submitted render target instead of trusting pass encoding',
);
assert.match(
  core,
  /summarizeHeldFeatureSmokeAuthority[\s\S]*featureCaptureSmokeAuthority[\s\S]*featureCapture\?\.summary/,
  'the frozen receipt distinguishes shader-sampled smoke authority from generic scene pixels',
);
assert.match(core, /includeFeatureEvidence/, 'frozen capture supports summary-only shader feature evidence');
assert.match(
  core,
  /readTextureRgba8[\s\S]*includeRgba[\s\S]*summary[\s\S]*rgba:\s*includeRgba\s*\?\s*Array\.from\(rgba\)\s*:\s*null/,
  'summary-only feature capture does not retain a full JS number-array copy',
);
assert.match(
  core,
  /renderBindingIdentity[\s\S]*fluidReadIndex[\s\S]*fluidSha256/,
  'the frozen receipt names the effective imported fluid binding consumed by the raymarch',
);
assert.match(viewer, /includePixelEvidence:\s*true/, 'the held viewer requests native render-target evidence');
assert.match(viewer, /includeFeatureEvidence:\s*true/, 'the held viewer requests summary-only shader-material feature evidence');
assert.doesNotMatch(viewer, /includeFeatureRgba:\s*true/, 'the held viewer does not allocate raw feature RGBA it never consumes');
assert.match(
  viewer,
  /fluidChannelStatistics\?\.smokeDensity[\s\S]*nonZeroCount[\s\S]*held-import-smoke-density-blank/,
  'the held viewer rejects a checksum-valid import whose smoke material channel is empty',
);
assert.match(
  viewer,
  /renderTargetPixelEvidence[\s\S]*materialEvidence[\s\S]*held-render-target-blank/,
  'the held viewer rejects an encoded raymarch pass that produced only the clear color',
);
assert.match(
  viewer,
  /featureCaptureSmokeAuthority[\s\S]*materialEvidence[\s\S]*held-raymarch-smoke-authority-blank/,
  'the held viewer rejects scene pixels when the raymarch sampled no smoke authority',
);

console.log('volume held raymarch custody contracts: ok');
