import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {cdpRequest} from './diagnostic-cdp.mjs';

const out = process.argv[2];
const mode = process.argv[3] || 'exposure';
assert.ok(out, 'explicit evidence output directory required');
mkdirSync(out, {recursive: true});
const report = {status: 'running', scope: 'spatial-assay-inspection-required', phase: 'preflight', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), gitStatus: execFileSync('git', ['status', '--short'], {encoding: 'utf8'}).trim(), repoRoot: process.cwd(), requestedMode: mode, browser: {executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, pid: 1631}, frames: [], errors: []};
const save = () => writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
save();
let ws;
const evaluate = async expression => {
  const result = await cdpRequest(ws, 'Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
};
const snapshot = () => evaluate(`(() => { const s=window.__kaminosVolumePrototype?.debugState?.(); if(!s)return null; return {url:location.href,backend:s.backend,error:s.error,grid:s.simGrid,gridDimensions:s.simGridDimensions,effectiveRoute:s.effectiveRoute,assembly:s.gpuStructuralCombustionAssembly,source:s.combustibleObjectSource,sceneStatus:document.getElementById('info-bar')?.textContent,basin:window.__kaminosDefaultVolumeSmokeBasin?.presetId,objects:window.kaminosSceneObjectDebugState?.(),camera:window.kaminosCameraDebugState?.()}; })()`);
const wait = async predicate => {
  const end = Date.now() + 180000;
  let state;
  do {
    state = await snapshot();
    if (state?.error) throw Error(state.error);
    if (predicate(state)) return state;
    if (Date.now() > end) throw Error(`assay wait failed: ${JSON.stringify(state)}`);
    await delay(50);
  } while(true);
};
try {
  assert.ok(['off','exposure','material'].includes(mode), 'unsupported spatial assay view');
  report.phase = 'connect'; save();
  const targets = await (await fetch('http://127.0.0.1:43992/json/list')).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, {once: true}));
  await cdpRequest(ws, 'Runtime.enable');
  await cdpRequest(ws, 'Log.enable');
  await cdpRequest(ws, 'Emulation.setFocusEmulationEnabled', {enabled: true});
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') report.errors.push(message.params.entry);
  });
  const route = `http://127.0.0.1:18100/?kaminos_volume_smoke=1&volume_resolution=48&volume_structural_combustion_view=${mode}#authoring=1&scene=sinter-forked-timber-combustion.kaminos.json`;
  await cdpRequest(ws, 'Page.navigate', {url: route});
  await wait(state => state?.assembly?.dispatchCount > 0);
  await evaluate(`window.kaminosSetCameraDebugPose({position:[4.5,2.4,5.5],target:[0.7,0.3,0]})`);
  const poses = [
    {name: 'cold-outside', position: [2.5,0,0], rotation: [0,0,0], scale: [1,1,1], steps: 180},
    {name: 'contact-rotated-scaled', position: [0,-0.5,0], rotation: [0,0,0.35], scale: [0.8,0.8,0.8], steps: 120},
    {name: 'removed-hot-object', position: [2.5,-0.5,0], rotation: [0,0,0.35], scale: [0.8,0.8,0.8], steps: 90},
    {name: 'returned-contact', position: [0,-0.5,0], rotation: [0,0,-0.35], scale: [0.8,0.8,0.8], steps: 120},
  ];
  for (const pose of poses) {
    report.phase = pose.name; save();
    const before = (await snapshot()).assembly.dispatchCount;
    const effectivePose = await evaluate(`window.kaminosSetSceneObjectTransform('sinter-forked-timber-trestle', ${JSON.stringify(pose)})`);
    const state = await wait(state => state?.assembly?.dispatchCount >= before + pose.steps);
    assert.equal(state.backend, 'WebGPU:apple'); assert.equal(state.grid, 48);
    assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
    assert.equal(state.assembly.presentationDebugMode, mode);
    assert.equal(state.basin, 'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b');
    assert.ok(state.assembly.meshAssetIdentities.includes('sha256:1270054ee62bd3c5c688b13e7334f9ae99280f5868b2121fd317b4dffe5d2b84'));
    assert.deepEqual(state.assembly.gridDimensions, [48,96,48]);
    assert.equal(state.assembly.meshTriangleCount, 864);
    assert.equal(state.assembly.runtimeReadbackCount, 0);
    assert.equal(state.source.sameDevice, true);
    assert.equal(state.assembly.spatialTransforms[0].authority, 'saved-object-world-to-current-pyro-domain-v0');
    const image = await cdpRequest(ws, 'Page.captureScreenshot', {format: 'png', fromSurface: true});
    writeFileSync(`${out}/${pose.name}.png`, Buffer.from(image.data, 'base64'));
    report.frames.push({pose, effectivePose, state, image: `${out}/${pose.name}.png`}); save();
  }
  assert.deepEqual(report.errors, []);
  report.status = 'captured-inspection-required'; report.phase = 'complete';
} catch(error) {report.status = 'failed'; report.error = String(error.stack); process.exitCode = 1;}
finally {ws?.close(); report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({status: report.status, frames: report.frames.map(frame => ({name: frame.pose.name, dispatches: frame.state.assembly.dispatchCount})), out}));}
