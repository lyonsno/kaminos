#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.pyro.full-support-cockpit-witness.v0';
const SOURCES = Object.freeze(['analytical-exact', 'learned-baseline', 'learned-flow']);
const EXPECTED_ROW_COUNT = 1_899_742;
const EXPECTED_SIM_STEP = 120;

class CdpSocket {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
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
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
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
      }, this.timeoutMs);
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

const args = parseArgs(process.argv.slice(2));
const routeReceiptPath = requiredPath('--route-receipt');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-full-support-cockpit-witness/report.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-full-support-cockpit-witness/cockpit.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 900_000);
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const routeReceipt = readJson(routeReceiptPath);
const witnessStartedAt = performance.now();

let browser = null;
let socket = null;
let failurePhase = 'route-receipt-validation';
let lastTrustworthyEvidence = { schema: SCHEMA, routeReceiptPath };
let producerMediaVisualState = null;
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(screenshotPath), { recursive: true });

try {
  assert.equal(routeReceipt.schema, 'kaminos.pyro.full-support-cockpit-session.v0', 'route receipt schema was substituted');
  assert.equal(routeReceipt.status, 'serving', 'route receipt is not serving');
  assert.ok(routeReceipt.requestedRoute, 'route receipt omitted requested route');
  assert.ok(routeReceipt.effectiveRoute, 'route receipt omitted effective route');
  const expectedUrl = new URL(routeReceipt.effectiveRoute).href;
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    mounts: routeReceipt.mounts,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/kaminos-full-support-cockpit-witness-${process.pid}-${Date.now()}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
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
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: expectedUrl });

  failurePhase = 'effective-route-admission';
  const admittedRoute = await waitForValue(socket, timeoutMs, `(() => {
    if (document.readyState !== 'complete') return null;
    return { href: location.href, hasBasin: Boolean(document.querySelector('#basin')) };
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admittedRoute };
  assertRouteContract(expectedUrl, admittedRoute.href);
  assert.equal(admittedRoute.hasBasin, true, 'effective route did not mount the volume viewer');

  failurePhase = 'checksum-state-bootstrap';
  const bootstrap = await waitForValue(socket, timeoutMs, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const receipt = runtime.__kaminosFullSupportStageABootstrapReceipt;
    if (!receipt || receipt.status === 'loading') return null;
    return receipt;
  })()`);
  assert.equal(bootstrap.status, 'effective', `bootstrap failed: ${JSON.stringify(bootstrap)}`);
  assert.equal(bootstrap.presentedState?.simStepCount, EXPECTED_SIM_STEP, 'bootstrap drifted from state 120');
  assert.equal(bootstrap.presentedState?.lookFreeze, 1, 'bootstrap did not pin the imported state');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };

  failurePhase = 'stage-b-resource-and-renderer-admission';
  const stageBReceipt = await waitForValue(socket, timeoutMs, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    return runtime.__kaminosStageBCockpitReceipt || null;
  })()`);
  assert.equal(stageBReceipt.requestedTreatment, 'matched-optical-recurrence-v0', 'Stage B requested treatment was substituted');
  assert.equal(stageBReceipt.fallbackUsed, false, 'Stage B fallback looked authoritative');
  const stageBManifestArtifact = routeReceipt.artifacts?.stageBManifest;
  const stageBAcceptanceArtifact = routeReceipt.artifacts?.stageBAcceptance;
  if (stageBManifestArtifact) {
    const routedStageBManifestPath = new URL(routeReceipt.effectiveRoute).searchParams.get('full_support_stage_b_manifest');
    assert.ok(routedStageBManifestPath, 'effective route omitted its Stage B manifest mount');
    const routedStageBManifestUrl = new URL(routedStageBManifestPath, routeReceipt.effectiveRoute).href;
    assert.equal(stageBReceipt.status, 'effective', 'verified Stage B manifest did not become resource-effective');
    assert.equal(stageBReceipt.disabledReason, null, 'verified Stage B manifest retained a disabled reason');
    assert.equal(stageBReceipt.effectiveTreatment, 'matched-optical-recurrence-v0', 'verified Stage B treatment identity was substituted');
    assert.equal(stageBReceipt.requestedManifestUrl, routedStageBManifestUrl, 'requested Stage B manifest route drifted from the route receipt');
    assert.equal(stageBReceipt.effectiveManifestUrl, routedStageBManifestUrl, 'effective Stage B manifest route drifted from the mounted resource');
    assert.equal(stageBReceipt.requestedManifestSha256, stageBManifestArtifact.sha256, 'requested Stage B manifest hash drifted from the route receipt');
    assert.equal(stageBReceipt.effectiveManifestSha256, stageBManifestArtifact.sha256, 'effective Stage B manifest hash drifted from the mounted artifact');
    assert.deepEqual(
      stageBReceipt.passes?.applied,
      stageBAcceptanceArtifact
        ? ['manifest-validation', 'resource-binding', 'resource-load-verification', 'acceptance-validation']
        : ['manifest-validation', 'resource-binding', 'resource-load-verification'],
      'verified Stage B resource and acceptance passes were not reported exactly',
    );
    assert.ok(stageBReceipt.resources?.length >= 2, 'verified Stage B manifest did not bind the required resources');
    assert.ok(stageBReceipt.resources.every(resource => resource.loadStatus === 'loaded' && resource.loadFallbackUsed === false), 'Stage B resource loading was incomplete or used fallback');
    if (stageBAcceptanceArtifact) {
      const routedAcceptancePath = new URL(routeReceipt.effectiveRoute).searchParams.get('full_support_stage_b_acceptance');
      assert.ok(routedAcceptancePath, 'effective route omitted its Stage B acceptance mount');
      const routedAcceptanceUrl = new URL(routedAcceptancePath, routeReceipt.effectiveRoute).href;
      assert.equal(stageBReceipt.acceptanceState, 'accepted', 'accepted Stage B sidecar was silently downgraded');
      assert.equal(stageBReceipt.effectiveAcceptanceUrl, routedAcceptanceUrl, 'effective Stage B acceptance route drifted');
      assert.equal(stageBReceipt.effectiveAcceptanceSha256, stageBAcceptanceArtifact.sha256, 'effective Stage B acceptance hash drifted');
      assert.equal(stageBReceipt.authority?.evidenceAuthority, 'producer-evidence-accepted', 'accepted producer authority was hidden');
      assert.equal(stageBReceipt.authority?.visualQuality, 'operator-unseen', 'accepted producer visual quality was inflated');
      assert.equal(stageBReceipt.authority?.operatorScope, 'operator-exploration-pending', 'accepted operator exploration state was hidden');
    } else {
      assert.equal(stageBReceipt.authority?.evidenceAuthority, 'producer-evidence-unverified', 'provisional Stage B authority was inflated');
      assert.equal(stageBReceipt.authority?.operatorScope, 'operator-exploration-only', 'provisional Stage B scope was hidden');
    }
    assert.equal(stageBReceipt.authority?.decisionBearing, false, 'Stage B became decision-bearing');
    if (stageBAcceptanceArtifact) {
      assert.equal(stageBReceipt.presentationAuthority, 'producer-capture-media-v0', 'accepted producer presentation authority was substituted');
      assert.equal(stageBReceipt.passes?.rendererRequested, false, 'accepted producer media incorrectly requested the local renderer');
      assert.equal(stageBReceipt.passes?.rendererEncoded, false, 'accepted producer media incorrectly encoded the local renderer');
      assert.equal(stageBReceipt.passes?.rendererApplied, false, 'accepted producer media incorrectly applied the local renderer');
      assert.equal(stageBReceipt.passes?.producerMediaRequested, true, 'accepted producer media request was not reported');
      assert.equal(stageBReceipt.passes?.producerMediaApplied, true, 'accepted producer media was not presented');
      assert.equal(stageBReceipt.producerMediaReceipt?.identity, 'producer-capture-media-v0', 'accepted producer media receipt was substituted');
      assert.equal(stageBReceipt.producerMediaReceipt?.fallbackReason, null, 'accepted producer media fallback looked authoritative');
    } else {
      assert.equal(stageBReceipt.passes?.rendererRequested, true, 'Stage B renderer request was not reported');
      assert.equal(stageBReceipt.passes?.rendererEncoded, true, 'Stage B renderer did not encode after complete resource admission');
      assert.equal(stageBReceipt.passes?.rendererApplied, true, 'Stage B renderer did not apply after complete resource admission');
      assert.equal(stageBReceipt.rendererReceipt?.requestedMode, 'matched-optical-recurrence-v0', 'Stage B renderer request identity drifted');
      assert.equal(stageBReceipt.rendererReceipt?.effectiveMode, 'matched-optical-recurrence-v0', 'Stage B renderer silently substituted the optical path');
      assert.equal(stageBReceipt.rendererReceipt?.fallbackReason, null, 'Stage B renderer fallback looked authoritative');
    }
  } else {
    assert.equal(stageBReceipt.status, 'disabled', 'Stage B rendered without complete resources');
    assert.equal(stageBReceipt.disabledReason, 'stage-b-resources-missing', 'Stage B missing-resource reason was substituted');
    assert.equal(stageBReceipt.effectiveTreatment, null, 'Stage B reported an effective treatment before evidence');
    assert.deepEqual(stageBReceipt.passes?.applied, [], 'Stage B reported manifest/resource passes without evidence');
    assert.equal(stageBReceipt.passes?.rendererEncoded, false, 'Stage B renderer encoded without resources');
    assert.equal(stageBReceipt.passes?.rendererApplied, false, 'Stage B renderer applied without resources');
  }
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, stageBReceipt };

  const sourceReceipts = [];
  for (const source of SOURCES) {
    failurePhase = `source-switch:${source}`;
    const receipt = await evaluate(socket, `(async () => {
      const runtime = document.querySelector('#basin')?.contentWindow || window;
      const select = runtime.document.getElementById('volume-full-support-source');
      if (!select) throw new Error('full-support-source-selector-missing');
      if (typeof runtime.__kaminosApplyFullSupportSource !== 'function') throw new Error('full-support-source-api-missing');
      select.value = ${JSON.stringify(source)};
      const sourceReceipt = await runtime.__kaminosApplyFullSupportSource();
      const state = runtime.__kaminosVolumePrototype?.debugState?.();
      return {
        requestedSource: ${JSON.stringify(source)},
        sourceReceipt,
        state: {
          active: state?.active,
          backend: state?.backend,
          effectiveRoute: state?.effectiveRoute,
          simStepCount: state?.simStepCount,
          lookFreeze: state?.lookFreeze,
        },
      };
    })()`);
    assert.equal(receipt.sourceReceipt?.status, 'effective', `${source} did not become effective`);
    assert.equal(receipt.sourceReceipt?.effectiveSource, source, `${source} was silently substituted`);
    assert.equal(receipt.sourceReceipt?.rowCount, EXPECTED_ROW_COUNT, `${source} was partially populated`);
    assert.equal(receipt.sourceReceipt?.overflowCount, 0, `${source} overflowed the live population`);
    assert.equal(receipt.sourceReceipt?.fallbackUsed, false, `${source} used fallback while looking authoritative`);
    assert.equal(receipt.state?.simStepCount, EXPECTED_SIM_STEP, `${source} changed the frozen simulation state`);
    assert.equal(receipt.state?.lookFreeze, 1, `${source} released the frozen simulation state`);
    sourceReceipts.push(receipt);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, sourceReceipts: [...sourceReceipts] };
  }

  if (stageBAcceptanceArtifact) {
    failurePhase = 'producer-media-decoded-frame-admission';
    producerMediaVisualState = await admitProducerMediaFrame(socket, timeoutMs, stageBReceipt.producerMediaReceipt.effectiveUrl);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, producerMediaVisualState };
  }

  failurePhase = 'operator-frame-capture';
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  assert.ok(screenshot?.data, 'operator frame capture was blank');
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  failurePhase = 'browser-event-audit';
  const browserEventAudit = auditBrowserEvents(socket.browserEvents);

  const report = {
    schema: SCHEMA,
    status: 'passed',
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    bootstrap,
    stageBReceipt,
    producerMediaVisualState,
    sourceReceipts,
    screenshotPath,
    elapsedMs: performance.now() - witnessStartedAt,
    browserEventAudit,
    browserEvents: socket.browserEvents,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence,
    screenshotPath: null,
    browserEvents: socket?.browserEvents || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    parsed.set(token, tokens[index + 1]);
    index += 1;
  }
  return parsed;
}

function requiredPath(flag) {
  const value = args.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return resolve(String(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function chromeExecutable() {
  return process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function auditBrowserEvents(events) {
  const failures = events.filter(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
  ));
  if (failures.length) {
    throw new Error(`browser-event-audit-failed:${JSON.stringify(failures)}`);
  }
  return {
    status: 'clean',
    observedEventCount: events.length,
    rejectedEventCount: 0,
  };
}

function assertRouteContract(expectedHref, admittedHref) {
  const expected = new URL(expectedHref);
  const admitted = new URL(admittedHref);
  assert.equal(admitted.origin, expected.origin, 'browser route origin was substituted');
  assert.equal(admitted.pathname, expected.pathname, 'browser route path was substituted');
  const criticalRouteParameters = [
    'composition',
    'volume_presentation',
    'volume_raymarch_smoke',
    'full_support_source',
    'full_support_source_field_manifest',
    'full_support_source_fluid',
    'full_support_source_front',
    'full_support_exact_manifest',
    'full_support_baseline_manifest',
    'full_support_flow_manifest',
    'full_support_stage_b_manifest',
    'full_support_stage_b_manifest_sha256',
    'full_support_stage_b_acceptance',
    'full_support_stage_b_acceptance_sha256',
  ];
  for (const parameter of criticalRouteParameters) {
    assert.equal(
      admitted.searchParams.get(parameter),
      expected.searchParams.get(parameter),
      `browser route substituted ${parameter}`,
    );
  }
}

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chrome CDP target did not appear: ${lastError?.message || 'timeout'}`);
}

