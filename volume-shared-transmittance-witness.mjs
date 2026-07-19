#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const REPORT_IDENTITY = 'kaminos.volume.shared-transmittance-witness.v0';
const FLAMEBOWL_PRESET_ID = 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2';
const FLAMEBOWL_PRESET_LABEL = 'big_raymarch_hero_flamebowl';
const modes = Object.freeze([
  Object.freeze({
    mode: 'ridge-emission-under-ridge-extinction',
    artifact: 'transport-ridge-emission-ridge-extinction.png',
    emission: Object.freeze({ ridge: true, nonRidge: false }),
    extinction: Object.freeze({ ridge: true, nonRidge: false }),
  }),
  Object.freeze({
    mode: 'ridge-emission-under-total-flame-extinction',
    artifact: 'transport-ridge-emission-total-extinction.png',
    emission: Object.freeze({ ridge: true, nonRidge: false }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
  Object.freeze({
    mode: 'nonridge-emission-under-total-flame-extinction',
    artifact: 'transport-nonridge-emission-total-extinction.png',
    emission: Object.freeze({ ridge: false, nonRidge: true }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
  Object.freeze({
    mode: 'complete-flame-under-total-extinction',
    artifact: 'transport-complete-flame-total-extinction.png',
    emission: Object.freeze({ ridge: true, nonRidge: true }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
]);

const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-shared-transmittance-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-shared-transmittance-profile-');

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.socket?.close();
  }
}

try {
  const route = new URL(requestedUrl);
  assert.equal(route.searchParams.get('settings_preset'), FLAMEBOWL_PRESET_ID, 'witness route requires immutable Flamebowl preset identity');
  assert.equal(route.searchParams.get('settings_preset_authority'), 'shared-volume-settings-preset-v2', 'witness route requires shared preset authority');
  assert.equal(route.pathname, '/volume-selective-head-live.html', 'witness route must use the selective-head operator wrapper');
  assert.ok(route.search.includes('role=truthHigh'), 'witness route requires role=truthHigh');
  assert.ok(route.search.includes('composition=raymarch-only-v0'), 'witness route requires composition=raymarch-only-v0');

  failurePhase = 'browser-launch';
  browser = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,960',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { admitted };
  assert.equal(admitted.active, true, 'volume renderer did not become active');
  assert.ok(admitted.backend?.startsWith('WebGPU'), 'effective backend substituted away from WebGPU');
  assert.equal(admitted.sourceSettingsPreset?.sourcePresetAuthority, 'shared-volume-settings-preset-v2', 'shared preset authority missing');
  assert.equal(admitted.sourceSettingsPreset?.presetId, FLAMEBOWL_PRESET_ID, 'effective preset id does not match requested preset');
  assert.equal(admitted.sourceSettingsPreset?.controlCount, 186, 'complete 186-control preset identity was not preserved');
  await delay(settleMs);

  failurePhase = 'same-state-capture';
  const evidence = await evaluate(socket, `
    (async () => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
      if (!prototype?.debugState || !prototype?.sampleFrame || !prototype?.setAppearanceDecompositionMode || !prototype?.sampleSharedTransmittanceContributions) {
        throw new Error('shared-transmittance-runtime-api-missing');
      }
      const digest = async value => {
        const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      };
      const pngDataUrl = image => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.putImageData(new ImageData(Uint8ClampedArray.from(image.rgba), image.width, image.height), 0, 0);
        return canvas.toDataURL('image/png');
      };
      const pixelMetrics = rgba => {
        let litPixels = 0;
        let alphaPixels = 0;
        let lumaSum = 0;
        for (let index = 0; index < rgba.length; index += 4) {
          const r = rgba[index];
          const g = rgba[index + 1];
          const b = rgba[index + 2];
          const a = rgba[index + 3];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (luma > 8) litPixels += 1;
          if (a > 8) alphaPixels += 1;
          lumaSum += luma;
        }
        return {
          litPixels,
          alphaPixels,
          meanLuma: lumaSum / Math.max(1, rgba.length / 4),
          nonblank: litPixels > 64,
        };
      };
      const wrapperState = operator?.debugState?.() || null;
      prototype.setSelectiveHeadLiveCapturePaused(true);
      await new Promise(resolve => setTimeout(resolve, 100));
      const before = prototype.debugState();
      const fixedNow = performance.now();
      const sameStateCaptureId = 'shared-transmittance-f' + before.frameCount + '-s' + before.simStepCount;
      const cameraBefore = basinWindow?.kaminosCameraDebugState?.() || null;
      const cameraHash = await digest(cameraBefore);
      const controlsHash = await digest(before.controls);

      async function captureAppearance(mode) {
        prototype.setVolumePresentationMode('beauty');
        const receipt = operator?.setAppearanceAssay?.(mode) || prototype.setAppearanceDecompositionMode(mode);
        const captureStarted = performance.now();
        const sample = await prototype.sampleFrame({
          advanceSim: false,
          includeRgba: true,
          now: fixedNow,
          sameStateCaptureId,
          baseFrameCount: before.frameCount,
          baseSimStepCount: before.simStepCount,
        });
        if (!sample.ok || !sample.image?.rgba?.length) {
          throw new Error('shared-transmittance-sample-failed:' + mode + ':' + (sample.reason || 'missing-rgba'));
        }
        const rgba = Uint8Array.from(sample.image.rgba);
        return {
          mode,
          receipt,
          appearanceDecompositionReceipt: sample.appearanceDecompositionReceipt,
          durationMs: performance.now() - captureStarted,
          sample: {
            width: sample.image.width,
            height: sample.image.height,
            frameCount: sample.frameCount,
            simStepCount: sample.simStepCount,
            requestedRoute: before.requestedRoute,
            effectiveRoute: sample.effectiveRoute,
            backend: sample.backend,
          },
          pixelHash: await digest(rgba),
          metrics: pixelMetrics(rgba),
          pngDataUrl: pngDataUrl({ width: sample.image.width, height: sample.image.height, rgba }),
        };
      }

      const ridgeEmissionUnderRidgeExtinction = await captureAppearance('ridge-emission-under-ridge-extinction');
      const ridgeEmissionUnderTotalExtinction = await captureAppearance('ridge-emission-under-total-flame-extinction');
      const nonRidgeEmissionUnderTotalExtinction = await captureAppearance('nonridge-emission-under-total-flame-extinction');
      const completeFlameUnderTotalExtinction = await captureAppearance('complete-flame-under-total-extinction');
      const sharedTransportRecomposition = await prototype.sampleSharedTransmittanceContributions({
        sameStateCaptureId,
        baseFrameCount: before.frameCount,
        baseSimStepCount: before.simStepCount,
        now: fixedNow,
      });
      if (!sharedTransportRecomposition?.ok) {
        throw new Error('shared-transmittance-renderer-recomposition-failed:' + JSON.stringify(sharedTransportRecomposition));
      }
      const after = prototype.debugState();
      const cameraAfter = basinWindow?.kaminosCameraDebugState?.() || null;
      return {
        requestedRoute: before.requestedRoute,
        effectiveRoute: before.effectiveRoute,
        backend: before.backend,
        wrapperRoute: wrapperState?.routeIdentity || null,
        requestedRole: wrapperState?.requestedRole || null,
        effectiveRole: wrapperState?.effectiveRole || null,
        requestedComposition: wrapperState?.requestedComposition || null,
        effectiveComposition: wrapperState?.effectiveComposition || null,
        sameStateCaptureId,
        before: {
          frameCount: before.frameCount,
          simStepCount: before.simStepCount,
          controlsHash,
          cameraHash,
        },
        after: {
          frameCount: after.frameCount,
          simStepCount: after.simStepCount,
          controlsHash: await digest(after.controls),
          cameraHash: await digest(cameraAfter),
        },
        captures: [
          ridgeEmissionUnderRidgeExtinction,
          ridgeEmissionUnderTotalExtinction,
          nonRidgeEmissionUnderTotalExtinction,
          completeFlameUnderTotalExtinction,
        ],
        sharedTransportRecomposition,
      };
    })()
  `);
  lastTrustworthyEvidence = { admitted, evidence: stripEvidencePngData(evidence) };

  failurePhase = 'evidence-validation';
  assert.equal(evidence.before.frameCount, evidence.after.frameCount, 'visual capture advanced frame state');
  assert.equal(evidence.before.simStepCount, evidence.after.simStepCount, 'visual capture advanced simulation state');
  assert.equal(evidence.before.controlsHash, evidence.after.controlsHash, 'visual capture mutated authored controls');
  assert.equal(evidence.before.cameraHash, evidence.after.cameraHash, 'visual capture mutated camera');
  assert.equal(evidence.requestedRole, 'truthHigh', 'wrapper requested role drifted');
  assert.equal(evidence.effectiveRole, 'truthHigh', 'wrapper substituted role');
  assert.equal(evidence.requestedComposition, 'raymarch-only-v0', 'wrapper requested composition drifted');
  assert.equal(evidence.effectiveComposition, 'raymarch-only-v0', 'wrapper substituted composition');
  assert.equal(evidence.backend, admitted.backend, 'runtime backend drifted after route admission');
  assert.equal(evidence.captures.length, modes.length, 'focused witness capture count drifted');

  for (const [index, capture] of evidence.captures.entries()) {
    const expected = modes[index];
    assert.equal(capture.mode, expected.mode, `capture order or identity drifted at index ${index}`);
    assert.equal(capture.receipt.requestedMode, expected.mode, `requested mode drifted for ${expected.mode}`);
    assert.equal(capture.receipt.effectiveMode, expected.mode, `effective mode drifted for ${expected.mode}`);
    assert.equal(capture.receipt.fallbackReason, null, `mode fallback applied for ${expected.mode}`);
    assert.equal(capture.metrics.nonblank, true, `visual output is blank for ${expected.mode}`);
    assert.ok(capture.pixelHash, `pixel hash is missing for ${expected.mode}`);
    assert.equal(capture.sample.frameCount, evidence.before.frameCount, `sample frame drifted for ${expected.mode}`);
    assert.equal(capture.sample.simStepCount, evidence.before.simStepCount, `sample simulation step drifted for ${expected.mode}`);
    const receipt = capture.appearanceDecompositionReceipt;
    const application = receipt.application;
    assert.equal(receipt.effectiveMode, expected.mode, `sampled mode drifted for ${expected.mode}`);
    assert.deepEqual(receipt.requestedEmissionMask, expected.emission, `requested emission mask drifted for ${expected.mode}`);
    assert.deepEqual(receipt.effectiveEmissionMask, expected.emission, `effective emission mask drifted for ${expected.mode}`);
    assert.deepEqual(receipt.requestedExtinctionMask, expected.extinction, `requested extinction mask drifted for ${expected.mode}`);
    assert.deepEqual(receipt.effectiveExtinctionMask, expected.extinction, `effective extinction mask drifted for ${expected.mode}`);
    assert.equal(application.sourceState.sameStateCaptureId, evidence.sameStateCaptureId, `source-state identity drifted for ${expected.mode}`);
    assert.equal(application.sourceState.frameCount, evidence.before.frameCount, `receipt frame drifted for ${expected.mode}`);
    assert.equal(application.sourceState.simStepCount, evidence.before.simStepCount, `receipt simulation step drifted for ${expected.mode}`);
    assert.ok(application.camera.signature && application.camera.position.length === 3, `camera receipt is incomplete for ${expected.mode}`);
    assert.equal(application.route.requested, evidence.requestedRoute, `requested renderer route drifted for ${expected.mode}`);
    assert.equal(application.route.effective, evidence.effectiveRoute, `effective renderer route drifted for ${expected.mode}`);
    assert.equal(application.backend, evidence.backend, `backend drifted for ${expected.mode}`);
    assert.equal(application.quality.raySteps, 160, `ray quality drifted for ${expected.mode}`);
    assert.equal(application.quality.adaptiveRays, 0, `adaptive-ray authority drifted for ${expected.mode}`);
    assert.equal(application.postprocess.sumDomain, 'pre-tone-map-linear-radiance', `sum domain drifted for ${expected.mode}`);
    assert.equal(application.postprocess.independentlyToneMappedAddition, false, `independent tone mapping admitted for ${expected.mode}`);
    assert.equal(application.fallbackReason, null, `applied fallback was hidden for ${expected.mode}`);
  }

  const recomposition = evidence.sharedTransportRecomposition;
  const completeApplication = evidence.captures[3].appearanceDecompositionReceipt.application;
  assert.equal(recomposition.status, 'captured', 'MRT readback did not complete');
  assert.equal(recomposition.mode, 'complete-flame-under-total-extinction', 'MRT readback used the wrong mode');
  assert.equal(recomposition.exactWithinDeclaredPrecision, true, 'MRT channels did not reconstruct Complete within declared precision');
  assert.equal(recomposition.violationCount, 0, 'MRT recomposition contains violating components');
  assert.equal(recomposition.channelsNonblank, true, 'MRT readback admitted blank contribution channels');
  assert.ok(Number.isFinite(recomposition.maxAbsError), 'MRT error is not finite');
  assert.ok(recomposition.channelMax.ridge > 0 && recomposition.channelMax.nonRidge > 0 && recomposition.channelMax.complete > 0, 'MRT contribution readback is partial or blank');
  assert.equal(recomposition.sourceState.sameStateCaptureId, evidence.sameStateCaptureId, 'MRT source-state identity drifted');
  assert.equal(recomposition.sourceState.frameCount, evidence.before.frameCount, 'MRT source frame drifted');
  assert.equal(recomposition.sourceState.simStepCount, evidence.before.simStepCount, 'MRT source simulation step drifted');
  assert.equal(recomposition.camera.signature, completeApplication.camera.signature, 'MRT camera drifted');
  assert.equal(recomposition.route.requested, evidence.requestedRoute, 'MRT requested route drifted');
  assert.equal(recomposition.route.effective, evidence.effectiveRoute, 'MRT effective route drifted');
  assert.equal(recomposition.backend, evidence.backend, 'MRT backend drifted');
  assert.equal(recomposition.quality.raySteps, 160, 'MRT quality drifted');
  assert.equal(recomposition.postprocess.sumDomain, 'pre-tone-map-linear-radiance', 'MRT left the pre-tone-map domain');
  assert.equal(recomposition.independentlyToneMappedAddition, false, 'MRT admitted independently tone-mapped addition');
  assert.equal(recomposition.fallbackReason, null, 'MRT hid fallback');

  failurePhase = 'artifact-write';
  const artifacts = {};
  for (const [index, capture] of evidence.captures.entries()) {
    const path = resolve(outDir, modes[index].artifact);
    writeFileSync(path, decodePngDataUrl(capture.pngDataUrl));
    artifacts[capture.mode] = relative(process.cwd(), path);
  }
  const report = {
    identity: REPORT_IDENTITY,
    status: 'passed',
    requestedUrl,
    effectiveUrl: admitted.location,
    sourceSettingsPreset: admitted.sourceSettingsPreset,
    requestedRoute: evidence.requestedRoute,
    effectiveRoute: evidence.effectiveRoute,
    backend: evidence.backend,
    wrapperRoute: evidence.wrapperRoute,
    requestedRole: evidence.requestedRole,
    effectiveRole: evidence.effectiveRole,
    requestedComposition: evidence.requestedComposition,
    effectiveComposition: evidence.effectiveComposition,
    sameStateCaptureId: evidence.sameStateCaptureId,
    before: evidence.before,
    after: evidence.after,
    captures: evidence.captures.map(stripPngData),
    sharedTransportRecomposition: recomposition,
    performance: {
      captureDurationMsByMode: Object.fromEntries(evidence.captures.map(capture => [capture.mode, capture.durationMs])),
      totalVisualCaptureDurationMs: evidence.captures.reduce((sum, capture) => sum + capture.durationMs, 0),
      mrtReadbackDimensions: { width: recomposition.width, height: recomposition.height },
    },
    artifacts,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    identity: REPORT_IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    lastTrustworthyEvidence,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

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

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`${name} is required`);
  return String(value);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function stripPngData(capture) {
  const { pngDataUrl, ...rest } = capture || {};
  return rest;
}

function stripEvidencePngData(evidence) {
  return {
    ...evidence,
    captures: (evidence?.captures || []).map(stripPngData),
  };
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(value || ''));
  if (!match) throw new Error('capture did not return a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome DevTools target');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    last = await evaluate(cdp, `(() => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const wrapper = operator?.debugState?.() || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const state = (window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype)?.debugState?.();
      const receipt = basinWindow?.__kaminosVolumeSettingsPresetReceipt || null;
      return {
        location: location.href,
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        effectiveRole: wrapper?.effectiveRole || null,
        effectiveComposition: wrapper?.effectiveComposition || null,
        active: state?.active === true,
        backend: state?.backend || null,
        error: state?.error || null,
        requestedRoute: state?.requestedRoute || null,
        effectiveRoute: state?.effectiveRoute || null,
        sourceSettingsPreset: wrapper?.sourceSettingsPresetId ? {
          presetId: wrapper.sourceSettingsPresetId,
          sourcePresetAuthority: wrapper.sourceSettingsPresetAuthority,
          controlCount: wrapper.sourceSettingsPresetControlCount,
          schemaIdentity: wrapper.sourceSettingsPresetSchemaIdentity,
          storePath: wrapper.sourceSettingsPresetStorePath,
        } : (receipt ? {
          presetId: receipt.presetId,
          sourcePresetAuthority: receipt.sourcePresetAuthority,
          controlCount: Object.keys(receipt.preset?.domControls || {}).length,
          schemaIdentity: receipt.schemaIdentity,
          storePath: receipt.storePath,
        } : null),
      };
    })()`);
    const browserEvents = cdp.browserEvents.map(summarizeBrowserEvent);
    lastTrustworthyEvidence = { routeProbe: last, browserEvents };
    const exception = browserEvents.find(event => event.method === 'Runtime.exceptionThrown');
    if (exception) throw new Error(`browser runtime exception: ${JSON.stringify(exception)}`);
    const consoleError = browserEvents.find(event => event.method === 'Runtime.consoleAPICalled' && event.type === 'error');
    if (consoleError) throw new Error(`browser console error: ${JSON.stringify(consoleError)}`);
    if (last?.wrapperStatus === 'failed') throw new Error(`operator wrapper admission failed: ${last.wrapperError || 'missing-wrapper-error'}`);
    if (last?.active
      && last?.sourceSettingsPreset
      && last?.effectiveRole === 'truthHigh'
      && last?.effectiveComposition === 'raymarch-only-v0'
      && last?.wrapperStatus === 'running') return last;
    if (last?.error) throw new Error(`renderer route failed: ${last.error}`);
    await delay(250);
  }
  throw new Error(`timed out waiting for admitted volume runtime: ${JSON.stringify(last)}`);
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return {
      method: event.method,
      text: details.exception?.description || details.text || null,
      url: details.url || null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null,
    };
  }
  if (event.method === 'Log.entryAdded') {
    return {
      method: event.method,
      level: event.params?.entry?.level || null,
      text: event.params?.entry?.text || null,
      url: event.params?.entry?.url || null,
    };
  }
  return {
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}
