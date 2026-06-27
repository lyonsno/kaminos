#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inflateSync as zlibInflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8096/lerms-finger-juice.html?lerms_world_finger_juice=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-lerms-finger-juice-witness.png');
const denseDiagnosticOut = resolve(args.get('--dense-out') || out.replace(/\.png$/i, '.dense-crop.png'));
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9446);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-lerms-finger-juice-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 1700);
const witnessSteps = Number(args.get('--witness-steps') || 180);
const respawnProbeSteps = Number(args.get('--respawn-steps') || 620);
const extendedFlowSteps = Number(args.get('--extended-flow-steps') || 420);
const viewportWidth = Number(args.get('--viewport-width') || 2048);
const viewportHeight = Number(args.get('--viewport-height') || 1124);
const largeViewportSmokeWitness = 'large-operator-viewport-2048x1124-v0';

let phase = 'initializing';
let stderr = '';
let primaryOutputWritten = false;
let browserVersion = null;
let lastTrustworthyState = null;
let lastVisualEvidence = null;
const consoleEvents = [];

function summarizeConsoleEvent(event) {
  if (event.method === 'Runtime.consoleAPICalled') {
    return {
      method: event.method,
      type: event.params.type,
      text: (event.params.args || []).map(arg => arg.value || arg.description || arg.unserializableValue || '').join(' '),
    };
  }
  if (event.method === 'Runtime.exceptionThrown') {
    return {
      method: event.method,
      type: 'exception',
      text: event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text || 'Runtime exception',
    };
  }
  return {
    method: event.method,
    type: event.params.entry?.level || 'log',
    text: event.params.entry?.text || '',
  };
}

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
    consoleEvents: consoleEvents.map(summarizeConsoleEvent),
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

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, channels, rows };
}

function isFingerJuicePixel(r, g, b) {
  const redJuice = r > 120 && r > g * 1.28 && r > b * 1.14;
  const cyanJuice = g > 125 && b > 105 && g > r * 1.18;
  const purpleJuice = b > 125 && r > 105 && b > g * 1.04;
  return redJuice || cyanJuice || purpleJuice;
}

function fingerJuicePixelKind(r, g, b) {
  if (r > 120 && r > g * 1.28 && r > b * 1.14) return 'red';
  if (g > 125 && b > 105 && g > r * 1.18) return 'cyan';
  if (b > 125 && r > 105 && b > g * 1.04) return 'purple';
  return null;
}

function measureVisualActivity(buffer) {
  const png = parsePngRgba(buffer);
  let interestingPixelCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const dilatedActivity = new Uint8Array(png.width * png.height);
  const dilationRadius = 7;
  for (let y = 0; y < png.height; y += 1) {
    const row = png.rows[y];
    for (let x = 0; x < png.width; x += 1) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      if (!isFingerJuicePixel(r, g, b)) continue;
      interestingPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -dilationRadius; dy <= dilationRadius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= png.height) continue;
        for (let dx = -dilationRadius; dx <= dilationRadius; dx += 1) {
          if (dx * dx + dy * dy > dilationRadius * dilationRadius) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= png.width) continue;
          dilatedActivity[yy * png.width + xx] = 1;
        }
      }
    }
  }

  const totalPixels = png.width * png.height;
  let dilatedActivityCount = 0;
  for (const pixel of dilatedActivity) {
    if (pixel) dilatedActivityCount += 1;
  }
  const hasActivity = interestingPixelCount > 0;
  const activityBounds = hasActivity
    ? {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      }
    : null;
  const activityBoundsArea = activityBounds ? activityBounds.width * activityBounds.height : 0;
  return {
    width: png.width,
    height: png.height,
    interestingPixelCount,
    interestingPixelRatio: interestingPixelCount / Math.max(1, totalPixels),
    filledActivityRatio: interestingPixelCount / Math.max(1, totalPixels),
    dilatedActivityCount,
    dilationRadius,
    dilatedActivityRatio: dilatedActivityCount / Math.max(1, totalPixels),
    activityBounds,
    activityBoundsAreaRatio: activityBoundsArea / Math.max(1, totalPixels),
    activityBoundsWidthRatio: (activityBounds?.width || 0) / Math.max(1, png.width),
    activityBoundsHeightRatio: (activityBounds?.height || 0) / Math.max(1, png.height),
  };
}

