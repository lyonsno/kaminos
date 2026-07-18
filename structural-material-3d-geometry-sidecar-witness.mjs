#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  EFFIGY_TILE_GEOMETRY_AUTHORITY,
  EFFIGY_TILE_GEOMETRY_ROUTE,
} from './structural-material-3d-geometry-sidecar.js';
import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE } from './structural-material-3d-webgpu-hot-sidecar.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE } from './structural-material-3d-webgpu-tear.js';

const SCHEMA = 'kaminos.structural-material.effigy-tile-browser-witness.v0';
const BODY_MARKER = 'Kaminos Layered Structural Sidecar';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    values.set(token.slice(2), value);
    index += 1;
  }
  for (const required of ['url', 'out', 'intact', 'compliance', 'fracture', 'binding']) {
    if (!values.has(required)) throw new Error(`missing required --${required}`);
  }
  const positive = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
    return value;
  };
  return {
    url: values.get('url'),
    out: resolve(values.get('out')),
    intact: resolve(values.get('intact')),
    compliance: resolve(values.get('compliance')),
    fracture: resolve(values.get('fracture')),
    binding: resolve(values.get('binding')),
    debugPort: positive('debug-port', 9223),
    width: positive('width', 1280),
    height: positive('height', 820),
    loadTimeoutMs: positive('load-timeout-ms', 30000),
  };
}

function errorRecord(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
}

