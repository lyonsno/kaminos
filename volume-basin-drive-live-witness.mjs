#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.basin-drive-live-witness.v0';
const args = parseArgs(process.argv.slice(2));
let requestedUrl = String(args.get('--url') || '');
let expectedRepoRoot = String(args.get('--expected-repo-root') || '');
let expectedCommit = String(args.get('--expected-commit') || '');
let expectedSessionStore = String(args.get('--expected-session-store') || '');
const reportPath = resolve(String(args.get('--report') || `/private/tmp/kaminos-basin-drive-live-invalid-${process.pid}/report.json`));
const screenshotPath = resolve(String(args.get('--screenshot') || `/private/tmp/kaminos-basin-drive-live-invalid-${process.pid}/replayed.png`));
let timeoutMs = Number(args.get('--timeout-ms'));
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const sessionLabel = String(args.get('--session-label') || 'Handy Basin Atlas live exercise').trim();
const browserProfilePath = `/private/tmp/kaminos-basin-drive-live-${process.pid}-${Date.now()}`;
let witnessDeadlineAt = Number.POSITIVE_INFINITY;

let browser = null;
let cdp = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {
  requestedUrl,
  expectedRepoRoot,
  expectedCommit,
  expectedSessionStore,
};

async function main() {
try {
  requiredArgument('--url');
  requiredArgument('--expected-repo-root');
  requiredArgument('--expected-commit');
  requiredArgument('--expected-session-store');
  requiredArgument('--report');
  requiredArgument('--screenshot');
  requiredArgument('--timeout-ms');
  expectedRepoRoot = resolve(expectedRepoRoot);
  expectedSessionStore = resolve(expectedSessionStore);
  assert.ok(existsSync(expectedRepoRoot), `expected repo root does not exist: ${expectedRepoRoot}`);
  assert.match(expectedCommit, /^[0-9a-f]{40}$/, '--expected-commit requires an exact lowercase Git commit');
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, '--timeout-ms must be a positive caller deadline');
  assert.ok(sessionLabel, '--session-label must not be empty');
  assert.notEqual(reportPath, screenshotPath, 'report and screenshot paths must be distinct');
  const route = new URL(requestedUrl);
  assert.equal(route.pathname, '/', 'Basin Atlas live witness requires the ordinary Kaminos cockpit route');
  assert.equal(route.searchParams.get('kaminos_volume_smoke'), '1', 'ordinary cockpit route must enable the live Volume runtime');
  mkdirSync(dirname(reportPath), { recursive: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  witnessDeadlineAt = Date.now() + timeoutMs;
  lastTrustworthyEvidence = { requestedUrl, expectedRepoRoot, expectedCommit, expectedSessionStore };

  failurePhase = 'runtime-config';
  const runtimeConfig = await fetchJson(new URL('/api/runtime-config', requestedUrl));
  const controlSchemaText = await fetchText(new URL('/volume-settings-preset-schema-v2.json', requestedUrl));
  const controlSchema = JSON.parse(controlSchemaText);
  const controlSchemaSha256 = createHash('sha256').update(controlSchemaText).digest('hex');
  assert.equal(resolve(runtimeConfig.source?.repoRoot || ''), expectedRepoRoot, 'server repo root was substituted');
  assert.equal(runtimeConfig.source?.commit, expectedCommit, 'server source commit was substituted');
  assert.equal(runtimeConfig.source?.dirty, false, 'server source is dirty');
  assert.equal(resolve(runtimeConfig.volumeBasinSessionStore || ''), expectedSessionStore, 'server session store was substituted');
  lastTrustworthyEvidence.runtimeConfig = runtimeConfig;
  lastTrustworthyEvidence.controlSchema = {
    identity: controlSchema.identity,
    sha256: controlSchemaSha256,
    basinControlCount: controlSchema.controls?.length,
    rendererControlCount: controlSchema.rendererControls?.length,
    presentationControlCount: controlSchema.presentationControls?.length,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfilePath}`,
    '--window-size=1800,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await Promise.race([
    waitForTarget(debugPort, timeoutMs),
    new Promise((_, rejectSpawn) => browser.once('error', rejectSpawn)),
  ]);
  cdp = new CdpSocket(target.webSocketDebuggerUrl, witnessDeadlineAt);
  await cdp.open();
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Log.enable');
  await cdp.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'live-cockpit-admission';
  const admitted = await waitForValue(cdp, `(() => {
    const state = window.__kaminosVolumePrototype?.debugState?.() || null;
    const drive = window.__kaminosVolumeBasinDriveDebugState?.() || null;
    const record = document.getElementById('basin-drive-record');
    const rect = record?.getBoundingClientRect();
    if (!state?.active || state.error || Number(state.frameCount) < 2 || !drive || !record || record.disabled) return null;
    return {
      effectiveRoute: location.href,
      hasNestedBasin: Boolean(document.querySelector('#basin')),
      backend: state.backend,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      drive,
      recordVisible: rect.width > 0 && rect.height > 0,
      layoutReceipt: window.__kaminosVolumeCockpitLayoutReceipt || null,
    };
  })()`, timeoutMs);
  assert.equal(admitted.effectiveRoute, new URL(requestedUrl).href, 'ordinary cockpit route was substituted');
  assert.equal(admitted.hasNestedBasin, false, 'ordinary cockpit witness admitted an assay wrapper');
  assert.match(String(admitted.backend || ''), /^WebGPU:/, 'live cockpit did not admit WebGPU');
  assert.equal(admitted.recordVisible, true, 'Record command is not visible');
  assert.equal(admitted.drive.recording, false, 'recorder began in a non-idle state');
  assert.equal(admitted.layoutReceipt?.identity, 'kaminos-volume-cockpit-layout-receipt-v0', 'ordinary cockpit layout receipt is missing');
  assert.equal(admitted.layoutReceipt?.fallbackApplied, false, 'ordinary cockpit layout silently fell back');
  lastTrustworthyEvidence.admitted = admitted;

  failurePhase = 'record-command';
  await evaluate(cdp, `(() => {
    const label = document.getElementById('basin-drive-session-label');
    if (!label) throw new Error('Record label is unavailable');
    label.value = ${JSON.stringify(sessionLabel)};
    return label.value;
  })()`);
  await clickVisibleCommand(cdp, 'basin-drive-record', 'Record');
  const recording = await waitForDriveState(cdp, timeoutMs, state => state?.recording === true);
  assert.equal(recording.recording, true, 'Record command did not start a session');
  assert.equal(recording.pendingPersistence, false, 'new recording inherited pending persistence');
  lastTrustworthyEvidence.recording = recording;

  failurePhase = 'first-control-motion';
  const firstMotion = await mutateRangeControl(cdp, 'volume-exposure', 1);
  const firstRecorded = await waitForDriveState(cdp, timeoutMs, state => Number(state?.eventCount) === 1);
  assert.notEqual(firstMotion.before, firstMotion.effective, 'first control motion did not change its effective value');
  lastTrustworthyEvidence.firstMotion = firstMotion;
  lastTrustworthyEvidence.firstRecorded = firstRecorded;

  failurePhase = 'mark-command';
  const markLabel = 'first authored bend';
  await evaluate(cdp, `(() => {
    const label = document.getElementById('basin-drive-mark-label');
    if (!label) throw new Error('Mark label is unavailable');
    label.value = ${JSON.stringify(markLabel)};
    return label.value;
  })()`);
  await clickVisibleCommand(cdp, 'basin-drive-mark', 'Mark');
  const marked = await waitForDriveState(cdp, timeoutMs, state => Number(state?.eventCount) === 2);
  lastTrustworthyEvidence.marked = marked;

  failurePhase = 'second-control-motion';
  const secondMotion = await mutateRangeControl(cdp, 'volume-density', -1);
  const secondRecorded = await waitForDriveState(cdp, timeoutMs, state => Number(state?.eventCount) === 3);
  assert.notEqual(secondMotion.before, secondMotion.effective, 'second control motion did not change its effective value');
  lastTrustworthyEvidence.secondMotion = secondMotion;
  lastTrustworthyEvidence.secondRecorded = secondRecorded;

  failurePhase = 'stop-save-command';
  await clickVisibleCommand(cdp, 'basin-drive-stop', 'Stop/Save');
  const saved = await waitForValue(cdp, `(() => {
    const state = window.__kaminosVolumeBasinDriveDebugState?.() || null;
    const status = document.getElementById('basin-drive-state')?.textContent || '';
    if (/FAILED/.test(status)) return { failed: true, status, state };
    if (!state?.artifactId || state.saving || state.pendingPersistence) return null;
    return { failed: false, status, state };
  })()`, timeoutMs);
  assert.equal(saved.failed, false, saved.status || 'Stop/Save failed');
  assert.ok(saved.state.artifactPath, 'Stop/Save omitted the caller-addressed artifact path');
  assert.ok(saved.state.artifactPath.startsWith(`${expectedSessionStore}/`), 'saved artifact escaped the selected session store');
  lastTrustworthyEvidence.saved = saved;

  failurePhase = 'durable-artifact-readback';
  const artifact = await fetchJson(new URL(`/api/volume-basin-drive-session?id=${encodeURIComponent(saved.state.artifactId)}`, requestedUrl));
  assert.equal(artifact.identity, 'kaminos.volume.basin-drive-session-artifact.v0', 'durable readback returned the wrong artifact schema');
  assert.equal(artifact.artifactId, saved.state.artifactId, 'durable readback substituted the artifact identity');
  assert.equal(artifact.artifactPath, saved.state.artifactPath, 'durable readback substituted the artifact path');
  assert.equal(artifact.session?.source?.commit, expectedCommit, 'durable session substituted source identity');
  assert.equal(resolve(artifact.session?.runtime?.effectiveStorePath || ''), expectedSessionStore, 'durable session substituted effective store');
  assert.equal(artifact.session?.controlSchema?.identity, controlSchema.identity, 'durable session substituted the canonical control schema identity');
  assert.equal(artifact.session?.controlSchema?.sha256, controlSchemaSha256, 'durable session substituted the canonical control schema bytes');
  assert.equal(artifact.session?.controlSchema?.basinControlCount, controlSchema.controls?.length, 'durable session did not bind the effective basin inventory');
  assert.equal(artifact.session?.controlSchema?.rendererControlCount, controlSchema.rendererControls?.length, 'durable session did not bind the effective renderer inventory');
  assert.equal(artifact.session?.controlSchema?.presentationControlCount, controlSchema.presentationControls?.length, 'durable session did not bind the effective presentation inventory');
  assert.equal(artifact.session?.eventCount, 3, 'durable session changed the authored event count');
  assert.equal(artifact.session?.controlEventCount, 2, 'durable session changed the authored control count');
  assert.equal(artifact.session?.markCount, 1, 'durable session omitted the named mark');
  assert.deepEqual(
    artifact.session?.events?.map(event => event.kind === 'control'
      ? [event.kind, event.controlId, event.requested, event.effective, event.gesture?.targeted, event.gesture?.trusted, event.gesture?.commandDriven]
      : [event.kind, event.label]),
    [
      ['control', 'volume-exposure', firstMotion.effective, firstMotion.effective, true, true, false],
      ['mark', markLabel],
      ['control', 'volume-density', secondMotion.effective, secondMotion.effective, true, true, false],
    ],
    'durable session changed the authored semantic event stream',
  );
  assert.ok(existsSync(artifact.artifactPath), 'durable artifact path does not exist');
  const onDisk = JSON.parse(readFileSync(artifact.artifactPath, 'utf8'));
  assert.equal(onDisk.artifactId, artifact.artifactId, 'on-disk artifact identity does not match API readback');
  lastTrustworthyEvidence.artifact = {
    artifactId: artifact.artifactId,
    artifactPath: artifact.artifactPath,
    contentHash: artifact.contentHash,
    sessionId: artifact.session.sessionId,
    eventCount: artifact.session.eventCount,
    controlEventCount: artifact.session.controlEventCount,
    markCount: artifact.session.markCount,
    sourceCommit: artifact.session.source.commit,
    schemaSha256: artifact.session.controlSchema.sha256,
  };

  failurePhase = 'post-save-perturbation';
  const perturbation = await mutateRangeControl(cdp, 'volume-exposure', 1);
  const recordedFinalExposure = artifact.session.finalState.basin['volume-exposure'];
  assert.notDeepEqual(perturbation.effective, recordedFinalExposure, 'post-save perturbation did not leave the recorded final state');
  lastTrustworthyEvidence.perturbation = perturbation;

  failurePhase = 'replay-command';
  await clickVisibleCommand(cdp, 'basin-drive-replay', 'Replay');
  const replayed = await waitForValue(cdp, `(() => {
    const state = window.__kaminosVolumeBasinDriveDebugState?.() || null;
    const status = document.getElementById('basin-drive-state')?.textContent || '';
    if (/FAILED/.test(status)) return { failed: true, status, state };
    if (state?.replaying || !status.startsWith('replayed ')) return null;
    return {
      failed: false,
      status,
      state,
      exposure: Number(document.getElementById('volume-exposure')?.value),
      density: Number(document.getElementById('volume-density')?.value),
      runtime: window.__kaminosVolumePrototype?.debugState?.() || null,
    };
  })()`, timeoutMs);
  assert.equal(replayed.failed, false, replayed.status || 'Replay failed');
  assert.equal(replayed.state.artifactId, artifact.artifactId, 'Replay changed the mounted artifact identity');
  assert.equal(replayed.exposure, Number(recordedFinalExposure), 'Replay did not restore final exposure');
  assert.equal(replayed.density, Number(artifact.session.finalState.basin['volume-density']), 'Replay did not restore final density');
  assert.ok(Number(replayed.runtime?.frameCount) > Number(admitted.frameCount), 'live renderer did not advance through the exercise');
  assert.ok(Number(replayed.runtime?.simStepCount) > Number(admitted.simStepCount), 'live simulator did not advance through the exercise');
  lastTrustworthyEvidence.replayed = replayed;

  failurePhase = 'visual-capture';
  const visualContact = await evaluate(cdp, `(() => {
    const command = document.getElementById('basin-drive-replay');
    command?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = command?.getBoundingClientRect();
    return {
      status: document.getElementById('basin-drive-state')?.textContent || null,
      replayVisible: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
      hitTarget: rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest?.('#basin-drive-replay')?.id || null : null,
    };
  })()`);
  assert.equal(visualContact.replayVisible, true, 'Replay command is outside the captured viewport');
  assert.equal(visualContact.hitTarget, 'basin-drive-replay', 'Replay command is not hit-testable in the captured viewport');
  await delay(300);
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.length > 1000, 'post-replay screenshot was missing or partial');
  writeFileSync(screenshotPath, screenshotBytes);

  failurePhase = 'browser-event-audit';
  const browserAudit = auditBrowserEvents(cdp.browserEvents);
  const report = {
    identity: SCHEMA,
    status: 'passed',
    failurePhase: null,
    requested: {
      route: requestedUrl,
      repoRoot: expectedRepoRoot,
      commit: expectedCommit,
      sessionStore: expectedSessionStore,
      timeoutMs,
    },
    effective: {
      route: admitted.effectiveRoute,
      backend: admitted.backend,
      repoRoot: resolve(runtimeConfig.source.repoRoot),
      commit: runtimeConfig.source.commit,
      sessionStore: resolve(runtimeConfig.volumeBasinSessionStore),
      artifactId: artifact.artifactId,
      artifactPath: artifact.artifactPath,
      contentHash: artifact.contentHash,
      sessionId: artifact.session.sessionId,
      sessionSchema: artifact.session.schema,
      controlSchemaIdentity: artifact.session.controlSchema.identity,
      controlSchemaSha256: artifact.session.controlSchema.sha256,
      eventCount: artifact.session.eventCount,
      controlEventCount: artifact.session.controlEventCount,
      markCount: artifact.session.markCount,
    },
    exercise: {
      initialFrameCount: admitted.frameCount,
      finalFrameCount: replayed.runtime.frameCount,
      initialSimStepCount: admitted.simStepCount,
      finalSimStepCount: replayed.runtime.simStepCount,
      firstMotion,
      markLabel,
      secondMotion,
      perturbation,
      replayStatus: replayed.status,
      replayRestoredExposure: replayed.exposure,
      replayRestoredDensity: replayed.density,
    },
    browserAudit,
    screenshot: screenshotPath,
    screenshotBytes: screenshotBytes.length,
  };
  writeReport(report);
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: screenshotPath, artifactPath: artifact.artifactPath }, null, 2));
} catch (error) {
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeReport({
      identity: SCHEMA,
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    });
  } catch (reportError) {
    console.error(`Basin drive witness could not write its failure report: ${reportError?.message || reportError}`);
  }
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  await terminateBrowser(browser);
  rmSync(browserProfilePath, { recursive: true, force: true });
}
}

class CdpSocket {
  constructor(url, deadlineAt) {
    this.url = url;
    this.deadlineAt = deadlineAt;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.url);
      const timer = setTimeout(() => rejectOpen(new Error('CDP socket open timed out at caller deadline')), this.remainingMs());
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolveOpen(); }, { once: true });
      this.socket.addEventListener('error', error => { clearTimeout(timer); rejectOpen(error); }, { once: true });
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
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out at caller deadline: ${method}`));
      }, this.remainingMs());
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

  remainingMs() {
    return Math.max(1, this.deadlineAt - Date.now());
  }
}

