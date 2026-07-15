#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCHEMA = 'kaminos.volume.native-low-selective-witness.v0';
const IDENTITY = 'native-low-control-vs-frozen-selective-splat-witness-v0';
const INPUT_AUTHORITY = 'native-low-simulator-state-no-synthetic-downsample-v0';
const CONTROL_AUTHORITY = 'native-low-simulator-held-control-v0';
const TREATMENT_AUTHORITY = 'frozen-exact-basin-heads-applied-to-native-low-state-v0';
const FIELD_LAYOUT_IDENTITY = 'x-fastest-zyx-c-interleaved-v0';
const FLUID_CHANNELS = [
  'velocityX', 'velocityY', 'velocityZ', 'densityCarrier', 'smokeDensity', 'heat', 'fuel', 'detail',
  'flame', 'ember', 'visibleFireCarrier', 'combustionFront', 'microdetail', 'interfaceShred', 'fireLick', 'emberFleck',
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) args.set(key, true);
  else {
    args.set(key, next);
    index += 1;
  }
}

const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-native-low-selective-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'manifest.json')));
const nativeManifestPath = resolve(String(args.get('--native-manifest') || ''));
const predictedManifestPath = resolve(String(args.get('--predicted-manifest') || ''));
const sourceCapturePath = resolve(String(args.get('--source-capture') || ''));
const targetOrigin = String(args.get('--target-origin') || 'http://127.0.0.1:18531');
const viewportSize = String(args.get('--viewport-size') || '1200,1000');
const renderCanvasSize = String(args.get('--render-canvas-size') || '1000,1000');
const chunkFloats = String(args.get('--chunk-floats') || '262144');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeReport(payload) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readManifest(path, label) {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, sha256: createHash('sha256').update(raw).digest('hex'), manifest: JSON.parse(raw), label };
}

