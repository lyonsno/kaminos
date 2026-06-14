#!/usr/bin/env node
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/';
const out = resolve(args.get('--out') || '/tmp/kaminos-scene-object-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9439);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-scene-object-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 3500);
const scenario = args.get('--scenario') || 'append-select-remove-keyboard';

let phase = 'initializing';
let stderr = '';
let lastEvidence = {};
let effectiveUrl = null;
let browserVersion = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl: effectiveUrl,
    scenario,
    debugPort: port,
    chrome,
    userDataDir,
    settleMs,
    phase,
    browserVersion,
    stderrTail: stderr.slice(-2000),
    ...report,
  }, null, 2));
}

function assertPngScreenshot(buffer) {
  assert.ok(buffer.length > 1024, 'screenshot is too small to be credible visual evidence');
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
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

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function runAppendSelectRemoveKeyboardScenario(ws) {
  phase = 'scenario-default-replace';
  lastEvidence.defaultReplace = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const initialRows = [...document.querySelectorAll('[data-scene-object-id]')];
      const initialIds = initialRows.map(row => row.dataset.sceneObjectId);
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = false;
      demo.click();
      let rows = [];
      for (let i = 0; i < 80; i++) {
        rows = [...document.querySelectorAll('[data-scene-object-id]')];
        if (rows.length === 1 && rows[0].dataset.sceneObjectId !== initialIds[0]) break;
        await wait(125);
      }
      return {
        appendChecked: append.checked,
        rowCount: rows.length,
        initialIds,
        ids: rows.map(row => row.dataset.sceneObjectId),
        activeCount: document.querySelectorAll('.scene-object-row.active').length,
      };
    })()
  `);
  if (lastEvidence.defaultReplace.rowCount !== 1) {
    throw new Error(`default replace did not keep one row: ${JSON.stringify(lastEvidence.defaultReplace)}`);
  }
  if (lastEvidence.defaultReplace.ids[0] === lastEvidence.defaultReplace.initialIds[0]) {
    throw new Error(`default replace did not complete with a new row: ${JSON.stringify(lastEvidence.defaultReplace)}`);
  }

  phase = 'scenario-append-and-selection';
  lastEvidence.appendSelection = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      const append = document.getElementById('append-import-toggle');
      append.checked = true;
      demo.click();
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 2) break;
        await wait(125);
      }
      const rows = [...document.querySelectorAll('[data-scene-object-id]')];
      if (rows.length !== 2) return { rowCount: rows.length, ids: rows.map(row => row.dataset.sceneObjectId) };
      rows[0].click();
      await wait(250);
      const afterFirst = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      document.querySelector('[data-scene-object-id="' + rows[1].dataset.sceneObjectId + '"]').click();
      await wait(250);
      const afterSecond = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      return {
        appendChecked: append.checked,
        rowCount: rows.length,
        uniqueIds: new Set(rows.map(row => row.dataset.sceneObjectId)).size,
        firstId: rows[0].dataset.sceneObjectId,
        secondId: rows[1].dataset.sceneObjectId,
        afterFirst,
        afterSecond,
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      };
    })()
  `);
  if (lastEvidence.appendSelection.rowCount !== 2 || lastEvidence.appendSelection.uniqueIds !== 2) {
    throw new Error(`append import did not produce two unique rows: ${JSON.stringify(lastEvidence.appendSelection)}`);
  }
  if (lastEvidence.appendSelection.afterFirst.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`first selection not exclusive: ${JSON.stringify(lastEvidence.appendSelection.afterFirst)}`);
  }
  if (lastEvidence.appendSelection.afterSecond.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`second selection not exclusive: ${JSON.stringify(lastEvidence.appendSelection.afterSecond)}`);
  }

  phase = 'scenario-mouse-remove';
  lastEvidence.mouseRemove = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const activeRemove = document.querySelector('.scene-object-row.active [data-scene-object-remove-id]');
      if (!activeRemove) throw new Error('active remove button missing');
      activeRemove.click();
      await wait(500);
      const rows = [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      }));
      return {
        rows,
        info: document.getElementById('info-bar').textContent.trim(),
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      };
    })()
  `);
  if (lastEvidence.mouseRemove.rows.length !== 1 || lastEvidence.mouseRemove.rows.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`mouse remove did not leave one active row: ${JSON.stringify(lastEvidence.mouseRemove)}`);
  }

  phase = 'scenario-keyboard-remove';
  lastEvidence.keyboardSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      document.getElementById('append-import-toggle').checked = true;
      demo.click();
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 2) break;
        await wait(125);
      }
      const activeRemove = document.querySelector('.scene-object-row.active [data-scene-object-remove-id]');
      if (!activeRemove) throw new Error('active remove button missing after reappend');
      activeRemove.focus();
      return {
        rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({ id: row.dataset.sceneObjectId, active: row.classList.contains('active') })),
        focusedRemoveId: document.activeElement?.dataset?.sceneObjectRemoveId || null,
        activeElementClass: document.activeElement?.className || null,
      };
    })()
  `);
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await wsRequest(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  await delay(700);
  lastEvidence.keyboardRemove = await evaluate(ws, `
    (async () => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      info: document.getElementById('info-bar').textContent.trim(),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
    }))()
  `);
  if (lastEvidence.keyboardRemove.rows.length !== 1 || lastEvidence.keyboardRemove.rows.filter(row => row.active && row.pressed === 'true').length !== 1) {
    throw new Error(`keyboard remove did not remove focused row: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
  if (!lastEvidence.keyboardRemove.info.startsWith('Removed:')) {
    throw new Error(`keyboard remove did not report removal: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
}

let chromeProcess = null;
let ws = null;

try {
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--window-size=1468,960',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  phase = 'waiting-for-cdp';
  browserVersion = await waitForCdp();

  phase = 'opening-target';
  const targets = await cdpFetch('/json/list');
  const target = targets.find(t => t.type === 'page') || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Page.bringToFront');
  await delay(settleMs);
  effectiveUrl = await evaluate(ws, 'location.href');

  if (scenario !== 'append-select-remove-keyboard') {
    throw new Error(`Unsupported scene object witness scenario: ${scenario}`);
  }
  await runAppendSelectRemoveKeyboardScenario(ws);

  phase = 'capturing-screenshot';
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  writeFileSync(out, png);

  phase = 'writing-report';
  const report = {
    ok: true,
    screenshot: out,
    evidence: lastEvidence,
  };
  writeReport(report);
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
} catch (error) {
  writeReport({
    ok: false,
    error: error.stack || String(error),
    screenshot: null,
    evidence: lastEvidence,
  });
  throw error;
} finally {
  try { ws?.close?.(); } catch {}
  chromeProcess?.kill('SIGTERM');
}
