#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8097/stage-atoms-browser.html';
const outputPath = resolve(args.get('--out') || 'artifacts/stage-atoms/browser-witness/stage-atoms-live.png');
const inputScenarioOutputPath = resolve(args.get('--input-out') || outputPath.replace(/\.png$/i, '-input.png'));
const outputScenarioOutputPath = resolve(args.get('--output-scenario-out') || outputPath.replace(/\.png$/i, '-output.png'));
const reportPath = resolve(args.get('--report') || outputPath.replace(/\.png$/i, '.json'));
const debugPort = Number(args.get('--debug-port') || 9498);
const viewportWidth = Number(args.get('--viewport-width') || 1600);
const viewportHeight = Number(args.get('--viewport-height') || 980);
const settleMs = Number(args.get('--settle-ms') || 900);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-stage-atoms-witness-${debugPort}-${process.pid}`;

let phase = 'initializing';
let primaryOutputWritten = false;
let inputScenarioOutputWritten = false;
let outputScenarioOutputWritten = false;
let effectiveUrl = null;
let browserVersion = null;
let stderr = '';
let debugState = null;
let playbackState = null;
let visualActivity = null;
let controlBounds = null;
let nodeInterfaceEvidence = null;
let directionalCascadeEvidence = null;
const networkResponses = [];
const consoleEvents = [];

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({
    schema: 'kaminos.stage-atoms-browser-witness.v0',
    requestedUrl,
    effectiveUrl,
    routeIdentity: 'stage-atoms-pulp-shaped-material-spatializer-v0',
    debugPort,
    chrome,
    browserVersion,
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
    phase,
    primaryOutputWritten,
    inputScenarioOutputWritten,
    outputScenarioOutputWritten,
    outputPath,
    inputScenarioOutputPath,
    outputScenarioOutputPath,
    reportPath,
    networkResponses,
    visualActivity,
    controlBounds,
    nodeInterfaceEvidence,
    directionalCascadeEvidence,
    debugState,
    playbackState,
    consoleEvents,
    stderrTail: stderr.slice(-2400),
    ...extra,
  }, null, 2)}\n`);
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(100);
  }
  throw new Error('Chrome page target did not appear');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function dragNodeControl(ws, node, deltaY, steps = 10) {
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: node.point.x, y: node.point.y });
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: node.point.x, y: node.point.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= steps; step += 1) {
    await wsRequest(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: node.point.x,
      y: node.point.y + deltaY * step / steps,
      button: 'left',
      buttons: 1,
    });
  }
  await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: node.point.x, y: node.point.y + deltaY, button: 'left', buttons: 0, clickCount: 1 });
}

async function readMaterialProbe(ws) {
  return evaluate(ws, `(() => ({
    featureIndex: window.kaminosStageAtomsDebugState.featureFrame.index,
    selectedNodeId: window.kaminosStageAtomsDebugState.selectedNodeId,
    nodeControls: window.kaminosStageAtomsDebugState.nodeControls,
    nodeInterfaces: window.kaminosStageAtomsDebugState.nodeInterfaces,
    interaction: window.kaminosStageAtomsDebugState.interaction,
    materialAtoms: window.kaminosStageAtomsDebugState.materialFrame.materialAtoms,
    materialFlows: window.kaminosStageAtomsDebugState.materialFrame.materialFlows,
    emitters: window.kaminosStageAtomsDebugState.spatialization.emitters,
  }))()`);
}

async function captureCredibleScreenshot(ws) {
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const png = Buffer.from(screenshot.data, 'base64');
  if (png.byteLength < 4096 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('captured screenshot is not credible PNG evidence');
  return png;
}

function attachEventReceipts(ws) {
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Network.responseReceived') {
      const response = message.params.response;
      if (/stage-atoms|coruscate-geppetto/i.test(response.url)) {
        networkResponses.push({
          url: response.url,
          status: response.status,
          mimeType: response.mimeType,
          fromDiskCache: response.fromDiskCache,
          fromServiceWorker: response.fromServiceWorker,
        });
      }
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: (message.params.args || []).map(value => value.value || value.description || '').join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'runtime exception',
      });
    }
  });
}

