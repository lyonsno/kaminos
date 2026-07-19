#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8100/index.html?kaminos_finger_fluid_bench=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-finger-fluid-bench.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const canvasOut = resolve(args.get('--canvas-out') || out.replace(/\.png$/i, '.canvas.png'));
const primaryRouteCanvasOut = resolve(args.get('--primary-route-canvas-out') || out.replace(/\.png$/i, '.primary-route-canvas.png'));
const screenSpaceSurfaceOut = resolve(args.get('--screen-space-surface-out') || out.replace(/\.png$/i, '.screen-space-surface.png'));
const screenSpaceRefractionOut = resolve(args.get('--screen-space-refraction-out') || out.replace(/\.png$/i, '.screen-space-refraction.png'));
const sphereDebugOut = resolve(args.get('--sphere-debug-out') || out.replace(/\.png$/i, '.sphere-debug.png'));
const resizedSurfaceOut = resolve(args.get('--resized-surface-out') || out.replace(/\.png$/i, '.screen-space-resized.png'));
const invalidRendererOut = resolve(args.get('--invalid-renderer-out') || out.replace(/\.png$/i, '.invalid-renderer.png'));
const reflectionPhaseAOut = resolve(args.get('--reflection-phase-a-out') || out.replace(/\.png$/i, '.reflection-phase-a.png'));
const reflectionPhaseBOut = resolve(args.get('--reflection-phase-b-out') || out.replace(/\.png$/i, '.reflection-phase-b.png'));
const liquidSupportPhaseAOut = resolve(args.get('--liquid-support-phase-a-out') || out.replace(/\.png$/i, '.liquid-support-phase-a.png'));
const liquidSupportPhaseBOut = resolve(args.get('--liquid-support-phase-b-out') || out.replace(/\.png$/i, '.liquid-support-phase-b.png'));
const opticalDebugModes = ['depth', 'entry_depth', 'normal', 'exit_depth', 'exit_normal', 'thickness', 'path_length', 'exit_validity', 'refraction_offset', 'fresnel', 'absorption', 'reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution', 'coverage'];
const opticalDebugOutputs = Object.fromEntries(opticalDebugModes.map(mode => [
  mode,
  resolve(args.get(`--optical-${mode.replace('_', '-')}-out`) || out.replace(/\.png$/i, `.optical-${mode.replace('_', '-')}.png`)),
]));
const preContactOut = resolve(args.get('--pre-contact-out') || out.replace(/\.png$/i, '.pre-contact.png'));
const midContactOut = resolve(args.get('--mid-contact-out') || out.replace(/\.png$/i, '.mid-contact.png'));
const postContactOut = resolve(args.get('--post-contact-out') || out.replace(/\.png$/i, '.post-contact.png'));
const recoveryOut = resolve(args.get('--recovery-out') || out.replace(/\.png$/i, '.pilot-recovery.png'));
const surfaceRegistrationDir = resolve(args.get('--surface-registration-dir') || out.replace(/\.png$/i, '.surface-registration'));
const port = Number(args.get('--debug-port') || 9493);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-finger-fluid-bench-profile-${port}-${process.pid}`;
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const deviceScaleFactor = Number(args.get('--device-scale-factor') || 1);
const settleMs = Number(args.get('--settle-ms') || 10000);
const preContactSettleMs = Number(args.get('--pre-contact-settle-ms') || 400);
const hookWaitMs = Number(args.get('--hook-wait-ms') || Math.max(settleMs, 15000));
const cadenceMs = Number(args.get('--cadence-ms') || 4200);
const CAMERA_DELTA_EPSILON = 1e-4;
const FINAL_DIAGNOSTICS_MAX_LAG_STEPS = 16;

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastDebugState = null;
let canvasActivity = null;
let screenSpaceSurfaceEvidence = null;
let refractionEvidence = null;
let sameStateRendererComparison = null;
let surfaceRegistrationViews = null;
let sameStateOpticalComparison = null;
let frozenStateWorldReflectionWitness = null;
let reflectionHitKindField = null;
let environmentMapField = null;
let binaryLiquidSupportField = null;
let environmentContributionField = null;
let environmentContributionAliasProbe = null;
let environmentContributionDistinctness = null;
let rendererResizeWitness = null;
let invalidRendererWitness = null;
let opticalDebugViews = null;
let slabValidityField = null;
let primaryFrameBinding = null;
let cadenceProbe = null;
let automaticDiagnosticsRequestCount = null;
let explicitDiagnosticsReceipt = null;
let finalDiagnosticsReceipt = null;
let compositionWitness = null;
let lastCompositionSample = null;
let cameraWitness = null;
let preContactWitness = null;
let preContactVolumeSample = null;
let preContactComposedSample = null;
let preContactSourceLastContactTick = 0;
let midContactWitness = null;
let midContactWitnesses = [];
let midContactComposedSample = null;
let midContactComposedSamples = [];
let midContactPresentedSample = null;
let postContactComposedSample = null;
let dryExtinguishedWitness = null;
let recoveryWitness = null;
let recoveryComposedSample = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.finger-fluid-bench-witness.v0',
    requestedUrl: url,
    debugPort: port,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
    settleMs,
    preContactSettleMs,
    hookWaitMs,
    cadenceWindowMs: cadenceMs,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    consoleEvents,
    lastDebugState,
    canvasActivity,
    cadenceProbe,
    automaticDiagnosticsRequestCount,
    explicitDiagnosticsReceipt,
    finalDiagnosticsReceipt,
    compositionWitness,
    lastCompositionSample,
    cameraWitness,
    preContactWitness,
    preContactVolumeSample,
    preContactComposedSample,
    midContactWitness,
    midContactWitnesses,
    midContactComposedSample,
    midContactComposedSamples,
    midContactPresentedSample,
    postContactComposedSample,
    dryExtinguishedWitness,
    recoveryWitness,
    recoveryComposedSample,
    canvasOut,
    screenSpaceSurfaceOut,
    screenSpaceRefractionOut,
    sphereDebugOut,
    screenSpaceSurfaceEvidence,
    refractionEvidence,
    sameStateRendererComparison,
    surfaceRegistrationViews,
    sameStateOpticalComparison,
    frozenStateWorldReflectionWitness,
    reflectionHitKindField,
    environmentMapField,
    binaryLiquidSupportField,
    environmentContributionField,
    environmentContributionAliasProbe,
    environmentContributionDistinctness,
    rendererResizeWitness,
    invalidRendererWitness,
    opticalDebugViews,
    slabValidityField,
    opticalDebugOutputs,
    primaryFrameBinding,
    primaryRouteCanvasOut,
    resizedSurfaceOut,
    invalidRendererOut,
    reflectionPhaseAOut,
    reflectionPhaseBOut,
    liquidSupportPhaseAOut,
    liquidSupportPhaseBOut,
    preContactOut,
    midContactOut,
    postContactOut,
    recoveryOut,
    output: primaryOutputWritten ? out : null,
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForTargetPage() {
  for (let i = 0; i < 80; i += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.url.includes('kaminos_finger_fluid_bench=1'))
      || pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error(`Chrome page for native fluid bench route did not appear: ${url}`);
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function collectRuntimeEvents(ws) {
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        method: msg.method,
        type: msg.params.type,
        text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        method: msg.method,
        type: 'exception',
        text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
      });
    }
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function measureCapturedPng(path, label) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || !decoded.stdout?.length) throw new Error(`ffmpeg ${label} decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  let activePixels = 0;
  let highlightPixels = 0;
  let darkPixels = 0;
  for (let i = 0; i < decoded.stdout.length; i += 3) {
    const r = decoded.stdout[i];
    const g = decoded.stdout[i + 1];
    const b = decoded.stdout[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 66 && max - min > 18) activePixels += 1;
    if (max > 148 && b >= g * 0.82) highlightPixels += 1;
    if (max < 14) darkPixels += 1;
  }
  const pixelCount = Math.floor(decoded.stdout.length / 3);
  return {
    label,
    path,
    pixelCount,
    activePixels,
    activeRatio: Number((activePixels / Math.max(1, pixelCount)).toFixed(5)),
    highlightPixels,
    highlightRatio: Number((highlightPixels / Math.max(1, pixelCount)).toFixed(5)),
    darkRatio: Number((darkPixels / Math.max(1, pixelCount)).toFixed(5)),
    measurement: 'captured_webgpu_canvas_ffmpeg_rgb24_v0',
  };
}

function measureBinaryLiquidSupport(path) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || !decoded.stdout?.length) {
    throw new Error(`ffmpeg binary liquid-support decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  let liquidPixels = 0;
  let nonBinaryPixels = 0;
  for (let offset = 0; offset < decoded.stdout.length; offset += 3) {
    const r = decoded.stdout[offset];
    const g = decoded.stdout[offset + 1];
    const b = decoded.stdout[offset + 2];
    const white = Math.min(r, g, b) >= 250 && Math.max(r, g, b) - Math.min(r, g, b) <= 2;
    const black = Math.max(r, g, b) <= 2;
    if (white) liquidPixels += 1;
    else if (!black) nonBinaryPixels += 1;
  }
  const pixelCount = decoded.stdout.length / 3;
  const field = {
    path,
    pixelCount,
    liquidPixels,
    liquidRatio: Number((liquidPixels / pixelCount).toFixed(5)),
    nonBinaryPixels,
    nonBinaryRatio: Number((nonBinaryPixels / pixelCount).toFixed(7)),
    measurement: 'gpu_binary_liquid_support_rgb24_v0',
  };
  if (liquidPixels < 1000 || nonBinaryPixels !== 0) {
    throw new Error(`binary liquid-support field is blank, partial, or scene-contaminated: ${JSON.stringify(field)}`);
  }
  return field;
}

function measureSlabValidityField(path) {
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || !decoded.stdout?.length) {
    throw new Error(`ffmpeg slab validity decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  let validExitPixels = 0;
  let invalidExitPixels = 0;
  for (let i = 0; i < decoded.stdout.length; i += 3) {
    const r = decoded.stdout[i];
    const g = decoded.stdout[i + 1];
    const b = decoded.stdout[i + 2];
    if (g > 96 && g > r * 1.35 && g > b * 1.35) validExitPixels += 1;
    if (r > 96 && r > g * 1.35 && r > b * 1.35) invalidExitPixels += 1;
  }
  const pixelCount = decoded.stdout.length / 3;
  const classifiedPixels = validExitPixels + invalidExitPixels;
  const measurement = {
    path,
    pixelCount,
    validExitPixels,
    invalidExitPixels,
    classifiedPixels,
    classifiedRatio: Number((classifiedPixels / Math.max(1, pixelCount)).toFixed(5)),
    measurement: 'captured_exit_validity_field_ffmpeg_rgb24_v0',
  };
  if (validExitPixels < 1000 || invalidExitPixels < 100) {
    throw new Error(`slab validity field lacks independently visible valid and invalid exit geometry: ${JSON.stringify(measurement)}`);
  }
  return measurement;
}

function measureFluidProjection(path, label, mask = 'blue') {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path,
  ], { encoding: 'utf8' });
  const stream = probe.status === 0 ? JSON.parse(probe.stdout || '{}')?.streams?.[0] : null;
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`ffprobe ${label} dimensions failed: ${probe.stderr || probe.status}`);
  }
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (decoded.status !== 0 || decoded.stdout?.length !== width * height * 3) {
    throw new Error(`ffmpeg ${label} fluid projection decode failed: ${decoded.stderr?.toString() || decoded.status}`);
  }
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    const r = decoded.stdout[offset];
    const g = decoded.stdout[offset + 1];
    const b = decoded.stdout[offset + 2];
    const included = mask === 'optical_thickness'
      ? r > 110 && r > g * 1.12 && g > b * 1.18
      : b >= 58 && b >= r * 1.28 && b >= g * 0.92 && g >= r * 1.02;
    if (!included) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    count += 1;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (count < 1000) throw new Error(`${label} fluid projection mask is too sparse: ${count}`);
  return {
    label,
    path,
    width,
    height,
    pixelCount: count,
    centroid: { x: sumX / count / width, y: sumY / count / height },
    bounds: { minX: minX / width, minY: minY / height, maxX: maxX / width, maxY: maxY / height },
    measurement: `captured_${mask}_fluid_projection_ffmpeg_rgb24_v0`,
  };
}

function compareFluidProjections(sphere, surface) {
  const intersectionWidth = Math.max(0, Math.min(sphere.bounds.maxX, surface.bounds.maxX) - Math.max(sphere.bounds.minX, surface.bounds.minX));
  const intersectionHeight = Math.max(0, Math.min(sphere.bounds.maxY, surface.bounds.maxY) - Math.max(sphere.bounds.minY, surface.bounds.minY));
  const sphereArea = (sphere.bounds.maxX - sphere.bounds.minX) * (sphere.bounds.maxY - sphere.bounds.minY);
  const surfaceArea = (surface.bounds.maxX - surface.bounds.minX) * (surface.bounds.maxY - surface.bounds.minY);
  return {
    normalizedCentroidDistance: Math.hypot(surface.centroid.x - sphere.centroid.x, surface.centroid.y - sphere.centroid.y),
    minimumBoundsOverlap: intersectionWidth * intersectionHeight / Math.max(1e-6, Math.min(sphereArea, surfaceArea)),
  };
}

function measureSharedSupportIdentity(spherePath, surfacePath, refractionThicknessPath, exactSphereSupportPath, exactRefractionSupportPath, label) {
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', spherePath,
  ], { encoding: 'utf8' });
  const stream = probe.status === 0 ? JSON.parse(probe.stdout || '{}')?.streams?.[0] : null;
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`ffprobe ${label} support identity dimensions failed: ${probe.stderr || probe.status}`);
  }
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const sphere = decode(spherePath);
  const surface = decode(surfacePath);
  const refraction = decode(refractionThicknessPath);
  const exactSphereSupport = decode(exactSphereSupportPath);
  const exactRefractionSupport = decode(exactRefractionSupportPath);
  const expectedBytes = width * height * 3;
  if (
    sphere.status !== 0
    || surface.status !== 0
    || refraction.status !== 0
    || exactSphereSupport.status !== 0
    || exactRefractionSupport.status !== 0
    || sphere.stdout?.length !== expectedBytes
    || surface.stdout?.length !== expectedBytes
    || refraction.stdout?.length !== expectedBytes
    || exactSphereSupport.stdout?.length !== expectedBytes
    || exactRefractionSupport.stdout?.length !== expectedBytes
  ) {
    throw new Error(`ffmpeg ${label} support identity decode failed or dimensions disagree`);
  }

  let liquidMask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 3;
    const sphereR = sphere.stdout[offset];
    const sphereG = sphere.stdout[offset + 1];
    const sphereB = sphere.stdout[offset + 2];
    const surfaceR = surface.stdout[offset];
    const surfaceG = surface.stdout[offset + 1];
    const surfaceB = surface.stdout[offset + 2];
    const thicknessR = refraction.stdout[offset];
    const thicknessG = refraction.stdout[offset + 1];
    const thicknessB = refraction.stdout[offset + 2];
    const sphereSupportR = exactSphereSupport.stdout[offset];
    const sphereSupportG = exactSphereSupport.stdout[offset + 1];
    const sphereSupportB = exactSphereSupport.stdout[offset + 2];
    const refractionSupportR = exactRefractionSupport.stdout[offset];
    const refractionSupportG = exactRefractionSupport.stdout[offset + 1];
    const refractionSupportB = exactRefractionSupport.stdout[offset + 2];
    const sphereLiquid = sphereB >= 58 && sphereB >= sphereR * 1.28 && sphereB >= sphereG * 0.92 && sphereG >= sphereR * 1.02;
    const surfaceLiquid = surfaceB >= 58 && surfaceB >= surfaceR * 1.28 && surfaceB >= surfaceG * 0.92 && surfaceG >= surfaceR * 1.02;
    const thicknessLiquid = thicknessR > 110 && thicknessR > thicknessG * 1.12 && thicknessG > thicknessB * 1.18;
    const exactSphereLiquid = Math.min(sphereSupportR, sphereSupportG, sphereSupportB) >= 250
      && Math.max(sphereSupportR, sphereSupportG, sphereSupportB) - Math.min(sphereSupportR, sphereSupportG, sphereSupportB) <= 2;
    const exactRefractionLiquid = Math.min(refractionSupportR, refractionSupportG, refractionSupportB) >= 250
      && Math.max(refractionSupportR, refractionSupportG, refractionSupportB) - Math.min(refractionSupportR, refractionSupportG, refractionSupportB) <= 2;
    const exactLiquid = exactSphereLiquid || exactRefractionLiquid;
    if (sphereLiquid || surfaceLiquid || thicknessLiquid || exactLiquid) liquidMask[pixel] = 1;
  }

  let comparedPixels = 0;
  let mismatchedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if (liquidMask[pixel]) continue;
    const offset = pixel * 3;
    let maximumDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const sphereValue = sphere.stdout[offset + channel];
      const surfaceDelta = Math.abs(sphereValue - surface.stdout[offset + channel]);
      const refractionDelta = Math.abs(sphereValue - refraction.stdout[offset + channel]);
      maximumDelta = Math.max(maximumDelta, surfaceDelta, refractionDelta);
      absoluteChannelDelta += surfaceDelta + refractionDelta;
    }
    comparedPixels += 1;
    if (maximumDelta > 4) mismatchedPixels += 1;
  }
  const pixelCount = width * height;
  if (comparedPixels < pixelCount * 0.35) {
    throw new Error(`${label} support identity mask left insufficient full-frame evidence: ${comparedPixels}/${pixelCount}`);
  }
  return {
    label,
    spherePath,
    surfacePath,
    refractionThicknessPath,
    exactSphereSupportPath,
    exactRefractionSupportPath,
    pixelCount,
    comparedPixels,
    comparedRatio: Number((comparedPixels / pixelCount).toFixed(5)),
    mismatchedPixels,
    mismatchRatio: Number((mismatchedPixels / comparedPixels).toFixed(6)),
    meanAbsoluteChannelDelta: Number((absoluteChannelDelta / Math.max(1, comparedPixels * 6)).toFixed(4)),
    liquidMaskDilationPixels: 0,
    liquidMaskDilationBasis: 'exact_route_union_no_dilation_v0',
    measurement: 'same_camera_nonliquid_shared_support_rgb24_identity_v0',
  };
}

