#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const url = required('--url');
const requestedUrl = new URL(url);
const requestedView = requestedUrl.searchParams.get('view');
const PRESET_VIEW_COMPOSITIONS = Object.freeze({
  'splat-only': 'splat-only-v0',
  'raymarch-only': 'raymarch-only-v0',
  'smoke-hybrid': 'smoke-raymarch-under-splats-v0',
  'full-hybrid-diagnostic': 'full-raymarch-under-splats-diagnostic-v0',
});
const TARGET_ONLY_VOLUME_PARAMS = new Set([
  'volume_presentation',
  'volume_raymarch_smoke',
  'volume_appearance_decomposition',
  'volume_appearance_selection',
]);
const expectedComposition = PRESET_VIEW_COMPOSITIONS[requestedView];
const PASS_TUPLES = Object.freeze({
  'splat-only-v0': Object.freeze({
    splatApplied: true,
    raymarchApplied: false,
    raymarchFireAuthority: 0,
    compositionAuthority: 'splat-fire-authority-learned-boundary-sheets-v0',
    raymarchAuthority: 'smoke-raymarch-authority-broad-smoke-only-v0',
  }),
  'raymarch-only-v0': Object.freeze({
    splatApplied: false,
    raymarchApplied: true,
    raymarchFireAuthority: 1,
    compositionAuthority: 'diagnostic-raymarch-full-selected-field-authority-v0',
    raymarchAuthority: 'diagnostic-raymarch-selected-fields-fire-smoke-v0',
  }),
  'smoke-raymarch-under-splats-v0': Object.freeze({
    splatApplied: true,
    raymarchApplied: true,
    raymarchFireAuthority: 0,
    compositionAuthority: 'smoke-raymarch-authority-broad-smoke-only-v0+splat-fire-authority-learned-boundary-sheets-v0',
    raymarchAuthority: 'smoke-raymarch-authority-broad-smoke-only-v0',
  }),
  'full-raymarch-under-splats-diagnostic-v0': Object.freeze({
    splatApplied: true,
    raymarchApplied: true,
    raymarchFireAuthority: 1,
    compositionAuthority: 'diagnostic-full-fire-raymarch-under-splats-duplicate-fire-authority-v0',
    raymarchAuthority: 'diagnostic-raymarch-selected-fields-fire-smoke-v0',
  }),
});
const out = resolve(String(args.get('--out') || '/tmp/kaminos-volume-settings-preset.png'));
const cockpitOut = resolve(String(args.get('--cockpit-out') || out.replace(/(\.png)?$/, '-cockpit.png')));
const cockpitCollapsedOut = resolve(String(args.get('--cockpit-collapsed-out') || cockpitOut.replace(/(\.png)?$/, '-collapsed.png')));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-volume-settings-preset.json'));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const label = String(args.get('--label') || 'Automated settings witness').trim();
const cockpitAnchor = String(args.get('--cockpit-anchor') || '').trim();
const liveDebugExpression = `(() => {
  return window.__kaminosSelectiveHeadLive?.debugState?.() || null;
})()`;

