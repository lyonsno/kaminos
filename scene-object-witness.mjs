#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
      const rowState = () => [...document.querySelectorAll('[data-scene-object-id]')].map(row => ({
        id: row.dataset.sceneObjectId,
        active: row.classList.contains('active'),
        pressed: row.getAttribute('aria-pressed'),
        label: row.querySelector('.scene-object-name')?.textContent?.trim() || null,
      }));
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
      if (infoAfterLoad !== 'Scene loaded: 2 objects') {
        throw new Error('scene load did not report two loaded objects: ' + JSON.stringify({ infoAfterLoad }));
      }

      document.querySelector('[data-tab="assets"]').click();
      const cleanup = await deleteScene(savedFile);
      if (cleanup.deleted !== savedFile) {
        throw new Error('cleanup did not delete saved scene file: ' + JSON.stringify({ savedFile, cleanup }));
      }
      const postCleanupFiles = await listScenes();
      if (postCleanupFiles.includes(savedFile)) {
        throw new Error('post-cleanup scene listing still includes saved scene file: ' + JSON.stringify({ savedFile, postCleanupFiles }));
      }
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
        },
        restoredRows,
        activeAfterLoad,
        infoAfterLoad,
        transformBarVisible,
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
        label: row.querySelector('.scene-object-name')?.textContent?.trim() || null,
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
      await deleteScene(volumeSave.savedFile);

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
      await deleteScene(localPreviewFile);

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
      await deleteScene(objectSave.savedFile);

      document.querySelector('[data-tab="assets"]').click();
      return {
        initialRows,
        rowsAfterVolume,
        toolbarAfterVolume,
        volumeInfo,
        volumeSavedObjectCount: (volumeSave.savedScene.objects || []).length,
        volumeSavedPrimitiveCount: volumeSave.savedScene.volumePrimitives?.primitives?.length || 0,
        failedLocalPreviewInfo: failedInfo,
        failedLocalPreviewProtectedSave: protectedSave,
        rowsAfterObject,
        objectInfo,
        objectSavedPrimitiveCount: objectSave.savedScene.volumePrimitives?.primitives?.length || 0,
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
  } else if (scenario === 'scene-boundary-roundtrip') {
    await runSceneBoundaryRoundtripScenario(ws);
  } else {
    throw new Error(`Unsupported scene object witness scenario: ${scenario}`);
  }

  phase = 'capturing-screenshot';
  const shot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(shot.data, 'base64');
  assertPngScreenshot(png);
  mkdirSync(dirname(out), { recursive: true });
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
