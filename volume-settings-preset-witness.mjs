#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { validateVolumeSettingsPresetSourceIdentity } from './volume-settings-preset-contract.mjs';
import { homedir, tmpdir } from 'node:os';
const args = parseArgs(process.argv.slice(2));
const url = String(args.get('--url') || '');
const expectedRepoRootArgument = String(args.get('--expected-repo-root') || '');
const expectedRepoRoot = expectedRepoRootArgument ? resolve(expectedRepoRootArgument) : '';
const expectedCommit = String(args.get('--expected-commit') || '');
let requestedView = null;
const out = resolve(String(args.get('--out') || '/tmp/kaminos-volume-settings-preset.png'));
const cockpitOut = resolve(String(args.get('--cockpit-out') || out.replace(/(\.png)?$/, '-cockpit.png')));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-volume-settings-preset.json'));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const label = String(args.get('--label') || 'Automated settings witness').trim();
const cockpitAnchor = String(args.get('--cockpit-anchor') || '').trim();
const promotionRoot = String(args.get('--promotion-root') || '').trim();
const promotionHandle = String(args.get('--promotion-handle') || '').trim();
const requestedSmokePresentation = String(args.get('--smoke-presentation') || 'off').trim();
const ordinaryDebugExpression = `(() => {
  return {
    state: window.__kaminosVolumePrototype?.debugState?.() || null,
    presetReceipt: window.__kaminosVolumeSettingsPresetReceipt || null,
    smokePresentationReceipt: window.__kaminosRaymarchSmokePresentationReceipt
      || window.__kaminosVolumePrototype?.debugState?.()?.raymarchSmokePresentationReceipt
      || null,
    activeTab: window.__kaminosActiveTab?.() || null,
  };
})()`;

function assertOrdinaryCockpitState(observation, phase, expectedPresetId, expectedSmokePresentation) {
  assert.equal(observation?.state?.routeIdentity, 'native-3d-compute-fluid-raymarch-v0', `${phase}: wrong effective renderer route`);
  assert.equal(observation?.state?.active, true, `${phase}: ordinary volume renderer is not active`);
  assert.equal(observation?.state?.error, null, `${phase}: ordinary volume renderer reported an error`);
  assert.match(String(observation?.state?.backend || ''), /^WebGPU:/, `${phase}: ordinary volume renderer backend is not WebGPU`);
  if (expectedPresetId) assert.equal(observation?.presetReceipt?.presetId, expectedPresetId, `${phase}: wrong immutable settings preset`);
  if (expectedPresetId) {
  assert.equal(
    observation?.presetReceipt?.sourcePresetAuthority,
    'shared-volume-settings-preset-v2',
    `${phase}: settings preset authority is missing`,
  );
  assert.ok(observation?.presetReceipt?.storePath, `${phase}: shared settings store path is missing`);
  }
  assert.equal(
    observation?.smokePresentationReceipt?.normalizedRequestedMode,
    expectedSmokePresentation,
    `${phase}: saved Smoke On/Off request was not restored`,
  );
  assert.equal(
    observation?.smokePresentationReceipt?.effectiveMode,
    expectedSmokePresentation,
    `${phase}: saved Smoke On/Off state silently fell back`,
  );
  assert.equal(observation?.activeTab, 'volume', `${phase}: reopened cockpit is not on the Volume tab`);
}

function assertCockpitControls(observation) {
  assert.ok(Array.isArray(observation?.retired), 'retired-control telemetry is missing');
  assert.ok(observation.retired.some(row => row.name === 'atlas-capture'), 'compatibility group telemetry is missing');
  for (const row of observation.retired) {
    assert.equal(row.hidden, true, `retired ${row.name} is not hidden`);
    assert.equal(row.display, 'none', `retired ${row.name} is rendered`);
    assert.equal(row.width, 0, `retired ${row.name} occupies width`);
    assert.equal(row.height, 0, `retired ${row.name} occupies height`);
  }
  for (const id of ['volume-oracle-activity-cue', 'volume-pressure-mode']) {
    const row = observation.surviving?.find(control => control.id === id);
    assert.equal(row?.missing, false, `surviving control ${id} is missing`);
    assert.notEqual(row.presentationMissing, true, `surviving control ${id} lost its editing field`);
    assert.notEqual(row.display, 'none', `surviving control ${id} is hidden directly`);
    assert.notEqual(row.hidden, true, `surviving control ${id} is hidden directly`);
  }
}

