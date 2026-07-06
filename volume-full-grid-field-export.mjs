#!/usr/bin/env node
import { createHash, randomInt } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const MANIFEST_SCHEMA = 'kaminos.volume.full-grid-field-export.v0';
const SIDECAR_IDENTITY = 'full-grid-fluid-front-buffer-sidecars-v0';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, true);
  } else {
    args.set(key, next);
    i += 1;
  }
}

const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-full-grid-field-export'));
const manifestPath = resolve(String(args.get('--manifest') || join(outDir, 'manifest.json')));
const url = String(args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1');
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const reuseBrowser = args.has('--reuse-browser');
const keepBrowserOpen = args.has('--keep-browser-open');
const userDataDir = String(args.get('--user-data-dir') || mkdtempSync('/tmp/kaminos-full-grid-field-export-profile-'));
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = String(args.get('--window-size') || '1280,960');
const chunkFloats = Math.max(1, Math.floor(Number(args.get('--chunk-floats') || 65536)));
const deterministicReplaySteps = Number(args.get('--deterministic-replay-steps') || 0);
const deterministicReplayRequested = Number.isFinite(deterministicReplaySteps) && deterministicReplaySteps > 0;
const deterministicReplayTimeStepMs = Number(args.get('--deterministic-replay-time-step-ms') || (1000 / 60));
const deterministicReplayStartTimeMs = Number(args.get('--deterministic-replay-start-ms') || 1000);

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
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
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function attachOrLaunchSharedBrowser() {
  if (reuseBrowser && await cdpAvailable()) {
    return {
      identity: 'attach-or-launch-shared-cdp-browser-v0',
      mode: 'attached-existing',
      port,
      userDataDir,
      keepBrowserOpen,
      process: null,
    };
  }
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });
  return {
    identity: reuseBrowser ? 'attach-or-launch-shared-cdp-browser-v0' : 'per-capture-chrome-process-v0',
    mode: reuseBrowser ? 'launched-shared' : 'launched-per-capture',
    port,
    userDataDir,
    keepBrowserOpen,
    process: proc,
  };
}

function closeBrowserSession(browserSession) {
  if (browserSession?.keepBrowserOpen) return;
  browserSession?.process?.kill('SIGTERM');
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
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function writeManifest(payload) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function evaluateByValue(ws, expression, phase) {
  const evaluated = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(`${phase}: ${JSON.stringify(evaluated.exceptionDetails)}`);
  }
  if (evaluated.result?.subtype === 'error') {
    throw new Error(`${phase}: ${JSON.stringify(evaluated.result)}`);
  }
  return evaluated.result.value;
}

