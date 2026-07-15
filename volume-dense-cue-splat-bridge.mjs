#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.dense-cue-splat-bridge.v0';
const INPUT_SCHEMA = 'kaminos.volume.dense-cue-splat-bridge-input.v0';
const APPLICATION_SCHEMA = 'kaminos.volume.dense-cue-pack-sidecar-application.v0';
const EXTERNAL_SOURCE_AUTHORITY = 'externally-uploaded-boundary-sidecar-plus-live-fluid-material-v0';
const ANALYTIC_RENDERER = 'live-boundary-sidecar-analytic-splats-v0';
const LEARNED_RENDERER = 'live-boundary-sidecar-learned-attribute-splats-v0';
const LEARNED_MODEL = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const ROLE_ORDER = ['truthHigh', 'low160to144', 'learned160to144', 'low160to112', 'learned160to112'];
const RENDERER_ORDER = ['analytic', 'learned'];
const FALSE_CLOSURE_GATES = [
  'missing-or-blank-output',
  'requested-effective-renderer-disagreement',
  'controls-signature-disagreement',
  'receiver-controls-disagreement',
  'source-substitution',
  'candidate-overflow',
  'fallback-route',
];

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, true);
  }
}

const outPath = resolve(String(args.get('--out') || '/tmp/kaminos-dense-cue-splat-bridge/manifest.json'));
const outDir = resolve(String(args.get('--out-dir') || dirname(outPath)));
const validateOnly = args.has('--validate-only');
const chunkBytes = Math.max(4096, Math.floor(Number(args.get('--chunk-bytes') || 262144)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const learnedSplatRadius = Number(args.get('--learned-splat-radius') || 1);
const learnedSplatSharpness = Number(args.get('--learned-splat-sharpness') || 3.4);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = String(args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-dense-cue-splat-bridge-profile-'));

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function expectedRendererIdentity(renderer) {
  return renderer === 'learned' ? LEARNED_RENDERER : ANALYTIC_RENDERER;
}

function expectedModelIdentity(renderer) {
  return renderer === 'learned' ? LEARNED_MODEL : null;
}

function roleFromApplication(application, applicationPath, sourceRole, sourceKind, packIdentity) {
  const boundarySidecar = application.roles?.[sourceRole]?.boundarySidecar?.boundary;
  if (!boundarySidecar) throw new Error(`${applicationPath} missing ${sourceRole}.boundarySidecar.boundary`);
  return {
    sourceKind,
    sourceManifestPath: applicationPath,
    sourceManifestSha256: sha256File(applicationPath),
    packIdentity,
    boundarySidecar,
  };
}

function routeFromApplication(application) {
  if (args.get('--url')) return String(args.get('--url'));
  const highManifestPath = application.highFullGridManifest;
  if (!highManifestPath) throw new Error('application has no highFullGridManifest and --url was not supplied');
  const highManifest = readJson(highManifestPath);
  if (!highManifest.url) throw new Error('high full-grid manifest has no URL and --url was not supplied');
  return String(highManifest.url);
}

function buildInputFromApplications() {
  const nearPath = resolve(String(args.get('--near-application') || ''));
  const producerPath = resolve(String(args.get('--producer-application') || ''));
  if (!nearPath || !producerPath) throw new Error('--input or both --near-application and --producer-application are required');
  const near = readJson(nearPath);
  const producer = readJson(producerPath);
  if (near.schema !== APPLICATION_SCHEMA || producer.schema !== APPLICATION_SCHEMA) throw new Error('sidecar application schema mismatch');
  if (near.highGrid !== producer.highGrid) throw new Error('sidecar applications do not share a high grid');
  const replay = near.deterministicReplay;
  const nearPack = `${near.denseCuePackManifest || 'unknown'}#${near.denseCuePackSha256 || 'unknown'}`;
  const producerPack = `${producer.denseCuePackManifest || 'unknown'}#${producer.denseCuePackSha256 || 'unknown'}`;
  return {
    schema: INPUT_SCHEMA,
    frozenState: {
      identity: 'same-replay-material-state-external-sidecar-swap-v0',
      requestedRoute: routeFromApplication(near),
      grid: near.highGrid,
      replay: {
        steps: Number(replay?.steps || 96),
        timeStepMs: Number(replay?.timeStepMs || 1000 / 60),
        startTimeMs: Number(replay?.startTimeMs || 1000),
        controlsSignature: String(replay?.controlsSignature || ''),
      },
      routeIdentity: near.routeIdentity || near.effectiveRoute || null,
      prototypeIdentity: near.prototypeIdentity || null,
      backend: near.backend || null,
    },
    renderers: RENDERER_ORDER,
    roles: {
      truthHigh: roleFromApplication(near, nearPath, 'truthHigh', 'truth-high-boundary-sidecar-control', nearPack),
      low160to144: roleFromApplication(near, nearPath, 'lowUpsampled', 'gap-matched-low-upsampled-control', nearPack),
      learned160to144: roleFromApplication(near, nearPath, 'predictedHigh', 'dense-cue-pack', nearPack),
      low160to112: roleFromApplication(producer, producerPath, 'lowUpsampled', 'gap-matched-low-upsampled-control', producerPack),
      learned160to112: roleFromApplication(producer, producerPath, 'predictedHigh', 'dense-cue-pack', producerPack),
    },
  };
}

function loadInput() {
  if (args.get('--input')) return readJson(resolve(String(args.get('--input'))));
  return buildInputFromApplications();
}

function validateInput(input) {
  if (input.schema !== INPUT_SCHEMA) throw new Error(`input schema mismatch: ${input.schema}`);
  if (!input.frozenState?.requestedRoute || !Number.isFinite(Number(input.frozenState?.grid))) throw new Error('frozenState route/grid missing');
  if (!input.frozenState?.replay) throw new Error('frozenState replay missing');
  if (!input.frozenState.replay.controlsSignature) throw new Error('frozenState replay controls signature missing');
  if (JSON.stringify(input.renderers) !== JSON.stringify(RENDERER_ORDER)) throw new Error('renderer order mismatch');
  const expectedBytes = Number(input.frozenState.grid) ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT;
  const roles = {};
  for (const roleName of ROLE_ORDER) {
    const role = input.roles?.[roleName];
    if (!role) throw new Error(`missing role ${roleName}`);
    const sourceManifestPath = resolve(String(role.sourceManifestPath || ''));
    const boundaryPath = resolve(String(role.boundarySidecar?.path || ''));
    const sourceManifestSha256 = sha256File(sourceManifestPath);
    if (sourceManifestSha256 !== role.sourceManifestSha256) throw new Error(`${roleName} source manifest sha256 mismatch`);
    const boundaryBytes = readFileSync(boundaryPath);
    const boundarySidecarSha256 = sha256Bytes(boundaryBytes);
    if (boundaryBytes.byteLength !== Number(role.boundarySidecar?.byteLength)) throw new Error(`${roleName} boundary sidecar byte length mismatch`);
    if (boundaryBytes.byteLength !== expectedBytes) throw new Error(`${roleName} boundary sidecar grid byte length mismatch`);
    if (boundarySidecarSha256 !== role.boundarySidecar?.sha256) throw new Error(`${roleName} boundary sidecar sha256 mismatch`);
    roles[roleName] = {
      sourceKind: role.sourceKind,
      sourceManifestPath,
      sourceManifestSha256,
      packIdentity: role.packIdentity ?? null,
      boundarySidecarPath: boundaryPath,
      boundarySidecarSha256,
      boundarySidecarByteLength: boundaryBytes.byteLength,
    };
  }
  return {
    roleOrder: ROLE_ORDER,
    rendererOrder: RENDERER_ORDER,
    frozenState: input.frozenState,
    roles,
    falseClosureChecks: {
      missingOrBlankOutput: false,
      requestedEffectiveRendererDisagreement: false,
      controlsSignatureDisagreement: false,
      receiverControlsDisagreement: false,
      sourceSubstitution: false,
      candidateOverflow: false,
      fallbackRoute: false,
    },
  };
}

function failureReport(phase, error, lastTrustworthyEvidence = {}) {
  return {
    schema: SCHEMA,
    status: 'failed',
    createdAt: utcNow(),
    failurePhase: phase,
    error: String(error?.message || error),
    lastTrustworthyEvidence,
    falseClosureGateNames: FALSE_CLOSURE_GATES,
  };
}

async function cdpFetch(path, options) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`, options);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function routeWithBridgeControls(route, grid) {
  const url = new URL(route);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_resolution', String(grid));
  url.searchParams.set('volume_boundary_sidecar_source', 'baked');
  url.searchParams.set('volume_boundary_splat_mode', 'off');
  url.searchParams.set('volume_temporal_accum', '0');
  url.searchParams.set('volume_temporal_jitter', '0');
  return url.toString();
}

function launchBrowser(route) {
  return spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1200,1200',
    route,
  ], { stdio: 'ignore' });
}

async function closeBrowser(browser) {
  try {
    await fetch(`http://127.0.0.1:${debugPort}/json/close`);
  } catch {}
  browser?.kill('SIGTERM');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression, phase) {
  const response = await wsRequest(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(`${phase}: ${JSON.stringify(response.exceptionDetails)}`);
  if (response.result?.subtype === 'error') throw new Error(`${phase}: ${JSON.stringify(response.result)}`);
  return response.result.value;
}

async function connectPage(route) {
  const targets = await cdpFetch('/json/list');
  const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
    || targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('no debuggable page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.navigate', { url: route });
  return ws;
}

async function waitForVolume(ws) {
  await delay(settleMs);
  let state = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    state = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()', 'debug-state');
    if (state?.active && state.width > 0 && state.height > 0 && state.frameCount > 0) return state;
    await delay(250);
  }
  throw new Error(`volume prototype did not become active: ${JSON.stringify(state)}`);
}

async function replayFrozenState(ws, frozenState) {
  const sample = await evaluate(
    ws,
    `window.__kaminosVolumePrototype.sampleDeterministicReplayFrame(${JSON.stringify(frozenState.replay)})`,
    'deterministic-replay',
  );
  if (sample?.ok !== true) throw new Error(`deterministic replay failed: ${JSON.stringify(sample)}`);
  if (sample.controlsSignature !== frozenState.replay.controlsSignature) {
    throw new Error(`controls-signature-disagreement: expected ${frozenState.replay.controlsSignature}, effective ${sample.controlsSignature}`);
  }
  return sample;
}

async function uploadRole(ws, input, roleName, role) {
  const begin = await evaluate(ws, `window.__kaminosVolumePrototype.beginDebugBoundarySidecarOverride(${JSON.stringify({
    role: roleName,
    grid: input.frozenState.grid,
    byteLength: role.boundarySidecarByteLength,
    boundarySidecarSha256: role.boundarySidecarSha256,
    sourceManifestPath: role.sourceManifestPath,
    sourceManifestSha256: role.sourceManifestSha256,
    sourceKind: role.sourceKind,
    packIdentity: role.packIdentity,
  })})`, `begin-sidecar-${roleName}`);
  if (begin?.ok !== true) throw new Error(`sidecar begin failed for ${roleName}: ${JSON.stringify(begin)}`);
  const bytes = readFileSync(role.boundarySidecarPath);
  for (let byteOffset = 0; byteOffset < bytes.byteLength; byteOffset += chunkBytes) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const write = await evaluate(ws, `window.__kaminosVolumePrototype.writeDebugBoundarySidecarOverrideChunk(${JSON.stringify({
      sessionId: begin.sessionId,
      byteOffset,
      base64: chunk.toString('base64'),
    })})`, `write-sidecar-${roleName}-${byteOffset}`);
    if (write?.ok !== true) throw new Error(`sidecar chunk failed for ${roleName}: ${JSON.stringify(write)}`);
  }
  const finish = await evaluate(ws, `window.__kaminosVolumePrototype.finishDebugBoundarySidecarOverride(${JSON.stringify({ sessionId: begin.sessionId })})`, `finish-sidecar-${roleName}`);
  if (finish?.ok !== true || finish.status !== 'applied') throw new Error(`sidecar finish failed for ${roleName}: ${JSON.stringify(finish)}`);
  return finish;
}

