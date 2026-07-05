import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const core = readFileSync(`${root}/volume-core.js`, 'utf8');
const html = readFileSync(`${root}/index.html`, 'utf8');
const exporterPath = `${root}/volume-residual-browser-export.py`;

assert.equal(
  existsSync(exporterPath),
  true,
  'browser residual route must ship an exporter for direct-residual MLX weights',
);

const exporter = readFileSync(exporterPath, 'utf8');

assert.match(
  exporter,
  /kaminos\.volume\.browser-residual-model\.v0/,
  'browser residual exporter must stamp a distinct browser model schema',
);
assert.match(
  exporter,
  /browser-webgpu-direct-residual-v0/,
  'browser residual exporter must stamp the one-pass WebGPU direct-residual authority',
);
assert.match(
  exporter,
  /modelArch.+direct-residual/s,
  'browser residual exporter must only accept direct-residual artifacts for the one-pass route',
);
assert.match(
  exporter,
  /output\.weight/,
  'browser residual exporter must preserve the direct residual convolution weights',
);
assert.match(
  exporter,
  /output\.bias/,
  'browser residual exporter must preserve the direct residual convolution bias',
);

assert.match(
  core,
  /normalizeBrowserResidualMode/,
  'volume runtime must normalize a browser residual mode instead of silently applying a model',
);
assert.match(
  core,
  /volumeResidualModelUrl/,
  'volume runtime must preserve requested residual model URL in public state',
);
assert.match(
  core,
  /volumeResidualAuthority/,
  'volume runtime must preserve effective residual model authority in public state',
);
assert.match(
  core,
  /webgpu-direct-residual/,
  'volume runtime must expose the WebGPU direct-residual reconstruction style when active',
);
assert.match(
  core,
  /encodeBrowserResidualPass/,
  'volume runtime must route the raymarched frame through an explicit residual pass',
);
assert.match(
  core,
  /GPUTextureUsage\.TEXTURE_BINDING/,
  'volume runtime frame texture must be sampleable by the residual postprocess',
);
assert.match(
  core,
  /volumeResidualCost/,
  'browser residual route must expose per-frame residual cost telemetry in public state',
);
assert.match(
  core,
  /cpu-encode-proxy-not-gpu-exclusive/,
  'browser residual cost telemetry must be labeled as a CPU encode proxy, not isolated GPU timing',
);
assert.match(
  core,
  /estimatedKernelSamplesPerFrame/,
  'browser residual cost telemetry must report deterministic per-frame residual sampling work',
);
assert.match(
  html,
  /id="volume-render-scale"[^>]*step="any"/,
  'volume render scale route/control must not snap arbitrary low render scales such as 0.18 to coarse UI increments',
);
