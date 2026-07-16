#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzePngPixels, comparePngPixels } from './volume-png-pixel-evidence.mjs';

const SCHEMA = 'kaminos.volume.vivisector-held-package-splat-witness.v0';
const ROLES = ['truthHigh', 'lowPhaseAligned', 'vivisectorPredicted'];
const ROLE_AUTHORITY = {
  truthHigh: 'offline-high-truth-held-render-only-v0',
  lowPhaseAligned: 'downsampled-same-high-history-held-control-v0',
  vivisectorPredicted: 'precomputed-held-package-inference-not-live-runtime-v0',
};
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_BACKEND = 'WebGPU:apple';
const SERVED_ASSETS = ['index.html', 'volume-core.js'];
const BEAUTY_COMPOSITION = 'splat-only-v0';
const PARTIAL_COMPOSITION = 'raymarch-under-splats-v0';

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-vivisector-held-package-splat-witness'));
const manifestPath = resolve(String(args.get('--manifest') || join(outDir, 'manifest.json')));
let compositionManifestPath = null;
let sourceCapturePath = null;
let targetOrigin = null;
const partialFlowDebugMix = Number(args.get('--partial-flow-debug-mix') || 0.625);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const userDataDir = resolve(String(args.get('--user-data-dir') || join(outDir, '.chrome-profile')));
const cameraPosition = String(args.get('--camera-position') || '0,0.6,6');
const cameraTarget = String(args.get('--camera-target') || '0,0,0');
const renderCanvasSize = String(args.get('--render-canvas-size') || '960,720');
const viewportSize = String(args.get('--viewport-size') || '1200,800');
const renderWarmupCount = Number(args.get('--render-warmup-count') || 2);
const exporterPath = join(import.meta.dirname, 'volume-full-grid-field-export.mjs');
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};

