#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8100/index.html';
const expectedHostId = args.get('--expected-host-id') || null;
const expectedHostRoute = args.get('--expected-host-route') || null;
const expectedPacketSchema = args.get('--expected-packet-schema') || null;
const expectedPacketRoute = args.get('--expected-packet-route') || null;
const expectedDowngrade = args.get('--expected-downgrade') || null;
const out = resolve(args.get('--out') || '/tmp/kaminos-host-surface.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9493);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-host-surface-profile-${port}-${process.pid}`;
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1120);
const settleMs = Number(args.get('--settle-ms') || 2500);
const hookWaitMs = Number(args.get('--hook-wait-ms') || Math.max(settleMs, 15000));
const cdpTimeoutMs = Number(args.get('--cdp-timeout-ms') || Math.max(15000, hookWaitMs));
const preferredCanvasId = expectedHostId === 'glove-well'
  ? 'glove-well-host-canvas'
  : expectedHostId === 'finger-juice'
    ? 'finger-juice-host-canvas'
    : null;

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastDebugState = null;
let visualActivity = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.host-surface-witness.v0',
    requestedUrl: url,
    expectedHostId,
    expectedHostRoute,
    expectedPacketSchema,
    expectedPacketRoute,
    expectedDowngrade,
    debugPort: port,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
    hookWaitMs,
    cdpTimeoutMs,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    consoleEvents,
    lastDebugState,
    visualActivity,
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
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank')
      || pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(125);
  }
  throw new Error(`Chrome page for host surface route did not appear: ${url}`);
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
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, cdpTimeoutMs);
    const onMessage = event => {
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
        const read = window.kaminosHostSurfaceDebugState || window.__kaminosHostSurfaceDebugState;
        if (typeof read === 'function') return read();
        if (read) return read;
        return {
          diagnostic: 'missing_debug_hook',
          href: window.location.href,
          readyState: document.readyState,
          title: document.title,
          bodyText: document.body ? document.body.innerText.slice(0, 240) : null
        };
      })()`);
      const matchesHost = !expectedHostId || lastDebugState?.hostId === expectedHostId;
      if (lastDebugState?.schema === 'kaminos.host-surface.state.v0' && lastDebugState.status !== 'loading' && matchesHost) break;
      await delay(250);
    }

    phase = 'read_debug_state';
    if (!lastDebugState) throw new Error('missing kaminosHostSurfaceDebugState');
    if (lastDebugState.diagnostic === 'missing_debug_hook') throw new Error('missing kaminosHostSurfaceDebugState');
    if (lastDebugState.schema !== 'kaminos.host-surface.state.v0') throw new Error(`host-surface state schema mismatch: ${lastDebugState.schema}`);
    if (expectedHostId && lastDebugState.hostId !== expectedHostId) throw new Error(`host id mismatch: ${lastDebugState.hostId}`);
    if (expectedHostRoute && lastDebugState.hostRoute !== expectedHostRoute) throw new Error(`host route mismatch: ${lastDebugState.hostRoute}`);
    if (expectedPacketSchema && lastDebugState.packetSchema !== expectedPacketSchema) throw new Error(`packet schema mismatch: ${lastDebugState.packetSchema}`);
    if (expectedPacketRoute && lastDebugState.packetRoute !== expectedPacketRoute) throw new Error(`packet route mismatch: ${lastDebugState.packetRoute}`);
    if (expectedDowngrade && !lastDebugState.downgrades?.includes(expectedDowngrade)) throw new Error(`missing downgrade: ${expectedDowngrade}`);
    if (expectedDowngrade && !lastDebugState.sourceDowngrades?.includes(expectedDowngrade)) throw new Error(`missing source downgrade: ${expectedDowngrade}`);
    if (!lastDebugState.sourceAuthority || lastDebugState.sourceAuthority === 'none') throw new Error('host-surface source authority missing');
    if (!lastDebugState.sourceTruthAuthority || lastDebugState.sourceTruthAuthority === 'none') throw new Error('host-surface source-truth authority missing');
    if (!Array.isArray(lastDebugState.rejectedDebugSurfaces)) throw new Error('host-surface rejected debug surfaces missing');
    if (expectedHostId === 'lerms-moving-timeline') {
      const sourceCustody = lastDebugState.sourceCustody || {};
      if (!sourceCustody.lermsOwns?.includes('timelineBehaviorTruth')) throw new Error('missing source custody lermsOwns: timelineBehaviorTruth');
      if (!sourceCustody.kaminosOwns?.includes('host display')) throw new Error('missing source custody kaminosOwns: host display');
    }
    if (expectedHostId === 'finger-juice') {
      const sourceCustody = lastDebugState.sourceCustody || {};
      if (!Array.isArray(sourceCustody.bigPapaOwns) || sourceCustody.bigPapaOwns.length === 0) throw new Error('missing source custody bigPapaOwns');
      if (!Array.isArray(sourceCustody.kaminosOwns) || sourceCustody.kaminosOwns.length === 0) throw new Error('missing source custody kaminosOwns');
    }
    if (expectedHostId === 'glove-well') {
      const sourceCustody = lastDebugState.sourceCustody || {};
      if (!Array.isArray(sourceCustody.greedyOwns) || sourceCustody.greedyOwns.length === 0) throw new Error('missing source custody greedyOwns');
      if (!Array.isArray(sourceCustody.kaminosOwns) || sourceCustody.kaminosOwns.length === 0) throw new Error('missing source custody kaminosOwns');
      if (!Array.isArray(sourceCustody.palmDaddyOwns) || sourceCustody.palmDaddyOwns.length === 0) throw new Error('missing source custody palmDaddyOwns');
      const roles = lastDebugState.surface?.primitiveRoles || lastDebugState.hostSpecific?.primitiveRoles || [];
      for (const role of ['wealth_source', 'rolling_goin', 'hand_skeleton_bone', 'aim_arc_sample', 'lerm_desire_link']) {
        if (!roles.includes(role)) throw new Error(`missing source primitive role: ${role}`);
      }
    }

    phase = 'measure_visual_activity';
    visualActivity = await evaluate(ws, `(() => {
      const actorObjects = [...(window.__kaminosLermsPreviewActorsGroup?.children || [])].map(child => ({
        name: child.name,
        position: child.position ? [Number(child.position.x.toFixed(3)), Number(child.position.y.toFixed(3)), Number(child.position.z.toFixed(3))] : null,
      }));
      if (actorObjects.length || window.__kaminosLermsPreviewActorVisuals?.actorVisualCount) {
        return {
          kind: 'three-scene',
          actorObjectCount: actorObjects.length,
          actorObjects,
          actorVisualCount: window.__kaminosLermsPreviewActorVisuals?.actorVisualCount || 0,
        };
      }
      const preferredCanvas = ${JSON.stringify(preferredCanvasId)} ? document.getElementById(${JSON.stringify(preferredCanvasId)}) : null;
      const canvas = preferredCanvas || document.getElementById('finger-juice-host-canvas') || document.getElementById('glove-well-host-canvas') || document.querySelector('canvas');
      if (canvas && canvas.width && canvas.height) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let activePixels = 0;
          for (let i = 0; i < sample.length; i += 4) {
            const max = Math.max(sample[i], sample[i + 1], sample[i + 2]);
            const min = Math.min(sample[i], sample[i + 1], sample[i + 2]);
            if (max > 50 && max - min > 10) activePixels += 1;
          }
          return { kind: 'canvas', width: canvas.width, height: canvas.height, activePixels };
        }
      }
      return {
        kind: 'three-scene',
        actorObjectCount: actorObjects.length,
        actorObjects,
        actorVisualCount: window.__kaminosLermsPreviewActorVisuals?.actorVisualCount || 0,
      };
    })()`);
    if (visualActivity.kind === 'canvas' && visualActivity.activePixels < 120) {
      throw new Error(`host-surface canvas looks blank: ${JSON.stringify(visualActivity)}`);
    }
    if (visualActivity.kind === 'three-scene' && visualActivity.actorObjectCount <= 0 && visualActivity.actorVisualCount <= 0) {
      throw new Error(`host-surface scene visual layer missing: ${JSON.stringify(visualActivity)}`);
    }

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;
    phase = null;
    writeReport({ ok: true, failure_phase: null, output: out });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  writeReport({ ok: false, error: error.message || String(error) });
  console.error(error);
  process.exitCode = 1;
});
