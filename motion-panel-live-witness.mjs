#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const args = new Map();
const BOOLEAN_ARGS = new Set(['--export-current-view', '--export-selected-cliplet', '--focus-phrase-preview', '--focus-take-shelf', '--promote-take']);
for (let i = 2; i < process.argv.length;) {
  const key = process.argv[i];
  if (!String(key || '').startsWith('--')) throw new Error(`Unexpected positional argument: ${key}`);
  if (BOOLEAN_ARGS.has(key)) {
    args.set(key, true);
    i += 1;
    continue;
  }
  const value = process.argv[i + 1];
  if (value == null || String(value).startsWith('--')) throw new Error(`${key} requires a value`);
  args.set(key, value);
  i += BOOLEAN_ARGS.has(key) ? 1 : 2;
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const url = args.get('--url') || 'http://127.0.0.1:18123/?kaminos_motion_agency=1';
const serverUrl = String(args.get('--server-url') || 'http://127.0.0.1:8098').replace(/\/+$/, '');
const prompt = args.get('--prompt') || 'a little worm squirms vigorously uphill';
const frameTotal = positiveInt(args.get('--frames'), 12, '--frames');
const intervalMs = nonnegativeNumber(args.get('--interval-ms'), 420, '--interval-ms');
const settleMs = nonnegativeNumber(args.get('--settle-ms'), 900, '--settle-ms');
const duration = positiveNumber(args.get('--duration'), 6, '--duration');
const steps = positiveInt(args.get('--steps'), 20, '--steps');
const sourceMode = args.get('--source-mode') || 'sidecar';
const sourceOpacity = positiveNumber(args.get('--source-opacity'), 0.55, '--source-opacity');
const overlaySize = positiveNumber(args.get('--overlay-size'), 3, '--overlay-size');
const sourceUpAxis = args.get('--source-up-axis') || 'auto';
const sourceForwardAxis = args.get('--source-forward-axis') || 'auto';
const takeSource = String(args.get('--take-source') || 'generate');
const durableTakeId = String(args.get('--durable-take-id') || '');
const clipletPlayback = String(args.get('--cliplet-playback') || 'full');
const clipletInterrupt = String(args.get('--cliplet-interrupt') || 'off');
const tileWidth = positiveInt(args.get('--tile-width'), 560, '--tile-width');
const columns = positiveInt(args.get('--columns'), frameTotal, '--columns');
const exportCurrentView = args.has('--export-current-view');
const exportSelectedCliplet = args.has('--export-selected-cliplet');
const focusPhrasePreview = args.has('--focus-phrase-preview');
const focusTakeShelf = args.has('--focus-take-shelf');
const promoteTake = args.has('--promote-take');
const exportReferenceMode = exportReferenceModeFromArgs(args.get('--export-reference-mode'));
const cameraPosition = args.get('--camera-position') || '';
const cameraTarget = args.get('--camera-target') || '';
const hillAffordancePacketPath = args.get('--hill-affordance-packet') || '';
const hillAffordanceDataPath = args.get('--hill-affordance-data') || '';
const port = positiveInt(args.get('--debug-port'), 9670, '--debug-port');
const chrome = process.env.KAMINOS_CHROME || args.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-motion-panel-live-witness-${timestamp}`);
const reportPath = resolve(args.get('--report') || `${outDir}/report.json`);
const filmstripPath = resolve(args.get('--filmstrip') || `${outDir}/filmstrip.png`);
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-panel-live-witness-profile-${port}-${process.pid}`;

let phase = 'initializing';
let stderr = '';
let chromeProcess = null;
let effectiveUrl = null;
let browserVersion = null;
let consoleEvents = [];
let runtimeIdentity = null;

function positiveInt(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function positiveNumber(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function nonnegativeNumber(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a nonnegative number`);
  return parsed;
}

function exportReferenceModeFromArgs(value) {
  if (value == null || value === '') return 'current';
  const mode = String(value);
  if (!['current', 'hidden', 'overlay', 'sidecar'].includes(mode)) {
    throw new Error('--export-reference-mode must be current, hidden, overlay, or sidecar');
  }
  return mode;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.motion-panel-live-witness.v0',
    requestedUrl: url,
    effectiveUrl,
    serverUrl,
    prompt,
    frameTotal,
    intervalMs,
    settleMs,
    duration,
    steps,
    sourceMode,
    sourceOpacity,
    overlaySize,
    sourceUpAxis,
    sourceForwardAxis,
    takeSource,
    durableTakeId,
    clipletPlayback,
    tileWidth,
    columns,
    exportCurrentView,
    exportSelectedCliplet,
    focusPhrasePreview,
    focusTakeShelf,
    promoteTake,
    exportReferenceMode,
    cameraPosition,
    cameraTarget,
    hillAffordancePacketPath,
    hillAffordanceDataPath,
    debugPort: port,
    chrome,
    userDataDir,
    outDir,
    filmstripPath,
    phase,
    browserVersion,
    runtimeIdentity,
    consoleEvents,
    stderrTail: stderr.slice(-3000),
    ...report,
  }, null, 2));
}

function recordConsoleEvent(event) {
  const msg = JSON.parse(String(event.data));
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleEvents.push({
      kind: 'console',
      type: msg.params.type,
      args: (msg.params.args || []).map(arg => arg.value ?? arg.description ?? arg.unserializableValue ?? null),
      stack: (msg.params.stackTrace?.callFrames || []).slice(0, 5).map(frame => ({
        functionName: frame.functionName,
        url: frame.url,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      })),
    });
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleEvents.push({
      kind: 'exception',
      text: msg.params.exceptionDetails?.text || null,
      description: msg.params.exceptionDetails?.exception?.description || null,
      url: msg.params.exceptionDetails?.url || null,
      lineNumber: msg.params.exceptionDetails?.lineNumber ?? null,
      columnNumber: msg.params.exceptionDetails?.columnNumber ?? null,
    });
  } else if (msg.method === 'Log.entryAdded') {
    consoleEvents.push({
      kind: 'log',
      level: msg.params.entry?.level || null,
      text: msg.params.entry?.text || null,
      source: msg.params.entry?.source || null,
      url: msg.params.entry?.url || null,
    });
  }
}

function consoleFailureEvents() {
  return consoleEvents.filter(event => (
    event.kind === 'exception'
    || (event.kind === 'console' && ['error', 'assert'].includes(String(event.type || '').toLowerCase()))
    || (event.kind === 'log' && ['error', 'warning'].includes(String(event.level || '').toLowerCase()))
  ));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(150);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}, options = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, options.timeoutMs || 10000);
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

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evaluate(ws, expression, options = {}) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function closeBrowser(ws) {
  try {
    await wsRequest(ws, 'Browser.close', {}, { timeoutMs: 2000 });
  } catch {
    try { ws.close(); } catch {}
  }
  if (!chromeProcess) return;
  await delay(250);
  if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
    chromeProcess.kill('SIGTERM');
    await delay(250);
  }
  if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) {
    chromeProcess.kill('SIGKILL');
  }
}

function assertPng(buffer, label) {
  assert.ok(buffer.length > 1024, `${label} PNG is too small to be credible visual evidence`);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${label} is not a PNG`);
}

function pngDimensions(buffer) {
  assertPng(buffer, 'PNG dimensions source');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function configureMotionPanel(ws) {
  return evaluate(ws, `(() => {
    const requireEl = id => {
      const el = document.getElementById(id);
      if (!el) throw new Error('missing motion panel control #' + id);
      return el;
    };
    const setSelectValue = (id, value) => {
      const el = requireEl(id);
      const next = String(value);
      if (![...el.options].some(option => option.value === next)) throw new Error('#' + id + ' has no option ' + next);
      el.value = next;
      return el.value;
    };
    requireEl('motion-panel-prompt').value = ${JSON.stringify(prompt)};
    requireEl('motion-panel-server-url').value = ${JSON.stringify(serverUrl)};
    requireEl('motion-panel-source-ghost-mode').value = ${JSON.stringify(sourceMode)};
    setSelectValue('motion-panel-source-up-axis', ${JSON.stringify(sourceUpAxis)});
    setSelectValue('motion-panel-source-forward-axis', ${JSON.stringify(sourceForwardAxis)});
    requireEl('motion-panel-source-opacity').value = ${JSON.stringify(String(sourceOpacity))};
    requireEl('motion-panel-source-overlay-size').value = ${JSON.stringify(String(overlaySize))};
    requireEl('motion-panel-duration').value = ${JSON.stringify(String(duration))};
    requireEl('motion-panel-steps').value = ${JSON.stringify(String(steps))};
    const exportValues = ${JSON.stringify(exportCurrentView)} ? {
      frames: setSelectValue('motion-panel-export-frames', ${JSON.stringify(String(frameTotal))}),
      columns: setSelectValue('motion-panel-export-columns', ${JSON.stringify(String(columns))}),
      tileWidth: setSelectValue('motion-panel-export-resolution', ${JSON.stringify(String(tileWidth))}),
      referenceMode: setSelectValue('motion-panel-export-reference', ${JSON.stringify(exportReferenceMode)}),
    } : null;
    for (const id of ['motion-panel-source-ghost-mode', 'motion-panel-source-up-axis', 'motion-panel-source-forward-axis', 'motion-panel-source-opacity', 'motion-panel-source-overlay-size', 'motion-panel-duration', 'motion-panel-steps', 'motion-panel-export-reference']) {
      document.getElementById(id)?.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById(id)?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return {
      prompt: requireEl('motion-panel-prompt').value,
      serverUrl: requireEl('motion-panel-server-url').value,
      sourceMode: requireEl('motion-panel-source-ghost-mode').value,
      sourceUpAxis: requireEl('motion-panel-source-up-axis').value,
      sourceForwardAxis: requireEl('motion-panel-source-forward-axis').value,
      sourceOpacity: requireEl('motion-panel-source-opacity').value,
      overlaySize: requireEl('motion-panel-source-overlay-size').value,
      duration: requireEl('motion-panel-duration').value,
      steps: requireEl('motion-panel-steps').value,
      exportValues,
    };
  })()`);
}

async function generateMotion(ws) {
  return evaluate(ws, `window.generateMotion().then(result => ({
    ok: true,
    clipId: result?.clip?.id || null,
    label: result?.clip?.label || null,
    frameCount: result?.clip?.temporalSamples?.length || null,
    take: result?.take || null,
    takeShelf: typeof window.kaminosMotionPanelTakeShelfDebugState === 'function'
      ? window.kaminosMotionPanelTakeShelfDebugState()
      : null,
    state: result?.state || null,
  })).catch(error => ({
    ok: false,
    error: String(error?.message || error),
  }))`, { timeoutMs: 240000 });
}

async function loadWitnessMotionSource(ws) {
  if (takeSource === 'generate') {
    const generated = await generateMotion(ws);
    if (!generated?.ok) throw new Error(`window.generateMotion() failed: ${JSON.stringify(generated)}`);
    if (!generated?.takeShelf?.selectedTake) throw new Error(`motion take shelf did not select generated take: ${JSON.stringify(generated?.takeShelf || null)}`);
    return {
      schema: 'kaminos.motion-panel-live-motion-source.v0',
      ok: true,
      takeSource,
      generated,
      selectedTake: generated.takeShelf.selectedTake,
      takeShelf: generated.takeShelf,
    };
  }
  if (takeSource === 'fixture') {
    return evaluate(ws, `(async () => {
      if (typeof window.previewMotionPanelTemporalFixture !== 'function') throw new Error('fixture preview function unavailable');
      const result = await window.previewMotionPanelTemporalFixture();
      const shelf = window.kaminosMotionPanelTakeShelfDebugState?.();
      if (!shelf?.selectedTake) throw new Error('fixture preview did not select a take: ' + JSON.stringify(shelf || null));
      return {
        schema: 'kaminos.motion-panel-live-motion-source.v0',
        ok: true,
        takeSource: 'fixture',
        fixture: result,
        selectedTake: shelf.selectedTake,
        takeShelf: shelf,
      };
    })().catch(error => ({
      schema: 'kaminos.motion-panel-live-motion-source.v0',
      ok: false,
      takeSource: 'fixture',
      error: String(error?.message || error),
    }))`, { timeoutMs: 60000 });
  }
  if (takeSource === 'saved') {
    return evaluate(ws, `(async () => {
      if (typeof window.loadDurableMotionPanelTakes !== 'function') throw new Error('load durable takes function unavailable');
      if (typeof window.previewDurableMotionPanelTake !== 'function') throw new Error('preview durable take function unavailable');
      const listed = await window.loadDurableMotionPanelTakes({ silent: true });
      const requestedId = ${JSON.stringify(durableTakeId)};
      const takeId = requestedId || listed?.takes?.[0]?.id;
      if (!takeId) throw new Error('no durable motion takes available for saved witness source');
      const preview = await window.previewDurableMotionPanelTake(takeId);
      const shelf = window.kaminosMotionPanelTakeShelfDebugState?.();
      if (!shelf?.selectedTake) throw new Error('saved take preview did not select a take: ' + JSON.stringify(shelf || null));
      return {
        schema: 'kaminos.motion-panel-live-motion-source.v0',
        ok: true,
        takeSource: 'saved',
        durableTakeId: takeId,
        listed,
        preview,
        selectedTake: shelf.selectedTake,
        takeShelf: shelf,
      };
    })().catch(error => ({
      schema: 'kaminos.motion-panel-live-motion-source.v0',
      ok: false,
      takeSource: 'saved',
      durableTakeId: ${JSON.stringify(durableTakeId)},
      error: String(error?.message || error),
    }))`, { timeoutMs: 60000 });
  }
  if (takeSource === 'current') {
    return evaluate(ws, `(() => {
      const shelf = window.kaminosMotionPanelTakeShelfDebugState?.();
      if (!shelf?.selectedTake) {
        return {
          schema: 'kaminos.motion-panel-live-motion-source.v0',
          ok: false,
          takeSource: 'current',
          error: 'current take source requested but no selected take is loaded',
          takeShelf: shelf || null,
        };
      }
      return {
        schema: 'kaminos.motion-panel-live-motion-source.v0',
        ok: true,
        takeSource: 'current',
        selectedTake: shelf.selectedTake,
        takeShelf: shelf,
      };
    })()`, { timeoutMs: 20000 });
  }
  throw new Error(`--take-source must be generate, fixture, saved, or current; got ${takeSource}`);
}

async function installHillAffordanceRoutePlan(ws) {
  if (!hillAffordancePacketPath && !hillAffordanceDataPath) return null;
  if (!hillAffordancePacketPath || !hillAffordanceDataPath) {
    throw new Error('--hill-affordance-packet and --hill-affordance-data must be provided together');
  }
  const packet = JSON.parse(readFileSync(resolve(hillAffordancePacketPath), 'utf8'));
  const data = JSON.parse(readFileSync(resolve(hillAffordanceDataPath), 'utf8'));
  return evaluate(ws, `(async () => {
    if (typeof window.kaminosPreviewHillMotionAffordanceRoutePlan !== 'function') throw new Error('missing window.kaminosPreviewHillMotionAffordanceRoutePlan');
    const result = await window.kaminosPreviewHillMotionAffordanceRoutePlan(${JSON.stringify(packet)}, ${JSON.stringify(data)}, {
      id: 'witness-hill-motion-affordance-route',
    });
    const state = window.kaminosGeneratedPoseTemporalDebugState?.();
    if (!result?.routePlan || !state?.pathWorldRoutePlan) {
      throw new Error('Hill route plan did not become active Path World route evidence: ' + JSON.stringify({ result, state }));
    }
    return {
      schema: 'kaminos.motion-panel-live-hill-affordance-route.v0',
      ok: true,
      result,
      pathWorldPanel: window.kaminosMotionPanelPathWorldDebugState?.() || null,
      pathWorldRoutePlan: state.pathWorldRoutePlan,
      pathWorldActiveSource: state.pathWorldActiveSource || null,
      pathWorldRouteAuthority: state.pathWorldRouteAuthority || null,
      hillTerrainSurface: state.hillTerrainSurface || null,
      hillTerrainFrame: state.hillTerrainFrame || null,
    };
  })().catch(error => ({
    schema: 'kaminos.motion-panel-live-hill-affordance-route.v0',
    ok: false,
    error: String(error?.message || error),
  }))`, { timeoutMs: 60000 });
}

async function resetWitnessMotionClock(ws) {
  return evaluate(ws, `(async () => {
    if (typeof window.resetGeneratedPoseTemporalClock !== 'function') throw new Error('resetGeneratedPoseTemporalClock unavailable');
    const result = window.resetGeneratedPoseTemporalClock({ resetPathWorld: true });
    if (!result?.ok) throw new Error('generated temporal clock reset failed: ' + JSON.stringify(result || null));
    return result;
  })().catch(error => ({
    schema: 'kaminos.generated-pose-temporal-clock-reset.v0',
    ok: false,
    error: String(error?.message || error),
  }))`);
}

async function promoteAndReloadMotionTake(ws) {
  return evaluate(ws, `(async () => {
    if (typeof window.promoteMotionPanelSelectedTake !== 'function') throw new Error('missing window.promoteMotionPanelSelectedTake');
    if (typeof window.loadDurableMotionPanelTakes !== 'function') throw new Error('missing window.loadDurableMotionPanelTakes');
    if (typeof window.previewDurableMotionPanelTake !== 'function') throw new Error('missing window.previewDurableMotionPanelTake');
    const promotion = await window.promoteMotionPanelSelectedTake();
    const savedId = promotion?.saved?.id;
    if (!savedId) throw new Error('take promotion did not return a saved id: ' + JSON.stringify(promotion));
    const listed = await window.loadDurableMotionPanelTakes();
    if (!listed?.takes?.some(take => take.id === savedId)) throw new Error('promoted take did not appear in durable take list: ' + JSON.stringify(listed));
    const preview = await window.previewDurableMotionPanelTake(savedId);
    const shelf = window.kaminosMotionPanelTakeShelfDebugState?.();
    const selected = shelf?.selectedTake || null;
    if (selected?.durableTakeId !== savedId) throw new Error('loaded durable take did not become selected: ' + JSON.stringify({ savedId, selected }));
    return {
      schema: 'kaminos.motion-panel-live-take-promotion.v0',
      savedId,
      promotion,
      listed,
      preview,
      takeShelf: shelf,
    };
  })().catch(error => ({
    schema: 'kaminos.motion-panel-live-take-promotion.v0',
    ok: false,
    error: String(error?.message || error),
  }))`, { timeoutMs: 60000 });
}

async function configureClipletPlayback(ws) {
  return evaluate(ws, `(() => {
    const requested = ${JSON.stringify(clipletPlayback)};
    const requestedInterrupt = ${JSON.stringify(clipletInterrupt)};
    const select = document.getElementById('motion-panel-cliplet-playback');
    if (!select) throw new Error('missing motion panel cliplet playback selector');
    const options = [...select.options].map(option => ({ value: option.value, label: option.textContent || '' }));
    if (requested === 'full' || requested === '') {
      select.value = 'full';
    } else {
      const lower = requested.toLowerCase();
      const match = options.find(option => option.value === requested)
        || options.find(option => option.label.toLowerCase().includes(lower))
        || (requested === 'first' ? options.find(option => option.value !== 'full') : null);
      if (!match) throw new Error('cliplet playback option not found for ' + requested + ': ' + JSON.stringify(options));
      select.value = match.value;
    }
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const interruptInputs = Array.from(document.querySelectorAll('input[name="motion-panel-cliplet-interrupt"]'));
    if (!interruptInputs.length) throw new Error('missing motion panel cliplet interrupt radio group');
    const selectedInterrupt = requestedInterrupt === 'path-trigger' ? 'path-trigger' : 'off';
    const interruptInput = interruptInputs.find(input => input.value === selectedInterrupt);
    if (!interruptInput) throw new Error('cliplet interrupt radio option not found for ' + selectedInterrupt);
    for (const input of interruptInputs) input.checked = input === interruptInput;
    interruptInput.dispatchEvent(new Event('change', { bubbles: true }));
    const state = window.kaminosGeneratedPoseTemporalDebugState?.();
    return {
      schema: 'kaminos.motion-panel-live-cliplet-playback-config.v0',
      requested,
      requestedInterrupt,
      selected: select.value,
      selectedLabel: options.find(option => option.value === select.value)?.label || null,
      selectedInterrupt,
      options,
      interruptOptions: interruptInputs.map(input => ({ value: input.value, checked: !!input.checked })),
      clipletPlayback: state?.clipletPlayback || null,
      clipletPlaybackTimeline: state?.clipletPlaybackTimeline || null,
      clipletInterrupt: state?.clipletInterrupt || null,
      clipletInterruptTimeline: state?.clipletInterruptTimeline || null,
      pathWorld: state?.pathWorld || null,
      pathWorldInterrupt: state?.pathWorldInterrupt || null,
      pathWorldActiveSource: state?.pathWorldActiveSource || null,
      pathWorldPanel: window.kaminosMotionPanelPathWorldDebugState?.() || null,
    };
  })()`, { timeoutMs: 20000 });
}

async function focusMotionPanelPhrasePreview(ws) {
  return evaluate(ws, `(() => {
    const host = document.getElementById('motion-panel-phrase-preview');
    if (!host) throw new Error('missing motion panel phrase preview');
    host.scrollIntoView({ block: 'center', inline: 'nearest' });
    const chips = [...host.querySelectorAll('.motion-panel-phrase-chip')].map(chip => ({
      text: chip.textContent || '',
      segmentId: chip.dataset.segmentId || null,
      active: chip.classList.contains('active'),
    }));
    if (!chips.length) throw new Error('motion panel phrase preview has no chips');
    const rect = host.getBoundingClientRect();
    return {
      schema: 'kaminos.motion-panel-live-phrase-preview-focus.v0',
      chipCount: chips.length,
      chips,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`, { timeoutMs: 20000 });
}

async function focusMotionPanelTakeShelf(ws) {
  return evaluate(ws, `(() => {
    const host = document.getElementById('motion-panel-take-shelf');
    if (!host) throw new Error('missing motion panel take shelf');
    host.scrollIntoView({ block: 'center', inline: 'nearest' });
    const currentHost = document.getElementById('motion-panel-current-take');
    const savedHost = document.getElementById('motion-panel-saved-takes');
    const shelf = window.kaminosMotionPanelTakeShelfDebugState?.();
    const rows = [...host.querySelectorAll('.motion-panel-take-card')].map(row => ({
      text: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
      buttonCount: row.querySelectorAll('button').length,
    }));
    const currentRows = [...(currentHost?.querySelectorAll('.motion-panel-take-card') || [])].map(row => ({
      text: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
      buttonCount: row.querySelectorAll('button').length,
    }));
    const savedRows = [...(savedHost?.querySelectorAll('.motion-panel-take-card') || [])].map(row => ({
      text: (row.textContent || '').replace(/\\s+/g, ' ').trim(),
      buttonCount: row.querySelectorAll('button').length,
    }));
    const rect = host.getBoundingClientRect();
    return {
      schema: 'kaminos.motion-panel-live-take-shelf-focus.v0',
      rowCount: rows.length,
      rows,
      currentRows,
      savedRows,
      shelf,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  })()`, { timeoutMs: 20000 });
}

async function captureFrame(ws, index) {
  const debug = await evaluate(ws, `(() => {
    const state = window.kaminosGeneratedPoseTemporalDebugState?.();
    const actor = state?.actors?.[0] || null;
    const sourceGhost = actor?.sourceGhost || state?.sourceGhost || null;
    const canvas = document.querySelector('canvas');
    const rect = canvas?.getBoundingClientRect();
    return {
      index: ${index},
      route: state?.route || null,
      status: document.getElementById('motion-panel-temporal-status')?.textContent || null,
      info: document.getElementById('info')?.textContent || null,
      envLoadingDisplay: getComputedStyle(document.getElementById('env-loading')).display,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      canvasRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      actorRoot: actor?.root || null,
      actorRawRoot: actor?.rawRoot || null,
      actorGrounding: actor?.grounding || null,
      actorDisplayCompression: actor?.displayCompression ?? null,
      actorSourceVerticalPolicy: actor?.sourceVerticalPolicy || actor?.grounding?.sourceVerticalPolicy || null,
      behaviorState: actor?.behaviorState || null,
      cliplet: actor?.cliplet || state?.activeCliplet || null,
      clipletId: actor?.clipletId || state?.activeCliplet?.id || null,
      clipletLabel: actor?.clipletLabel || state?.activeCliplet?.labelGuess || null,
      clipletPlayback: actor?.clipletPlayback || state?.clipletPlayback || null,
      clipletPlaybackTimeline: state?.clipletPlaybackTimeline || null,
      clipletInterrupt: actor?.clipletInterrupt || state?.clipletInterrupt || null,
      clipletInterruptTimeline: state?.clipletInterruptTimeline || null,
      pathWorld: actor?.pathWorld || state?.pathWorld || null,
      routeMode: actor?.pathWorld?.routeMode || state?.pathWorld?.routeMode || state?.pathWorld?.pathWorldSample?.routeMode || null,
      pathWorldInterrupt: actor?.pathWorldInterrupt || state?.pathWorldInterrupt || null,
      pathWorldEpisode: actor?.pathWorldEpisode || state?.pathWorldEpisode || state?.pathWorldInterrupt?.pathWorldEpisode || null,
      pathWorldEncounterSemantics: actor?.pathWorldEncounterSemantics || state?.pathWorldEncounterSemantics || state?.pathWorldEpisode?.encounterSemantics || null,
      pathWorldEncounterTrajectory: actor?.pathWorldEncounterTrajectory || state?.pathWorldEncounterTrajectory || null,
      pathWorldResumeHandoff: actor?.pathWorldResumeHandoff || state?.pathWorldResumeHandoff || null,
      pathWorldSteeringIntent: actor?.pathWorldSteeringIntent || state?.pathWorldSteeringIntent || state?.pathWorld?.pathWorldSteeringIntent || null,
      pathWorldSteeringMemory: actor?.pathWorldSteeringMemory || state?.pathWorldSteeringMemory || state?.pathWorld?.pathWorldSteeringMemory || state?.pathWorldSteeringIntent?.pathWorldSteeringMemory || null,
      pathWorldRootConstraint: actor?.pathWorldRootConstraint || state?.pathWorldRootConstraint || null,
      pathWorldRouteAuthority: actor?.pathWorldRouteAuthority || state?.pathWorldRouteAuthority || null,
      pathWorldRoutePlan: actor?.pathWorldRoutePlan || state?.pathWorldRoutePlan || state?.pathWorld?.routePlan || null,
      pathWorldActiveSource: actor?.pathWorldActiveSource || state?.pathWorldActiveSource || null,
      hillTerrainSurface: actor?.hillTerrainSurface || state?.hillTerrainSurface || state?.pathWorld?.hillTerrainSurface || null,
      hillTerrainFrame: actor?.hillTerrainFrame || state?.hillTerrainFrame || state?.pathWorld?.hillTerrainFrame || null,
      hillTerrainCarrier: actor?.hillTerrainCarrier || state?.hillTerrainCarrier || null,
      groundingAuthority: actor?.groundingAuthority || state?.groundingAuthority || state?.hillTerrainCarrier?.groundingAuthority || null,
      pathWorldPanel: window.kaminosMotionPanelPathWorldDebugState?.() || null,
      generatedMotionCliplets: state?.generatedMotionCliplets || state?.generatedPoseTemporalHarness?.generatedMotionCliplets || null,
      attentionTargetEvidence: actor?.attentionTargetEvidence || state?.attentionTargetEvidence || null,
      sourceFrame: actor?.sourceFrame ?? null,
      sourceFrameTotal: sourceGhost?.sourceFrameTotal ?? null,
      sourceOrientationRemap: sourceGhost?.sourceOrientationRemap || state?.sourceOrientationRemap || null,
      phraseControlApplicability: window.motionPhraseControlApplicabilityDebugState?.() || null,
      phrasePreview: state?.clipletPlaybackOptions?.phrasePreview || null,
      sourceInterpolation: actor?.sourceInterpolation ?? null,
      sourceGhost,
    };
  })()`, { timeoutMs: 20000 });
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, { timeoutMs: 20000 });
  const png = Buffer.from(shot.data, 'base64');
  assertPng(png, `frame ${index}`);
  const path = `${outDir}/frame-${String(index).padStart(3, '0')}.png`;
  writeFileSync(path, png);
  return {
    schema: 'kaminos.motion-panel-live-frame.v0',
    index,
    path,
    bytes: png.length,
    sheetFrameLabel: 'sheet ' + String(index + 1).padStart(2, '0') + '/' + frameTotal,
    sourceFrameLabel: 'source '
      + (Number.isFinite(Number(debug.sourceFrame)) ? Number(debug.sourceFrame).toFixed(1) : 'n/a')
      + '/'
      + (Number.isFinite(Number(debug.sourceFrameTotal)) ? String(Math.max(1, Math.round(Number(debug.sourceFrameTotal)))) : '?'),
    screenshotDataUrl: `data:image/png;base64,${shot.data}`,
    debug,
  };
}

async function composeFilmstrip(ws, frames) {
  if (!frames.length) throw new Error('no frames for filmstrip');
  const firstPng = readFileSync(frames[0].path);
  const firstImage = pngDimensions(firstPng);
  const firstFrame = frames[0];
  const viewport = firstFrame.debug?.viewport || { width: firstImage.width, height: firstImage.height };
  const scaleX = firstImage.width / Math.max(1, viewport.width || firstImage.width);
  const scaleY = firstImage.height / Math.max(1, viewport.height || firstImage.height);
  const cssRect = firstFrame.debug?.canvasRect || {
    x: 0,
    y: 0,
    width: viewport.width || firstImage.width,
    height: viewport.height || firstImage.height,
  };
  const crop = {
    x: Math.max(0, Math.round(cssRect.x * scaleX)),
    y: Math.max(0, Math.round(cssRect.y * scaleY)),
    width: Math.max(1, Math.round(cssRect.width * scaleX)),
    height: Math.max(1, Math.round(cssRect.height * scaleY)),
  };
  crop.width = Math.min(crop.width, firstImage.width - crop.x);
  crop.height = Math.min(crop.height, firstImage.height - crop.y);
  const labelHeight = 46;
  const tileHeight = Math.max(1, Math.round(tileWidth * crop.height / crop.width));
  const columnCount = columns;
  const rowCount = Math.ceil(frames.length / columnCount);
  const sheetWidth = tileWidth * columnCount;
  const sheetHeight = (tileHeight + labelHeight) * rowCount;
  const imageScale = tileWidth / crop.width;
  const htmlPath = resolve(outDir, 'contact-sheet.html');
  const tiles = frames.map(frame => {
    const behaviorState = frame.debug?.behaviorState?.state || null;
    const behaviorPhase = frame.debug?.behaviorState?.phase || null;
    const clipletLabel = frame.debug?.clipletLabel || frame.debug?.cliplet?.labelGuess || null;
    const clipletInterrupt = frame.debug?.clipletInterrupt || null;
    const pathWorldInterrupt = frame.debug?.pathWorldInterrupt || null;
    const pathWorldEpisode = frame.debug?.pathWorldEpisode || null;
    const pathWorldEncounterSemantics = frame.debug?.pathWorldEncounterSemantics || pathWorldEpisode?.encounterSemantics || null;
    const pathWorldEncounterTrajectory = frame.debug?.pathWorldEncounterTrajectory || null;
    const pathWorldResumeHandoff = frame.debug?.pathWorldResumeHandoff || pathWorldEncounterTrajectory?.resumeHandoff || null;
    const pathWorldSteeringIntent = frame.debug?.pathWorldSteeringIntent || frame.debug?.pathWorld?.pathWorldSteeringIntent || null;
    const pathWorldSteeringMemory = frame.debug?.pathWorldSteeringMemory || pathWorldSteeringIntent?.pathWorldSteeringMemory || null;
    const episodePhase = pathWorldEpisode?.phase || pathWorldInterrupt?.phase || null;
    const trajectoryPhase = pathWorldEncounterTrajectory?.trajectoryPhase || pathWorldEncounterTrajectory?.activeSample?.trajectoryPhase || null;
    const encounterArchetype = pathWorldEncounterSemantics?.encounterArchetype || pathWorldEncounterTrajectory?.encounterArchetype || null;
    const trajectoryProfile = pathWorldEncounterSemantics?.trajectoryProfile || pathWorldEncounterTrajectory?.trajectoryProfile || null;
    const steeringIntent = pathWorldSteeringIntent?.steeringIntent || null;
    const precontact = pathWorldSteeringIntent?.precontact && pathWorldSteeringIntent?.routeBiasApplied ? 'precontact' : null;
    const memoryActive = pathWorldSteeringMemory?.memoryActive ? 'memory active' : null;
    const memorySide = pathWorldSteeringMemory?.memorySide ? `side ${pathWorldSteeringMemory.memorySide}` : null;
    const handoffPhase = pathWorldResumeHandoff?.handoffPhase || pathWorldResumeHandoff?.activeSample?.handoffPhase || null;
    const routeAuthority = frame.debug?.pathWorldRouteAuthority
      || pathWorldEncounterTrajectory?.routeAuthority
      || pathWorldResumeHandoff?.routeAuthority
      || pathWorldResumeHandoff?.activeSample?.routeAuthority
      || null;
    const pathWorldActiveSource = frame.debug?.pathWorldActiveSource || null;
    const interruptState = clipletInterrupt?.state
      ? `interrupt ${clipletInterrupt.state}`
      : episodePhase
        ? `episode ${episodePhase}`
      : pathWorldInterrupt?.state
        ? `world ${pathWorldInterrupt.state}`
        : pathWorldActiveSource;
    const episodeId = pathWorldEpisode?.episodeId ? pathWorldEpisode.episodeId.replace(/^path-world-/, '') : null;
    const state = [
      clipletLabel || behaviorState,
      steeringIntent ? `steer ${steeringIntent}` : null,
      memoryActive,
      memorySide,
      precontact,
      encounterArchetype ? `enc ${encounterArchetype}` : null,
      interruptState || behaviorPhase,
      trajectoryPhase ? `traj ${trajectoryPhase}` : null,
      trajectoryProfile ? `profile ${trajectoryProfile}` : null,
      handoffPhase ? `handoff ${handoffPhase}` : null,
      routeAuthority ? `route ${routeAuthority}` : null,
      episodeId,
    ].filter(Boolean).join(' / ') || 'generated motion';
    return {
      src: basename(frame.path),
      top: frame.sheetFrameLabel + ' · ' + frame.sourceFrameLabel,
      bottom: state.slice(0, 58),
    };
  });
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; width: ${sheetWidth}px; min-height: ${sheetHeight}px; background: #050505; overflow: hidden; }
.sheet { display: grid; grid-template-columns: repeat(${columnCount}, ${tileWidth}px); width: ${sheetWidth}px; }
.tile { position: relative; width: ${tileWidth}px; height: ${tileHeight + labelHeight}px; overflow: hidden; background: #050505; }
.label { position: absolute; left: 0; top: 0; width: 100%; height: ${labelHeight}px; box-sizing: border-box; padding: 7px 10px 0; background: rgba(0, 0, 0, 0.78); font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 18px; color: rgba(240, 210, 138, 0.96); white-space: nowrap; overflow: hidden; }
.label .bottom { color: rgba(255, 239, 196, 0.86); }
.tile img { position: absolute; left: ${-crop.x * imageScale}px; top: ${labelHeight - crop.y * imageScale}px; width: ${firstImage.width * imageScale}px; height: ${firstImage.height * imageScale}px; }
</style>
</head>
<body>
<div class="sheet">
${tiles.map(tile => `<div class="tile"><img src="${escapeHtml(tile.src)}"><div class="label"><div>${escapeHtml(tile.top)}</div><div class="bottom">${escapeHtml(tile.bottom)}</div></div></div>`).join('\n')}
</div>
</body>
</html>`);
  const contactSheetUrl = pathToFileURL(htmlPath).href;
  await wsRequest(ws, 'Page.navigate', { url: contactSheetUrl }, { timeoutMs: 20000 });
  await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
    width: sheetWidth,
    height: sheetHeight,
    deviceScaleFactor: 1,
    mobile: false,
  }, { timeoutMs: 20000 });
  const navigationDeadline = Date.now() + 20000;
  for (;;) {
    const state = await evaluate(ws, `(() => ({
      href: window.location.href,
      readyState: document.readyState,
      tileImages: document.querySelectorAll('.sheet .tile img').length,
    }))()`, { timeoutMs: 3000 }).catch(error => ({ error: String(error?.message || error) }));
    if (state.href === contactSheetUrl && state.readyState !== 'loading' && state.tileImages === frames.length) break;
    if (Date.now() > navigationDeadline) {
      throw new Error(`contact sheet navigation did not settle: ${JSON.stringify(state)}`);
    }
    await delay(80);
  }
  await evaluate(ws, `new Promise((resolve, reject) => {
    const finish = () => {
      const images = Array.from(document.querySelectorAll('.sheet .tile img'));
      if (images.length !== ${frames.length}) reject(new Error('contact sheet image count mismatch'));
      else if (images.every(image => image.complete && image.naturalWidth > 0)) resolve(true);
      else setTimeout(finish, 50);
    };
    finish();
  })`, { timeoutMs: 20000 });
  const shot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  }, { timeoutMs: 240000 });
  const png = Buffer.from(shot.data, 'base64');
  assertPng(png, 'filmstrip');
  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, png);
  return {
    schema: 'kaminos.motion-panel-live-filmstrip.v0',
    path: filmstripPath,
    bytes: png.length,
    width: sheetWidth,
    height: sheetHeight,
    crop,
    tileWidth,
    tileHeight,
    columns: columnCount,
    rows: rowCount,
    htmlPath,
  };
}

async function exportCurrentViewFilmstrip(ws) {
  const result = await evaluate(ws, `(async () => {
    const parseVec = value => String(value || '')
      .split(',')
      .map(part => Number(part.trim()))
      .filter(number => Number.isFinite(number));
    const cameraPosition = parseVec(${JSON.stringify(cameraPosition)});
    const cameraTarget = parseVec(${JSON.stringify(cameraTarget)});
    if (cameraPosition.length || cameraTarget.length) {
      if (typeof window.kaminosSetCameraDebugPose !== 'function') throw new Error('camera debug pose setter unavailable');
      window.kaminosSetCameraDebugPose({
        position: cameraPosition.length === 3 ? cameraPosition : undefined,
        target: cameraTarget.length === 3 ? cameraTarget : undefined,
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const cameraBefore = typeof window.motionPanelCurrentViewCameraEvidence === 'function'
      ? window.motionPanelCurrentViewCameraEvidence()
      : null;
    const sourceModeBeforeExport = document.getElementById('motion-panel-source-ghost-mode')?.value || null;
    if (typeof window.exportMotionPanelCurrentViewFilmstrip !== 'function') throw new Error('current-view export function unavailable');
    const exported = await window.exportMotionPanelCurrentViewFilmstrip();
    if (!exported?.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('current-view export did not return a PNG data URL');
    const sourceModeAfterExport = document.getElementById('motion-panel-source-ghost-mode')?.value || null;
    const exportTray = typeof window.kaminosMotionPanelExportTrayDebugState === 'function'
      ? window.kaminosMotionPanelExportTrayDebugState()
      : null;
    const temporalDebug = typeof window.kaminosGeneratedPoseTemporalDebugState === 'function'
      ? window.kaminosGeneratedPoseTemporalDebugState()
      : null;
    const phraseControlApplicability = typeof window.motionPhraseControlApplicabilityDebugState === 'function'
      ? window.motionPhraseControlApplicabilityDebugState()
      : null;
    return {
      schema: 'kaminos.motion-panel-live-current-view-export.v0',
      status: document.getElementById('motion-panel-temporal-status')?.textContent || null,
      cameraBefore,
      cameraAfter: exported.camera || null,
      requestedExportReferenceMode: ${JSON.stringify(exportReferenceMode)},
      sourceModeBeforeExport,
      sourceModeAfterExport,
      referenceMode: exported.referenceMode || null,
      effectiveReferenceMode: exported.effectiveReferenceMode || null,
      previousReferenceMode: exported.previousReferenceMode || null,
      referenceOverrideApplied: !!exported.referenceOverrideApplied,
      selectedTake: exported.selectedTake || null,
      sourceGhostAtExportStart: exported.sourceGhostAtExportStart || null,
      sourceGhostAtExportEnd: exported.sourceGhostAtExportEnd || null,
      attentionTargetEvidence: temporalDebug?.attentionTargetEvidence || temporalDebug?.actors?.[0]?.attentionTargetEvidence || null,
      activeCliplet: temporalDebug?.activeCliplet || temporalDebug?.actors?.[0]?.cliplet || null,
      clipletPlayback: temporalDebug?.clipletPlayback || temporalDebug?.actors?.[0]?.clipletPlayback || null,
      clipletPlaybackTimeline: temporalDebug?.clipletPlaybackTimeline || null,
      generatedMotionCliplets: temporalDebug?.generatedMotionCliplets || temporalDebug?.generatedPoseTemporalHarness?.generatedMotionCliplets || null,
      sourceOrientationRemap: temporalDebug?.sourceOrientationRemap || exported.sourceGhostAtExportStart?.sourceOrientationRemap || null,
      phraseControlApplicability,
      prompt: exported.prompt || null,
      settings: exported.settings || null,
      width: exported.width || null,
      height: exported.height || null,
      frameCount: exported.frameCount || null,
      frames: exported.frames || [],
      columns: exported.columns || null,
      rows: exported.rows || null,
      downloadName: exported.downloadName || null,
      exportRecord: exported.exportRecord || null,
      exportTray,
      dataUrl: exported.dataUrl,
    };
  })()`, { timeoutMs: 240000 });
  const base64 = String(result.dataUrl || '').replace(/^data:image\/png;base64,/, '');
  const png = Buffer.from(base64, 'base64');
  assertPng(png, 'current-view export filmstrip');
  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, png);
  const { dataUrl, ...reportable } = result;
  return {
    ...reportable,
    path: filmstripPath,
    bytes: png.length,
  };
}

async function exportSelectedClipletFilmstrip(ws) {
  const result = await evaluate(ws, `(async () => {
    const parseVec = value => String(value || '')
      .split(',')
      .map(part => Number(part.trim()))
      .filter(number => Number.isFinite(number));
    const cameraPosition = parseVec(${JSON.stringify(cameraPosition)});
    const cameraTarget = parseVec(${JSON.stringify(cameraTarget)});
    if (cameraPosition.length || cameraTarget.length) {
      if (typeof window.kaminosSetCameraDebugPose !== 'function') throw new Error('camera debug pose setter unavailable');
      window.kaminosSetCameraDebugPose({
        position: cameraPosition.length === 3 ? cameraPosition : undefined,
        target: cameraTarget.length === 3 ? cameraTarget : undefined,
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    if (typeof window.exportMotionPanelSelectedClipletFilmstrip !== 'function') throw new Error('selected-cliplet export function unavailable');
    const exported = await window.exportMotionPanelSelectedClipletFilmstrip();
    if (!exported?.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('selected-cliplet export did not return a PNG data URL');
    const exportTray = typeof window.kaminosMotionPanelExportTrayDebugState === 'function'
      ? window.kaminosMotionPanelExportTrayDebugState()
      : null;
    return {
      schema: 'kaminos.motion-panel-live-selected-cliplet-export.v0',
      status: document.getElementById('motion-panel-temporal-status')?.textContent || null,
      selectedTake: exported.selectedTake || null,
      selectedCliplet: exported.selectedCliplet || null,
      sourceRange: exported.sourceRange || null,
      referenceMode: exported.referenceMode || null,
      effectiveReferenceMode: exported.effectiveReferenceMode || null,
      exportTray,
      width: exported.width || null,
      height: exported.height || null,
      frameCount: exported.frameCount || 0,
      frames: exported.frames || [],
      dataUrl: exported.dataUrl,
      downloadName: exported.downloadName || null,
    };
  })()`, { timeoutMs: 120000 });
  if (!result?.selectedTake) throw new Error(`selected-cliplet export did not record selected take: ${JSON.stringify(result || null)}`);
  if (!result?.selectedCliplet?.id) throw new Error(`selected-cliplet export did not record selected cliplet: ${JSON.stringify(result || null)}`);
  const base64 = String(result.dataUrl || '').replace(/^data:image\/png;base64,/, '');
  const png = Buffer.from(base64, 'base64');
  assertPng(png, 'selected-cliplet export filmstrip');
  mkdirSync(dirname(filmstripPath), { recursive: true });
  writeFileSync(filmstripPath, png);
  const { dataUrl, ...metadata } = result;
  return {
    ...metadata,
    path: filmstripPath,
    bytes: png.length,
  };
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  ws.addEventListener('message', recordConsoleEvent);
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Log.enable');
  await wsRequest(ws, 'Page.bringToFront').catch(() => null);
  await wsRequest(ws, 'Page.navigate', { url });

  phase = 'settling-route';
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'window.location.href');
  if (!effectiveUrl.includes('kaminos_motion_agency=1')) throw new Error(`effective URL lost motion route: ${effectiveUrl}`);
  runtimeIdentity = await evaluate(ws, `fetch('/api/runtime-identity')
    .then(response => response.ok ? response.json() : { error: 'runtime identity http ' + response.status })
    .catch(error => ({ error: error.message }))`);
  if (!runtimeIdentity?.root) throw new Error(`runtime identity missing effective root: ${JSON.stringify(runtimeIdentity)}`);
  const preflight = await evaluate(ws, `(() => ({
    href: location.href,
    hasGenerateMotion: typeof window.generateMotion === 'function',
    panelPresent: !!document.getElementById('motion-panel-orb-preview'),
    envLoadingDisplay: getComputedStyle(document.getElementById('env-loading')).display,
    envLoadingText: document.getElementById('env-loading')?.textContent || null,
  }))()`);
  if (!preflight.hasGenerateMotion || !preflight.panelPresent) throw new Error(`live motion panel unavailable: ${JSON.stringify(preflight)}`);

  phase = 'configuring-panel';
  const configured = await configureMotionPanel(ws);

  phase = `loading-motion-source-${takeSource}`;
  const motionSource = await loadWitnessMotionSource(ws);
  if (!motionSource?.ok) throw new Error(`motion source load failed: ${JSON.stringify(motionSource)}`);
  const generated = motionSource.generated || null;
  let hillAffordanceRoute = null;
  if (hillAffordancePacketPath || hillAffordanceDataPath) {
    phase = 'installing-hill-affordance-route';
    hillAffordanceRoute = await installHillAffordanceRoutePlan(ws);
    if (!hillAffordanceRoute?.ok) throw new Error(`Hill affordance route install failed: ${JSON.stringify(hillAffordanceRoute)}`);
  }
  let motionClockReset = null;
  let promotedTake = null;
  if (promoteTake) {
    phase = 'promoting-motion-take';
    promotedTake = await promoteAndReloadMotionTake(ws);
    if (promotedTake?.ok === false || !promotedTake?.savedId) throw new Error(`motion take promotion failed: ${JSON.stringify(promotedTake)}`);
  }
  phase = 'configuring-cliplet-playback';
  const configuredClipletPlayback = await configureClipletPlayback(ws);
  let phrasePreviewFocus = null;
  if (focusPhrasePreview) {
    phase = 'focusing-phrase-preview';
    phrasePreviewFocus = await focusMotionPanelPhrasePreview(ws);
  }
  let takeShelfFocus = null;
  if (focusTakeShelf) {
    phase = 'focusing-take-shelf';
    takeShelfFocus = await focusMotionPanelTakeShelf(ws);
  }
  phase = 'resetting-motion-clock';
  motionClockReset = await resetWitnessMotionClock(ws);
  if (!motionClockReset?.ok) throw new Error(`motion clock reset failed: ${JSON.stringify(motionClockReset)}`);
  await delay(Math.min(settleMs, 180));

  let filmstrip = null;
  let frames = [];
  if (exportSelectedCliplet) {
    phase = 'exporting-selected-cliplet-filmstrip';
    filmstrip = await exportSelectedClipletFilmstrip(ws);
  } else if (exportCurrentView) {
    phase = 'exporting-current-view-filmstrip';
    filmstrip = await exportCurrentViewFilmstrip(ws);
    if (!filmstrip?.selectedTake) throw new Error(`current-view export did not record selected take: ${JSON.stringify(filmstrip || null)}`);
  } else {
    phase = 'capturing-frames';
    const capturedFrames = [];
    for (let index = 0; index < frameTotal; index++) {
      capturedFrames.push(await captureFrame(ws, index));
      if (index < frameTotal - 1) await delay(intervalMs);
    }
    if (sourceMode === 'overlay') {
      const overlayFrames = capturedFrames
        .map(frame => frame.debug?.sourceGhost)
        .filter(sourceGhost => sourceGhost?.mode === 'overlay');
      if (!overlayFrames.some(sourceGhost => sourceGhost.visible && sourceGhost.overlayOcclusionMode === 'xray-over-body')) {
        throw new Error(`source mode overlay did not produce x-ray source ghost evidence: ${JSON.stringify(overlayFrames[0] || null)}`);
      }
      if (!overlayFrames.some(sourceGhost => Number(sourceGhost.overlaySizeMultiplier) >= overlaySize - 0.01)) {
        throw new Error(`source ghost overlay size did not reach requested multiplier: ${JSON.stringify(overlayFrames[0] || null)}`);
      }
      if (!overlayFrames.some(sourceGhost => {
        const span = sourceGhost.displayBounds?.span || [];
        return Number(span[1]) >= 0.52 && Math.max(Number(span[0]) || 0, Number(span[2]) || 0) >= 0.08;
      })) {
        throw new Error(`source ghost overlay display bounds are not credible: ${JSON.stringify(overlayFrames[0]?.displayBounds || null)}`);
      }
    }

    phase = 'composing-filmstrip';
    filmstrip = await composeFilmstrip(ws, capturedFrames);
    frames = capturedFrames.map(({ screenshotDataUrl, ...frame }) => frame);
  }

  phase = 'writing-report';
  const failures = consoleFailureEvents();
  if (failures.length) {
    throw new Error(`browser console produced ${failures.length} failure event(s): ${JSON.stringify(failures.slice(0, 3))}`);
  }
  writeReport({
    ok: true,
    preflight,
    configured,
    configuredClipletPlayback,
    phrasePreviewFocus,
    takeShelfFocus,
    promotedTake,
    hillAffordanceRoute,
    motionSource,
    motionClockReset,
    generated,
    takeShelf: promotedTake?.takeShelf || motionSource?.takeShelf || generated?.takeShelf || null,
    frames,
    filmstrip,
  });
  await closeBrowser(ws);
} catch (error) {
  writeReport({
    ok: false,
    error: error.stack || String(error),
  });
  if (chromeProcess) chromeProcess.kill('SIGTERM');
  throw error;
}
