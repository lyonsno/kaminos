#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const REPORT_SCHEMA = 'boundary-sidecar-raw-export-report-v0';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

const args = parseArgs(process.argv.slice(2));
const url = String(args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1');
const outputDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-sidecar-raw-export'));
const reportPath = resolve(String(args.get('--report') || join(outputDir, 'report.json')));
const structurePath = join(outputDir, 'structure.f32');
const metaPath = join(outputDir, 'meta.f32');
const chunkBytes = Math.max(4096, Math.trunc(Number(args.get('--chunk-bytes') || 256 * 1024)));
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 1500));
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reuseBrowser = args.has('--reuse-browser');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = resolve(String(args.get('--user-data-dir') || join(outputDir, 'chrome-profile')));

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function cdpAvailable() {
  try {
    await cdpFetch('/json/version');
    return true;
  } catch {
    return false;
  }
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await cdpAvailable()) return;
    await delay(125);
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message || JSON.stringify(message.error)}`));
      else resolveRequest(message.result);
    };
    const onClose = () => {
      cleanup();
      rejectRequest(new Error(`CDP websocket closed during ${method}`));
    };
    const onError = event => {
      cleanup();
      rejectRequest(new Error(`CDP websocket error during ${method}: ${event?.message || 'unknown'}`));
    };
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForWebSocketOpen(ws) {
  if (ws.readyState === WebSocket.OPEN) return;
  await new Promise((resolveOpen, rejectOpen) => {
    const onOpen = () => {
      cleanup();
      resolveOpen();
    };
    const onError = event => {
      cleanup();
      rejectOpen(new Error(`CDP websocket failed to open: ${event?.message || 'unknown'}`));
    };
    const cleanup = () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

async function attachOrLaunchBrowser() {
  if (reuseBrowser && await cdpAvailable()) {
    return { mode: 'attached-existing', process: null };
  }
  await mkdir(userDataDir, { recursive: true });
  const browserProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1280,960',
    url,
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) browserProcess.unref();
  return { mode: reuseBrowser ? 'launched-shared' : 'launched-single-capture', process: browserProcess };
}

async function drainField(ws, captureId, field, expectedBytes, path) {
  const file = await open(path, 'w');
  const digest = createHash('sha256');
  let writtenBytes = 0;
  try {
    for (let offset = 0; offset < expectedBytes; offset += chunkBytes) {
      const requestedBytes = Math.min(chunkBytes, expectedBytes - offset);
      const chunk = await evaluate(
        ws,
        `window.__kaminosVolumePrototype.readBoundarySidecarRawCaptureChunk(${JSON.stringify(captureId)}, ${JSON.stringify(field)}, ${offset}, ${requestedBytes})`,
      );
      if (!chunk?.ok) throw new Error(`${field} chunk ${offset} failed: ${chunk?.reason || 'unknown'}`);
      if (chunk.captureId !== captureId || chunk.field !== field || chunk.byteOffset !== offset) {
        throw new Error(`${field} chunk ${offset} identity mismatch`);
      }
      const bytes = Buffer.from(chunk.base64 || '', 'base64');
      if (bytes.length !== chunk.byteLength || bytes.length !== requestedBytes) {
        throw new Error(`${field} chunk ${offset} length mismatch: expected ${requestedBytes}, received ${bytes.length}`);
      }
      await file.write(bytes, 0, bytes.length, offset);
      digest.update(bytes);
      writtenBytes += bytes.length;
    }
  } finally {
    await file.close();
  }
  if (writtenBytes !== expectedBytes) throw new Error(`${field} payload incomplete: expected ${expectedBytes}, wrote ${writtenBytes}`);
  return {
    path,
    dtype: 'float32-le',
    bytes: writtenBytes,
    sha256: digest.digest('hex'),
  };
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  let browserSession = null;
  let ws = null;
  let capture = null;
  let state = null;
  let failurePhase = 'browser-launch';
  let release = null;
  let structure = null;
  let meta = null;
  let error = null;
  try {
    browserSession = await attachOrLaunchBrowser();
    await waitForCdp();
    failurePhase = 'target-selection';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || targets.find(target => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    failurePhase = 'page-load';
    await wsRequest(ws, 'Page.navigate', { url });
    await delay(settleMs);
    failurePhase = 'route-identity';
    for (let attempt = 0; attempt < 80; attempt += 1) {
      state = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
      if (state?.active && state?.frameCount > 5) break;
      await delay(250);
    }
    if (!state?.active) throw new Error('Volume prototype did not become active');
    if (state.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error(`Wrong effective route: ${state.effectiveRoute || 'missing'}`);
    }
    failurePhase = 'raw-capture';
    capture = await evaluate(ws, 'window.__kaminosVolumePrototype.captureBoundarySidecarRawFrame({ resumeRenderLoop: false })');
    if (!capture?.ok) throw new Error(`Raw capture failed: ${capture?.reason || 'unknown'}`);
    if (capture.effectiveRoute !== state.effectiveRoute || capture.backend !== state.backend) {
      throw new Error('Raw capture route/backend identity drifted from the live state');
    }
    if (capture.fallbackReason != null) throw new Error(`Raw capture used fallback: ${capture.fallbackReason}`);
    if (capture.identity !== 'boundary-sidecar-raw-two-buffer-export-v0') {
      throw new Error(`Wrong raw export identity: ${capture.identity || 'missing'}`);
    }
    failurePhase = 'structure-transport';
    structure = await drainField(ws, capture.captureId, 'structure', capture.fields?.structure?.bytes, structurePath);
    failurePhase = 'meta-transport';
    meta = await drainField(ws, capture.captureId, 'meta', capture.fields?.meta?.bytes, metaPath);
    failurePhase = 'release';
    release = await evaluate(
      ws,
      `window.__kaminosVolumePrototype.releaseBoundarySidecarRawCapture(${JSON.stringify(capture.captureId)})`,
    );
    if (!release?.ok || release.released !== true) throw new Error(`Raw capture release failed: ${release?.reason || 'unknown'}`);
    failurePhase = 'complete';
  } catch (caught) {
    error = caught;
  } finally {
    if (capture?.captureId && !release?.released && ws) {
      try {
        release = await evaluate(
          ws,
          `window.__kaminosVolumePrototype.releaseBoundarySidecarRawCapture(${JSON.stringify(capture.captureId)})`,
        );
      } catch {
        release = { ok: false, released: false, reason: 'release-after-failure-failed' };
      }
    }
    ws?.close();
    if (!keepBrowserOpen) browserSession?.process?.kill('SIGTERM');
  }

  const report = {
    schema: REPORT_SCHEMA,
    ok: error == null,
    requestedRoute: url,
    effectiveRoute: capture?.effectiveRoute || state?.effectiveRoute || null,
    backend: capture?.backend || state?.backend || null,
    fallbackReason: capture?.fallbackReason ?? null,
    failurePhase,
    error: error?.message || null,
    capture: capture ? {
      identity: capture.identity,
      captureId: capture.captureId,
      prototypeIdentity: capture.prototypeIdentity,
      frameCount: capture.frameCount,
      simStepCount: capture.simStepCount,
      grid: capture.grid,
      gridToWorld: capture.gridToWorld,
      boundarySidecarIdentity: capture.boundarySidecarIdentity,
      boundarySidecarAuthority: capture.boundarySidecarAuthority,
      fields: capture.fields,
    } : null,
    artifacts: { structure, meta },
    release,
    browserSession: browserSession ? {
      mode: browserSession.mode,
      port,
      reused: browserSession.mode === 'attached-existing',
      keptOpen: keepBrowserOpen,
    } : null,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const stream = error ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(report, null, 2)}\n`);
  if (error) process.exitCode = 1;
}

await main();