function verifyDebugState(state) {
  if (!state) throw new Error('missing window.kaminosStageAtomsDebugState');
  if (state.status !== 'live') throw new Error(`Stage Atoms route is not live: ${state.status}`);
  if (state.effectiveRoute !== 'stage-atoms-pulp-shaped-material-spatializer-v0') throw new Error(`effective route mismatch: ${state.effectiveRoute}`);
  if (state.fallbackAuthority !== 'none') throw new Error(`fallbackAuthority is not none: ${state.fallbackAuthority}`);
  if (!state.decodedSha256 || state.decodedSha256 !== state.downloadSha256) throw new Error('download/decode hashes are absent or unequal');
  if (state.featureFrame?.index === undefined) throw new Error('decoded audio feature frame missing');
  if (state.materialFrame?.featureAuthority !== 'decoded-audio-clock-frame-v0') throw new Error(`material feature authority mismatch: ${state.materialFrame?.featureAuthority}`);
  if (state.materialFrame?.stateAuthority !== 'bounded-pulp-routed-material-history-v0') throw new Error(`material state authority mismatch: ${state.materialFrame?.stateAuthority}`);
  if (!Array.isArray(state.materialFrame?.materialFlows) || state.materialFrame.materialFlows.length === 0) throw new Error('Pulp-routed material flows missing');
  if (state.spatialization?.spatializationAuthority !== 'material-stage-atoms-v0') throw new Error(`spatialization authority mismatch: ${state.spatialization?.spatializationAuthority}`);
  if (!Array.isArray(state.nodeInterfaces) || state.nodeInterfaces.length !== 4) throw new Error(`direct node interfaces missing: ${state.nodeInterfaces?.length}`);
  const roles = state.nodeInterfaces.map(node => node.role).sort();
  if (JSON.stringify(roles) !== JSON.stringify(['aperture', 'drive', 'recirculation', 'release'])) throw new Error(`node interface roles mismatch: ${JSON.stringify(roles)}`);
}