function requireSharedSupportPresentation(receipt, label) {
  const supportPresentationEvidence = receipt?.supportPresentationEvidence;
  if (
    supportPresentationEvidence?.route !== 'wgsl-analytic-heightfield-obstacle-presentation-v0'
    || supportPresentationEvidence?.depthRoute !== 'wgsl-analytic-heightfield-obstacle-depth-v0'
    || supportPresentationEvidence?.colorDepthAuthority !== 'same_pass_same_analytic_geometry_v0'
    || supportPresentationEvidence?.refractionCaptureOrder !== 'copy_after_deferred_scene_v0'
    || supportPresentationEvidence?.passCount < 1
    || supportPresentationEvidence?.particleSupportDrawCount !== 0
  ) {
    throw new Error(`${label} shared analytic support presentation evidence missing or partial: ${JSON.stringify(supportPresentationEvidence)}`);
  }
  return supportPresentationEvidence;
}

function requireLinearHdrWorldClosure(receipt, label) {
  const linearHdrSceneEvidence = receipt?.linearHdrSceneEvidence;
  if (
    linearHdrSceneEvidence?.requestedRoute !== 'webgpu-linear-hdr-scene-radiance-v0'
    || linearHdrSceneEvidence?.effectiveRoute !== 'webgpu-linear-hdr-scene-radiance-v0'
    || linearHdrSceneEvidence?.format !== 'rgba16float'
    || linearHdrSceneEvidence?.colorSpace !== 'scene_linear_rec2020_agnostic_rgb_v0'
    || linearHdrSceneEvidence?.backgroundRoute !== 'wgsl-shared-hdr-world-background-v0'
    || linearHdrSceneEvidence?.environmentFilterRoute !== 'deterministic-five-tap-roughness-cone-v0'
    || linearHdrSceneEvidence?.backgroundPassCount < 1
    || linearHdrSceneEvidence?.fallbackReason
  ) {
    throw new Error(`${label} linear HDR scene evidence missing, stale, fallback, or partial: ${JSON.stringify(linearHdrSceneEvidence)}`);
  }
  const finalPresentationEvidence = receipt?.finalPresentationEvidence;
  if (
    finalPresentationEvidence?.requestedRoute !== 'wgsl-linear-exposure-aces-presentation-v0'
    || finalPresentationEvidence?.effectiveRoute !== 'wgsl-linear-exposure-aces-presentation-v0'
    || finalPresentationEvidence?.sourceFormat !== 'rgba16float'
    || finalPresentationEvidence?.toneMap !== 'aces-fitted-v0'
    || finalPresentationEvidence?.exposure !== 0.58
    || finalPresentationEvidence?.displayTransformCountPerFrame !== 1
    || finalPresentationEvidence?.exactDiagnosticBypass !== 'liquid_support'
    || finalPresentationEvidence?.diagnosticVisibilityRoute !== 'post-composite-depth24plus-identity-v0'
    || finalPresentationEvidence?.passCount < 1
    || finalPresentationEvidence?.fallbackReason
  ) {
    throw new Error(`${label} final presentation evidence missing, stale, fallback, duplicated, or partial: ${JSON.stringify(finalPresentationEvidence)}`);
  }
  return { linearHdrSceneEvidence, finalPresentationEvidence };
}

function requireDeferredWorldReflectionEvidence(receipt, label, requireReflection = false) {
  const deferredSceneEvidence = receipt?.deferredSceneEvidence;
  const renderFrameId = deferredSceneEvidence?.renderFrameId;
  const requestedOpticalDebugMode = receipt?.requestedOpticalDebugMode;
  const effectiveOpticalDebugMode = receipt?.effectiveOpticalDebugMode;
  const reflectionDiagnostic = requireReflection
    && requestedOpticalDebugMode === effectiveOpticalDebugMode
    && ['reflection', 'reflection_hit_kind', 'reflection_distance', 'environment', 'liquid_support', 'environment_contribution'].includes(effectiveOpticalDebugMode);
  const dynamicMeshPresentationIsCurrent = reflectionDiagnostic
    ? deferredSceneEvidence?.dynamicMesh?.presentationMode === 'suppressed_in_reflection_debug_provider_remains_active_v0'
      && deferredSceneEvidence?.dynamicIndexedMeshLastDrawFrameId !== renderFrameId
    : deferredSceneEvidence?.dynamicMesh?.presentationMode === 'deferred_scene_visible_v0'
      && deferredSceneEvidence?.dynamicIndexedMeshLastDrawFrameId === renderFrameId;
  if (
    deferredSceneEvidence?.route !== 'webgpu-deferred-indexed-mesh-scene-v0'
    || deferredSceneEvidence?.requestedRoute !== 'webgpu-deferred-indexed-mesh-scene-v0'
    || deferredSceneEvidence?.effectiveRoute !== 'webgpu-deferred-indexed-mesh-scene-v0'
    || deferredSceneEvidence?.fallbackReason
    || deferredSceneEvidence?.passCount < 1
    || !Number.isInteger(deferredSceneEvidence?.dynamicIndexedMeshDrawCount)
    || deferredSceneEvidence.dynamicIndexedMeshDrawCount < 0
    || !Number.isInteger(renderFrameId)
    || renderFrameId < 1
    || deferredSceneEvidence?.deferredSceneFrameId !== renderFrameId
    || !dynamicMeshPresentationIsCurrent
    || deferredSceneEvidence?.dynamicMesh?.objectId !== 101
    || deferredSceneEvidence?.dynamicMesh?.indexCount !== 36
    || deferredSceneEvidence?.attachments?.worldNormalRoughness?.format !== 'rgba16float'
    || deferredSceneEvidence?.attachments?.albedoMetallic?.format !== 'rgba8unorm'
    || deferredSceneEvidence?.attachments?.linearDepthObject?.format !== 'rgba16float'
  ) {
    throw new Error(`${label} deferred scene evidence missing, stale, or partial: ${JSON.stringify(deferredSceneEvidence)}`);
  }
  const worldSpaceReflectionEvidence = receipt?.worldSpaceReflectionEvidence;
  const environmentMapEvidence = receipt?.environmentMapEvidence;
  if (!requireReflection && worldSpaceReflectionEvidence !== undefined) {
    throw new Error(`${label} published reflection provider evidence for a renderer frame that did not execute it: ${JSON.stringify(worldSpaceReflectionEvidence)}`);
  }
  if (!requireReflection && environmentMapEvidence !== undefined) {
    throw new Error(`${label} published HDR environment evidence for a renderer frame that did not execute it: ${JSON.stringify(environmentMapEvidence)}`);
  }
  if (requireReflection && (
    worldSpaceReflectionEvidence?.providerRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'
    || worldSpaceReflectionEvidence?.requestedProviderRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'
    || worldSpaceReflectionEvidence?.effectiveProviderRoute !== 'wgsl-indexed-mesh-world-space-reflection-v0'
    || worldSpaceReflectionEvidence?.accelerationRoute !== 'uncapped-exact-triangle-scan-v0'
    || worldSpaceReflectionEvidence?.quadratureRoute !== 'deterministic-five-ray-cone-quadrature-v0'
    || worldSpaceReflectionEvidence?.hitKindDiagnosticScope !== 'center_ray_only_v0'
    || worldSpaceReflectionEvidence?.fallbackReason
    || worldSpaceReflectionEvidence?.compositePassCount < 1
    || worldSpaceReflectionEvidence?.reflectionProviderFrameId !== renderFrameId
    || worldSpaceReflectionEvidence?.dynamicMeshTransformGeneration !== deferredSceneEvidence?.dynamicMesh?.transformGeneration
    || worldSpaceReflectionEvidence?.exactTriangleCount !== 12
    || worldSpaceReflectionEvidence?.candidateCapMode !== 'uncapped_exact_dynamic_mesh_triangle_population_v0'
  )) {
    throw new Error(`${label} world-space reflection evidence missing, stale, or partial: ${JSON.stringify(worldSpaceReflectionEvidence)}`);
  }
  if (requireReflection && (
    environmentMapEvidence?.requestedRoute !== 'radiance-rgbe-equirectangular-environment-v0'
    || environmentMapEvidence?.effectiveRoute !== 'radiance-rgbe-equirectangular-environment-v0'
    || environmentMapEvidence?.assetId !== 'polyhaven-studio-small-09-1k'
    || environmentMapEvidence?.assetSha256 !== 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45'
    || environmentMapEvidence?.runtimeAssetUrl !== './assets/hdr/studio_small_09_1k.hdr'
    || environmentMapEvidence?.sourceAssetUrl !== 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr'
    || environmentMapEvidence?.sourcePageUrl !== 'https://polyhaven.com/a/studio_small_09'
    || environmentMapEvidence?.license !== 'CC0-1.0'
    || environmentMapEvidence?.decodeRoute !== 'cpu-radiance-rle-rgbe-v0'
    || environmentMapEvidence?.samplingRoute !== 'wgsl-manual-bilinear-rgbe-equirectangular-v0'
    || environmentMapEvidence?.filterRoute !== 'deterministic-five-tap-roughness-cone-v0'
    || environmentMapEvidence?.worldBackgroundRoute !== 'wgsl-shared-hdr-world-background-v0'
    || environmentMapEvidence?.width !== 1024
    || environmentMapEvidence?.height !== 512
    || environmentMapEvidence?.gpuTextureFormat !== 'rgba8unorm'
    || environmentMapEvidence?.fallbackReason
  )) {
    throw new Error(`${label} HDR environment evidence missing, stale, substituted, or partial: ${JSON.stringify(environmentMapEvidence)}`);
  }
  return {
    deferredSceneEvidence,
    worldSpaceReflectionEvidence: requireReflection ? worldSpaceReflectionEvidence : null,
    environmentMapEvidence: requireReflection ? environmentMapEvidence : null,
  };
}

function measureCapturedPngDelta(leftPath, rightPath, label) {
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const left = decode(leftPath);
  const right = decode(rightPath);
  if (left.status !== 0 || right.status !== 0 || !left.stdout?.length || left.stdout.length !== right.stdout?.length) {
    throw new Error(`ffmpeg ${label} delta decode failed or dimensions disagree`);
  }
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let i = 0; i < left.stdout.length; i += 3) {
    const delta = Math.abs(left.stdout[i] - right.stdout[i])
      + Math.abs(left.stdout[i + 1] - right.stdout[i + 1])
      + Math.abs(left.stdout[i + 2] - right.stdout[i + 2]);
    absoluteChannelDelta += delta;
    if (delta >= 18) changedPixels += 1;
  }
  const pixelCount = left.stdout.length / 3;
  return {
    label,
    leftPath,
    rightPath,
    pixelCount,
    changedPixels,
    changedRatio: Number((changedPixels / Math.max(1, pixelCount)).toFixed(5)),
    meanAbsoluteChannelDelta: Number((absoluteChannelDelta / Math.max(1, left.stdout.length)).toFixed(3)),
    measurement: 'same_state_captured_rgb24_absolute_delta_v0',
  };
}

function measureBinarySupportMaskedRgb24Delta(leftPath, rightPath, maskPath, label) {
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const left = decode(leftPath);
  const right = decode(rightPath);
  const mask = decode(maskPath);
  if (
    left.status !== 0
    || right.status !== 0
    || mask.status !== 0
    || !left.stdout?.length
    || left.stdout.length !== right.stdout?.length
    || left.stdout.length !== mask.stdout?.length
  ) throw new Error(`ffmpeg ${label} masked delta decode failed or dimensions disagree`);
  let maskPixels = 0;
  let changedPixels = 0;
  let absoluteChannelDelta = 0;
  for (let offset = 0; offset < left.stdout.length; offset += 3) {
    const maskR = mask.stdout[offset];
    const maskG = mask.stdout[offset + 1];
    const maskB = mask.stdout[offset + 2];
    if (!(Math.min(maskR, maskG, maskB) >= 250 && Math.max(maskR, maskG, maskB) - Math.min(maskR, maskG, maskB) <= 2)) continue;
    maskPixels += 1;
    const delta = Math.abs(left.stdout[offset] - right.stdout[offset])
      + Math.abs(left.stdout[offset + 1] - right.stdout[offset + 1])
      + Math.abs(left.stdout[offset + 2] - right.stdout[offset + 2]);
    absoluteChannelDelta += delta;
    if (delta >= 18) changedPixels += 1;
  }
  if (maskPixels < 1000) throw new Error(`${label} liquid mask is too sparse: ${maskPixels}`);
  return {
    label,
    leftPath,
    rightPath,
    maskPath,
    maskPixels,
    changedPixels,
    changedRatio: Number((changedPixels / maskPixels).toFixed(5)),
    meanAbsoluteChannelDelta: Number((absoluteChannelDelta / (maskPixels * 3)).toFixed(3)),
    measurement: 'binary_liquid_support_masked_rgb24_delta_v0',
  };
}

function requireHdrProductionContributionDistinct(delta) {
  if (delta.changedRatio < 0.1 || delta.meanAbsoluteChannelDelta < 10) {
    throw new Error(`production HDR contribution aliases the direct environment diagnostic: ${JSON.stringify(delta)}`);
  }
  return delta;
}

function measureReflectionHitKinds(hitKindPath, maskPath) {
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const hitKind = decode(hitKindPath);
  const mask = decode(maskPath);
  if (hitKind.status !== 0 || mask.status !== 0 || !hitKind.stdout?.length || hitKind.stdout.length !== mask.stdout?.length) {
    throw new Error('reflection hit-kind field decode failed or dimensions disagree');
  }
  let liquidPixels = 0;
  let environmentPixels = 0;
  let analyticPixels = 0;
  let indexedMeshPixels = 0;
  for (let offset = 0; offset < hitKind.stdout.length; offset += 3) {
    const maskR = mask.stdout[offset];
    const maskG = mask.stdout[offset + 1];
    const maskB = mask.stdout[offset + 2];
    if (!(Math.min(maskR, maskG, maskB) >= 250 && Math.max(maskR, maskG, maskB) - Math.min(maskR, maskG, maskB) <= 2)) continue;
    liquidPixels += 1;
    const r = hitKind.stdout[offset];
    const g = hitKind.stdout[offset + 1];
    const b = hitKind.stdout[offset + 2];
    if (b > 120 && b > r * 1.5 && b > g * 1.2) environmentPixels += 1;
    else if (r > 160 && g > 65 && r > g * 1.2 && g > b * 1.35) analyticPixels += 1;
    else if (r > 160 && r > g * 2 && b > g * 1.35) indexedMeshPixels += 1;
  }
  return {
    hitKindPath,
    maskPath,
    liquidPixels,
    environmentPixels,
    analyticPixels,
    indexedMeshPixels,
    indexedMeshRatio: Number((indexedMeshPixels / Math.max(1, liquidPixels)).toFixed(6)),
    measurement: 'binary_liquid_support_masked_attributable_reflection_hit_kinds_v0',
  };
}

function measureEnvironmentContributionField(contributionPath, maskPath) {
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const contribution = decode(contributionPath);
  const mask = decode(maskPath);
  if (
    contribution.status !== 0
    || mask.status !== 0
    || !contribution.stdout?.length
    || contribution.stdout.length !== mask.stdout?.length
  ) {
    throw new Error('production HDR environment-contribution field decode failed or dimensions disagree');
  }
  const histogram = new Uint32Array(256);
  let liquidPixels = 0;
  let contributionPixels = 0;
  let luminanceSum = 0;
  for (let offset = 0; offset < contribution.stdout.length; offset += 3) {
    const maskR = mask.stdout[offset];
    const maskG = mask.stdout[offset + 1];
    const maskB = mask.stdout[offset + 2];
    if (!(Math.min(maskR, maskG, maskB) >= 250 && Math.max(maskR, maskG, maskB) - Math.min(maskR, maskG, maskB) <= 2)) continue;
    const luminance = Math.round(
      contribution.stdout[offset] * 0.2126
      + contribution.stdout[offset + 1] * 0.7152
      + contribution.stdout[offset + 2] * 0.0722,
    );
    liquidPixels += 1;
    luminanceSum += luminance;
    histogram[luminance] += 1;
    if (luminance >= 5) contributionPixels += 1;
  }
  if (liquidPixels < 1000) throw new Error(`production HDR environment-contribution mask is too sparse: ${liquidPixels}`);
  const percentile = fraction => {
    const target = liquidPixels * fraction;
    let cumulative = 0;
    for (let luminance = 0; luminance < histogram.length; luminance += 1) {
      cumulative += histogram[luminance];
      if (cumulative >= target) return luminance;
    }
    return 255;
  };
  return {
    contributionPath,
    maskPath,
    liquidPixels,
    contributionPixels,
    contributionRatio: Number((contributionPixels / liquidPixels).toFixed(5)),
    meanLuminance: Number((luminanceSum / liquidPixels).toFixed(3)),
    luminanceP50: percentile(0.5),
    luminanceP95: percentile(0.95),
    measurement: 'production_quadrature_fresnel_weighted_hdr_environment_contribution_v0',
  };
}

function measureHdrEnvironmentField(environmentPath, maskPath) {
  const decode = path => spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const environment = decode(environmentPath);
  const mask = decode(maskPath);
  if (
    environment.status !== 0
    || mask.status !== 0
    || !environment.stdout?.length
    || environment.stdout.length !== mask.stdout?.length
  ) {
    throw new Error('HDR environment field decode failed or dimensions disagree');
  }

  const luminanceHistogram = new Uint32Array(256);
  let liquidPixels = 0;
  let brightPixels = 0;
  let shadowPixels = 0;
  let midtonePixels = 0;
  let luminanceSum = 0;
  for (let offset = 0; offset < environment.stdout.length; offset += 3) {
    const maskR = mask.stdout[offset];
    const maskG = mask.stdout[offset + 1];
    const maskB = mask.stdout[offset + 2];
    if (!(Math.min(maskR, maskG, maskB) >= 250 && Math.max(maskR, maskG, maskB) - Math.min(maskR, maskG, maskB) <= 2)) continue;

    const luminance = Math.round(
      environment.stdout[offset] * 0.2126
      + environment.stdout[offset + 1] * 0.7152
      + environment.stdout[offset + 2] * 0.0722,
    );
    liquidPixels += 1;
    luminanceSum += luminance;
    luminanceHistogram[luminance] += 1;
    if (luminance > 148) brightPixels += 1;
    else if (luminance < 20) shadowPixels += 1;
    else midtonePixels += 1;
  }
  if (liquidPixels < 1000) throw new Error(`HDR environment liquid mask is too sparse: ${liquidPixels}`);

  const percentile = fraction => {
    const target = liquidPixels * fraction;
    let cumulative = 0;
    for (let luminance = 0; luminance < luminanceHistogram.length; luminance += 1) {
      cumulative += luminanceHistogram[luminance];
      if (cumulative >= target) return luminance;
    }
    return 255;
  };
  return {
    environmentPath,
    maskPath,
    liquidPixels,
    brightPixels,
    brightRatio: Number((brightPixels / liquidPixels).toFixed(5)),
    shadowPixels,
    shadowRatio: Number((shadowPixels / liquidPixels).toFixed(5)),
    midtonePixels,
    midtoneRatio: Number((midtonePixels / liquidPixels).toFixed(5)),
    meanLuminance: Number((luminanceSum / liquidPixels).toFixed(3)),
    luminanceP05: percentile(0.05),
    luminanceP50: percentile(0.5),
    luminanceP95: percentile(0.95),
    measurement: 'binary_liquid_support_masked_hdr_environment_luminance_field_v0',
  };
}

