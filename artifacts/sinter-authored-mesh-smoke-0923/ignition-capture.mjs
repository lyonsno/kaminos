import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, realpathSync, openSync, closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {cdpRequest} from './diagnostic-cdp.mjs';
import {assertIgnitionCaptureState, ignitionCaptureBrowserArguments} from './ignition-capture-contract.mjs';

const out = resolve(process.argv[2] || 'artifacts/sinter-authored-mesh-smoke-0923/ignition48-1001');
let protocol = {
  view: 'material', emissionCases: [false, true], primeSteps: [140], warmupSteps: 0,
  sourcePose: null, primeOnly: false,
  transferSourcePose: {position: [0.6, -0.55, 0]},
  transferReceiverPose: {position: [0.6, 0.1, 0]}, transferSteps: [60, 120, 180],
};
mkdirSync(out, {recursive: true});
const report = {status: 'running', phase: 'preflight', receiver: 'sinter-timber-ignition',
  command: process.argv, repoRoot: process.cwd(), terminalEvidence: join(out, 'report.json'),
  startedAt: new Date().toISOString(), protocol, runs: [], errors: [], scope: 'matched-visual-experiment-inspection-required'};
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
save();
let browser, ws, logFd, browserExit;
const evaluate = async expression => {
  const result = await cdpRequest(ws, 'Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
};
const snapshot = () => evaluate(`(() => { const s=window.__kaminosVolumePrototype?.debugState?.(); if(!s)return null; return {
  url:location.href,backend:s.backend,error:s.error,grid:s.simGrid,gridDimensions:s.simGridDimensions,
  effectiveRoute:s.effectiveRoute,simStepCount:s.simStepCount,simulationPaused:s.simulationPaused,
  assembly:s.gpuStructuralCombustionAssembly,source:s.combustibleObjectSource,
  controls:s.controls,coreEmitter:s.coreEmitterSourceReceipt,
  basin:window.__kaminosDefaultVolumeSmokeBasin?.presetId,
  objects:window.kaminosSceneObjectDebugState?.(),camera:window.kaminosCameraDebugState?.(),
  sceneStatus:document.getElementById('info-bar')?.textContent}; })()`);
const wait = async predicate => {
  const started = Date.now();
  for (;;) {
    const state = await snapshot();
    report.lastRuntimeState = state;
    if (state?.error) throw Error(state.error);
    if (predicate(state)) return state;
    if (Date.now() - started > 180000) throw Error(`runtime did not reach the named phase: ${JSON.stringify(state)}`);
    await delay(100);
  }
};
try {
  if (process.argv[4]) protocol = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  report.protocol = protocol;
  assert.ok(['material', 'exposure', 'off'].includes(protocol.view), 'unsupported capture view');
  const headless = protocol.headless ?? true;
  assert.equal(typeof headless, 'boolean', 'capture headless mode must be boolean');
  report.driverSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
  report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  report.gitStatus = execFileSync('git', ['status', '--short'], {encoding: 'utf8'}).trim();
  report.server = await (await fetch('http://127.0.0.1:18100/api/runtime-config')).json();
  const executable = realpathSync(process.argv[3] || '/Users/noahlyons/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  assert.ok(!executable.startsWith('/Applications/Google Chrome.app/'), 'independent capture browser required');
  const profile = mkdtempSync(join(tmpdir(), 'sinter-ignition48-'));
  const args = ignitionCaptureBrowserArguments({profile, headless});
  report.browser = {executable, profile, args, headless};
  report.phase = 'browser-launch'; save();
  logFd = openSync(join(out, 'browser.log'), 'w');
  browser = spawn(executable, args, {stdio: ['ignore', logFd, logFd]});
  browserExit = new Promise(resolveExit => {
    browser.once('error', error => resolveExit({error: String(error)}));
    browser.once('exit', (code, signal) => resolveExit({code, signal}));
  });
  report.browser.pid = browser.pid;
  const portFile = join(profile, 'DevToolsActivePort');
  const portWait = Date.now();
  while (!existsSync(portFile)) {
    if (browser.exitCode !== null || !browser.pid) throw Error('capture browser failed to launch');
    if (Date.now() - portWait > 30000) throw Error('capture browser did not publish its debug endpoint');
    await delay(100);
  }
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  report.browser.port = port;
  report.browser.version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  report.browser.command = execFileSync('ps', ['-p', String(browser.pid), '-o', 'command='], {encoding: 'utf8'}).trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', resolveOpen, {once: true});
    ws.addEventListener('error', reject, {once: true});
  });
  await cdpRequest(ws, 'Runtime.enable');
  await cdpRequest(ws, 'Log.enable');
  await cdpRequest(ws, 'Page.enable');
  if (!headless) await cdpRequest(ws, 'Page.bringToFront');
  await cdpRequest(ws, 'Emulation.setFocusEmulationEnabled', {enabled: true});
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') report.errors.push(message.params.entry);
  });
  const scene = JSON.parse(readFileSync('scenes/sinter-timber-ignition-pair.kaminos.json', 'utf8'));
  const capture = async (run, name) => {
    const state = await snapshot();
    assertIgnitionCaptureState(state, {emissionEnabled: run.emissionEnabled, objectIds: scene.objects.map(object => object.id), view: protocol.view});
    const screenshot = await cdpRequest(ws, 'Page.captureScreenshot', {format: 'png', fromSurface: true});
    const path = join(out, `${run.name}-${name}.png`);
    writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
    run.frames.push({name, state, path}); save();
  };
  const advance = async steps => {
    const receipt = await evaluate(`(() => {const v=window.__kaminosVolumePrototype;const s=v.debugState();return v.pauseSelectiveHeadLiveAtSimStep(s.simStepCount+${steps});})()`);
    assert.equal(receipt.ok, true); assert.equal(receipt.gpuComplete, true);
    return receipt;
  };
  for (const emissionEnabled of protocol.emissionCases) {
    const run = {name: emissionEnabled ? 'emission-on' : 'emission-off', emissionEnabled, frames: [], phases: []};
    report.runs.push(run);
    report.phase = `${run.name}-load`; save();
    run.scene = structuredClone(scene);
    run.scene.objects.forEach(object => {object.combustionBinding.emissionEnabled = emissionEnabled;});
    if (protocol.sourcePose) Object.assign(run.scene.objects.find(object => object.id === 'sinter-source-timber').transform, protocol.sourcePose);
    run.scene.objects.find(object => object.id === 'sinter-receiver-timber').transform.position = [2.5, 0.1, 0];
    const sceneText = JSON.stringify(run.scene);
    run.inputSha256 = createHash('sha256').update(sceneText).digest('hex');
    writeFileSync(join(out, `${run.name}-input.kaminos.json`), sceneText);
    const route = `http://127.0.0.1:18100/?kaminos_volume_smoke=1&volume_resolution=48&volume_structural_combustion_view=${protocol.view}`;
    await cdpRequest(ws, 'Page.navigate', {url: route});
    await wait(state => state?.backend === 'WebGPU:apple' && state.simStepCount > 0);
    if (protocol.warmupSteps) run.warmup = await advance(protocol.warmupSteps);
    run.selectedFile = await evaluate(`(() => {const input=document.getElementById('scene-file-input');const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(sceneText)}], 'sinter-timber-ignition-pair.kaminos.json', {type:'application/json'}));input.files=dt.files;const name=input.files[0].name;input.dispatchEvent(new Event('change',{bubbles:true}));return name;})()`);
    if (protocol.warmupSteps) run.resumeAfterWarmup = await evaluate(`window.__kaminosVolumePrototype.setSelectiveHeadLiveCapturePaused(false)`);
    await wait(state => state?.assembly?.structureCount === 2 && state.assembly.dispatchCount > 0);
    await evaluate(`window.kaminosSetCameraDebugPose({position:[3.1,1.4,4],target:[0.6,-0.2,0]})`);
    run.phases.push({name: 'cold', pause: await advance(1)});
    await capture(run, 'cold');
    report.phase = `${run.name}-prime-source`; save();
    for (const steps of protocol.primeSteps) {
      const name = `primed-${run.phases.filter(phase => phase.name.startsWith('primed')).length + 1}`;
      run.phases.push({name, pause: await advance(steps)});
      await capture(run, name);
    }
    if (protocol.primeOnly) continue;
    report.phase = `${run.name}-burner-off-and-place`; save();
    run.manipulation = await evaluate(`(() => {const v=window.__kaminosVolumePrototype;v.setControls({flowRate:0});const burnerShutdown=v.setAnalyticEmitterDescriptor(null);return {
      burnerShutdown,
      source:window.kaminosSetSceneObjectTransform('sinter-source-timber',${JSON.stringify(protocol.transferSourcePose)}),
      receiver:window.kaminosSetSceneObjectTransform('sinter-receiver-timber',${JSON.stringify(protocol.transferReceiverPose)}),
      state:v.debugState()};})()`);
    for (const steps of protocol.transferSteps) {
      report.phase = `${run.name}-transfer-${steps}`; save();
      run.phases.push({name: `transfer-${steps}`, pause: await advance(steps)});
      await capture(run, `transfer-${steps}`);
    }
  }
  assert.deepEqual(report.errors, []);
  report.status = 'captured-inspection-required'; report.phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack); process.exitCode = 1; save();
} finally {
  ws?.close();
  if (browser?.pid && browser.exitCode === null) browser.kill('SIGTERM');
  if (browserExit) report.browserExit = await browserExit;
  if (logFd !== undefined) closeSync(logFd);
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({status: report.status, phase: report.phase, out, frames: report.runs.map(run => ({name: run.name, frames: run.frames.length}))}));
}