async function main() {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const target = await waitForTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    attachEventReceipts(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Network.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    phase = 'navigate';
    await wsRequest(ws, 'Page.navigate', { url: requestedUrl });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      debugState = await evaluate(ws, 'window.kaminosStageAtomsDebugState || null');
      if (debugState?.status === 'live' || debugState?.status === 'failed') break;
      await delay(200);
    }
    effectiveUrl = await evaluate(ws, 'window.location.href');
    verifyDebugState(debugState);
    const selectedTime = debugState.representativeSelection?.effectiveTimeSeconds;
    if (!Number.isFinite(selectedTime) || Math.abs(debugState.audioClock.timeSeconds - selectedTime) > 0.15) {
      throw new Error(`representative seek not settled: selected=${selectedTime} audio=${debugState.audioClock.timeSeconds}`);
    }
    await delay(settleMs);

    phase = 'inspect_pixels';
    visualActivity = await evaluate(ws, `(() => {
      const canvas = document.querySelector('#stage-atoms-canvas');
      if (!canvas || !canvas.width || !canvas.height) return { activePixels: 0, reason: 'missing_canvas' };
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let activePixels = 0;
      let coloredPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const max = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
        const min = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
        if (max > 48) activePixels += 1;
        if (max > 78 && max - min > 20) coloredPixels += 1;
      }
      return { width: canvas.width, height: canvas.height, activePixels, coloredPixels };
    })()`);
    if (visualActivity.activePixels < 1000 || visualActivity.coloredPixels < 200) {
      throw new Error(`material canvas failed pixel activity check: ${JSON.stringify(visualActivity)}`);
    }

    phase = 'inspect_control_bounds';
    controlBounds = await evaluate(ws, `(() => {
      const rail = document.querySelector('.instrument-rail').getBoundingClientRect();
      const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const controls = ['stage-atoms-reset', 'stage-atoms-play', 'stage-atoms-seek'].map(id => {
        const rect = document.getElementById(id).getBoundingClientRect();
        const inViewport = rect.left >= viewport.left && rect.top >= viewport.top && rect.right <= viewport.right && rect.bottom <= viewport.bottom;
        const inRail = id === 'stage-atoms-play' || id === 'stage-atoms-seek'
          ? true
          : rect.left >= rail.left && rect.top >= rail.top && rect.right <= rail.right && rect.bottom <= rail.bottom;
        return { id, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, inViewport, inRail };
      });
      const mobile = window.innerWidth <= 820;
      const playable = { left: 0, top: mobile ? 98 : 72, right: mobile ? window.innerWidth : window.innerWidth - 276, bottom: mobile ? window.innerHeight - 294 : window.innerHeight - 92 };
      const nodes = window.kaminosStageAtomsDebugState.nodeInterfaces.map(node => ({
        id: node.id,
        point: node.point,
        inPlayableStage: node.point.x >= playable.left && node.point.x <= playable.right && node.point.y >= playable.top && node.point.y <= playable.bottom,
      }));
      return {
        rail: { left: rail.left, top: rail.top, right: rail.right, bottom: rail.bottom },
        playable,
        controls,
        nodes,
        outOfBounds: [
          ...controls.filter(control => !control.inViewport || !control.inRail).map(control => control.id),
          ...nodes.filter(node => !node.inPlayableStage).map(node => node.id),
        ],
      };
    })()`);
    if (controlBounds.outOfBounds.length) throw new Error(`controls clipped or outside viewport: ${JSON.stringify(controlBounds)}`);

    phase = 'exercise_direct_node_interfaces';
    const baseline = await readMaterialProbe(ws);
    const inputNode = baseline.nodeInterfaces.find(node => node.role === 'drive');
    const outputNode = baseline.nodeInterfaces.find(node => node.role === 'release');
    if (!inputNode || !outputNode) throw new Error('Input or Output direct node interface missing');
    const outputNodeIdLiteral = JSON.stringify(outputNode.id);

    await evaluate(ws, `(() => {
      window.kaminosStageAtomsResetMaterialState();
      for (let step = 0; step < 10; step += 1) window.kaminosMaterialCircuitSetNodeControl(${outputNodeIdLiteral}, 1, 'witness-neutral-control-event');
    })()`);
    await delay(100);
    const neutralSettled = await readMaterialProbe(ws);
    await evaluate(ws, `window.kaminosStageAtomsResetMaterialState()`);
    await delay(50);
    await dragNodeControl(ws, inputNode, -90, 10);
    await delay(120);
    const inputDriven = await readMaterialProbe(ws);
    const baselineField = id => neutralSettled.materialAtoms.find(atom => String(atom.id) === String(id)).field;
    const inputField = id => inputDriven.materialAtoms.find(atom => String(atom.id) === String(id)).field;
    const inputFlow = inputDriven.materialFlows.find(flow => String(flow.sourceId) === String(inputNode.id));
    nodeInterfaceEvidence = {
      roles: Object.fromEntries(baseline.nodeInterfaces.map(node => [node.id, node.role])),
      selectedNodeId: inputDriven.selectedNodeId,
      beforeValue: baseline.nodeControls[inputNode.id],
      afterValue: inputDriven.nodeControls[inputNode.id],
      interaction: inputDriven.interaction,
      pointerChangedSelectedControl: String(inputDriven.selectedNodeId) === String(inputNode.id) && inputDriven.nodeControls[inputNode.id] > 1.75,
    };
    if (!nodeInterfaceEvidence.pointerChangedSelectedControl || inputDriven.interaction.authority !== 'canvas-node-pointer-drag-current-decoded-frame') {
      throw new Error(`direct Input contact failed: ${JSON.stringify(nodeInterfaceEvidence)}`);
    }
    const inputScenarioPng = await captureCredibleScreenshot(ws);
    mkdirSync(dirname(inputScenarioOutputPath), { recursive: true });
    writeFileSync(inputScenarioOutputPath, inputScenarioPng);
    inputScenarioOutputWritten = true;

    await evaluate(ws, `(() => {
      for (const id of Object.keys(window.kaminosStageAtomsDebugState.nodeControls)) window.kaminosMaterialCircuitSetNodeControl(id, 1, 'witness-reset');
      window.kaminosStageAtomsResetMaterialState();
      for (let step = 0; step < 10; step += 1) window.kaminosMaterialCircuitSetNodeControl(${outputNodeIdLiteral}, 1, 'witness-output-neutral-control-event');
    })()`);
    await delay(100);
    const outputNeutralSettled = await readMaterialProbe(ws);
    await evaluate(ws, `window.kaminosStageAtomsResetMaterialState()`);
    await delay(50);
    const resetOutputNode = outputNeutralSettled.nodeInterfaces.find(node => node.role === 'release');
    await dragNodeControl(ws, resetOutputNode, -90, 10);
    await delay(120);
    const outputReleased = await readMaterialProbe(ws);
    const outputBaselineField = id => outputNeutralSettled.materialAtoms.find(atom => String(atom.id) === String(id)).field;
    const outputField = id => outputReleased.materialAtoms.find(atom => String(atom.id) === String(id)).field;
    const baselineOutputSend = outputNeutralSettled.emitters.find(emitter => String(emitter.id) === String(outputNode.id)).send;
    const releasedOutputSend = outputReleased.emitters.find(emitter => String(emitter.id) === String(outputNode.id)).send;
    const inputLocalDelta = inputField(inputNode.id).excitation - baselineField(inputNode.id).excitation;
    const inputDownstreamDelta = inputField(outputNode.id).heat - baselineField(outputNode.id).heat;
    const outputUpstreamDelta = Math.abs(outputField(inputNode.id).heat - outputBaselineField(inputNode.id).heat);
    directionalCascadeEvidence = {
      sourceFeatureIndex: neutralSettled.featureIndex,
      inputDrivenFeatureIndex: inputDriven.featureIndex,
      outputNeutralFeatureIndex: outputNeutralSettled.featureIndex,
      outputReleasedFeatureIndex: outputReleased.featureIndex,
      inputScenario: {
        localExcitationDelta: inputLocalDelta,
        downstreamOutputHeatDelta: inputDownstreamDelta,
        outgoingFlow: inputFlow,
      },
      outputScenario: {
        upstreamInputHeatDelta: outputUpstreamDelta,
        outputDirectBefore: baselineOutputSend.direct,
        outputDirectAfter: releasedOutputSend.direct,
      },
      identicalDecodedFrame: neutralSettled.featureIndex === inputDriven.featureIndex && neutralSettled.featureIndex === outputNeutralSettled.featureIndex && neutralSettled.featureIndex === outputReleased.featureIndex,
      transitionCountMatched: inputDriven.interaction.count - neutralSettled.interaction.count === 10 && outputReleased.interaction.count - outputNeutralSettled.interaction.count === 10,
      upstreamCascadeChanged: inputLocalDelta > 0.08 && inputDownstreamDelta > 0.025 && inputFlow?.activity > 0.05,
      downstreamStayedLocal: outputUpstreamDelta < Math.max(0.015, inputLocalDelta * 0.2) && releasedOutputSend.direct > baselineOutputSend.direct + 0.06,
    };
    if (!directionalCascadeEvidence.identicalDecodedFrame || !directionalCascadeEvidence.transitionCountMatched || !directionalCascadeEvidence.upstreamCascadeChanged || !directionalCascadeEvidence.downstreamStayedLocal) {
      throw new Error(`node-local directional cascade failed: ${JSON.stringify(directionalCascadeEvidence)}`);
    }
    const outputScenarioPng = await captureCredibleScreenshot(ws);
    mkdirSync(dirname(outputScenarioOutputPath), { recursive: true });
    writeFileSync(outputScenarioOutputPath, outputScenarioPng);
    outputScenarioOutputWritten = true;

    phase = 'exercise_audio_handle';
    const playRect = await evaluate(ws, `(() => {
      const rect = document.querySelector('#stage-atoms-play').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: playRect.x, y: playRect.y, button: 'left', clickCount: 1 });
    await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: playRect.x, y: playRect.y, button: 'left', clickCount: 1 });
    const playbackStart = debugState.audioClock.timeSeconds;
    await delay(1200);
    playbackState = await evaluate(ws, 'window.kaminosStageAtomsDebugState');
    verifyDebugState(playbackState);
    if (playbackState.audioClock.paused) throw new Error('play handle did not start verified source audio');
    if (playbackState.audioClock.timeSeconds <= playbackStart + 0.4) throw new Error('audio clock did not advance after play handle');
    if (playbackState.audioGraph?.sendCount <= 0) throw new Error('material spatialization created no audio sends');
    if (playbackState.audioGraph?.outputRms <= 0.0001 || playbackState.audioGraph?.outputPeak <= 0.0001) {
      throw new Error(`post-spatialization audio output is silent: ${JSON.stringify(playbackState.audioGraph)}`);
    }

    phase = 'verify_network';
    const reportResponse = networkResponses.find(response => response.url.includes('ccmixter-geppetto-decoded-stage-atoms-witness.json'));
    const audioResponse = networkResponses.find(response => response.url.includes('coruscate-geppetto-dry-main.mp3'));
    if (!reportResponse || reportResponse.status !== 200) throw new Error('decoded report network response missing');
    if (!audioResponse || audioResponse.status !== 200 || !audioResponse.mimeType.startsWith('audio/')) throw new Error('verified audio network response missing');

    phase = 'capture_screenshot';
    const png = await captureCredibleScreenshot(ws);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, png);
    primaryOutputWritten = true;
    phase = null;
    writeReport({ ok: true });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  writeReport({ ok: false, error: String(error?.message || error) });
  console.error(error);
  process.exitCode = 1;
});