function assertSelectiveCompositionState(state, phase, expectedPresetId = null) {
  assert.equal(state?.routeIdentity, 'exact-basin-selective-head-live-v0', `${phase}: wrong effective route`);
  assert.equal(state?.status, 'running', `${phase}: selective wrapper is not running`);
  assert.equal(state?.requestedRole, 'truthHigh', `${phase}: wrong requested role`);
  assert.equal(state?.effectiveRole, 'truthHigh', `${phase}: requested role silently fell back`);
  assert.equal(state?.roleAuthority, 'current-high-field-reference-no-learned-composition-v0', `${phase}: wrong role authority`);
  assert.equal(state?.requestedComposition, expectedComposition, `${phase}: wrong requested composition`);
  assert.equal(state?.effectiveComposition, expectedComposition, `${phase}: requested composition silently fell back`);
  assert.equal(state?.fallbackReason, null, `${phase}: selective route reported fallback`);
  assert.equal(state?.compositionFallbackReason, null, `${phase}: selective composition reported fallback`);
  assert.equal(state?.boundarySplatFallbackReason, null, `${phase}: boundary splat route reported fallback`);
  assert.equal(state?.sourceSettingsPresetAuthority, 'shared-volume-settings-preset-v2', `${phase}: settings preset authority is missing`);
  assert.ok(state?.sourceSettingsPresetStorePath, `${phase}: shared settings store path is missing`);
  if (expectedPresetId) assert.equal(state?.sourceSettingsPresetId, expectedPresetId, `${phase}: wrong immutable settings preset`);
  const receipt = state?.selectiveHeadLivePassReceipt;
  const expectedPassTuple = PASS_TUPLES[expectedComposition];
  assert.equal(receipt?.identity, 'selective-head-live-render-pass-receipt-v0', `${phase}: pass receipt identity mismatch`);
  assert.equal(receipt?.composition, expectedComposition, `${phase}: pass receipt composition mismatch`);
  assert.equal(receipt?.splatEncoded, expectedPassTuple.splatApplied, `${phase}: splat encode tuple mismatch`);
  assert.equal(receipt?.splatApplied, expectedPassTuple.splatApplied, `${phase}: splat apply tuple mismatch`);
  assert.equal(receipt?.raymarchEncoded, expectedPassTuple.raymarchApplied, `${phase}: raymarch encode tuple mismatch`);
  assert.equal(receipt?.raymarchApplied, expectedPassTuple.raymarchApplied, `${phase}: raymarch apply tuple mismatch`);
  assert.equal(receipt?.compositionAuthority, expectedPassTuple.compositionAuthority, `${phase}: composition authority mismatch`);
  assert.equal(receipt?.raymarchAuthority, expectedPassTuple.raymarchAuthority, `${phase}: raymarch authority mismatch`);
  assert.equal(receipt?.raymarchFireAuthority, expectedPassTuple.raymarchFireAuthority, `${phase}: raymarch fire authority mismatch`);
  assert.equal(receipt?.fallbackReason, null, `${phase}: pass receipt reported fallback`);
}