async function main() {
  if (!Number.isFinite(cadenceMs) || cadenceMs < 3600) {
    phase = 'validate_config';
    throw new Error(`Finger Fluid cadence evidence must span at least 3600ms, received: ${cadenceMs}`);
  }
  const compositionRequested = new URL(url).searchParams.get('finger_fluid_pyro_composition') === '1';
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const page = await waitForTargetPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    collectRuntimeEvents(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor,
      mobile: false,
    });

    phase = 'navigate';
    await wsRequest(ws, 'Page.navigate', { url });

    phase = 'wait_debug_state';
    const hookDeadline = Date.now() + hookWaitMs;
    while (Date.now() < hookDeadline) {
      lastDebugState = await evaluate(ws, `(() => {
        const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
        if (typeof read === 'function') return read();
        return {
          diagnostic: 'missing_debug_hook',
          href: window.location.href,
          readyState: document.readyState,
          title: document.title,
          scriptCount: document.scripts.length,
          moduleScripts: Array.from(document.scripts).filter(script => script.type === 'module').length,
          bodyText: document.body ? document.body.innerText.slice(0, 240) : null
        };
      })()`);
      if (lastDebugState?.schema === 'kaminos.finger-fluid-bench.state.v0' && lastDebugState.status !== 'loading') break;
      await delay(250);
    }
    if (lastDebugState?.status === 'loading') {
      throw new Error(`finger fluid bench remained loading after ${hookWaitMs}ms`);
    }
    if (lastDebugState?.schema !== 'kaminos.finger-fluid-bench.state.v0') {
      throw new Error(`finger fluid bench debug hook did not become authoritative: ${JSON.stringify(lastDebugState)}`);
    }

    if (compositionRequested) {
      phase = 'capture_pre_contact_composition';
      await delay(preContactSettleMs);
      const preContactDeadline = Date.now() + hookWaitMs;
      let preContactCheckpoint = null;
      while (Date.now() < preContactDeadline) {
        const candidate = await evaluate(ws, `(() => {
          if (typeof window.kaminosFingerFluidPyroCompositionDebugState !== 'function') return null;
          return window.kaminosFingerFluidPyroCompositionDebugState();
        })()`);
        const volume = candidate?.volume;
        if (
          candidate?.contactPhase === 'physical-contact-awaiting-overlap'
          && candidate?.sourceTrajectoryProgress === 0
          && volume?.active === true
          && Number(volume?.simStepCount || 0) >= Number(candidate?.preContactCaptureMinSimSteps || Infinity)
          && volume?.selectiveHeadLivePassReceipt?.raymarchApplied === true
          && volume?.selectiveHeadLivePassReceipt?.splatApplied === true
        ) {
          preContactCheckpoint = candidate;
          break;
        }
        await delay(50);
      }
      if (!preContactCheckpoint) {
        throw new Error('pre-contact checkpoint did not become authoritative before the source trajectory began');
      }
      await evaluate(ws, `window.kaminosFingerFluidPyroSetSimulationPaused(true)`);
      preContactWitness = await evaluate(ws, `(async () => {
        if (typeof window.kaminosFingerFluidPyroCompositionSample !== 'function') return null;
        return window.kaminosFingerFluidPyroCompositionSample();
      })()`);
      if (preContactWitness?.contactPhase !== 'physical-contact-awaiting-overlap') {
        throw new Error(`pre-contact witness missed the physical no-overlap phase: ${preContactWitness?.contactPhase}`);
      }
      if (preContactWitness?.contactTransferEnabled !== true || preContactWitness?.volume?.liquidFireContactTransferEnabled !== true) {
        throw new Error('pre-contact witness did not observe physical liquid/fire transfer enabled from startup');
      }
      if ((preContactWitness?.consumerWitness?.sourceContactWetness || 0) !== 0) {
        throw new Error('pre-contact witness already contained burner contact');
      }
      if ((preContactWitness?.consumerWitness?.sourceWetness || 0) !== 0) {
        throw new Error('pre-contact witness retained stale burner wetness before physical overlap');
      }
      if ((preContactWitness?.consumerWitness?.sourceLastContactTick || 0) !== 0) {
        throw new Error('pre-contact witness retained a stale exact-contact event before physical overlap');
      }
      preContactSourceLastContactTick = preContactWitness.consumerWitness.sourceLastContactTick || 0;
      const preContactVolume = preContactWitness?.volume;
      if (preContactVolume?.boundarySplatMode !== 'learned') {
        throw new Error(`learned boundary-splat route was not effective: ${preContactVolume?.boundarySplatMode}`);
      }
      if (preContactVolume?.boundarySplatRendererIdentity !== 'live-boundary-sidecar-learned-attribute-splats-v0') {
        throw new Error(`wrong boundary-splat renderer identity: ${preContactVolume?.boundarySplatRendererIdentity}`);
      }
      if (preContactVolume?.selectiveHeadLiveEffectiveRole !== 'truthHigh') {
        throw new Error(`current live-field render authority was not effective: ${preContactVolume?.selectiveHeadLiveEffectiveRole}`);
      }
      if (preContactVolume?.selectiveHeadLiveCompositionEffective !== 'smoke-raymarch-under-splats-v0') {
        throw new Error(`live renderer composition was not effective: ${preContactVolume?.selectiveHeadLiveCompositionEffective}`);
      }
      if (
        preContactVolume?.selectiveHeadLivePassReceipt?.raymarchApplied !== true
        || preContactVolume?.selectiveHeadLivePassReceipt?.splatApplied !== true
        || preContactVolume?.selectiveHeadLivePassReceipt?.fallbackReason
      ) {
        throw new Error(`live renderer pass receipt is not authoritative: ${JSON.stringify(preContactVolume?.selectiveHeadLivePassReceipt)}`);
      }
      preContactVolumeSample = await evaluate(ws, `(async () => {
        if (typeof window.kaminosFingerFluidPyroVolumeSample !== 'function') throw new Error('missing explicit Pyro volume sample hook');
        const sample = await window.kaminosFingerFluidPyroVolumeSample();
        return {
          ok: sample.ok,
          volumeScene: sample.volumeScene,
          frameCount: sample.frameCount,
          simStepCount: sample.simStepCount,
          fireBounds: sample.fireBounds,
          fireLumaMean: sample.fireLumaMean,
          fireEdgeEnergy: sample.fireEdgeEnergy,
          lastFrameEnergy: sample.lastFrameEnergy,
          simReadback: {
            samples: sample.simReadback?.samples,
            densityMean: sample.simReadback?.densityMean,
            densityMax: sample.simReadback?.densityMax,
            heatMean: sample.simReadback?.heatMean,
            fuelMean: sample.simReadback?.fuelMean,
            reactionMean: sample.simReadback?.reactionMean,
            fireLayerMean: sample.simReadback?.fireLayerMean,
            combustionFrontMean: sample.simReadback?.combustionFrontMean,
            radianceMean: sample.simReadback?.radianceMean,
            extinctionMean: sample.simReadback?.extinctionMean,
            fireRisingBodyRatio: sample.simReadback?.fireRisingBodyRatio,
          },
          majorantReadback: sample.majorantReadback,
        };
      })()`);
      preContactComposedSample = await evaluate(ws, `(window.__kaminosCaptureComposedFireSample = async (presentToCanvas = false) => {
        const prototype = window.__kaminosVolumePrototype;
        if (typeof prototype?.captureSelectiveHeadLiveFrame !== 'function') {
          throw new Error('missing composed-frame Pyro witness hook');
        }
        const frame = await prototype.captureSelectiveHeadLiveFrame({
          advanceSim: false,
          presentToCanvas,
          frameIndex: 0,
        });
        try {
          if (frame?.ok !== true) {
            throw new Error('composed-frame Pyro capture failed: ' + (frame?.reason || 'unknown failure'));
          }
          if (presentToCanvas) {
            return {
              ok: true,
              imageAuthority: frame.imageAuthority,
              width: frame.width,
              height: frame.height,
              simStepCount: frame.simStepCount,
              composedFireClassifier: 'presented-from-same-paused-field-after-authoritative-readback-v0',
              composedFireBounds: null,
              passReceipt: frame.selectiveHeadLivePassReceipt,
            };
          }
          if (!Array.isArray(frame?.rgba)) {
            throw new Error('composed-frame Pyro readback failed: missing rgba');
          }
          let minX = frame.width;
          let minY = frame.height;
          let maxX = -1;
          let maxY = -1;
          let pixelCount = 0;
          let sumX = 0;
          let sumY = 0;
          for (let y = 0; y < frame.height; y += 1) {
            for (let x = 0; x < frame.width; x += 1) {
              const offset = (y * frame.width + x) * 4;
              const r = frame.rgba[offset] / 255;
              const g = frame.rgba[offset + 1] / 255;
              const b = frame.rgba[offset + 2] / 255;
              const a = frame.rgba[offset + 3] / 255;
              const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
              const chroma = Math.max(r, g, b) - Math.min(r, g, b);
              const luminousFire = a > 0.04 && luma > 0.46 && (Math.max(r, b) > 0.62 || chroma > 0.18);
              if (!luminousFire) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
              pixelCount += 1;
              sumX += x;
              sumY += y;
            }
          }
          const composedFireBounds = pixelCount > 0 ? {
            minX, minY, maxX, maxY, pixelCount,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
            centerX: sumX / pixelCount,
            centerY: sumY / pixelCount,
          } : { minX: 0, minY: 0, maxX: -1, maxY: -1, pixelCount: 0, width: 0, height: 0, centerX: null, centerY: null };
          return {
            ok: true,
            imageAuthority: frame.imageAuthority,
            width: frame.width,
            height: frame.height,
            simStepCount: frame.simStepCount,
            composedFireClassifier: 'luminous-composed-smoke-plus-learned-splat-fire-v0',
            composedFireBounds,
            passReceipt: frame.selectiveHeadLivePassReceipt,
          };
        } finally {
          prototype.setSelectiveHeadLiveCapturePaused(false);
        }
      })()`);
      const preContactScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      mkdirSync(dirname(preContactOut), { recursive: true });
      writeFileSync(preContactOut, Buffer.from(preContactScreenshot.data, 'base64'));
      const composedFireBounds = preContactComposedSample?.composedFireBounds;
      if (!(composedFireBounds?.pixelCount > 80) || !(composedFireBounds?.height > 40)) {
        throw new Error(`tall-plume pre-contact composed fire footprint is not material: ${JSON.stringify(composedFireBounds)}; raymarch-only bounds ${JSON.stringify(preContactVolumeSample?.fireBounds)}; simulator fire support ${preContactVolumeSample?.simReadback?.fireLayerMean}`);
      }
    }

    await delay(new URL(url).searchParams.get('finger_fluid_pyro_composition') === '1' ? 100 : settleMs);

    const preDiagnosticsState = await evaluate(ws, `(() => {
      const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
      return typeof read === 'function' ? read() : null;
    })()`);
    automaticDiagnosticsRequestCount = preDiagnosticsState?.runtime?.diagnosticsRequestCount;
    if (automaticDiagnosticsRequestCount !== 0) {
      throw new Error(`ordinary operator route scheduled hidden full diagnostics: ${automaticDiagnosticsRequestCount}`);
    }
    explicitDiagnosticsReceipt = await evaluate(ws, `(async () => {
      const request = window.kaminosFingerFluidBenchRequestDiagnostics;
      if (typeof request !== 'function') throw new Error('missing explicit finger fluid diagnostics hook');
      return request();
    })()`);

    const diagnosticsStateDeadline = Date.now() + 5000;
    while (Date.now() < diagnosticsStateDeadline) {
      lastDebugState = await evaluate(ws, `(() => {
        const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
        return typeof read === 'function' ? read() : null;
      })()`);
      const diagnosticsRequestCount = lastDebugState?.runtime?.diagnosticsRequestCount;
      const diagnosticsCompletionCount = lastDebugState?.runtime?.diagnosticsCompletionCount;
      if (
        diagnosticsRequestCount === explicitDiagnosticsReceipt?.diagnosticsRequestCount
        && diagnosticsCompletionCount === explicitDiagnosticsReceipt?.diagnosticsCompletionCount
      ) break;
      await delay(50);
    }

    if (new URL(url).searchParams.get('finger_fluid_pyro_composition') === '1') {
      phase = 'read_liquid_fire_composition';
      const cameraInputRoute = await evaluate(ws, `(() => {
        const read = window.kaminosFingerFluidCompositionCameraState;
        const surface = document.querySelector('#finger-fluid-bench-operator-panel #kaminos-volume-canvas.active');
        if (typeof read !== 'function') throw new Error('missing composition camera witness hook');
        if (!surface) throw new Error('missing active topmost Pyro composition canvas');
        const rect = surface.getBoundingClientRect();
        const start = { x: rect.left + rect.width * 0.45, y: rect.top + rect.height * 0.35 };
        const hitTarget = document.elementFromPoint(start.x, start.y);
        const eventCapture = { recording: true, pointerDowns: [], dragMoves: [], wheelEvents: [] };
        window.__kaminosCompositionCameraInputWitnessEvents = eventCapture;
        const panel = document.getElementById('finger-fluid-bench-operator-panel');
        panel.addEventListener('pointerdown', event => {
          if (!eventCapture.recording) return;
          eventCapture.pointerDowns.push({ clientX: event.clientX, clientY: event.clientY, buttons: event.buttons });
        }, { capture: true });
        panel.addEventListener('pointermove', event => {
          if (!eventCapture.recording) return;
          if (event.buttons === 1) eventCapture.dragMoves.push({ clientX: event.clientX, clientY: event.clientY, buttons: event.buttons });
        }, { capture: true });
        panel.addEventListener('wheel', event => {
          if (!eventCapture.recording) return;
          eventCapture.wheelEvents.push({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode });
        }, { capture: true });
        return {
          inputOwner: 'physical-browser-hit-target-v0',
          hitTargetId: hitTarget?.id || null,
          start,
          end: { x: start.x + 70, y: start.y + 35 },
          before: read(),
        };
      })()`);
      if (cameraInputRoute?.hitTargetId !== 'kaminos-volume-canvas') {
        throw new Error(`composition physical hit target mismatch: ${JSON.stringify(cameraInputRoute)}`);
      }
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cameraInputRoute.start.x, y: cameraInputRoute.start.y });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cameraInputRoute.start.x, y: cameraInputRoute.start.y, button: 'left', buttons: 1, clickCount: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cameraInputRoute.end.x, y: cameraInputRoute.end.y, button: 'left', buttons: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cameraInputRoute.end.x, y: cameraInputRoute.end.y, button: 'left', buttons: 0, clickCount: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: cameraInputRoute.end.x, y: cameraInputRoute.end.y, deltaX: 0, deltaY: 90 });
      const cameraResult = await evaluate(ws, `({
        after: window.kaminosFingerFluidCompositionCameraState(),
        inputEvents: window.__kaminosCompositionCameraInputWitnessEvents,
      })`);
      const { pointerDowns, dragMoves, wheelEvents } = cameraResult.inputEvents;
      if (pointerDowns.length !== 1 || dragMoves.length !== 1) {
        throw new Error(`composition physical drag delivery count mismatch: ${JSON.stringify(cameraResult.inputEvents)}`);
      }
      if (wheelEvents.length !== 1) {
        throw new Error(`composition physical wheel delivery count mismatch: ${JSON.stringify(cameraResult.inputEvents)}`);
      }
      const cameraAfter = cameraResult.after;
      const dragDeltaX = dragMoves[0].clientX - pointerDowns[0].clientX;
      const dragDeltaY = dragMoves[0].clientY - pointerDowns[0].clientY;
      const expectedYaw = cameraInputRoute.before.yaw - dragDeltaX * 0.006;
      const expectedPitch = Math.max(-0.2, Math.min(1.25, cameraInputRoute.before.pitch + dragDeltaY * 0.006));
      const expectedDistance = Math.max(4.0, Math.min(14, cameraInputRoute.before.distance * Math.exp(wheelEvents[0].deltaY * 0.0012)));
      cameraWitness = {
        ...cameraInputRoute,
        inputEvents: cameraResult.inputEvents,
        after: cameraAfter,
        expected: { yaw: expectedYaw, pitch: expectedPitch, distance: expectedDistance },
        yawDeltaError: Math.abs(cameraAfter.yaw - expectedYaw),
        pitchDeltaError: Math.abs(cameraAfter.pitch - expectedPitch),
        distanceDeltaError: Math.abs(cameraAfter.distance - expectedDistance),
        orbitChanged: cameraInputRoute.before.yaw !== cameraAfter.yaw && cameraInputRoute.before.pitch !== cameraAfter.pitch,
        zoomChanged: cameraInputRoute.before.distance !== cameraAfter.distance,
        targetUnchanged: JSON.stringify(cameraInputRoute.before.target) === JSON.stringify(cameraAfter.target),
      };
      if (cameraWitness?.orbitChanged !== true) throw new Error('composition camera orbit input produced no yaw/pitch delta');
      if (cameraWitness?.zoomChanged !== true) throw new Error('composition camera wheel input produced no distance delta');
      if (cameraWitness?.targetUnchanged !== true) throw new Error('composition camera orbit/zoom path unexpectedly panned its target');
      if (cameraWitness.yawDeltaError > CAMERA_DELTA_EPSILON || cameraWitness.pitchDeltaError > CAMERA_DELTA_EPSILON) {
        throw new Error(`composition camera orbit input was applied more or less than once: ${JSON.stringify(cameraWitness)}`);
      }
      if (cameraWitness.distanceDeltaError > CAMERA_DELTA_EPSILON) {
        throw new Error(`composition camera zoom input was applied more or less than once: ${JSON.stringify(cameraWitness)}`);
      }
      await evaluate(ws, `window.__kaminosCompositionCameraInputWitnessEvents.recording = false`);
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cameraInputRoute.end.x, y: cameraInputRoute.end.y });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cameraInputRoute.end.x, y: cameraInputRoute.end.y, button: 'left', buttons: 1, clickCount: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cameraInputRoute.start.x, y: cameraInputRoute.start.y, button: 'left', buttons: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cameraInputRoute.start.x, y: cameraInputRoute.start.y, button: 'left', buttons: 0, clickCount: 1 });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: cameraInputRoute.start.x, y: cameraInputRoute.start.y, deltaX: 0, deltaY: -90 });
      cameraWitness.restored = await evaluate(ws, `window.kaminosFingerFluidCompositionCameraState()`);
      cameraWitness.restoredError = Math.max(
        Math.abs(cameraWitness.restored.yaw - cameraInputRoute.before.yaw),
        Math.abs(cameraWitness.restored.pitch - cameraInputRoute.before.pitch),
        Math.abs(cameraWitness.restored.distance - cameraInputRoute.before.distance),
      );
      cameraWitness.restoredTargetUnchanged = JSON.stringify(cameraWitness.restored.target) === JSON.stringify(cameraInputRoute.before.target);
      if (cameraWitness.restoredError > CAMERA_DELTA_EPSILON || cameraWitness.restoredTargetUnchanged !== true) {
        throw new Error(`composition camera was not restored before fixed-view comparison: ${JSON.stringify(cameraWitness)}`);
      }
      await evaluate(ws, `window.kaminosFingerFluidPyroSetSimulationPaused(false)`);
      const progressionDeadline = Date.now() + Math.max(20000, hookWaitMs * 2);
      let observedPhysicalSourceContact = false;
      while (Date.now() < progressionDeadline) {
        const candidate = await evaluate(ws, `(async () => {
          if (typeof window.kaminosFingerFluidPyroCompositionSample !== 'function') {
            throw new Error('missing liquid/fire composition witness hook');
          }
          return window.kaminosFingerFluidPyroCompositionSample();
        })()`);
        lastCompositionSample = candidate;
        const source = candidate?.consumerWitness;
        if ((source?.sourceLastContactTick || 0) > preContactSourceLastContactTick) {
          observedPhysicalSourceContact = true;
        }
        if (
          observedPhysicalSourceContact
          && source?.sourceWetness > 0.15
          && source?.sourceCombustion < 0.65
          && source?.sourceCombustion > 0.50
        ) {
          midContactWitness = candidate;
          break;
        }
        await delay(100);
      }
      if (!observedPhysicalSourceContact) throw new Error('liquid never physically contacted the authored burner neighborhood');
      if (!midContactWitness) throw new Error('continuous source model skipped the observable intermediate-combustion phase');
      const preContactFirePixels = preContactComposedSample?.composedFireBounds?.pixelCount || 0;
      let midContactScreenshot = null;
      for (let frameIndex = 0; frameIndex < 4; frameIndex += 1) {
        if (frameIndex > 0) await delay(80);
        const sourceWitness = await evaluate(ws, `window.kaminosFingerFluidPyroCompositionSample()`);
        const composedSample = await evaluate(ws, `window.__kaminosCaptureComposedFireSample()`);
        composedSample.sourceCombustion = sourceWitness?.consumerWitness?.sourceCombustion ?? null;
        composedSample.sourceTemperature = sourceWitness?.consumerWitness?.sourceTemperature ?? null;
        composedSample.midFireRatio = (composedSample?.composedFireBounds?.pixelCount || 0) / Math.max(1, preContactFirePixels);
        composedSample.preContactFirePixels = preContactFirePixels;
        midContactWitnesses.push(sourceWitness);
        midContactComposedSamples.push(composedSample);
        if (!midContactScreenshot && composedSample.midFireRatio > 0.12) {
          await evaluate(ws, `window.kaminosFingerFluidPyroSetSimulationPaused(true)`);
          try {
            const representativeReadback = await evaluate(ws, `window.__kaminosCaptureComposedFireSample()`);
            representativeReadback.midFireRatio = (representativeReadback?.composedFireBounds?.pixelCount || 0) / Math.max(1, preContactFirePixels);
            representativeReadback.preContactFirePixels = preContactFirePixels;
            midContactPresentedSample = await evaluate(ws, `window.__kaminosCaptureComposedFireSample(true)`);
            midContactPresentedSample.representedReadback = representativeReadback;
            if (
              representativeReadback.midFireRatio > 0.12
              && midContactPresentedSample?.passReceipt?.raymarchApplied === true
              && midContactPresentedSample?.passReceipt?.splatApplied === true
              && !midContactPresentedSample?.passReceipt?.fallbackReason
            ) {
              midContactScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
            }
          } finally {
            await evaluate(ws, `window.kaminosFingerFluidPyroSetSimulationPaused(false)`);
          }
        }
      }
      if (!midContactScreenshot) throw new Error('intermediate temporal sequence produced no representative material frame for the operator-visible witness');
      mkdirSync(dirname(midContactOut), { recursive: true });
      writeFileSync(midContactOut, Buffer.from(midContactScreenshot.data, 'base64'));
      midContactComposedSample = midContactComposedSamples.reduce((best, sample) =>
        (sample.midFireRatio > (best?.midFireRatio || 0) ? sample : best), null);
      const materialMidFrameCount = midContactComposedSamples.filter(sample => sample.midFireRatio > 0.12).length;
      const authoritativeMidFrameCount = midContactComposedSamples.filter(sample =>
        sample?.passReceipt?.raymarchApplied === true
        && sample?.passReceipt?.splatApplied === true
        && !sample?.passReceipt?.fallbackReason).length;
      if (authoritativeMidFrameCount !== midContactComposedSamples.length) {
        throw new Error(`intermediate composed sequence contained fallback or partial frames: ${JSON.stringify(midContactComposedSamples)}`);
      }
      if (!(materialMidFrameCount >= 2) || !(midContactComposedSample?.midFireRatio > 0.15)) {
        throw new Error(`intermediate source cooling did not preserve repeated material flame support: ${JSON.stringify({ materialMidFrameCount, preContactFirePixels, samples: midContactComposedSamples })}`);
      }

      const extinctionDeadline = Date.now() + Math.max(20000, hookWaitMs * 2);
      while (Date.now() < extinctionDeadline) {
        compositionWitness = await evaluate(ws, `window.kaminosFingerFluidPyroCompositionSample()`);
        lastCompositionSample = compositionWitness;
        const source = compositionWitness?.consumerWitness;
        if (source?.sourceCombustion < 0.08 && source?.sourceIgnited < 0.5) break;
        await delay(100);
      }
      if (compositionWitness?.effectiveRoute !== 'same-device-liquid-contact-pyro-near-field-v0') {
        throw new Error(`liquid/fire effective route mismatch: ${compositionWitness?.effectiveRoute}`);
      }
      if (compositionWitness?.requestedVolumeScene !== 'tall_plume') throw new Error(`liquid/fire requested volume scene mismatch: ${compositionWitness?.requestedVolumeScene}`);
      if (compositionWitness?.effectiveVolumeScene !== 'tall_plume') throw new Error(`liquid/fire effective volume scene mismatch: ${compositionWitness?.effectiveVolumeScene}`);
      if (compositionWitness?.contactTransferEnabled !== true) throw new Error('physical liquid/fire transfer was not continuously enabled');
      if (compositionWitness?.sourcePrimitiveId !== 'finger-fluid-downstream-burner') throw new Error(`unexpected composition source geometry: ${compositionWitness?.sourcePrimitiveId}`);
      if (compositionWitness?.sameDevice !== true) throw new Error('liquid/fire composition did not preserve the same GPUDevice');
      if (compositionWitness?.source !== 'kaminos.liquid-fire-contact-descriptor.v1') throw new Error(`liquid/fire composition source schema mismatch: ${compositionWitness?.source}`);
      if (compositionWitness?.sourceFrameId !== 'kaminos/finger-fluid-bench:gpu-simulation-frame') throw new Error(`liquid/fire composition source frame mismatch: ${compositionWitness?.sourceFrameId}`);
      if (compositionWitness?.receiverTransformId !== 'shared-world-unit-cube-to-pyro-near-domain-v0') throw new Error(`liquid/fire composition receiver transform mismatch: ${compositionWitness?.receiverTransformId}`);
      if (compositionWitness?.consumerWitness?.ok !== true) {
        throw new Error(`liquid/fire GPU consumer rejected source: ${compositionWitness?.consumerWitness?.status}`);
      }
      if (!(compositionWitness.consumerWitness.acceptedContacts > 0)) throw new Error('liquid/fire composition accepted no sparse contacts');
      if (!(compositionWitness.consumerWitness.touchedCells > 0)) throw new Error('liquid/fire composition touched no Pyro cells');
      if (!(compositionWitness.consumerWitness.quenchDeposited > 0)) throw new Error('liquid/fire composition deposited no persistent quench state');
      if (!(compositionWitness.consumerWitness.quenchedCells > 0)) throw new Error('liquid/fire composition suppressed no Pyro cells');
      if (!observedPhysicalSourceContact || !(midContactWitness.consumerWitness.sourceWetness > 0.15)) {
        throw new Error('intermediate liquid/fire transfer did not retain physical burner wetness after the dry baseline');
      }
      if (!(compositionWitness.consumerWitness.sourceWetness > 0.15)) throw new Error('liquid/fire composition established no recoverable burner wetness');
      if (!(midContactWitness.consumerWitness.sourceCombustion < 0.65 && midContactWitness.consumerWitness.sourceCombustion > 0.50)) throw new Error('liquid/fire composition did not expose the bounded intermediate-combustion phase');
      if (!(compositionWitness.consumerWitness.sourceCombustion < 0.08)) throw new Error('liquid/fire composition did not materially extinguish source combustion');
      if (!(compositionWitness.consumerWitness.sourceIgnited < 0.5)) throw new Error('manual-reignition source remained ignited after quench');
      if (compositionWitness.consumerWitness.sourceStateModel !== 'recoverable-wetness-thermal-ignition-v0') throw new Error(`source state model mismatch: ${compositionWitness.consumerWitness.sourceStateModel}`);
      if (compositionWitness.consumerWitness.sourceReignitionPolicy !== 'manual-reignition-v0') throw new Error(`source reignition policy mismatch: ${compositionWitness.consumerWitness.sourceReignitionPolicy}`);
      if (!(compositionWitness.consumerWitness.addedVapor > 0)) throw new Error('liquid/fire composition added no local vapor');
      postContactComposedSample = await evaluate(ws, `window.__kaminosCaptureComposedFireSample()`);
      const postContactFirePixels = postContactComposedSample?.composedFireBounds?.pixelCount || 0;
      const postFireRatio = postContactFirePixels / Math.max(1, preContactFirePixels);
      postContactComposedSample.postFireRatio = postFireRatio;
      postContactComposedSample.preContactFirePixels = preContactFirePixels;
      const postContactScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      mkdirSync(dirname(postContactOut), { recursive: true });
      writeFileSync(postContactOut, Buffer.from(postContactScreenshot.data, 'base64'));
      if (!(postFireRatio <= 0.15)) {
        throw new Error(`sustained liquid contact did not quench the fixed-view luminous flame: ${JSON.stringify({ postFireRatio, preContactFirePixels, postContactFirePixels, pre: preContactComposedSample?.composedFireBounds, post: postContactComposedSample?.composedFireBounds })}`);
      }

      phase = 'verify_manual_pilot_recovery';
      await evaluate(ws, `window.kaminosFingerFluidPyroSetPilotEnabled(false)`);
      const dryMoveReceipt = await evaluate(ws, `window.kaminosFingerFluidPyroSetSourcePosition([0.65, -0.35, 0.51])`);
      if (dryMoveReceipt?.simulationReset !== false) throw new Error(`moving the extinguished source reported a simulation reset: ${JSON.stringify(dryMoveReceipt)}`);
      const recoveryStartStep = compositionWitness?.volume?.simStepCount || 0;
      const recoveryStartResetCount = compositionWitness?.volume?.fluidStateResetCount;
      const dryDeadline = Date.now() + Math.max(30000, hookWaitMs * 3);
      while (Date.now() < dryDeadline) {
        const candidate = await evaluate(ws, `window.kaminosFingerFluidPyroCompositionSample()`);
        lastCompositionSample = candidate;
        const source = candidate?.consumerWitness;
        if ((source?.sourceIgnited || 0) >= 0.5) {
          throw new Error(`extinguished source automatically reignited while pilot was disabled: ${JSON.stringify(source)}`);
        }
        if ((source?.sourceCombustion || 0) >= 0.08) {
          await delay(100);
          continue;
        }
        if ((source?.sourceWetness || 0) < 0.16) {
          dryExtinguishedWitness = candidate;
          break;
        }
        await delay(100);
      }
      if (!dryExtinguishedWitness) throw new Error('extinguished source did not dry while remaining manually unignited');
      if (dryExtinguishedWitness.volume?.fluidStateResetCount !== recoveryStartResetCount) {
        throw new Error(`source drying reset the established field: ${JSON.stringify({ recoveryStartResetCount, final: dryExtinguishedWitness.volume?.fluidStateResetCount })}`);
      }
      if (!(dryExtinguishedWitness.volume?.simStepCount > recoveryStartStep)) throw new Error('source drying did not advance the established live simulation');
      if (dryExtinguishedWitness.consumerWitness?.sourcePilotEnabled !== false) throw new Error('manual no-auto-reignite interval did not report the pilot disabled');

      const pilotReceipt = await evaluate(ws, `window.kaminosFingerFluidPyroSetPilotEnabled(true)`);
      if (pilotReceipt?.enabled !== true || pilotReceipt?.simulationReset !== false) {
        throw new Error(`explicit pilot did not engage without reset: ${JSON.stringify(pilotReceipt)}`);
      }
      const pilotDeadline = Date.now() + Math.max(30000, hookWaitMs * 3);
      while (Date.now() < pilotDeadline) {
        const candidate = await evaluate(ws, `window.kaminosFingerFluidPyroCompositionSample()`);
        lastCompositionSample = candidate;
        const source = candidate?.consumerWitness;
        if ((source?.sourceIgnited || 0) > 0.5 && (source?.sourceCombustion || 0) > 0.45) {
          recoveryWitness = candidate;
          break;
        }
        await delay(100);
      }
      if (!recoveryWitness) throw new Error('explicit pilot failed to recover the dry extinguished live source');
      if (recoveryWitness.consumerWitness?.sourcePilotEnabled !== true) throw new Error('recovered source did not report explicit pilot authority');
      if (recoveryWitness.sourcePilotEnabled !== recoveryWitness.consumerWitness?.sourcePilotEnabled) {
        throw new Error(`recovered source exposed contradictory pilot authority: ${JSON.stringify({ composition: recoveryWitness.sourcePilotEnabled, consumer: recoveryWitness.consumerWitness?.sourcePilotEnabled })}`);
      }
      if (recoveryWitness.volume?.fluidStateResetCount !== recoveryStartResetCount) {
        throw new Error(`pilot recovery reset the established field: ${JSON.stringify({ recoveryStartResetCount, final: recoveryWitness.volume?.fluidStateResetCount })}`);
      }
      await delay(600);
      recoveryComposedSample = await evaluate(ws, `window.__kaminosCaptureComposedFireSample()`);
      const recoveryFirePixels = recoveryComposedSample?.composedFireBounds?.pixelCount || 0;
      recoveryComposedSample.recoveryFireRatio = recoveryFirePixels / Math.max(1, preContactFirePixels);
      if (!(recoveryComposedSample.recoveryFireRatio > 0.15)) {
        throw new Error(`explicit pilot recovered source state without a material fixed-view luminous flame: ${JSON.stringify(recoveryComposedSample)}`);
      }
      const recoveryScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      mkdirSync(dirname(recoveryOut), { recursive: true });
      writeFileSync(recoveryOut, Buffer.from(recoveryScreenshot.data, 'base64'));
    }

    phase = 'read_debug_state';
    if (!lastDebugState) throw new Error('missing kaminosFingerFluidBenchDebugState');
    if (lastDebugState.diagnostic === 'missing_debug_hook') throw new Error('missing kaminosFingerFluidBenchDebugState');
    if (lastDebugState.schema !== 'kaminos.finger-fluid-bench.state.v0') throw new Error(`bench state schema mismatch: ${lastDebugState.schema}`);
    if (lastDebugState.route !== 'kaminos/finger-fluid-bench') throw new Error(`bench route mismatch: ${lastDebugState.route}`);
    if (lastDebugState.source?.schema !== 'big-papa.finger-fluid.synthetic-source.v0') throw new Error(`source schema mismatch: ${lastDebugState.source?.schema}`);
    if (!lastDebugState.downgrades?.includes('kaminos_native_synthetic_fluid_not_lerms_source_truth')) throw new Error('missing synthetic source downgrade');
    if (lastDebugState.acceptance?.iframeAcceptance !== false) throw new Error('iframe acceptance was not rejected');
    if (lastDebugState.acceptance?.openDirectAcceptance !== false) throw new Error('open-direct acceptance was not rejected');
    if (lastDebugState.status !== 'running') throw new Error(`fluid bench did not reach running state: ${lastDebugState.status}`);
    if (lastDebugState.solver?.backend !== 'webgpu_compute') throw new Error(`fallback solver backend rejected: ${lastDebugState.solver?.backend}`);
    if (lastDebugState.renderer?.backend !== 'webgpu_direct_render') throw new Error(`fallback render backend rejected: ${lastDebugState.renderer?.backend}`);
    if (lastDebugState.runtime?.available !== true) throw new Error(`WebGPU runtime unavailable or fallback: ${JSON.stringify(lastDebugState.runtime)}`);
    const diagnosticsRequestCount = lastDebugState.runtime?.diagnosticsRequestCount;
    const diagnosticsCompletionCount = lastDebugState.runtime?.diagnosticsCompletionCount;
    if (diagnosticsRequestCount !== 1 || diagnosticsCompletionCount !== diagnosticsRequestCount) {
      throw new Error(`explicit full diagnostics are missing, partial, or duplicated: ${JSON.stringify({ automaticDiagnosticsRequestCount, diagnosticsRequestCount, diagnosticsCompletionCount, explicitDiagnosticsReceipt })}`);
    }
    if (lastDebugState.runtime?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0') throw new Error(`solver route mismatch: ${lastDebugState.runtime?.solverRoute}`);
    if (lastDebugState.runtime?.neighborGridContract !== 'wgsl-linked-cell-neighbor-grid-v0') throw new Error(`neighbor grid contract mismatch: ${lastDebugState.runtime?.neighborGridContract}`);
    if (lastDebugState.runtime?.densityContract !== 'wgsl-pbf-density-constraint-v0') throw new Error(`density contract mismatch: ${lastDebugState.runtime?.densityContract}`);
    if (lastDebugState.runtime?.vorticityConfinementContract !== 'wgsl-neighbor-vorticity-confinement-v0') throw new Error(`vorticity contract mismatch: ${lastDebugState.runtime?.vorticityConfinementContract}`);
    if (lastDebugState.runtime?.freeSurfaceContract !== 'wgsl-neighbor-free-surface-cohesion-v0') throw new Error(`free-surface contract mismatch: ${lastDebugState.runtime?.freeSurfaceContract}`);
    if (lastDebugState.runtime?.restStateContract !== 'wgsl-support-aware-persistent-rest-state-v0') throw new Error(`rest-state contract mismatch: ${lastDebugState.runtime?.restStateContract}`);
    if (lastDebugState.runtime?.supportTransportContract !== 'wgsl-support-tangential-transport-v0') throw new Error(`support-transport contract mismatch: ${lastDebugState.runtime?.supportTransportContract}`);
    if (lastDebugState.runtime?.topologyContract !== 'wgsl-four-neighbor-topology-retention-v0') throw new Error(`topology contract mismatch: ${lastDebugState.runtime?.topologyContract}`);
    if (lastDebugState.runtime?.particleShiftContract !== 'wgsl-opt-in-support-tangential-particle-shift-v0') throw new Error(`particle-shift contract mismatch: ${lastDebugState.runtime?.particleShiftContract}`);
    if (lastDebugState.runtime?.chemistryContract !== 'wgsl-passive-material-tracer-diffusion-v0') throw new Error(`passive tracer contract mismatch: ${lastDebugState.runtime?.chemistryContract}`);
    const requestedRoute = new URL(url);
    const requestedColorMode = requestedRoute.searchParams.get('finger_fluid_color_mode') || 'phase';
    const requestedRendererMode = requestedRoute.searchParams.get('finger_fluid_renderer') || 'screen_space_surface';
    const requestedOpticalDebugMode = requestedRoute.searchParams.get('finger_fluid_optical_debug') || 'shaded';
    const requestedParticleShiftStrength = Number(requestedRoute.searchParams.get('finger_fluid_particle_shift') ?? 0);
    const requestedChemistryDiffusion = Number(requestedRoute.searchParams.get('finger_fluid_chemistry_diffusion') ?? 0);
    const effectiveColorMode = lastDebugState.runtime?.effectiveColorMode;
    const effectiveRendererMode = lastDebugState.runtime?.effectiveRendererMode;
    const effectiveOpticalDebugMode = lastDebugState.runtime?.effectiveOpticalDebugMode;
    const effectiveParticleShiftStrength = lastDebugState.runtime?.effectiveParticleShiftStrength;
    const effectiveChemistryDiffusion = lastDebugState.runtime?.effectiveChemistryDiffusion;
    if (requestedColorMode !== effectiveColorMode) throw new Error(`silent color-mode fallback rejected: ${JSON.stringify({ requestedColorMode, effectiveColorMode })}`);
    if (requestedRendererMode !== effectiveRendererMode) throw new Error(`renderer disagreement rejected: ${JSON.stringify({ requestedRendererMode, effectiveRendererMode, fallbackReason: lastDebugState.runtime?.fallbackReason })}`);
    if (requestedOpticalDebugMode !== effectiveOpticalDebugMode) throw new Error(`optical renderer disagreement rejected: ${JSON.stringify({ requestedOpticalDebugMode, effectiveOpticalDebugMode })}`);
    const expectedRendererRoute = {
      screen_space_surface: 'webgpu-screen-space-liquid-surface-v0',
      screen_space_refraction: 'webgpu-screen-space-liquid-refraction-v0',
      sphere_debug: 'webgpu-particle-sphere-debug-renderer-v0',
    }[requestedRendererMode];
    if (!expectedRendererRoute || lastDebugState.runtime?.requestedRenderer !== expectedRendererRoute || lastDebugState.runtime?.effectiveRenderer !== expectedRendererRoute) {
      throw new Error(`optical renderer disagreement in requested/effective route identity: ${JSON.stringify({ requestedRendererMode, expectedRendererRoute, requestedRenderer: lastDebugState.runtime?.requestedRenderer, effectiveRenderer: lastDebugState.runtime?.effectiveRenderer })}`);
    }
    if (lastDebugState.runtime?.fallbackReason) throw new Error(`renderer fallback rejected: ${lastDebugState.runtime.fallbackReason}`);
    requireSharedSupportPresentation(lastDebugState.runtime, 'initial runtime');
    requireLinearHdrWorldClosure(lastDebugState.runtime, 'initial runtime');
    requireDeferredWorldReflectionEvidence(lastDebugState.runtime, 'initial runtime', effectiveRendererMode === 'screen_space_refraction');
    if (effectiveRendererMode === 'screen_space_surface') {
      screenSpaceSurfaceEvidence = lastDebugState.runtime?.screenSpaceSurfaceEvidence || null;
      if (screenSpaceSurfaceEvidence?.route !== 'webgpu-screen-space-liquid-surface-v0') throw new Error(`screen-space route evidence mismatch: ${JSON.stringify(screenSpaceSurfaceEvidence)}`);
      if (
        screenSpaceSurfaceEvidence?.accumulationTexture?.format !== 'rgba16float'
        || screenSpaceSurfaceEvidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
      ) throw new Error(`screen-space accumulation channel evidence mismatch: ${JSON.stringify(screenSpaceSurfaceEvidence)}`);
      if (screenSpaceSurfaceEvidence?.accumulationPassCount < 1 || screenSpaceSurfaceEvidence?.compositePassCount < 1) throw new Error(`screen-space pass evidence missing: ${JSON.stringify(screenSpaceSurfaceEvidence)}`);
    }
    if (effectiveRendererMode === 'screen_space_refraction') {
      refractionEvidence = lastDebugState.runtime?.refractionEvidence || null;
      if (
        refractionEvidence?.route !== 'webgpu-screen-space-liquid-refraction-v0'
        || refractionEvidence?.opticalTransportRoute !== 'snell-two-interface-screen-space-slab-v0'
        || refractionEvidence?.slabRoute !== 'wgsl-particle-projected-front-back-slab-v0'
        || refractionEvidence?.slabGeometryPassCount < 1
        || refractionEvidence?.frontDepthTexture?.format !== 'rgba16float'
        || refractionEvidence?.frontDepthTexture?.channels?.join('|') !== 'projected_particle_sphere_front_view_depth_min|nearest_particle_center_view_depth_min'
        || refractionEvidence?.backDepthTexture?.format !== 'rgba16float'
        || refractionEvidence?.backDepthTexture?.channel !== 'projected_particle_sphere_back_view_depth_max'
        || refractionEvidence?.accumulationTexture?.format !== 'rgba16float'
        || refractionEvidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
        || refractionEvidence?.invalidSlabDisposition !== 'entry_interface_only_no_exit_claim_v0'
        || refractionEvidence?.supportDepthRoute !== 'wgsl-analytic-heightfield-obstacle-depth-v0'
        || refractionEvidence?.analyticSupportDepthPassCount < 1
        || refractionEvidence?.opticalDebugMode !== requestedOpticalDebugMode
        || refractionEvidence?.sceneColorTexture?.format !== 'rgba16float'
        || refractionEvidence?.sceneColorTexture?.source !== 'same-camera-linear-hdr-scene-radiance-v0'
        || refractionEvidence?.scenePassCount < 1
        || refractionEvidence?.accumulationPassCount < 1
        || refractionEvidence?.compositePassCount < 1
      ) throw new Error(`refraction route evidence missing or partial: ${JSON.stringify(refractionEvidence)}`);
    }
    if (requestedParticleShiftStrength !== effectiveParticleShiftStrength) throw new Error(`silent particle-shift fallback rejected: ${JSON.stringify({ requestedParticleShiftStrength, effectiveParticleShiftStrength })}`);
    if (requestedChemistryDiffusion !== effectiveChemistryDiffusion) throw new Error(`silent chemistry-diffusion fallback rejected: ${JSON.stringify({ requestedChemistryDiffusion, effectiveChemistryDiffusion })}`);
    if (effectiveParticleShiftStrength === 0 && lastDebugState.runtime?.particleShiftPassCount !== 0) throw new Error(`zero-strength route dispatched hidden particle shifting: ${lastDebugState.runtime?.particleShiftPassCount}`);
    if (effectiveParticleShiftStrength > 0 && lastDebugState.runtime?.particleShiftPassCount < lastDebugState.runtime.stepCount * 2) throw new Error(`enabled particle shifting missed required passes: ${JSON.stringify({ particleShiftPassCount: lastDebugState.runtime?.particleShiftPassCount, stepCount: lastDebugState.runtime?.stepCount })}`);
    if (effectiveChemistryDiffusion === 0 && lastDebugState.runtime?.chemistryDiffusionPassCount !== 0) throw new Error(`zero diffusion dispatched hidden chemistry work: ${lastDebugState.runtime?.chemistryDiffusionPassCount}`);
    if (effectiveChemistryDiffusion > 0 && lastDebugState.runtime?.chemistryDiffusionPassCount < lastDebugState.runtime.stepCount * 2) throw new Error(`enabled chemistry diffusion missed required passes: ${JSON.stringify({ chemistryDiffusionPassCount: lastDebugState.runtime?.chemistryDiffusionPassCount, stepCount: lastDebugState.runtime?.stepCount })}`);
    if (lastDebugState.runtime?.playgroundContract !== 'wgsl-shared-multi-regime-toy-playground-v0') throw new Error(`playground contract mismatch: ${lastDebugState.runtime?.playgroundContract}`);
    const playground = lastDebugState.runtime?.playground;
    if (
      !playground?.rendered
      || playground.supportGeometryMode !== 'shared_analytic_heightfield_mesh_plus_analytic_obstacle_v0'
      || playground.supportPresentationRoute !== 'wgsl-analytic-heightfield-obstacle-presentation-v0'
      || playground.supportGeometryCountUnit !== 'vertices'
      || playground.terrainVertexCount <= 0
      || playground.obstacleVertexCount <= 0
      || playground.supportGeometryCount !== playground.terrainVertexCount + playground.obstacleVertexCount
      || playground.particleSupportDrawCount !== 0
    ) {
      throw new Error(`shared analytic playground presentation is missing or stale: ${JSON.stringify(playground)}`);
    }
    if (lastDebugState.runtime?.obstacleContract !== 'shared-solver-render-obstacle-v0' || lastDebugState.runtime?.obstacle?.rendered !== true) throw new Error(`solver obstacle is not attributable in the renderer: ${JSON.stringify(lastDebugState.runtime?.obstacle)}`);
    if (lastDebugState.runtime?.stepCount < 20) throw new Error(`insufficient real compute steps: ${lastDebugState.runtime?.stepCount}`);
    if (lastDebugState.runtime?.linkedCellGridBuildCount < 20) throw new Error(`missing linked-cell grid builds: ${lastDebugState.runtime?.linkedCellGridBuildCount}`);
    if (lastDebugState.runtime?.densityIterationCount < 60) throw new Error(`missing density iterations: ${lastDebugState.runtime?.densityIterationCount}`);
    if (lastDebugState.runtime?.vorticityUpdateInterval !== 3) throw new Error(`unexpected vorticity update interval: ${lastDebugState.runtime?.vorticityUpdateInterval}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.vorticityPassCount)) throw new Error(`missing or malformed vorticity pass count: ${lastDebugState.runtime?.vorticityPassCount}`);
    const minimumVorticityPassCount = Math.floor(lastDebugState.runtime.stepCount / lastDebugState.runtime.vorticityUpdateInterval) * 2;
    if (lastDebugState.runtime?.vorticityPassCount < minimumVorticityPassCount) throw new Error(`missing temporally scheduled two-stage vorticity passes: ${JSON.stringify({ actual: lastDebugState.runtime?.vorticityPassCount, minimum: minimumVorticityPassCount })}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.postProjectionGridRefreshCount) || lastDebugState.runtime.postProjectionGridRefreshCount < lastDebugState.runtime.stepCount) throw new Error(`missing post-projection neighbor refreshes: ${lastDebugState.runtime?.postProjectionGridRefreshCount}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.freeSurfaceClassificationPassCount) || lastDebugState.runtime.freeSurfaceClassificationPassCount < lastDebugState.runtime.stepCount) throw new Error(`missing free-surface classification passes: ${lastDebugState.runtime?.freeSurfaceClassificationPassCount}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.surfaceCohesionPassCount) || lastDebugState.runtime.surfaceCohesionPassCount < lastDebugState.runtime.stepCount) throw new Error(`missing surface cohesion passes: ${lastDebugState.runtime?.surfaceCohesionPassCount}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.interfaceCompactionPassCount) || lastDebugState.runtime.interfaceCompactionPassCount < lastDebugState.runtime.stepCount) throw new Error(`missing interface compaction passes: ${lastDebugState.runtime?.interfaceCompactionPassCount}`);
    if (!Number.isSafeInteger(lastDebugState.runtime?.topologyMeasurementPassCount) || lastDebugState.runtime.topologyMeasurementPassCount < lastDebugState.runtime.stepCount) throw new Error(`missing topology measurement passes: ${lastDebugState.runtime?.topologyMeasurementPassCount}`);
    if (lastDebugState.runtime?.directRenderFrameCount < 20) throw new Error(`missing direct GPU render frames: ${lastDebugState.runtime?.directRenderFrameCount}`);
    const activeExtent3d = lastDebugState.runtime?.diagnostics?.activeExtent3d;
    if (!activeExtent3d || activeExtent3d.size?.length !== 3) throw new Error('missing activeExtent3d diagnostics');
    const diagnosticsLagSteps = lastDebugState.runtime.stepCount - lastDebugState.runtime.diagnostics?.stepCount;
    const diagnosticsAgeMs = lastDebugState.runtime.diagnostics?.ageMs;
    if (!Number.isInteger(diagnosticsLagSteps) || diagnosticsLagSteps < 0 || !Number.isFinite(diagnosticsAgeMs) || diagnosticsAgeMs > 3000) {
      throw new Error(`stale GPU diagnostics rejected: ${JSON.stringify({ diagnosticsAgeMs, diagnosticsLagSteps, stepCount: lastDebugState.runtime.stepCount, diagnosticsStepCount: lastDebugState.runtime.diagnostics?.stepCount })}`);
    }
    if (activeExtent3d.size.some(value => !Number.isFinite(value) || value < 0.35)) throw new Error(`fluid state is not materially 3D: ${JSON.stringify(activeExtent3d)}`);
    if (lastDebugState.runtime?.diagnostics?.maxSpeed > 3.35) throw new Error(`bounded-energy stability failure: maxSpeed ${lastDebugState.runtime.diagnostics.maxSpeed}`);
    const averageVorticity = lastDebugState.runtime?.diagnostics?.averageVorticity;
    const maxVorticity = lastDebugState.runtime?.diagnostics?.maxVorticity;
    if (!Number.isFinite(averageVorticity) || averageVorticity <= 0.001 || !Number.isFinite(maxVorticity) || maxVorticity <= averageVorticity || maxVorticity >= 4095) {
      throw new Error(`neighbor-derived vorticity evidence is absent or saturated: ${JSON.stringify({ averageVorticity, maxVorticity })}`);
    }
    const averageNeighborRetention = lastDebugState.runtime?.diagnostics?.averageNeighborRetention;
    const averageNeighborRetentionAge = lastDebugState.runtime?.diagnostics?.averageNeighborRetentionAge;
    const movingLockedParticleCount = lastDebugState.runtime?.diagnostics?.movingLockedParticleCount;
    const neighborRetentionHistogram = lastDebugState.runtime?.diagnostics?.neighborRetentionHistogram;
    if (!Array.isArray(neighborRetentionHistogram) || neighborRetentionHistogram.length !== 4 || neighborRetentionHistogram.reduce((sum, count) => sum + count, 0) !== lastDebugState.runtime.particleCount) {
      throw new Error(`topology histogram does not account for the exact particle population: ${JSON.stringify({ neighborRetentionHistogram, particleCount: lastDebugState.runtime?.particleCount })}`);
    }
    if (!Number.isFinite(averageNeighborRetention) || averageNeighborRetention <= 0.05 || averageNeighborRetention > 1.001) {
      throw new Error(`nearest-neighbor retention evidence is absent or malformed: ${JSON.stringify({ averageNeighborRetention })}`);
    }
    if (!Number.isFinite(averageNeighborRetentionAge) || averageNeighborRetentionAge <= 0.05) {
      throw new Error(`nearest-neighbor retention age did not accumulate: ${JSON.stringify({ averageNeighborRetentionAge })}`);
    }
    if (!Number.isSafeInteger(movingLockedParticleCount) || movingLockedParticleCount < 32) {
      throw new Error(`moving topology-lock population is not materially observable: ${JSON.stringify({ movingLockedParticleCount })}`);
    }
    const chemistry = lastDebugState.runtime?.diagnostics?.chemistry;
    const chemistryHistogram = chemistry?.chemistryHistogram;
    if (!Array.isArray(chemistryHistogram) || chemistryHistogram.length !== 8 || chemistryHistogram.reduce((sum, count) => sum + count, 0) !== lastDebugState.runtime.particleCount) {
      throw new Error(`chemistry histogram does not account for the exact particle population: ${JSON.stringify({ chemistryHistogram, particleCount: lastDebugState.runtime?.particleCount })}`);
    }
    if (chemistry?.contract !== 'wgsl-passive-material-tracer-diffusion-v0' || chemistry.particleCount !== lastDebugState.runtime.particleCount) {
      throw new Error(`passive tracer diagnostics are missing or partial: ${JSON.stringify(chemistry)}`);
    }
    if (!Number.isFinite(chemistry.diffusionMassDrift) || !Number.isFinite(chemistry.massTolerance) || Math.abs(chemistry.diffusionMassDrift) > chemistry.massTolerance) {
      throw new Error(`passive tracer diffusion created unexplained mass: ${JSON.stringify(chemistry)}`);
    }
    if (!Number.isFinite(chemistry.minimum) || !Number.isFinite(chemistry.maximum) || chemistry.minimum < -0.001 || chemistry.maximum > 1.001) {
      throw new Error(`passive tracer escaped its source concentration range: ${JSON.stringify(chemistry)}`);
    }
    if (effectiveChemistryDiffusion > 0 && (!Number.isFinite(chemistry.averageRecipeDeviation) || chemistry.averageRecipeDeviation <= 0.0001)) {
      throw new Error(`enabled passive tracer did not materially depart from immutable source recipes: ${JSON.stringify(chemistry)}`);
    }
    const surfaceParticleRatio = lastDebugState.runtime?.diagnostics?.surfaceParticleRatio;
    const averageSurfaceFactor = lastDebugState.runtime?.diagnostics?.averageSurfaceFactor;
    const maxSurfaceFactor = lastDebugState.runtime?.diagnostics?.maxSurfaceFactor;
    if (!Number.isFinite(surfaceParticleRatio) || surfaceParticleRatio < 0.02 || surfaceParticleRatio > 0.78) {
      throw new Error(`free-surface classification is empty or swallowed the volume: ${JSON.stringify({ surfaceParticleRatio, surfaceParticleCount: lastDebugState.runtime?.diagnostics?.surfaceParticleCount })}`);
    }
    if (!Number.isFinite(averageSurfaceFactor) || averageSurfaceFactor < 0.01 || averageSurfaceFactor > 0.85 || !Number.isFinite(maxSurfaceFactor) || maxSurfaceFactor < 0.5 || maxSurfaceFactor > 1.001) {
      throw new Error(`free-surface confidence is absent or saturated: ${JSON.stringify({ averageSurfaceFactor, maxSurfaceFactor })}`);
    }
    const interfaceChurnRatio = lastDebugState.runtime?.diagnostics?.interfaceChurnRatio;
    const averageInterfaceAge = lastDebugState.runtime?.diagnostics?.averageInterfaceAge;
    const supportedRestingParticleCount = lastDebugState.runtime?.diagnostics?.supportedRestingParticleCount;
    const activeTransportParticleCount = lastDebugState.runtime?.diagnostics?.activeTransportParticleCount;
    if (!Number.isFinite(interfaceChurnRatio) || interfaceChurnRatio < 0 || interfaceChurnRatio > 0.12) {
      throw new Error(`persistent interface churn is missing or excessive: ${JSON.stringify({ interfaceChurnRatio })}`);
    }
    if (!Number.isFinite(averageInterfaceAge) || averageInterfaceAge <= 0.05) {
      throw new Error(`persistent interface age did not accumulate: ${JSON.stringify({ averageInterfaceAge })}`);
    }
    if (!Number.isSafeInteger(supportedRestingParticleCount) || supportedRestingParticleCount < 128) {
      throw new Error(`supported rest population is not material: ${JSON.stringify({ supportedRestingParticleCount })}`);
    }
    if (!Number.isSafeInteger(activeTransportParticleCount) || activeTransportParticleCount < 128) {
      throw new Error(`active transport was erased by rest-state relaxation: ${JSON.stringify({ activeTransportParticleCount })}`);
    }
    const supportedTransportParticleCount = lastDebugState.runtime?.diagnostics?.supportedTransportParticleCount;
    const averageSupportedTangentialSpeed = lastDebugState.runtime?.diagnostics?.averageSupportedTangentialSpeed;
    if (!Number.isSafeInteger(supportedTransportParticleCount) || supportedTransportParticleCount < 128) {
      throw new Error(`supported transport population was arrested before lateral spreading: ${JSON.stringify({ supportedTransportParticleCount })}`);
    }
    if (!Number.isFinite(averageSupportedTangentialSpeed) || averageSupportedTangentialSpeed < 0.32) {
      throw new Error(`supported transport lacks material tangential speed: ${JSON.stringify({ averageSupportedTangentialSpeed })}`);
    }
    const zoneDiagnostics = lastDebugState.runtime?.playgroundZoneDiagnostics;
    if (zoneDiagnostics?.schema !== 'kaminos.finger-fluid.playground-zone-diagnostics.v0') throw new Error(`playground zone diagnostics missing: ${JSON.stringify(zoneDiagnostics)}`);
    const minimumMaterialOccupancy = Math.ceil(lastDebugState.runtime.particleCount * 0.01);
    if (zoneDiagnostics.materialOccupancyThreshold !== minimumMaterialOccupancy) throw new Error(`playground material-occupancy threshold is not source-honest: ${JSON.stringify(zoneDiagnostics)}`);
    if (zoneDiagnostics.materiallyOccupiedZoneCount < 5) throw new Error(`playground did not retain five materially occupied regimes: ${JSON.stringify(zoneDiagnostics)}`);
    if (lastDebugState.runtime?.sourceRecirculationCount < 1) throw new Error(`finite source recirculation did not execute: ${lastDebugState.runtime?.sourceRecirculationCount}`);
    if (zoneDiagnostics.particleCount !== lastDebugState.runtime.particleCount || zoneDiagnostics.zones?.length !== 6) {
      throw new Error(`playground zone accounting is incomplete: ${JSON.stringify(zoneDiagnostics)}`);
    }
    const zonesByName = new Map(zoneDiagnostics.zones.map(zone => [zone.name, zone]));
    const requireZone = name => {
      const zone = zonesByName.get(name);
      if (!zone) throw new Error(`required playground zone is missing: ${name}`);
      return zone;
    };
    const sourceShelf = requireZone('source_shelf');
    const spillway = requireZone('spillway');
    if (sourceShelf.averageKineticEnergy < 0.55 || sourceShelf.activeTransportRatio < 0.55) {
      throw new Error(`source-shelf transport fell below the absolute motion floor: ${JSON.stringify(sourceShelf)}`);
    }
    if (spillway.averageKineticEnergy < 0.35 || spillway.activeTransportRatio < 0.4) {
      throw new Error(`spillway transport fell below the absolute motion floor: ${JSON.stringify(spillway)}`);
    }
    const meanZoneEnergy = names => names.reduce((sum, name) => sum + (zonesByName.get(name)?.averageKineticEnergy || 0), 0) / names.length;
    const settledPoolNames = ['shallow_pool', 'deep_pool', 'catch_basin'];
    const settledPools = settledPoolNames.map(requireZone);
    const receivingTransportZones = ['shallow_pool', 'deep_pool', 'obstacle_channel', 'catch_basin']
      .map(requireZone)
      .filter(zone => zone.supportedTransportParticleCount >= 24 && zone.averageSupportedTangentialSpeed >= 0.3);
    if (receivingTransportZones.length < 2) {
      throw new Error(`support-adjacent transport did not spread through two receiving regimes: ${JSON.stringify(receivingTransportZones)}`);
    }
    const quietSupportedPoolCount = settledPools.filter(zone => zone.averageKineticEnergy <= 0.12 && zone.supportedRestingRatio >= 0.12).length;
    if (!compositionRequested && quietSupportedPoolCount < 2) {
      throw new Error(`supported rest did not become local and quiet in at least two pools: ${JSON.stringify(settledPools)}`);
    }
    const settledPoolAverageEnergy = meanZoneEnergy(settledPoolNames);
    const activeTransportAverageEnergy = meanZoneEnergy(['source_shelf', 'spillway']);
    if (!Number.isFinite(settledPoolAverageEnergy) || !Number.isFinite(activeTransportAverageEnergy) || activeTransportAverageEnergy <= settledPoolAverageEnergy * 4) {
      throw new Error(`rest-state relaxation did not separate supported pools from active transport: ${JSON.stringify({ settledPoolAverageEnergy, activeTransportAverageEnergy })}`);
    }
    const interfaceCarrier = lastDebugState.runtime?.interfaceCarrier;
    if (interfaceCarrier?.schema !== 'kaminos.liquid-interface-carrier.v0') throw new Error(`interface carrier schema mismatch: ${interfaceCarrier?.schema}`);
    if (interfaceCarrier.capacity !== lastDebugState.runtime.particleCount) throw new Error(`hidden interface capacity cap rejected: ${JSON.stringify(interfaceCarrier)}`);
    if (interfaceCarrier.candidateCapMode !== 'uncapped_exact_particle_population_capacity') throw new Error(`interface candidate cap identity mismatch: ${interfaceCarrier.candidateCapMode}`);
    if (interfaceCarrier.overflowCount !== 0) throw new Error(`interface compaction overflowed: ${JSON.stringify(interfaceCarrier)}`);
    if (!Number.isSafeInteger(interfaceCarrier.activeCount) || interfaceCarrier.activeCount < 64 || interfaceCarrier.activeCount >= interfaceCarrier.capacity) {
      throw new Error(`interface carrier population is empty or swallowed the volume: ${JSON.stringify(interfaceCarrier)}`);
    }
    if (interfaceCarrier.validatedRecordCount !== interfaceCarrier.activeCount) throw new Error(`interface carrier population was not completely validated: ${JSON.stringify(interfaceCarrier)}`);
    if (interfaceCarrier.malformedRecordCount !== 0) throw new Error(`interface carrier contains malformed records: ${JSON.stringify(interfaceCarrier)}`);
    if (interfaceCarrier.contactRecordCount < 64) throw new Error(`interface carrier lacks material contact coverage: ${JSON.stringify(interfaceCarrier)}`);
    if (interfaceCarrier.minimumContactSupportAlignment < -0.001) throw new Error(`interface carrier contains a support-facing contact normal: ${JSON.stringify(interfaceCarrier)}`);
    const liquidFireContactDescriptor = lastDebugState.runtime?.liquidFireContactDescriptor;
    if (liquidFireContactDescriptor?.schema !== 'kaminos.liquid-fire-contact-descriptor.v1') throw new Error(`liquid/fire contact descriptor schema mismatch: ${liquidFireContactDescriptor?.schema}`);
    if (!liquidFireContactDescriptor.valid || !liquidFireContactDescriptor.complete) throw new Error(`liquid/fire contact descriptor was not sealed: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.capacity !== lastDebugState.runtime.particleCount || liquidFireContactDescriptor.candidateCapMode !== 'uncapped_exact_particle_population_capacity') throw new Error(`liquid/fire contact capacity is capped or misidentified: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.overflowCount !== 0) throw new Error(`liquid/fire contact descriptor overflowed: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.malformedCount !== 0) throw new Error(`liquid/fire contact descriptor contains malformed source records: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.sourceCount !== liquidFireContactDescriptor.packedCount + liquidFireContactDescriptor.rejectedCount) throw new Error(`liquid/fire contact accounting mismatch: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.sourceCount !== interfaceCarrier.activeCount) throw new Error(`public contact source count does not reconcile with dense interface carrier: ${JSON.stringify({ liquidFireContactDescriptor, interfaceCarrier })}`);
    if (liquidFireContactDescriptor.contactCount !== interfaceCarrier.contactRecordCount) throw new Error(`public contact count does not reconcile with dense contact census: ${JSON.stringify({ liquidFireContactDescriptor, interfaceCarrier })}`);
    if (liquidFireContactDescriptor.packedCount !== liquidFireContactDescriptor.contactCount) throw new Error(`source-space packing rejected real liquid contacts: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (liquidFireContactDescriptor.writeTick > liquidFireContactDescriptor.diagnosticsStepCount || liquidFireContactDescriptor.writeTick < liquidFireContactDescriptor.diagnosticsStepCount - 1) throw new Error(`liquid/fire contact write tick is stale or impossible: ${JSON.stringify(liquidFireContactDescriptor)}`);
    if (!Array.isArray(interfaceCarrier.sampleRecords) || interfaceCarrier.sampleRecords.length < 4) throw new Error(`interface carrier sampleRecords missing: ${JSON.stringify(interfaceCarrier)}`);
    const sampleIds = new Set();
    for (const record of interfaceCarrier.sampleRecords) {
      if (!Number.isSafeInteger(record.particleId) || sampleIds.has(record.particleId)) throw new Error(`interface record stable id is malformed or duplicated: ${JSON.stringify(record)}`);
      sampleIds.add(record.particleId);
      if (![...(record.position || []), ...(record.velocity || []), ...(record.normal || []), record.confidence, record.curvature, record.thickness, record.contact, record.wetness, record.material, record.stability, record.ageSeconds, record.sourceFrame, record.supportAlignment].every(Number.isFinite)) {
        throw new Error(`interface record contains non-finite fields: ${JSON.stringify(record)}`);
      }
      const normalLength = Math.hypot(...record.normal);
      if (normalLength < 0.8 || normalLength > 1.2 || record.confidence < 0.3 || record.confidence > 1.001 || record.thickness <= 0) {
        throw new Error(`interface geometry record is not physically legible: ${JSON.stringify(record)}`);
      }
      if (record.contact >= 0.5 && record.supportAlignment < -0.001) throw new Error(`contact interface sample normal points into support geometry: ${JSON.stringify(record)}`);
    }
    const restDensity = lastDebugState.runtime?.restDensity;
    const averageDensity = lastDebugState.runtime?.diagnostics?.averageDensity;
    const relativeDensityError = Math.abs(averageDensity - restDensity) / Math.max(0.001, restDensity);
    if (!Number.isFinite(relativeDensityError) || relativeDensityError > 0.35) throw new Error(`density basin mismatch: ${JSON.stringify({ averageDensity, restDensity, relativeDensityError })}`);
    if (activeExtent3d.size[0] > 4.66 && activeExtent3d.size[2] > 4.66 && lastDebugState.runtime.diagnostics.averageSpeed > 1.2) {
      throw new Error(`energetic fluid saturated the full horizontal domain: ${JSON.stringify(activeExtent3d)}`);
    }

    phase = 'measure_canvas';
    const canvasRect = await evaluate(ws, `(() => {
      const canvas = document.getElementById('finger-fluid-bench-canvas');
      if (!canvas || !canvas.width || !canvas.height) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    if (!canvasRect || canvasRect.width < 100 || canvasRect.height < 100) throw new Error(`canvas unavailable: ${JSON.stringify(canvasRect)}`);
    const canvasScreenshot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { ...canvasRect, scale: 1 },
    });
    mkdirSync(dirname(canvasOut), { recursive: true });
    writeFileSync(canvasOut, Buffer.from(canvasScreenshot.data, 'base64'));
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', canvasOut, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
      encoding: null,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (decoded.status !== 0 || !decoded.stdout?.length) throw new Error(`ffmpeg canvas decode failed: ${decoded.stderr?.toString() || decoded.status}`);
    let activePixels = 0;
    let supportPixels = 0;
    for (let i = 0; i < decoded.stdout.length; i += 3) {
      const r = decoded.stdout[i];
      const g = decoded.stdout[i + 1];
      const b = decoded.stdout[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 66 && max - min > 18) activePixels += 1;
      if (g > 28 && r > 20 && b > 20 && g > r * 1.03 && g >= b * 0.98 && b >= r * 0.95 && max < 130) supportPixels += 1;
    }
    const pixelCount = Math.floor(decoded.stdout.length / 3);
    canvasActivity = {
      ok: true,
      width: Math.round(canvasRect.width),
      height: Math.round(canvasRect.height),
      activePixels,
      activeRatio: Number((activePixels / Math.max(1, pixelCount)).toFixed(5)),
      supportPixels,
      supportPixelRatio: Number((supportPixels / Math.max(1, pixelCount)).toFixed(5)),
      measurement: 'captured_webgpu_canvas_ffmpeg_rgb24_v0',
    };
    const refractionActivityAccepted = requestedRendererMode === 'screen_space_refraction'
      && canvasActivity.activeRatio >= 0.01
      && canvasActivity.supportPixelRatio >= 0.07;
    if (canvasActivity.activeRatio < 0.09 && !refractionActivityAccepted) throw new Error(`native GPU fluid bench too sparse: ${JSON.stringify(canvasActivity)}`);
    if (canvasActivity.supportPixelRatio < 0.025) throw new Error(`shared playground support is not materially visible: ${JSON.stringify(canvasActivity)}`);

    phase = 'same_state_renderer_comparison';
    const rendererFreezeReceipt = await evaluate(ws, `(() => {
      const render = window.kaminosFingerFluidBenchRenderCurrentStateForWitness;
      if (typeof render !== 'function') throw new Error('pre-output failure: missing same-state renderer witness hook');
      return render(${JSON.stringify(requestedRendererMode)}, ${JSON.stringify(requestedOpticalDebugMode)});
    })()`);
    const rendererCountersBefore = rendererFreezeReceipt ? {
      stepCount: rendererFreezeReceipt.stepCount,
      sphereDebugRenderFrameCount: rendererFreezeReceipt.sphereDebugRenderFrameCount,
      screenSpaceSurfaceRenderFrameCount: rendererFreezeReceipt.screenSpaceSurfaceRenderFrameCount,
      screenSpaceRefractionRenderFrameCount: rendererFreezeReceipt.screenSpaceRefractionRenderFrameCount,
    } : null;
    if (!rendererCountersBefore) throw new Error('missing pre-comparison renderer counters');
    const renderSameState = async (
      mode,
      path,
      captureRect = canvasRect,
      opticalDebugMode = 'shaded',
      minimumActiveRatio = 0.05,
    ) => {
      const receipt = await evaluate(ws, `(() => {
        const render = window.kaminosFingerFluidBenchRenderCurrentStateForWitness;
        if (typeof render !== 'function') throw new Error('pre-output failure: missing same-state renderer witness hook');
        return render(${JSON.stringify(mode)}, ${JSON.stringify(opticalDebugMode)});
      })()`);
      if (receipt.requestedRendererMode !== mode || receipt.effectiveRendererMode !== mode || receipt.fallbackReason) {
        throw new Error(`renderer disagreement during same-state comparison: ${JSON.stringify(receipt)}`);
      }
      if (receipt.requestedOpticalDebugMode !== opticalDebugMode || receipt.effectiveOpticalDebugMode !== opticalDebugMode) {
        throw new Error(`optical renderer disagreement during same-state comparison: ${JSON.stringify(receipt)}`);
      }
      requireSharedSupportPresentation(receipt, `${mode}:${opticalDebugMode}`);
      requireLinearHdrWorldClosure(receipt, `${mode}:${opticalDebugMode}`);
      requireDeferredWorldReflectionEvidence(receipt, `${mode}:${opticalDebugMode}`, mode === 'screen_space_refraction');
      const shot = await wsRequest(ws, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { ...captureRect, scale: 1 },
      });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(shot.data, 'base64'));
      const activity = measureCapturedPng(path, mode);
      if (mode === 'screen_space_surface' && activity.activeRatio < minimumActiveRatio) {
        throw new Error(`blank reconstructed-surface output rejected: ${JSON.stringify(activity)}`);
      }
      if (mode === 'sphere_debug' && activity.activeRatio < minimumActiveRatio) {
        throw new Error(`blank sphere-debug output rejected: ${JSON.stringify(activity)}`);
      }
      if (mode === 'screen_space_refraction' && opticalDebugMode === 'shaded' && activity.activeRatio < minimumActiveRatio) {
        throw new Error(`blank refraction output rejected: ${JSON.stringify(activity)}`);
      }
      return { receipt, activity };
    };
    const sphereDebug = await renderSameState('sphere_debug', sphereDebugOut);
    const screenSpaceSurface = await renderSameState('screen_space_surface', screenSpaceSurfaceOut);
    const screenSpaceRefraction = await renderSameState('screen_space_refraction', screenSpaceRefractionOut);
    const refractionVisualDelta = measureCapturedPngDelta(screenSpaceSurfaceOut, screenSpaceRefractionOut, 'surface_to_refraction');
    if (refractionVisualDelta.changedRatio < 0.025 || refractionVisualDelta.meanAbsoluteChannelDelta < 1.5) {
      throw new Error(`refraction output is visually indistinguishable from the un-refracted surface: ${JSON.stringify(refractionVisualDelta)}`);
    }
    screenSpaceSurfaceEvidence = screenSpaceSurface.receipt.screenSpaceSurfaceEvidence;
    refractionEvidence = screenSpaceRefraction.receipt.refractionEvidence;
    if (
      screenSpaceSurfaceEvidence?.accumulationTexture?.format !== 'rgba16float'
      || screenSpaceSurfaceEvidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
    ) throw new Error(`same-state surface accumulation evidence missing or partial: ${JSON.stringify(screenSpaceSurfaceEvidence)}`);
    if (
      refractionEvidence?.route !== 'webgpu-screen-space-liquid-refraction-v0'
      || refractionEvidence?.opticalTransportRoute !== 'snell-two-interface-screen-space-slab-v0'
      || refractionEvidence?.slabRoute !== 'wgsl-particle-projected-front-back-slab-v0'
      || refractionEvidence?.slabGeometryPassCount < 1
      || refractionEvidence?.frontDepthTexture?.format !== 'rgba16float'
      || refractionEvidence?.frontDepthTexture?.channels?.join('|') !== 'projected_particle_sphere_front_view_depth_min|nearest_particle_center_view_depth_min'
      || refractionEvidence?.backDepthTexture?.format !== 'rgba16float'
      || refractionEvidence?.backDepthTexture?.channel !== 'projected_particle_sphere_back_view_depth_max'
      || refractionEvidence?.accumulationTexture?.format !== 'rgba16float'
      || refractionEvidence?.accumulationTexture?.channels?.join('|') !== 'optical_thickness|material_weighted_thickness|depth_weight|depth_weighted_view_depth_sum'
      || refractionEvidence?.invalidSlabDisposition !== 'entry_interface_only_no_exit_claim_v0'
      || refractionEvidence?.supportDepthRoute !== 'wgsl-analytic-heightfield-obstacle-depth-v0'
      || refractionEvidence?.analyticSupportDepthPassCount < 1
      || refractionEvidence?.opticalDebugMode !== 'shaded'
      || refractionEvidence?.sceneColorTexture?.format !== 'rgba16float'
      || refractionEvidence?.sceneColorTexture?.source !== 'same-camera-linear-hdr-scene-radiance-v0'
      || refractionEvidence?.scenePassCount < 1
      || refractionEvidence?.compositePassCount < 1
    ) throw new Error(`same-state refraction evidence missing or partial: ${JSON.stringify(refractionEvidence)}`);
    if (
      sphereDebug.receipt.sphereDebugRenderFrameCount !== rendererCountersBefore.sphereDebugRenderFrameCount + 1
      || sphereDebug.receipt.screenSpaceSurfaceRenderFrameCount !== rendererCountersBefore.screenSpaceSurfaceRenderFrameCount
      || sphereDebug.receipt.screenSpaceRefractionRenderFrameCount !== rendererCountersBefore.screenSpaceRefractionRenderFrameCount
      || screenSpaceSurface.receipt.sphereDebugRenderFrameCount !== sphereDebug.receipt.sphereDebugRenderFrameCount
      || screenSpaceSurface.receipt.screenSpaceSurfaceRenderFrameCount !== sphereDebug.receipt.screenSpaceSurfaceRenderFrameCount + 1
      || screenSpaceSurface.receipt.screenSpaceRefractionRenderFrameCount !== sphereDebug.receipt.screenSpaceRefractionRenderFrameCount
      || screenSpaceRefraction.receipt.sphereDebugRenderFrameCount !== screenSpaceSurface.receipt.sphereDebugRenderFrameCount
      || screenSpaceRefraction.receipt.screenSpaceSurfaceRenderFrameCount !== screenSpaceSurface.receipt.screenSpaceSurfaceRenderFrameCount
      || screenSpaceRefraction.receipt.screenSpaceRefractionRenderFrameCount !== screenSpaceSurface.receipt.screenSpaceRefractionRenderFrameCount + 1
    ) {
      throw new Error(`route-specific renderer counters crossed modes: ${JSON.stringify({ rendererCountersBefore, sphereDebug: sphereDebug.receipt, screenSpaceSurface: screenSpaceSurface.receipt, screenSpaceRefraction: screenSpaceRefraction.receipt })}`);
    }
    sameStateRendererComparison = {
      schema: 'kaminos.finger-fluid.same-state-renderer-comparison.v0',
      rendererFreezeReceipt,
      stepCount: screenSpaceSurface.receipt.stepCount,
      sameSimulationState: sphereDebug.receipt.stepCount === screenSpaceSurface.receipt.stepCount,
      sphereDebug,
      screenSpaceSurface,
      screenSpaceRefraction,
      refractionVisualDelta,
      visibleDelta: {
        activeRatioDelta: Number((screenSpaceSurface.activity.activeRatio - sphereDebug.activity.activeRatio).toFixed(5)),
        highlightRatioDelta: Number((screenSpaceSurface.activity.highlightRatio - sphereDebug.activity.highlightRatio).toFixed(5)),
      },
    };
    if (!sameStateRendererComparison.sameSimulationState) throw new Error(`same-state renderer comparison stepped the simulation: ${JSON.stringify(sameStateRendererComparison)}`);
    sameStateOpticalComparison = {
      schema: 'kaminos.finger-fluid.same-state-optical-comparison.v0',
      stepCount: screenSpaceRefraction.receipt.stepCount,
      sameSimulationState: sphereDebug.receipt.stepCount === screenSpaceSurface.receipt.stepCount
        && screenSpaceSurface.receipt.stepCount === screenSpaceRefraction.receipt.stepCount,
      sphereDebug,
      screenSpaceSurface,
      screenSpaceRefraction,
      refractionVisualDelta,
      visibleDelta: {
        refractionVsSurfaceActiveRatio: Number((screenSpaceRefraction.activity.activeRatio - screenSpaceSurface.activity.activeRatio).toFixed(5)),
        refractionVsSurfaceHighlightRatio: Number((screenSpaceRefraction.activity.highlightRatio - screenSpaceSurface.activity.highlightRatio).toFixed(5)),
      },
    };
    if (!sameStateOpticalComparison.sameSimulationState) throw new Error(`same-state optical comparison stepped the simulation: ${JSON.stringify(sameStateOpticalComparison)}`);

    phase = 'renderer_resize_recreate';
    const resizedViewport = {
      width: viewportWidth,
      height: viewportHeight >= 720 ? viewportHeight - 140 : viewportHeight + 140,
    };
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      ...resizedViewport,
      deviceScaleFactor,
      mobile: false,
    });
    await delay(160);
    const resizedCanvasRect = await evaluate(ws, `(() => {
      const canvas = document.getElementById('finger-fluid-bench-canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    if (!resizedCanvasRect || resizedCanvasRect.width < 100 || resizedCanvasRect.height < 100) {
      throw new Error(`resized fluid canvas unavailable: ${JSON.stringify(resizedCanvasRect)}`);
    }
    const resizedSurface = await renderSameState('screen_space_surface', resizedSurfaceOut, resizedCanvasRect);
    const initialExtent = screenSpaceSurface.receipt.screenSpaceSurfaceEvidence?.accumulationTexture?.extent;
    const resizedExtent = resizedSurface.receipt.screenSpaceSurfaceEvidence?.accumulationTexture?.extent;
    if (
      !initialExtent
      || !resizedExtent
      || initialExtent === resizedExtent
      || resizedSurface.receipt.stepCount !== screenSpaceSurface.receipt.stepCount
      || resizedSurface.receipt.sphereDebugRenderFrameCount !== screenSpaceSurface.receipt.sphereDebugRenderFrameCount
      || resizedSurface.receipt.screenSpaceSurfaceRenderFrameCount !== screenSpaceSurface.receipt.screenSpaceSurfaceRenderFrameCount + 1
      || resizedSurface.receipt.screenSpaceRefractionRenderFrameCount !== screenSpaceRefraction.receipt.screenSpaceRefractionRenderFrameCount
    ) {
      throw new Error(`renderer resize/recreate evidence mismatch: ${JSON.stringify({ initialExtent, resizedExtent, screenSpaceSurface: screenSpaceSurface.receipt, resizedSurface: resizedSurface.receipt })}`);
    }
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor,
      mobile: false,
    });
    await delay(160);
    const restoredReceipt = await evaluate(ws, `(() => window.kaminosFingerFluidBenchRenderCurrentStateForWitness?.('screen_space_surface', 'shaded'))()`);
    const restoredExtent = restoredReceipt?.screenSpaceSurfaceEvidence?.accumulationTexture?.extent;
    if (
      restoredReceipt?.stepCount !== screenSpaceSurface.receipt.stepCount
      || restoredReceipt?.sphereDebugRenderFrameCount !== resizedSurface.receipt.sphereDebugRenderFrameCount
      || restoredReceipt?.screenSpaceSurfaceRenderFrameCount !== resizedSurface.receipt.screenSpaceSurfaceRenderFrameCount + 1
      || restoredReceipt?.screenSpaceRefractionRenderFrameCount !== resizedSurface.receipt.screenSpaceRefractionRenderFrameCount
      || restoredExtent !== initialExtent
    ) {
      throw new Error(`route-specific renderer counters or restored extent diverged: ${JSON.stringify({ initialExtent, restoredExtent, resizedSurface: resizedSurface.receipt, restoredReceipt })}`);
    }
    rendererResizeWitness = {
      schema: 'kaminos.finger-fluid.renderer-resize-witness.v0',
      sameSimulationState: true,
      stepCount: restoredReceipt.stepCount,
      originalViewport: { width: viewportWidth, height: viewportHeight, canvas: canvasRect },
      resizedViewport: { ...resizedViewport, canvas: resizedCanvasRect },
      initialExtent,
      resizedExtent,
      restoredExtent,
      resizedSurface,
      restoredReceipt,
    };
    phase = 'multi_angle_surface_registration';
    const originalCamera = await evaluate(ws, `window.kaminosFingerFluidCompositionCameraState?.()`);
    if (!originalCamera) throw new Error('missing original camera state for multi-angle surface registration');
    const registrationCameras = [
      { id: 'operator_oblique', yaw: -0.62, pitch: 0.52, distance: 6.2, target: [0, -0.48, 0.2] },
      { id: 'low_side', yaw: -1.35, pitch: 0.08, distance: 7.0, target: [0, -0.48, 0.2] },
      { id: 'opposite_high', yaw: 2.15, pitch: 0.72, distance: 7.0, target: [0, -0.48, 0.2] },
      {
        id: 'support_grazing',
        yaw: -1.35,
        pitch: -0.15,
        distance: 6.4,
        target: [0, -0.48, 0.2],
        minimumShadedActiveRatio: 0.02,
        minimumShadedHighlightRatio: 0.003,
      },
    ];
    const registrationOverlayVisibility = await evaluate(ws, `(() => {
      const overlay = document.getElementById('finger-fluid-bench-overlay');
      const fpsCounter = document.getElementById('fps-counter');
      const previous = {
        overlay: overlay?.style.visibility || '',
        fpsCounter: fpsCounter?.style.visibility || '',
      };
      if (overlay) overlay.style.visibility = 'hidden';
      if (fpsCounter) fpsCounter.style.visibility = 'hidden';
      return previous;
    })()`);
    mkdirSync(surfaceRegistrationDir, { recursive: true });
    surfaceRegistrationViews = [];
    for (const camera of registrationCameras) {
      const effectiveCamera = await evaluate(ws, `window.kaminosFingerFluidBenchSetCameraForWitness?.(${JSON.stringify(camera)})`);
      if (!effectiveCamera) throw new Error(`camera setter unavailable for registration view ${camera.id}`);
      const spherePath = resolve(surfaceRegistrationDir, `${camera.id}.sphere-debug.png`);
      const surfacePath = resolve(surfaceRegistrationDir, `${camera.id}.screen-space-surface.png`);
      const refractionPath = resolve(surfaceRegistrationDir, `${camera.id}.screen-space-refraction-thickness.png`);
      const sphereLiquidSupportPath = resolve(surfaceRegistrationDir, `${camera.id}.sphere-debug-liquid-support.png`);
      const liquidSupportPath = resolve(surfaceRegistrationDir, `${camera.id}.screen-space-refraction-liquid-support.png`);
      const shadedRefractionPath = resolve(surfaceRegistrationDir, `${camera.id}.screen-space-refraction-shaded.png`);
      const sphereRender = await renderSameState('sphere_debug', spherePath, canvasRect, 'shaded', 0.005);
      const sphereLiquidSupportRender = await renderSameState('sphere_debug', sphereLiquidSupportPath, canvasRect, 'liquid_support', 0);
      const sphereLiquidSupportField = measureBinaryLiquidSupport(sphereLiquidSupportPath);
      const surfaceRender = await renderSameState('screen_space_surface', surfacePath, canvasRect, 'shaded', 0.005);
      const refractionRender = await renderSameState('screen_space_refraction', refractionPath, canvasRect, 'thickness', 0.005);
      const liquidSupportRender = await renderSameState('screen_space_refraction', liquidSupportPath, canvasRect, 'liquid_support', 0.005);
      const shadedRefraction = await renderSameState(
        'screen_space_refraction',
        shadedRefractionPath,
        canvasRect,
        'shaded',
        camera.minimumShadedActiveRatio ?? 0.025,
      );
      if (shadedRefraction.activity.highlightRatio < (camera.minimumShadedHighlightRatio ?? 0.001)) {
        throw new Error(`shaded HDR registration lacks a material highlight field at ${camera.id}: ${JSON.stringify({
          activity: shadedRefraction.activity,
          minimumShadedHighlightRatio: camera.minimumShadedHighlightRatio ?? 0.001,
        })}`);
      }
      if (
        sphereRender.receipt.stepCount !== surfaceRender.receipt.stepCount
        || sphereRender.receipt.stepCount !== sphereLiquidSupportRender.receipt.stepCount
        || sphereRender.receipt.stepCount !== refractionRender.receipt.stepCount
        || sphereRender.receipt.stepCount !== liquidSupportRender.receipt.stepCount
        || sphereRender.receipt.stepCount !== shadedRefraction.receipt.stepCount
      ) {
        throw new Error(`registration view ${camera.id} advanced the simulation between renderers`);
      }
      const sphereProjection = measureFluidProjection(spherePath, `${camera.id}:sphere_debug`);
      const surfaceProjection = measureFluidProjection(surfacePath, `${camera.id}:screen_space_surface`);
      const refractionProjection = measureFluidProjection(refractionPath, `${camera.id}:screen_space_refraction:thickness`, 'optical_thickness');
      const surfaceComparison = compareFluidProjections(sphereProjection, surfaceProjection);
      const refractionComparison = compareFluidProjections(sphereProjection, refractionProjection);
      const sharedSupportIdentity = measureSharedSupportIdentity(
        spherePath,
        surfacePath,
        refractionPath,
        sphereLiquidSupportPath,
        liquidSupportPath,
        camera.id,
      );
      if (surfaceComparison.normalizedCentroidDistance > 0.12 || surfaceComparison.minimumBoundsOverlap < 0.35) {
        throw new Error(`surface registration mismatch at ${camera.id}: ${JSON.stringify(surfaceComparison)}`);
      }
      if (refractionComparison.normalizedCentroidDistance > 0.12 || refractionComparison.minimumBoundsOverlap < 0.35) {
        throw new Error(`refraction registration mismatch at ${camera.id}: ${JSON.stringify(refractionComparison)}`);
      }
      if (sharedSupportIdentity.mismatchRatio > 0.002 || sharedSupportIdentity.meanAbsoluteChannelDelta > 0.25) {
        throw new Error(`shared support presentation mismatch at ${camera.id}: ${JSON.stringify(sharedSupportIdentity)}`);
      }
      surfaceRegistrationViews.push({
        camera: effectiveCamera,
        stepCount: surfaceRender.receipt.stepCount,
        sphereProjection,
        surfaceProjection,
        refractionProjection,
        surfaceComparison,
        refractionComparison,
        sphereLiquidSupportField,
        sharedSupportIdentity,
        shadedRefraction: {
          path: shadedRefractionPath,
          receipt: shadedRefraction.receipt,
          activity: shadedRefraction.activity,
          acceptance: {
            minimumActiveRatio: camera.minimumShadedActiveRatio ?? 0.025,
            minimumHighlightRatio: camera.minimumShadedHighlightRatio ?? 0.001,
          },
        },
      });
    }
    await evaluate(ws, `(() => {
      const overlay = document.getElementById('finger-fluid-bench-overlay');
      const fpsCounter = document.getElementById('fps-counter');
      if (overlay) overlay.style.visibility = ${JSON.stringify(registrationOverlayVisibility?.overlay || '')};
      if (fpsCounter) fpsCounter.style.visibility = ${JSON.stringify(registrationOverlayVisibility?.fpsCounter || '')};
      return true;
    })()`);
    await evaluate(ws, `window.kaminosFingerFluidBenchSetCameraForWitness?.(${JSON.stringify(originalCamera)})`);
    await evaluate(ws, `window.kaminosFingerFluidBenchRenderCurrentStateForWitness?.('screen_space_surface', 'shaded')`);

    phase = 'same_state_optical_debug_views';
    const opticalOverlayVisibility = await evaluate(ws, `(() => {
      const overlay = document.getElementById('finger-fluid-bench-overlay');
      const fpsCounter = document.getElementById('fps-counter');
      const previous = {
        overlay: overlay?.style.visibility || '',
        fpsCounter: fpsCounter?.style.visibility || '',
      };
      if (overlay) overlay.style.visibility = 'hidden';
      if (fpsCounter) fpsCounter.style.visibility = 'hidden';
      return previous;
    })()`);
    opticalDebugViews = {};
    let previousOpticalDebugMode = null;
    for (const opticalDebugMode of opticalDebugModes) {
      const capture = await renderSameState(
        'screen_space_refraction',
        opticalDebugOutputs[opticalDebugMode],
        canvasRect,
        opticalDebugMode,
      );
      if (
        capture.receipt.refractionEvidence?.opticalDebugMode !== opticalDebugMode
        || capture.receipt.refractionEvidence?.route !== 'webgpu-screen-space-liquid-refraction-v0'
        || capture.receipt.refractionEvidence?.opticalTransportRoute !== 'snell-two-interface-screen-space-slab-v0'
        || capture.receipt.refractionEvidence?.slabRoute !== 'wgsl-particle-projected-front-back-slab-v0'
        || capture.receipt.refractionEvidence?.slabGeometryPassCount < 1
        || capture.receipt.refractionEvidence?.frontDepthTexture?.format !== 'rgba16float'
        || capture.receipt.refractionEvidence?.backDepthTexture?.format !== 'rgba16float'
        || capture.receipt.refractionEvidence?.invalidSlabDisposition !== 'entry_interface_only_no_exit_claim_v0'
        || capture.receipt.refractionEvidence?.supportDepthRoute !== 'wgsl-analytic-heightfield-obstacle-depth-v0'
        || capture.receipt.refractionEvidence?.analyticSupportDepthPassCount < 1
      ) throw new Error(`optical debug view route evidence mismatch: ${JSON.stringify({ opticalDebugMode, receipt: capture.receipt })}`);
      const visualDeltaFromShaded = measureCapturedPngDelta(
        screenSpaceRefractionOut,
        opticalDebugOutputs[opticalDebugMode],
        `shaded_to_${opticalDebugMode}`,
      );
      if (visualDeltaFromShaded.changedRatio < 0.02 || visualDeltaFromShaded.meanAbsoluteChannelDelta < 1) {
        throw new Error(`optical debug view collapsed to shaded refraction: ${JSON.stringify({ opticalDebugMode, visualDeltaFromShaded })}`);
      }
      const visualDeltaFromPreviousDebug = previousOpticalDebugMode
        ? measureCapturedPngDelta(
          opticalDebugOutputs[previousOpticalDebugMode],
          opticalDebugOutputs[opticalDebugMode],
          `${previousOpticalDebugMode}_to_${opticalDebugMode}`,
        )
        : null;
      if (
        visualDeltaFromPreviousDebug
        && (visualDeltaFromPreviousDebug.changedRatio < 0.01 || visualDeltaFromPreviousDebug.meanAbsoluteChannelDelta < 0.5)
      ) {
        throw new Error(`neighboring optical debug views collapsed to one output: ${JSON.stringify({ previousOpticalDebugMode, opticalDebugMode, visualDeltaFromPreviousDebug })}`);
      }
      opticalDebugViews[opticalDebugMode] = {
        ...capture,
        visualDeltaFromShaded,
        visualDeltaFromPreviousDebug,
      };
      if (opticalDebugMode === 'exit_validity') {
        slabValidityField = measureSlabValidityField(opticalDebugOutputs[opticalDebugMode]);
      }
      previousOpticalDebugMode = opticalDebugMode;
    }
    binaryLiquidSupportField = measureBinaryLiquidSupport(opticalDebugOutputs.liquid_support);
    environmentMapField = measureHdrEnvironmentField(opticalDebugOutputs.environment, opticalDebugOutputs.liquid_support);
    if (
      environmentMapField.brightRatio < 0.05
      || environmentMapField.shadowRatio < 0.1
      || environmentMapField.midtoneRatio < 0.03
      || environmentMapField.luminanceP95 - environmentMapField.luminanceP05 < 100
    ) {
      throw new Error(`HDR environment diagnostic is blank, partial, or materially dark: ${JSON.stringify(environmentMapField)}`);
    }
    reflectionHitKindField = measureReflectionHitKinds(
      opticalDebugOutputs.reflection_hit_kind,
      opticalDebugOutputs.liquid_support,
    );
    if (reflectionHitKindField.environmentPixels < 1000 || reflectionHitKindField.indexedMeshPixels < 500) {
      throw new Error(`reflection hit-kind field does not materially expose environment plus indexed mesh visibility: ${JSON.stringify(reflectionHitKindField)}`);
    }
    environmentContributionField = measureEnvironmentContributionField(
      opticalDebugOutputs.environment_contribution,
      opticalDebugOutputs.liquid_support,
    );
    if (environmentContributionField.contributionRatio < 0.05 || environmentContributionField.luminanceP95 < 10) {
      throw new Error(`production-quadrature HDR environment contribution is blank or materially absent: ${JSON.stringify(environmentContributionField)}`);
    }
    const directEnvironmentAlias = measureBinarySupportMaskedRgb24Delta(
      opticalDebugOutputs.environment,
      opticalDebugOutputs.environment,
      opticalDebugOutputs.liquid_support,
      'intentional_direct_environment_as_production_contribution_alias',
    );
    let directEnvironmentAliasError = null;
    try {
      requireHdrProductionContributionDistinct(directEnvironmentAlias);
    } catch (error) {
      directEnvironmentAliasError = error.message || String(error);
    }
    if (!directEnvironmentAliasError) {
      throw new Error(`environment contribution alias probe failed to reject direct diagnostic substitution: ${JSON.stringify(directEnvironmentAlias)}`);
    }
    environmentContributionAliasProbe = {
      schema: 'kaminos.hdr-environment-contribution-alias-probe.v0',
      rawEnvironmentPath: opticalDebugOutputs.environment,
      substitutedContributionPath: opticalDebugOutputs.environment,
      maskPath: opticalDebugOutputs.liquid_support,
      rejected: true,
      rejection: directEnvironmentAliasError,
      delta: directEnvironmentAlias,
    };
    environmentContributionDistinctness = measureBinarySupportMaskedRgb24Delta(
      opticalDebugOutputs.environment,
      opticalDebugOutputs.environment_contribution,
      opticalDebugOutputs.liquid_support,
      'raw_environment_vs_production_quadrature_fresnel_contribution',
    );
    requireHdrProductionContributionDistinct(environmentContributionDistinctness);

    phase = 'frozen_state_world_reflection';
    const setReflectionPhase = async phaseValue => evaluate(ws, `(() => {
      const setPhase = window.kaminosFingerFluidBenchSetReflectionMeshPhaseForWitness;
      if (typeof setPhase !== 'function') throw new Error('pre-output failure: missing reflection mesh transform witness hook');
      return setPhase(${JSON.stringify(phaseValue)});
    })()`);
    const phaseATransform = await setReflectionPhase(0.0);
    const liquidSupportPhaseA = await renderSameState('screen_space_refraction', liquidSupportPhaseAOut, canvasRect, 'liquid_support', 0.005);
    const phaseA = await renderSameState('screen_space_refraction', reflectionPhaseAOut, canvasRect, 'reflection');
    const phaseBTransform = await setReflectionPhase(1.45);
    const liquidSupportPhaseB = await renderSameState('screen_space_refraction', liquidSupportPhaseBOut, canvasRect, 'liquid_support', 0.005);
    const phaseB = await renderSameState('screen_space_refraction', reflectionPhaseBOut, canvasRect, 'reflection');
    const liquidSupportIndependence = measureCapturedPngDelta(
      liquidSupportPhaseAOut,
      liquidSupportPhaseBOut,
      'frozen_liquid_support_across_dynamic_reflection_mesh_motion',
    );
    if (liquidSupportIndependence.changedPixels !== 0 || liquidSupportIndependence.meanAbsoluteChannelDelta !== 0) {
      throw new Error(`dynamic reflection mesh contaminated authoritative liquid support: ${JSON.stringify(liquidSupportIndependence)}`);
    }
    const maskedVisualDelta = measureBinarySupportMaskedRgb24Delta(
      reflectionPhaseAOut,
      reflectionPhaseBOut,
      opticalDebugOutputs.liquid_support,
      'dynamic_indexed_mesh_world_reflection',
    );
    if (
      phaseATransform.stepCount !== phaseBTransform.stepCount
      || phaseA.receipt.stepCount !== phaseB.receipt.stepCount
      || liquidSupportPhaseA.receipt.stepCount !== liquidSupportPhaseB.receipt.stepCount
      || phaseA.receipt.stepCount !== phaseATransform.stepCount
    ) throw new Error(`frozen-state reflection witness advanced the simulation: ${JSON.stringify({ phaseATransform, phaseBTransform, phaseA: phaseA.receipt, phaseB: phaseB.receipt })}`);
    if (
      phaseA.receipt.worldSpaceReflectionEvidence?.dynamicMeshTransformGeneration !== phaseATransform.transformGeneration
      || phaseB.receipt.worldSpaceReflectionEvidence?.dynamicMeshTransformGeneration !== phaseBTransform.transformGeneration
      || phaseA.receipt.worldSpaceReflectionEvidence?.dynamicMeshPhase !== phaseATransform.phase
      || phaseB.receipt.worldSpaceReflectionEvidence?.dynamicMeshPhase !== phaseBTransform.phase
      || phaseA.receipt.worldSpaceReflectionEvidence?.dynamicMeshPresentationMode !== 'suppressed_in_reflection_debug_provider_remains_active_v0'
      || phaseB.receipt.worldSpaceReflectionEvidence?.dynamicMeshPresentationMode !== 'suppressed_in_reflection_debug_provider_remains_active_v0'
    ) throw new Error(`reflection transform evidence is stale or substituted: ${JSON.stringify({ phaseATransform, phaseBTransform, phaseA: phaseA.receipt, phaseB: phaseB.receipt })}`);
    if (maskedVisualDelta.changedRatio < 0.002 || maskedVisualDelta.meanAbsoluteChannelDelta < 0.12) {
      throw new Error(`moving indexed mesh produced no material reflection delta inside frozen liquid: ${JSON.stringify(maskedVisualDelta)}`);
    }
    frozenStateWorldReflectionWitness = {
      schema: 'kaminos.finger-fluid.frozen-state-world-reflection-witness.v0',
      sameSimulationState: true,
      sameCamera: true,
      maskSource: opticalDebugOutputs.liquid_support,
      phaseATransform,
      phaseBTransform,
      liquidSupportPhaseA,
      liquidSupportPhaseB,
      phaseA,
      phaseB,
      liquidSupportIndependence,
      maskedVisualDelta,
    };
    await setReflectionPhase(0.36);
    await evaluate(ws, `(() => {
      const overlay = document.getElementById('finger-fluid-bench-overlay');
      const fpsCounter = document.getElementById('fps-counter');
      if (overlay) overlay.style.visibility = ${JSON.stringify(opticalOverlayVisibility?.overlay || '')};
      if (fpsCounter) fpsCounter.style.visibility = ${JSON.stringify(opticalOverlayVisibility?.fpsCounter || '')};
      return true;
    })()`);

    phase = 'bind_primary_requested_route';
    const primaryRouteCanvas = await renderSameState(
      requestedRendererMode,
      primaryRouteCanvasOut,
      canvasRect,
      requestedOpticalDebugMode,
    );
    if (
      primaryRouteCanvas.receipt.requestedRendererMode !== requestedRendererMode
      || primaryRouteCanvas.receipt.effectiveRendererMode !== requestedRendererMode
      || primaryRouteCanvas.receipt.requestedOpticalDebugMode !== requestedOpticalDebugMode
      || primaryRouteCanvas.receipt.effectiveOpticalDebugMode !== requestedOpticalDebugMode
      || primaryRouteCanvas.receipt.fallbackReason
      || primaryRouteCanvas.receipt.stepCount !== sameStateOpticalComparison.stepCount
    ) {
      throw new Error(`primary screenshot renderer disagreement: ${JSON.stringify({ requestedRendererMode, requestedOpticalDebugMode, receipt: primaryRouteCanvas.receipt })}`);
    }
    primaryFrameBinding = {
      schema: 'kaminos.finger-fluid.primary-frame-binding.v0',
      requestedRendererMode,
      effectiveRendererMode: primaryRouteCanvas.receipt.effectiveRendererMode,
      requestedOpticalDebugMode,
      effectiveOpticalDebugMode: primaryRouteCanvas.receipt.effectiveOpticalDebugMode,
      stepCount: primaryRouteCanvas.receipt.stepCount,
      sameSimulationState: true,
      canvasOut: primaryRouteCanvasOut,
      canvasActivity: primaryRouteCanvas.activity,
      receipt: primaryRouteCanvas.receipt,
    };

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
    primaryFrameBinding.output = out;

    await evaluate(ws, `(() => { window.kaminosFingerFluidBenchResumeAfterWitness?.(); return true; })()`);

    phase = 'cadence_probe';
    const cadenceBefore = {
      stepCount: lastDebugState.runtime.stepCount,
      directRenderFrameCount: lastDebugState.runtime.directRenderFrameCount,
      diagnosticsRequestCount: lastDebugState.runtime.diagnosticsRequestCount,
    };
    const cadenceStartedAt = performance.now();
    await delay(cadenceMs);
    const cadenceState = await evaluate(ws, `(() => {
      const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
      return typeof read === 'function' ? read() : null;
    })()`);
    const cadenceElapsedMs = performance.now() - cadenceStartedAt;
    cadenceProbe = {
      elapsedMs: Number(cadenceElapsedMs.toFixed(1)),
      deltaSteps: cadenceState.runtime.stepCount - cadenceBefore.stepCount,
      deltaRenderFrames: cadenceState.runtime.directRenderFrameCount - cadenceBefore.directRenderFrameCount,
      deltaDiagnosticsRequests: cadenceState.runtime.diagnosticsRequestCount - cadenceBefore.diagnosticsRequestCount,
      framesPerSecond: Number(((cadenceState.runtime.directRenderFrameCount - cadenceBefore.directRenderFrameCount) * 1000 / cadenceElapsedMs).toFixed(2)),
    };
    lastDebugState = cadenceState;
    if (cadenceProbe.deltaDiagnosticsRequests !== 0) throw new Error(`cadence window scheduled recurring full diagnostics: ${JSON.stringify(cadenceProbe)}`);
    if (cadenceProbe.framesPerSecond < 18) throw new Error(`settled GPU fluid cadence below floor: ${JSON.stringify(cadenceProbe)}`);

    phase = 'final_diagnostics_refresh';
    finalDiagnosticsReceipt = await evaluate(ws, `(async () => {
      const request = window.kaminosFingerFluidBenchRequestDiagnostics;
      if (typeof request !== 'function') throw new Error('missing explicit finger fluid diagnostics hook');
      return request();
    })()`);
    const finalDiagnosticsDeadline = Date.now() + 5000;
    while (Date.now() < finalDiagnosticsDeadline) {
      lastDebugState = await evaluate(ws, `(() => {
        const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
        return typeof read === 'function' ? read() : null;
      })()`);
      if (
        lastDebugState?.runtime?.diagnosticsRequestCount === finalDiagnosticsReceipt?.diagnosticsRequestCount
        && lastDebugState?.runtime?.diagnosticsCompletionCount === finalDiagnosticsReceipt?.diagnosticsCompletionCount
      ) break;
      await delay(50);
    }
    if (
      finalDiagnosticsReceipt?.diagnosticsRequestCount !== explicitDiagnosticsReceipt?.diagnosticsRequestCount + 1
      || lastDebugState?.runtime?.diagnosticsRequestCount !== finalDiagnosticsReceipt?.diagnosticsRequestCount
      || lastDebugState?.runtime?.diagnosticsCompletionCount !== finalDiagnosticsReceipt?.diagnosticsCompletionCount
    ) {
      throw new Error(`final explicit diagnostics are missing, partial, or duplicated: ${JSON.stringify({ explicitDiagnosticsReceipt, finalDiagnosticsReceipt, runtime: lastDebugState?.runtime })}`);
    }
    const finalDiagnosticsLagSteps = lastDebugState.runtime.stepCount - lastDebugState.runtime.diagnostics?.stepCount;
    const finalDiagnosticsAgeMs = lastDebugState.runtime.diagnostics?.ageMs;
    if (
      !Number.isInteger(finalDiagnosticsLagSteps)
      || finalDiagnosticsLagSteps < 0
      || finalDiagnosticsLagSteps > FINAL_DIAGNOSTICS_MAX_LAG_STEPS
      || !Number.isFinite(finalDiagnosticsAgeMs)
      || finalDiagnosticsAgeMs > 3000
    ) {
      throw new Error(`final published GPU diagnostics are stale: ${JSON.stringify({ finalDiagnosticsAgeMs, finalDiagnosticsLagSteps, finalDiagnosticsReceipt, stepCount: lastDebugState.runtime.stepCount, diagnosticsStepCount: lastDebugState.runtime.diagnostics?.stepCount })}`);
    }

    phase = 'invalid_renderer_route';
    const invalidRendererUrl = new URL(url);
    invalidRendererUrl.searchParams.set('finger_fluid_renderer', 'fallback');
    await wsRequest(ws, 'Page.navigate', { url: invalidRendererUrl.href });
    const invalidRendererDeadline = Date.now() + hookWaitMs;
    let invalidState = null;
    while (Date.now() < invalidRendererDeadline) {
      try {
        invalidState = await evaluate(ws, `(() => {
          const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
          return typeof read === 'function' ? read() : null;
        })()`);
      } catch {
        invalidState = null;
      }
      if (invalidState?.schema === 'kaminos.finger-fluid-bench.state.v0' && invalidState.status !== 'loading') break;
      await delay(100);
    }
    if (
      invalidState?.status !== 'error'
      || invalidState?.solver?.backend !== 'config_rejected'
      || invalidState?.renderer?.backend !== 'config_rejected'
      || !String(invalidState?.runtime?.configError || '').includes('Unsupported finger fluid renderer mode: fallback')
    ) {
      throw new Error(`invalid renderer route did not fail closed: ${JSON.stringify(invalidState)}`);
    }
    const invalidCanvasRect = await evaluate(ws, `(() => {
      document.getElementById('finger-fluid-bench-overlay')?.setAttribute('hidden', '');
      const canvas = document.getElementById('finger-fluid-bench-canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    if (!invalidCanvasRect || invalidCanvasRect.width < 100 || invalidCanvasRect.height < 100) {
      throw new Error(`invalid renderer canvas unavailable: ${JSON.stringify(invalidCanvasRect)}`);
    }
    const invalidShot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { ...invalidCanvasRect, scale: 1 },
    });
    mkdirSync(dirname(invalidRendererOut), { recursive: true });
    writeFileSync(invalidRendererOut, Buffer.from(invalidShot.data, 'base64'));
    const invalidActivity = measureCapturedPng(invalidRendererOut, 'invalid_renderer');
    if (invalidActivity.activeRatio > 0.002) {
      throw new Error(`invalid renderer route retained stale painted fallback evidence: ${JSON.stringify(invalidActivity)}`);
    }
    invalidRendererWitness = {
      schema: 'kaminos.finger-fluid.invalid-renderer-witness.v0',
      requestedUrl: invalidRendererUrl.href,
      status: invalidState.status,
      solverBackend: invalidState.solver.backend,
      rendererBackend: invalidState.renderer.backend,
      configError: invalidState.runtime.configError,
      canvasActivity: invalidActivity,
      outputPath: invalidRendererOut,
    };

    phase = null;
    writeReport({
      ok: true,
      failure_phase: null,
      output: out,
    });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    writeReport({
      ok: false,
      error: error.message || String(error),
    });
    console.error(error);
    process.exit(1);
  });
