#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const TARGET_IDENTITY = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';
const REPORT_IDENTITY = 'kaminos.volume.intrinsic-presentation-witness.v0';
const REQUIRED_BEAUTY_ROUTE = 'role=truthHigh&composition=smoke-raymarch-under-splats-v0';
const RESTORATION_MAX_CHANNEL_DELTA = 1;
const RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA = 1e-6;
const RESTORATION_MAX_CHANGED_PIXEL_RATIO = 1e-5;
const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-intrinsic-presentation-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-intrinsic-presentation-profile-');

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
  assert.ok(route.searchParams.get('settings_preset'), 'witness route requires settings_preset identity');
  assert.equal(route.searchParams.get('settings_preset_authority'), 'shared-volume-settings-preset-v2', 'witness route requires shared preset authority');
  assert.equal(route.pathname, '/volume-selective-head-live.html', 'witness route must use the selective-head operator wrapper');
  assert.ok(route.search.includes('role=truthHigh'), `witness requires ${REQUIRED_BEAUTY_ROUTE}`);
  assert.ok(route.search.includes('composition=smoke-raymarch-under-splats-v0'), `witness requires ${REQUIRED_BEAUTY_ROUTE}`);

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
  assert.equal(admitted.sourceSettingsPreset?.presetId, route.searchParams.get('settings_preset'), 'effective preset id does not match requested preset');
  assert.equal(admitted.sourceSettingsPreset?.controlCount, 186, 'complete 186-control preset identity was not preserved');
  await delay(settleMs);

  failurePhase = 'same-state-capture';
  const evidence = await evaluate(socket, `
    (async () => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
      if (!prototype?.debugState || !prototype?.sampleFrame || !prototype?.setVolumePresentationMode) {
        throw new Error('intrinsic-presentation-runtime-api-missing');
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
      function pixelDelta(left, right) {
        if (!left || !right || left.length !== right.length) throw new Error('pixel-delta-shape-mismatch');
        let maxChannelDelta = 0;
        let absChannelDeltaSum = 0;
        let changedPixels = 0;
        for (let index = 0; index < left.length; index += 4) {
          let pixelChanged = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(left[index + channel] - right[index + channel]);
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            absChannelDeltaSum += delta;
            pixelChanged ||= delta !== 0;
          }
          changedPixels += pixelChanged ? 1 : 0;
        }
        return {
          maxChannelDelta,
          meanAbsChannelDelta: absChannelDeltaSum / Math.max(1, left.length),
          changedPixels,
          changedPixelRatio: changedPixels / Math.max(1, left.length / 4),
        };
      }
      const wrapperState = operator?.debugState?.() || null;
      const sourceReceipt = basinWindow?.__kaminosVolumeSettingsPresetReceipt || null;
      const sourceSettingsPreset = wrapperState?.sourceSettingsPresetId ? {
        requestedPresetRef: wrapperState.sourceSettingsPresetRequestedId,
        presetId: wrapperState.sourceSettingsPresetId,
        label: wrapperState.sourceSettingsPresetLabel,
        contentHash: wrapperState.sourceSettingsPresetContentHash,
        storePath: wrapperState.sourceSettingsPresetStorePath,
        schemaIdentity: wrapperState.sourceSettingsPresetSchemaIdentity,
        sourcePresetAuthority: wrapperState.sourceSettingsPresetAuthority,
        controlCount: wrapperState.sourceSettingsPresetControlCount,
      } : (sourceReceipt ? {
        requestedPresetRef: sourceReceipt.requestedPresetRef,
        presetId: sourceReceipt.presetId,
        label: sourceReceipt.label,
        contentHash: sourceReceipt.contentHash,
        storePath: sourceReceipt.storePath,
        schemaIdentity: sourceReceipt.schemaIdentity,
        sourcePresetAuthority: sourceReceipt.sourcePresetAuthority,
        controlCount: Object.keys(sourceReceipt.preset?.domControls || {}).length,
      } : null);
      prototype.setSelectiveHeadLiveCapturePaused(true);
      await new Promise(resolve => setTimeout(resolve, 100));
      const before = prototype.debugState();
      const fixedNow = performance.now();
      const sameStateCaptureId = 'intrinsic-presentation-f' + before.frameCount + '-s' + before.simStepCount;
      const controlsHash = await digest(before.controls);
      const cameraHash = await digest(basinWindow?.kaminosCameraDebugState?.() || null);

      async function captureMode(mode) {
        const receipt = operator?.setPresentation?.(mode) || prototype.setVolumePresentationMode(mode);
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
          throw new Error('presentation-sample-failed:' + mode + ':' + (sample.reason || 'missing-rgba'));
        }
        const rgba = Uint8Array.from(sample.image.rgba);
        return {
          mode,
          receipt,
          durationMs: performance.now() - captureStarted,
          sample: {
            width: sample.image.width,
            height: sample.image.height,
            frameCount: sample.frameCount,
            simStepCount: sample.simStepCount,
            volumeReconstructionStyle: sample.volumeReconstructionStyle,
            effectiveRoute: sample.effectiveRoute,
            prototypeIdentity: sample.prototypeIdentity,
            backend: sample.backend,
            boundarySplatMode: sample.boundarySplatMode,
            boundarySplatFeatureCaptureRequested: sample.boundarySplatFeatureCaptureRequested,
            boundarySplatFeatureCaptureEffective: sample.boundarySplatFeatureCaptureEffective,
            boundarySplatFallbackReason: sample.boundarySplatFallbackReason,
            boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
            boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
            volumePresentationReceipt: sample.volumePresentationReceipt,
            selectiveHeadLivePassReceipt: sample.selectiveHeadLivePassReceipt,
          },
          pixelHash: await digest(rgba),
          metrics: pixelMetrics(rgba),
          pngDataUrl: pngDataUrl({ width: sample.image.width, height: sample.image.height, rgba }),
          _rgba: rgba,
        };
      }

      const beauty = await captureMode('beauty');
      const intrinsic = await captureMode('intrinsic');
      const beautyRestored = await captureMode('beauty');
      const restorationDelta = pixelDelta(beauty._rgba, beautyRestored._rgba);
      delete beauty._rgba;
      delete intrinsic._rgba;
      delete beautyRestored._rgba;
      const after = prototype.debugState();
      return {
        sourceSettingsPreset,
        requestedRoute: before.requestedRoute,
        effectiveRoute: before.effectiveRoute,
        wrapperRoute: wrapperState?.routeIdentity || null,
        requestedRole: wrapperState?.requestedRole || null,
        effectiveRole: wrapperState?.effectiveRole || null,
        requestedComposition: wrapperState?.requestedComposition || null,
        effectiveComposition: wrapperState?.effectiveComposition || null,
        prototypeIdentity: before.prototypeIdentity,
        backend: before.backend,
        sameStateCaptureId,
        before: {
          frameCount: before.frameCount,
          simStepCount: before.simStepCount,
          temporalHistoryResetCount: before.temporalHistoryResetCount,
          controlsHash,
          cameraHash,
        },
        after: {
          frameCount: after.frameCount,
          simStepCount: after.simStepCount,
          temporalHistoryResetCount: after.temporalHistoryResetCount,
          controlsHash: await digest(after.controls),
          cameraHash: await digest(basinWindow?.kaminosCameraDebugState?.() || null),
        },
        beauty,
        intrinsic,
        beautyRestored,
        restorationDelta,
      };
    })()
  `);
  const restorationAcceptance = {
    thresholds: {
      maxChannelDelta: RESTORATION_MAX_CHANNEL_DELTA,
      maxMeanAbsChannelDelta: RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA,
      maxChangedPixelRatio: RESTORATION_MAX_CHANGED_PIXEL_RATIO,
    },
    observed: evidence.restorationDelta,
    exactPixelHashMatch: evidence.beautyRestored.pixelHash === evidence.beauty.pixelHash,
    accepted: evidence.restorationDelta.maxChannelDelta <= RESTORATION_MAX_CHANNEL_DELTA
      && evidence.restorationDelta.meanAbsChannelDelta <= RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA
      && evidence.restorationDelta.changedPixelRatio <= RESTORATION_MAX_CHANGED_PIXEL_RATIO,
  };
  lastTrustworthyEvidence = { admitted, evidence: stripEvidencePngData(evidence), restorationAcceptance };

  failurePhase = 'evidence-validation';
  assert.equal(evidence.before.simStepCount, evidence.after.simStepCount, 'presentation switching advanced simulation');
  assert.equal(evidence.before.frameCount, evidence.after.frameCount, 'presentation switching advanced presented frame state');
  assert.equal(evidence.before.temporalHistoryResetCount, evidence.after.temporalHistoryResetCount, 'presentation switching reset temporal history');
  assert.equal(evidence.before.controlsHash, evidence.after.controlsHash, 'presentation switching mutated authored controls');
  assert.equal(evidence.before.cameraHash, evidence.after.cameraHash, 'presentation switching mutated camera state');
  assert.equal(evidence.intrinsic.receipt.requestedMode, 'intrinsic');
  assert.equal(evidence.intrinsic.receipt.effectiveMode, 'intrinsic');
  assert.equal(evidence.intrinsic.receipt.fallbackReason, null);
  assert.equal(evidence.intrinsic.receipt.targetIdentity, TARGET_IDENTITY);
  assert.equal(evidence.intrinsic.receipt.passes.splats, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.residual, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.featureCapture, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.smoke, 'suppressed');
  assert.equal(evidence.intrinsic.receipt.authoredControlsMutated, false);
  assert.equal(evidence.intrinsic.receipt.simulationAdvanced, false);
  assert.equal(evidence.intrinsic.receipt.cameraMutated, false);
  assert.equal(evidence.beauty.sample.volumePresentationReceipt.application.raymarchApplied, true, 'Beauty raymarch pass was not applied');
  assert.equal(evidence.beauty.sample.volumePresentationReceipt.application.splatsApplied, true, 'Beauty splat pass was not applied');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.raymarchApplied, true, 'Intrinsic raymarch pass was not applied');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.splatsApplied, false, 'Intrinsic applied splats');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.residualEncoded, false, 'Intrinsic encoded residual');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.residualApplied, false, 'Intrinsic applied residual');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.featureCaptureEncoded, false, 'Intrinsic encoded feature capture');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.featureCaptureApplied, false, 'Intrinsic applied feature capture');
  assert.equal(evidence.beauty.metrics.nonblank, true, 'Beauty output is blank');
  assert.equal(evidence.intrinsic.metrics.nonblank, true, 'intrinsic output is blank');
  assert.equal(evidence.beautyRestored.metrics.nonblank, true, 'restored Beauty output is blank');
  assert.notEqual(evidence.beauty.pixelHash, evidence.intrinsic.pixelHash, 'Intrinsic silently substituted Beauty pixels');
  assert.ok(evidence.restorationDelta.maxChannelDelta <= RESTORATION_MAX_CHANNEL_DELTA, 'restored Beauty channel drift exceeds measured bound');
  assert.ok(evidence.restorationDelta.meanAbsChannelDelta <= RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA, 'restored Beauty mean drift exceeds measured bound');
  assert.ok(evidence.restorationDelta.changedPixelRatio <= RESTORATION_MAX_CHANGED_PIXEL_RATIO, 'restored Beauty changed-pixel ratio exceeds measured bound');

  failurePhase = 'artifact-write';
  for (const [name, capture] of [
    ['beauty.png', evidence.beauty],
    ['intrinsic.png', evidence.intrinsic],
    ['beauty-restored.png', evidence.beautyRestored],
  ]) {
    writeFileSync(resolve(outDir, name), decodePngDataUrl(capture.pngDataUrl));
  }
  const fullScreenshot = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(outDir, 'operator-cockpit-restored-beauty.png'), Buffer.from(fullScreenshot.data, 'base64'));
  const report = {
    identity: REPORT_IDENTITY,
    status: 'passed',
    requestedUrl,
    effectiveUrl: admitted.location,
    sourceSettingsPreset: evidence.sourceSettingsPreset,
    requestedRoute: evidence.requestedRoute,
    effectiveRoute: evidence.effectiveRoute,
    prototypeIdentity: evidence.prototypeIdentity,
    backend: evidence.backend,
    sameStateCaptureId: evidence.sameStateCaptureId,
    before: evidence.before,
    after: evidence.after,
    beauty: stripPngData(evidence.beauty),
    intrinsic: stripPngData(evidence.intrinsic),
    beautyRestored: stripPngData(evidence.beautyRestored),
    restorationAcceptance,
    artifacts: {
      beauty: resolve(outDir, 'beauty.png'),
      intrinsic: resolve(outDir, 'intrinsic.png'),
      beautyRestored: resolve(outDir, 'beauty-restored.png'),
      cockpitRestoredBeauty: resolve(outDir, 'operator-cockpit-restored-beauty.png'),
    },
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
    beauty: stripPngData(evidence?.beauty),
    intrinsic: stripPngData(evidence?.intrinsic),
    beautyRestored: stripPngData(evidence?.beautyRestored),
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
        wrapperRoute: wrapper?.routeIdentity || null,
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        requestedRole: wrapper?.requestedRole || null,
        effectiveRole: wrapper?.effectiveRole || null,
        requestedComposition: wrapper?.requestedComposition || null,
        effectiveComposition: wrapper?.effectiveComposition || null,
        active: state?.active === true,
        backend: state?.backend || null,
        error: state?.error || null,
        requestedRoute: state?.requestedRoute || null,
        effectiveRoute: state?.effectiveRoute || null,
        prototypeIdentity: state?.prototypeIdentity || null,
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
      && last?.effectiveComposition === 'smoke-raymarch-under-splats-v0') return last;
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
