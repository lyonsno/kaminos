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
const respawnProbeSteps = Number(args.get('--respawn-steps') || 620);
const extendedFlowSteps = Number(args.get('--extended-flow-steps') || 420);

let phase = 'initializing';
let stderr = '';
let primaryOutputWritten = false;
let browserVersion = null;
let lastTrustworthyState = null;
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
        pressureContract: stress?.pressureContract || null,
        spatialPressureContract: stress?.spatialPressureContract || null,
        fluidDepthContract: stress?.fluidDepthContract || null,
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
    state = extendedFlowProbe.state;
    lastTrustworthyState = state;

    phase = 'capture_screenshot';
    await evaluate(ws, `window.__lermsFingerJuiceRenderForWitness && window.__lermsFingerJuiceRenderForWitness()`);
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
    });
    throw error;
  } finally {
    if (ws) ws.close();
    if (browser && !browser.killed) browser.kill('SIGTERM');
  }
}

await run();