function operatorContext(body) {
  return `(() => {
    const operatorWindow = document.querySelector('#basin')?.contentWindow || window;
    const operatorDocument = operatorWindow.document;
    return (${body});
  })()`;
}
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};
let browser = null;
const sockets = [];

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
  if (!requestedView) throw new Error('settings preset witness requires an explicit renderer view');
  if (!expectedComposition) throw new Error(`unsupported settings preset witness view: ${requestedView}`);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(cockpitOut), { recursive: true });
  mkdirSync(dirname(cockpitCollapsedOut), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
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

  const initialTarget = await waitForTarget(target => target.type === 'page', timeoutMs);
  const initialSocket = await connect(initialTarget);
  await initialSocket.call('Page.enable');
  await initialSocket.call('Runtime.enable');
  await initialSocket.call('Page.navigate', { url });

  failurePhase = 'source-live-settle';
  const initialState = await waitForValue(initialSocket, `(() => {
    const state = ${liveDebugExpression};
    if (state?.status !== 'running' || Number(state.frameCount) < 2) return null;
    return state;
  })()`, timeoutMs);
  assertSelectiveCompositionState(initialState, 'source live target');
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
  lastTrustworthyEvidence = { initialState, button, labelState };

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
  assert.equal(commandResult.presetViewUrls?.[requestedView], `${commandResult.presetUrl}&view=${requestedView}`, 'settings preset command omitted the selected visual route');
  await delay(500);
  const cockpitVisibility = await evaluate(initialSocket, operatorContext(`(() => {
    const retired = [...operatorDocument.querySelectorAll('[data-volume-retired-control-state]')].map(element => {
      const style = operatorWindow.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        name: element.dataset.volumeRetiredControlState,
        hidden: element.hidden,
        display: style.display,
        width: rect.width,
        height: rect.height,
      };
    });
    const surviving = ['volume-oracle-activity-cue', 'volume-pressure-mode'].map(id => {
      const element = operatorDocument.getElementById(id);
      if (!element) return { id, missing: true };
      const style = operatorWindow.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { id, missing: false, display: style.display, width: rect.width, height: rect.height };
    });
    const anchorId = ${JSON.stringify(cockpitAnchor)};
    const anchor = anchorId ? operatorDocument.getElementById(anchorId) : null;
    if (anchor) anchor.scrollIntoView({ block: 'center' });
    const panel = operatorDocument.getElementById('volume-authored-mix-panel');
    const body = operatorDocument.getElementById('volume-authored-mix-body');
    const toggle = operatorDocument.getElementById('volume-authored-mix-toggle');
    const authoredRoot = operatorDocument.getElementById('volume-authored-mix-control-root');
    const canary = operatorDocument.getElementById('volume-reaction-boundary-support-thermal');
    const viewport = operatorDocument.getElementById('viewport');
    const hostRendererCanvas = operatorDocument.getElementById('kaminos-host-renderer-canvas');
    const outerToolbar = document.getElementById('toolbar');
    const panelRect = panel?.getBoundingClientRect();
    const bodyRect = body?.getBoundingClientRect();
    const toggleRect = toggle?.getBoundingClientRect();
    const canaryRect = canary?.getBoundingClientRect();
    const viewportRect = viewport?.getBoundingClientRect();
    const hostRendererCanvasRect = hostRendererCanvas?.getBoundingClientRect();
    const outerToolbarRect = outerToolbar?.getBoundingClientRect();
    const assayPlacementReceipt = operatorWindow.__kaminosVolumeAssayViewportPlacementReceipt || null;
    const hit = bodyRect && bodyRect.width > 0 && bodyRect.height > 0
      ? operatorDocument.elementFromPoint(bodyRect.left + Math.min(24, bodyRect.width / 2), bodyRect.top + Math.min(24, bodyRect.height / 2))
      : null;
    const layoutReceipt = operatorWindow.__kaminosVolumeCockpitLayoutReceipt || null;
    return {
      retired,
      surviving,
      anchorId,
      anchorFound: !anchorId || !!anchor,
      layoutReceipt,
      assayViewportGeometry: {
        activeTab: operatorWindow.__kaminosActiveTab?.() || null,
        toolbarHidden: outerToolbar?.hidden ?? true,
        placementReceipt: assayPlacementReceipt,
        toolbarLeft: outerToolbarRect?.left ?? null,
        toolbarTop: outerToolbarRect?.top ?? null,
        toolbarRight: outerToolbarRect?.right ?? null,
        toolbarBottom: outerToolbarRect?.bottom ?? null,
        viewportLeft: viewportRect?.left ?? null,
        viewportTop: viewportRect?.top ?? null,
        viewportRight: viewportRect?.right ?? null,
        viewportBottom: viewportRect?.bottom ?? null,
        contained: Boolean(outerToolbarRect && viewportRect)
          && outerToolbarRect.left >= viewportRect.left
          && outerToolbarRect.top >= viewportRect.top
          && outerToolbarRect.right <= viewportRect.right
          && outerToolbarRect.bottom <= viewportRect.bottom,
      },
      hostRendererCanvasGeometry: hostRendererCanvasRect ? {
        hostCanvasLeft: hostRendererCanvasRect.left,
        hostCanvasRight: hostRendererCanvasRect.right,
        hostCanvasWidth: hostRendererCanvasRect.width,
        hostCanvasBackingWidth: hostRendererCanvas.width,
        viewportRight: viewportRect.right,
        viewportWidth: viewportRect.width,
        hostCanvasCrossesPanel: hostRendererCanvasRect.right > panelRect.left + 1,
      } : null,
      panelGeometry: panelRect ? {
        hidden: panel.hidden,
        collapsed: panel.dataset.collapsed,
        cockpitStatus: panel.dataset.cockpitStatus,
        left: panelRect.left,
        right: panelRect.right,
        width: panelRect.width,
        height: panelRect.height,
        bodyDisplay: operatorWindow.getComputedStyle(body).display,
        bodyWidth: bodyRect.width,
        toggleWidth: toggleRect.width,
        viewportRight: viewportRect.right,
        viewportWidth: viewportRect.width,
        canaryWidth: canaryRect.width,
        canaryInAuthoredRoot: authoredRoot?.contains(canary) || false,
        hitInsidePanel: !!hit && panel.contains(hit),
      } : null,
    };
  })()`));
  lastTrustworthyEvidence.cockpitVisibility = cockpitVisibility;
  assert.deepEqual(
    cockpitVisibility.retired.map(entry => entry.name).sort(),
    ['atlas-capture', 'raymarch-history', 'topology-shell'],
    'cockpit retired-control group inventory changed',
  );
  for (const entry of cockpitVisibility.retired) {
    assert.equal(entry.hidden, true, `retired cockpit group ${entry.name} lost its hidden contract`);
    assert.equal(entry.display, 'none', `retired cockpit group ${entry.name} is still rendered`);
    assert.equal(entry.width, 0, `retired cockpit group ${entry.name} still occupies horizontal space`);
    assert.equal(entry.height, 0, `retired cockpit group ${entry.name} still occupies vertical space`);
  }
  for (const entry of cockpitVisibility.surviving) {
    assert.equal(entry.missing, false, `surviving cockpit control ${entry.id} is missing`);
    assert.notEqual(entry.display, 'none', `surviving cockpit control ${entry.id} is hidden`);
    assert.ok(entry.width > 0 && entry.height > 0, `surviving cockpit control ${entry.id} has no rendered box`);
  }
  assert.equal(cockpitVisibility.anchorFound, true, `cockpit screenshot anchor is missing: ${cockpitAnchor}`);
  assert.equal(cockpitVisibility.layoutReceipt?.identity, 'kaminos-volume-cockpit-layout-receipt-v0', 'cockpit layout receipt is missing');
  assert.equal(cockpitVisibility.layoutReceipt?.controlCount, 189, 'cockpit layout omitted basin or renderer controls');
  assert.equal(cockpitVisibility.layoutReceipt?.presetControlCount, 186, 'canonical basin control count changed');
  assert.equal(cockpitVisibility.layoutReceipt?.rendererControlCount, 3, 'renderer control axis is incomplete');
  assert.equal(cockpitVisibility.layoutReceipt?.rootControlCounts?.['volume-primary-control-root'], 188, 'primary root count changed');
  assert.equal(cockpitVisibility.layoutReceipt?.rootControlCounts?.['volume-authored-mix-control-root'], 1, 'authored-mix root count changed');
  assert.equal(cockpitVisibility.layoutReceipt?.fallbackApplied, false, 'cockpit layout silently fell back');
  assert.equal(cockpitVisibility.assayViewportGeometry?.activeTab, 'volume', 'assay route did not admit the Volume tab');
  assert.equal(cockpitVisibility.assayViewportGeometry?.toolbarHidden, false, 'assay cockpit is hidden on the Volume tab');
  assert.equal(cockpitVisibility.assayViewportGeometry?.contained, true, 'assay cockpit crosses the volume viewport boundary');
  assert.equal(
    cockpitVisibility.assayViewportGeometry?.placementReceipt?.identity,
    'kaminos-volume-assay-viewport-placement-v0',
    'volume viewport placement receipt is missing',
  );
  assert.equal(cockpitVisibility.assayViewportGeometry?.placementReceipt?.visible, true, 'placement receipt did not apply to Volume');
  assert.equal(cockpitVisibility.assayViewportGeometry?.placementReceipt?.contained, true, 'placement receipt reports viewport overflow');
  assert.equal(cockpitVisibility.assayViewportGeometry?.placementReceipt?.fallbackApplied, false, 'assay placement silently fell back');
  assert.ok(cockpitVisibility.hostRendererCanvasGeometry, 'host renderer canvas geometry is missing');
  assert.equal(
    cockpitVisibility.hostRendererCanvasGeometry?.hostCanvasCrossesPanel,
    false,
    'stale host renderer canvas crosses into the authored-mix panel',
  );
  assert.ok(
    Math.abs(cockpitVisibility.hostRendererCanvasGeometry?.hostCanvasRight
      - cockpitVisibility.hostRendererCanvasGeometry?.viewportRight) <= 1,
    'host renderer canvas is not synchronized to the viewport edge',
  );
  assert.equal(cockpitVisibility.panelGeometry?.hidden, false, 'authored-mix panel is hidden on the Volume route');
  assert.equal(cockpitVisibility.panelGeometry?.collapsed, 'false', 'authored-mix panel did not start expanded');
  assert.equal(cockpitVisibility.panelGeometry?.cockpitStatus, 'validated', 'authored-mix panel rendered before inventory validation');
  assert.ok(cockpitVisibility.panelGeometry?.width >= 320, 'authored-mix panel is too narrow to operate');
  assert.ok(cockpitVisibility.panelGeometry?.bodyWidth > 250, 'authored-mix panel body has no usable width');
  assert.ok(cockpitVisibility.panelGeometry?.toggleWidth >= 30, 'authored-mix panel toggle has no stable hit target');
  assert.ok(cockpitVisibility.panelGeometry?.viewportWidth > 0, 'authored-mix panel displaced the viewport completely');
  assert.ok(cockpitVisibility.panelGeometry?.left >= cockpitVisibility.panelGeometry?.viewportRight - 1, 'authored-mix panel overlaps the viewport as an unlabeled overlay');
  assert.equal(cockpitVisibility.panelGeometry?.canaryInAuthoredRoot, true, 'authored-mix canary was cloned or left in the primary root');
  assert.ok(cockpitVisibility.panelGeometry?.canaryWidth > 0, 'authored-mix canary has no rendered width');
  assert.equal(cockpitVisibility.panelGeometry?.hitInsidePanel, true, 'authored-mix panel is painted behind another surface');
  const nonVolumeTabs = await evaluate(initialSocket, operatorContext(`[
    ...operatorDocument.querySelectorAll('.tab[data-tab]'),
  ].map(tab => tab.dataset.tab).filter(tabName => tabName !== 'volume')`));
  const nonVolumeIsolation = [];
  for (const tabName of nonVolumeTabs) {
    await evaluate(initialSocket, operatorContext(`operatorWindow.__kaminosSetActiveTab(${JSON.stringify(tabName)})`));
    await delay(50);
    const isolation = await evaluate(initialSocket, `(() => {
      const operatorWindow = document.querySelector('#basin')?.contentWindow;
      const toolbar = document.getElementById('toolbar');
      return {
        requestedTab: ${JSON.stringify(tabName)},
        activeTab: operatorWindow?.__kaminosActiveTab?.() || null,
        toolbarHidden: toolbar?.hidden ?? false,
        receipt: operatorWindow?.__kaminosVolumeAssayViewportPlacementReceipt || null,
      };
    })()`);
    assert.equal(isolation.activeTab, tabName, `tab-isolation witness did not select ${tabName}`);
    assert.equal(isolation.toolbarHidden, true, `assay cockpit leaked into the ${tabName} tab`);
    assert.equal(isolation.receipt?.visible, false, `non-volume placement receipt claims visible controls on ${tabName}`);
    nonVolumeIsolation.push(isolation);
  }
  await evaluate(initialSocket, operatorContext(`operatorWindow.__kaminosSetActiveTab('volume')`));
  await delay(100);
  const restoredPlacement = await evaluate(initialSocket, `(() => {
    const operatorWindow = document.querySelector('#basin')?.contentWindow;
    return operatorWindow?.__kaminosVolumeAssayViewportPlacementReceipt || null;
  })()`);
  assert.equal(restoredPlacement?.activeTab, 'volume', 'Volume tab did not restore after isolation witness');
  assert.equal(restoredPlacement?.visible, true, 'assay cockpit did not restore with Volume');
  await initialSocket.call('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(150);
  const responsiveIsolation = await evaluate(initialSocket, `(() => {
    const operatorWindow = document.querySelector('#basin')?.contentWindow;
    const toolbar = document.getElementById('toolbar');
    const panel = operatorWindow?.document.querySelector('#volume-authored-mix-panel');
    const toolbarRect = toolbar?.hidden ? null : toolbar?.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    return {
      toolbarHidden: toolbar?.hidden ?? false,
      toolbarRight: toolbarRect?.right ?? null,
      panelLeft: panelRect?.left ?? null,
      receipt: operatorWindow?.__kaminosVolumeAssayViewportPlacementReceipt || null,
    };
  })()`);
  assert.equal(
    responsiveIsolation.toolbarHidden || responsiveIsolation.toolbarRight <= responsiveIsolation.panelLeft,
    true,
    'assay cockpit overlaps the fixed authored-mix panel at the 700px breakpoint',
  );
  assert.equal(responsiveIsolation.receipt?.fallbackApplied, false, 'responsive assay placement silently fell back');
  if (responsiveIsolation.toolbarHidden) {
    assert.equal(responsiveIsolation.receipt?.reason, 'insufficient-volume-viewport-space', 'responsive placement hid without an explicit reason');
  }
  await initialSocket.call('Emulation.clearDeviceMetricsOverride');
  await delay(150);
  lastTrustworthyEvidence.nonVolumeIsolation = nonVolumeIsolation;
  lastTrustworthyEvidence.responsiveIsolation = responsiveIsolation;
  lastTrustworthyEvidence.restoredPlacement = restoredPlacement;
  await delay(200);
  const cockpitScreenshot = await initialSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(cockpitOut, Buffer.from(cockpitScreenshot.data, 'base64'));
  lastTrustworthyEvidence.cockpitScreenshot = cockpitOut;

  const collapsed = await evaluate(initialSocket, operatorContext(`(() => {
    const panel = operatorDocument.getElementById('volume-authored-mix-panel');
    const body = operatorDocument.getElementById('volume-authored-mix-body');
    const toggle = operatorDocument.getElementById('volume-authored-mix-toggle');
    toggle.click();
    const panelRect = panel.getBoundingClientRect();
    return {
      collapsedWidth: panelRect.width,
      collapsedBodyDisplay: operatorWindow.getComputedStyle(body).display,
      collapsedState: panel.dataset.collapsed,
      ariaExpanded: toggle.getAttribute('aria-expanded'),
    };
  })()`));
  assert.ok(collapsed.collapsedWidth >= 33 && collapsed.collapsedWidth <= 35, 'authored-mix collapsed rail width changed');
  assert.equal(collapsed.collapsedBodyDisplay, 'none', 'authored-mix body still occupies space when collapsed');
  assert.equal(collapsed.collapsedState, 'true', 'authored-mix panel did not publish collapsed state');
  assert.equal(collapsed.ariaExpanded, 'false', 'authored-mix toggle accessibility state did not collapse');
  await delay(200);
  const cockpitCollapsedScreenshot = await initialSocket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(cockpitCollapsedOut, Buffer.from(cockpitCollapsedScreenshot.data, 'base64'));
  lastTrustworthyEvidence.cockpitCollapsedScreenshot = cockpitCollapsedOut;
  lastTrustworthyEvidence.collapsed = collapsed;
  await evaluate(initialSocket, operatorContext(`(() => {
    operatorDocument.getElementById('volume-authored-mix-toggle').click();
    return operatorDocument.getElementById('volume-authored-mix-panel').dataset.collapsed;
  })()`));

  const navigation = await initialSocket.call('Runtime.evaluate', {
    expression: operatorContext(`operatorWindow.__kaminosNavigateToSelectedVolumeSettingsPreset(true)`),
    returnByValue: true,
    userGesture: true,
  });
  if (navigation.exceptionDetails) throw new Error(navigation.exceptionDetails.text || 'settings preset navigation threw');
  assert.ok(navigation.result?.value, 'Open Fresh did not return its requested loader route');
  const requestedNavigation = new URL(navigation.result.value, url);
  assert.equal(requestedNavigation.searchParams.get('view'), requestedView, 'Open Fresh changed the current renderer view');

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
  assert.equal(liveUrl.searchParams.get('role'), 'truthHigh');
  assert.equal(liveUrl.searchParams.get('composition'), expectedComposition);
  assert.equal(liveUrl.searchParams.get('warmup_steps'), '0');
  for (const forbidden of ['basin_capture', 'basin_source_authority']) {
    assert.equal(liveUrl.searchParams.has(forbidden), false, `live settings target invented renderer parameter ${forbidden}`);
  }

  const liveSocket = await connect(liveTarget);
  await liveSocket.call('Page.enable');
  await liveSocket.call('Runtime.enable');
  const startState = await waitForValue(liveSocket, `(() => {
    const state = ${liveDebugExpression};
    if (state?.status !== 'running' || Number(state.frameCount) < 2) return null;
    return state;
  })()`, timeoutMs);
  assertSelectiveCompositionState(startState, 'reopened live target', sourcePresetId);

  failurePhase = 'preset-artifact-verification';
  const presetResponse = await fetch(new URL(`/api/volume-settings-preset?id=${encodeURIComponent(sourcePresetId)}`, url));
  const presetDocument = await presetResponse.json();
  assert.equal(presetResponse.ok, true, 'saved settings preset could not be read back');
  assert.equal(presetDocument.presetId, sourcePresetId);
  assert.equal(presetDocument.preset?.identity, 'kaminos-volume-settings-preset-v2');
  assert.equal(presetDocument.preset?.kind, 'settings-preset');
  assert.equal(presetDocument.preset?.controlCount, 186);
  assert.equal(presetDocument.preset?.rendererControlCount, 3);
  for (const field of ['fluidField', 'frontField', 'boundarySidecar', 'splatInstances', 'historyBuffers', 'pressureState', 'replayState', 'volumeDebugState', 'camera', 'viewport']) {
    assert.equal(Object.hasOwn(presetDocument.preset, field), false, `settings preset persisted forbidden state field ${field}`);
  }
  const savedRoute = new URL(presetDocument.preset.route);
  for (const [key, value] of [...savedRoute.searchParams].filter(([key]) => key.startsWith('volume_'))) {
    assert.deepEqual(liveUrl.searchParams.getAll(key), [value], `effective live route changed saved setting ${key}`);
  }
  const savedVolumeKeys = [...savedRoute.searchParams].filter(([key]) => key.startsWith('volume_')).map(([key]) => key);
  const liveVolumeKeys = [...liveUrl.searchParams]
    .filter(([key]) => key.startsWith('volume_') && !TARGET_ONLY_VOLUME_PARAMS.has(key))
    .map(([key]) => key);
  assert.deepEqual(liveVolumeKeys, savedVolumeKeys, 'effective live route added or omitted volume settings');

  failurePhase = 'continuous-observation';
  await delay(5000);
  const endState = await evaluate(liveSocket, liveDebugExpression);
  assertSelectiveCompositionState(endState, 'reopened live target after observation', sourcePresetId);
  const continuousFrameDelta = Number(endState.frameCount) - Number(startState.frameCount);
  const continuousSimStepDelta = Number(endState.simStepCount) - Number(startState.simStepCount);
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
    effectiveUrl: liveTarget.url,
    sourcePresetId,
    sourcePresetAuthority,
    requestedView,
    expectedComposition,
    writeReceipt: commandResult.effective,
    visualAuthority: 'not-evaluated-settings-persistence-only',
    controlCount: presetDocument.preset.controlCount,
    rendererControlCount: presetDocument.preset.rendererControlCount,
    storePath: commandResult.effective.storePath,
    continuousFrameDelta,
    continuousSimStepDelta,
    cockpitAnchor: cockpitVisibility.anchorId || null,
    cockpitVisibility,
    nonVolumeIsolation,
    responsiveIsolation,
    restoredPlacement,
    cockpitScreenshot: cockpitOut,
    cockpitCollapsedScreenshot: cockpitCollapsedOut,
    cockpitCollapsedState: collapsed,
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
    lastTrustworthyEvidence,
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.close();
  browser?.kill('SIGTERM');
}

async function connect(target) {
  const socket = new CdpSocket(target.webSocketDebuggerUrl);
  await socket.open();
  sockets.push(socket);
  return socket;
}

async function evaluate(socket, expression) {
  const result = await socket.call('Runtime.evaluate', { expression, returnByValue: true });
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
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
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

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  return String(value);
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
