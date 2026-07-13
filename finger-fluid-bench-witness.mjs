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
const port = Number(args.get('--debug-port') || 9493);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-finger-fluid-bench-profile-${port}-${process.pid}`;
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const settleMs = Number(args.get('--settle-ms') || 3200);
const hookWaitMs = Number(args.get('--hook-wait-ms') || Math.max(settleMs, 15000));
const cadenceMs = Number(args.get('--cadence-ms') || 1500);

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastDebugState = null;
let canvasActivity = null;
let cadenceProbe = null;
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
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
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
    canvasOut,
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

async function main() {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
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
      deviceScaleFactor: 1,
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

    await delay(settleMs);

    lastDebugState = await evaluate(ws, `(() => {
      const read = window.kaminosFingerFluidBenchDebugState || window.__kaminosFingerFluidBenchDebugState;
      return typeof read === 'function' ? read() : null;
    })()`);

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
    if (lastDebugState.runtime?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0') throw new Error(`solver route mismatch: ${lastDebugState.runtime?.solverRoute}`);
    if (lastDebugState.runtime?.neighborGridContract !== 'wgsl-linked-cell-neighbor-grid-v0') throw new Error(`neighbor grid contract mismatch: ${lastDebugState.runtime?.neighborGridContract}`);
    if (lastDebugState.runtime?.densityContract !== 'wgsl-pbf-density-constraint-v0') throw new Error(`density contract mismatch: ${lastDebugState.runtime?.densityContract}`);
    if (lastDebugState.runtime?.stepCount < 20) throw new Error(`insufficient real compute steps: ${lastDebugState.runtime?.stepCount}`);
    if (lastDebugState.runtime?.linkedCellGridBuildCount < 20) throw new Error(`missing linked-cell grid builds: ${lastDebugState.runtime?.linkedCellGridBuildCount}`);
    if (lastDebugState.runtime?.densityIterationCount < 60) throw new Error(`missing density iterations: ${lastDebugState.runtime?.densityIterationCount}`);
    if (lastDebugState.runtime?.directRenderFrameCount < 20) throw new Error(`missing direct GPU render frames: ${lastDebugState.runtime?.directRenderFrameCount}`);
    const activeExtent3d = lastDebugState.runtime?.diagnostics?.activeExtent3d;
    if (!activeExtent3d || activeExtent3d.size?.length !== 3) throw new Error('missing activeExtent3d diagnostics');
    const diagnosticsLagSteps = lastDebugState.runtime.stepCount - lastDebugState.runtime.diagnostics?.stepCount;
    if (!Number.isInteger(diagnosticsLagSteps) || diagnosticsLagSteps < 0 || diagnosticsLagSteps > 120) {
      throw new Error(`stale GPU diagnostics rejected: ${JSON.stringify({ diagnosticsLagSteps, stepCount: lastDebugState.runtime.stepCount, diagnosticsStepCount: lastDebugState.runtime.diagnostics?.stepCount })}`);
    }
    if (activeExtent3d.size.some(value => !Number.isFinite(value) || value < 0.35)) throw new Error(`fluid state is not materially 3D: ${JSON.stringify(activeExtent3d)}`);
    if (lastDebugState.runtime?.diagnostics?.maxSpeed > 3.35) throw new Error(`bounded-energy stability failure: maxSpeed ${lastDebugState.runtime.diagnostics.maxSpeed}`);
    const restDensity = lastDebugState.runtime?.restDensity;
    const averageDensity = lastDebugState.runtime?.diagnostics?.averageDensity;
    const relativeDensityError = Math.abs(averageDensity - restDensity) / Math.max(0.001, restDensity);
    if (!Number.isFinite(relativeDensityError) || relativeDensityError > 0.35) throw new Error(`density basin mismatch: ${JSON.stringify({ averageDensity, restDensity, relativeDensityError })}`);
    if (activeExtent3d.size[0] > 4.66 && activeExtent3d.size[2] > 4.66 && lastDebugState.runtime.diagnostics.averageSpeed > 1.2) {
      throw new Error(`energetic fluid saturated the full horizontal domain: ${JSON.stringify(activeExtent3d)}`);
    }

    phase = 'cadence_probe';
    const cadenceBefore = {
      stepCount: lastDebugState.runtime.stepCount,
      directRenderFrameCount: lastDebugState.runtime.directRenderFrameCount,
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
      framesPerSecond: Number(((cadenceState.runtime.directRenderFrameCount - cadenceBefore.directRenderFrameCount) * 1000 / cadenceElapsedMs).toFixed(2)),
    };
    if (cadenceProbe.framesPerSecond < 18) throw new Error(`settled GPU fluid cadence below floor: ${JSON.stringify(cadenceProbe)}`);
    lastDebugState = cadenceState;

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
    for (let i = 0; i < decoded.stdout.length; i += 3) {
      const r = decoded.stdout[i];
      const g = decoded.stdout[i + 1];
      const b = decoded.stdout[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 66 && max - min > 18) activePixels += 1;
    }
    const pixelCount = Math.floor(decoded.stdout.length / 3);
    canvasActivity = {
      ok: true,
      width: Math.round(canvasRect.width),
      height: Math.round(canvasRect.height),
      activePixels,
      activeRatio: Number((activePixels / Math.max(1, pixelCount)).toFixed(5)),
      measurement: 'captured_webgpu_canvas_ffmpeg_rgb24_v0',
    };
    if (canvasActivity.activeRatio < 0.09) throw new Error(`native GPU fluid bench too sparse: ${JSON.stringify(canvasActivity)}`);

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
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

main().catch(error => {
  writeReport({
    ok: false,
    error: error.message || String(error),
  });
  console.error(error);
  process.exitCode = 1;
});