async function drainSidecar(ws, session, kind, outputPath) {
  const descriptor = session[kind];
  const expectedFloats = Number(descriptor?.floatCount);
  const expectedBytes = Number(descriptor?.byteLength);
  if (!Number.isFinite(expectedFloats) || expectedFloats < 1 || !Number.isFinite(expectedBytes)) {
    throw new Error(`invalid ${kind} descriptor: ${JSON.stringify(descriptor)}`);
  }
  writeFileSync(outputPath, Buffer.alloc(0));
  const sha = createHash('sha256');
  let startFloat = 0;
  let chunkCount = 0;
  while (startFloat < expectedFloats) {
    const chunk = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.readDebugFullFieldExportChunk(${JSON.stringify({
        sessionId: session.sessionId,
        kind,
        startFloat,
        floatCount: Math.min(chunkFloats, expectedFloats - startFloat),
      })})`,
      `chunk-${kind}`,
    );
    if (chunk?.ok !== true || chunk.kind !== kind || Number(chunk.startFloat) !== startFloat) {
      throw new Error(`bad ${kind} chunk at ${startFloat}: ${JSON.stringify(chunk)}`);
    }
    const buffer = Buffer.from(chunk.base64 || '', 'base64');
    if (buffer.byteLength !== Number(chunk.byteLength)) {
      throw new Error(`bad ${kind} chunk byte length at ${startFloat}: expected ${chunk.byteLength}, got ${buffer.byteLength}`);
    }
    appendFileSync(outputPath, buffer);
    sha.update(buffer);
    startFloat += Number(chunk.floatCount);
    chunkCount += 1;
  }
  const actualBytes = statSync(outputPath).size;
  if (actualBytes !== expectedBytes) {
    throw new Error(`${kind} sidecar byte mismatch: expected ${expectedBytes}, got ${actualBytes}`);
  }
  return {
    ...descriptor,
    path: outputPath,
    sha256: sha.digest('hex'),
    chunkCount,
    chunkFloats,
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browserSession = await attachOrLaunchSharedBrowser();
  let phase = 'launch';
  let ws = null;
  let begin = null;
  try {
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');

    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await delay(settleMs);

    phase = 'identity';
    let state = null;
    for (let i = 0; i < 80; i += 1) {
      state = await evaluateByValue(ws, 'window.__kaminosVolumePrototype?.debugState?.()', 'debug-state');
      if (state?.active === true && state?.frameCount > 3) break;
      await delay(250);
    }
    if (state?.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error(`wrong effective route: ${state?.effectiveRoute || '(missing)'}`);
    }
    if (state?.prototypeIdentity !== 'kaminos-volume-prototype-v0') {
      throw new Error(`wrong prototype identity: ${state?.prototypeIdentity || '(missing)'}`);
    }

    phase = 'begin-full-grid-export';
    begin = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.beginDebugFullFieldExport(${JSON.stringify({
        ...(deterministicReplayRequested ? {
          deterministicReplay: {
            steps: deterministicReplaySteps,
            timeStepMs: deterministicReplayTimeStepMs,
            startTimeMs: deterministicReplayStartTimeMs,
          },
        } : {}),
      })})`,
      phase,
    );
    if (begin?.ok !== true || begin.schema !== 'kaminos.volume.full-field-export.v0') {
      throw new Error(`full-grid export did not begin cleanly: ${JSON.stringify(begin)}`);
    }

    phase = 'drain-fluid';
    const fluid = await drainSidecar(ws, begin, 'fluid', join(outDir, 'fluid.f32'));
    phase = 'drain-front';
    const front = await drainSidecar(ws, begin, 'front', join(outDir, 'front.f32'));

    phase = 'release';
    const release = await evaluateByValue(
      ws,
      `window.__kaminosVolumePrototype.releaseDebugFullFieldExport(${JSON.stringify({ sessionId: begin.sessionId })})`,
      phase,
    );

    const manifest = {
      schema: MANIFEST_SCHEMA,
      identity: SIDECAR_IDENTITY,
      status: 'captured',
      failurePhase: null,
      completeFieldCoverage: true,
      url,
      browserSession,
      chunkFloats,
      sessionId: begin.sessionId,
      routeIdentity: begin.routeIdentity,
      effectiveRoute: begin.effectiveRoute,
      prototypeIdentity: begin.prototypeIdentity,
      backend: begin.backend,
      grid: begin.grid,
      cellCount: begin.cellCount,
      simGridLabel: begin.simGridLabel,
      deterministicReplay: begin.deterministicReplay,
      fluidComponents: begin.fluidComponents,
      fluidChannelOrder: begin.fluidChannelOrder,
      frontChannelOrder: begin.frontChannelOrder,
      sidecars: { fluid, front },
      release,
    };
    writeManifest(manifest);
    console.log(JSON.stringify({ ok: true, manifest: manifestPath, grid: begin.grid, sidecars: manifest.sidecars }, null, 2));
  } catch (err) {
    writeManifest({
      schema: MANIFEST_SCHEMA,
      identity: SIDECAR_IDENTITY,
      status: 'failed',
      failurePhase: phase,
      completeFieldCoverage: false,
      url,
      browserSession,
      chunkFloats,
      begin,
      error: err?.message || String(err),
    });
    throw err;
  } finally {
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    closeBrowserSession(browserSession);
  }
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
