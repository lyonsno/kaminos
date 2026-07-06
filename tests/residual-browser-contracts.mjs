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
  core,
  /shader-material-authority-residual-feature-v0/,
  'browser residual source pass must label its inference-time feature plane as shader/material authority, not a screen-space proxy',
);
assert.match(
  core,
  /fsResidualSource/,
  'browser residual source pass must use a distinct raymarch fragment entry that can emit color plus feature side-channel targets',
);
assert.match(
  core,
  /browserResidualFeatureTexture/,
  'browser residual route must allocate a sampleable feature texture alongside the source frame texture',
);
assert.match(
  core,
  /@location\(1\)\s+residualFeature/,
  'raymarch source pass must emit residual features through a second render target without a second volume traversal',
);
assert.match(
  core,
  /featureSamplesPerFrame/,
  'browser residual cost telemetry must account for the extra feature-texture sample work',
);
assert.match(
  core,
  /volumeResidualFeatureDebug/,
  'browser residual route must expose whether the shader-authority feature plane is being debug-rendered',
);
assert.match(
  core,
  /residual-feature-debug-false-color-v0/,
  'browser residual shader must label the false-color feature debug output mode',
);
assert.match(
  core,
  /debugFeatureView/,
  'browser residual shader must branch to a direct feature-plane visualization instead of inferring through final RGB',
);
assert.match(
  html,
  /id="volume-render-scale"[^>]*step="any"/,
  'volume render scale route/control must not snap arbitrary low render scales such as 0.18 to coarse UI increments',
);
assert.match(
  html,
  /id="volume-residual-mode"/,
  'volume UI must expose residual mode so the operator can live-toggle same-state residual application',
);
assert.match(
  html,
  /id="volume-residual-strength"/,
  'volume UI must expose residual strength for same-state residual comparison',
);
assert.match(
  html,
  /id="volume-residual-model-url"/,
  'volume UI must expose the residual model URL to preserve model identity during live comparison',
);
assert.match(
  html,
  /id="volume-residual-feature-debug"/,
  'volume UI must expose the residual feature-plane debug toggle',
);
assert.match(
  html,
  /'volume-residual-mode'[\s\S]*'volume-residual-model-url'[\s\S]*'volume-residual-strength'[\s\S]*'volume-residual-feature-debug'/,
  'volume residual controls and feature debug toggle must participate in the live syncControls input/change loop',
);
assert.match(
  html,
  /params\.get\('volume_residual_mode'\)[\s\S]*setVolumeControlValue\('volume-residual-mode'/,
  'volume residual mode route param must populate the live residual mode control before runtime reads controls',
);
assert.match(
  html,
  /params\.has\('volume_residual_model_url'\)[\s\S]*setVolumeControlValue\('volume-residual-model-url'/,
  'volume residual model URL route param must populate the live residual model control',
);
assert.match(
  html,
  /params\.has\('volume_residual_strength'\)[\s\S]*setVolumeControlValue\('volume-residual-strength'/,
  'volume residual strength route param must populate the live residual strength control',
);
assert.match(
  html,
  /params\.has\('volume_residual_feature_debug'\)[\s\S]*setVolumeControlValue\('volume-residual-feature-debug'/,
  'volume residual feature debug route param must populate the live feature debug toggle',
);