try {
  mkdirSync(outDir, { recursive: true });
  compositionManifestPath = requiredPath('--composition-manifest');
  sourceCapturePath = requiredPath('--source-capture');
  targetOrigin = required('--target-origin');
  if (!Number.isFinite(partialFlowDebugMix) || partialFlowDebugMix !== 0.625) {
    throw new Error(`partial flow-debug mix must equal the directive default 0.625: ${partialFlowDebugMix}`);
  }
  const target = new URL(targetOrigin);
  if (target.pathname !== '/' || target.search || target.hash) throw new Error('--target-origin must contain only an origin');
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) throw new Error(`invalid debug port: ${debugPort}`);

  failurePhase = 'served-checkout-validation';
  const servedAssets = {};
  for (const asset of SERVED_ASSETS) {
    const expectedSha256 = sha256File(join(import.meta.dirname, asset));
    const response = await fetch(new URL(`/${asset}`, target));
    if (!response.ok) throw new Error(`served ${asset} request failed: ${response.status}`);
    const servedSha256 = sha256Text(await response.text());
    lastTrustworthyEvidence = { phase: failurePhase, targetOrigin, asset, expectedSha256, servedSha256 };
    if (servedSha256 !== expectedSha256) {
      throw new Error(`served ${asset} differs from owning worktree: ${servedSha256}/${expectedSha256}`);
    }
    servedAssets[asset] = { expectedSha256, servedSha256 };
  }
  const expectedCoreSha256 = servedAssets['volume-core.js'].expectedSha256;
  const servedCoreSha256 = servedAssets['volume-core.js'].servedSha256;
  lastTrustworthyEvidence = { phase: failurePhase, targetOrigin, servedAssets };

  failurePhase = 'composition-manifest-validation';
  const compositionRaw = readFileSync(compositionManifestPath, 'utf8');
  const composition = JSON.parse(compositionRaw);
  if (composition.schema !== 'kaminos.volume.vivisector-held-package-composition.v0'
    || composition.status !== 'captured'
    || composition.failurePhase !== null
    || composition.inferenceAuthority !== 'precomputed-held-package-inference-not-live-runtime-v0'
    || composition.expectedRoute !== EXPECTED_ROUTE
    || composition.expectedBackend !== EXPECTED_BACKEND) {
    throw new Error('composition manifest is not a clean held-package inference artifact');
  }
  const sourceCaptureRaw = readFileSync(sourceCapturePath, 'utf8');
  const sourceCapture = JSON.parse(sourceCaptureRaw);
  if (sourceCapture.schema !== 'kaminos.operator-exact-live-splat-basin-capture.v1') {
    throw new Error(`unsupported source capture: ${sourceCapture.schema || '(missing)'}`);
  }
  const roleManifestAuthority = {};
  const roleManifests = Object.fromEntries(ROLES.map(role => {
    const descriptor = composition.roles?.[role];
    const path = resolve(String(descriptor?.manifestPath || ''));
    if (!existsSync(path) || sha256File(path) !== descriptor?.manifestSha256) {
      throw new Error(`${role} manifest is missing or differs from composition custody`);
    }
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const manifestAuthority = role === 'vivisectorPredicted'
      ? manifest.inferenceAuthority
      : manifest.initializationAuthority;
    if (manifestAuthority !== ROLE_AUTHORITY[role]
      || manifest.expectedRoute !== EXPECTED_ROUTE
      || manifest.expectedBackend !== EXPECTED_BACKEND) {
      throw new Error(`${role} manifest authority/route/backend mismatch`);
    }
    roleManifestAuthority[role] = manifestAuthority;
    return [role, path];
  }));
  lastTrustworthyEvidence = {
    phase: failurePhase,
    compositionManifestPath,
    compositionManifestSha256: sha256Text(compositionRaw),
    sourceCapturePath,
    sourceCaptureSha256: sha256Text(sourceCaptureRaw),
    targetOrigin,
    servedCoreSha256,
    expectedCoreSha256,
    servedAssets,
    roleManifests,
    roleManifestAuthority,
  };

  failurePhase = 'role-render';
  const captures = {};
  let routeIdentity = null;
  let backend = null;
  for (const role of ROLES) {
    const roleRoot = join(outDir, role);
    const beautyPath = join(roleRoot, 'beauty-splat-only.png');
    const flowDebugPath = join(roleRoot, 'partial-flow-debug-0.625.png');
    const renderManifestPath = join(roleRoot, 'render-manifest.json');
    const renderArgs = [
      exporterPath,
      '--source-capture', sourceCapturePath,
      '--target-origin', targetOrigin,
      '--debug-port', String(debugPort),
      '--user-data-dir', userDataDir,
      '--reuse-browser',
      '--keep-browser-open',
      '--window-size', '1200,800',
      '--viewport-size', viewportSize,
      '--viewport-device-scale-factor', '1',
      '--out-dir', roleRoot,
      '--manifest', renderManifestPath,
      '--initial-field-manifest', roleManifests[role],
      '--advance-imported-steps', '0',
      '--render-only',
      '--render-canvas-size', renderCanvasSize,
      '--render-warmup-count', String(renderWarmupCount),
      '--render-composition', BEAUTY_COMPOSITION,
      '--secondary-render-composition', PARTIAL_COMPOSITION,
      '--camera-position', cameraPosition,
      '--camera-target', cameraTarget,
      '--render-png', beautyPath,
      '--render-control-overrides-json', JSON.stringify({ flowDebug: 0 }),
      '--secondary-render-png', flowDebugPath,
      '--secondary-render-control-overrides-json', JSON.stringify({ flowDebug: partialFlowDebugMix }),
    ];
    const result = spawnSync(process.execPath, renderArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`${role} render failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    const renderRaw = readFileSync(renderManifestPath, 'utf8');
    const render = JSON.parse(renderRaw);
    const beauty = render.importedRender;
    const flowDebug = render.importedSecondaryRender;
    if (render.status !== 'captured' || render.failurePhase !== null || !beauty || !flowDebug) {
      throw new Error(`${role} omitted a clean beauty/flow-debug pair`);
    }
    if (render.effectiveRoute !== EXPECTED_ROUTE || render.backend !== EXPECTED_BACKEND) {
      throw new Error(`${role} rendered on unexpected route/backend: ${render.effectiveRoute}/${render.backend}`);
    }
    const effectiveImportAuthority = render.initialFieldImport?.effective?.initializationAuthority;
    const expectedImportAuthority = role === 'vivisectorPredicted'
      ? 'learned-vivisector-held-package-composition-not-truth-v0'
      : ROLE_AUTHORITY[role];
    if (effectiveImportAuthority !== expectedImportAuthority) {
      throw new Error(`${role} effective import authority drifted: ${effectiveImportAuthority}/${expectedImportAuthority}`);
    }
    if (beauty.boundarySplatCompositionEffective !== BEAUTY_COMPOSITION
      || flowDebug.boundarySplatCompositionEffective !== PARTIAL_COMPOSITION
      || flowDebug.controlOverrides?.flowDebug !== partialFlowDebugMix) {
      throw new Error(`${role} requested/effective render controls drifted`);
    }
    if (beauty.simStepCount !== flowDebug.simStepCount || beauty.baseSimStepCount !== flowDebug.baseSimStepCount) {
      throw new Error(`${role} beauty and flow-debug images are not the same frozen field state`);
    }
    for (const receipt of [beauty, flowDebug]) {
      if (Number(receipt.boundarySplatCandidateCount) < 1
        || Number(receipt.boundarySplatInstanceCount) < 1
        || Number(receipt.boundarySplatOverflowCount) !== 0) {
        throw new Error(`${role} has incomplete or overflowing splat population`);
      }
    }
    if (routeIdentity && routeIdentity !== render.effectiveRoute) throw new Error(`${role} effective route drifted`);
    if (backend && backend !== render.backend) throw new Error(`${role} backend drifted`);
    const beautyPixelEvidence = analyzePngPixels(beautyPath);
    const flowDebugPixelEvidence = analyzePngPixels(flowDebugPath);
    for (const [kind, pixelEvidence] of [['beauty', beautyPixelEvidence], ['flowDebug', flowDebugPixelEvidence]]) {
      if (pixelEvidence.foregroundPixelCount < 100
        || pixelEvidence.foregroundFraction >= 0.8
        || pixelEvidence.maxRgb < 16) {
        throw new Error(`${role} ${kind} lacks bounded visible foreground pixels: ${JSON.stringify(pixelEvidence)}`);
      }
    }
    routeIdentity = render.effectiveRoute;
    backend = render.backend;
    captures[role] = {
      role,
      roleAuthority: ROLE_AUTHORITY[role],
      manifestAuthority: roleManifestAuthority[role],
      beauty: imageDescriptor(beauty),
      flowDebug: {
        ...imageDescriptor(flowDebug),
        requestedMix: partialFlowDebugMix,
        effectiveMix: flowDebug.controlOverrides.flowDebug,
      },
      boundarySplatCandidateCount: beauty.boundarySplatCandidateCount,
      boundarySplatInstanceCount: beauty.boundarySplatInstanceCount,
      boundarySplatOverflowCount: beauty.boundarySplatOverflowCount,
      boundarySidecarOverrideReceipt: render.initialFieldImport?.uploads?.boundarySidecar?.effective || null,
      pixelEvidence: { beauty: beautyPixelEvidence, flowDebug: flowDebugPixelEvidence },
      renderManifestPath,
      renderManifestSha256: sha256Text(renderRaw),
      effectiveRoute: render.effectiveRoute,
      backend: render.backend,
    };
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, phase: `rendered-${role}`, captures };
  }

  const roleDifferenceEvidence = {
    lowVsPredictedBeauty: comparePngPixels(captures.lowPhaseAligned.beauty.path, captures.vivisectorPredicted.beauty.path),
    truthVsPredictedBeauty: comparePngPixels(captures.truthHigh.beauty.path, captures.vivisectorPredicted.beauty.path),
  };
  for (const [comparison, difference] of Object.entries(roleDifferenceEvidence)) {
    if (difference.changedPixelCount < 100 || difference.meanAbsoluteRgbDifference <= 0.1) {
      throw new Error(`${comparison} does not establish a visible role difference: ${JSON.stringify(difference)}`);
    }
  }

  failurePhase = 'contact-sheet-write';
  const contactSheetPath = join(outDir, 'index.html');
  writeFileSync(contactSheetPath, contactSheetHtml(captures));
  const report = {
    schema: SCHEMA,
    identity: 'held-two-stage-residual-splat-and-additive-flow-witness-v0',
    status: 'captured',
    failurePhase: null,
    lastTrustworthyEvidence: { ...lastTrustworthyEvidence, phase: failurePhase },
    compositionManifestPath,
    compositionManifestSha256: sha256Text(compositionRaw),
    inferenceAuthority: composition.inferenceAuthority,
    visualAuthority: 'three-role-frozen-field-same-camera-render-v0',
    labelsAuthority: 'labels-under-images-v0',
    roles: ROLES,
    roleAuthority: ROLE_AUTHORITY,
    beautyComposition: BEAUTY_COMPOSITION,
    additiveFlowDebug: {
      composition: PARTIAL_COMPOSITION,
      partialFlowDebugMix,
      rolesRetained: ROLES,
    },
    camera: { position: cameraPosition, target: cameraTarget },
    effectiveRoute: routeIdentity,
    backend,
    servedCoreSha256,
    expectedCoreSha256,
    servedAssets,
    expectedRoute: EXPECTED_ROUTE,
    expectedBackend: EXPECTED_BACKEND,
    roleManifestAuthority,
    roleDifferenceEvidence,
    captures,
    contactSheet: {
      path: contactSheetPath,
      sha256: sha256File(contactSheetPath),
      labels: 'under-each-image',
    },
  };
  writeJson(manifestPath, report);
  console.log(JSON.stringify({ status: 'captured', manifest: manifestPath, contactSheet: contactSheetPath, captures }, null, 2));
} catch (error) {
  writeJson(manifestPath, {
    schema: SCHEMA,
    identity: 'held-two-stage-residual-splat-and-additive-flow-witness-v0',
    status: 'failed',
    failurePhase,
    error: String(error?.message || error),
    lastTrustworthyEvidence,
  });
  console.error(`Vivisector held-package splat witness failed at ${failurePhase}:`, error);
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--')) continue;
    const next = values[index + 1];
    if (!next || next.startsWith('--')) parsed.set(key, true);
    else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function required(flag) {
  const value = args.get(flag);
  if (!value || value === true) throw new Error(`${flag} is required`);
  return String(value);
}

function requiredPath(flag) {
  const path = resolve(required(flag));
  if (!existsSync(path)) throw new Error(`${flag} does not exist: ${path}`);
  return path;
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function imageDescriptor(receipt) {
  return {
    path: receipt.path,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
    composition: receipt.boundarySplatCompositionEffective,
    effectiveRoute: receipt.effectiveRoute,
    backend: receipt.backend,
    simStepCount: receipt.simStepCount,
    baseSimStepCount: receipt.baseSimStepCount,
  };
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function contactSheetHtml(captures) {
  const labels = {
    truthHigh: 'Truth high (160³ reference)',
    lowPhaseAligned: 'Low phase-aligned (native 128³ upsample)',
    vivisectorPredicted: 'Vivisector predicted (held two-stage residual)',
  };
  const figure = (role, kind, path) => `<figure><img src="${relativeImage(path)}" alt="${labels[role]} ${kind}"><figcaption>${labels[role]}<br><span>${kind}</span></figcaption></figure>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Vivisector held-package splat witness</title><style>
html{background:#090909;color:#eee;font:15px system-ui,sans-serif}body{margin:0;padding:20px}h1{font-size:20px;margin:0 0 16px}.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:22px}figure{margin:0;background:#111;border:1px solid #333}img{display:block;width:100%;height:auto;background:#000}figcaption{padding:10px 12px;text-align:center;font-weight:650}figcaption span{color:#aaa;font-weight:450}@media(max-width:900px){.row{grid-template-columns:1fr}}
</style></head><body><h1>Held step 101: reference / control / learned package</h1>
<div class="row">${ROLES.map(role => figure(role, 'Splat-only beauty', captures[role].beauty.path)).join('')}</div>
<div class="row">${ROLES.map(role => figure(role, 'Additive flow debug, mix 0.625', captures[role].flowDebug.path)).join('')}</div>
</body></html>\n`;
}

function relativeImage(path) {
  return `${basename(dirname(path))}/${basename(path)}`;
}