async function connectCdp(debugPort) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error(`no page target on CDP port ${debugPort}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
      else handlers.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }));
  };
  const evaluate = async (expression, awaitPromise = false) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  };
  return { socket, send, evaluate, runtimeErrors };
}

async function waitFor(evaluate, expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(expression, true);
    if (lastValue) return lastValue;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  throw new Error(`timed out waiting for ${label}; last value ${JSON.stringify(lastValue)}`);
}

async function capture(send, path) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(screenshot.data, 'base64');
  if (bytes.length < 2000) throw new Error(`screenshot ${path} is suspiciously small: ${bytes.length}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { path, byteLength: bytes.length };
}

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  const raw = process.argv.slice(2);
  const outputIndex = raw.indexOf('--out');
  const output = outputIndex >= 0 && raw[outputIndex + 1] ? resolve(raw[outputIndex + 1]) : null;
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({
      schema: SCHEMA,
      status: 'failed',
      failurePhase: 'configuration',
      requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
      requestedGeometryRoute: EFFIGY_TILE_GEOMETRY_ROUTE,
      requestedExecutionRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
      effectivePageRoute: null,
      effectiveGeometryRoute: null,
      effectiveExecutionRoute: null,
      requestedConfig: { arguments: raw },
      effectiveConfig: null,
      lastTrustworthyEvidence: null,
      error: errorRecord(error),
    }, null, 2)}\n`);
  }
  console.error(error.message);
  process.exit(2);
}

const report = {
  schema: SCHEMA,
  status: 'failed',
  failurePhase: 'initialization',
  requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectivePageRoute: null,
  requestedGeometryRoute: EFFIGY_TILE_GEOMETRY_ROUTE,
  effectiveGeometryRoute: null,
  requestedGeometryAuthority: EFFIGY_TILE_GEOMETRY_AUTHORITY,
  effectiveGeometryAuthority: null,
  requestedExecutionRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
  effectiveExecutionRoute: null,
  requestedBindingRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
  effectiveBindingRoute: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
  requestedConfig: { ...config },
  effectiveConfig: null,
  browserVersion: null,
  contactNode: null,
  intact: null,
  compliance: null,
  fracture: null,
  binding: null,
  screenshots: {},
  checks: {},
  runtimeErrors: [],
  lastTrustworthyEvidence: null,
  error: null,
};

let cdp = null;
try {
  mkdirSync(dirname(config.out), { recursive: true });
  report.failurePhase = 'browser-connection';
  cdp = await connectCdp(config.debugPort);
  const { send, evaluate } = cdp;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: config.width,
    height: config.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const version = await send('Browser.getVersion');
  report.browserVersion = version.product;
  report.effectiveConfig = { ...config, cacheDisabled: true, deviceScaleFactor: 1 };

  report.failurePhase = 'page-load';
  const url = new URL(config.url);
  url.searchParams.set('effigyWitness', String(Date.now()));
  await send('Page.navigate', { url: url.href });
  await waitFor(
    evaluate,
    `document.body?.innerText.includes(${JSON.stringify(BODY_MARKER)}) || document.title.includes('Kaminos')`,
    config.loadTimeoutMs,
    'page body identity',
  );
  await waitFor(
    evaluate,
    `typeof window.__structuralMaterial3dWitness === 'function' &&
      typeof window.__structuralMaterial3dRunGpuSympatheticTear === 'function' &&
      typeof window.__structuralMaterial3dRunGpuBinding === 'function' &&
      window.__structuralMaterial3dWitness().geometrySidecar?.status === 'passed'`,
    config.loadTimeoutMs,
    'validated effigy sidecar',
  );

  report.failurePhase = 'intact-state';
  report.intact = await evaluate('window.__structuralMaterial3dWitness()');
  report.lastTrustworthyEvidence = { phase: 'intact-state', geometrySidecar: report.intact.geometrySidecar };
  report.screenshots.intact = await capture(send, config.intact);
  report.contactNode = await evaluate(`(() => {
    const sidecar = window.__structuralMaterial3dGeometrySidecar();
    const candidates = sidecar.cells.filter(cell =>
      !cell.pinned && cell.restCenter.x <= 0.25 && cell.restCenter.y >= 0.25 &&
      cell.restCenter.y <= 0.75 && cell.restCenter.z === 1
    );
    return candidates.sort((a, b) => a.restCenter.x - b.restCenter.x)[0] || null;
  })()`);
  if (!report.contactNode) throw new Error('no visible near-support effigy contact node');

  const interaction = magnitude => ({
    kind: 'camera-relative-picked-layered-drag',
    authority: 'camera-relative-picked-contact-force-envelope-v0',
    gestureId: 'effigy-tile-compliance-to-fracture-v0',
    point: report.contactNode.restCenter,
    displayPoint: report.contactNode.currentCenter,
    contactIdentity: {
      authority: 'stable-rest-material-contact-v0',
      kind: 'node',
      id: report.contactNode.structuralNodeId,
      segmentT: null,
    },
    vector: { x: 0.84, y: 0.12, z: -0.53 },
    magnitude,
    radius: 0.2,
    inputLoad: magnitude,
    contactRamp: Math.min(1, magnitude / 0.45),
  });

  report.failurePhase = 'prefracture-compliance';
  const lowReceipt = await evaluate(
    `window.__structuralMaterial3dRunGpuSympatheticTear(${JSON.stringify({
      useCurrentState: true,
      interaction: interaction(0.2),
    })})`,
    true,
  );
  report.compliance = await evaluate('window.__structuralMaterial3dWitness()');
  report.compliance.receipt = lowReceipt;
  report.lastTrustworthyEvidence = {
    phase: 'prefracture-compliance',
    receiptStatus: lowReceipt?.status || null,
    geometryTransitionLedger: report.compliance.geometryTransitionLedger,
  };
  report.screenshots.compliance = await capture(send, config.compliance);

  report.failurePhase = 'fracture';
  const highReceipt = await evaluate(
    `window.__structuralMaterial3dRunGpuSympatheticTear(${JSON.stringify({
      useCurrentState: true,
      interaction: interaction(1.7),
    })})`,
    true,
  );
  report.fracture = await evaluate('window.__structuralMaterial3dWitness()');
  report.fracture.receipt = highReceipt;
  report.lastTrustworthyEvidence = {
    phase: 'fracture',
    receiptStatus: highReceipt?.status || null,
    geometrySidecar: report.fracture.geometrySidecar,
    geometryTransitionLedger: report.fracture.geometryTransitionLedger,
  };
  report.screenshots.fracture = await capture(send, config.fracture);

  report.failurePhase = 'binding';
  const bindingReceipt = await evaluate(
    `window.__structuralMaterial3dRunGpuBinding(${JSON.stringify({
      point: report.contactNode.restCenter,
      radius: 0.5,
      strength: 2,
    })})`,
    true,
  );
  report.binding = await evaluate('window.__structuralMaterial3dWitness()');
  report.binding.receipt = bindingReceipt;
  report.lastTrustworthyEvidence = {
    phase: 'binding',
    receiptStatus: bindingReceipt?.status || null,
    geometrySidecar: report.binding.geometrySidecar,
    geometryTransitionLedger: report.binding.geometryTransitionLedger,
  };
  report.screenshots.binding = await capture(send, config.binding);

  const complianceTransition = report.compliance.geometryTransitionLedger.at(-1);
  const fractureTransitions = report.fracture.geometryTransitionLedger.slice(
    report.compliance.geometryTransitionLedger.length,
  );
  const fractureTransition = fractureTransitions.find(transition => transition.newFractureFaceCount > 0);
  const bindingTransitions = report.binding.geometryTransitionLedger.slice(
    report.fracture.geometryTransitionLedger.length,
  );
  const bindingTransition = bindingTransitions.find(transition =>
    transition.fractureFaceCountAfter < transition.fractureFaceCountBefore
  );

  report.effectivePageRoute = report.binding.effectiveRoute;
  report.effectiveGeometryRoute = report.binding.effectiveGeometryRoute;
  report.effectiveGeometryAuthority = report.binding.geometryAuthority;
  report.effectiveExecutionRoute = highReceipt?.effectiveRoute || null;
  report.effectiveBindingRoute = bindingReceipt?.effectiveRoute || null;
  report.effectiveBackend = highReceipt?.effectiveBackend || null;
  report.cpuFallbackUsed = highReceipt?.cpuFallbackUsed ?? null;
  report.runtimeErrors = [...cdp.runtimeErrors];
  report.checks = {
    pageRouteIdentity: report.effectivePageRoute === STRUCTURAL_MATERIAL_3D_ROUTE,
    geometryRouteIdentity: report.effectiveGeometryRoute === EFFIGY_TILE_GEOMETRY_ROUTE,
    geometryAuthorityIdentity: report.effectiveGeometryAuthority === EFFIGY_TILE_GEOMETRY_AUTHORITY,
    executionRouteIdentity: report.effectiveExecutionRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_TEAR_ROUTE,
    bindingRouteIdentity: report.effectiveBindingRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_BINDING_ROUTE,
    nativeWebGpu: report.effectiveBackend === 'webgpu' && report.cpuFallbackUsed === false,
    intactValidated: report.intact.geometrySidecar?.status === 'passed',
    intactHasClosedShell: report.intact.geometrySidecar?.summary?.outerFaceCount > 0,
    intactHasNoFractureFaces: report.intact.geometrySidecar?.summary?.fractureFaceCount === 0,
    complianceReceiptPassed: lowReceipt?.status === 'passed',
    complianceKeptConnectivity: complianceTransition?.bondLivenessChanged === false,
    complianceMovedContactSurface: complianceTransition?.contactSurfaceDelta > 0.001,
    compliancePrecededFracture: complianceTransition?.prefractureCompliance === true,
    complianceHasNoFractureFaces: report.compliance.geometrySidecar?.summary?.fractureFaceCount === 0,
    fractureReceiptPassed: highReceipt?.status === 'passed',
    fractureChangedConnectivity: fractureTransition?.bondLivenessChanged === true,
    fractureExposedStructuralFaces: fractureTransition?.newFractureFaceCount > 0,
    fractureFacesCarryNoValidationErrors: report.fracture.geometrySidecar?.validation?.errorCount === 0,
    bindingReceiptPassed: bindingReceipt?.status === 'passed',
    bindingReducedFractureFaces: Boolean(bindingTransition),
    bindingFacesCarryNoValidationErrors: report.binding.geometrySidecar?.validation?.errorCount === 0,
    screenshotsWritten: Object.values(report.screenshots).every(entry => entry.byteLength > 2000),
    noRuntimeErrors: report.runtimeErrors.length === 0,
  };
  const failedChecks = Object.entries(report.checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failedChecks.length > 0) throw new Error(`effigy tile checks failed: ${failedChecks.join(', ')}`);
  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = { phase: 'complete', checks: report.checks };
} catch (error) {
  report.error = errorRecord(error);
  report.runtimeErrors = cdp ? [...cdp.runtimeErrors] : report.runtimeErrors;
  process.exitCode = 1;
} finally {
  cdp?.socket?.close();
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
}
