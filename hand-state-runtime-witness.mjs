#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const requestedUrl = args.get('--url') || 'http://127.0.0.1:18142/index.html?kaminos_hand_state=1&hand_fixture=1';
const fakeVideo = args.get('--fake-video') ? resolve(args.get('--fake-video')) : null;
const out = resolve(args.get('--out') || '/tmp/kaminos-hand-state-runtime.png');
const manoFirstOutput = out.replace(/\.png$/i, '.mano-first.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9517);
const width = Number(args.get('--viewport-width') || 1720);
const height = Number(args.get('--viewport-height') || 1080);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-hand-state-witness-${port}-${process.pid}`;
const consoleEvents = [];
let phase = 'initializing';
let effectiveUrl = null;
let debugState = null;
let emitterGrowthReceipt = null;
let inactiveEmitterRespawnReceipt = null;
let liveRuntimeState = null;
let primaryOutputWritten = false;
let manoFirstOutputWritten = false;
let stderr = '';

function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.hand-state-runtime-witness.v0',
    requestedUrl,
    effectiveUrl,
    fixtureMode: debugState?.fixtureMode ?? null,
    runtimeOwner: debugState?.runtimeOwner ?? null,
    primary_output_written: primaryOutputWritten,
    mano_first_output: manoFirstOutput,
    mano_first_output_written: manoFirstOutputWritten,
    failure_phase: phase,
    viewport: { width, height },
    consoleEvents,
    debugState,
    emitterGrowthReceipt,
    inactiveEmitterRespawnReceipt,
    fakeVideo,
    liveRuntimeState,
    stderrTail: stderr.slice(-2000),
    ...extra,
  }, null, 2));
}

async function cdp(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await cdp('/json/version'); } catch { await delay(100); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForPage() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await cdp('/json/list');
    const page = pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(100);
  }
  throw new Error('Chrome page target did not appear');
}

function openSocket(url) {
  const socket = new WebSocket(url);
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(socket), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed')), { once: true });
  });
}

function request(socket, method, params = {}) {
  const id = socket._nextId = (socket._nextId || 0) + 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => rejectRequest(new Error(`${method} timed out`)), 15000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({ type: message.params.type, text: message.params.args.map(arg => arg.value || arg.description || '').join(' ') });
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({ type: 'exception', text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text });
      }
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function evaluate(socket, expression) {
  const result = await request(socket, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function main() {
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-webgpu',
    `--window-size=${width},${height}`,
  ];
  if (fakeVideo) {
    chromeArgs.push(
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${fakeVideo}`,
    );
  }
  chromeArgs.push('about:blank');
  const browser = spawn(chrome, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect_cdp';
    await waitForCdp();
    const page = await waitForPage();
    const socket = await openSocket(page.webSocketDebuggerUrl);
    await request(socket, 'Runtime.enable');
    await request(socket, 'Page.enable');
    await request(socket, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    phase = 'navigate';
    await request(socket, 'Page.navigate', { url: requestedUrl });

    if (fakeVideo) {
      phase = 'start_live_camera';
      const startupDeadline = Date.now() + 30000;
      let startReceipt = null;
      while (Date.now() < startupDeadline) {
        startReceipt = await evaluate(socket, `(() => {
          const frame = document.getElementById('hand-state-runtime-frame');
          const button = frame?.contentWindow?.document?.getElementById('hand-toggle');
          return {
            effectiveUrl: frame?.contentWindow?.location?.href || null,
            activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
            panelHidden: document.getElementById('hand-state-runtime-panel')?.hidden,
            buttonPresent: Boolean(button),
            buttonDisabled: button?.disabled ?? null,
          };
        })()`);
        if (startReceipt?.activeTab === 'hand-state' && startReceipt?.panelHidden === false
          && startReceipt?.buttonPresent && startReceipt?.buttonDisabled === false) break;
        await delay(100);
      }
      effectiveUrl = startReceipt?.effectiveUrl || null;
      if (!startReceipt?.buttonPresent) throw new Error('live Hand Start command never became available');
      // The parent route rewrites the iframe URL with its effective cache identity.
      // Let that navigation settle so the click cannot land on the superseded child.
      await delay(750);
      const startClickReceipt = await evaluate(socket, `(() => {
        const frame = document.getElementById('hand-state-runtime-frame');
        const button = frame?.contentWindow?.document?.getElementById('hand-toggle');
        if (!button || button.disabled) return { clicked: false, effectiveUrl: frame?.contentWindow?.location?.href || null };
        button.click();
        return { clicked: true, effectiveUrl: frame.contentWindow.location.href };
      })()`);
      effectiveUrl = startClickReceipt?.effectiveUrl || effectiveUrl;
      if (!startClickReceipt?.clicked) throw new Error('live Hand Start command was unavailable after iframe navigation settled');

      phase = 'wait_for_live_mano';
      const liveDeadline = Date.now() + 90000;
      while (Date.now() < liveDeadline) {
        const receipt = await evaluate(socket, `(async () => {
          const frame = document.getElementById('hand-state-runtime-frame');
          const read = frame?.contentWindow?.__kaminosHandStateDebugState;
          const stateResponse = await frame?.contentWindow?.fetch('http://127.0.0.1:8766/state', { cache: 'no-store' }).catch(() => null);
          return {
            effectiveUrl: frame?.contentWindow?.location?.href || null,
            state: typeof read === 'function' ? read() : null,
            runtimeState: stateResponse?.ok ? await stateResponse.json() : null,
          };
        })()`);
        effectiveUrl = receipt?.effectiveUrl || effectiveUrl;
        debugState = receipt?.state || null;
        liveRuntimeState = receipt?.runtimeState || null;
        if (!manoFirstOutputWritten && debugState?.running && debugState?.fixtureMode === false
          && debugState?.meshVisible && debugState.vertexCount > 0 && debugState.faceCount > 0
          && debugState.handRenderFrameCount >= 3
          && liveRuntimeState?.frame?.authority?.sourceAuthority === 'live_simulation') {
          const manoScreenshot = await request(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          mkdirSync(dirname(manoFirstOutput), { recursive: true });
          writeFileSync(manoFirstOutput, Buffer.from(manoScreenshot.data, 'base64'));
          manoFirstOutputWritten = true;
        }
        if (debugState?.running && debugState?.fixtureMode === false && debugState?.meshVisible
          && debugState.vertexCount > 0 && debugState.faceCount > 0
          && debugState?.fingerJuice?.directRenderFrameCount >= 3
          && liveRuntimeState?.frame?.authority?.sourceAuthority === 'live_simulation') break;
        await delay(250);
      }
      if (debugState?.fixtureMode !== false) throw new Error('controlled live witness must not use fixture authority');
      if (!debugState?.running) throw new Error('Start Hand did not enter the running state');
      if (!debugState?.meshVisible || debugState.vertexCount <= 0 || debugState.faceCount <= 0) {
        throw new Error('controlled live camera route produced no MANO mesh');
      }
      if (debugState?.fingerJuice?.directRenderFrameCount < 3) {
        throw new Error('controlled live witness did not reach post-initialization continuous-fluid rendering');
      }
      if (debugState?.fingerJuice?.runtimeProfile !== 'live_play') {
        throw new Error(`controlled live witness substituted ${debugState?.fingerJuice?.runtimeProfile || 'missing'} runtimeProfile for live_play`);
      }
      if (liveRuntimeState?.frame?.authority?.sourceAuthority !== 'live_simulation') {
        throw new Error(`controlled live camera route has ${liveRuntimeState?.frame?.authority?.sourceAuthority || 'missing'} authority`);
      }
      if (liveRuntimeState?.frame?.source?.effectiveRoute !== 'native_wilor_mini_mlx_detector_sidecar_live') {
        throw new Error(`controlled live camera route substituted ${liveRuntimeState?.frame?.source?.effectiveRoute || 'missing'}`);
      }
      if (liveRuntimeState?.frame?.mano?.vertexCount !== 778 || liveRuntimeState?.frame?.mano?.faceCount !== 1538) {
        throw new Error('controlled live camera route did not publish the full WiLoR MANO surface');
      }
      const fatalConsole = consoleEvents.filter(event => event.type === 'exception' || event.type === 'error');
      if (fatalConsole.length) throw new Error(`browser console emitted ${fatalConsole.length} fatal event(s)`);
      phase = 'capture';
      await delay(1000);
      const screenshot = await request(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
      primaryOutputWritten = true;
      phase = 'complete';
      writeReport({ status: 'passed', screenshot: out });
      socket.close();
      browser.kill('SIGTERM');
      return;
    }

    phase = 'wait_for_mesh';
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const receipt = await evaluate(socket, `(() => {
        const frame = document.getElementById('hand-state-runtime-frame');
        if (!frame?.contentWindow) return { diagnostic: 'iframe_missing' };
        const read = frame.contentWindow.__kaminosHandStateDebugState;
        return {
          effectiveUrl: frame.contentWindow.location.href,
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          panelHidden: document.getElementById('hand-state-runtime-panel')?.hidden,
          state: typeof read === 'function' ? read() : null,
        };
      })()`);
      effectiveUrl = receipt?.effectiveUrl || null;
      debugState = receipt?.state || null;
      if (receipt?.activeTab === 'hand-state' && receipt?.panelHidden === false && debugState?.meshVisible && debugState.vertexCount > 0 && debugState.faceCount > 0) break;
      await delay(250);
    }
    if (!debugState?.meshVisible) throw new Error('hand surface never became visible');
    if (!debugState.fixtureMode) throw new Error('visual witness must identify its fixture authority');
    if (debugState.runtimeOwner !== 'hand-state-runtime') throw new Error(`runtime owner mismatch: ${debugState.runtimeOwner}`);
    if ((debugState.vertexCount || 0) <= 0 || (debugState.faceCount || 0) <= 0) throw new Error('hand surface has no indexed geometry');

    phase = 'initialize_finger_fluid';
    const fluidReceipt = await evaluate(socket, `(async () => {
      const frame = document.getElementById('hand-state-runtime-frame');
      const initialize = frame?.contentWindow?.__kaminosHandStateInitFingerJuice;
      const probe = frame?.contentWindow?.__kaminosHandStateProbeFingerJuice;
      const fixturePacket = frame?.contentWindow?.__kaminosHandStateFixtureEmitterPacket;
      const read = frame?.contentWindow?.__kaminosHandStateDebugState;
      if (typeof initialize !== 'function' || typeof probe !== 'function' || typeof fixturePacket !== 'function' || typeof read !== 'function') throw new Error('finger-fluid witness API missing');
      await initialize();
      const { growth, respawn } = await probe(fixturePacket(), 12);
      return { state: read(), growth, respawn };
    })()`);
    debugState = fluidReceipt?.state || null;
    emitterGrowthReceipt = fluidReceipt?.growth || null;
    inactiveEmitterRespawnReceipt = fluidReceipt?.respawn || null;
    if (debugState?.fingerJuice?.solverBackend !== 'webgpu_compute') {
      throw new Error(`finger-fluid solver route mismatch: ${debugState?.fingerJuice?.solverBackend || 'missing'}`);
    }
    if (debugState?.fingerJuice?.renderBackend !== 'webgpu_direct_render') {
      throw new Error(`finger-fluid renderer route mismatch: ${debugState?.fingerJuice?.renderBackend || 'missing'}`);
    }
    if (debugState?.fingerJuice?.solverRoute !== 'webgpu-pbf-linked-cell-fluid-v0') {
      throw new Error(`continuous solver identity mismatch: ${debugState?.fingerJuice?.solverRoute || 'missing'}`);
    }
    if (debugState?.fingerJuice?.requestedRenderer !== 'webgpu-screen-space-liquid-refraction-v0'
      || debugState?.fingerJuice?.effectiveRenderer !== 'webgpu-screen-space-liquid-refraction-v0') {
      throw new Error(`continuous renderer identity mismatch: ${JSON.stringify(debugState?.fingerJuice)}`);
    }
    if (debugState?.fingerJuice?.truthScene !== 'live_hand_inlets') {
      throw new Error(`live inlet truth scene mismatch: ${debugState?.fingerJuice?.truthScene || 'missing'}`);
    }
    if (emitterGrowthReceipt?.activeInletCount !== 5) {
      throw new Error(`finger-fluid live inlet count mismatch: ${emitterGrowthReceipt?.activeInletCount ?? 'missing'}`);
    }
    if (!inactiveEmitterRespawnReceipt || inactiveEmitterRespawnReceipt.particleCount <= 0) {
      throw new Error(`finger-fluid inactive particle respawn failed: ${inactiveEmitterRespawnReceipt?.particleCount ?? 'missing'}`);
    }
    if (debugState?.fingerJuice?.liveInlets?.activeInletCount !== 5
      || debugState?.fingerJuice?.liveInlets?.inlets?.filter(inlet => inlet.active).length !== 5) {
      throw new Error(`continuous inlet packet did not preserve all five fingertips: ${JSON.stringify(debugState?.fingerJuice?.liveInlets)}`);
    }
    if (debugState?.fingerJuice?.activeEmitterCount !== 5) {
      throw new Error('fixture witness must capture all five active emitters');
    }
    if ((debugState?.fingerJuice?.directRenderFrameCount || 0) <= 0) {
      throw new Error('continuous fluid route submitted no render frame');
    }
    if ((debugState?.fingerJuice?.screenSpaceRefractionRenderFrameCount || 0) <= 0) {
      throw new Error('continuous fluid route completed no refraction render frame');
    }
    if ((debugState?.fingerJuice?.screenSpaceSurfaceAccumulationPassCount || 0) <= 0) {
      throw new Error('continuous fluid route accumulated no liquid surface');
    }
    if ((debugState?.fingerJuice?.screenSpaceRefractionCompositePassCount || 0) <= 0) {
      throw new Error('continuous fluid route completed no refraction composite');
    }
    const fatalConsole = consoleEvents.filter(event => event.type === 'exception' || event.type === 'error');
    if (fatalConsole.length) throw new Error(`browser console emitted ${fatalConsole.length} fatal event(s)`);

    phase = 'capture';
    await delay(1000);
    const screenshot = await request(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
    phase = 'complete';
    writeReport({ status: 'passed', screenshot: out });
    socket.close();
    browser.kill('SIGTERM');
  } catch (error) {
    writeReport({ status: 'failed', error: `${error.name}: ${error.message}` });
    browser.kill('SIGTERM');
    throw error;
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