async function clickVisibleCommand(socket, id, name) {
  const target = await evaluate(socket, `(() => {
    const command = document.getElementById(${JSON.stringify(id)});
    command?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = command?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : null;
    const y = rect ? rect.top + rect.height / 2 : null;
    const hit = x === null ? null : document.elementFromPoint(x, y);
    if (!command || command.disabled || !rect || rect.width <= 0 || rect.height <= 0
      || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
      || !(hit === command || command.contains(hit))) {
      throw new Error(${JSON.stringify(`${name} command is unavailable`)});
    }
    return { id: command.id, text: command.textContent.trim(), x, y, width: rect.width, height: rect.height };
  })()`);
  await socket.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await socket.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  return target;
}

async function mutateRangeControl(socket, controlId, direction) {
  const prepared = await evaluate(socket, `(() => {
    const input = document.getElementById(${JSON.stringify(controlId)});
    if (!input || input.type !== 'range') throw new Error('range control is unavailable: ${controlId}');
    input.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = input.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight
      || !(hit === input || input.contains(hit))) throw new Error('range control is not hit-testable: ${controlId}');
    const before = Number(input.value);
    const min = Number(input.min);
    const max = Number(input.max);
    const requestedDirection = ${Number(direction)} > 0 ? 1 : -1;
    const effectiveDirection = (requestedDirection > 0 && before >= max) || (requestedDirection < 0 && before <= min)
      ? -requestedDirection
      : requestedDirection;
    input.focus();
    return { controlId: input.id, before, key: effectiveDirection > 0 ? 'ArrowRight' : 'ArrowLeft', width: rect.width, height: rect.height };
  })()`);
  const keyCode = prepared.key === 'ArrowRight' ? 39 : 37;
  await socket.call('Input.dispatchKeyEvent', { type: 'keyDown', key: prepared.key, code: prepared.key, windowsVirtualKeyCode: keyCode });
  await socket.call('Input.dispatchKeyEvent', { type: 'keyUp', key: prepared.key, code: prepared.key, windowsVirtualKeyCode: keyCode });
  const effective = await waitForValue(socket, `(() => {
    const value = Number(document.getElementById(${JSON.stringify(controlId)})?.value);
    return value !== ${JSON.stringify(prepared.before)} ? value : null;
  })()`, timeoutMs);
  return { ...prepared, requested: effective, effective, eventAuthority: 'trusted-cdp-keyboard-input' };
}