function measureVisualFailures(buffer) {
  const png = parsePngRgba(buffer);
  const width = png.width;
  const height = png.height;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = png.rows[y];
    for (let x = 0; x < width; x += 1) {
      const i = x * png.channels;
      if (isFingerJuicePixel(row[i], row[i + 1], row[i + 2])) {
        mask[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const components = [];
  const stack = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    visited[start] = 1;
    stack.push(start);
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let redPixelCount = 0;
    let cyanPixelCount = 0;
    let purplePixelCount = 0;
    while (stack.length) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const row = png.rows[y];
      const channelIndex = x * png.channels;
      const kind = fingerJuicePixelKind(row[channelIndex], row[channelIndex + 1], row[channelIndex + 2]);
      if (kind === 'red') redPixelCount += 1;
      else if (kind === 'cyan') cyanPixelCount += 1;
      else if (kind === 'purple') purplePixelCount += 1;
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const next = yy * width + xx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }
    }
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const boundsArea = Math.max(1, componentWidth * componentHeight);
    const aspect = Math.max(componentWidth / Math.max(1, componentHeight), componentHeight / Math.max(1, componentWidth));
    const dominantColorCount = Math.max(redPixelCount, cyanPixelCount, purplePixelCount);
    components.push({
      area,
      x: minX,
      y: minY,
      width: componentWidth,
      height: componentHeight,
      aspect: Number(aspect.toFixed(4)),
      fill: Number((area / boundsArea).toFixed(4)),
      redPixelCount,
      cyanPixelCount,
      purplePixelCount,
      dominantColorRatio: Number((dominantColorCount / Math.max(1, area)).toFixed(4)),
    });
  }
  components.sort((a, b) => b.area - a.area);
  const longThinComponents = components.filter(component =>
    component.area >= 700
      && Math.max(component.width, component.height) >= 150
      && component.aspect >= 6.5
      && component.fill <= 0.72
  );
  const elongatedBandComponents = components.filter(component =>
    component.area >= 5200
      && Math.max(component.width, component.height) >= 190
      && component.aspect >= 3.05
      && component.fill <= 0.82
      && component.dominantColorRatio >= 0.72
  );
  const largestArea = components[0]?.area || 0;
  const detachedBeadComponents = components.filter(component =>
    component.area >= 90
      && component.area <= Math.max(2600, largestArea * 0.22)
      && component.width >= 8
      && component.height >= 8
      && component.width <= 95
      && component.height <= 95
  );
  const detachedBeadChainScore = detachedBeadComponents.reduce((sum, component) => sum + Math.min(1, component.aspect / 3.5), 0);
  return {
    contract: 'visual-attractor-failure-v0',
    componentCount: components.length,
    longThinComponentCount: longThinComponents.length,
    elongatedBandCount: elongatedBandComponents.length,
    detachedBeadChainCount: detachedBeadComponents.length,
    detachedBeadChainScore: Number(detachedBeadChainScore.toFixed(4)),
    largestComponentArea: largestArea,
    topComponents: components.slice(0, 12),
    longThinComponents: longThinComponents.slice(0, 8),
    elongatedBandComponents: elongatedBandComponents.slice(0, 8),
    detachedBeadComponents: detachedBeadComponents.slice(0, 16),
  };
}

