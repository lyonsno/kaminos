import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = fs.readFileSync(path.join(root, 'volume-core.js'), 'utf8');

assert.match(
  core,
  /export function createKaminosVolumePrototype\(\{[\s\S]*productFrameOwner[\s\S]*externalDevice/,
  'volume prototype must expose an explicit caller-owned product-frame mode and external device',
);
assert.match(
  core,
  /async initializeProductFrame\(\)/,
  'product consumer must initialize GPU resources without starting a private RAF loop',
);
assert.match(
  core,
  /encodeProductFrame\(\{[\s\S]*commandEncoder[\s\S]*colorView[\s\S]*sceneDepthView[\s\S]*depthView/,
  'product frame must require caller encoder, color, sampled scene depth, and shared depth attachment',
);
assert.match(
  core,
  /product-frame-smoke-raymarch-under-splats-v0/,
  'product frame must name the mounted smoke-raymarch plus splat-fire composition',
);
assert.match(
  core,
  /externalProductTransform[\s\S]*productTransform/,
  'product frame must expose scene-owned placement without changing simulator authority',
);
assert.match(
  core,
  /if \(productFrameOwner === 'caller'\) \{[\s\S]*private-frame-submit-forbidden/,
  'caller-owned product mode must reject the private render-and-submit loop',
);
assert.match(
  core,
  /@group\(1\) @binding\(1\) var productSceneDepth: texture_depth_2d/,
  'product smoke shader must bind caller scene depth as a depth texture',
);
assert.match(
  core,
  /fn productSceneDepthEndT\([\s\S]*textureLoad\(productSceneDepth[\s\S]*u\.invViewProj/,
  'product smoke must reconstruct a local-space ray far bound from caller depth',
);
assert.match(
  core,
  /productViewProj\.multiplyMatrices\(viewProj, productModelMatrix\)[\s\S]*productLocalCameraPosition/,
  'product smoke rays must use the same scene-owned placement transform as splats',
);
assert.match(
  core,
  /productRaymarchPipeline[\s\S]*dstFactor: 'one-minus-src-alpha'/,
  'product smoke must optically composite over caller color instead of replacing it',
);
assert.match(
  core,
  /encodeProductSmokeRaymarch\([\s\S]*encodeBoundarySplatPresentation/,
  'caller frame must encode depth-bounded broad smoke before fire-authoritative splats',
);
assert.match(
  core,
  /status: 'effective'[\s\S]*smokeRaymarchEncoded: smokeApplied[\s\S]*smokeDepthFarBoundEffective: smokeApplied/,
  'product receipt must report full two-pass effectiveness only after smoke depth is encoded',
);

console.log('Kaminos product fire adapter source contract verified');