async function captureCanvas(ws, path) {
  const clip = await evaluate(ws, `(() => {
    const canvas = window.__kaminosVolumePrototype.canvasElement();
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: 1 };
  })()`, 'canvas-clip');
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
  const bytes = Buffer.from(screenshot.data, 'base64');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { path, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength };
}

function rejectFalseClosure(capture) {
  const expectedRenderer = expectedRendererIdentity(capture.requestedRenderer);
  if (capture.effectiveRenderer !== expectedRenderer) throw new Error(`requested-effective-renderer-disagreement: requested ${capture.requestedRenderer}, effective ${capture.effectiveRenderer}`);
  if ((capture.appliedModelIdentity || null) !== expectedModelIdentity(capture.requestedRenderer)) throw new Error('requested-effective-renderer-disagreement: model identity');
  if (capture.sourceAuthority !== EXTERNAL_SOURCE_AUTHORITY) throw new Error(`source-substitution: ${capture.sourceAuthority}`);
  if (capture.overrideReceipt?.boundarySidecarSha256 !== capture.boundarySidecarSha256
    || capture.overrideReceipt?.sourceManifestSha256 !== capture.sourceManifestSha256) throw new Error('source-substitution: override receipt checksum');
  if (capture.boundarySplatFallbackReason != null) throw new Error(`fallback-route: ${capture.boundarySplatFallbackReason}`);
  if (!Number.isFinite(capture.boundarySplatCandidateCount) || capture.boundarySplatCandidateCount <= 0) throw new Error('missing-or-blank-output: candidate count');
  if (capture.boundarySplatOverflowCount !== 0) throw new Error(`candidate-overflow: ${capture.boundarySplatOverflowCount}`);
  if (!capture.image || capture.image.byteLength < 512) throw new Error('missing-or-blank-output: screenshot');
  if (Math.abs(capture.receiverControls.requested.radius - capture.receiverControls.effective.radius) > 1e-6
    || Math.abs(capture.receiverControls.requested.sharpness - capture.receiverControls.effective.sharpness) > 1e-6) {
    throw new Error(`receiver-controls-disagreement: ${JSON.stringify(capture.receiverControls)}`);
  }
}

