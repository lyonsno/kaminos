import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const witnessPath = `${root}/volume-witness.mjs`;
const corpusPath = `${root}/volume-render-pair-corpus.mjs`;
const datasetPath = `${root}/volume-render-pair-dataset.mjs`;
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;
const volumeCorePath = `${root}/volume-core.js`;

const witness = fs.readFileSync(witnessPath, 'utf8');
const corpus = fs.readFileSync(corpusPath, 'utf8');
const dataset = fs.readFileSync(datasetPath, 'utf8');
const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');
const volumeCore = fs.readFileSync(volumeCorePath, 'utf8');

assert.match(
  witness,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_CAPTURE_AUTHORITY\s*=\s*'boundary-sidecar-support-canvas-capture-v0'/,
  'witness must name boundary-sidecar support auxiliary capture authority separately from Flow Debug',
);

assert.match(
  witness,
  /renderScaleBoundarySidecarSupportCaptures/,
  'witness must parse boundary-sidecar-support auxiliary captures from render-scale auxiliary modes',
);

assert.match(
  witness,
  /function captureBoundarySidecarSupportAuxiliary\(/,
  'witness must capture frozen-state boundary sidecar support as an auxiliary image',
);

assert.match(
  volumeCore,
  /renderFrozenScaleToCanvas[\s\S]*boundarySidecarIdentity:\s*state\.boundarySidecarIdentity[\s\S]*boundarySidecarAuthority:\s*state\.boundarySidecarAuthority[\s\S]*boundarySidecarSource:\s*state\.boundarySidecarSource/,
  'frozen render receipts must preserve the effective baked sidecar identity used by auxiliary captures',
);

assert.match(
  witness,
  /boundarySidecarSupport[\s\S]*captureBoundarySidecarSupportAuxiliary/,
  'witness must store boundarySidecarSupport under auxiliaryCaptures for low render-scale samples',
);

assert.match(
  witness,
  /const renderScaleSetEval = await wsRequest\(ws, 'Runtime\.evaluate'[\s\S]*sampleRenderScaleSet\(\$\{JSON\.stringify\(\{[\s\S]*compactSamples:\s*true[\s\S]*const scaleSet = renderScaleSetEval\.result\.value/,
  'witness render-scale-set capture must request compact samples so CDP does not return heavy preview/readback payloads',
);

assert.match(
  corpus,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_AUTHORITY\s*=\s*'boundary-sidecar-support-canvas-capture-v0'/,
  'render pair corpus must preserve boundary-sidecar support auxiliary authority in the manifest',
);

assert.match(
  corpus,
  /key:\s*'boundarySidecarSupport'[\s\S]*channelLayout:\s*'boundary-sidecar-support-rgba'/,
  'render pair corpus must advertise boundarySidecarSupport channel layout separately from flowDebug',
);

assert.match(
  corpus,
  /BASE_ROUTE_IDENTITY_DEFAULTS[\s\S]*volume_fire_scale:\s*'0\.35'[\s\S]*volume_detail_scale:\s*'1(?:\.0+)?'[\s\S]*volume_plume_height:\s*'1\.30'[\s\S]*volume_reaction_fuel:\s*'1'/,
  'render pair corpus must explicitly pin witness identity scalars when a caller base URL omits them',
);

assert.match(
  corpus,
  /for \(const \[key, value\] of Object\.entries\(BASE_ROUTE_IDENTITY_DEFAULTS\)[\s\S]*!url\.searchParams\.has\(key\)[\s\S]*url\.searchParams\.set\(key, String\(value\)\)/,
  'render pair corpus must apply base route identity defaults before variant overrides',
);

assert.match(
  corpus,
  /const maxVariants = positiveInteger\(args\.get\('--max-variants'\), 0\)[\s\S]*loadVariants\(args, settleMs\)[\s\S]*\.slice\(0, maxVariants\)/,
  'render pair corpus must honor --max-variants before launching browser captures',
);

assert.match(
  dataset,
  /spawn\(chrome,[\s\S]*detached:\s*session\.keepOpen[\s\S]*if \(session\.keepOpen\) proc\.unref\(\)/,
  'render pair dataset must detach and unref keep-open shared Chrome so capture subprocesses can exit',
);

assert.match(
  trainer,
  /BOUNDARY_SIDECAR_SUPPORT_AUXILIARY_INPUT_AUTHORITY\s*=\s*"boundary-sidecar-support-canvas-capture-v0"/,
  'trainer must know the boundary-sidecar support auxiliary authority',
);

assert.match(
  trainer,
  /--sidecar-sampling-mode[\s\S]*choices=\["off", "support"\]/,
  'trainer must expose sidecar support crop sampling as an explicit mode',
);

assert.match(
  trainer,
  /sidecarSupportPixels/,
  'trainer reports must expose sidecar support pixel counts so empty masks fail visibly',
);

assert.match(
  trainer,
  /sidecar_sampling_pixels\(/,
  'trainer must derive crop pixels from sidecar support auxiliary captures',
);

assert.match(
  runner,
  /--sidecar-sampling-mode/,
  'Greenroom runner must forward sidecar sampling mode',
);

assert.match(
  runner,
  /--sidecar-sampling-probability/,
  'Greenroom runner must forward sidecar sampling probability',
);