function run(command, argv, label) {
  const receipt = { command, argv, label, status: 'running' };
  const result = spawnSync(command, argv, { cwd: dirname(new URL(import.meta.url).pathname), encoding: 'utf8' });
  receipt.status = result.status === 0 ? 'passed' : 'failed';
  receipt.exitCode = result.status;
  receipt.signal = result.signal;
  receipt.stdout = result.stdout;
  receipt.stderr = result.stderr;
  if (result.status !== 0) {
    const error = new Error(`${label} failed with exit ${result.status}: ${result.stderr || result.stdout}`);
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}

function validateRender(render, label, expectedGrid, sameNativeStateIdentity) {
  if (render.status !== 'captured' || render.failurePhase !== null) throw new Error(`${label} render failed`);
  if (render.initialFieldImport?.effective?.grid !== expectedGrid) throw new Error(`${label} imported grid mismatch`);
  if (render.importedRender?.boundarySplatCompositionRequested !== 'splat-only-v0'
    || render.importedRender?.boundarySplatCompositionEffective !== 'splat-only-v0'
    || render.importedRender?.raymarchApplied !== false
    || render.importedRender?.splatApplied !== true) {
    throw new Error(`${label} did not apply the requested splat-only renderer`);
  }
  if (render.importedRender?.backend !== 'WebGPU:apple') throw new Error(`${label} used an unsupported backend`);
  return {
    requestedComposition: render.importedRender.boundarySplatCompositionRequested,
    effectiveComposition: render.importedRender.boundarySplatCompositionEffective,
    raymarchApplied: render.importedRender.raymarchApplied,
    splatApplied: render.importedRender.splatApplied,
    backend: render.importedRender.backend,
    grid: expectedGrid,
    sameNativeStateIdentity,
    image: {
      path: render.importedRender.path,
      byteLength: statSync(render.importedRender.path).size,
      sha256: sha256File(render.importedRender.path),
      imageAuthority: render.importedRender.imageAuthority,
    },
  };
}

function htmlPage(control, treatment, sameNativeStateIdentity) {
  const imageName = path => `./${path.split('/').pop()}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Native-low zero-shot selective transfer</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#080a0b;color:#eef3f4}*{box-sizing:border-box}body{margin:0;background:#080a0b}header{padding:14px 18px;border-bottom:1px solid #2c3639;background:#101416}h1{font-size:18px;margin:0 0 5px}p{margin:0;color:#aebbc0;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px;background:#2c3639}.panel{min-width:0;background:#050607}.label{padding:10px 12px;background:#111719;border-bottom:1px solid #263034}.label strong{display:block;font-size:15px}.label span{display:block;color:#9eacb1;font-size:11px;margin-top:3px}img{display:block;width:100%;height:auto;background:#000;image-rendering:auto}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Native 128 control vs frozen-head reconstruction</h1><p>Same native simulator state ${sameNativeStateIdentity.slice(0, 16)}... | splat-only on both | no high truth or synthetic downsample at application time</p></header>
<main class="grid"><section class="panel"><div class="label"><strong>Native-low control</strong><span>Untouched native 128³ simulator state, held render</span></div><img src="${imageName(control.image.path)}" alt="Native low control"></section>
<section class="panel"><div class="label"><strong>Native-low selective predicted</strong><span>Frozen 160→128 heads applied zero-shot to the same native state, rendered at 160³</span></div><img src="${imageName(treatment.image.path)}" alt="Native low selective predicted"></section></main></body></html>`;
}

let phase = 'input-validation';
const commands = [];
try {
  mkdirSync(outDir, { recursive: true });
  const native = readManifest(nativeManifestPath, 'nativeLowControl');
  const predicted = readManifest(predictedManifestPath, 'nativeLowSelectivePredicted');
  readManifest(sourceCapturePath, 'sourceCapture');
  if (native.manifest.schema !== 'kaminos.volume.full-grid-field-export.v0'
    || native.manifest.status !== 'captured'
    || native.manifest.failurePhase !== null
    || native.manifest.grid !== 128
    || native.manifest.completeFieldCoverage !== true) {
    throw new Error('native control is not a complete captured 128-grid simulator field');
  }
  if (predicted.manifest.schema !== 'kaminos.volume.native-low-selective-composition.v0'
    || predicted.manifest.status !== 'captured'
    || predicted.manifest.failurePhase !== null
    || predicted.manifest.inputAuthority !== INPUT_AUTHORITY
    || predicted.manifest.compositionAuthority !== TREATMENT_AUTHORITY
    || predicted.manifest.runtimeTruthAvailable !== false) {
    throw new Error('predicted treatment authority mismatch');
  }
  const sameNativeStateIdentity = predicted.manifest.sameNativeStateIdentity;
  if (!sameNativeStateIdentity || predicted.manifest.source?.nativeManifestSha256 !== native.sha256) {
    throw new Error('control and treatment do not share the same native source state');
  }
  const fluid = native.manifest.sidecars?.fluid;
  const front = native.manifest.sidecars?.front;
  const controlManifestPath = join(outDir, 'native-low-control.manifest.json');
  writeFileSync(controlManifestPath, `${JSON.stringify({
    schema: 'kaminos.volume.native-low-held-field.v0',
    identity: 'untouched-native-low-held-control-v0',
    status: 'captured',
    failurePhase: null,
    initializationAuthority: CONTROL_AUTHORITY,
    inputAuthority: INPUT_AUTHORITY,
    runtimeTruthAvailable: false,
    renderOnly: true,
    sameNativeStateIdentity,
    layoutIdentity: FIELD_LAYOUT_IDENTITY,
    source: {
      nativeManifestPath,
      nativeManifestSha256: native.sha256,
      effectiveRoute: native.manifest.effectiveRoute,
      backend: native.manifest.backend,
    },
    receiver: {
      grid: 128,
      initialSimStepCount: 0,
      fluid: { ...fluid, path: resolve(String(fluid.path)) },
      front: { ...front, path: resolve(String(front.path)) },
    },
    consumptionContract: {
      receiverAdvance: 'held render only; simulation advance is forbidden for this assay',
    },
  }, null, 2)}\n`);

  phase = 'control-render';
  const exporter = join(dirname(new URL(import.meta.url).pathname), 'volume-full-grid-field-export.mjs');
  const controlDir = join(outDir, 'native-low-control-render');
  const treatmentDir = join(outDir, 'native-low-selective-render');
  const common = initialManifest => [
    exporter,
    '--source-capture', sourceCapturePath,
    '--target-origin', targetOrigin,
    '--initial-field-manifest', initialManifest,
    '--advance-imported-steps', '0',
    '--render-only',
    '--render-composition', 'splat-only-v0',
    '--viewport-size', viewportSize,
    '--viewport-device-scale-factor', '2',
    '--render-canvas-size', renderCanvasSize,
    '--chunk-floats', chunkFloats,
    '--settle-ms', '1800',
  ];
  commands.push(run('node', [
    ...common(controlManifestPath),
    '--out-dir', controlDir,
    '--manifest', join(controlDir, 'manifest.json'),
    '--render-png', join(outDir, 'native-low-control.png'),
  ], 'native-low-control-render'));

  phase = 'treatment-render';
  commands.push(run('node', [
    ...common(predictedManifestPath),
    '--out-dir', treatmentDir,
    '--manifest', join(treatmentDir, 'manifest.json'),
    '--render-png', join(outDir, 'native-low-selective-predicted.png'),
  ], 'native-low-selective-render'));

  phase = 'render-validation';
  const controlRender = readManifest(join(controlDir, 'manifest.json'), 'nativeLowControlRender');
  const treatmentRender = readManifest(join(treatmentDir, 'manifest.json'), 'nativeLowSelectivePredictedRender');
  const control = validateRender(controlRender.manifest, 'nativeLowControl', 128, sameNativeStateIdentity);
  const treatment = validateRender(treatmentRender.manifest, 'nativeLowSelectivePredicted', 160, sameNativeStateIdentity);
  const htmlPath = join(outDir, 'index.html');
  writeFileSync(htmlPath, htmlPage(control, treatment, sameNativeStateIdentity));
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'captured',
    failurePhase: null,
    inputAuthority: INPUT_AUTHORITY,
    runtimeTruthAvailable: false,
    sameNativeStateIdentity,
    renderer: {
      requested: 'splat-only-v0',
      controlEffective: control.effectiveComposition,
      treatmentEffective: treatment.effectiveComposition,
      raymarchExcludedFromDiscriminant: true,
    },
    roles: { nativeLowControl: control, nativeLowSelectivePredicted: treatment },
    sources: {
      nativeManifest: { path: nativeManifestPath, sha256: native.sha256 },
      predictedManifest: { path: predictedManifestPath, sha256: predicted.sha256 },
      sourceCapture: { path: sourceCapturePath, sha256: sha256File(sourceCapturePath) },
    },
    commands,
    operatorArtifact: { path: htmlPath, authority: 'matched-same-native-state-splat-only-comparison-v0' },
  });
  console.log(JSON.stringify({ status: 'captured', report: reportPath, operatorArtifact: htmlPath }, null, 2));
} catch (error) {
  if (error.receipt) commands.push(error.receipt);
  writeReport({
    schema: SCHEMA,
    identity: IDENTITY,
    status: 'failed',
    failurePhase: phase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence: { nativeManifestPath, predictedManifestPath, sourceCapturePath, targetOrigin },
    commands,
  });
  console.error(error?.stack || String(error));
  process.exitCode = 1;
}
