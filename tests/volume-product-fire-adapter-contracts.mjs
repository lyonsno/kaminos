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

console.log('Kaminos product fire adapter source contract verified');
