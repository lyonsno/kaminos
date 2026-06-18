#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
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
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-scene-object-witness-profile-${port}-${process.pid}`;
const settleMs = Number(args.get('--settle-ms') || 3500);
const scenario = args.get('--scenario') || 'append-select-remove-keyboard';
const expectedServerRoot = args.get('--expected-server-root') ? resolve(args.get('--expected-server-root')) : null;

let phase = 'initializing';
let stderr = '';
let lastEvidence = {};
let effectiveUrl = null;
let effectiveServerRoots = null;
let browserVersion = null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    requestedUrl: url,
    effectiveUrl: effectiveUrl,
    effectiveServerRoots: effectiveServerRoots,
    expectedServerRoot: expectedServerRoot,
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

function siblingPngPath(suffix) {
  return out.replace(/\.png$/i, `${suffix}.png`);
}

async function capturePngScreenshot(ws, screenshotPath) {
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, png);
  return { path: screenshotPath, bytes: png.length };
}

async function cdpFetch(path, options) {
  const { timeoutMs = 5000, ...fetchOptions } = options || {};
  if (!fetchOptions.signal) fetchOptions.signal = AbortSignal.timeout(timeoutMs);
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, fetchOptions);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function isCdpEndpointOpen() {
  try {
    await cdpFetch('/json/version', { timeoutMs: 300 });
    return true;
  } catch {
    return false;
  }
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
    awaitPromise: true,
    returnByValue: true,
    expression,
  }, { timeoutMs: options.timeoutMs });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function dispatchMouseClick(ws, point) {
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function dispatchMouseDrag(ws, from, to) {
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 1,
  });
  await wsRequest(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

function normalizeUrlForWitness(value) {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

async function fetchServerRoots(baseUrl) {
  const resp = await fetch(new URL('/api/roots', baseUrl));
  const roots = await resp.json();
  if (!resp.ok || roots.error) {
    throw new Error(`server root identity unavailable: ${roots.error || resp.status}`);
  }
  return roots;
}

function assertExpectedServerRoot(roots) {
  const scenesPath = roots?.scenes?.path;
  if (!scenesPath) throw new Error('server root identity unavailable: missing scenes root');
  if (!isAbsolute(scenesPath)) throw new Error(`server root identity is not absolute: ${scenesPath}`);
  if (!expectedServerRoot) return;
  const effectiveServerRoot = resolve(scenesPath, '..');
  if (effectiveServerRoot !== expectedServerRoot) {
    throw new Error(`effective server root mismatch: expected ${expectedServerRoot} but server reported ${effectiveServerRoot}`);
  }
}

function assertClickedSelection(evidence, phaseLabel, clickedId, otherId) {
  const rows = evidence || [];
  const activeRows = rows.filter(row => row.active && row.pressed === 'true');
  if (activeRows.length !== 1) {
    throw new Error(`${phaseLabel} selection not exclusive: ${JSON.stringify(rows)}`);
  }
  if (activeRows[0].id !== clickedId) {
    throw new Error(`${phaseLabel} selection did not activate the clicked row: ${JSON.stringify({ clickedId, rows })}`);
  }
  const other = rows.find(row => row.id === otherId);
  if (!other || other.active || other.pressed !== 'false') {
    throw new Error(`${phaseLabel} selection did not deactivate other rows: ${JSON.stringify({ otherId, rows })}`);
  }
}

async function runSaveLoadRoundtripScenario(ws) {
  phase = 'scenario-save-load-roundtrip';
  lastEvidence.saveLoadRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async (name, label = 'saved') => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('cleanup did not delete saved scene file: ' + JSON.stringify({ savedFile: name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ savedFile: name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const groupState = () => window.kaminosSceneGroupDebugState?.() || [];
      const roundTransformValue = value => Number(Number(value || 0).toFixed(4));
      const normalizeTransform = transform => ({
        position: (transform?.position || []).map(roundTransformValue),
        rotation: (transform?.rotation || []).map(roundTransformValue),
        scale: (transform?.scale || []).map(roundTransformValue),
      });
      const transformMatches = (actual, expected, epsilon = 0.001) => {
        const normalizedActual = normalizeTransform(actual);
        const normalizedExpected = normalizeTransform(expected);
        for (const key of ['position', 'rotation', 'scale']) {
          if (normalizedActual[key].length !== 3 || normalizedExpected[key].length !== 3) return false;
          for (let i = 0; i < 3; i++) {
            if (Math.abs(normalizedActual[key][i] - normalizedExpected[key][i]) > epsilon) return false;
          }
        }
        return true;
      };
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');

      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('scene save setup did not start with one object row: ' + JSON.stringify(initialRows));

      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('scene save setup did not create two object rows: ' + JSON.stringify(appendedRows));
      if (new Set(appendedRows.map(row => row.id)).size !== 2) throw new Error('scene save setup rows were not unique: ' + JSON.stringify(appendedRows));

      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;
      if (typeof window.kaminosSetSceneObjectTransform !== 'function') {
        throw new Error('scene transform witness missing kaminosSetSceneObjectTransform');
      }
      if (typeof window.kaminosSceneObjectDebugState !== 'function') {
        throw new Error('scene transform witness missing kaminosSceneObjectDebugState');
      }
      const transformPlan = {
        [firstId]: {
          position: [-0.75, -0.23, 0.14],
          rotation: [0.11, 0.22, 0.33],
          scale: [0.82, 0.91, 1.07],
        },
        [secondId]: {
          position: [0.68, 0.18, -0.22],
          rotation: [0.04, -0.31, 0.18],
          scale: [1.18, 0.76, 0.94],
        },
      };
      window.kaminosSetSceneObjectTransform(firstId, transformPlan[firstId]);
      window.kaminosSetSceneObjectTransform(secondId, transformPlan[secondId]);
      const transformDebugBeforeSave = window.kaminosSceneObjectDebugState();
      const firstBeforeSave = transformDebugBeforeSave.find(object => object.id === firstId);
      const secondBeforeSave = transformDebugBeforeSave.find(object => object.id === secondId);
      if (!transformMatches(firstBeforeSave?.transform, transformPlan[firstId]) || !transformMatches(secondBeforeSave?.transform, transformPlan[secondId])) {
        throw new Error('scene transform witness could not set distinct object transforms: ' + JSON.stringify({ transformDebugBeforeSave, transformPlan }));
      }
      document.querySelector('[data-scene-object-id="' + firstId + '"]').click();
      await wait(250);
      const beforeSaveRows = rowState();
      const activeBeforeSave = beforeSaveRows.find(row => row.active && row.pressed === 'true')?.id || null;
      if (activeBeforeSave !== firstId) throw new Error('scene save setup did not activate first object before save: ' + JSON.stringify(beforeSaveRows));

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) {
        throw new Error('scene save did not create exactly one new scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      }
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      if (!Array.isArray(savedScene.objects) || savedScene.objects.length !== 2) {
        throw new Error('saved scene document did not persist two objects: ' + JSON.stringify(savedScene.objects));
      }
      const savedIds = savedScene.objects.map(object => object.id);
      if (!savedIds.includes(firstId) || !savedIds.includes(secondId)) {
        throw new Error('saved scene document ids did not match authored objects: ' + JSON.stringify({ savedIds, firstId, secondId }));
      }
      if (savedScene.activeObjectId !== firstId) {
        throw new Error('saved scene document did not preserve active object id: ' + JSON.stringify({ activeObjectId: savedScene.activeObjectId, firstId }));
      }
      const firstSavedObject = savedScene.objects.find(object => object.id === firstId);
      const secondSavedObject = savedScene.objects.find(object => object.id === secondId);
      if (!transformMatches(firstSavedObject?.transform, transformPlan[firstId]) || !transformMatches(secondSavedObject?.transform, transformPlan[secondId])) {
        throw new Error('saved scene document did not preserve distinct object transforms: ' + JSON.stringify({
          savedTransforms: savedScene.objects.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })),
          transformPlan,
        }));
      }
      const savedSources = savedScene.objects.map(object => object.source);
      if (!savedSources.every(source => source === 'demos/supermat-ring/')) {
        throw new Error('saved scene document did not preserve reloadable demo sources: ' + JSON.stringify(savedSources));
      }
      if (savedScene.volumePrimitives?.schema !== 'kaminos.volume-primitives.v0') {
        throw new Error('saved scene document did not preserve volume primitive schema: ' + JSON.stringify(savedScene.volumePrimitives));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();

      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredRows = rowState();
        const activeId = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
        const info = document.getElementById('info-bar').textContent.trim();
        if (restoredRows.length === 2 && activeId === firstId && info === 'Scene loaded: 2 objects') break;
        await wait(125);
      }
      const activeAfterLoad = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
      const infoAfterLoad = document.getElementById('info-bar').textContent.trim();
      const transformBarVisible = document.getElementById('transform-bar').classList.contains('visible');
      const restoredIds = restoredRows.map(row => row.id);
      if (restoredRows.length !== 2 || !restoredIds.includes(firstId) || !restoredIds.includes(secondId)) {
        throw new Error('scene load did not restore two object rows: ' + JSON.stringify({ restoredRows, firstId, secondId, infoAfterLoad }));
      }
      if (activeAfterLoad !== firstId) {
        throw new Error('scene load did not restore active object id: ' + JSON.stringify({ activeAfterLoad, firstId, restoredRows }));
      }
      if (!transformBarVisible) {
        throw new Error('scene load did not preserve transform toolbar: ' + JSON.stringify({ restoredRows, activeAfterLoad }));
      }
      const restoredTransformDebugState = window.kaminosSceneObjectDebugState();
      const firstAfterLoad = restoredTransformDebugState.find(object => object.id === firstId);
      const secondAfterLoad = restoredTransformDebugState.find(object => object.id === secondId);
      if (!transformMatches(firstAfterLoad?.transform, transformPlan[firstId]) || !transformMatches(secondAfterLoad?.transform, transformPlan[secondId])) {
        throw new Error('scene load did not restore distinct object transforms: ' + JSON.stringify({
          restoredTransformDebugState,
          transformPlan,
        }));
      }
      if (infoAfterLoad !== 'Scene loaded: 2 objects') {
        throw new Error('scene load did not report two loaded objects: ' + JSON.stringify({ infoAfterLoad }));
      }

      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      return {
        savedFile,
        firstId,
        secondId,
        beforeSaveRows,
        savedScene: {
          objectCount: savedScene.objects.length,
          objectIds: savedIds,
          objectSources: savedSources,
          activeObjectId: savedScene.activeObjectId,
          volumePrimitiveSchema: savedScene.volumePrimitives?.schema || null,
          objectTransforms: savedScene.objects.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })),
        },
        transformDebugBeforeSave,
        restoredRows,
        restoredTransformDebugState,
        activeAfterLoad,
        infoAfterLoad,
        transformBarVisible,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runTransformInspectorScenario(ws) {
  phase = 'scenario-transform-inspector';
  lastEvidence.transformInspector = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('transform inspector cleanup did not delete saved scene file: ' + JSON.stringify({ savedFile: name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('transform inspector post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ savedFile: name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const roundTransformValue = value => Number(Number(value || 0).toFixed(4));
      const normalizeTransform = transform => ({
        position: (transform?.position || []).map(roundTransformValue),
        rotation: (transform?.rotation || []).map(roundTransformValue),
        scale: (transform?.scale || []).map(roundTransformValue),
      });
      const transformMatches = (actual, expected, epsilon = 0.001) => {
        const normalizedActual = normalizeTransform(actual);
        const normalizedExpected = normalizeTransform(expected);
        for (const key of ['position', 'rotation', 'scale']) {
          if (normalizedActual[key].length !== 3 || normalizedExpected[key].length !== 3) return false;
          for (let i = 0; i < 3; i++) {
            if (Math.abs(normalizedActual[key][i] - normalizedExpected[key][i]) > epsilon) return false;
          }
        }
        return true;
      };
      const radians = degrees => degrees * Math.PI / 180;
      const inspectorTransformPlan = {
        position: [-0.42, 0.16, 0.24],
        rotation: [radians(12), radians(-18), radians(27)],
        scale: [1.15, 0.85, 1.05],
      };
      const fieldValuePlan = {
        'position.x': -0.42,
        'position.y': 0.16,
        'position.z': 0.24,
        'rotation.x': 12,
        'rotation.y': -18,
        'rotation.z': 27,
        'scale.x': 1.15,
        'scale.y': 0.85,
        'scale.z': 1.05,
      };
      const setInspectorValue = (field, value) => {
        const input = document.querySelector('[data-transform-field="' + field + '"]');
        if (!input) throw new Error('transform inspector field missing: ' + field);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const inspectorValues = () => Object.fromEntries([...document.querySelectorAll('[data-transform-field]')].map(input => [input.dataset.transformField, Number(input.value)]));

      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('transform inspector setup did not create two object rows: ' + JSON.stringify(appendedRows));
      if (typeof window.kaminosSceneObjectDebugState !== 'function') throw new Error('transform inspector witness missing kaminosSceneObjectDebugState');
      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;
      document.querySelector('[data-scene-object-id="' + firstId + '"]').click();
      await wait(250);
      const beforeEditDebug = window.kaminosSceneObjectDebugState();
      const secondBeforeEdit = beforeEditDebug.find(object => object.id === secondId)?.transform;
      if (!secondBeforeEdit) throw new Error('transform inspector setup could not capture second object transform: ' + JSON.stringify(beforeEditDebug));
      const inspector = document.getElementById('transform-inspector');
      if (!inspector) throw new Error('transform inspector panel missing');
      if (inspector.dataset.selectedObjectId !== firstId) {
        throw new Error('transform inspector did not bind to selected object: ' + JSON.stringify({ selectedObjectId: inspector.dataset.selectedObjectId, firstId, rows: rowState() }));
      }
      for (const [field, value] of Object.entries(fieldValuePlan)) setInspectorValue(field, value);
      await wait(250);
      const afterInspectorEditDebug = window.kaminosSceneObjectDebugState();
      const firstAfterEdit = afterInspectorEditDebug.find(object => object.id === firstId);
      const secondAfterEdit = afterInspectorEditDebug.find(object => object.id === secondId);
      if (!transformMatches(firstAfterEdit?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector did not update selected object transform: ' + JSON.stringify({ afterInspectorEditDebug, inspectorTransformPlan, inspectorValues: inspectorValues() }));
      }
      if (!transformMatches(secondAfterEdit?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector changed a non-selected object: ' + JSON.stringify({ secondBeforeEdit: normalizeTransform(secondBeforeEdit), secondAfterEdit: normalizeTransform(secondAfterEdit?.transform) }));
      }
      const infoAfterInspectorEdit = document.getElementById('info-bar').textContent.trim();
      if (!infoAfterInspectorEdit.includes('Transform updated')) {
        throw new Error('transform inspector did not report transform update: ' + JSON.stringify({ infoAfterInspectorEdit }));
      }

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) throw new Error('transform inspector save did not create exactly one new scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      const savedFirst = savedScene.objects?.find(object => object.id === firstId);
      const savedSecond = savedScene.objects?.find(object => object.id === secondId);
      if (!transformMatches(savedFirst?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector saved scene did not preserve edited transform: ' + JSON.stringify({ savedTransforms: savedScene.objects?.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })), inspectorTransformPlan }));
      }
      if (!transformMatches(savedSecond?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector saved scene mutated non-selected transform: ' + JSON.stringify({ savedSecond: normalizeTransform(savedSecond?.transform), secondBeforeEdit: normalizeTransform(secondBeforeEdit) }));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('transform inspector saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('transform inspector saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();
      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredRows = rowState();
        const restoredDebug = window.kaminosSceneObjectDebugState();
        const activeId = restoredRows.find(row => row.active && row.pressed === 'true')?.id || null;
        const firstRestored = restoredDebug.find(object => object.id === firstId);
        const info = document.getElementById('info-bar').textContent.trim();
        if (restoredRows.length === 2 && activeId === firstId && transformMatches(firstRestored?.transform, inspectorTransformPlan) && info === 'Scene loaded: 2 objects') break;
        await wait(125);
      }
      const restoredDebugState = window.kaminosSceneObjectDebugState();
      const restoredFirst = restoredDebugState.find(object => object.id === firstId);
      const restoredSecond = restoredDebugState.find(object => object.id === secondId);
      if (!transformMatches(restoredFirst?.transform, inspectorTransformPlan)) {
        throw new Error('transform inspector load did not restore edited transform: ' + JSON.stringify({ restoredDebugState, inspectorTransformPlan }));
      }
      if (!transformMatches(restoredSecond?.transform, secondBeforeEdit)) {
        throw new Error('transform inspector load mutated non-selected transform: ' + JSON.stringify({ restoredSecond: normalizeTransform(restoredSecond?.transform), secondBeforeEdit: normalizeTransform(secondBeforeEdit) }));
      }
      document.querySelector('[data-tab="assets"]').click();
      await wait(250);
      if (document.getElementById('transform-inspector')?.dataset.selectedObjectId !== firstId) {
        throw new Error('transform inspector did not rebind after scene load: ' + JSON.stringify({ selectedObjectId: document.getElementById('transform-inspector')?.dataset.selectedObjectId, firstId, restoredRows }));
      }
      const restoredInspectorValues = inspectorValues();
      if (Math.abs(restoredInspectorValues['rotation.x'] - 12) > 0.01 || Math.abs(restoredInspectorValues['rotation.y'] + 18) > 0.01 || Math.abs(restoredInspectorValues['rotation.z'] - 27) > 0.01) {
        throw new Error('transform inspector did not display restored rotation degrees: ' + JSON.stringify({ restoredInspectorValues }));
      }
      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      return {
        savedFile,
        firstId,
        secondId,
        inspectorValuesAfterEdit: inspectorValues(),
        afterInspectorEditDebug,
        savedScene: {
          objectCount: savedScene.objects?.length || 0,
          objectTransforms: savedScene.objects?.map(object => ({ id: object.id, transform: normalizeTransform(object.transform) })) || [],
        },
        restoredRows,
        restoredDebugState,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runObjectGroupsRoundtripScenario(ws) {
  phase = 'scenario-object-groups-roundtrip';
  lastEvidence.objectGroupsRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) throw new Error('cleanup did not delete saved scene file: ' + JSON.stringify({ name, cleanup }));
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) throw new Error('post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ name, postCleanupFiles }));
        return { cleanup, postCleanupFiles };
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        grouped: row.classList.contains('grouped'),
      }));
      const groupRows = () => [...document.querySelectorAll('[data-scene-group-id]')].map(row => ({
        id: row.dataset.sceneGroupId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-group-name]')?.value?.trim() || row.querySelector('.scene-group-name')?.textContent?.trim() || null,
      }));
      const waitForRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const setInputValue = (selector, value) => {
        const input = document.querySelector(selector);
        if (!input) throw new Error('outliner input missing: ' + selector);
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      for (let i = 0; i < 80; i++) {
        if (document.querySelectorAll('[data-scene-object-id]').length === 1) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('object grouping setup did not start with one object row: ' + JSON.stringify(initialRows));
      const append = document.getElementById('append-import-toggle');
      if (!append) throw new Error('append import toggle missing');
      append.checked = true;
      demo.click();
      const appendedRows = await waitForRows(2);
      if (appendedRows.length !== 2) throw new Error('object grouping setup did not create two object rows: ' + JSON.stringify(appendedRows));
      const firstId = appendedRows[0].id;
      const secondId = appendedRows[1].id;

      setInputValue('[data-scene-object-name="' + firstId + '"]', 'Key Ring');
      setInputValue('[data-scene-object-name="' + secondId + '"]', 'Fill Ring');
      await wait(200);
      const renamedRows = rowState();
      if (!renamedRows.some(row => row.id === firstId && row.label === 'Key Ring') || !renamedRows.some(row => row.id === secondId && row.label === 'Fill Ring')) {
        throw new Error('object grouping did not preserve renamed object labels: ' + JSON.stringify(renamedRows));
      }
      if (typeof window.createSceneGroupForObjects !== 'function' || typeof window.kaminosSceneGroupDebugState !== 'function') {
        throw new Error('object grouping debug/create API missing');
      }
      const group = window.createSceneGroupForObjects([firstId, secondId], 'Lighting Pair');
      await wait(250);
      if (!group?.id) throw new Error('object grouping did not create a group record');
      const createdGroupRows = groupRows();
      if (createdGroupRows.length !== 1 || createdGroupRows[0].label !== 'Lighting Pair') {
        throw new Error('object grouping did not create a group row: ' + JSON.stringify(createdGroupRows));
      }
      setInputValue('[data-scene-group-name="' + group.id + '"]', 'Hero Pair');
      await wait(200);
      const renamedGroups = groupRows();
      if (renamedGroups.length !== 1 || renamedGroups[0].label !== 'Hero Pair') {
        throw new Error('object grouping did not preserve renamed group label: ' + JSON.stringify(renamedGroups));
      }
      document.querySelector('[data-scene-group-id="' + group.id + '"]').click();
      await wait(250);
      const groupSelectionRows = groupRows();
      const transformBarVisibleAfterGroup = document.getElementById('transform-bar').classList.contains('visible');
      const inspector = document.getElementById('transform-inspector');
      const inspectorFields = document.getElementById('transform-inspector-fields');
      const inspectorFieldsVisible = !!inspectorFields
        && !inspectorFields.hidden
        && getComputedStyle(inspectorFields).display !== 'none'
        && inspectorFields.getBoundingClientRect().height > 0;
      if (!groupSelectionRows[0]?.active || groupSelectionRows[0]?.pressed !== 'true') {
        throw new Error('object grouping did not select group row: ' + JSON.stringify(groupSelectionRows));
      }
      if (transformBarVisibleAfterGroup || inspectorFieldsVisible || inspector?.dataset?.selectedObjectId) {
        throw new Error('group selection did not hide object transform controls: ' + JSON.stringify({
          transformBarVisibleAfterGroup,
          inspectorFieldsHidden: inspectorFields?.hidden ?? null,
          inspectorFieldsDisplay: inspectorFields ? getComputedStyle(inspectorFields).display : null,
          inspectorFieldsHeight: inspectorFields?.getBoundingClientRect?.().height ?? null,
          selectedObjectId: inspector?.dataset?.selectedObjectId || null,
          selectedGroupId: inspector?.dataset?.selectedGroupId || null,
        }));
      }

      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let newFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) break;
        await wait(125);
      }
      if (newFiles.length !== 1) throw new Error('object grouping save did not create exactly one scene file: ' + JSON.stringify({ newFiles, before: [...beforeSceneFiles] }));
      const savedFile = newFiles[0];
      const savedScene = await readScene(savedFile);
      const savedGroup = savedScene.groups?.find(saved => saved.id === group.id);
      if (!savedGroup || savedGroup.label !== 'Hero Pair' || savedGroup.objectIds.length !== 2 || !savedGroup.objectIds.includes(firstId) || !savedGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping saved scene did not preserve group membership: ' + JSON.stringify(savedScene.groups));
      }
      if (savedScene.activeGroupId !== group.id) {
        throw new Error('object grouping saved scene did not preserve active group: ' + JSON.stringify({ activeGroupId: savedScene.activeGroupId, groupId: group.id }));
      }
      const savedLabels = savedScene.objects.map(object => [object.id, object.label]);
      if (!savedLabels.some(([id, label]) => id === firstId && label === 'Key Ring') || !savedLabels.some(([id, label]) => id === secondId && label === 'Fill Ring')) {
        throw new Error('object grouping saved scene did not preserve object labels: ' + JSON.stringify(savedLabels));
      }

      document.querySelector('[data-tab="greenroom"]').click();
      let sceneEntry = null;
      for (let i = 0; i < 120; i++) {
        sceneEntry = [...document.querySelectorAll('#scenes-list .gr-entry')].find(entry => (
          entry.querySelector('.gr-name')?.textContent?.trim() === savedFile.replace('.kaminos.json', '')
        ));
        if (sceneEntry) break;
        await wait(125);
      }
      if (!sceneEntry) throw new Error('object grouping saved scene did not appear in scene list: ' + savedFile);
      const loadButton = [...sceneEntry.querySelectorAll('button')].find(button => button.textContent.trim() === 'Load');
      if (!loadButton) throw new Error('object grouping saved scene list entry missing Load button: ' + savedFile);
      loadButton.click();
      let restoredGroups = [];
      let restoredRows = [];
      for (let i = 0; i < 160; i++) {
        restoredGroups = window.kaminosSceneGroupDebugState?.() || [];
        restoredRows = rowState();
        if (restoredGroups.length === 1 && restoredRows.length === 2 && restoredGroups[0].label === 'Hero Pair') break;
        await wait(125);
      }
      const restoredGroup = restoredGroups[0];
      if (!restoredGroup || restoredGroup.label !== 'Hero Pair' || restoredGroup.objectIds.length !== 2 || !restoredGroup.objectIds.includes(firstId) || !restoredGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping load did not restore group membership: ' + JSON.stringify({ restoredGroups, restoredRows }));
      }
      if (!restoredGroup.active || document.getElementById('transform-bar').classList.contains('visible')) {
        throw new Error('object grouping load did not restore active group selection: ' + JSON.stringify({
          restoredGroups,
          transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
        }));
      }
      if (!restoredRows.every(row => row.grouped) || !restoredRows.some(row => row.label === 'Key Ring') || !restoredRows.some(row => row.label === 'Fill Ring')) {
        throw new Error('object grouping load did not restore grouped renamed rows: ' + JSON.stringify(restoredRows));
      }

      document.querySelector('[data-tab="assets"]').click();
      const { cleanup, postCleanupFiles } = await assertSceneDeleted(savedFile);
      window.selectSceneGroup(group.id);
      await wait(250);
      const finalGroups = groupRows();
      const finalRows = rowState();
      if (!finalGroups.some(row => row.id === group.id && row.active && row.label === 'Hero Pair') || !finalRows.every(row => row.grouped)) {
        throw new Error('object grouping final screenshot state lost group membership: ' + JSON.stringify({ finalGroups, finalRows }));
      }
      window.removeSceneObject(firstId);
      await wait(250);
      const groupsAfterMemberRemoval = groupRows();
      const rowsAfterMemberRemoval = rowState();
      const groupDebugAfterMemberRemoval = window.kaminosSceneGroupDebugState?.() || [];
      const survivingGroup = groupDebugAfterMemberRemoval.find(record => record.id === group.id);
      if (!groupsAfterMemberRemoval.some(row => row.id === group.id && row.active && row.pressed === 'true')) {
        throw new Error('object grouping active group selection was cleared by member removal: ' + JSON.stringify({
          groupsAfterMemberRemoval,
          groupDebugAfterMemberRemoval,
          rowsAfterMemberRemoval,
        }));
      }
      if (!survivingGroup || !survivingGroup.active || survivingGroup.objectIds.length !== 1 || !survivingGroup.objectIds.includes(secondId)) {
        throw new Error('object grouping member removal did not preserve pruned active group membership: ' + JSON.stringify({
          survivingGroup,
          groupDebugAfterMemberRemoval,
          rowsAfterMemberRemoval,
        }));
      }
      return {
        savedFile,
        firstId,
        secondId,
        groupId: group.id,
        renamedRows,
        renamedGroups,
        groupSelectionRows,
        savedGroup,
        savedLabels,
        restoredGroups,
        restoredRows,
        finalGroups,
        finalRows,
        groupsAfterMemberRemoval,
        rowsAfterMemberRemoval,
        groupDebugAfterMemberRemoval,
        cleanup,
        postCleanupFileCount: postCleanupFiles.length,
      };
    })()
  `, { timeoutMs: 60000 });
}