function classifyFullViewportLegibility(metrics) {
  if (metrics.filledActivityRatio >= 0.22 && metrics.dilatedActivityRatio >= 0.45) return 'dense_full_viewport';
  if (
    metrics.filledActivityRatio >= 0.07
      && metrics.activityBoundsAreaRatio >= 0.42
      && metrics.activityBoundsWidthRatio >= 0.68
      && metrics.activityBoundsHeightRatio >= 0.42
  ) return 'broad_sparse_full_viewport';
  if (metrics.filledActivityRatio >= 0.08 && metrics.dilatedActivityRatio >= 0.14) return 'sparse_but_visible_full_viewport';
  return 'too_sparse_full_viewport';
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createCaptureStateConsistency(frozenState, renderedState, postCaptureState) {
  const frozenSteps = numberOrZero(frozenState?.webgpu_cadence?.submitted_steps_total);
  const renderedSteps = numberOrZero(renderedState?.webgpu_cadence?.submitted_steps_total);
  const postSteps = numberOrZero(postCaptureState?.webgpu_cadence?.submitted_steps_total);
  const frozenFlowX = numberOrZero(frozenState?.flowExtentX);
  const postFlowX = numberOrZero(postCaptureState?.flowExtentX);
  const frozenFlowZ = numberOrZero(frozenState?.flowExtentZ);
  const postFlowZ = numberOrZero(postCaptureState?.flowExtentZ);
  return {
    contract: 'witness-frozen-state-capture-v0',
    frozen: Boolean(frozenState?.witness_capture?.frozen),
    frozenSteps,
    renderedSteps,
    postSteps,
    submittedStepDrift: postSteps - frozenSteps,
    renderStepDrift: renderedSteps - frozenSteps,
    flowExtentXDrift: Number(Math.abs(postFlowX - frozenFlowX).toFixed(4)),
    flowExtentZDrift: Number(Math.abs(postFlowZ - frozenFlowZ).toFixed(4)),
    frozenRenderFrameCount: numberOrZero(frozenState?.witness_capture?.renderFrameCount),
    postRenderFrameCount: numberOrZero(postCaptureState?.witness_capture?.renderFrameCount),
  };
}

function createStabilityGrowthStats(beforeState, afterState, visualMetrics) {
  const beforeMaxCell = numberOrZero(beforeState?.spatialPressureStats?.maxCellOccupancy);
  const afterMaxCell = numberOrZero(afterState?.spatialPressureStats?.maxCellOccupancy);
  const beforeExtentX = numberOrZero(beforeState?.flowExtentX);
  const afterExtentX = numberOrZero(afterState?.flowExtentX);
  const beforeExtentZ = numberOrZero(beforeState?.flowExtentZ);
  const afterExtentZ = numberOrZero(afterState?.flowExtentZ);
  const afterVelocityDelta = numberOrZero(afterState?.fluidDepthStats?.maxVelocityDelta);
  const runawayStreakScore = Math.max(
    0,
    numberOrZero(visualMetrics?.activityBoundsAreaRatio) - numberOrZero(visualMetrics?.filledActivityRatio) * 1.85
  );
  return {
    contract: 'witness-stability-growth-v0',
    maxCellOccupancyGrowth: afterMaxCell - beforeMaxCell,
    flowExtentXGrowth: Number((afterExtentX - beforeExtentX).toFixed(4)),
    flowExtentZGrowth: Number((afterExtentZ - beforeExtentZ).toFixed(4)),
    maxVelocityDelta: Number(afterVelocityDelta.toFixed(4)),
    highSpeedParticleCount: numberOrZero(afterState?.stabilityStats?.highSpeedParticleCount),
    denseCellSaturation: numberOrZero(afterState?.stabilityStats?.denseCellSaturation),
    stabilityRiskScore: numberOrZero(afterState?.stabilityStats?.stabilityRiskScore),
    runawayStreakScore: Number(runawayStreakScore.toFixed(4)),
  };
}

async function waitForRouteHooks(ws) {
  for (let i = 0; i < 80; i += 1) {
    const pageState = await evaluate(ws, `({
      url: document.URL,
      readyState: document.readyState,
      hasHooks: Boolean(window.__lermsFingerJuiceStepForWitness || window.__lermsFingerJuiceDebug)
    })`);
    if (pageState.url?.startsWith('chrome-error://')) {
      throw new Error(`route document did not load: ${pageState.url}`);
    }
    if (pageState.hasHooks) return;
    await delay(125);
  }
  throw new Error('lerms finger-juice route hooks did not install');
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
      '--enable-unsafe-webgpu',
      '--disable-gpu-sandbox',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${viewportWidth},${viewportHeight}`,
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
    ws.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data));
      if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(msg.method)) {
        consoleEvents.push({ method: msg.method, params: msg.params });
      }
    });

    phase = 'settle_route';
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Log.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wsRequest(ws, 'Page.reload', { ignoreCache: true });
    await delay(settleMs);
    await waitForRouteHooks(ws);

    phase = 'cadence_probe';
    const cadenceProbe = await evaluate(ws, `(async () => {
      for (let i = 0; i < 80; i += 1) {
        const state = window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
        if (state?.solver_backend === 'webgpu_compute') break;
        await new Promise(resolve => setTimeout(resolve, 125));
      }
      const before = window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
      await new Promise(resolve => setTimeout(resolve, 1200));
      const after = window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
      return {
        beforeStepCount: before?.stepCount ?? null,
        afterStepCount: after?.stepCount ?? null,
        deltaSteps: (after?.stepCount ?? 0) - (before?.stepCount ?? 0),
        beforeCadence: before?.webgpu_cadence || null,
        afterCadence: after?.webgpu_cadence || null,
        deltaSubmittedSteps: (after?.webgpu_cadence?.submitted_steps_total ?? 0) - (before?.webgpu_cadence?.submitted_steps_total ?? 0),
        deltaRenderFrames: (after?.webgpu_cadence?.render_frame_count ?? 0) - (before?.webgpu_cadence?.render_frame_count ?? 0),
        readbackCadence: after?.webgpu_cadence?.readback_period ?? null,
        solver_backend: after?.solver_backend || null,
        render_backend: after?.render_backend || null,
      };
    })()`);
    assert.ok(cadenceProbe.solver_backend === 'webgpu_compute', 'cadence probe did not reach WebGPU compute state');
    assert.equal(cadenceProbe.render_backend, 'webgpu_direct_render', 'cadence probe did not reach direct WebGPU render state');
    assert.ok(cadenceProbe.deltaSubmittedSteps >= 40, 'WebGPU frame loop dropped elapsed simulation time while readback was pending');
    assert.ok(cadenceProbe.deltaRenderFrames > 0, 'direct WebGPU renderer did not produce frames during cadence probe');
    assert.ok(cadenceProbe.readbackCadence >= 0.5, 'readback cadence is not throttled away from the render frame loop');

    phase = 'read_debug_state';
    let state = await evaluate(ws, `(async () => {
      if (window.__lermsFingerJuiceStepForWitness) {
        const [primary, overlap] = await Promise.all([
          window.__lermsFingerJuiceStepForWitness({ steps: ${JSON.stringify(witnessSteps)}, dt: 1 / 60 }),
          window.__lermsFingerJuiceStepForWitness({ steps: 6, dt: 1 / 60 })
        ]);
        window.__lermsFingerJuiceOverlapWitness = { primary, overlap };
        return primary;
      }
      return window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
    })()`);
    const overlapState = await evaluate(ws, `window.__lermsFingerJuiceOverlapWitness || null`);
    const preRespawnState = state;
    const respawnState = await evaluate(ws, `(async () => {
      if (window.__lermsFingerJuiceStepForWitness) {
        return window.__lermsFingerJuiceStepForWitness({ steps: ${JSON.stringify(respawnProbeSteps)}, dt: 1 / 60 });
      }
      return window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
    })()`);
    if (respawnState) state = respawnState;
    lastTrustworthyState = state;
    const webgpuConsoleFailures = consoleEvents.map(summarizeConsoleEvent)
      .filter(event => event.method === 'Runtime.exceptionThrown' || /WebGPU|GPUDevice|MapAsync|already mapped|readback/i.test(event.text));
    assert.deepEqual(webgpuConsoleFailures, [], 'WebGPU route emitted console/runtime errors');
    assert.ok(state, 'missing lerms finger-juice debug state');
    assert.ok(!overlapState || overlapState.overlap?.solver_backend === 'webgpu_compute', 'overlap step did not return WebGPU state');
    assert.equal(state.effectiveRoute, 'world-space-ballistic-surface-flow-particles-v0', 'wrong effectiveRoute');
    assert.equal(state.solver_backend, 'webgpu_compute', 'finger-juice route must use WebGPU compute backend');
    assert.equal(state.solverRoute, 'webgpu_particle_solver_v0', 'wrong WebGPU solver route');
    assert.equal(state.shaderRoute, 'wgsl-ballistic-heightfield-surface-v0', 'wrong WebGPU shader route');
    assert.equal(state.render_backend, 'webgpu_direct_render', 'finger-juice route must use direct WebGPU render backend');
    assert.equal(state.renderRoute, 'webgpu_particle_splat_renderer_v0', 'wrong WebGPU render route');
    assert.equal(state.emitterBufferRoute, 'webgpu_emitter_buffer_v0', 'wrong WebGPU emitter buffer route');
    assert.equal(state.respawnContract, 'wgsl-gpu-emitter-respawn-v0', 'wrong WebGPU respawn contract');
    assert.equal(state.pressureContract, 'wgsl-local-density-pressure-v0', 'wrong WebGPU pressure contract');
    assert.equal(state.spatialPressureContract, 'wgsl-spatial-cell-pressure-v0', 'wrong WebGPU spatial pressure contract');
    assert.equal(state.fluidDepthContract, 'wgsl-spatial-viscosity-pressure-v0', 'wrong WebGPU deeper fluid contract');
    assert.equal(state.visualDampingContract, 'wgsl-visual-streak-bead-damping-v0', 'wrong WebGPU visual damping contract');
    assert.ok(state.adapterInfo, 'missing WebGPU adapterInfo');
    assert.ok(state.cpuOracle, 'missing CPU oracle comparison');
    assert.equal(state.routeActive, true, 'route did not activate');
    assert.equal(state.terrainContract, 'hill-of-hills-heightfield-collision-v0', 'wrong terrain contract');
    assert.equal(state.simulation_authority, 'synthetic_fixture', 'wrong simulation_authority');
    assert.equal(state.evidence_kind, 'synthetic_fixture', 'wrong evidence_kind');
    assert.equal(state.authority?.simulation_safe, true, 'synthetic fixture packet did not become simulation-safe');
    assert.ok(state.hand_sample_space?.id, 'missing hand sample space identity');
    assert.ok(state.lerms_world_frame?.world_from_hand_sample, 'missing world_from_hand_sample transform identity');
    assert.equal(state.visualRenderer, 'source-legible-phase-breadcrumbs-v2', 'wrong visual renderer');
    assert.ok(state.particleCount > 0, 'route did not spawn particles');
    assert.ok(state.gpuRespawnCount > 0, 'GPU route did not recycle expired particles from emitters');
    assert.ok(state.maxParticleAge < 8.2, 'GPU route is still pinning expired particles instead of respawning');
    assert.ok(state.particlesPerEmitter && Object.keys(state.particlesPerEmitter).length >= 3, 'route did not report all emitter particle buckets');
    assert.ok(Number.isFinite(state.ringEmitterLateralDrift?.average_x_delta), 'route did not attribute ring emitter lateral drift');
    assert.ok(Math.abs(state.ringEmitterLateralDrift.average_x_delta) < 0.8, 'ring emitter lateral drift is unbounded');
    assert.equal(state.sourceTruth?.schema, 'lerms.source-truth.v0', 'route did not emit LERMS source truth');
    assert.equal(state.sourceDiagnostics?.sourceTruthSchema, 'lerms.source-truth.v0', 'route did not expose source diagnostics');
    assert.ok(Array.isArray(state.emitterDiagnostics) && state.emitterDiagnostics.length >= 3, 'route did not expose emitter diagnostics');
    assert.ok(state.pressureDensityStats?.pressureNeighborWindow > 0, 'route did not expose pressure neighbor window');
    assert.equal(state.pressureDensityStats?.pressureContract, 'wgsl-local-density-pressure-v0', 'pressure stats do not identify contract');
    assert.ok(state.pressureDensityStats?.surfaceParticleCount > 0, 'pressure stats did not see surface particles');
    assert.equal(state.spatialPressureStats?.pressureContract, 'wgsl-spatial-cell-pressure-v0', 'spatial pressure stats do not identify contract');
    assert.ok(state.spatialPressureStats?.spatialCellCount > 0, 'route did not expose pressure cell count');
    assert.ok(state.spatialPressureStats?.occupiedCellCount > 0, 'route did not expose occupied pressure cells');
    assert.ok(state.spatialPressureStats?.maxCellOccupancy > 0, 'route did not expose pressure cell occupancy');
    assert.equal(state.fluidDepthStats?.pressureContract, 'wgsl-spatial-viscosity-pressure-v0', 'fluid depth stats do not identify contract');
    assert.ok(state.fluidDepthStats?.spatialPressureIterations >= 2, 'route did not expose multiple pressure iterations');
    assert.ok(state.fluidDepthStats?.viscosityAffectedCount > 0, 'route did not expose viscosity affected particles');
    assert.equal(state.surfaceCohesionStats?.pressureContract, 'wgsl-same-chemistry-surface-cohesion-v0', 'surface cohesion stats do not identify contract');
    assert.ok(state.surfaceCohesionStats?.cohesionAffectedCount > 0, 'route did not expose cohesion affected particles');
    assert.ok(state.surfaceCohesionStats?.cohesionNeighborCount > 0, 'route did not expose same-chemistry cohesion neighbors');
    assert.ok(state.surfaceCohesionStats?.ribbonAlignment > 0.05, 'route did not expose directional ribbon alignment');
    assert.equal(state.spatialSurfaceRelaxationStats?.pressureContract, 'wgsl-spatial-surface-relaxation-v0', 'surface relaxation stats do not identify contract');
    assert.ok(state.spatialSurfaceRelaxationStats?.relaxedParticleCount > 0, 'route did not expose relaxed surface particles');
    assert.ok(state.spatialSurfaceRelaxationStats?.denseCellCount > 0, 'route did not expose dense relaxation cells');
    assert.ok(state.spatialSurfaceRelaxationStats?.sheetContinuityRatio > 0.2, 'route did not expose spatial sheet continuity');
    assert.equal(state.stabilityStats?.pressureContract, 'wgsl-stability-damped-relaxation-v0', 'stability stats do not identify damping contract');
    assert.ok(Number.isFinite(state.stabilityStats?.stabilityRiskScore), 'route did not expose stability risk score');
    assert.ok(Number.isFinite(state.stabilityStats?.highSpeedParticleCount), 'route did not expose high-speed particle count');
    assert.equal(state.visualStreakBeadStats?.pressureContract, 'wgsl-visual-streak-bead-damping-v0', 'visual streak/bead stats do not identify damping contract');
    assert.ok(Number.isFinite(state.visualStreakBeadStats?.detachedBeadParticleCount), 'route did not expose detached bead particle count');
    assert.ok(Number.isFinite(state.visualStreakBeadStats?.longStreakParticleCount), 'route did not expose long streak particle count');
    assert.ok(Array.isArray(state.juiceHitEvents) && state.juiceHitEvents.length > 0, 'route did not emit LERMS juice-hit events');
    assert.equal(state.juiceHitEvents[0].schema, 'lerms.juice-hit-event.v0', 'wrong LERMS juice-hit event schema');
    assert.equal(state.juiceHitEvents[0].source?.schema, 'lerms.source-truth.v0', 'juice-hit event missing source truth');
    assert.ok(['lerm', 'goin'].includes(state.juiceHitEvents[0].targetKind), 'juice-hit event target kind is not composer-compatible');
    assert.ok(Array.isArray(state.juiceHitEvents[0].contactWorld), 'juice-hit event missing contact world');
    assert.ok(Array.isArray(state.juiceHitEvents[0].impulse), 'juice-hit event missing impulse');
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

    phase = 'expanded_flow_probe';
    const extendedFlowProbe = await evaluate(ws, `(async () => {
      if (!window.__lermsFingerJuiceStressForWitness) return null;
      const before = window.__lermsFingerJuiceDebug && window.__lermsFingerJuiceDebug();
      const stress = await window.__lermsFingerJuiceStressForWitness({ steps: ${JSON.stringify(extendedFlowSteps)}, dt: 1 / 60 });
      return {
        before,
        state: stress,
        requestedConfig: 'expanded-flow-stress-v0',
        effectiveConfig: stress?.activeWitnessEmitterConfig || stress?.emitterPacket?.route_identity || null,
        sourceFrameId: stress?.sourceDiagnostics?.frameId || null,
        extendedFlowSteps: stress?.extendedFlowSteps || ${JSON.stringify(extendedFlowSteps)},
        extendedFlowSeconds: stress?.extendedFlowSeconds || null,
        particleCount: stress?.particleCount || 0,
        surfaceFlowCount: stress?.surfaceFlowCount || 0,
        flowExtentX: stress?.flowExtentX || 0,
        flowExtentZ: stress?.flowExtentZ || 0,
        spatialOccupiedCells: stress?.spatialPressureStats?.occupiedCellCount || 0,
        maxCellOccupancy: stress?.spatialPressureStats?.maxCellOccupancy || 0,
        viscosityAffectedCount: stress?.fluidDepthStats?.viscosityAffectedCount || 0,
        cohesionAffectedCount: stress?.surfaceCohesionStats?.cohesionAffectedCount || 0,
        cohesionNeighborCount: stress?.surfaceCohesionStats?.cohesionNeighborCount || 0,
        ribbonAlignment: stress?.surfaceCohesionStats?.ribbonAlignment || 0,
        relaxedParticleCount: stress?.spatialSurfaceRelaxationStats?.relaxedParticleCount || 0,
        denseCellCount: stress?.spatialSurfaceRelaxationStats?.denseCellCount || 0,
        sheetContinuityRatio: stress?.spatialSurfaceRelaxationStats?.sheetContinuityRatio || 0,
        stabilityRiskScore: stress?.stabilityStats?.stabilityRiskScore || 0,
        highSpeedParticleCount: stress?.stabilityStats?.highSpeedParticleCount || 0,
        denseCellSaturation: stress?.stabilityStats?.denseCellSaturation || 0,
        pressureContract: stress?.pressureContract || null,
        spatialPressureContract: stress?.spatialPressureContract || null,
        fluidDepthContract: stress?.fluidDepthContract || null,
        surfaceCohesionContract: stress?.surfaceCohesionStats?.pressureContract || null,
        surfaceRelaxationContract: stress?.spatialSurfaceRelaxationStats?.pressureContract || null,
        stabilityContract: stress?.stabilityStats?.pressureContract || null,
        visualDampingContract: stress?.visualStreakBeadStats?.pressureContract || null,
        detachedBeadParticleCount: stress?.visualStreakBeadStats?.detachedBeadParticleCount || 0,
        longStreakParticleCount: stress?.visualStreakBeadStats?.longStreakParticleCount || 0,
        olderAirborneStreakCount: stress?.visualStreakBeadStats?.olderAirborneStreakCount || 0,
      };
    })()`);
    assert.ok(extendedFlowProbe, 'route did not expose expanded witness stress hook');
    lastTrustworthyState = extendedFlowProbe.state || lastTrustworthyState;
    assert.equal(extendedFlowProbe.effectiveConfig, 'expanded-flow-stress-v0', 'expanded witness phase did not install stress emitter config');
    assert.ok(extendedFlowProbe.extendedFlowSteps >= 360, 'expanded witness phase did not run a long enough stress duration');
    assert.equal(extendedFlowProbe.fluidDepthContract, 'wgsl-spatial-viscosity-pressure-v0', 'expanded witness phase lost deeper fluid contract');
    assert.ok(extendedFlowProbe.particleCount >= 1200, 'expanded witness phase did not expose more fluid particles');
    assert.ok(extendedFlowProbe.surfaceFlowCount >= 750, 'expanded witness phase did not produce enough surface-flow particles');
    assert.ok(extendedFlowProbe.flowExtentX > 0.55, 'expanded witness phase remains too horizontally crushed');
    assert.ok(extendedFlowProbe.flowExtentZ > 1.0, 'expanded witness phase did not preserve enough forward flow extent');
    assert.ok(extendedFlowProbe.spatialOccupiedCells >= 8, 'expanded witness phase did not occupy enough pressure cells');
    assert.ok(extendedFlowProbe.viscosityAffectedCount > 0, 'expanded witness phase did not exercise viscosity');
    assert.equal(extendedFlowProbe.surfaceCohesionContract, 'wgsl-same-chemistry-surface-cohesion-v0', 'expanded witness phase lost surface cohesion contract');
    assert.ok(extendedFlowProbe.cohesionAffectedCount >= 240, 'expanded witness phase did not exercise enough surface cohesion');
    assert.ok(extendedFlowProbe.cohesionNeighborCount >= 360, 'expanded witness phase did not retain enough same-chemistry cohesion neighbors');
    assert.ok(extendedFlowProbe.ribbonAlignment > 0.08, 'expanded witness phase did not form directional ribbon alignment');
    assert.equal(extendedFlowProbe.surfaceRelaxationContract, 'wgsl-spatial-surface-relaxation-v0', 'expanded witness phase lost surface relaxation contract');
    assert.ok(extendedFlowProbe.relaxedParticleCount >= 700, 'expanded witness phase did not relax enough surface particles');
    assert.ok(extendedFlowProbe.denseCellCount >= 8, 'expanded witness phase did not retain enough dense relaxation cells');
    assert.ok(extendedFlowProbe.sheetContinuityRatio > 0.55, 'expanded witness phase did not preserve sheet continuity across occupied cells');
    assert.equal(extendedFlowProbe.stabilityContract, 'wgsl-stability-damped-relaxation-v0', 'expanded witness phase lost stability damping contract');
    assert.equal(extendedFlowProbe.visualDampingContract, 'wgsl-visual-streak-bead-damping-v0', 'expanded witness phase lost visual streak/bead damping contract');
    assert.ok(extendedFlowProbe.highSpeedParticleCount <= 180, 'expanded witness phase has too many high-speed surface outliers');
    assert.ok(extendedFlowProbe.stabilityRiskScore < 0.75, 'expanded witness phase stability risk is too high');
    state = extendedFlowProbe.state;
    lastTrustworthyState = state;

    phase = 'freeze_capture_state';
    const frozenCaptureState = await evaluate(ws, `(async () => {
      if (!window.__lermsFingerJuiceFreezeForWitness) return null;
      return window.__lermsFingerJuiceFreezeForWitness({ mode: 'full-viewport-smoke-v0' });
    })()`);
    assert.equal(frozenCaptureState?.witness_capture?.contract, 'witness-frozen-state-capture-v0', 'route did not freeze state before screenshot capture');
    assert.equal(frozenCaptureState?.witness_capture?.frozen, true, 'frozen capture state did not mark itself frozen');
    state = frozenCaptureState;
    lastTrustworthyState = state;

    phase = 'capture_screenshot';
    const visualFrame = await evaluate(ws, `window.__lermsFingerJuiceVisualFrameForWitness && window.__lermsFingerJuiceVisualFrameForWitness()`);
    assert.equal(visualFrame?.visualActivityFrame, 'dense-fluid-activity-clip-v0', 'route did not expose dense fluid visual frame');
    assert.ok(visualFrame.clip?.width > 0 && visualFrame.clip?.height > 0, 'focused visual frame missing valid clip');
    const renderedCaptureState = await evaluate(ws, `window.__lermsFingerJuiceRenderForWitness && window.__lermsFingerJuiceRenderForWitness()`);
    const fullViewportCapture = await evaluate(ws, `(() => {
      const hud = document.getElementById('hud');
      document.documentElement.dataset.witnessCapture = 'full-viewport-smoke-v0';
      return {
        witnessCapture: document.documentElement.dataset.witnessCapture,
        diagnostic_role: 'operator_viewport_primary',
        hudHidden: Boolean(hud?.hidden),
        frozen: Boolean(window.__lermsFingerJuiceFrozenCaptureState?.witness_capture?.frozen),
        captureContract: window.__lermsFingerJuiceFrozenCaptureState?.witness_capture?.contract || null,
        clip: null,
      };
    })()`);
    assert.equal(fullViewportCapture.witnessCapture, 'full-viewport-smoke-v0', 'witness did not mark full viewport capture as primary smoke evidence');
    assert.equal(fullViewportCapture.captureContract, 'witness-frozen-state-capture-v0', 'full viewport capture did not use frozen state contract');
    const fullViewportShot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const fullViewportPng = Buffer.from(fullViewportShot.data, 'base64');
    assert.ok(fullViewportPng.length > 4096, 'full viewport screenshot is too small to be credible visual evidence');
    assert.equal(fullViewportPng.readUInt32BE(0), 0x89504e47, 'full viewport screenshot is not PNG');
    const fullViewportVisualActivityMetrics = measureVisualActivity(fullViewportPng);
    const visualFailureMetrics = measureVisualFailures(fullViewportPng);
    const fullViewportLegibilityStatus = classifyFullViewportLegibility(fullViewportVisualActivityMetrics);
    const postFullViewportState = await evaluate(ws, `window.__lermsFingerJuiceRenderForWitness && window.__lermsFingerJuiceRenderForWitness()`);
    const captureStateConsistency = createCaptureStateConsistency(state, renderedCaptureState, postFullViewportState);
    const stabilityGrowthStats = createStabilityGrowthStats(extendedFlowProbe.before, state, fullViewportVisualActivityMetrics);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, fullViewportPng);
    primaryOutputWritten = true;
    lastVisualEvidence = {
      screenshot: out,
      fullViewportScreenshot: out,
      fullViewportCapture,
      fullViewportVisualActivityMetrics,
      visualFailureMetrics,
      fullViewportLegibilityStatus,
      captureStateConsistency,
      stabilityGrowthStats,
      largeViewportSmokeWitness,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
    };
    assert.equal(captureStateConsistency.submittedStepDrift, 0, 'simulation advanced between frozen state and screenshot capture');
    assert.equal(captureStateConsistency.renderStepDrift, 0, 'render state drifted from frozen capture state');
    assert.ok(captureStateConsistency.flowExtentXDrift <= 0.0001, 'flow extent X drifted during screenshot capture');
    assert.ok(captureStateConsistency.flowExtentZDrift <= 0.0001, 'flow extent Z drifted during screenshot capture');
    assert.ok(stabilityGrowthStats.runawayStreakScore < 0.54, 'full viewport shows too much sparse runaway streak spread');
    assert.ok(stabilityGrowthStats.stabilityRiskScore < 0.75, 'final frozen state stability risk is too high');
    assert.ok(visualFailureMetrics.longThinComponentCount <= 0, 'full viewport contains long thin colored streak components');
    assert.ok(visualFailureMetrics.elongatedBandCount <= 0, 'full viewport contains elongated colored rail components');
    assert.ok(visualFailureMetrics.detachedBeadChainCount <= 18, 'full viewport contains too many detached bead-chain components');

    const captureSurface = await evaluate(ws, `(() => {
      const hud = document.getElementById('hud');
      if (hud) hud.hidden = true;
      document.documentElement.dataset.witnessCapture = 'focused-activity-no-hud-v0';
      return {
        witnessCapture: document.documentElement.dataset.witnessCapture,
        hudHidden: Boolean(hud?.hidden),
      };
    })()`);
    assert.equal(captureSurface.witnessCapture, 'focused-activity-no-hud-v0', 'witness capture surface did not hide HUD occlusion');
    const denseDiagnosticCapture = {
      witnessCapture: 'dense-fluid-activity-clip-v0',
      diagnostic_role: 'diagnostic_crop_secondary',
      clip: visualFrame.clip,
    };
    const denseDiagnosticShot = await wsRequest(ws, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: visualFrame.clip,
    });
    const denseDiagnosticPng = Buffer.from(denseDiagnosticShot.data, 'base64');
    assert.ok(denseDiagnosticPng.length > 4096, 'dense diagnostic screenshot is too small to be credible visual evidence');
    assert.equal(denseDiagnosticPng.readUInt32BE(0), 0x89504e47, 'dense diagnostic screenshot is not PNG');
    const denseDiagnosticVisualActivityMetrics = measureVisualActivity(denseDiagnosticPng);
    mkdirSync(dirname(denseDiagnosticOut), { recursive: true });
    writeFileSync(denseDiagnosticOut, denseDiagnosticPng);

    lastVisualEvidence = {
      screenshot: out,
      fullViewportScreenshot: out,
      fullViewportCapture,
      fullViewportVisualActivityMetrics,
      visualFailureMetrics,
      fullViewportLegibilityStatus,
      captureStateConsistency,
      stabilityGrowthStats,
      largeViewportSmokeWitness,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      denseDiagnosticScreenshot: denseDiagnosticOut,
      denseDiagnosticFrame: visualFrame,
      denseDiagnosticCapture,
      denseDiagnosticVisualActivityMetrics,
      captureSurface,
    };
    assert.ok(fullViewportVisualActivityMetrics.interestingPixelCount > 256, 'full viewport screenshot lacks measurable juice activity');
    assert.notEqual(fullViewportLegibilityStatus, 'too_sparse_full_viewport', 'full viewport screenshot is too sparse to be useful smoke evidence');
    assert.ok(denseDiagnosticVisualActivityMetrics.interestingPixelCount > 256, 'dense diagnostic screenshot lacks measurable juice activity');
    assert.ok(denseDiagnosticVisualActivityMetrics.filledActivityRatio >= 0.22, 'dense diagnostic screenshot is still mostly empty colored-fluid space');
    assert.ok(denseDiagnosticVisualActivityMetrics.dilatedActivityRatio >= 0.45, 'dense diagnostic screenshot does not have enough local fluid occupancy after dilation');
    assert.ok(denseDiagnosticVisualActivityMetrics.activityBoundsAreaRatio >= 0.42, 'dense diagnostic screenshot still frames activity too small');
    assert.ok(denseDiagnosticVisualActivityMetrics.activityBoundsWidthRatio >= 0.68, 'dense diagnostic screenshot does not use enough width for activity');
    assert.ok(denseDiagnosticVisualActivityMetrics.activityBoundsHeightRatio >= 0.48, 'dense diagnostic screenshot does not use enough height for activity');

    phase = 'complete';
    writeReport({
      failure_phase: null,
      screenshot: out,
      fullViewportScreenshot: out,
      fullViewportCapture,
      fullViewportVisualActivityMetrics,
      visualFailureMetrics,
      fullViewportLegibilityStatus,
      captureStateConsistency,
      stabilityGrowthStats,
      largeViewportSmokeWitness,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
      denseDiagnosticScreenshot: denseDiagnosticOut,
      denseDiagnosticFrame: visualFrame,
      denseDiagnosticCapture,
      denseDiagnosticVisualActivityMetrics,
      effectiveRoute: state.effectiveRoute,
      solver_backend: state.solver_backend,
      solverRoute: state.solverRoute,
      shaderRoute: state.shaderRoute,
      render_backend: state.render_backend,
      renderRoute: state.renderRoute,
      renderShaderRoute: state.renderShaderRoute,
      emitterBufferRoute: state.emitterBufferRoute,
      respawnContract: state.respawnContract,
      pressureContract: state.pressureContract,
      spatialPressureContract: state.spatialPressureContract,
      fluidDepthContract: state.fluidDepthContract,
      adapterInfo: state.adapterInfo,
      workgroupSize: state.workgroupSize,
      cpuOracle: state.cpuOracle,
      overlapState,
      cadenceProbe,
      preRespawnState,
      respawnProbeSteps,
      captureSurface,
      visualFrame,
      visualActivityMetrics: denseDiagnosticVisualActivityMetrics,
      extendedFlowProbe: {
        ...extendedFlowProbe,
        before: undefined,
        state: undefined,
      },
      extendedFlowSteps,
      terrainContract: state.terrainContract,
      visualRenderer: state.visualRenderer,
      activeWitnessEmitterConfig: state.activeWitnessEmitterConfig || state.sourceDiagnostics?.configId || null,
      simulation_authority: state.simulation_authority,
      evidence_kind: state.evidence_kind,
      hand_sample_space: state.hand_sample_space,
      lerms_world_frame: state.lerms_world_frame,
      sourceTruth: state.sourceTruth,
      sourceDiagnostics: state.sourceDiagnostics,
      emitterDiagnostics: state.emitterDiagnostics,
      pressureDensityStats: state.pressureDensityStats,
      spatialPressureStats: state.spatialPressureStats,
      fluidDepthStats: state.fluidDepthStats,
      surfaceCohesionStats: state.surfaceCohesionStats,
      spatialSurfaceRelaxationStats: state.spatialSurfaceRelaxationStats,
      stabilityStats: state.stabilityStats,
      visualStreakBeadStats: state.visualStreakBeadStats,
      visualFailureMetrics,
      witnessCaptureState: state.witness_capture,
      juiceHitEventCount: state.juiceHitEventCount,
      juiceHitEvents: state.juiceHitEvents,
      particleCount: state.particleCount,
      gpuRespawnCount: state.gpuRespawnCount,
      maxParticleAge: state.maxParticleAge,
      particlesPerEmitter: state.particlesPerEmitter,
      ringEmitterLateralDrift: state.ringEmitterLateralDrift,
      surfaceFlowCount: state.surfaceFlowCount,
      trailSampleCount: state.trailSampleCount,
      trailEmitterCount: state.trailEmitterCount,
      surfaceStreakCount: state.surfaceStreakCount,
      trailSpanZ: state.trailSpanZ,
      flowExtentX: state.flowExtentX,
      flowExtentZ: state.flowExtentZ,
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
      lastVisualEvidence,
    });
    throw error;
  } finally {
    if (ws) ws.close();
    if (browser && !browser.killed) browser.kill('SIGTERM');
  }
}

await run();
