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
assert.doesNotMatch(
  exporter,
  /requires exactly 3 input channels/,
  'browser residual exporter must not reject feature-aware direct-residual artifacts with more than RGB input channels',
);
assert.match(
  exporter,
  /feature-rgba/,
  'browser residual exporter must preserve feature-rgba model input identity for shader/material feature-aware residuals',
);
assert.match(
  exporter,
  /shader-material-authority-residual-feature-v0/,
  'browser residual exporter must preserve shader/material feature authority',
);
assert.match(
  exporter,
  /residualApplyScale/,
  'browser residual exporter must preserve the MLX residual apply scale so browser previews match offline residual metrics',
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
const frozenRenderFunctionMatch = core.match(/async function renderFrozenScaleToCanvas\(options = \{\}\) \{[\s\S]*?\n  \}\n\n  return \{/);
assert.ok(frozenRenderFunctionMatch, 'volume runtime must expose the frozen same-state canvas render witness');
assert.match(
  frozenRenderFunctionMatch[0],
  /browserResidualCanApply\(\)[\s\S]*encodeBrowserResidualSourcePass[\s\S]*encodeBrowserResidualPass[\s\S]*recordBrowserResidualCost\(\{ applied: residualApplied/,
  'frozen same-state canvas render must apply browser residual pass when the residual model is loaded, not only report loaded state',
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
  core,
  /sourceUv\s*=\s*vec2<f32>\(\s*in\.uv\.x\s*,\s*1\.0\s*-\s*in\.uv\.y\s*\)/,
  'browser residual postprocess must flip source texture Y so residual-on preserves the live canvas orientation',
);
assert.match(
  core,
  /browserResidualInputChannels/,
  'browser residual runtime must preserve the model input channel count for RGB-only and feature-aware residuals',
);
assert.match(
  core,
  /residualDataHeaderFloats/,
  'browser residual runtime must pack residual metadata separately from variable-length 3x3xC weights',
);
assert.match(
  core,
  /residualApplyScale/,
  'browser residual runtime must apply exported residual scale instead of implicitly using raw MLX residual logits',
);
assert.match(
  core,
  /limitedResidual\s*\*\s*residualApplyScale[\s\S]*\*\s*mask[\s\S]*\*\s*shaderAuthorityMask[\s\S]*\*\s*strength/,
  'browser residual shader must multiply learned residuals by the exported apply scale before edge/material/strength masks',
);
assert.match(
  core,
  /feature\.a/,
  'browser residual shader must be able to consume the smoke-authority feature channel as model input',
);
assert.match(
  html,
  /id="volume-render-scale"[^>]*step="0\.001"/,
  'volume render scale route/control preserves one-decimal-percentage increments such as 18.3%',
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