async function runSceneBoundaryRoundtripScenario(ws) {
  phase = 'scenario-scene-boundary-roundtrip';
  lastEvidence.sceneBoundaryRoundtrip = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const schema = 'kaminos.volume-primitives.v0';
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const assertSceneDeleted = async name => {
        const cleanup = await deleteScene(name);
        if (cleanup.deleted !== name) {
          throw new Error('boundary cleanup did not delete scene file: ' + JSON.stringify({ name, cleanup }));
        }
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('post-cleanup scene listing still includes boundary scene file: ' + JSON.stringify({ name, postCleanupFiles }));
        }
        return { cleanup, postCleanupFiles };
      };
      const saveFixtureToServer = async doc => {
        const resp = await fetch('/api/save-scene', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(doc),
        });
        const data = await resp.json();
        if (!resp.ok || data.error || !data.saved) throw new Error('fixture scene save failed: ' + JSON.stringify(data));
        return data.saved;
      };
      const loadSceneDocument = async (doc, name) => {
        const input = document.getElementById('scene-file-input');
        const file = new File([JSON.stringify(doc)], name, { type: 'application/json' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const waitForInfo = async expected => {
        let info = '';
        for (let i = 0; i < 160; i++) {
          info = document.getElementById('info-bar').textContent.trim();
          if (info === expected) return info;
          await wait(125);
        }
        return info;
      };
      const saveSceneAsAndRead = async () => {
        const before = new Set(await listScenes());
        const saved = await window.saveSceneAs();
        if (!saved) throw new Error('scene boundary save-as did not report success');
        let newFiles = [];
        for (let i = 0; i < 120; i++) {
          const after = await listScenes();
          newFiles = after.filter(name => !before.has(name));
          if (newFiles.length === 1) break;
          await wait(125);
        }
        if (newFiles.length !== 1) throw new Error('scene boundary save-as did not create exactly one file: ' + JSON.stringify({ newFiles, before: [...before] }));
        return { savedFile: newFiles[0], savedScene: await readScene(newFiles[0]) };
      };

      for (let i = 0; i < 80; i++) {
        if (rowState().length === 1) break;
        await wait(125);
      }
      const initialRows = rowState();
      if (initialRows.length !== 1) throw new Error('scene boundary setup did not start with one default object row: ' + JSON.stringify(initialRows));

      const timestamp = new Date().toISOString();
      const volumeScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp,
        objects: [],
        activeObjectId: null,
        model: null,
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'boundary-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [0, -0.74, 0], rotation: [0, 0, 0], scale: [0.12, 0.12, 0.12] },
            simulation: { sourceRadius: 0.12, flowRate: 0.15, vorticity: 2.65 },
          }],
        },
      };
      await loadSceneDocument(volumeScene, 'boundary-volume.kaminos.json');
      const volumeInfo = await waitForInfo('Volume scene loaded');
      const rowsAfterVolume = rowState();
      const toolbarAfterVolume = document.getElementById('transform-bar').classList.contains('visible');
      if (rowsAfterVolume.length !== 0 || toolbarAfterVolume) {
        throw new Error('scene load did not clear stale object rows for volume-only scene: ' + JSON.stringify({ rowsAfterVolume, toolbarAfterVolume, volumeInfo }));
      }
      const volumeSave = await saveSceneAsAndRead();
      if ((volumeSave.savedScene.objects || []).length !== 0) {
        throw new Error('volume-only save after load retained stale objects: ' + JSON.stringify(volumeSave.savedScene.objects));
      }
      if (volumeSave.savedScene.volumePrimitives?.primitives?.length !== 1) {
        throw new Error('volume-only save after load did not retain volume primitive: ' + JSON.stringify(volumeSave.savedScene.volumePrimitives));
      }
      const volumeCleanup = await assertSceneDeleted(volumeSave.savedFile);

      const localPreviewScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'failed-local-preview-object',
          source: 'material-preview',
          type: 'pbr',
          fileName: 'Failed Local Preview',
          label: 'Failed Local Preview',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'failed-local-preview-object',
        model: { source: 'material-preview', type: 'pbr', fileName: 'Failed Local Preview' },
        volumePrimitives: { schema, primitives: [] },
      };
      const localPreviewFile = await saveFixtureToServer(localPreviewScene);
      await loadSceneDocument(localPreviewScene, localPreviewFile);
      let failedInfo = '';
      for (let i = 0; i < 120; i++) {
        failedInfo = document.getElementById('info-bar').textContent.trim();
        if (failedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!failedInfo.startsWith('Scene load failed:')) {
        throw new Error('local-preview scene load did not fail as expected: ' + failedInfo);
      }
      const protectedSave = await window.saveScene();
      if (protectedSave !== false) {
        throw new Error('failed local-preview scene load did not protect save target: ' + JSON.stringify({ protectedSave, failedInfo }));
      }
      const localPreviewAfterSaveAttempt = await readScene(localPreviewFile);
      if (localPreviewAfterSaveAttempt.objects?.[0]?.source !== 'material-preview') {
        throw new Error('failed local-preview scene load overwrote its source file: ' + JSON.stringify(localPreviewAfterSaveAttempt.objects));
      }
      const localPreviewCleanup = await assertSceneDeleted(localPreviewFile);

      const previousScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [],
        activeObjectId: null,
        model: null,
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'previous-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [0.4, -0.74, 0], rotation: [0, 0, 0], scale: [0.08, 0.08, 0.08] },
            simulation: { sourceRadius: 0.08, flowRate: 0.08, vorticity: 1.25 },
          }],
        },
      };
      const previousFile = await saveFixtureToServer(previousScene);
      await loadSceneDocument(previousScene, previousFile);
      await waitForInfo('Volume scene loaded');
      const previousBeforeMixedFailure = await readScene(previousFile);

      const mixedFailedScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'mixed-failed-local-preview-object',
          source: 'material-preview',
          type: 'pbr',
          fileName: 'Mixed Failed Local Preview',
          label: 'Mixed Failed Local Preview',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'mixed-failed-local-preview-object',
        model: { source: 'material-preview', type: 'pbr', fileName: 'Mixed Failed Local Preview' },
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'failed-mixed-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [-0.4, -0.74, 0], rotation: [0, 0, 0], scale: [0.16, 0.16, 0.16] },
            simulation: { sourceRadius: 0.16, flowRate: 0.22, vorticity: 3.1 },
          }],
        },
      };
      await loadSceneDocument(mixedFailedScene, 'mixed-failed-local-preview.kaminos.json');
      let mixedFailedInfo = '';
      for (let i = 0; i < 120; i++) {
        mixedFailedInfo = document.getElementById('info-bar').textContent.trim();
        if (mixedFailedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!mixedFailedInfo.startsWith('Scene load failed:')) {
        throw new Error('mixed failed scene load did not fail as expected: ' + mixedFailedInfo);
      }
      const mixedProtectedSave = await window.saveScene();
      if (mixedProtectedSave !== false) {
        throw new Error('mixed failed scene load did not protect previous save target: ' + JSON.stringify({ mixedProtectedSave, mixedFailedInfo }));
      }
      const previousAfterMixedFailure = await readScene(previousFile);
      if (JSON.stringify(previousAfterMixedFailure.volumePrimitives) !== JSON.stringify(previousBeforeMixedFailure.volumePrimitives)) {
        throw new Error('mixed failed scene load overwrote previous save target: ' + JSON.stringify({ previousBeforeMixedFailure, previousAfterMixedFailure }));
      }
      const mixedCleanup = await assertSceneDeleted(previousFile);

      const actualFailurePreviousFile = await saveFixtureToServer(previousScene);
      await loadSceneDocument(previousScene, actualFailurePreviousFile);
      await waitForInfo('Volume scene loaded');
      const actualFailurePreviousBefore = await readScene(actualFailurePreviousFile);
      const missingDemoMixedScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'missing-demo-object',
          source: 'demos/missing/',
          type: 'pbr',
          fileName: 'Missing Demo Object',
          label: 'Missing Demo Object',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'missing-demo-object',
        model: { source: 'demos/missing/', type: 'pbr', fileName: 'Missing Demo Object' },
        volumePrimitives: {
          schema,
          primitives: [{
            id: 'actual-load-failed-volume',
            kind: 'fire_smoke',
            shape: 'sphere',
            transform: { position: [-0.2, -0.74, 0.2], rotation: [0, 0, 0], scale: [0.2, 0.2, 0.2] },
            simulation: { sourceRadius: 0.2, flowRate: 0.3, vorticity: 3.6 },
          }],
        },
      };
      await loadSceneDocument(missingDemoMixedScene, 'mixed-missing-demo.kaminos.json');
      let missingDemoFailedInfo = '';
      for (let i = 0; i < 120; i++) {
        missingDemoFailedInfo = document.getElementById('info-bar').textContent.trim();
        if (missingDemoFailedInfo.startsWith('Scene load failed:')) break;
        await wait(125);
      }
      if (!missingDemoFailedInfo.startsWith('Scene load failed:')) {
        throw new Error('syntactically reloadable mixed scene load did not fail as expected: ' + missingDemoFailedInfo);
      }
      const goodDemo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!goodDemo) throw new Error('SuperMat Ring demo button missing for actual failure recovery');
      goodDemo.click();
      for (let i = 0; i < 120; i++) {
        if (rowState().length === 1 && rowState()[0].label === 'SuperMat Ring') break;
        await wait(125);
      }
      const postFailureImportRows = rowState();
      if (postFailureImportRows.length !== 1 || postFailureImportRows[0].label !== 'SuperMat Ring') {
        throw new Error('normal import after syntactically reloadable failure did not recover one good row: ' + JSON.stringify(postFailureImportRows));
      }
      const beforePostFailureImportSaveFiles = new Set(await listScenes());
      await window.saveScene();
      let postFailureImportSavedFiles = [];
      for (let i = 0; i < 120; i++) {
        const afterFiles = await listScenes();
        postFailureImportSavedFiles = afterFiles.filter(name => !beforePostFailureImportSaveFiles.has(name));
        if (postFailureImportSavedFiles.length <= 1) break;
        await wait(125);
      }
      const actualFailurePreviousAfter = await readScene(actualFailurePreviousFile);
      if (JSON.stringify(actualFailurePreviousAfter.volumePrimitives) !== JSON.stringify(actualFailurePreviousBefore.volumePrimitives)) {
        throw new Error('syntactically reloadable failed scene load overwrote previous save target after import: ' + JSON.stringify({ actualFailurePreviousBefore, actualFailurePreviousAfter }));
      }
      if ((actualFailurePreviousAfter.objects || []).length !== (actualFailurePreviousBefore.objects || []).length) {
        throw new Error('syntactically reloadable failed scene load changed previous scene objects after import: ' + JSON.stringify({ actualFailurePreviousBefore, actualFailurePreviousAfter }));
      }
      for (const generatedFile of postFailureImportSavedFiles) {
        if (generatedFile !== actualFailurePreviousFile) await assertSceneDeleted(generatedFile);
      }
      const actualFailureCleanup = await assertSceneDeleted(actualFailurePreviousFile);

      const objectScene = {
        schema: 'kaminos.scene.v1',
        version: 3,
        timestamp: new Date().toISOString(),
        objects: [{
          id: 'boundary-object',
          source: 'demos/supermat-ring/',
          type: 'pbr',
          fileName: 'Boundary Object',
          label: 'Boundary Object',
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          materials: { side: 0, transparent: false, opacity: 1 },
        }],
        activeObjectId: 'boundary-object',
        model: { source: 'demos/supermat-ring/', type: 'pbr', fileName: 'Boundary Object' },
        volumePrimitives: { schema, primitives: [] },
      };
      await loadSceneDocument(objectScene, 'boundary-object.kaminos.json');
      const objectInfo = await waitForInfo('Scene loaded: 1 object');
      const rowsAfterObject = rowState();
      if (rowsAfterObject.length !== 1 || rowsAfterObject[0].id !== 'boundary-object') {
        throw new Error('scene boundary object-only load did not restore one expected row: ' + JSON.stringify({ rowsAfterObject, objectInfo }));
      }
      const objectSave = await saveSceneAsAndRead();
      if (objectSave.savedScene.volumePrimitives?.primitives?.length !== 0) {
        throw new Error('scene load did not clear stale volume primitives for object-only scene: ' + JSON.stringify(objectSave.savedScene.volumePrimitives));
      }
      const objectCleanup = await assertSceneDeleted(objectSave.savedFile);

      document.querySelector('[data-tab="assets"]').click();
      return {
        initialRows,
        rowsAfterVolume,
        toolbarAfterVolume,
        volumeInfo,
        volumeSavedObjectCount: (volumeSave.savedScene.objects || []).length,
        volumeSavedPrimitiveCount: volumeSave.savedScene.volumePrimitives?.primitives?.length || 0,
        volumeCleanupDeleted: volumeCleanup.cleanup.deleted,
        failedLocalPreviewInfo: failedInfo,
        failedLocalPreviewProtectedSave: protectedSave,
        localPreviewCleanupDeleted: localPreviewCleanup.cleanup.deleted,
        mixedFailedInfo,
        mixedProtectedSave,
        mixedPreviousPrimitiveIds: previousAfterMixedFailure.volumePrimitives?.primitives?.map(primitive => primitive.id) || [],
        mixedCleanupDeleted: mixedCleanup.cleanup.deleted,
        missingDemoFailedInfo,
        postFailureImportRows,
        postFailureImportSavedFiles,
        actualFailurePreviousPrimitiveIds: actualFailurePreviousAfter.volumePrimitives?.primitives?.map(primitive => primitive.id) || [],
        actualFailureCleanupDeleted: actualFailureCleanup.cleanup.deleted,
        rowsAfterObject,
        objectInfo,
        objectSavedPrimitiveCount: objectSave.savedScene.volumePrimitives?.primitives?.length || 0,
        objectCleanupDeleted: objectCleanup.cleanup.deleted,
      };
    })()
  `, { timeoutMs: 90000 });
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
      if (initialRows.length !== 1) {
        throw new Error('default replace did not start from exactly one row: ' + JSON.stringify({ rowCount: initialRows.length, ids: initialIds }));
      }
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
  assertClickedSelection(
    lastEvidence.appendSelection.afterFirst,
    'first',
    lastEvidence.appendSelection.firstId,
    lastEvidence.appendSelection.secondId,
  );
  assertClickedSelection(
    lastEvidence.appendSelection.afterSecond,
    'second',
    lastEvidence.appendSelection.secondId,
    lastEvidence.appendSelection.firstId,
  );
  if (!lastEvidence.appendSelection.transformBarVisible) {
    throw new Error(`append selection did not preserve transform toolbar: ${JSON.stringify(lastEvidence.appendSelection)}`);
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
  if (!lastEvidence.mouseRemove.info.startsWith('Removed:')) {
    throw new Error(`mouse remove did not report removal: ${JSON.stringify(lastEvidence.mouseRemove)}`);
  }
  if (!lastEvidence.mouseRemove.transformBarVisible) {
    throw new Error(`mouse remove did not preserve transform toolbar: ${JSON.stringify(lastEvidence.mouseRemove)}`);
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
  if (!lastEvidence.keyboardRemove.transformBarVisible) {
    throw new Error(`keyboard remove did not preserve transform toolbar: ${JSON.stringify(lastEvidence.keyboardRemove)}`);
  }
}

async function runViewportClickSelectDeselectScenario(ws) {
  phase = 'scenario-viewport-click-select-deselect';
  lastEvidence.viewportClickSelectionSetup = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
      const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
      if (!demo) throw new Error('SuperMat Ring demo button missing');
      document.getElementById('append-import-toggle').checked = false;
      for (let i = 0; i < 120; i++) {
        const rows = rowState();
        if (rows.length === 1 && rows[0].active && rows[0].pressed === 'true') break;
        await wait(125);
      }
      if (rowState().length !== 1) {
        demo.click();
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === 1 && rows[0].active && rows[0].pressed === 'true') break;
          await wait(125);
        }
      }
      const rows = rowState();
      const canvas = document.querySelector('#viewport canvas');
      if (!canvas) throw new Error('viewport canvas missing');
      const rect = canvas.getBoundingClientRect();
      return {
        rows,
        selectedId: rows.find(row => row.active && row.pressed === 'true')?.id || null,
        transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
        emptyPoint: {
          x: Math.round(rect.left + rect.width * 0.88),
          y: Math.round(rect.top + rect.height * 0.76),
        },
        objectPoint: {
          x: Math.round(rect.left + rect.width * 0.52),
          y: Math.round(rect.top + rect.height * 0.52),
        },
      };
    })()
  `);
  if (lastEvidence.viewportClickSelectionSetup.rows.length !== 1 || !lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport click selection setup did not create one selected object: ${JSON.stringify(lastEvidence.viewportClickSelectionSetup)}`);
  }
  if (!lastEvidence.viewportClickSelectionSetup.transformBarVisible) {
    throw new Error(`viewport click selection setup did not show transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionSetup)}`);
  }

  const dragStart = lastEvidence.viewportClickSelectionSetup.emptyPoint;
  const dragEnd = {
    x: dragStart.x + 24,
    y: dragStart.y + 18,
  };
  await dispatchMouseDrag(ws, dragStart, dragEnd);
  await delay(600);
  lastEvidence.viewportClickSelectionAfterDrag = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const dragActiveRows = lastEvidence.viewportClickSelectionAfterDrag.rows.filter(row => row.active && row.pressed === 'true');
  if (dragActiveRows.length !== 1 || dragActiveRows[0].id !== lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport drag changed scene object selection: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }
  if (!lastEvidence.viewportClickSelectionAfterDrag.transformBarVisible) {
    throw new Error(`viewport drag hid transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }
  if (lastEvidence.viewportClickSelectionAfterDrag.info === 'Selection cleared') {
    throw new Error(`viewport drag reported selection cleared: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterDrag)}`);
  }

  await dispatchMouseClick(ws, lastEvidence.viewportClickSelectionSetup.emptyPoint);
  await delay(600);
  lastEvidence.viewportClickSelectionAfterEmpty = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const emptyActiveRows = lastEvidence.viewportClickSelectionAfterEmpty.rows.filter(row => row.active || row.pressed === 'true');
  if (emptyActiveRows.length !== 0) {
    throw new Error(`viewport empty click did not deselect scene object: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterEmpty)}`);
  }
  if (lastEvidence.viewportClickSelectionAfterEmpty.transformBarVisible) {
    throw new Error(`viewport empty click did not hide transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterEmpty)}`);
  }

  await dispatchMouseClick(ws, lastEvidence.viewportClickSelectionSetup.objectPoint);
  await delay(800);
  lastEvidence.viewportClickSelectionAfterObject = await evaluate(ws, `
    (() => ({
      rows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
      })),
      transformBarVisible: document.getElementById('transform-bar').classList.contains('visible'),
      info: document.getElementById('info-bar').textContent.trim(),
    }))()
  `);
  const objectActiveRows = lastEvidence.viewportClickSelectionAfterObject.rows.filter(row => row.active && row.pressed === 'true');
  if (objectActiveRows.length !== 1 || objectActiveRows[0].id !== lastEvidence.viewportClickSelectionSetup.selectedId) {
    throw new Error(`viewport object click did not select scene object: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterObject)}`);
  }
  if (!lastEvidence.viewportClickSelectionAfterObject.transformBarVisible) {
    throw new Error(`viewport object click did not restore transform toolbar: ${JSON.stringify(lastEvidence.viewportClickSelectionAfterObject)}`);
  }
}