async function waitForDriveState(socket, callerTimeoutMs, predicate) {
  const state = await waitForValue(socket, `(() => {
    const state = window.__kaminosVolumeBasinDriveDebugState?.() || null;
    const status = document.getElementById('basin-drive-state')?.textContent || '';
    if (/FAILED/.test(status)) return { failure: status, ...state };
    return state;
  })()`, callerTimeoutMs, value => value?.failure || predicate(value));
  if (state?.failure) throw new Error(state.failure);
  return state;
}

async function evaluate(socket, expression) {
  const result = await socket.call('Runtime.evaluate', {
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

async function waitForValue(socket, expression, callerTimeoutMs, predicate = value => value !== null && value !== undefined) {
  const deadline = Math.min(Date.now() + callerTimeoutMs, witnessDeadlineAt);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(socket, expression);
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`browser state did not settle before caller deadline: ${lastError?.message || 'no matching state'}`);
}

async function waitForTarget(port, callerTimeoutMs) {
  const deadline = Math.min(Date.now() + callerTimeoutMs, witnessDeadlineAt);
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
  throw new Error(`Chrome CDP target did not appear before caller deadline: ${lastError?.message || 'timeout'}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(remainingWitnessMs()) });
  const document = await response.json();
  if (!response.ok) throw new Error(document.error || `request failed: ${response.status} ${url}`);
  return document;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(remainingWitnessMs()) });
  const document = await response.text();
  if (!response.ok) throw new Error(`request failed: ${response.status} ${url}`);
  return document;
}

function auditBrowserEvents(events) {
  const failures = events.filter(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    || (event.method === 'Runtime.consoleAPICalled' && event.params?.type === 'error')
  ));
  if (failures.length) throw new Error(`browser event audit failed: ${JSON.stringify(failures)}`);
  return { status: 'clean', observedEventCount: events.length, rejectedEventCount: 0 };
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Chrome executable not found');
  return executable;
}

function requiredArgument(name) {
  const value = args.get(name);
  if (value === undefined || value === true || String(value).trim() === '') throw new Error(`missing ${name}`);
  return String(value);
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const key = tokens[index];
    if (!key.startsWith('--')) continue;
    const next = tokens[index + 1];
    if (!next || next.startsWith('--')) parsed.set(key, true);
    else {
      parsed.set(key, next);
      index += 1;
    }
  }
  return parsed;
}

function writeReport(report) {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function remainingWitnessMs() {
  return Math.max(1, witnessDeadlineAt - Date.now());
}

async function terminateBrowser(process) {
  if (!process || process.exitCode !== null) return;
  const exited = new Promise(resolveExit => process.once('exit', resolveExit));
  process.kill('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (process.exitCode === null) {
    process.kill('SIGKILL');
    await exited;
  }
}

await main();