async function waitForValue(cdp, timeoutMs, expression) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, expression);
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`browser value did not become available: ${lastError?.message || 'timeout'}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

async function admitProducerMediaFrame(cdp, timeout, expectedUrl) {
  const requestedProducerFrameTime = 10 / 6;
  const visualState = await evaluate(cdp, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const video = runtime.document.getElementById('volume-stage-b-producer-video');
    const media = runtime.document.getElementById('volume-stage-b-producer-media');
    if (!video || !media || media.hidden) throw new Error('accepted-producer-media-surface-unavailable');
    video.pause();
    video.src = ${JSON.stringify(expectedUrl)};
    await new Promise((resolveLoaded, rejectLoaded) => {
      const timer = setTimeout(() => rejectLoaded(new Error('accepted-producer-media-load-timeout')), 15_000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };
      const onLoaded = () => { cleanup(); resolveLoaded(); };
      const onError = () => { cleanup(); rejectLoaded(new Error('accepted-producer-media-load-failed')); };
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.load();
    });
    const presentedFrame = await new Promise((resolveFrame, rejectFrame) => {
      const timer = setTimeout(() => rejectFrame(new Error('accepted-producer-frame-timeout')), 15_000);
      const onFrame = (_now, metadata) => {
        if (metadata.mediaTime + (1 / 12) < ${requestedProducerFrameTime}) {
          video.requestVideoFrameCallback(onFrame);
          return;
        }
        clearTimeout(timer);
        video.pause();
        resolveFrame({ mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames });
      };
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(error => {
        clearTimeout(timer);
        rejectFrame(error);
      });
    });
    const pixelCanvas = runtime.document.createElement('canvas');
    pixelCanvas.width = video.videoWidth;
    pixelCanvas.height = video.videoHeight;
    const pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true });
    pixelContext.drawImage(video, 0, 0, pixelCanvas.width, pixelCanvas.height);
    const pixelBytes = pixelContext.getImageData(0, 0, pixelCanvas.width, pixelCanvas.height).data;
    let litPixelCount = 0;
    let lumaSum = 0;
    let lumaSquaredSum = 0;
    let minimumLuma = 255;
    let maximumLuma = 0;
    for (let index = 0; index < pixelBytes.length; index += 4) {
      const luma = (pixelBytes[index] * 0.2126) + (pixelBytes[index + 1] * 0.7152) + (pixelBytes[index + 2] * 0.0722);
      if (luma > 3) litPixelCount += 1;
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      minimumLuma = Math.min(minimumLuma, luma);
      maximumLuma = Math.max(maximumLuma, luma);
    }
    const pixelCount = pixelBytes.length / 4;
    const meanLuma = lumaSum / pixelCount;
    const lumaVariance = Math.max(0, (lumaSquaredSum / pixelCount) - (meanLuma * meanLuma));
    const mediaRect = media.getBoundingClientRect();
    const mediaStyle = runtime.getComputedStyle(media);
    const occlusionProbeIds = [
      [0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9],
    ].map(([x, y]) => runtime.document.elementFromPoint(
      mediaRect.left + (mediaRect.width * x),
      mediaRect.top + (mediaRect.height * y),
    )?.id || null);
    return {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      duration: video.duration,
      currentTime: video.currentTime,
      mediaTime: presentedFrame.mediaTime,
      presentedFrames: presentedFrame.presentedFrames,
      minimumFrameTime: ${requestedProducerFrameTime},
      paused: video.paused,
      currentSrc: video.currentSrc,
      hidden: media.hidden,
      mediaRect: {
        left: mediaRect.left,
        top: mediaRect.top,
        width: mediaRect.width,
        height: mediaRect.height,
      },
      mediaDisplay: mediaStyle.display,
      mediaVisibility: mediaStyle.visibility,
      mediaOpacity: mediaStyle.opacity,
      mediaZIndex: mediaStyle.zIndex,
      topmostElementId: occlusionProbeIds[2],
      occlusionProbeIds,
      videoPixelStats: {
        pixelCount,
        litPixelCount,
        minimumLuma,
        maximumLuma,
        meanLuma,
        lumaVariance,
      },
    };
  })()`);
  assert.ok(visualState.readyState >= 2, 'accepted producer frame was not decoded');
  assert.ok(visualState.videoWidth > 0 && visualState.videoHeight > 0, 'accepted producer frame had no decoded dimensions');
  assert.ok(visualState.mediaTime + (1 / 12) >= requestedProducerFrameTime, 'accepted producer media did not reach the frame-10 minimum time');
  assert.equal(visualState.paused, true, 'accepted producer witness did not hold the deterministic frame');
  assert.equal(visualState.hidden, false, 'accepted producer media was hidden before capture');
  assert.ok(visualState.mediaRect.width > 0 && visualState.mediaRect.height > 0, 'accepted producer media had no visible viewer geometry');
  assert.notEqual(visualState.mediaDisplay, 'none', 'accepted producer media was display-suppressed');
  assert.equal(visualState.mediaVisibility, 'visible', 'accepted producer media was visibility-suppressed');
  assert.ok(Number(visualState.mediaOpacity) > 0, 'accepted producer media was transparent');
  assert.ok(
    visualState.occlusionProbeIds.every(id => ['volume-stage-b-producer-video', 'volume-stage-b-producer-label'].includes(id)),
    `accepted producer media was occluded in the viewer: ${visualState.occlusionProbeIds.join(',')}`,
  );
  assert.ok(visualState.videoPixelStats.litPixelCount > 100, 'accepted producer frame was black');
  assert.ok(visualState.videoPixelStats.maximumLuma > 10, 'accepted producer frame had no visible dynamic range');
  assert.ok(visualState.videoPixelStats.lumaVariance > 1, 'accepted producer frame had no visible variance');
  assert.equal(visualState.currentSrc, expectedUrl, 'deterministic producer frame URL was substituted');
  return visualState;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