function writeViewer(path, captures, input) {
  const cards = captures.map(capture => `<figure><img src="${capture.fileName}" alt="${capture.role} ${capture.requestedRenderer}"><figcaption><strong>${capture.role}</strong><br>${capture.requestedRenderer} splats; r${capture.receiverControls.effective.radius} / s${capture.receiverControls.effective.sharpness}<br>${capture.boundarySplatCandidateCount} candidates</figcaption></figure>`).join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Kaminos dense cue splat bridge</title>
<style>
body { margin: 20px; background: #090b0c; color: #e5ecee; font: 14px/1.4 system-ui, sans-serif; }
.grid { display: grid; grid-template-columns: repeat(${ROLE_ORDER.length}, minmax(220px, 1fr)); gap: 12px; align-items: start; }
figure { margin: 0; border: 1px solid #333b3e; background: #111516; }
img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #000; }
figcaption { padding: 8px 10px 10px; min-height: 54px; }
code { color: #ffd184; }
</style>
<h1>Dense cue to splat receiver bridge</h1>
<p>Frozen state: <code>${input.frozenState.identity}</code>. Columns preserve gap-matched controls; first row analytic, second row learned attributes.</p>
<div class="grid">${cards}</div>`;
  writeFileSync(path, html);
}

async function runCapture(input, validated) {
  const route = routeWithBridgeControls(input.frozenState.requestedRoute, input.frozenState.grid);
  let browser = null;
  let ws = null;
  const captures = [];
  try {
    browser = launchBrowser(route);
    await waitForCdp();
    ws = await connectPage(route);
    const initialState = await waitForVolume(ws);
    if (initialState.simGrid !== Number(input.frozenState.grid)) throw new Error(`effective grid mismatch: ${initialState.simGrid}`);
    for (const renderer of RENDERER_ORDER) {
      for (const roleName of ROLE_ORDER) {
        const role = validated.roles[roleName];
        const receiverControls = roleName.startsWith('learned')
          ? { radius: learnedSplatRadius, sharpness: learnedSplatSharpness }
          : { radius: 1, sharpness: 3.4 };
        const replayReceipt = await replayFrozenState(ws, input.frozenState);
        const overrideReceipt = await uploadRole(ws, input, roleName, role);
        await evaluate(ws, `window.__kaminosVolumePrototype.setControls(${JSON.stringify({
          boundarySidecarSource: 'override',
          boundarySplatMode: renderer,
          boundarySplatRadius: receiverControls.radius,
          boundarySplatSharpness: receiverControls.sharpness,
          lookFreeze: 0,
          temporalAccum: 0,
          temporalJitter: 0,
        })})`, `controls-${roleName}-${renderer}`);
        const finalTimeMs = input.frozenState.replay.startTimeMs
          + Math.max(0, input.frozenState.replay.steps - 1) * input.frozenState.replay.timeStepMs;
        const sample = await evaluate(ws, `window.__kaminosVolumePrototype.renderFrozenScaleToCanvas(${JSON.stringify({
          controlOverrides: {
            boundarySidecarSource: 'override',
            boundarySplatMode: renderer,
            boundarySplatRadius: receiverControls.radius,
            boundarySplatSharpness: receiverControls.sharpness,
            lookFreeze: 1,
            temporalAccum: 0,
            temporalJitter: 0,
          },
          now: finalTimeMs,
          sameStateCaptureId: `${input.frozenState.identity}:${roleName}:${renderer}`,
          restoreControls: false,
          resumeRenderLoop: false,
        })})`, `sample-${roleName}-${renderer}`);
        if (sample?.ok !== true) throw new Error(`sample failed for ${roleName}/${renderer}: ${JSON.stringify(sample)}`);
        const fileName = `${renderer}.${roleName}.png`;
        const image = await captureCanvas(ws, resolve(outDir, fileName));
        const capture = {
          role: roleName,
          requestedRenderer: renderer,
          effectiveRenderer: sample.boundarySplatRendererIdentity,
          appliedModelIdentity: sample.boundarySplatAttributeModelIdentity ?? null,
          sourceAuthority: sample.boundarySplatSourceAuthority,
          sourceManifestPath: role.sourceManifestPath,
          sourceManifestSha256: role.sourceManifestSha256,
          packIdentity: role.packIdentity,
          boundarySidecarSha256: role.boundarySidecarSha256,
          overrideReceipt: sample.boundarySidecarOverrideReceipt || overrideReceipt,
          boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
          boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
          boundarySplatOverflowCount: sample.boundarySplatOverflowCount,
          boundarySplatFallbackReason: sample.boundarySplatFallbackReason,
          boundarySplatCountAuthority: sample.boundarySplatCountAuthority,
          boundarySplatCopyBytesThisFrame: sample.boundarySplatCopyBytesThisFrame,
          boundarySplatCopyDisposition: sample.boundarySplatCopyDisposition,
          backend: sample.backend,
          effectiveRoute: sample.effectiveRoute,
          prototypeIdentity: sample.prototypeIdentity,
          sampleAuthority: sample.sampleAuthority,
          replayReceipt,
          receiverControls: {
            requested: receiverControls,
            effective: {
              radius: sample.boundarySplatRadius,
              sharpness: sample.boundarySplatSharpness,
            },
          },
          image,
          fileName,
          fireLikePixels: null,
          fireEdgeEnergy: null,
        };
        rejectFalseClosure(capture);
        captures.push(capture);
      }
    }
    const viewer = resolve(outDir, 'index.html');
    writeViewer(viewer, captures, input);
    return { route, initialState, captures, viewer, viewerSha256: sha256File(viewer) };
  } finally {
    ws?.close();
    if (browser) await closeBrowser(browser);
  }
}

async function main() {
  let phase = 'input-read';
  let evidence = {};
  try {
    mkdirSync(outDir, { recursive: true });
    const input = loadInput();
    phase = 'input-validation';
    const validated = validateInput(input);
    evidence = { ...validated, input };
    if (validateOnly) {
      writeJson(outPath, { schema: SCHEMA, status: 'validated', createdAt: utcNow(), ...validated });
      return;
    }
    phase = 'browser-capture';
    const capture = await runCapture(input, validated);
    phase = 'report-write';
    writeJson(outPath, {
      schema: SCHEMA,
      status: 'captured',
      createdAt: utcNow(),
      input,
      roleOrder: ROLE_ORDER,
      rendererOrder: RENDERER_ORDER,
      roles: validated.roles,
      falseClosureGateNames: FALSE_CLOSURE_GATES,
      falseClosureChecks: validated.falseClosureChecks,
      route: {
        requestedRoute: capture.route,
        effectiveRoute: capture.initialState.effectiveRoute,
        prototypeIdentity: capture.initialState.prototypeIdentity,
        backend: capture.initialState.backend,
      },
      captures: capture.captures,
      viewer: { path: capture.viewer, sha256: capture.viewerSha256 },
    });
  } catch (error) {
    writeJson(outPath, failureReport(phase, error, evidence));
    console.error(`dense cue splat bridge failed at ${phase}: ${error?.message || error}`);
    process.exitCode = 2;
  }
}

await main();