async function runGreenroomPickerDisplayScenario(ws) {
  phase = 'scenario-greenroom-picker-display';
  lastEvidence.greenroomPickerDisplay = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const groupState = () => window.kaminosSceneGroupDebugState?.() || [];
      const infoText = () => document.getElementById('info-bar')?.textContent?.trim() || '';
      const previewState = () => {
        const panel = document.getElementById('greenroom-preview-controls');
        const importButton = document.querySelector('[data-greenroom-preview-action="import"]');
        return {
          active: !!window.greenroomPreviewIsActive?.(),
          visible: !!panel && !panel.hidden,
          title: document.getElementById('greenroom-preview-title')?.textContent?.trim() || null,
          source: document.getElementById('greenroom-preview-source')?.textContent?.trim() || null,
          importDisabled: importButton ? importButton.disabled : null,
          actions: [...document.querySelectorAll('[data-greenroom-preview-action]')].map(button => button.textContent.trim()),
        };
      };
      const previewDebug = () => window.greenroomPreviewDebugState?.() || {};
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const waitForPreviewActive = async active => {
        for (let i = 0; i < 120; i++) {
          const state = previewState();
          if (state.active === active && state.visible === active) return state;
          await wait(125);
        }
        return previewState();
      };
      const waitForPreviewObject = async route => {
        for (let i = 0; i < 160; i++) {
          const state = previewState();
          const debug = previewDebug();
          if (state.active && state.visible && !state.importDisabled
            && debug.previewObjectInScene
            && debug.previewObjectSource?.includes(route)) {
            return { state, debug };
          }
          await wait(125);
        }
        return { state: previewState(), debug: previewDebug() };
      };
      const sameRows = (a, b) => JSON.stringify(a.map(row => [row.id, row.label, row.source, row.active, row.pressed]))
        === JSON.stringify(b.map(row => [row.id, row.label, row.source, row.active, row.pressed]));
      const ensureBaseObject = async () => {
        if (rowState().length) return rowState();
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('SuperMat Ring demo button missing');
        demo.click();
        return waitForSceneRows(1);
      };
      const setupRows = await ensureBaseObject();
      const beforeSceneFiles = new Set(await listScenes());
      await window.saveSceneAs();
      let savedFile = null;
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        const newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) {
          savedFile = newFiles[0];
          break;
        }
        await wait(125);
      }
      if (!savedFile) throw new Error('greenroom View setup did not create a saved scene target');
      const savedBeforeView = await readScene(savedFile);

      document.querySelector('[data-tab="greenroom"]').click();
      let rows = [];
      for (let i = 0; i < 80; i++) {
        rows = [...document.querySelectorAll('#greenroom-list .gr-entry')];
        if (rows.length) break;
        await wait(125);
      }
      const greenroomRawName = value => String(value || '').trim().replace(/^raw\\s+/i, '');
      const greenroomIdentityKey = value => greenroomRawName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const grRowState = rows.map(row => {
        const title = row.querySelector('.gr-title')?.textContent?.trim() || null;
        const raw = row.querySelector('.gr-raw')?.textContent?.trim() || null;
        const rawName = greenroomRawName(raw);
        const titleIdentityKey = greenroomIdentityKey(title);
        const rawIdentityKey = greenroomIdentityKey(raw);
        return {
          title,
          subtitle: row.querySelector('.gr-subtitle')?.textContent?.trim() || null,
          raw,
          rawName,
          titleIdentityKey,
          rawIdentityKey,
          status: row.querySelector('.gr-status')?.textContent?.trim() || null,
          buttons: [...row.querySelectorAll('button')].map(button => button.textContent.trim()),
        };
      });
      const humaneRows = grRowState.filter(row => row.title && row.raw && row.titleIdentityKey !== row.rawIdentityKey);
      const loadRow = grRowState.find(row => row.rawName && row.buttons.includes('View') && row.buttons.includes('Import'));
      let loadProbe = null;
      if (loadRow) {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(loadRow.rawName));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const mesh = (outputsData.entries || []).find(entry => /\\.(glb|gltf|obj)$/i.test(entry.name));
        loadProbe = {
          jobId: loadRow.rawName,
          outputsStatus: outputsResp.status,
          outputsOk: outputsResp.ok,
          outputsError: outputsData.error || null,
          mesh: mesh?.name || null,
          route: mesh ? '/api/job-output?job_id=' + encodeURIComponent(loadRow.rawName) + '&file=' + encodeURIComponent(mesh.name) : null,
          outputStatus: null,
          outputOk: false,
          outputContentType: null,
          outputBytes: 0,
        };
        if (mesh) {
          const outputResp = await fetch(loadProbe.route);
          const outputBuffer = await outputResp.arrayBuffer();
          loadProbe.outputStatus = outputResp.status;
          loadProbe.outputOk = outputResp.ok;
          loadProbe.outputContentType = outputResp.headers.get('content-type');
          loadProbe.outputBytes = outputBuffer.byteLength;
        }
      }
      const actionRow = [...document.querySelectorAll('#greenroom-list .gr-entry')]
        .find(row => row.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() === loadRow?.rawName);
      const viewButton = actionRow ? [...actionRow.querySelectorAll('button')].find(button => button.textContent.trim() === 'View') : null;
      const importButton = actionRow ? [...actionRow.querySelectorAll('button')].find(button => button.textContent.trim() === 'Import') : null;
      if (viewButton) {
        viewButton.click();
        await waitForPreviewActive(true);
        await waitForPreviewObject(loadProbe?.route);
      }
      const afterViewRows = rowState();
      const afterViewPreview = previewState();
      const afterViewInfo = infoText();
      const filesBeforeViewSave = new Set(await listScenes());
      const previewSaveResult = await window.saveScene();
      await wait(500);
      const filesAfterViewSave = await listScenes();
      const viewSaveFiles = filesAfterViewSave.filter(name => !filesBeforeViewSave.has(name));
      const previewSaveBlocked = previewSaveResult === false
        && viewSaveFiles.length === 0
        && infoText().includes('Greenroom preview is temporary');
      const previewEnteredTemporaryMode = afterViewPreview.active
        && afterViewPreview.visible
        && afterViewPreview.actions.includes('Import to Scene')
        && afterViewPreview.actions.includes('Back to Scene')
        && afterViewPreview.source?.includes(loadProbe?.route)
        && afterViewInfo.includes('Greenroom');
      const previewDidNotMutateAuthoredRows = afterViewRows.length === 0;
      const backButton = document.querySelector('[data-greenroom-preview-action="back"]');
      if (backButton) {
        backButton.click();
        await waitForPreviewActive(false);
        await waitForSceneRows(setupRows.length);
      }
      const afterBackRows = rowState();
      const backRestoredAuthoredRows = sameRows(setupRows, afterBackRows);
      if (viewButton) {
        viewButton.click();
        await waitForPreviewActive(true);
        await waitForPreviewObject(loadProbe?.route);
      }
      window.rotateAxis?.('y');
      const previewImportButton = document.querySelector('[data-greenroom-preview-action="import"]');
      if (previewImportButton) {
        previewImportButton.click();
        await waitForPreviewActive(false);
        await waitForSceneRows(setupRows.length + 1);
      }
      const savedAfterView = await readScene(savedFile);
      const afterPreviewImportRows = rowState();
      const viewProtectedSaveTarget = JSON.stringify(savedBeforeView) === JSON.stringify(savedAfterView);
      const authoredRowsAfterPreviewImport = afterPreviewImportRows.filter(row => setupRows.some(setup => setup.id === row.id));
      const previewImportedRows = afterPreviewImportRows.filter(row => row.label === loadRow?.title && row.source?.includes(loadProbe?.route));
      const afterPreviewImportGroups = groupState();
      const previewImportGroup = afterPreviewImportGroups.find(group => (
        group.label === loadRow?.title
        && group.source?.includes(loadProbe?.route)
        && previewImportedRows.some(row => group.objectIds?.includes(row.id))
      )) || null;
      const previewImportRestoredAndAppended = authoredRowsAfterPreviewImport.length === setupRows.length
        && previewImportedRows.length === 1
        && afterPreviewImportRows.length === setupRows.length + 1;
      const previewImportRowsGreenroomSourced = previewImportedRows.length === 1
        && previewImportedRows.every(row => row.source?.includes(loadProbe?.route));
      const previewImportCreatedGroup = !!previewImportGroup;
      for (const name of [savedFile, ...viewSaveFiles].filter(Boolean)) {
        await deleteScene(name);
        const postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(name)) {
          throw new Error('greenroom action cleanup did not delete scene file: ' + name);
        }
      }
      return {
        rowCount: rows.length,
        rows: grRowState.slice(0, 8),
        humaneRowCount: humaneRows.length,
        hasSubtitle: grRowState.some(row => row.subtitle),
        hasRaw: grRowState.some(row => row.raw),
        hasView: grRowState.some(row => row.buttons.includes('View')),
        hasImport: grRowState.some(row => row.buttons.includes('Import')),
        loadProbe,
        afterViewRows,
        afterViewPreview,
        afterViewInfo,
        afterBackRows,
        afterPreviewImportRows,
        afterPreviewImportGroups,
        previewImportGroup,
        savedFile,
        viewSaveFiles,
        viewProtectedSaveTarget,
        setupRows,
        previewSaveBlocked,
        previewEnteredTemporaryMode,
        previewDidNotMutateAuthoredRows,
        backRestoredAuthoredRows,
        previewImportRestoredAndAppended,
        previewImportRowsGreenroomSourced,
        previewImportCreatedGroup,
      };
    })()
  `, { timeoutMs: 90000 });

  if (lastEvidence.greenroomPickerDisplay.rowCount < 1) {
    throw new Error(`greenroom picker did not render any rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (lastEvidence.greenroomPickerDisplay.humaneRowCount < 1) {
    throw new Error(`greenroom picker titles still look raw-id-first: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.hasSubtitle || !lastEvidence.greenroomPickerDisplay.hasRaw) {
    throw new Error(`greenroom picker did not expose subtitle and raw metadata: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.hasView || !lastEvidence.greenroomPickerDisplay.hasImport) {
    throw new Error(`greenroom picker did not expose View and Import mesh actions: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  const loadProbe = lastEvidence.greenroomPickerDisplay.loadProbe;
  if (!loadProbe || !loadProbe.outputsOk || !loadProbe.mesh || !loadProbe.outputOk || loadProbe.outputBytes < 1) {
    throw new Error(`greenroom picker mesh route was not fetchable: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewEnteredTemporaryMode) {
    throw new Error(`greenroom View did not enter temporary preview mode: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewDidNotMutateAuthoredRows) {
    throw new Error(`greenroom View mutated authored scene rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewSaveBlocked) {
    throw new Error(`greenroom preview save was not blocked: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.backRestoredAuthoredRows) {
    throw new Error(`greenroom preview Back did not restore authored scene rows: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportRestoredAndAppended) {
    throw new Error(`greenroom preview Import to Scene did not restore and append into the authored scene: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportRowsGreenroomSourced) {
    throw new Error(`greenroom preview import did not preserve Greenroom route source: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.previewImportCreatedGroup) {
    throw new Error(`greenroom preview import did not create a grouped imported object: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
  if (!lastEvidence.greenroomPickerDisplay.viewProtectedSaveTarget) {
    throw new Error(`greenroom View did not protect the previous save target: ${JSON.stringify(lastEvidence.greenroomPickerDisplay)}`);
  }
}

async function runGreenroomPreviewRaceScenario(ws) {
  phase = 'scenario-greenroom-preview-race';
  lastEvidence.greenroomPreviewRace = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const previewState = () => {
        const panel = document.getElementById('greenroom-preview-controls');
        return {
          active: !!window.greenroomPreviewIsActive?.(),
          visible: !!panel && !panel.hidden,
          title: document.getElementById('greenroom-preview-title')?.textContent?.trim() || null,
          source: document.getElementById('greenroom-preview-source')?.textContent?.trim() || null,
          actions: [...document.querySelectorAll('[data-greenroom-preview-action]')].map(button => button.textContent.trim()),
        };
      };
      const previewDebug = () => window.greenroomPreviewDebugState?.() || {};
      const waitForSceneRows = async count => {
        for (let i = 0; i < 160; i++) {
          const rows = rowState();
          if (rows.length === count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const waitForPreviewRoute = async route => {
        for (let i = 0; i < 160; i++) {
          const state = previewState();
          const debug = previewDebug();
          if (state.active
            && state.visible
            && state.source?.includes(route)
            && debug.previewObjectSource?.includes(route)
            && debug.previewSceneObjectSources?.length === 1
            && debug.previewSceneObjectSources[0]?.includes(route)) {
            return { state, debug };
          }
          await wait(125);
        }
        return { state: previewState(), debug: previewDebug() };
      };
      const ensureBaseObject = async () => {
        if (rowState().length) return rowState();
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('SuperMat Ring demo button missing');
        demo.click();
        return waitForSceneRows(1);
      };
      const greenroomRawName = value => String(value || '').trim().replace(/^raw\\s+/i, '');
      const getJobOutputEvents = async query => {
        const suffix = query ? '?' + query : '';
        const resp = await fetch('/api/job-output-events' + suffix);
        const data = await resp.json().catch(() => ({}));
        return {
          ok: resp.ok,
          status: resp.status,
          events: Array.isArray(data.events) ? data.events : [],
          cleared: !!data.cleared,
          error: data.error || null,
        };
      };
      const outputRouteFor = async rawName => {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(rawName));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const mesh = (outputsData.entries || []).find(entry => /\\.(glb|gltf|obj)$/i.test(entry.name));
        return {
          jobId: rawName,
          outputsStatus: outputsResp.status,
          outputsOk: outputsResp.ok,
          outputsError: outputsData.error || null,
          mesh: mesh?.name || null,
          route: mesh ? '/api/job-output?job_id=' + encodeURIComponent(rawName) + '&file=' + encodeURIComponent(mesh.name) : null,
        };
      };
      const setupRows = rowState();
      document.querySelector('[data-tab="greenroom"]').click();
      let entries = [];
      for (let i = 0; i < 120; i++) {
        entries = [...document.querySelectorAll('#greenroom-list .gr-entry')];
        if (entries.filter(entry => [...entry.querySelectorAll('button')].some(button => button.textContent.trim() === 'View')).length >= 2) break;
        const doneEntry = entries.find(entry => (
          entry.querySelector('.gr-title')?.textContent?.trim().toLowerCase() === 'done'
          || entry.querySelector('.gr-raw')?.textContent?.trim().toLowerCase() === 'raw done'
        ));
        if (doneEntry) doneEntry.click();
        await wait(125);
      }
      const raceRows = entries.map((entry, index) => ({
        index,
        title: entry.querySelector('.gr-title')?.textContent?.trim() || null,
        raw: entry.querySelector('.gr-raw')?.textContent?.trim() || null,
        rawName: greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || ''),
        buttons: [...entry.querySelectorAll('button')].map(button => button.textContent.trim()),
      })).filter(row => row.rawName && row.buttons.includes('View'));
      if (raceRows.length < 2) {
        throw new Error('greenroom preview race fixture needs at least two View rows: ' + JSON.stringify(raceRows));
      }
      const raceA = raceRows[0];
      const raceB = raceRows[1];
      const raceRouteA = await outputRouteFor(raceA.rawName);
      const raceRouteB = await outputRouteFor(raceB.rawName);
      if (!raceRouteA.route || !raceRouteB.route) {
        throw new Error('greenroom preview race fixture rows did not expose mesh routes: ' + JSON.stringify({ raceRouteA, raceRouteB }));
      }
      const actionEntries = [...document.querySelectorAll('#greenroom-list .gr-entry')];
      const entryA = actionEntries.find(entry => greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || '') === raceA.rawName);
      const entryB = actionEntries.find(entry => greenroomRawName(entry.querySelector('.gr-raw')?.textContent?.trim() || '') === raceB.rawName);
      const viewA = [...(entryA?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === 'View');
      const viewB = [...(entryB?.querySelectorAll('button') || [])].find(button => button.textContent.trim() === 'View');
      if (!viewA || !viewB) {
        throw new Error('greenroom preview race View buttons disappeared: ' + JSON.stringify({ raceRows }));
      }
      const clearedJobOutputEvents = await getJobOutputEvents('clear=1');
      viewA.click();
      await wait(50);
      viewB.click();
      const afterSecondRoute = await waitForPreviewRoute(raceRouteB.route);
      const routeBOwnedAtMs = Date.now();
      await wait(3200);
      const jobOutputEventState = await getJobOutputEvents();
      const routeAEvents = jobOutputEventState.events.filter(event => event.job_id === raceA.rawName && event.file === raceRouteA.mesh);
      const routeBEvents = jobOutputEventState.events.filter(event => event.job_id === raceB.rawName && event.file === raceRouteB.mesh);
      const delayedRouteAEvent = routeAEvents.find(event => Number(event.delay_ms || 0) > 0) || null;
      const effectiveDelayMs = Number(delayedRouteAEvent?.delay_ms || 0);
      const routeACompletedAfterRouteBOwned = !!delayedRouteAEvent
        && Number(delayedRouteAEvent.ended_at_ms || 0) > routeBOwnedAtMs;
      const afterBothLoads = { state: previewState(), debug: previewDebug() };
      const sources = afterBothLoads.debug.previewSceneObjectSources || [];
      const raceSettledOnSecondRoute = afterBothLoads.state.active
        && afterBothLoads.state.visible
        && afterBothLoads.state.source?.includes(raceRouteB.route)
        && afterBothLoads.debug.previewObjectSource?.includes(raceRouteB.route)
        && sources.length === 1
        && sources[0]?.includes(raceRouteB.route)
        && afterBothLoads.debug.sceneObjectCount === 0;
      const firstRouteAbsent = !afterBothLoads.state.source?.includes(raceRouteA.route)
        && !afterBothLoads.debug.previewObjectSource?.includes(raceRouteA.route)
        && !sources.some(source => source?.includes(raceRouteA.route));
      const importButton = document.querySelector('[data-greenroom-preview-action="import"]');
      if (!importButton) throw new Error('greenroom preview race Import to Scene button missing');
      importButton.click();
      const afterImportRows = await waitForSceneRows(setupRows.length + 1);
      const routeBImports = afterImportRows.filter(row => row.source?.includes(raceRouteB.route));
      const routeAImports = afterImportRows.filter(row => row.source?.includes(raceRouteA.route));
      const importAppendedSecondRoute = afterImportRows.length === setupRows.length + 1
        && routeBImports.length === 1
        && routeAImports.length === 0;
      return {
        setupRows,
        raceRows: [raceA, raceB],
        raceRouteA,
        raceRouteB,
        clearedJobOutputEvents,
        afterSecondRoute,
        routeBOwnedAtMs,
        jobOutputEventState,
        routeAEvents,
        routeBEvents,
        delayedRouteAEvent,
        effectiveDelayMs,
        routeACompletedAfterRouteBOwned,
        afterBothLoads,
        afterImportRows,
        routeBImports,
        routeAImports,
        raceSettledOnSecondRoute,
        firstRouteAbsent,
        importAppendedSecondRoute,
      };
    })()
  `, { timeoutMs: 120000 });

  if (!lastEvidence.greenroomPreviewRace.raceSettledOnSecondRoute) {
    throw new Error(`greenroom preview race did not settle on the second route: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.firstRouteAbsent) {
    throw new Error(`greenroom preview race leaked the first route into active preview state: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.importAppendedSecondRoute) {
    throw new Error(`greenroom preview race import did not append the second route: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
  if (!lastEvidence.greenroomPreviewRace.routeACompletedAfterRouteBOwned) {
    throw new Error(`greenroom preview race did not prove delayed route A completed after route B owned preview: ${JSON.stringify(lastEvidence.greenroomPreviewRace)}`);
  }
}

async function runGreenroomSplatHandoffScenario(ws) {
  phase = 'scenario-greenroom-splat-handoff';
  lastEvidence.greenroomSplatHandoff = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const listScenes = async () => {
        const resp = await fetch('/api/browse?root=scenes&path=');
        const data = await resp.json();
        if (data.error) throw new Error('scene browse failed: ' + data.error);
        return (data.entries || []).filter(entry => entry.name.endsWith('.json')).map(entry => entry.name);
      };
      const readScene = async name => {
        const resp = await fetch('/api/read?root=scenes&path=' + encodeURIComponent(name));
        const data = await resp.json();
        if (data.error) throw new Error('saved scene read failed: ' + data.error);
        return data;
      };
      const deleteScene = async name => {
        const resp = await fetch('/api/delete-scene?name=' + encodeURIComponent(name));
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error('scene cleanup failed: ' + (data.error || resp.status));
        return data;
      };
      const loadSceneDocument = async (doc, name) => {
        const input = document.getElementById('scene-file-input');
        const file = new File([JSON.stringify(doc)], name, { type: 'application/json' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const waitForGreenroomRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#greenroom-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#greenroom-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const fetchRoute = async route => {
        if (!route) return null;
        const resp = await fetch(route);
        const body = await resp.arrayBuffer();
        return {
          route,
          ok: resp.ok,
          status: resp.status,
          contentType: resp.headers.get('content-type'),
          bytes: body.byteLength,
        };
      };

      document.querySelector('[data-tab="greenroom"]').click();
      const beforeRows = rowState();
      const greenroomRows = await waitForGreenroomRows();
      const actionRow = greenroomRows.find(row => [...row.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      const title = actionRow?.querySelector('.gr-title')?.textContent?.trim() || null;
      const raw = actionRow?.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() || null;
      let outputProbe = null;
      if (raw) {
        const outputsResp = await fetch('/api/job-outputs?job_id=' + encodeURIComponent(raw));
        const outputsData = await outputsResp.json().catch(() => ({}));
        const splat = (outputsData.entries || []).find(entry => /\\.(ply|spz)$/i.test(entry.name));
        if (splat) {
          const route = '/api/job-output?job_id=' + encodeURIComponent(raw) + '&file=' + encodeURIComponent(splat.name);
          outputProbe = await fetchRoute(route);
        }
      }
      if (actionButton) {
        actionButton.click();
      }
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat') || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(splatObject?.id) || null;
      const pointCloudPreviewRendered = splatObject?.splat?.previewKind === 'point-cloud';
      const pointCloudPreviewPointCount = Number(splatObject?.splat?.pointCount || 0);
      const beforeSceneFiles = new Set(await listScenes());
      const savedOk = await window.saveSceneAs();
      let savedFile = null;
      for (let i = 0; i < 120; i++) {
        const afterSceneFiles = await listScenes();
        const newFiles = afterSceneFiles.filter(name => !beforeSceneFiles.has(name));
        if (newFiles.length === 1) {
          savedFile = newFiles[0];
          break;
        }
        await wait(125);
      }
      const savedScene = savedFile ? await readScene(savedFile) : null;
      const savedSplatObject = (savedScene?.objects || []).find(record => record.type === 'splat') || null;
      const savedSplatMetadataPreserved = !!savedSplatObject
        && savedSplatObject.source === splatObject?.source
        && savedSplatObject.splat?.assetSource === splatObject?.source
        && savedSplatObject.renderHandoffSchema === 'kaminos.render-handoff.v0'
        && savedSplatObject.renderCapabilities?.meshDepthOcclusion === false;
      if (savedScene && savedFile) {
        await loadSceneDocument(savedScene, savedFile);
        await waitForSceneRows(savedScene.objects?.length || 1);
      }
      const reloadedSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const reloadedSplatObject = reloadedSceneDebug.find(record => record.type === 'splat') || null;
      const reloadedHandoffDebug = window.kaminosRenderHandoffDebugState?.(reloadedSplatObject?.id) || null;
      const loadRestoredSplatObject = !!reloadedSplatObject
        && reloadedSplatObject.source === splatObject?.source
        && reloadedHandoffDebug?.activeHandoff?.source === splatObject?.source;
      const loadRestoredPointCloudState = reloadedSplatObject?.splat?.previewKind === 'point-cloud'
        && Number(reloadedSplatObject?.splat?.pointCount || 0) === pointCloudPreviewPointCount;
      let cleanup = null;
      let postCleanupFiles = null;
      if (savedFile) {
        cleanup = await deleteScene(savedFile);
        postCleanupFiles = await listScenes();
        if (postCleanupFiles.includes(savedFile)) {
          throw new Error('splat handoff cleanup did not delete saved scene file: ' + savedFile);
        }
      }
      return {
        beforeRows,
        afterRows,
        greenroomRowCount: greenroomRows.length,
        actionExposed: !!actionButton,
        title,
        raw,
        outputProbe,
        sceneDebug,
        splatObject,
        handoffDebug,
        pointCloudPreviewRendered,
        pointCloudPreviewPointCount,
        savedOk,
        savedFile,
        savedSplatObject,
        savedSplatMetadataPreserved,
        reloadedSceneDebug,
        reloadedSplatObject,
        reloadedHandoffDebug,
        loadRestoredSplatObject,
        loadRestoredPointCloudState,
        cleanup,
        postCleanupFiles,
      };
    })()
  `, { timeoutMs: 60000 });

  if (!lastEvidence.greenroomSplatHandoff.actionExposed) {
    throw new Error(`Greenroom splat fixture did not expose Import Splat action: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const splatObject = lastEvidence.greenroomSplatHandoff.splatObject;
  if (!splatObject || splatObject.type !== 'splat') {
    throw new Error(`splat handoff did not register a type=splat scene object: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const source = splatObject.source || '';
  const handoffSource = lastEvidence.greenroomSplatHandoff.handoffDebug?.activeHandoff?.source || '';
  if (!source.includes('/api/') || source !== handoffSource) {
    throw new Error(`splat handoff did not preserve route source: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  const capabilities = lastEvidence.greenroomSplatHandoff.handoffDebug?.activeHandoff?.capabilities || {};
  if (capabilities.meshDepthOcclusion !== false) {
    throw new Error(`splat handoff did not record meshDepthOcclusion=false: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (capabilities.sharedCanvasComposite !== false) {
    throw new Error(`splat handoff did not record sharedCanvasComposite=false: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (capabilities.realSplatRendering !== false) {
    throw new Error(`splat handoff claimed real splat rendering: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.pointCloudPreviewRendered) {
    throw new Error(`splat preview did not render a point cloud: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (lastEvidence.greenroomSplatHandoff.pointCloudPreviewPointCount < 1) {
    throw new Error(`splat preview did not report point count: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.savedSplatMetadataPreserved) {
    throw new Error(`splat handoff saved scene did not preserve splat metadata: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.loadRestoredSplatObject) {
    throw new Error(`splat handoff scene load did not restore splat object: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
  if (!lastEvidence.greenroomSplatHandoff.loadRestoredPointCloudState) {
    throw new Error(`splat preview lost point-cloud state after scene load: ${JSON.stringify(lastEvidence.greenroomSplatHandoff)}`);
  }
}

async function runSplatAssetInboxScenario(ws) {
  phase = 'scenario-splat-asset-inbox';
  lastEvidence.splatAssetInbox = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForAssetRows = async () => {
        for (let i = 0; i < 100; i++) {
          const rows = [...document.querySelectorAll('#splat-assets-list .gr-entry')];
          if (rows.length) return rows;
          await wait(125);
        }
        return [...document.querySelectorAll('#splat-assets-list .gr-entry')];
      };
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };

      document.querySelector('[data-tab="greenroom"]').click();
      if (window.grBrowseSplatAssets) await window.grBrowseSplatAssets();
      const beforeRows = rowState();
      const assetRows = await waitForAssetRows();
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const actionRow = assetRows.find(row => row.dataset.assetStage === 'experimental'
        && [...row.querySelectorAll('button')].some(button => button.textContent.trim() === 'Import Splat'));
      const actionButton = actionRow ? [...actionRow.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Import Splat') : null;
      const stageText = actionRow?.querySelector('.gr-stage')?.textContent?.trim() || null;
      const title = actionRow?.querySelector('.gr-title')?.textContent?.trim() || null;
      const raw = actionRow?.querySelector('.gr-raw')?.textContent?.replace(/^raw\\s+/i, '').trim() || null;
      const assetEntry = (assetData.entries || []).find(entry => entry.stage === 'experimental') || null;
      const sourceProbe = assetEntry?.source
        ? await fetch(assetEntry.source).then(async resp => ({
            ok: resp.ok,
            status: resp.status,
            route: assetEntry.source,
            bytes: (await resp.arrayBuffer()).byteLength,
          }))
        : null;
      if (actionButton) actionButton.click();
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat'
        && record.source === assetEntry?.source) || sceneDebug.find(record => record.type === 'splat') || null;
      return {
        beforeRows,
        afterRows,
        assetRowCount: assetRows.length,
        assetData,
        actionExposed: !!actionButton,
        stageText,
        title,
        raw,
        assetEntry,
        sourceProbe,
        sceneDebug,
        splatObject,
      };
    })()
  `, { timeoutMs: 60000 });

  if (lastEvidence.splatAssetInbox.assetRowCount < 1) {
    throw new Error(`splat asset inbox did not render any splat assets: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  if (lastEvidence.splatAssetInbox.stageText !== 'experimental'
      || lastEvidence.splatAssetInbox.assetEntry?.stage !== 'experimental') {
    throw new Error(`splat asset inbox did not preserve experimental stage: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  const splatObject = lastEvidence.splatAssetInbox.splatObject;
  if (!splatObject || splatObject.type !== 'splat'
      || splatObject.splat?.previewKind !== 'point-cloud'
      || Number(splatObject.splat?.pointCount || 0) < 1) {
    throw new Error(`splat asset inbox import did not register point-cloud splat: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
  const source = splatObject.source || '';
  const expectedSource = lastEvidence.splatAssetInbox.assetEntry?.source || '';
  if (!expectedSource || source !== expectedSource || !source.includes('/api/read?root=splat-inbox')) {
    throw new Error(`splat asset inbox did not preserve asset source: ${JSON.stringify(lastEvidence.splatAssetInbox)}`);
  }
}

async function runSplatDirectDropIngestScenario(ws) {
  phase = 'scenario-splat-direct-drop-ingest';
  lastEvidence.splatDirectDropIngest = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('[data-scene-object-name]')?.value?.trim() || row.querySelector('.scene-object-name')?.textContent?.trim() || null,
        source: row.querySelector('.scene-object-meta')?.textContent?.trim() || null,
      }));
      const waitForSceneRows = async count => {
        for (let i = 0; i < 120; i++) {
          const rows = rowState();
          if (rows.length >= count) return rows;
          await wait(125);
        }
        return rowState();
      };
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 60 60',
        '1 0 0 60 255 60',
        '0 -1 0 60 60 255',
        '0 1 0 255 220 60',
        '0 0 -1 255 60 220',
        '0 0 1 60 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const beforeRows = rowState();
      const file = new File([ply], 'Witness Direct Drop.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: false });
      const afterRows = await waitForSceneRows(beforeRows.length + 1);
      const assetData = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splatObject = sceneDebug.find(record => record.type === 'splat'
        && record.source === ingestResult?.entry?.source) || sceneDebug.find(record => record.type === 'splat') || null;
      const sourceProbe = ingestResult?.entry?.source
        ? await fetch(ingestResult.entry.source).then(async resp => ({
            ok: resp.ok,
            status: resp.status,
            route: ingestResult.entry.source,
            bytes: (await resp.arrayBuffer()).byteLength,
          }))
        : null;
      return {
        beforeRows,
        afterRows,
        ingestResult: {
          entry: ingestResult?.entry || null,
          objectName: ingestResult?.object?.name || null,
        },
        assetData,
        sourceProbe,
        sceneDebug,
        splatObject,
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
      };
    })()
  `, { timeoutMs: 60000 });

  const entry = lastEvidence.splatDirectDropIngest.ingestResult?.entry;
  if (!entry || entry.stage !== 'experimental' || entry.root_id !== 'splat-inbox') {
    throw new Error(`direct splat drop did not upload to the experimental inbox: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  const splatObject = lastEvidence.splatDirectDropIngest.splatObject;
  const source = splatObject?.source || '';
  if (!splatObject || source !== entry.source || !source.includes('/api/read?root=splat-inbox')) {
    throw new Error(`direct splat drop did not import from the reloadable inbox route: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  if (splatObject.splat?.previewKind !== 'point-cloud' || Number(splatObject.splat?.pointCount || 0) !== 6) {
    throw new Error(`direct splat drop did not register point-cloud splat: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
  const provenance = splatObject.splat?.provenance || {};
  if (provenance.ingest !== 'direct-drop'
      || provenance.asset_stage !== 'experimental'
      || provenance.root_id !== 'splat-inbox'
      || provenance.source_url !== entry.source) {
    throw new Error(`direct splat drop did not preserve ingest provenance: ${JSON.stringify(lastEvidence.splatDirectDropIngest)}`);
  }
}

async function runSplatCorrectionSidecarScenario(ws) {
  phase = 'scenario-splat-correction-sidecar';
  lastEvidence.splatCorrectionSidecar = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 60 60',
        '1 0 0 60 255 60',
        '0 -1 0 60 60 255',
        '0 1 0 255 220 60',
        '0 0 -1 255 60 220',
        '0 0 1 60 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const file = new File([ply], 'Witness Correction Sidecar.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: true });
      await wait(250);
      const firstSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const firstSplat = firstSceneDebug.find(record => record.type === 'splat'
        && record.source === ingestResult?.entry?.source) || firstSceneDebug.find(record => record.type === 'splat');
      if (!firstSplat) throw new Error('correction scenario could not import initial splat');
      window.selectSceneObject(firstSplat.id);
      await window.enterSplatCorrectionMode(firstSplat.id);
      window.kaminosSetSplatCorrectionDraftTransform({
        position: [0.25, -0.1, 0.4],
        rotation: [0.1, 0.2, 0.3],
        scale: [1, 1, 1],
      });
      const setField = (name, value) => {
        const input = document.querySelector('[data-splat-correction-field="' + name + '"]');
        if (!input) throw new Error('missing splat correction field ' + name);
        if (input.type === 'checkbox') input.checked = !!value;
        else input.value = String(value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setField('crop.enabled', true);
      setField('crop.min.x', -0.2);
      setField('crop.min.y', -0.3);
      setField('crop.min.z', -0.4);
      setField('crop.max.x', 0.7);
      setField('crop.max.y', 0.8);
      setField('crop.max.z', 0.9);
      const saveResult = await window.kaminosSaveSelectedSplatCorrection();
      const assetDataAfterSave = await fetch('/api/assets?kind=splat').then(resp => resp.json());
      const savedAssetEntry = (assetDataAfterSave.entries || []).find(entry => entry.path === ingestResult?.entry?.path) || null;
      const sourceBeforeReload = ingestResult?.entry?.source;
      await window.greenroomImportSplat(sourceBeforeReload, ingestResult?.entry?.name || 'splat.ply', ingestResult?.entry?.display || { title: 'Splat' }, {
        clear: true,
        metadata: {
          source: sourceBeforeReload,
          fileName: ingestResult?.entry?.name || 'splat.ply',
          label: 'Reloaded correction sidecar',
          splat: {
            schema: 'kaminos.splat-asset.v0',
            assetSource: sourceBeforeReload,
            fileName: ingestResult?.entry?.name || 'splat.ply',
            format: 'ply',
            bounds: null,
            splatCount: null,
            sidecars: [],
            provenance: {
              source_group: 'splat-inbox',
              source_url: sourceBeforeReload,
              root_id: ingestResult?.entry?.root_id,
              root_label: ingestResult?.entry?.root_label,
              asset_stage: ingestResult?.entry?.stage,
              asset_path: ingestResult?.entry?.path,
            },
          },
        },
      });
      await wait(250);
      const reloadedSceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const reloadedSplat = reloadedSceneDebug.find(record => record.type === 'splat') || null;
      const handoffDebug = window.kaminosRenderHandoffDebugState?.(reloadedSplat?.id) || null;
      return {
        ingestResult: { entry: ingestResult?.entry || null },
        saveResult,
        assetDataAfterSave,
        savedAssetEntry,
        firstSplat,
        reloadedSplat,
        handoffDebug,
      };
    })()
  `, { timeoutMs: 60000 });

  const saved = lastEvidence.splatCorrectionSidecar.savedAssetEntry;
  const savedCorrection = saved?.correction || null;
  if (!savedCorrection
      || savedCorrection.crop?.enabled !== true
      || savedCorrection.centroidOffset?.[0] !== 0.25
      || savedCorrection.orientation?.rotation?.[2] !== 0.3) {
    throw new Error(`splat correction did not persist to sidecar: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const reloaded = lastEvidence.splatCorrectionSidecar.reloadedSplat;
  if (!reloaded?.splat?.correction
      || reloaded.splat.correction.crop?.enabled !== true
      || reloaded.transform?.position?.[0] !== 0.25
      || reloaded.transform?.rotation?.[1] !== 0.2) {
    throw new Error(`splat correction did not reload from sidecar: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
  const caps = lastEvidence.splatCorrectionSidecar.handoffDebug?.activeHandoff?.capabilities || {};
  if (caps.realSplatRendering !== false || caps.meshDepthOcclusion !== false) {
    throw new Error(`splat correction leaked into render truth claim: ${JSON.stringify(lastEvidence.splatCorrectionSidecar)}`);
  }
}

async function runSplatCorrectionModeScenario(ws) {
  phase = 'scenario-splat-correction-mode';
  lastEvidence.splatCorrectionMode = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const ply = [
        'ply',
        'format ascii 1.0',
        'element vertex 6',
        'property float x',
        'property float y',
        'property float z',
        'property uchar red',
        'property uchar green',
        'property uchar blue',
        'end_header',
        '-1 0 0 255 80 80',
        '1 0 0 80 255 80',
        '0 -1 0 80 80 255',
        '0 1 0 255 220 80',
        '0 0 -1 255 80 220',
        '0 0 1 80 255 220',
      ].join('\\n') + '\\n';
      document.querySelector('[data-tab="greenroom"]').click();
      const file = new File([ply], 'Witness Correction Mode.PLY', { type: 'application/octet-stream' });
      const ingestResult = await window.kaminosIngestDroppedSplatFile(file, { clear: true });
      await wait(250);
      const sceneDebug = window.kaminosSceneObjectDebugState?.() || [];
      const splat = sceneDebug.find(record => record.type === 'splat' && record.source === ingestResult?.entry?.source)
        || sceneDebug.find(record => record.type === 'splat');
      if (!splat) throw new Error('correction mode scenario could not import splat');
      window.selectSceneObject(splat.id);
      const plannedSceneTransform = {
        position: [1.0, 0.25, -0.5],
        rotation: [0.4, -0.2, 0.1],
        scale: [1.1, 1.2, 1.3],
      };
      const sceneBeforeMode = window.kaminosSetSceneObjectTransform(splat.id, plannedSceneTransform);
      const entered = await window.enterSplatCorrectionMode(splat.id);
      const draft = window.kaminosSetSplatCorrectionDraftTransform({
        position: [0.2, 0.3, 0.4],
        rotation: [0.05, 0.1, 0.15],
        scale: [1, 1, 1],
      });
      const sceneAfterDraft = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const flipDraft = window.kaminosToggleSplatCorrectionAxisFlip('x');
      const sceneAfterFlip = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const cropEnabled = document.querySelector('[data-splat-correction-field="crop.enabled"]');
      if (!cropEnabled) throw new Error('Splat Correction Mode witness could not find crop enabled control');
      cropEnabled.checked = true;
      cropEnabled.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(50);
      const cropToggleDraft = window.kaminosSplatCorrectionModeDebugState?.() || null;
      const sceneAfterCropToggle = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const cropMode = await window.setSplatCorrectionEditMode('crop');
      const cropEdit = window.kaminosSetSplatCorrectionCropTransform({
        position: [0.15, -0.05, 0.25],
        scale: [0.8, 0.6, 0.4],
      });
      const sceneAfterCropEdit = (window.kaminosSceneObjectDebugState?.() || []).find(record => record.id === splat.id);
      const saveButton = [...document.querySelectorAll('#splat-correction-panel button')]
        .find(button => button.textContent.trim() === 'Save Correction');
      if (!saveButton) throw new Error('Splat Correction Mode witness could not find visible Save Correction button');
      saveButton.click();
      let saveResult = null;
      let assetDataAfterSave = null;
      let savedAssetEntry = null;
      for (let i = 0; i < 80; i++) {
        await wait(125);
        assetDataAfterSave = await fetch('/api/assets?kind=splat').then(resp => resp.json());
        savedAssetEntry = (assetDataAfterSave.entries || []).find(entry => entry.path === ingestResult?.entry?.path) || null;
        if (savedAssetEntry?.correction?.axisFlips?.[0] === -1) {
          saveResult = await fetch('/api/splat-correction?' + new URLSearchParams({
            root: ingestResult?.entry?.root_id,
            path: ingestResult?.entry?.path,
          })).then(resp => resp.json());
          break;
        }
      }
      const modeAfterSave = window.kaminosSplatCorrectionModeDebugState?.() || null;
      return {
        ingestResult: { entry: ingestResult?.entry || null },
        sceneBeforeMode,
        entered,
        draft,
        sceneAfterDraft,
        flipDraft,
        sceneAfterFlip,
        cropToggleDraft,
        sceneAfterCropToggle,
        cropMode,
        cropEdit,
        sceneAfterCropEdit,
        saveResult,
        modeAfterSave,
        assetDataAfterSave,
        savedAssetEntry,
      };
    })()
  `, { timeoutMs: 60000 });

  const evidence = lastEvidence.splatCorrectionMode;
  if (!evidence.entered?.active || !evidence.entered?.targetAttached || evidence.entered?.transformTargetName !== 'splat-correction-target') {
    throw new Error(`splat correction mode did not retarget gizmo: ${JSON.stringify(evidence)}`);
  }
  const before = evidence.sceneBeforeMode?.sceneTransform;
  const after = evidence.sceneAfterDraft?.sceneTransform;
  const sameSceneTransform = Array.isArray(before?.position)
    && Array.isArray(after?.position)
    && before.position.every((value, index) => Math.abs(value - after.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - after.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - after.scale[index]) < 1e-6);
  if (!sameSceneTransform) {
    throw new Error(`splat correction mode dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  const afterFlip = evidence.sceneAfterFlip?.sceneTransform;
  const flipPreservedSceneTransform = Array.isArray(afterFlip?.position)
    && before.position.every((value, index) => Math.abs(value - afterFlip.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - afterFlip.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - afterFlip.scale[index]) < 1e-6);
  if (!flipPreservedSceneTransform) {
    throw new Error(`splat correction axis flip dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  const visual = evidence.sceneAfterDraft?.transform;
  if (!visual
      || Math.abs(visual.position?.[0] - 1.2) > 1e-6
      || Math.abs(visual.position?.[1] - 0.55) > 1e-6
      || Math.abs(visual.rotation?.[2] - 0.25) > 1e-6) {
    throw new Error(`splat correction mode did not compose draft correction into preview transform: ${JSON.stringify(evidence)}`);
  }
  const flippedVisual = evidence.sceneAfterFlip?.transform;
  if (!flippedVisual || Math.abs(flippedVisual.scale?.[0] + 1.1) > 1e-6) {
    throw new Error(`splat correction mode did not compose axis flip into preview scale: ${JSON.stringify(evidence)}`);
  }
  const cropToggleCorrection = evidence.cropToggleDraft?.draftCorrection
    || evidence.sceneAfterCropToggle?.splat?.correction
    || null;
  if (cropToggleCorrection?.axisFlips?.[0] !== -1
      || evidence.sceneAfterCropToggle?.splat?.correction?.axisFlips?.[0] !== -1) {
    throw new Error(`splat correction crop edit reset axis flip: ${JSON.stringify(evidence)}`);
  }
  const cropToggleVisual = evidence.sceneAfterCropToggle?.transform;
  if (!cropToggleVisual || Math.abs(cropToggleVisual.scale?.[0] + 1.1) > 1e-6) {
    throw new Error(`splat correction crop edit dropped flipped preview scale: ${JSON.stringify(evidence)}`);
  }
  if (!evidence.cropMode?.targetAttached
      || evidence.cropMode?.editMode !== 'crop'
      || evidence.cropMode?.transformTargetName !== 'splat-correction-crop-target'
      || !evidence.cropMode?.cropBoxVisible) {
    throw new Error(`splat correction crop mode did not attach crop target: ${JSON.stringify(evidence)}`);
  }
  const cropEditCorrection = evidence.cropEdit?.draftCorrection || evidence.sceneAfterCropEdit?.splat?.correction || null;
  if (!cropEditCorrection?.crop?.enabled
      || Math.abs(cropEditCorrection.crop.min?.[0] + 0.25) > 1e-6
      || Math.abs(cropEditCorrection.crop.max?.[0] - 0.55) > 1e-6
      || Math.abs(cropEditCorrection.crop.min?.[1] + 0.35) > 1e-6
      || Math.abs(cropEditCorrection.crop.max?.[2] - 0.45) > 1e-6) {
    throw new Error(`splat correction crop mode did not update crop bounds: ${JSON.stringify(evidence)}`);
  }
  const afterCropEdit = evidence.sceneAfterCropEdit?.sceneTransform;
  const cropEditPreservedSceneTransform = Array.isArray(afterCropEdit?.position)
    && before.position.every((value, index) => Math.abs(value - afterCropEdit.position[index]) < 1e-6)
    && before.rotation.every((value, index) => Math.abs(value - afterCropEdit.rotation[index]) < 1e-6)
    && before.scale.every((value, index) => Math.abs(value - afterCropEdit.scale[index]) < 1e-6);
  if (!cropEditPreservedSceneTransform) {
    throw new Error(`splat correction crop mode dirtied scene transform: ${JSON.stringify(evidence)}`);
  }
  const savedCorrection = evidence.savedAssetEntry?.correction || null;
  if (!savedCorrection
      || Math.abs(savedCorrection.centroidOffset?.[0] - 0.2) > 1e-6
      || Math.abs(savedCorrection.centroidOffset?.[2] - 0.4) > 1e-6
      || Math.abs(savedCorrection.orientation?.rotation?.[1] - 0.1) > 1e-6
      || evidence.modeAfterSave?.dirty !== false) {
    throw new Error(`splat correction mode did not save draft: ${JSON.stringify(evidence)}`);
  }
  if (savedCorrection.axisFlips?.[0] !== -1 || evidence.saveResult?.correction?.axisFlips?.[0] !== -1) {
    throw new Error(`splat correction mode did not save axis flip: ${JSON.stringify(evidence)}`);
  }
}

async function runAoRouteDeltaScenario(ws) {
  phase = 'scenario-ao-route-delta-on';
  lastEvidence.aoRouteDelta = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitForAo = async () => {
        for (let i = 0; i < 120; i++) {
          if (typeof window.kaminosAODebugState === 'function') {
            const state = window.kaminosAODebugState();
            if (state?.hasRenderPipeline && state?.hasAoPass && state?.hasAoIntensity) return state;
          }
          await wait(125);
        }
        throw new Error('AO debug state did not expose the managed RenderPipeline route');
      };
      const waitForObject = async () => {
        for (let i = 0; i < 120; i++) {
          const rows = [...document.querySelectorAll('[data-scene-object-id]')];
          if (rows.length > 0) return rows.length;
          await wait(125);
        }
        const demo = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'SuperMat Ring');
        if (!demo) throw new Error('AO witness could not find the SuperMat Ring demo button');
        demo.click();
        for (let i = 0; i < 120; i++) {
          const rows = [...document.querySelectorAll('[data-scene-object-id]')];
          if (rows.length > 0) return rows.length;
          await wait(125);
        }
        throw new Error('AO witness did not load a scene object');
      };
      const setRange = (id, value) => {
        const el = document.getElementById(id);
        if (!el) throw new Error('AO control missing: ' + id);
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const setToggle = value => {
        const el = document.getElementById('ao-toggle');
        if (!el) throw new Error('AO toggle missing');
        el.checked = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const objectCount = await waitForObject();
      const initialState = await waitForAo();
      if (initialState.route !== 'three-tsl-render-pipeline-gtao-compute') {
        throw new Error('AO route is not the managed TSL route: ' + JSON.stringify(initialState));
      }
      if (initialState.rawPipelineActive) {
        throw new Error('raw AO pipeline reported active: ' + JSON.stringify(initialState));
      }
      setRange('ao-radius', 4.0);
      setRange('ao-scale', 1.62);
      setRange('ao-thickness', 1.81);
      setRange('ao-falloff', 0.74);
      setRange('ao-intensity', 2.25);
      setToggle(true);
      window._kaminosDirty?.();
      await wait(1400);
      const stateOn = window.kaminosAODebugState();
      if (!stateOn.hasRenderPipeline || !stateOn.hasAoPass || stateOn.intensity <= 2.0) {
        throw new Error('AO on state did not take: ' + JSON.stringify(stateOn));
      }
      return {
        objectCount,
        initialState,
        stateOn,
        info: document.getElementById('info-bar')?.textContent?.trim() || null,
        rendererCanvasSize: {
          width: document.querySelector('canvas')?.width || null,
          height: document.querySelector('canvas')?.height || null,
        },
      };
    })()
  `, { timeoutMs: 45000 });

  const onShot = await capturePngScreenshot(ws, siblingPngPath('-ao-on'));

  phase = 'scenario-ao-route-delta-off';
  const offEvidence = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const toggle = document.getElementById('ao-toggle');
      if (!toggle) throw new Error('AO toggle missing for off capture');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      window._kaminosDirty?.();
      await wait(1400);
      const stateOff = window.kaminosAODebugState?.();
      if (!stateOff || stateOff.intensity !== 0) {
        throw new Error('AO off state did not bypass intensity: ' + JSON.stringify(stateOff));
      }
      return { stateOff };
    })()
  `, { timeoutMs: 20000 });

  const offShot = await capturePngScreenshot(ws, siblingPngPath('-ao-off'));

  phase = 'scenario-ao-route-delta-restore-on';
  const restoreEvidence = await evaluate(ws, `
    (async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const toggle = document.getElementById('ao-toggle');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      window._kaminosDirty?.();
      await wait(900);
      return { stateRestored: window.kaminosAODebugState?.() };
    })()
  `, { timeoutMs: 20000 });

  lastEvidence.aoRouteDelta = {
    ...lastEvidence.aoRouteDelta,
    ...offEvidence,
    ...restoreEvidence,
    onShot,
    offShot,
  };
}

let chromeProcess = null;
let ws = null;

try {
  phase = 'checking-debug-port';
  if (await isCdpEndpointOpen()) {
    throw new Error(`CDP debug port already in use before launch: ${port}`);
  }

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
  const chromeLaunchSignal = new Promise(resolveLaunch => {
    chromeProcess.once('error', error => resolveLaunch({ error }));
    chromeProcess.once('exit', (code, signal) => resolveLaunch({ exit: { code, signal } }));
  });

  phase = 'waiting-for-cdp';
  const launchResult = await Promise.race([
    waitForCdp().then(version => ({ version })),
    chromeLaunchSignal,
  ]);
  if (launchResult.error) {
    throw new Error(`Chrome launch failed: ${launchResult.error.message}`);
  }
  if (launchResult.exit) {
    throw new Error(`Chrome exited before DevTools opened: ${JSON.stringify(launchResult.exit)}`);
  }
  browserVersion = launchResult.version;

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
  const requestedHref = normalizeUrlForWitness(url);
  const effectiveHref = normalizeUrlForWitness(effectiveUrl);
  if (requestedHref !== effectiveHref) {
    throw new Error(`effective URL mismatch: requested ${requestedHref} but browser loaded ${effectiveHref}`);
  }
  phase = 'checking-server-root';
  effectiveServerRoots = await fetchServerRoots(effectiveHref);
  assertExpectedServerRoot(effectiveServerRoots);

  if (scenario === 'append-select-remove-keyboard') {
    await runAppendSelectRemoveKeyboardScenario(ws);
  } else if (scenario === 'save-load-roundtrip') {
    await runSaveLoadRoundtripScenario(ws);
  } else if (scenario === 'transform-inspector') {
    await runTransformInspectorScenario(ws);
  } else if (scenario === 'object-groups-roundtrip') {
    await runObjectGroupsRoundtripScenario(ws);
  } else if (scenario === 'scene-boundary-roundtrip') {
    await runSceneBoundaryRoundtripScenario(ws);
  } else if (scenario === 'greenroom-picker-display') {
    await runGreenroomPickerDisplayScenario(ws);
  } else if (scenario === 'greenroom-preview-race') {
    await runGreenroomPreviewRaceScenario(ws);
  } else if (scenario === 'greenroom-splat-handoff') {
    await runGreenroomSplatHandoffScenario(ws);
  } else if (scenario === 'splat-asset-inbox') {
    await runSplatAssetInboxScenario(ws);
  } else if (scenario === 'splat-direct-drop-ingest') {
    await runSplatDirectDropIngestScenario(ws);
  } else if (scenario === 'splat-correction-sidecar') {
    await runSplatCorrectionSidecarScenario(ws);
  } else if (scenario === 'splat-correction-mode') {
    await runSplatCorrectionModeScenario(ws);
  } else if (scenario === 'ao-route-delta') {
    await runAoRouteDeltaScenario(ws);
  } else if (scenario === 'viewport-click-select-deselect') {
    await runViewportClickSelectDeselectScenario(ws);
  } else {
    throw new Error(`Unsupported scene object witness scenario: ${scenario}`);
  }

  phase = 'capturing-screenshot';
  const finalShot = await capturePngScreenshot(ws, out);

  phase = 'writing-report';
  const report = {
    ok: true,
    screenshot: out,
    screenshotBytes: finalShot.bytes,
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
