#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.live-nonridge-union-witness.v0';
const MODE = 'kernel_moment_full_flame_union';
const RENDERER = 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0';
const SELECTOR = 'explicit-source-field-operator-v0';
const SELECTOR_SHA256 = '541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9';
const EFFECTIVE_RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';

const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const directRoute = args.has('--direct-route');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-live-nonridge-union-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'report.json')));
const timeoutMs = Number(args.get('--timeout-ms') || 240000);
const settleMs = Number(args.get('--settle-ms') || 1500);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const userDataDir = mkdtempSync('/tmp/kaminos-live-union-profile-');

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
  assert.ok(['http:', 'https:'].includes(route.protocol), 'witness URL must be HTTP(S)');

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
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
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { admitted };
  assert.equal(admitted.active, true, 'volume renderer did not become active');
  assert.ok(String(admitted.backend).startsWith('WebGPU'), 'effective backend substituted away from WebGPU');
  assert.equal(admitted.effectiveRoute, EFFECTIVE_RENDERER_ROUTE, 'effective renderer route drifted');
  await delay(settleMs);

  if (directRoute) {
    await captureDirectRouteWitness();
  } else {
  failurePhase = 'live-union-and-zero-gradient-falsifier';
  const evidence = await evaluate(socket, `
    (async () => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = basinWindow.__kaminosVolumePrototype || window.__kaminosVolumePrototype;
      if (!prototype?.debugState || !prototype?.setControls || !prototype?.renderFrozenScaleToCanvas || !prototype?.sampleBoundarySplatFootprintAudit) {
        throw new Error('live-union-witness-runtime-api-missing');
      }
      operator?.setCapturePaused?.(true);
      operator?.setPresentation?.('beauty');
      operator?.setComposition?.('splat-only-v0');
      const initial = prototype.debugState();
      const gradientGain = Number(initial.controls?.reactionBoundaryGradient ?? 2.6);
      const sameStateCaptureId = 'live-union-f' + initial.frameCount + '-s' + initial.simStepCount;
      const render = async (reactionBoundaryGradient) => {
        const started = performance.now();
        const receipt = await prototype.renderFrozenScaleToCanvas({
          boundarySplatComposition: 'splat-only-v0',
          controlOverrides: {
            boundarySplatMode: '${MODE}',
            reactionBoundaryGradient,
            flowKernelStrength: 1,
            flowKernelRadius: 0.03,
            flowKernelCoherence: 1,
            boundarySplatRadianceGain: 2,
            boundarySplatOpacityGain: 2,
          },
          sameStateCaptureId,
          baseFrameCount: initial.frameCount,
          baseSimStepCount: initial.simStepCount,
          now: 7000,
          restoreControls: false,
          resumeRenderLoop: false,
        });
        const renderElapsedMs = performance.now() - started;
        const auditStarted = performance.now();
        const audit = await prototype.sampleBoundarySplatFootprintAudit({ now: 7000 });
        const auditElapsedMs = performance.now() - auditStarted;
        return { receipt, audit, renderElapsedMs, auditElapsedMs };
      };
      const compactAudit = audit => ({
        ok: audit.ok,
        candidateCount: audit.candidateCount,
        instanceCount: audit.instanceCount,
        overflowCount: audit.overflowCount,
        initialDraw: audit.initialDraw,
        capacityRetryCount: audit.capacityRetryCount,
        capacityAfterRetry: audit.capacityAfterRetry,
        candidatePayloadSha256: audit.candidatePayloadSha256,
        attributePayloadSha256: audit.attributePayloadSha256,
        stateWitnessAuthority: audit.stateWitnessAuthority,
        stateWitnessSha256: audit.stateWitnessSha256,
        controlAuthority: audit.controlAuthority,
        controlSha256: audit.controlSha256,
        stableNativeCellIdAuthority: audit.stableNativeCellIdAuthority,
        stableNativeCellIdSha256: audit.stableNativeCellIdSha256,
        stableNativeCellIdCount: audit.stableNativeCellIds?.length ?? null,
        stableNativeCellIdRanges: audit.stableNativeCellIdRanges,
        decodedMembershipCounts: audit.decodedMembershipCounts,
        channelMax: audit.channelMax,
        descriptorFrameMetrics: audit.descriptorFrameMetrics,
        projectionMetrics: audit.projectionMetrics,
        unionReceipt: audit.unionReceipt,
      });
      const main = await render(gradientGain);
      const sample = await prototype.sampleFrame({
        advanceSim: false,
        includeRgba: true,
        now: 7000,
        sameStateCaptureId,
        baseFrameCount: initial.frameCount,
        baseSimStepCount: initial.simStepCount,
      });
      let litPixels = 0;
      let lumaSum = 0;
      for (let index = 0; index < (sample.image?.rgba?.length || 0); index += 4) {
        const luma = 0.2126 * sample.image.rgba[index]
          + 0.7152 * sample.image.rgba[index + 1]
          + 0.0722 * sample.image.rgba[index + 2];
        if (luma > 8) litPixels += 1;
        lumaSum += luma;
      }
      const pixelCount = (sample.image?.rgba?.length || 0) / 4;
      const zero = await render(0);
      const restored = await render(gradientGain);
      const final = prototype.debugState();
      return {
        sameStateCaptureId,
        sourceFrameCount: initial.frameCount,
        sourceSimStepCount: initial.simStepCount,
        finalFrameCount: final.frameCount,
        finalSimStepCount: final.simStepCount,
        gradientGain,
        main: { receipt: main.receipt, audit: compactAudit(main.audit), renderElapsedMs: main.renderElapsedMs, auditElapsedMs: main.auditElapsedMs },
        zeroGradientFalsifier: { receipt: zero.receipt, audit: compactAudit(zero.audit), renderElapsedMs: zero.renderElapsedMs, auditElapsedMs: zero.auditElapsedMs },
        restored: { receipt: restored.receipt, audit: compactAudit(restored.audit), renderElapsedMs: restored.renderElapsedMs, auditElapsedMs: restored.auditElapsedMs },
        pixels: {
          width: sample.image?.width ?? null,
          height: sample.image?.height ?? null,
          litPixels,
          pixelCount,
          meanLuma: lumaSum / Math.max(1, pixelCount),
          nonblank: litPixels > 64,
        },
        backend: final.backend,
        effectiveRoute: final.effectiveRoute,
        browserEvents: [],
      };
    })()
  `);
  lastTrustworthyEvidence = evidence;

  const main = evidence.main;
  const zero = evidence.zeroGradientFalsifier;
  const restored = evidence.restored;
  assert.equal(main.receipt?.ok, true, `main union render failed: ${main.receipt?.reason || 'unknown'}`);
  assert.equal(main.receipt?.boundarySplatMode, MODE, 'effective splat mode drifted');
  assert.equal(main.receipt?.boundarySplatRendererIdentity, RENDERER, 'effective renderer identity drifted');
  assert.equal(main.receipt?.boundarySplatFallbackReason, null, 'main union render used fallback');
  assert.equal(main.receipt?.flowKernelEffective?.strength, 1, 'cotangent kernel strength was silently substituted');
  assert.ok(Math.abs(main.receipt?.flowKernelEffective?.radiusWorld - 0.03) < 1e-6, 'cotangent kernel radius was silently substituted');
  assert.equal(main.receipt?.flowKernelEffective?.coherence, 1, 'cotangent kernel coherence was silently substituted');
  assert.equal(main.receipt?.controlOverrides?.boundarySplatRadianceGain, 2, 'union radiance gain was silently substituted');
  assert.equal(main.receipt?.controlOverrides?.boundarySplatOpacityGain, 2, 'union opacity gain was silently substituted');
  assert.equal(main.audit?.unionReceipt?.selectorAuthorityEffective, SELECTOR, 'effective selector authority drifted');
  assert.equal(main.audit?.unionReceipt?.selectorRecipeSha256, SELECTOR_SHA256, 'effective selector recipe drifted');
  assert.equal(main.audit?.overflowCount, 0, 'uncapped main witness retained overflow');
  assert.equal(main.audit?.candidateCount, main.audit?.instanceCount, 'main witness silently truncated candidates');
  assert.equal(main.audit?.decodedMembershipCounts?.union, main.audit?.instanceCount, 'decoded union count does not match draw count');
  assert.equal(main.audit?.stableNativeCellIdCount, main.audit?.instanceCount, 'stable native-cell IDs are partial');
  assert.match(main.audit?.stableNativeCellIdSha256 || '', /^[a-f0-9]{64}$/, 'stable native-cell ID hash missing');
  assert.equal(zero.receipt?.ok, true, `zero-gradient render failed: ${zero.receipt?.reason || 'unknown'}`);
  assert.equal(zero.audit?.unionReceipt?.gradientGain, 0, 'zero-gradient control was silently substituted');
  assert.equal(zero.audit?.decodedMembershipCounts?.nonRidgeOnly, 0, 'zero-gradient control admitted Non-Ridge-only cells');
  assert.equal(zero.audit?.decodedMembershipCounts?.overlap, 0, 'zero-gradient control admitted Ridge/Non-Ridge overlap');
  assert.equal(zero.audit?.unionReceipt?.zeroGradientAdmissionCount, 0, 'GPU zero-gradient admission falsifier fired');
  assert.equal(evidence.sourceSimStepCount, evidence.finalSimStepCount, 'same-state witness advanced simulation');
  assert.equal(evidence.sourceFrameCount, evidence.finalFrameCount, 'same-state witness advanced live frame state');
  assert.equal(restored.audit?.candidatePayloadSha256, main.audit?.candidatePayloadSha256, 'restored main candidate state changed');
  assert.equal(restored.audit?.attributePayloadSha256, main.audit?.attributePayloadSha256, 'restored main attributes changed');
  assert.equal(restored.audit?.stableNativeCellIdSha256, main.audit?.stableNativeCellIdSha256, 'restored main native-cell IDs changed');
  assert.equal(restored.audit?.controlSha256, main.audit?.controlSha256, 'restored effective controls changed');
  failurePhase = 'visible-full-flame-capture';
  const rect = restored.receipt?.canvasCssRect;
  assert.ok(rect?.width > 0 && rect?.height > 0, 'rendered canvas clip is unavailable');
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  const screenshotPath = join(outDir, 'full-flame-live-ridge-nonridge-union.png');
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'visible Full Flame screenshot is missing or partial');
  writeFileSync(screenshotPath, screenshotBytes);
  const visibleScreenshotPixels = pngPixelMetrics(screenshotBytes);
  assert.equal(visibleScreenshotPixels.nonblank, true, 'operator-visible Full Flame screenshot is blank');

  const report = {
    schema: SCHEMA,
    status: 'captured',
    failurePhase: null,
    requestedUrl,
    requestedMode: MODE,
    effectiveMode: main.receipt.boundarySplatMode,
    requestedSelectorAuthority: SELECTOR,
    effectiveSelectorAuthority: main.audit.unionReceipt.selectorAuthorityEffective,
    selectorRecipeSha256: main.audit.unionReceipt.selectorRecipeSha256,
    source: {
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: null,
      branchAuthority: 'private-source-control-coordination-ref',
      worktree: null,
      worktreeAuthority: 'private-source-control-coordination-ref',
    },
    backend: evidence.backend,
    effectiveRoute: evidence.effectiveRoute,
    sameStateCaptureId: evidence.sameStateCaptureId,
    sourceFrameCount: evidence.sourceFrameCount,
    sourceSimStepCount: evidence.sourceSimStepCount,
    main,
    zeroGradientFalsifier: zero,
    restored,
    pixels: {
      visibleScreenshot: visibleScreenshotPixels,
      offscreenReadback: evidence.pixels,
      offscreenReadbackMismatch: evidence.pixels?.nonblank !== visibleScreenshotPixels.nonblank,
      authority: 'operator-visible-cdp-canvas-screenshot-pixels-v0',
    },
    performance: {
      mainRenderElapsedMs: main.renderElapsedMs,
      mainAuditElapsedMs: main.auditElapsedMs,
      zeroGradientRenderElapsedMs: zero.renderElapsedMs,
      restoredRenderElapsedMs: restored.renderElapsedMs,
      gpuProfile: restored.receipt.boundarySplatGpuProfile || null,
    },
    boundarySplatOverflowCount: main.receipt.boundarySplatOverflowCount,
    boundarySplatFallbackReason: main.receipt.boundarySplatFallbackReason,
    browserEvents: socket.browserEvents,
    screenshot: artifact(screenshotPath),
    lastTrustworthyEvidence: 'main, zero-gradient, and restored same-state GPU readbacks all satisfied',
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    screenshot: screenshotPath,
    counts: main.audit.decodedMembershipCounts,
    stableNativeCellIdSha256: main.audit.stableNativeCellIdSha256,
    zeroGradientFalsifier: zero.audit.decodedMembershipCounts,
    performance: report.performance,
  }, null, 2));
  }
} catch (error) {
  writeReport({
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    requestedMode: MODE,
    requestedSelectorAuthority: SELECTOR,
    lastTrustworthyEvidence,
    browserEvents: socket?.browserEvents || [],
  });
  console.error(JSON.stringify({
    ok: false,
    report: reportPath,
    failurePhase,
    error: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  browser?.kill('SIGTERM');
}

async function captureDirectRouteWitness() {
  failurePhase = 'direct-route-pre-mutation-audit';
  const directRouteReceipt = await evaluate(socket, `
    (async () => {
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = basinWindow.__kaminosVolumePrototype || window.__kaminosVolumePrototype;
      if (!prototype?.debugState || !prototype?.sampleBoundarySplatFootprintAudit || !prototype?.canvasElement) {
        throw new Error('live-union-direct-route-runtime-api-missing');
      }
      const initial = prototype.debugState();
      const route = new URL(location.href);
      const numberParam = name => route.searchParams.has(name) ? Number(route.searchParams.get(name)) : null;
      const directRouteRequestedControls = {
        boundarySplatMode: route.searchParams.get('volume_boundary_splat_mode'),
        boundarySidecarSource: route.searchParams.get('volume_boundary_sidecar_source'),
        flowKernelStrength: numberParam('volume_flow_kernel_strength'),
        flowKernelRadius: numberParam('volume_flow_kernel_radius'),
        flowKernelCoherence: numberParam('volume_flow_kernel_coherence'),
        reactionBoundaryGradient: numberParam('volume_reaction_boundary_gradient'),
      };
      const directRouteEffectiveControls = Object.fromEntries(
        Object.keys(directRouteRequestedControls).map(key => [key, initial.controls?.[key] ?? null]),
      );
      const directRouteControlSubstitutions = Object.entries(directRouteRequestedControls)
        .filter(([, requested]) => requested !== null)
        .flatMap(([key, requested]) => {
          const effective = directRouteEffectiveControls[key];
          if (typeof requested === 'number' && typeof effective === 'number') {
            return Math.abs(requested - effective) <= 0.000001 ? [] : [{ key, requested, effective }];
          }
          return String(requested) === String(effective) ? [] : [{ key, requested, effective }];
        });
      let audit = null;
      let auditError = null;
      try {
        audit = await prototype.sampleBoundarySplatFootprintAudit({ now: performance.now() });
      } catch (error) {
        auditError = error?.message || String(error);
      }
      const final = prototype.debugState();
      const rect = prototype.canvasElement()?.getBoundingClientRect?.() || null;
      return {
        identity: 'live-union-direct-route-pre-mutation-v0',
        directRouteRequestedControls,
        directRouteEffectiveControls,
        directRouteControlSubstitutions,
        directRouteCandidateCounts: audit ? {
          candidateCount: audit.candidateCount,
          instanceCount: audit.instanceCount,
          overflowCount: audit.overflowCount,
          decodedMembershipCounts: audit.decodedMembershipCounts,
        } : null,
        directRouteAppliedPasses: {
          unionCompaction: Boolean(audit?.ok),
          splatRasterRequested: final.boundarySplatMode === '${MODE}',
          rendererIdentity: final.boundarySplatRendererIdentity,
          fallbackReason: final.boundarySplatFallbackReason || null,
          selectiveHeadLivePassReceipt: final.selectiveHeadLivePassReceipt
            ? { ...final.selectiveHeadLivePassReceipt }
            : null,
        },
        directRouteSourceMaturity: {
          sourceFrameCount: initial.frameCount,
          sourceSimStepCount: initial.simStepCount,
          finalFrameCount: final.frameCount,
          finalSimStepCount: final.simStepCount,
          active: final.active,
          backend: final.backend,
          effectiveRoute: final.effectiveRoute,
        },
        postLoadControlMutation: false,
        postLoadCompositionMutation: false,
        audit,
        auditError,
        canvasCssRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    })()
  `);
  lastTrustworthyEvidence = { directRouteReceipt };
  assert.equal(directRouteReceipt.directRouteControlSubstitutions.length, 0, 'direct-route-controls-were-substituted');
  assert.equal(directRouteReceipt.directRouteEffectiveControls.boundarySplatMode, MODE, 'direct-route-union-mode-was-not-effective');
  assert.equal(directRouteReceipt.audit?.ok, true, `direct-route-union-candidate-population-is-zero:${directRouteReceipt.auditError || 'unknown'}`);
  assert.ok(directRouteReceipt.directRouteCandidateCounts?.candidateCount > 0, 'direct-route-union-candidate-population-is-zero');
  assert.equal(directRouteReceipt.directRouteCandidateCounts?.overflowCount, 0, 'direct-route-union-overflow-is-nonzero');
  assert.equal(directRouteReceipt.directRouteAppliedPasses?.fallbackReason, null, 'direct-route-union-used-fallback');
  assert.equal(directRouteReceipt.directRouteAppliedPasses?.selectiveHeadLivePassReceipt?.splatApplied, true, 'direct-route-splat-pass-was-not-applied');

  failurePhase = 'direct-route-visible-canvas-capture';
  const rect = directRouteReceipt.canvasCssRect;
  assert.ok(rect?.width > 0 && rect?.height > 0, 'direct-route-canvas-clip-is-unavailable');
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  const screenshotPath = join(outDir, 'full-flame-live-union-direct-route.png');
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'direct-route-visible-screenshot-is-missing-or-partial');
  writeFileSync(screenshotPath, screenshotBytes);
  const pixels = pngPixelMetrics(screenshotBytes);
  assert.equal(pixels.nonblank, true, 'direct-route-visible-screenshot-is-blank');

  const report = {
    schema: SCHEMA,
    status: 'captured',
    failurePhase: null,
    requestedUrl,
    requestedMode: MODE,
    directRouteAuthority: 'exact-url-no-post-load-mutation-v0',
    source: {
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: null,
      branchAuthority: 'private-source-control-coordination-ref',
      worktree: null,
      worktreeAuthority: 'private-source-control-coordination-ref',
    },
    directRouteReceipt,
    pixels,
    screenshot: artifact(screenshotPath),
    backend: directRouteReceipt.directRouteSourceMaturity.backend,
    effectiveRoute: directRouteReceipt.directRouteSourceMaturity.effectiveRoute,
    browserEvents: socket.browserEvents,
    lastTrustworthyEvidence: 'exact URL controls, union counts, and visible canvas satisfied without post-load mutation',
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    screenshot: screenshotPath,
    directRouteCandidateCounts: directRouteReceipt.directRouteCandidateCounts,
    directRouteSourceMaturity: directRouteReceipt.directRouteSourceMaturity,
    pixels,
  }, null, 2));
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function chromeExecutable() {
  const candidates = [
    process.env.KAMINOS_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(entry => entry.type === 'page' && !String(entry.url).startsWith('chrome-extension://'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    try {
      last = await evaluate(cdp, `(() => {
        const basinWindow = document.querySelector('#basin')?.contentWindow || window;
        const prototype = basinWindow.__kaminosVolumePrototype || window.__kaminosVolumePrototype;
        const state = prototype?.debugState?.() || null;
        const wrapper = window.__kaminosSelectiveHeadLive?.debugState?.() || null;
        return state ? {
          active: state.active,
          backend: state.backend,
          error: state.error,
          effectiveRoute: state.effectiveRoute,
          wrapperStatus: wrapper?.status || null,
          wrapperFallbackReason: wrapper?.fallbackReason || null,
        } : null;
      })()`);
      if (last?.error) throw new Error(last.error);
      if (last?.active && String(last.backend).startsWith('WebGPU')) return last;
    } catch (error) {
      last = { error: error?.message || String(error) };
    }
    await delay(250);
  }
  throw new Error(`volume runtime did not become active: ${JSON.stringify(last)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'runtime evaluation failed';
    throw new Error(`${detail}\nExpression: ${expression}`);
  }
  return result.result.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    path: relative(process.cwd(), path),
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function gitValue(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function pngPixelMetrics(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(0, 8).compare(signature), 0, 'screenshot is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert.equal(data[12], 0, 'interlaced screenshot PNG is unsupported');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, 'screenshot PNG must be 8-bit');
  assert.ok(colorType === 2 || colorType === 6, `unsupported screenshot PNG color type: ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, height * (stride + 1), 'screenshot PNG payload is partial');
  let prior = Buffer.alloc(stride);
  let litPixels = 0;
  let lumaSum = 0;
  let maxLuma = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = encoded[rowStart];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[rowStart + 1 + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] || 0;
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported screenshot PNG filter: ${filter}`);
      row[x] = value & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const luma = 0.2126 * row[x] + 0.7152 * row[x + 1] + 0.0722 * row[x + 2];
      if (luma > 8) litPixels += 1;
      lumaSum += luma;
      maxLuma = Math.max(maxLuma, luma);
    }
    prior = row;
  }
  const pixelCount = width * height;
  return {
    width,
    height,
    pixelCount,
    litPixels,
    litPixelRatio: litPixels / Math.max(1, pixelCount),
    meanLuma: lumaSum / Math.max(1, pixelCount),
    maxLuma,
    nonblank: litPixels > 64,
  };
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
