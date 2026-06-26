#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8096/lerms-finger-juice.html?lerms_world_finger_juice=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-lerms-finger-juice-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9446);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-lerms-finger-juice-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 1700);
const witnessSteps = Number(args.get('--witness-steps') || 180);

let phase = 'initializing';
let stderr = '';
let primaryOutputWritten = false;
let browserVersion = null;
let lastTrustworthyState = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.lerms-finger-juice-witness.v0',
    requestedUrl: url,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    witnessSteps,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
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

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 10000);
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

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
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

async function run() {
  let browser = null;
  let ws = null;
  try {
    phase = 'launch_chrome';
    browser = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--headless=new',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    browser.stderr.on('data', chunk => { stderr += String(chunk); });

    phase = 'connect_cdp';
    const version = await waitForCdp();
    browserVersion = version.Browser || null;
    const targets = await cdpFetch('/json/list');
    const page = targets.find(target => target.type === 'page' && target.url.includes('lerms_world_finger_juice=1')) || targets.find(target => target.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'no debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);

    phase = 'settle_route';
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Runtime.enable');
    await delay(settleMs);

    phase = 'read_debug_state';
    const state = await evaluate(ws, `window.__lermsFingerJuiceStepForWitness
      ? window.__lermsFingerJuiceStepForWitness({ steps: ${JSON.stringify(witnessSteps)}, dt: 1 / 60 })
      : window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug()`);
    lastTrustworthyState = state;
    assert.ok(state, 'missing lerms finger-juice debug state');
    assert.equal(state.effectiveRoute, 'world-space-ballistic-surface-flow-particles-v0', 'wrong effectiveRoute');
    assert.equal(state.routeActive, true, 'route did not activate');
    assert.equal(state.terrainContract, 'hill-of-hills-heightfield-collision-v0', 'wrong terrain contract');
    assert.equal(state.simulation_authority, 'synthetic_fixture', 'wrong simulation_authority');
    assert.equal(state.evidence_kind, 'synthetic_fixture', 'wrong evidence_kind');
    assert.equal(state.authority?.simulation_safe, true, 'synthetic fixture packet did not become simulation-safe');
    assert.ok(state.hand_sample_space?.id, 'missing hand sample space identity');
    assert.ok(state.lerms_world_frame?.world_from_hand_sample, 'missing world_from_hand_sample transform identity');
    assert.equal(state.visualRenderer, 'source-legible-phase-breadcrumbs-v2', 'wrong visual renderer');
    assert.ok(state.particleCount > 0, 'route did not spawn particles');
    assert.ok(state.surfaceFlowCount > 0, 'route did not produce surface-flow particles');
    assert.ok(state.trailSampleCount >= 180, 'route did not retain enough visual trail samples');
    assert.ok(state.trailEmitterCount >= 3, 'route did not retain trails from all synthetic emitters');
    assert.ok(state.surfaceStreakCount > 0, 'route did not expose surface streak evidence');
    assert.ok(state.trailSpanZ > 0.45, 'route trails did not preserve forward travel span');
    assert.ok(state.sourceAnchorCount >= 3, 'route did not preserve separate source anchors');
    assert.ok(state.maxTrailSegmentLength < 0.34, 'route contains a false long trail bridge');
    assert.ok(state.airborneBreadcrumbCount > 0, 'route did not preserve airborne breadcrumb evidence');
    assert.ok(state.impactRingCount > 0, 'route did not preserve impact/contact ring evidence');
    assert.ok(state.surfaceSmearCount > 0, 'route did not preserve surface smear evidence');
    assert.ok(state.lermImpulseCount > 0, 'route did not produce lerm impulse evidence');
    assert.ok(state.goinImpulseCount > 0, 'route did not produce goin impulse evidence');

    phase = 'capture_screenshot';
    const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const png = Buffer.from(shot.data, 'base64');
    assert.ok(png.length > 4096, 'screenshot is too small to be credible visual evidence');
    assert.equal(png.readUInt32BE(0), 0x89504e47, 'screenshot is not PNG');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    primaryOutputWritten = true;

    phase = 'complete';
    writeReport({
      failure_phase: null,
      screenshot: out,
      effectiveRoute: state.effectiveRoute,
      terrainContract: state.terrainContract,
      visualRenderer: state.visualRenderer,
      simulation_authority: state.simulation_authority,
      evidence_kind: state.evidence_kind,
      hand_sample_space: state.hand_sample_space,
      lerms_world_frame: state.lerms_world_frame,
      particleCount: state.particleCount,
      surfaceFlowCount: state.surfaceFlowCount,
      trailSampleCount: state.trailSampleCount,
      trailEmitterCount: state.trailEmitterCount,
      surfaceStreakCount: state.surfaceStreakCount,
      trailSpanZ: state.trailSpanZ,
      sourceAnchorCount: state.sourceAnchorCount,
      maxTrailSegmentLength: state.maxTrailSegmentLength,
      airborneBreadcrumbCount: state.airborneBreadcrumbCount,
      impactRingCount: state.impactRingCount,
      surfaceSmearCount: state.surfaceSmearCount,
      lermImpulseCount: state.lermImpulseCount,
      goinImpulseCount: state.goinImpulseCount,
      maxRangeZ: state.maxRangeZ,
      state,
    });
  } catch (error) {
    writeReport({
      error: error.message,
      lastTrustworthyState,
    });
    throw error;
  } finally {
    if (ws) ws.close();
    if (browser && !browser.killed) browser.kill('SIGTERM');
  }
}

await run();
