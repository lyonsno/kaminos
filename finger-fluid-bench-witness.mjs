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
const deviceScaleFactor = Number(args.get('--device-scale-factor') || 1);
const settleMs = Number(args.get('--settle-ms') || 10000);
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
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
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
    if (lastDebugState.runtime?.vorticityConfinementContract !== 'wgsl-neighbor-vorticity-confinement-v0') throw new Error(`vorticity contract mismatch: ${lastDebugState.runtime?.vorticityConfinementContract}`);
    if (lastDebugState.runtime?.freeSurfaceContract !== 'wgsl-neighbor-free-surface-cohesion-v0') throw new Error(`free-surface contract mismatch: ${lastDebugState.runtime?.freeSurfaceContract}`);
    if (lastDebugState.runtime?.restStateContract !== 'wgsl-support-aware-persistent-rest-state-v0') throw new Error(`rest-state contract mismatch: ${lastDebugState.runtime?.restStateContract}`);
    if (lastDebugState.runtime?.supportTransportContract !== 'wgsl-support-tangential-transport-v0') throw new Error(`support-transport contract mismatch: ${lastDebugState.runtime?.supportTransportContract}`);
    if (lastDebugState.runtime?.topologyContract !== 'wgsl-four-neighbor-topology-retention-v0') throw new Error(`topology contract mismatch: ${lastDebugState.runtime?.topologyContract}`);
    if (lastDebugState.runtime?.particleShiftContract !== 'wgsl-opt-in-support-tangential-particle-shift-v0') throw new Error(`particle-shift contract mismatch: ${lastDebugState.runtime?.particleShiftContract}`);
    const requestedRoute = new URL(url);
    const requestedColorMode = requestedRoute.searchParams.get('finger_fluid_color_mode') || 'phase';
    const requestedParticleShiftStrength = Number(requestedRoute.searchParams.get('finger_fluid_particle_shift') ?? 0);
    const effectiveColorMode = lastDebugState.runtime?.effectiveColorMode;
    const effectiveParticleShiftStrength = lastDebugState.runtime?.effectiveParticleShiftStrength;
    if (requestedColorMode !== effectiveColorMode) throw new Error(`silent color-mode fallback rejected: ${JSON.stringify({ requestedColorMode, effectiveColorMode })}`);
    if (requestedParticleShiftStrength !== effectiveParticleShiftStrength) throw new Error(`silent particle-shift fallback rejected: ${JSON.stringify({ requestedParticleShiftStrength, effectiveParticleShiftStrength })}`);
    if (effectiveParticleShiftStrength === 0 && lastDebugState.runtime?.particleShiftPassCount !== 0) throw new Error(`zero-strength route dispatched hidden particle shifting: ${lastDebugState.runtime?.particleShiftPassCount}`);
    if (effectiveParticleShiftStrength > 0 && lastDebugState.runtime?.particleShiftPassCount < lastDebugState.runtime.stepCount * 2) throw new Error(`enabled particle shifting missed required passes: ${JSON.stringify({ particleShiftPassCount: lastDebugState.runtime?.particleShiftPassCount, stepCount: lastDebugState.runtime?.stepCount })}`);
    if (lastDebugState.runtime?.playgroundContract !== 'wgsl-shared-multi-regime-toy-playground-v0') throw new Error(`playground contract mismatch: ${lastDebugState.runtime?.playgroundContract}`);
    if (!lastDebugState.runtime?.playground?.rendered || lastDebugState.runtime.playground.supportGeometryCount < 300) {
      throw new Error(`shared playground geometry is missing from the operator viewport: ${JSON.stringify(lastDebugState.runtime?.playground)}`);
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
    if (quietSupportedPoolCount < 2) {
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
      if (g > 28 && r > 20 && g > r * 1.03 && r > b * 1.12 && max < 105) supportPixels += 1;
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
    if (canvasActivity.activeRatio < 0.09) throw new Error(`native GPU fluid bench too sparse: ${JSON.stringify(canvasActivity)}`);
    if (canvasActivity.supportPixelRatio < 0.025) throw new Error(`shared playground support is not materially visible: ${JSON.stringify(canvasActivity)}`);

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;

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
    lastDebugState = cadenceState;
    if (cadenceProbe.framesPerSecond < 18) throw new Error(`settled GPU fluid cadence below floor: ${JSON.stringify(cadenceProbe)}`);

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
