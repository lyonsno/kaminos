#!/usr/bin/env node
// Uses the ordinary cockpit + native sampleFrame contract, as the existing
// volume/source-law witnesses do. Fixed-step replay supplies reproducible inputs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { assertArmEquivalent } from './volume-physical-color-witness-contract.mjs';
const [url, output, expectedRoot, expectedCommit, armsPath] = process.argv.slice(2);
assert.ok(output, 'usage: URL OUT_DIR REPO_ROOT COMMIT');
const out = resolve(output);
mkdirSync(out, { recursive: true });
const report = { status: 'running', url, expectedRoot, expectedCommit, phase: 'source', captures: [] };
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(report, null, 2));
save();
let browser, ws;
let serial = 0;
const pending = new Map();
const delay = ms => new Promise(r => setTimeout(r, ms));
function call(method, params = {}) {
  if (ws?.readyState !== 1) return Promise.reject(new Error('CDP transport is not open'));
  const id = ++serial;
  return new Promise((resolveCall, rejectCall) => {
    pending.set(id, { resolveCall, rejectCall });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  // Native readbacks include multi-megabyte field evidence. Sending one CDP
  // return closed this Chrome connection (1006); transfer ALL text in pieces.
  const result = await call('Runtime.evaluate', { expression: `(async()=>{window.__physicalColorWitnessJSON=JSON.stringify(await (${expression}));return window.__physicalColorWitnessJSON.length})()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const length = result.result.value;
  assert.ok(Number.isSafeInteger(length) && length >= 0, 'missing serialized witness');
  let text = '';
  const transferSize = 256 * 1024; // Transport framing, never a total data cap.
  for (let offset = 0; offset < length; offset += transferSize) {
    const part = await call('Runtime.evaluate', { expression: `window.__physicalColorWitnessJSON.slice(${offset},${offset+transferSize})`, returnByValue: true });
    if (part.exceptionDetails) throw new Error(JSON.stringify(part.exceptionDetails));
    assert.equal(part.result.value?.length, Math.min(transferSize, length-offset), 'partial witness transfer');
    text += part.result.value;
  }
  return JSON.parse(text);
}
try {
  const response = await fetch(new URL('/api/runtime-config', url));
  assert.ok(response.ok);
  report.source = await response.json();
  assert.equal(report.source.source.repoRoot, expectedRoot, 'wrong source root');
  assert.equal(report.source.source.commit, expectedCommit, 'wrong source commit');
  assert.equal(report.source.source.dirty, false, 'dirty source');
  report.phase = 'browser'; save();
  const profile = mkdtempSync('/private/tmp/kaminos-physical-color-');
  browser = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, '--window-size=1200,1000', '--no-first-run',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const browserSocket = await new Promise((resolveSocket, rejectSocket) => {
    browser.once('error', rejectSocket);
    browser.once('exit', code => rejectSocket(new Error(`Chrome exited ${code}`)));
    browser.stderr.on('data', chunk => {
      stderr += chunk;
      writeFileSync(join(out, 'chrome.stderr.log'), stderr);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) resolveSocket(match[1]);
    });
  });
  const origin = browserSocket.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const targets = await (await fetch(`${origin}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', j, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    if (message.error) p.rejectCall(new Error(JSON.stringify(message.error))); else p.resolveCall(message.result);
  });
  const rejectPending = error => {
    for (const p of pending.values()) p.rejectCall(error);
    pending.clear();
  };
  ws.addEventListener('close', event => rejectPending(new Error(`CDP closed ${event.code}: ${event.reason}`)));
  ws.addEventListener('error', () => rejectPending(new Error('CDP transport error')));
  await call('Runtime.enable'); await call('Page.enable');
  report.phase = 'load'; save();
  let state;
  const deadline = Date.now() + 60000; // Existing browser-load witness deadline; not a data cap.
  do {
    state = await evaluate('window.__kaminosVolumePrototype?.debugState?.() ?? null');
    if (state?.error) throw new Error(state.error);
    if (state?.active && state.frameCount > 2) break;
    await delay(250);
  } while (Date.now() < deadline);
  report.initialState = state;
  assert.ok(state?.active, 'ordinary volume did not load');
  assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(state.fireRenderMode, 'inspect'); assert.equal(state.shellInspectMode, 'boundary_fire');
  assert.match(state.backend, /apple/i, 'not the Apple GPU route');
  report.phase = 'fixed-step-replay'; save();
  report.replay = await evaluate('window.__kaminosVolumePrototype.sampleDeterministicReplayFrame({steps:160,startTimeMs:1000,timeStepMs:1000/60})');
  assert.equal(report.replay.completedSteps, 160);
  const arms = armsPath ? JSON.parse(readFileSync(armsPath,'utf8')) : [
    { id: 'legacy', mode: 0, temperature: 1900, ev: 0 },
    { id: 'thermal-1900', mode: 1, temperature: 1900, ev: 0 },
    { id: 'thermal-1900-plus-one', mode: 1, temperature: 1900, ev: 1 },
    { id: 'thermal-2400', mode: 1, temperature: 2400, ev: 0 },
    { id: 'legacy-return', mode: 0, temperature: 1900, ev: 0 },
  ];
  assert.ok(Array.isArray(arms) && arms.length > 0, 'no capture arms');
  report.arms = arms;
  const earlierRgba = new Map();
  for (const arm of arms) {
    assert.match(arm.id,/^[a-z0-9-]+$/, 'unsafe capture identifier');
    assert.ok(!earlierRgba.has(arm.id), 'duplicate capture identifier');
    report.phase = arm.id; save();
    const result = await evaluate(`(async () => {
      const changes = ${JSON.stringify({...arm.controls, 'volume-physical-mode':arm.mode, 'volume-physical-temperature':arm.temperature, 'volume-physical-exposure':arm.ev})};
      for (const [id, value] of Object.entries(changes)) {
        const input = document.getElementById(id); input.value = String(value); input.dispatchEvent(new Event('input', {bubbles:true}));
      }
      const core = window.__kaminosVolumePrototype;
      const sample = await core.sampleFrame({advanceSim:false,includeRgba:true,now:${report.replay.finalTimeMs}});
      if (!sample.ok || sample.simAdvanced || !sample.image) throw new Error('native sample failed');
      const {width,height,rgba} = sample.image;
      if (rgba.length !== width*height*4) throw new Error('partial RGBA');
      const image = document.createElement('canvas'); image.width=width; image.height=height;
      image.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(rgba),width,height),0,0);
      const profile = ${arm.profile === true && arm.mode === 2} ? await core.sampleEmissiveLightProfile() : null;
      if (profile && !profile.ok) throw new Error('native timing failed: '+profile.reason);
      return {sample, profile, state:core.debugState(), png:image.toDataURL('image/png').split(',')[1]};
    })()`);
    assert.equal(result.state.simStepCount, 160, 'color edit advanced/reset fluid');
    assert.equal(result.state.physicalColor.effective, arm.mode === 2 ? 'emissive-transport-v2' : arm.mode ? 'thermal-reaction-v1' : 'legacy');
    assert.equal(result.state.physicalColor.exposureEV, arm.ev);
    assert.equal(result.state.physicalColor.temperature, arm.temperature);
    assert.ok(result.sample.litPixels > 0, 'blank native frame');
    writeFileSync(join(out, `${arm.id}.png`), Buffer.from(result.png, 'base64'));
    writeFileSync(join(out, `${arm.id}.rgba`), Buffer.from(result.sample.image.rgba));
    const rgba = Buffer.from(result.sample.image.rgba);
    assertArmEquivalent(arm,rgba,earlierRgba);
    earlierRgba.set(arm.id,rgba);
    const {image, ...sample} = result.sample;
    report.captures.push({arm, sample, profile:result.profile, state:result.state, image:{width:image.width,height:image.height,path:`${arm.id}.png`}});
  }
  const screenshot = await call('Page.captureScreenshot', {format:'png'});
  writeFileSync(join(out, 'cockpit.png'), Buffer.from(screenshot.data, 'base64'));
  report.status = 'captured'; report.phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  save(); ws?.close(); browser?.kill('SIGTERM');
  console.log(JSON.stringify({status:report.status,phase:report.phase,receipt:join(out,'receipt.json'),error:report.error}));
}