function assertNumericEquivalent(actual, expected, message) {
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(actualNumber), Math.abs(expectedNumber));
  assert.ok(
    Number.isFinite(actualNumber)
      && Number.isFinite(expectedNumber)
      && Math.abs(actualNumber - expectedNumber) <= tolerance,
    `${message}: ${actualNumber} != ${expectedNumber} within ${tolerance}`,
  );
}

function operatorContext(body) {
  return `(() => {
    const operatorWindow = window;
    const operatorDocument = operatorWindow.document;
    return (${body});
  })()`;
}
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};
let browser = null;
const sockets = [];
let expectedPresetControlCount = null;
let expectedRendererControlCount = null;
let expectedPresentationControlCount = null;
const requestedSource = Object.freeze({ repoRoot: expectedRepoRoot, commit: expectedCommit });
let effectiveSource = null;

class CdpSocket {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }
  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.webSocketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => reject(new Error(`CDP socket error: ${this.webSocketUrl}`)), { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
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
      }, timeoutMs);
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
  close() { this.socket?.close(); }
}

try {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeReport({identity:'kaminos-volume-settings-preset-witness-v1',status:'running',failurePhase,requestedUrl:url,requestedSource,effectiveSource,lastTrustworthyEvidence});
  if (!url) throw new Error('missing --url');
  if (!expectedRepoRootArgument) throw new Error('missing --expected-repo-root');
  if (!existsSync(expectedRepoRoot)) throw new Error(`missing --expected-repo-root path: ${expectedRepoRoot}`);
  if (!expectedCommit) throw new Error('missing --expected-commit');
  const requestedUrl = new URL(url);
  const witnessUrl = new URL(requestedUrl);
  requestedView = requestedUrl.searchParams.get('view') || 'raymarch-only';
  if (requestedView !== 'raymarch-only') throw new Error(`unsupported settings preset witness view: ${requestedView}`);
  if (!['on', 'off'].includes(requestedSmokePresentation)) {
    throw new Error(`unsupported --smoke-presentation: ${requestedSmokePresentation}`);
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('--expected-commit requires an exact 40-character lowercase Git commit');
  }
  if (Boolean(promotionRoot) !== Boolean(promotionHandle)) {
    throw new Error('settings preset witness promotion requires both --promotion-root and --promotion-handle');
  }
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(cockpitOut), { recursive: true });

  failurePhase = 'serving-source';
  const runtimeResponse = await fetch(new URL('/api/runtime-config', url));
  assert.equal(runtimeResponse.ok, true, 'runtime source could not be read');
  const runtime = await runtimeResponse.json();
  effectiveSource = runtime.source;
  validateVolumeSettingsPresetSourceIdentity(requestedSource, effectiveSource);
  lastTrustworthyEvidence.effectiveSource = effectiveSource;

  failurePhase = 'preset-index-contract';
  const presetIndexResponse = await fetch(new URL('/api/volume-settings-presets', url));
  const presetIndex = await presetIndexResponse.json();
  assert.equal(presetIndexResponse.ok, true, 'settings preset index could not be read');
  assert.equal(presetIndex.identity, 'kaminos-volume-settings-preset-index-v1', 'settings preset index identity mismatch');
  expectedPresetControlCount = Number(presetIndex.controlCount);
  expectedRendererControlCount = Number(presetIndex.rendererControlCount);
  expectedPresentationControlCount = Number(presetIndex.presentationControlCount);
  for (const [axis, count] of Object.entries({
    basin: expectedPresetControlCount,
    renderer: expectedRendererControlCount,
    presentation: expectedPresentationControlCount,
  })) {
    assert.equal(Number.isSafeInteger(count) && count >= 0, true, `settings preset index ${axis} count is invalid`);
  }

  failurePhase = 'browser-launch';
  const browserExecutable = chromeExecutable();
  const browserProfile = mkdtempSync(join(tmpdir(), 'kaminos-preset-browser-'));
  lastTrustworthyEvidence.browser = { executable: browserExecutable, profile: browserProfile };
  browser = spawn(browserExecutable, [
    '--use-mock-keychain',
    '--password-store=basic',
    `--user-data-dir=${browserProfile}`,
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-popup-blocking',
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  await new Promise((resolveLaunch,rejectLaunch)=>{browser.once('spawn',resolveLaunch);browser.once('error',rejectLaunch);});

  const initialTarget = await waitForTarget(target => target.type === 'page', timeoutMs);
  const initialSocket = await connect(initialTarget);
  await initialSocket.call('Page.enable');
  await initialSocket.call('Runtime.enable');
  await initialSocket.call('Page.navigate', { url: witnessUrl.href });

  failurePhase = 'source-live-settle';
  const initialState = await waitForValue(initialSocket, `(() => {
    const observation = ${ordinaryDebugExpression};
    if (!observation?.state?.active || Number(observation.state.frameCount) < 2) return null;
    return observation;
  })()`, timeoutMs);
  const initialCockpitUrl = await evaluate(initialSocket, 'location.href');
  assert.equal(new URL(initialCockpitUrl).pathname, '/', 'source did not reach the ordinary cockpit');
  assert.equal(initialState.state.routeIdentity, 'native-3d-compute-fluid-raymarch-v0', 'source used a retired renderer');
  assert.equal(initialState.state.error, null, 'source renderer failed');
  assert.match(initialState.state.backend, /^WebGPU:/, 'source renderer did not use WebGPU');
  const button = await evaluate(initialSocket, operatorContext(`(() => {
    const element = operatorDocument.getElementById('settings-preset-save');
    if (!element || element.disabled || element.dataset.commandWired !== 'true') return null;
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: element.textContent };
  })()`));
  assert.ok(button?.width > 0 && button?.height > 0, 'settings preset button was unavailable');
  assert.equal(button.text.trim(), 'Save');
  const labelState = await evaluate(initialSocket, operatorContext(`(() => {
    const input = operatorDocument.getElementById('settings-preset-label');
    if (!input) return null;
    input.value = ${JSON.stringify(label)};
    return { value: input.value, width: input.getBoundingClientRect().width };
  })()`));
  assert.equal(labelState?.value, label, 'settings preset label input did not accept the requested label');
  assert.ok(labelState?.width > 0, 'settings preset label input was not visible');
  const smokePresentationReceipt = await evaluate(initialSocket, operatorContext(`(() => {
    const button = operatorDocument.querySelector('[data-raymarch-smoke-presentation="${requestedSmokePresentation}"]');
    if (!button) return null;
    button.click();
    return operatorWindow.__kaminosRaymarchSmokePresentationReceipt || null;
  })()`));
  assert.equal(
    smokePresentationReceipt?.normalizedRequestedMode,
    requestedSmokePresentation,
    'source cockpit did not accept requested Smoke On/Off state',
  );
  assert.equal(
    smokePresentationReceipt?.effectiveMode,
    requestedSmokePresentation,
    'source cockpit Smoke On/Off state silently fell back',
  );
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    initialState,
    button,
    labelState,
    smokePresentationReceipt,
    presetIndex,
    initialCockpitUrl,
  };

  const initialTargetIds = new Set((await targetList()).map(target => target.id));
  failurePhase = 'operator-command';
  const command = await initialSocket.call('Runtime.evaluate', {
    expression: operatorContext(`operatorWindow.__kaminosSaveVolumeSettingsPreset()`),
    returnByValue: true,
    userGesture: true,
    awaitPromise: true,
  });
  if (command.exceptionDetails) throw new Error(command.exceptionDetails.text || 'settings preset command threw');
  const commandResult = command.result?.value;
  const commandDiagnostic = await evaluate(initialSocket, operatorContext(`({
    captureState: operatorDocument.getElementById('volume-settings-preset-state')?.textContent || null,
    info: operatorDocument.getElementById('info')?.textContent || null,
  })`));
  lastTrustworthyEvidence.commandResult = commandResult ?? null;
  lastTrustworthyEvidence.commandDiagnostic = commandDiagnostic;
  assert.ok(commandResult?.effective?.presetId, 'settings preset command completed without an immutable preset id');
  assert.ok(commandResult?.effective?.alias, 'settings preset command completed without a human alias');
  assert.ok(commandResult.presetUrl, 'settings preset command completed without a durable loader route');
  assert.equal(commandResult.effective.controlCount, expectedPresetControlCount, 'write receipt basin inventory drifted');
  assert.equal(commandResult.effective.rendererControlCount, expectedRendererControlCount, 'write receipt renderer inventory drifted');
  assert.equal(commandResult.effective.presentationControlCount, expectedPresentationControlCount, 'write receipt presentation inventory drifted');
  assert.equal(commandResult.presetViewUrls?.[requestedView], `${commandResult.presetUrl}&view=${requestedView}`, 'settings preset command omitted the selected visual route');
  await delay(500);
  const cockpitVisibility = await evaluate(initialSocket, operatorContext(`(() => {
    const retired = [...operatorDocument.querySelectorAll('[data-volume-retired-control-state]')].map(element => {
      const style = operatorWindow.getComputedStyle(element), rect = element.getBoundingClientRect();
      return {name:element.dataset.volumeRetiredControlState,hidden:element.hidden,display:style.display,width:rect.width,height:rect.height};
    });
    const surviving = ['volume-oracle-activity-cue','volume-pressure-mode'].map(id => {
      const element = operatorDocument.getElementById(id);
      if (!element) return {id,missing:true};
      // Canonical ranges remain in the settings schema while their existing
      // scrub field owns editing and visibility (legacy-range-field.mjs).
      const presentationId = element.dataset.scrubField || id;
      const presentation = operatorDocument.getElementById(presentationId);
      if (!presentation) return {id,missing:false,presentationId,presentationMissing:true};
      const style=operatorWindow.getComputedStyle(presentation),rect=presentation.getBoundingClientRect();
      return {id,missing:false,presentationId,presentationMissing:false,hidden:element.hidden||presentation.hidden,display:style.display,width:rect.width,height:rect.height,visible:rect.width>0&&rect.height>0};
    });
    const anchorId = ${JSON.stringify(cockpitAnchor)};
    const anchor = anchorId ? operatorDocument.getElementById(anchorId) : null;
    if (anchor) anchor.scrollIntoView({ block: 'center' });
    const rect = anchor?.getBoundingClientRect();
    return {
      retired, surviving,
      anchorId, anchorFound: !anchorId || !!anchor,
      anchorVisible: !anchorId || !!rect && rect.width > 0 && rect.height > 0
        && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
      layoutReceipt: operatorWindow.__kaminosVolumeCockpitLayoutReceipt || null,
    };
  })()`));
  lastTrustworthyEvidence.cockpitVisibility = cockpitVisibility;
  assertCockpitControls(cockpitVisibility);
  assert.equal(cockpitVisibility.anchorFound && cockpitVisibility.anchorVisible, true, 'requested cockpit anchor is not visible');
  assert.equal(cockpitVisibility.layoutReceipt?.identity, 'kaminos-volume-cockpit-layout-receipt-v0', 'cockpit layout receipt is missing');
  assert.equal(cockpitVisibility.layoutReceipt?.presetControlCount, expectedPresetControlCount, 'cockpit basin inventory drifted');
  assert.equal(cockpitVisibility.layoutReceipt?.rendererControlCount, expectedRendererControlCount, 'cockpit renderer inventory drifted');
  assert.equal(cockpitVisibility.layoutReceipt?.fallbackApplied, false, 'cockpit layout silently fell back');
  const cockpitScreenshot = await initialSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(cockpitOut, Buffer.from(cockpitScreenshot.data, 'base64'));
  lastTrustworthyEvidence.cockpitScreenshot = cockpitOut;
  let promotionReceipt = null;
  if (promotionRoot) {
    failurePhase = 'basin-promotion-export';
    promotionReceipt = await evaluate(initialSocket, operatorContext(`(async () => {
      const handleInput = operatorDocument.getElementById('basin-promotion-handle');
      const rootInput = operatorDocument.getElementById('basin-promotion-root');
      if (!handleInput || !rootInput || typeof operatorWindow.__kaminosExportBasinPromotionPackage !== 'function') {
        throw new Error('cockpit basin promotion action is unavailable');
      }
      handleInput.value = ${JSON.stringify(promotionHandle)};
      rootInput.value = ${JSON.stringify(promotionRoot)};
      return operatorWindow.__kaminosExportBasinPromotionPackage();
    })()`));
    assert.equal(promotionReceipt?.identity, 'kaminos.volume.basin-promotion-write-receipt.v1', 'cockpit export returned a stale receipt schema');
    assert.equal(promotionReceipt?.promotion?.status, 'written', 'cockpit export did not write a promotion package');
    assert.equal(promotionReceipt?.promotion?.handle, promotionHandle, 'cockpit export substituted the stable handle');
    assert.ok(promotionReceipt?.promotion?.packagePath, 'cockpit export omitted the caller-addressed package path');
    assert.ok(promotionReceipt?.promotion?.channelPath, 'cockpit export omitted the current channel path');
    const promotedPackage = JSON.parse(readFileSync(promotionReceipt.promotion.packagePath, 'utf8'));
    assert.equal(promotedPackage.settingsPreset.presetId, commandResult.effective.presetId, 'cockpit export package substituted the loaded preset');
    assert.equal(promotedPackage.effectiveState.source.settingsPresetId, commandResult.effective.presetId, 'cockpit export omitted the effective source preset');
    assert.equal(promotedPackage.effectiveState.initialization.settingsPresetId, commandResult.effective.presetId, 'cockpit export omitted the initialization preset');
    assert.equal(promotedPackage.effectiveState.renderer.fallbackReason, null, 'cockpit export inherited a stale renderer fallback');
    assert.equal(promotedPackage.effectiveState.composition.fallbackReason, null, 'cockpit export reported a composition fallback');
    lastTrustworthyEvidence.promotedPackage = {
      path: promotionReceipt.promotion.packagePath,
      revision: promotedPackage.revision,
      sourceCommit: promotedPackage.sourceCommit,
      presetId: promotedPackage.settingsPreset.presetId,
    };
    lastTrustworthyEvidence.promotionReceipt = promotionReceipt;
  }
  const navigation = await initialSocket.call('Runtime.evaluate', {
    expression: operatorContext(`operatorWindow.__kaminosNavigateToSelectedVolumeSettingsPreset(true)`),
    returnByValue: true,
    userGesture: true,
  });
  if (navigation.exceptionDetails) throw new Error(navigation.exceptionDetails.text || 'settings preset navigation threw');
  assert.ok(navigation.result?.value, 'Open Fresh did not return its requested loader route');
  const requestedNavigation = new URL(navigation.result.value, url);
  assert.equal(requestedNavigation.pathname, '/volume-settings-preset.html', 'Open Fresh bypassed the exact preset loader');
  assert.equal(requestedNavigation.searchParams.get('preset'), commandResult.effective.presetId, 'Open Fresh changed the selected immutable preset');
  assert.equal(requestedNavigation.searchParams.has('view'), false, 'Cockpit loading leaked a renderer inspection view');

  failurePhase = 'effective-live-target';
  const liveTarget = await waitForTarget(target => (
    target.type === 'page'
    && !initialTargetIds.has(target.id)
    && target.url.includes('settings_preset=')
  ), timeoutMs);
  const liveUrl = new URL(liveTarget.url);
  const sourcePresetId = liveUrl.searchParams.get('settings_preset');
  const sourcePresetAuthority = liveUrl.searchParams.get('settings_preset_authority');
  assert.equal(sourcePresetId, commandResult.effective.presetId);
  assert.equal(sourcePresetAuthority, 'shared-volume-settings-preset-v2');
  assert.equal(liveUrl.pathname, '/', 'saved basin did not reopen in the ordinary cockpit');
  for (const forbiddenRendererParam of ['view', 'role', 'composition', 'warmup_steps', 'basin_capture', 'basin_source_authority']) {
    assert.equal(liveUrl.searchParams.has(forbiddenRendererParam), false, `live cockpit target invented renderer parameter ${forbiddenRendererParam}`);
  }

  const liveSocket = await connect(liveTarget);
  await liveSocket.call('Page.enable');
  await liveSocket.call('Runtime.enable');
  const startState = await waitForValue(liveSocket, `(() => {
    const observation = ${ordinaryDebugExpression};
    if (!observation?.state?.active || Number(observation.state.frameCount) < 2 || !observation.presetReceipt) return null;
    return observation;
  })()`, timeoutMs);
  assertOrdinaryCockpitState(startState, 'reopened live target', sourcePresetId, requestedSmokePresentation);

  failurePhase = 'preset-artifact-verification';
  const presetResponse = await fetch(new URL(`/api/volume-settings-preset?id=${encodeURIComponent(sourcePresetId)}`, url));
  const presetDocument = await presetResponse.json();
  assert.equal(presetResponse.ok, true, 'saved settings preset could not be read back');
  assert.equal(presetDocument.presetId, sourcePresetId);
  assert.equal(presetDocument.preset?.identity, 'kaminos-volume-settings-preset-v2');
  assert.equal(presetDocument.preset?.kind, 'settings-preset');
  assert.equal(presetDocument.preset?.controlCount, expectedPresetControlCount);
  assert.equal(presetDocument.preset?.rendererControlCount, expectedRendererControlCount);
  assert.equal(presetDocument.preset?.presentationControlCount, expectedPresentationControlCount);
  effectiveSource = {
    repoRoot: presetDocument.source?.repoRoot ? resolve(String(presetDocument.source.repoRoot)) : '',
    branch: String(presetDocument.source?.branch || ''),
    commit: String(presetDocument.source?.commit || ''),
  };
  lastTrustworthyEvidence.effectiveSource = effectiveSource;
  validateVolumeSettingsPresetSourceIdentity(requestedSource, effectiveSource);
  assert.equal(
    presetDocument.preset?.presentationControls?.['raymarch-smoke-presentation']?.value,
    requestedSmokePresentation,
    'saved preset did not author Smoke On/Off state',
  );
  for (const field of ['fluidField', 'frontField', 'boundarySidecar', 'splatInstances', 'historyBuffers', 'pressureState', 'replayState', 'volumeDebugState', 'camera', 'viewport']) {
    assert.equal(Object.hasOwn(presetDocument.preset, field), false, `settings preset persisted forbidden state field ${field}`);
  }
  const savedRoute = new URL(presetDocument.preset.route);
  for (const [key, value] of [...savedRoute.searchParams].filter(([key]) => key.startsWith('volume_'))) {
    assert.deepEqual(liveUrl.searchParams.getAll(key), [value], `effective live route changed saved setting ${key}`);
  }
  const savedVolumeKeys = [...savedRoute.searchParams].filter(([key]) => key.startsWith('volume_')).map(([key]) => key);
  const liveVolumeKeys = [...liveUrl.searchParams]
    .filter(([key]) => key.startsWith('volume_'))
    .map(([key]) => key);
  assert.deepEqual(liveVolumeKeys, savedVolumeKeys, 'effective live route added or omitted volume settings');

  failurePhase = 'continued-cockpit-tuning';
  const steerabilityReceipt = await evaluate(liveSocket, `(() => {
    const input = document.getElementById('volume-density');
    const loadButton = document.getElementById('settings-preset-load-here');
    if (!input || !loadButton) return null;
    const before = Number(input.value);
    const step = Number(input.step) || 0.05;
    const max = Number(input.max);
    const requested = before + step <= max ? before + step : before - step;
    input.value = String(requested);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const changed = Number(window.__kaminosVolumePrototype?.debugState?.()?.controls?.density);
    input.value = String(before);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const restored = Number(window.__kaminosVolumePrototype?.debugState?.()?.controls?.density);
    return {
      loadCommandWired: loadButton.dataset.commandWired || null,
      before,
      requested,
      changed,
      restored,
    };
  })()`);
  assert.equal(steerabilityReceipt?.loadCommandWired, 'true', 'reopened cockpit load command is not wired');
  assertNumericEquivalent(steerabilityReceipt?.changed, steerabilityReceipt?.requested, 'reopened cockpit rejected a tuning change');
  assertNumericEquivalent(steerabilityReceipt?.restored, steerabilityReceipt?.before, 'reopened cockpit did not restore the saved tuning value');
  lastTrustworthyEvidence.steerabilityReceipt = steerabilityReceipt;

  failurePhase = 'continuous-observation';
  await delay(5000);
  const endState = await evaluate(liveSocket, ordinaryDebugExpression);
  assertOrdinaryCockpitState(
    endState,
    'reopened live target after observation',
    sourcePresetId,
    requestedSmokePresentation,
  );
  const continuousFrameDelta = Number(endState.state.frameCount) - Number(startState.state.frameCount);
  const continuousSimStepDelta = Number(endState.state.simStepCount) - Number(startState.state.simStepCount);
  assert.ok(continuousFrameDelta >= 2, 'live render frames did not advance');
  assert.ok(continuousSimStepDelta >= 2, 'live simulation steps did not advance');

  failurePhase = 'ui-screenshot';
  const screenshot = await liveSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'live settings screenshot was missing or partial');
  writeFileSync(out, screenshotBytes);

  writeReport({
    identity: 'kaminos-volume-settings-preset-witness-v1',
    status: 'persisted-and-live',
    failurePhase: null,
    requestedUrl: url,
    initialCockpitUrl,
    effectiveUrl: liveTarget.url,
    requestedSource,
    effectiveSource,
    sourcePresetId,
    sourcePresetAuthority,
    requestedView,
    writeReceipt: commandResult.effective,
    visualAuthority: 'not-evaluated-settings-persistence-only',
    controlCount: presetDocument.preset.controlCount,
    rendererControlCount: presetDocument.preset.rendererControlCount,
    presentationControlCount: presetDocument.preset.presentationControlCount,
    smokePresentation: requestedSmokePresentation,
    storePath: commandResult.effective.storePath,
    sharedPublication: commandResult.sharedPublication ?? null,
    continuousFrameDelta,
    continuousSimStepDelta,
    steerabilityReceipt,
    cockpitAnchor: cockpitVisibility.anchorId || null,
    cockpitVisibility,
    promotionReceipt,
    cockpitScreenshot: cockpitOut,
    screenshot: out,
    screenshotBytes: screenshotBytes.length,
  });
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: out, sourcePresetId, continuousFrameDelta, continuousSimStepDelta }, null, 2));
} catch (error) {
  writeReport({
    identity: 'kaminos-volume-settings-preset-witness-v1',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl: url,
    requestedSource,
    effectiveSource,
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await new Promise(resolveExit=>{browser.once('close',resolveExit);browser.kill('SIGTERM');});
  }
}

async function connect(target) {
  const socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  sockets.push(socket);
  return socket;
}

async function evaluate(socket, expression) {
  const result = await socket.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'runtime evaluation failed');
  return result.result.value;
}

async function waitForValue(socket, expression, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = await evaluate(socket, expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error('timed out waiting for browser state');
}

async function targetList() {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  return response.json();
}

async function waitForTarget(predicate, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const target = (await targetList()).find(predicate);
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for browser target');
}

function chromeExecutable() {
  const explicit = String(args.get('--browser') || process.env.CHROME_BIN || '');
  if (explicit) {
    assert.equal(existsSync(explicit), true, 'independent browser executable is missing');
    assert.doesNotMatch(explicit, /\/Applications\/Google Chrome(?: Canary)?\.app\//, 'installed GUI Chrome cannot be used headlessly');
    return explicit;
  }
  const cache = join(homedir(), 'Library/Caches/ms-playwright');
  for (const entry of existsSync(cache) ? readdirSync(cache).filter(name => name.startsWith('chromium-')).sort().reverse() : []) {
    const candidate = join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('independent browser not found; pass --browser with Chrome for Testing, Playwright Chromium or headless-shell');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
