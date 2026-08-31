#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';


const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const url = String(args.get('--url') || '');
const expectedRepoRoot = resolve(String(args.get('--expected-repo-root') || '.'));
const expectedCommit = String(args.get('--expected-commit') || '');
const expectedLayoutStore = resolve(String(args.get('--expected-layout-store') || '.'));
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-volume-cockpit-layout-witness.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-volume-cockpit-layout-witness.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const profilePath = resolve(String(args.get('--profile') || `/tmp/kaminos-layout-witness-chrome-${debugPort}`));

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};

class TerminalWitnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TerminalWitnessError';
  }
}

function chromeExecutable() {
  for (const candidate of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('Chrome executable was not found');
}

async function waitUntil(callback, message, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await callback();
      if (result) return result;
    } catch (error) {
      if (error instanceof TerminalWitnessError) throw error;
      lastError = error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, intervalMs));
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

class CdpSocket {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.webSocketUrl);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed to open')), { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP WebSocket closed')));
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
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
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

async function evaluate(expression) {
  const result = await socket.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function operatorExpression(body) {
  return `(() => {
    const frame = document.querySelector('#basin');
    const operatorWindow = frame?.contentWindow || window;
    const operatorDocument = operatorWindow.document;
    return (${body});
  })()`;
}

async function operatorValue(body) {
  return evaluate(operatorExpression(body));
}

async function pagePoint(selector, { scroll = true } = {}) {
  return operatorValue(`(() => {
    const element = operatorDocument.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('witness target missing: ' + ${JSON.stringify(selector)});
    if (${scroll}) element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    const frame = document.querySelector('#basin');
    const frameRect = frame?.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 + (frameRect?.left || 0),
      y: rect.top + rect.height / 2 + (frameRect?.top || 0),
      width: rect.width,
      height: rect.height,
    };
  })()`);
}

async function trustedClick(selector) {
  const point = await pagePoint(selector);
  await socket.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function trustedDrag(fromSelector, toSelector) {
  await pagePoint(toSelector);
  const from = await pagePoint(fromSelector, { scroll: false });
  const to = await pagePoint(toSelector, { scroll: false });
  await socket.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, button: 'left', buttons: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function cockpitState() {
  return operatorValue(`(() => {
    const editor = operatorWindow.__kaminosVolumeCockpitLayoutEditor;
    const receipt = operatorWindow.__kaminosVolumeCockpitLayoutReceipt;
    const renderer = operatorWindow.__kaminosVolumePrototype?.debugState?.() || null;
    const controls = Object.fromEntries([...operatorDocument.querySelectorAll(
      'input[id^="volume-"], select[id^="volume-"], textarea[id^="volume-"], select[data-volume-assay-control="emitter-family"]'
    )].filter(control => !control.closest('[data-volume-cockpit-layout-ui]'))
      .map(control => [control.id, control.type === 'checkbox' ? control.checked : control.value]));
    const groups = [...operatorDocument.querySelectorAll('.volume-layout-group-shell')].map(shell => ({
      id: shell.dataset.volumeLayoutGroupId,
      surface: shell.dataset.volumeLayoutSurface,
      label: shell.querySelector('.volume-layout-group-label')?.value || '',
      labelReadOnly: shell.querySelector('.volume-layout-group-label')?.readOnly ?? null,
      labelTabIndex: shell.querySelector('.volume-layout-group-label')?.tabIndex ?? null,
      controls: [...shell.querySelectorAll('.slider-row[data-volume-cockpit-control-id]')]
        .map(row => row.dataset.volumeCockpitControlId),
    }));
    return {
      wrapperHref: window.location.href,
      framePresent: Boolean(frame),
      frameSrc: frame?.getAttribute('src') || '',
      frameHref: operatorWindow.location?.href || '',
      frameReadyState: operatorDocument.readyState,
      receipt,
      renderer,
      editing: editor?.editing ?? null,
      layout: editor?.layout || null,
      controls,
      groups,
      status: operatorDocument.querySelector('#volume-cockpit-layout-status')?.textContent || '',
      layoutEditDisabled: operatorDocument.querySelector('#volume-cockpit-layout-edit')?.disabled ?? null,
    };
  })()`);
}

async function setFieldAndChange(selector, value) {
  return operatorValue(`(() => {
    const field = operatorDocument.querySelector(${JSON.stringify(selector)});
    if (!field) throw new Error('field missing: ' + ${JSON.stringify(selector)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new operatorWindow.Event('change', { bubbles: true }));
    return field.value;
  })()`);
}

try {
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  if (!url) throw new Error('missing --url');
  if (!existsSync(expectedRepoRoot)) throw new Error('expected repo root does not exist');
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error('expected commit must be a full lowercase SHA');
  if (!expectedLayoutStore || expectedLayoutStore === '/') throw new Error('missing safe expected layout store');

  failurePhase = 'http-source-preflight';
  const runtimeResponse = await fetch(new URL('/api/runtime-config', url));
  const runtimeConfig = await runtimeResponse.json();
  assert.equal(runtimeResponse.ok, true, 'runtime config request failed');
  assert.equal(resolve(runtimeConfig.source?.repoRoot || ''), expectedRepoRoot, 'effective server repo root mismatch');
  assert.equal(runtimeConfig.source?.commit, expectedCommit, 'effective server commit mismatch');
  assert.equal(resolve(runtimeConfig.volumeCockpitLayoutStore || ''), expectedLayoutStore, 'effective layout store mismatch');

  failurePhase = 'browser-launch';
  rmSync(profilePath, { recursive: true, force: true });
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    '--window-size=1720,1080',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const page = await waitUntil(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
    const pages = await response.json();
    return pages.find(candidate => candidate.type === 'page' && candidate.url.startsWith(url.split('?')[0]));
  }, 'Chrome page did not register');
  socket = new CdpSocket(page.webSocketDebuggerUrl);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');

  failurePhase = 'initial-layout-admission';
  const initialLayout = await waitUntil(async () => {
    const state = await cockpitState();
    lastTrustworthyEvidence.admissionProbe = state;
    const browserFailure = firstBrowserFailure(socket.browserEvents);
    if (browserFailure) throw new TerminalWitnessError(`browser initialization failed: ${JSON.stringify(browserFailure)}`);
    if (state.receipt?.status === 'failed') {
      throw new TerminalWitnessError(`layout receipt failed at ${state.receipt.phase || 'unknown'}: ${state.receipt.reason}`);
    }
    if (state.receipt?.layoutIdentity !== 'kaminos.volume.cockpit-layout.v1') return null;
    if (!/saved|loaded/.test(state.status)) return null;
    return state;
  }, 'layout editor did not admit');
  assert.equal(initialLayout.receipt.fallbackApplied, false, 'layout receipt reported fallback');
  assert.equal(resolve(initialLayout.receipt.layoutStorePath || ''), expectedLayoutStore, 'browser layout store mismatch');
  lastTrustworthyEvidence.initialLayout = initialLayout;

  failurePhase = 'initial-renderer-admission';
  const initial = await waitUntil(async () => {
    const state = await cockpitState();
    if (state.receipt?.status === 'failed') throw new TerminalWitnessError(`layout receipt failed after admission: ${state.receipt.reason}`);
    if (!/^WebGPU:/.test(String(state.renderer?.backend || ''))) return null;
    return state;
  }, 'WebGPU renderer did not admit after layout initialization');
  assert.ok(Object.keys(initial.controls).length > 150, 'canonical control snapshot is unexpectedly small');
  assert.ok(initial.groups.length > 1, 'source layout did not produce authorable groups');
  lastTrustworthyEvidence.initial = initial;

  failurePhase = 'non-edit-mode-rename-isolation';
  const lockedGroup = initial.groups[0];
  assert.equal(lockedGroup.labelReadOnly, true, 'group name is not read-only outside edit mode');
  assert.equal(lockedGroup.labelTabIndex, -1, 'group name remains in the tab order outside edit mode');
  await setFieldAndChange(
    `[data-volume-layout-group-id="${lockedGroup.id}"] .volume-layout-group-label`,
    'Forbidden outside edit mode',
  );
  const lockedAfterChange = await cockpitState();
  assert.deepEqual(lockedAfterChange.layout, initial.layout, 'synthetic group rename mutated layout outside edit mode');
  assert.equal(
    lockedAfterChange.groups.find(group => group.id === lockedGroup.id)?.label,
    lockedGroup.label,
    'group label did not restore after a forbidden outside-edit change',
  );

  failurePhase = 'named-layout-authoring';
  const initialLayoutId = initial.layout.layoutId;
  await trustedClick('#volume-cockpit-layout-new');
  const customLayout = await waitUntil(async () => {
    const state = await cockpitState();
    return state.layout?.layoutId !== initialLayoutId && state.editing && /saved/.test(state.status) ? state : null;
  }, 'new named layout was not created');
  const unlockedGroup = customLayout.groups.find(group => group.id === lockedGroup.id);
  assert.equal(unlockedGroup?.labelReadOnly, false, 'edit mode did not unlock the group name');
  assert.equal(unlockedGroup?.labelTabIndex, 0, 'edit mode did not restore keyboard access to the group name');
  await setFieldAndChange(
    `[data-volume-layout-group-id="${lockedGroup.id}"] .volume-layout-group-label`,
    'Operator Group Witness',
  );
  await waitUntil(async () => {
    const state = await cockpitState();
    const group = state.layout?.groups?.find(candidate => candidate.id === lockedGroup.id);
    return group?.label === 'Operator Group Witness' && /saved/.test(state.status) ? state : null;
  }, 'edit-mode group rename did not autosave');
  await setFieldAndChange('#volume-cockpit-layout-name', 'Operator Layout Witness');
  const renamed = await waitUntil(async () => {
    const state = await cockpitState();
    return state.layout?.label === 'Operator Layout Witness' && /saved/.test(state.status) ? state : null;
  }, 'named layout rename was not saved');

  const sourceGroup = renamed.groups.find(group => group.controls.length > 0);
  const targetGroup = renamed.groups.find(group => group.id !== sourceGroup?.id && group.controls.length > 0);
  assert.ok(sourceGroup && targetGroup, 'witness could not find two populated groups');
  const movedControlId = sourceGroup.controls.at(-1);
  const initialTargetControlId = targetGroup.controls[0];
  await trustedDrag(
    `[data-volume-cockpit-control-id="${movedControlId}"] > .volume-layout-control-grip`,
    `[data-volume-cockpit-control-id="${initialTargetControlId}"]`,
  );
  const dragged = await waitUntil(async () => {
    const state = await cockpitState();
    const effectiveGroup = state.groups.find(group => group.controls.includes(movedControlId));
    return effectiveGroup?.id === targetGroup.id && /saved/.test(state.status) ? state : null;
  }, 'trusted pointer drag did not move and save the original control node');
  assert.deepEqual(dragged.controls, initial.controls, 'layout edit changed canonical control values');
  lastTrustworthyEvidence.authored = {
    layoutId: customLayout.layout.layoutId,
    movedControlId,
    sourceGroupId: sourceGroup.id,
    targetGroupId: targetGroup.id,
    state: dragged,
  };

  failurePhase = 'named-layout-selection-persistence';
  await setFieldAndChange('#volume-cockpit-layout-select', initialLayoutId);
  const selected = await waitUntil(async () => {
    const state = await cockpitState();
    return state.layout?.layoutId === initialLayoutId && /saved|loaded/.test(state.status) ? state : null;
  }, 'existing named layout did not load');
  const selectedIndexResponse = await fetch(new URL('/api/volume-cockpit-layouts', url));
  const selectedIndex = await selectedIndexResponse.json();
  assert.equal(selectedIndex.activeLayoutId, initialLayoutId, 'selected named layout was not persisted as active');
  assert.deepEqual(selected.controls, initial.controls, 'named-layout selection changed canonical control values');

  failurePhase = 'reload-persistence';
  await socket.call('Page.reload', { ignoreCache: true });
  const reloaded = await waitUntil(async () => {
    const state = await cockpitState();
    if (state.receipt?.status === 'failed') throw new TerminalWitnessError(`reloaded layout receipt failed: ${state.receipt.reason}`);
    if (state.layout?.layoutId !== initialLayoutId || !/saved|loaded/.test(state.status)) return null;
    return state;
  }, 'selected layout did not survive page reload');
  assert.deepEqual(reloaded.controls, initial.controls, 'reload changed canonical control values');
  lastTrustworthyEvidence.reloaded = reloaded;

  failurePhase = 'visual-capture';
  await trustedClick('#volume-cockpit-layout-edit');
  await operatorValue(`(() => {
    operatorDocument.querySelector('#sidebar')?.scrollTo(0, 0);
    return true;
  })()`);
  const screenshot = await socket.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  assert.ok(screenshot.data?.length > 10000, 'cockpit screenshot is blank or partial');
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  failurePhase = 'layout-store-outage-isolation';
  await socket.call('Network.enable');
  await socket.call('Network.setBlockedURLs', { urls: ['*api/volume-cockpit-layouts*'] });
  await socket.call('Page.reload', { ignoreCache: true });
  const outage = await waitUntil(async () => {
    const state = await cockpitState();
    if (state.receipt?.persistenceAvailable !== false) return null;
    if (!/layout persistence unavailable/.test(state.status)) return null;
    if (!/^WebGPU:/.test(String(state.renderer?.backend || ''))) return null;
    return state;
  }, 'layout-store outage did not resolve into a usable degraded cockpit');
  assert.equal(outage.receipt.storedLayoutLoaded, false, 'outage falsely reported a stored layout as loaded');
  assert.equal(outage.receipt.fallbackApplied, true, 'outage did not disclose the source-default fallback');
  assert.equal(outage.layoutEditDisabled, true, 'layout editing remained enabled without persistence');

  const densityBefore = Number(outage.renderer.controls?.density);
  const densityAfter = densityBefore === 3.75 ? 3.5 : 3.75;
  await setFieldAndChange('#volume-density', String(densityAfter));
  const densityApplied = await waitUntil(async () => {
    const state = await cockpitState();
    return Math.abs(Number(state.renderer.controls?.density) - densityAfter) < 1e-6 ? state : null;
  }, 'canonical Volume slider was not wired after layout-store failure');
  const activeBeforeToggle = Boolean(densityApplied.renderer.active);
  await trustedClick('#volume-toggle');
  const toggleApplied = await waitUntil(async () => {
    const state = await cockpitState();
    return Boolean(state.renderer.active) !== activeBeforeToggle ? state : null;
  }, 'Volume toggle was not wired after layout-store failure');
  const authoritativeIndexResponse = await fetch(new URL('/api/volume-cockpit-layouts', url));
  const authoritativeIndex = await authoritativeIndexResponse.json();
  assert.equal(authoritativeIndex.activeLayoutId, initialLayoutId, 'degraded browser mutated the authoritative active layout');
  lastTrustworthyEvidence.outage = {
    receipt: outage.receipt,
    status: outage.status,
    densityBefore,
    densityAfter,
    activeBeforeToggle,
    activeAfterToggle: toggleApplied.renderer.active,
    authoritativeActiveLayoutId: authoritativeIndex.activeLayoutId,
  };

  failurePhase = 'browser-event-audit';
  const browserEventAudit = auditBrowserEvents(socket.browserEvents);
  const report = {
    identity: 'kaminos.volume.cockpit-layout-live-witness.v1',
    browserEventAudit,
    ok: true,
    requested: {
      url,
      repoRoot: expectedRepoRoot,
      commit: expectedCommit,
      layoutStore: expectedLayoutStore,
    },
    effective: {
      runtimeConfig,
      backend: reloaded.renderer.backend,
      layoutReceipt: reloaded.receipt,
      activeLayoutId: selectedIndex.activeLayoutId,
      canonicalControlCount: Object.keys(reloaded.controls).length,
      screenshotPath,
      storeOutageIsolation: lastTrustworthyEvidence.outage,
    },
    gesture: lastTrustworthyEvidence.authored,
    browserEvents: browserEventAudit.events,
    fallbackApplied: false,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    identity: 'kaminos.volume.cockpit-layout-live-witness-failure.v1',
    ok: false,
    failurePhase,
    error: error?.stack || String(error),
    requested: { url, repoRoot: expectedRepoRoot, commit: expectedCommit, layoutStore: expectedLayoutStore },
    lastTrustworthyEvidence,
    browserEvents: (socket?.browserEvents || []).map(summarizeBrowserEvent),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(failure, null, 2) + '\n');
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
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

function firstBrowserFailure(events) {
  return events.map(summarizeBrowserEvent).find(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.type === 'error')
  )) || null;
}

function auditBrowserEvents(events) {
  const observed = events.map(summarizeBrowserEvent);
  const allowed = observed.filter(event => (
    event.method === 'Log.entryAdded'
    && event.level === 'error'
    && String(event.url || '').includes('/api/volume-cockpit-layouts')
    && String(event.text || '').includes('ERR_BLOCKED_BY_CLIENT')
  ));
  const rejected = observed.filter(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.type === 'error')
  ) && !allowed.includes(event));
  if (rejected.length > 0) {
    throw new TerminalWitnessError(`browser event audit failed: ${JSON.stringify(rejected)}`);
  }
  return {
    observedEventCount: observed.length,
    allowedExpectedFailureCount: allowed.length,
    rejectedFailureCount: rejected.length,
    allowed,
    events: observed,
  };
}
