import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=', 2);
  const value = inline ?? (process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[++i]);
  args.set(key, value);
}

const chrome = args.get('chrome') || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const appUrl = args.get('url') || `http://localhost:60105/?pipeline_ui_witness=${Date.now()}`;
const port = Number(args.get('port') || process.env.KAMINOS_UI_WITNESS_CDP_PORT || 63112);
const assetNeedle = args.get('asset') || 'evil_orb_outer_shell_source_image';
const secondAssetNeedle = args.get('second-asset') || 'pipeline-test-image-alt.png';
const scenario = args.get('scenario') || 'image-import';
const generatorId = args.get('generator-id') || 'sharp';
const pipelineId = args.get('pipeline-id') || 'sharp-image-to-splat-live-v0';
const expectedArtifactRole = args.get('artifact-role') || (pipelineId === 'sharp-image-to-splat-live-v0' ? 'splat-candidate' : 'splat');
const expectsLoadableArtifact = expectedArtifactRole.includes('splat');
const expectsFixture = args.get('expect-fixture') === '1' || pipelineId.includes('fixture');
const graphExecuteTimeoutMs = Number(args.get('graph-execute-timeout-ms') || (pipelineId === 'sharp-image-to-splat-live-v0' ? 240000 : 90000));
const mockSharpProgressEnv = 'KAMINOS_MOCK_SHARP_PROGRESS';
const beforePath = args.get('before') || '/tmp/kaminos-pipeline-ui-witness-before.png';
const afterPath = args.get('after') || '/tmp/kaminos-pipeline-ui-witness-after.png';
const historyPath = args.get('history') || '/tmp/kaminos-pipeline-ui-witness-history.png';
const userDataDir = await mkdtemp(join(tmpdir(), 'kaminos-pipeline-ui-witness-'));
let stderr = '';

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      return await cdpFetch('/json/version');
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for CDP');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
    else resolve(message.result || {});
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    opened,
    send(method, params = {}) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method}: CDP request timed out`));
        }, 15000);
        pending.set(id, {
          resolve: result => {
            clearTimeout(timer);
            resolve(result);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
    close() {
      ws.close();
    },
  };
}

async function evalJson(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function dispatchMouse(cdp, type, point, buttons) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x: Math.round(point.x),
    y: Math.round(point.y),
    button: 'left',
    buttons,
    clickCount: 1,
  });
}

async function click(cdp, point) {
  await dispatchMouse(cdp, 'mouseMoved', point, 0);
  await wait(40);
  await dispatchMouse(cdp, 'mousePressed', point, 1);
  await wait(40);
  await dispatchMouse(cdp, 'mouseReleased', point, 0);
  await wait(500);
}

async function drag(cdp, from, to) {
  await dispatchMouse(cdp, 'mouseMoved', from, 0);
  await dispatchMouse(cdp, 'mousePressed', from, 1);
  for (let i = 1; i <= 12; i += 1) {
    await dispatchMouse(cdp, 'mouseMoved', {
      x: from.x + ((to.x - from.x) * i) / 12,
      y: from.y + ((to.y - from.y) * i) / 12,
    }, 1);
    await wait(25);
  }
  await dispatchMouse(cdp, 'mouseReleased', to, 0);
  await wait(500);
}

function assertWitness(condition, message, detail = {}) {
  if (condition) return;
  const error = new Error(message);
  error.detail = detail;
  throw error;
}

async function capture(cdp, path) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(path, Buffer.from(shot.data, 'base64'));
}

function parsePngRgba(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = null;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!width || !height || !bpp) throw new Error(`unsupported PNG screenshot color type: ${colorType}`);
  const inflated = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset++];
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bpp ? previous[x - bpp] || 0 : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        if (pa <= pb && pa <= pc) return left;
        return pb <= pc ? up : upLeft;
      })();
      row[x] = (raw + [0, left, up, Math.floor((left + up) / 2), paeth][filter]) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * bpp;
      const dst = (y * width + x) * 4;
      rgba[dst + 0] = row[src + 0];
      rgba[dst + 1] = row[src + 1];
      rgba[dst + 2] = row[src + 2];
      rgba[dst + 3] = bpp === 4 ? row[src + 3] : 255;
    }
    previous = row;
  }
  return { width, height, rgba };
}

async function screenshotVisibleProbe(path, rect = null) {
  const parsed = parsePngRgba(await readFile(path));
  const x0 = Math.max(0, Math.floor(rect?.x || 0));
  const y0 = Math.max(0, Math.floor(rect?.y || 0));
  const x1 = Math.min(parsed.width, Math.ceil((rect?.x || 0) + (rect?.width || parsed.width)));
  const y1 = Math.min(parsed.height, Math.ceil((rect?.y || 0) + (rect?.height || parsed.height)));
  let visiblePixels = 0;
  let saturatedPixels = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * parsed.width + x) * 4;
      const r = parsed.rgba[offset + 0];
      const g = parsed.rgba[offset + 1];
      const b = parsed.rgba[offset + 2];
      const a = parsed.rgba[offset + 3];
      if (a <= 8 || r + g + b <= 24) continue;
      visiblePixels += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45) saturatedPixels += 1;
    }
  }
  return {
    sampled: true,
    width: parsed.width,
    height: parsed.height,
    rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    visiblePixels,
    saturatedPixels,
  };
}

async function waitFor(cdp, expression, label, timeoutMs = 90000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await evalJson(cdp, expression);
      if (last?.ok) return last;
    } catch (error) {
      last = { error: error.message };
    }
    await wait(500);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

const chromeProcess = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--headless=new',
  '--disable-gpu-sandbox',
  '--window-size=2048,1180',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chromeProcess.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

let cdp = null;
try {
  await waitForCdp();
  const targets = await cdpFetch('/json/list');
  const target = targets.find(item => item.type === 'page') || targets[0];
  assertWitness(target?.webSocketDebuggerUrl, 'No debuggable page target');
  cdp = connect(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2048,
    height: 1180,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send('Page.navigate', { url: appUrl });
  await wait(2500);

  const pipelineTab = await evalJson(cdp, `(() => {
    const element = document.querySelector('[data-tab="pipeline"]');
    const rect = element?.getBoundingClientRect();
    if (!rect) throw new Error('Pipeline tab missing');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(cdp, pipelineTab);

  const imagePaletteTab = await evalJson(cdp, `(() => {
    const element = document.querySelector('[data-pipeline-asset-palette="image"]');
    const rect = element?.getBoundingClientRect();
    if (!rect) throw new Error('Images palette tab missing');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await click(cdp, imagePaletteTab);
  await wait(1000);

  if (scenario === 'graph-execute-sharp' || scenario === 'graph-execute-sharp-repeat' || scenario === 'graph-execute-artifact') {
    const generatorCard = await evalJson(cdp, `(() => {
      const element = [...document.querySelectorAll('[data-pipeline-generator-id]')]
        .find(item => item.dataset.pipelineGeneratorId === ${JSON.stringify(generatorId)});
      const canvas = document.querySelector('#pipeline-graph-canvas');
      element?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const rect = element?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      if (!rect) throw new Error('Pipeline generator card missing');
      if (!canvasRect) throw new Error('Pipeline graph canvas missing for generator drop');
      return {
        cardText: element.innerText,
        pipelineGeneratorId: element.dataset.pipelineGeneratorId,
        backendPipelineId: element.dataset.pipelineGeneratorPipelineId || null,
        visible: rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.top < window.innerHeight,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        drop: { x: canvasRect.left + canvasRect.width * 0.34, y: canvasRect.top + canvasRect.height * 0.40 },
      };
    })()`);
    assertWitness(generatorCard.pipelineGeneratorId === generatorId && generatorCard.backendPipelineId === pipelineId, 'Generator card did not preserve generic id plus backend route binding', generatorCard);
    assertWitness(generatorCard.visible, 'Requested generator card was not visible before drag', generatorCard);
    await drag(cdp, generatorCard.point, generatorCard.drop);
    const generatorSelected = await evalJson(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      return {
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        routeTexts: [...document.querySelectorAll('[data-pipeline-graph-node-id]')].map(item => item.innerText),
      };
    })()`);
    if (generatorSelected.selectedGeneratorId !== generatorId || generatorSelected.selectedPipelineId !== pipelineId) {
      await click(cdp, generatorCard.point);
      await wait(300);
    }
    const imageCard = await evalJson(cdp, `(() => {
      const cards = [...document.querySelectorAll('.pipeline-asset-card')];
      const card = cards.find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
      const canvas = document.querySelector('#pipeline-graph-canvas');
      if (!card) throw new Error('Requested visible image asset card missing');
      if (!canvas) throw new Error('Pipeline graph canvas missing for image drop');
      const rect = card.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        cardText: card.innerText,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        drop: { x: canvasRect.left + canvasRect.width * 0.73, y: canvasRect.top + canvasRect.height * 0.32 },
      };
    })()`);
    await drag(cdp, imageCard.point, imageCard.drop);

    const routeNode = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const routeRecord = state?.graphRouteNodes?.at(-1) || state?.graphRouteNodes?.[0] || null;
      const nodes = [...document.querySelectorAll('[data-pipeline-graph-node-id]')];
      const element = (routeRecord ? document.querySelector(\`[data-pipeline-graph-node-id="\${routeRecord.id}"]\`) : null)
        || nodes.find(item => item.innerText.includes(${JSON.stringify(pipelineId)}))
        || nodes.find(item => item.innerText.toLowerCase().includes(${JSON.stringify(generatorId)}))
        || nodes.find(item => item.dataset.pipelineGraphNodeId === 'route');
      const rect = element?.getBoundingClientRect();
      return {
        ok: Boolean(rect),
        routeNodeId: element?.dataset?.pipelineGraphNodeId || null,
        nodeText: element?.innerText || '',
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphEdges: state?.graphEdges || [],
        graphRouteNodes: state?.graphRouteNodes || [],
        point: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      };
    })()`, 'Route graph node selection');

    const imageHook = await evalJson(cdp, `(() => {
      const node = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')]
        .find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
      const routeInput = document.querySelector(\`[data-pipeline-graph-port-node-id="${routeNode.routeNodeId}"][data-pipeline-graph-port="input"]\`);
      const output = node?.querySelector('[data-pipeline-graph-port="output"]');
      const nodeRect = node?.getBoundingClientRect();
      const outputRect = output?.getBoundingClientRect();
      const routeRect = routeInput?.getBoundingClientRect();
      if (!nodeRect || !outputRect || !routeRect) throw new Error('Graph image hook ports missing');
      return {
        graphImageNodeId: node.dataset.pipelineGraphImageNodeId,
        nodeText: node.innerText,
        outputPoint: { x: outputRect.left + outputRect.width / 2, y: outputRect.top + outputRect.height / 2 },
        routeInputPoint: { x: routeRect.left + routeRect.width / 2, y: routeRect.top + routeRect.height / 2 },
      };
    })()`);
    await drag(cdp, imageHook.outputPoint, imageHook.routeInputPoint);

    const hookedRouteNode = await evalJson(cdp, `(() => {
      const element = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"]\`);
      const rect = element?.getBoundingClientRect();
      const state = window.kaminosPipelineDockDebugState?.();
      return {
        routeNodeId: ${JSON.stringify(routeNode.routeNodeId)},
        nodeText: element.innerText,
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphEdges: state?.graphEdges || [],
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(hookedRouteNode.selectedGeneratorId === generatorId && hookedRouteNode.selectedPipelineId === pipelineId && hookedRouteNode.graphEdges.some(edge => edge.from === imageHook.graphImageNodeId && edge.to === routeNode.routeNodeId), 'Generator/image drag did not place the requested route node and image hook', { routeNode: hookedRouteNode, imageHook });
    await click(cdp, hookedRouteNode.point);

    const executeButton = await evalJson(cdp, `(() => {
      const button = document.querySelector(\`[data-pipeline-graph-node-action="execute"][data-pipeline-graph-node-action-node-id="${routeNode.routeNodeId}"]\`);
      const route = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"]\`);
      const rect = button?.getBoundingClientRect();
      if (!rect) throw new Error('Route node Execute button missing');
      return {
        text: button.textContent,
        disabled: button.disabled,
        nodeText: route?.innerText || '',
        inspectorText: document.querySelector('#pipeline-graph-inspector')?.innerText || '',
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);
    assertWitness(!executeButton.disabled, 'Execute button was disabled', executeButton);
    assertWitness(executeButton.inspectorText.includes('graph-connected input record'), 'Route inspector did not say Execute uses the graph-connected input record', executeButton);
    if (expectsFixture) {
      assertWitness(executeButton.inspectorText.includes('input provenance only; output fixed fixture'), 'Fixture-backed route inspector did not warn that graph input is provenance-only', executeButton);
    } else {
      assertWitness(!executeButton.inspectorText.includes('input provenance only; output fixed fixture'), 'Live SHARP route still looked fixture-backed in the inspector', executeButton);
    }
    await click(cdp, executeButton.point);
    const pendingGeneratedOutput = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const generatedOutputNodes = state?.generatedOutputNodes || [];
      const pendingRecord = generatedOutputNodes.find(item =>
        item.routeNodeId === ${JSON.stringify(routeNode.routeNodeId)}
        && item.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)}
        && (
          ['pending', 'running'].includes(item.status)
          || (item.status === 'complete' && item.runTimeline?.some(event => event.phase === 'queued') && item.runTimeline?.some(event => event.kind === 'running'))
        )
      ) || null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const statusNode = pendingRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      const statusPill = pendingRecord ? document.querySelector(\`[data-pipeline-route-output-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      const routeStatusNode = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"][data-pipeline-route-live-status][data-pipeline-route-progress]\`);
      const routeLiveStatus = routeStatusNode?.dataset?.pipelineRouteLiveStatus || null;
      const routeLivePhase = routeStatusNode?.dataset?.pipelineRouteLivePhase || null;
      const routeLiveProgress = routeStatusNode?.dataset?.pipelineRouteProgress || '';
      return {
        ok: Boolean(
          pendingRecord
          && (!pendingRecord.artifact?.path || pendingRecord.status === 'complete')
          && pendingRecord.runTimeline?.length >= 1
          && pendingRecord.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0'
          && pendingRecord.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0'
          && outputContainer
          && statusNode
          && statusPill
          && routeLiveStatus
          && routeLivePhase
        ),
        pendingRecord,
        generatedOutputNodes,
        routeLiveStatus,
        routeLivePhase,
        routeLiveProgress,
        routeLiveText: routeStatusNode?.innerText || '',
        outputContainerText: outputContainer?.innerText || '',
        statusNodeText: statusNode?.innerText || '',
        statusPillText: statusPill?.innerText || '',
      };
    })()`, 'Graph Execute pending generated output', 12000);
    const nativeProgressObserved = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const record = state?.generatedOutputNodes?.find(item => item.id === ${JSON.stringify(pendingGeneratedOutput.pendingRecord.id)}) || null;
      const routeStatusNode = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"][data-pipeline-route-live-status][data-pipeline-route-progress]\`);
      const routeProgress = routeStatusNode?.dataset?.pipelineRouteProgress || '';
      const timelineProgress = record?.runTimeline?.find(event => event.progressSchema === 'kaminos.pipeline-progress.v0') || null;
      const lastNativeProgress = window.kaminosPipelineLastNativeProgress || null;
      return {
        ok: Boolean(record && timelineProgress && routeProgress !== '' && lastNativeProgress?.schema === 'kaminos.pipeline-progress.v0'),
        mockSharpProgressEnv: ${JSON.stringify(mockSharpProgressEnv)},
        routeProgress,
        routeText: routeStatusNode?.innerText || '',
        timelineProgress,
        lastNativeProgress,
      };
    })()`, 'Native adapter progress reached route node', Math.min(graphExecuteTimeoutMs, 45000));
    const executed = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const run = state?.lastRun;
      const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === run?.runId) || null;
      const primaryArtifact = outputRecord?.artifact || null;
      const roleLabel = artifact => String(artifact?.role || artifact?.type || artifact?.id || 'artifact')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/_/g, '-')
        .toLowerCase();
      const primaryArtifactRole = outputRecord?.artifactRole || roleLabel(primaryArtifact);
      const primaryLoadable = outputRecord?.loadable === true || (primaryArtifactRole.includes('splat') && Boolean(primaryArtifact?.path));
      const runUsesFixture = Boolean(run?.report?.document?.stages?.some(stage => stage.status === 'fixture'));
      const splat = primaryLoadable ? primaryArtifact : null;
      const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
      const outputActionName = primaryLoadable ? 'load-output' : 'open-artifact';
      const outputActionButton = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="\${outputActionName}"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const outputStatus = outputRecord ? outputNode?.dataset?.pipelineGeneratedOutputStatus || null : null;
      const schedulerEvidence = outputRecord?.schedulerEvidence || null;
      const schedulerStateNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"] [data-pipeline-scheduler-state]\`) : null;
      const schedulerState = outputNode?.dataset?.pipelineSchedulerState || schedulerStateNode?.dataset?.pipelineSchedulerState || null;
      const breathabilityStateNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"] [data-pipeline-breathability-state]\`) : null;
      const breathabilityState = outputNode?.dataset?.pipelineBreathabilityState || breathabilityStateNode?.dataset?.pipelineBreathabilityState || null;
      const breathability = schedulerEvidence?.scheduler?.breathability || null;
      const routeStatusNode = document.querySelector(\`[data-pipeline-graph-node-id="${routeNode.routeNodeId}"][data-pipeline-route-live-status][data-pipeline-route-progress]\`);
      const routeLiveStatus = routeStatusNode?.dataset?.pipelineRouteLiveStatus || null;
      const routeLivePhase = routeStatusNode?.dataset?.pipelineRouteLivePhase || null;
      const routeSchedulerState = routeStatusNode?.dataset?.pipelineRouteSchedulerState || null;
      const routeBreathabilityState = routeStatusNode?.dataset?.pipelineBreathabilityState || null;
      const adapterFixture = Boolean(
        run?.report?.document?.stages?.some(stage => stage.effectiveRoute?.fixtureMode === 'mock-adapter')
        || primaryArtifact?.fixtureSource?.mode === 'mock-adapter'
      );
      const expectedRole = ${JSON.stringify(expectedArtifactRole)};
      const expectedTruth = primaryArtifactRole === 'normal-map'
        ? (runUsesFixture ? 'fixture / normal-map artifact' : 'real normal-map artifact')
        : primaryArtifactRole === 'pbr-material-bundle'
          ? (runUsesFixture ? 'fixture / PBR material bundle' : 'real PBR material bundle')
          : adapterFixture ? 'adapter fixture / point-cloud preview' : ${JSON.stringify(expectsFixture)} ? 'fixture / point-cloud preview' : 'real SHARP / point-cloud preview';
      const artifactTruthOk = primaryArtifactRole === expectedRole
        && (primaryLoadable
          ? (adapterFixture
              ? primaryArtifact?.status === 'fixture' && primaryArtifact?.fixtureSource?.mode === 'mock-adapter'
              : (${JSON.stringify(expectsFixture)} ? primaryArtifact?.fixtureSource : primaryArtifact?.status === 'real' && !primaryArtifact?.fixtureSource))
          : Boolean(primaryArtifact?.path && primaryArtifact?.status));
      return {
        ok: Boolean(run?.ok && run?.pipelineId === ${JSON.stringify(pipelineId)} && run?.graphExecution?.nodeId === ${JSON.stringify(routeNode.routeNodeId)} && run?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && run?.source?.graphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && state?.selectedGraphNodeId === outputRecord?.id && primaryArtifact?.path && outputNode && outputNode.innerText.includes(expectedTruth) && outputActionButton && outputContainer && outputStatus === 'complete' && outputRecord?.status === 'complete' && outputRecord?.artifactRole === expectedRole && outputRecord?.runTimeline?.length >= 3 && outputRecord?.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0' && outputRecord?.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0' && schedulerEvidence?.schema === 'kaminos.pipeline-scheduler-composition.v0' && Boolean(schedulerState) && breathabilityState === 'kit-backed-breathability' && breathability?.spans?.length > 0 && breathability?.checkpoints?.length > 0 && routeLiveStatus === 'complete' && routeLivePhase === 'complete' && Boolean(routeSchedulerState) && routeBreathabilityState === 'kit-backed-breathability' && artifactTruthOk),
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        runId: run?.runId || null,
        pipelineId: run?.pipelineId || null,
        graphExecution: run?.graphExecution || null,
        source: run?.source || null,
        statusText: document.querySelector('#pipeline-graph-inspector-status')?.innerText || '',
        resultText: document.querySelector('#pipeline-run-result-panel')?.innerText || '',
        generatedOutputId: outputRecord?.id || null,
        outputStatus,
        generatedOutputNodes: state?.generatedOutputNodes || [],
        routeSnapshot: outputRecord?.routeSnapshot || null,
        graphSnapshot: outputRecord?.graphSnapshot || null,
        schedulerEvidence,
        schedulerState,
        schedulerStateText: schedulerStateNode?.innerText || '',
        breathabilityState,
        breathabilityStateText: breathabilityStateNode?.innerText || '',
        routeLiveStatus,
        routeLivePhase,
        routeSchedulerState,
        routeBreathabilityState,
        routeLiveText: routeStatusNode?.innerText || '',
        runTimeline: outputRecord?.runTimeline || [],
        outputContainerText: outputContainer?.innerText || '',
        generatedOutputNodeText: outputNode?.innerText || '',
        generatedOutputAction: outputActionName,
        generatedOutputActionVisible: Boolean(outputActionButton),
        primaryArtifact,
        primaryArtifactRole,
        primaryLoadable,
        adapterFixture,
        expectedTruth,
        splat,
      };
    })()`, 'Graph Execute SHARP route', graphExecuteTimeoutMs);
    if (expectsFixture) {
      assertWitness(executed.resultText.includes('input provenance only; output fixed fixture'), 'Run result did not preserve fixture input truth warning', executed);
    } else if (executed.adapterFixture) {
      assertWitness(executed.resultText.includes('mock adapter fixture output'), 'Mock adapter result did not preserve adapter-fixture truth warning', executed);
      assertWitness(executed.primaryArtifact?.status === 'fixture' && executed.primaryArtifact?.fixtureSource?.mode === 'mock-adapter', 'Mock adapter result did not expose fixture provenance', executed);
    } else {
      assertWitness(!executed.resultText.includes('input provenance only; output fixed fixture'), 'Live SHARP result still looked fixture-backed', executed);
      assertWitness(executed.primaryArtifact?.status === 'real' && !executed.primaryArtifact?.fixtureSource, 'Live result did not expose a real non-fixture primary artifact', executed);
    }
    await capture(cdp, beforePath);

    let loadOutputButton = null;
    let after = null;
    let screenshotProbe = null;
    if (expectsLoadableArtifact) {
      loadOutputButton = await evalJson(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === ${JSON.stringify(executed.runId)}) || null;
        const button = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="load-output"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
        const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Generated output node Load button missing');
        return {
          generatedOutputId: outputRecord?.id || null,
          text: button.textContent,
          disabled: button.disabled,
          nodeText: outputNode?.innerText || '',
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      assertWitness(!loadOutputButton.disabled, 'Load Output button was disabled', loadOutputButton);
      await click(cdp, loadOutputButton.point);
      const expectsPipelineFixture = expectsFixture || Boolean(executed.adapterFixture);
      after = await waitFor(cdp, `(() => {
        const scene = window.kaminosSceneObjectDebugState?.() || [];
        const loaded = scene.find(entry => entry.type === 'splat' && entry.splat?.pipelineArtifact?.path && (${JSON.stringify(expectsPipelineFixture)} ? entry.splat?.pipelineArtifact?.fixtureSource : !entry.splat?.pipelineArtifact?.fixtureSource));
        const previewDebug = loaded ? window.kaminosSplatPreviewDebugState?.(loaded.id) : null;
        const state = window.kaminosPipelineDockDebugState?.();
        const loadedArtifactPath = loaded?.splat?.pipelineArtifact?.path || null;
        const viewportRect = document.querySelector('#viewport')?.getBoundingClientRect();
        const minimumIncluded = ${JSON.stringify(expectsPipelineFixture)} ? 1 : 700;
        return {
          ok: document.querySelector('.tab.active')?.dataset.tab === 'assets'
            && loaded?.splat?.previewKind === 'point-cloud'
            && Boolean(loaded?.splat?.pointCount)
            && previewDebug?.previewKind === 'point-cloud'
            && previewDebug?.includedVisible === true
            && Number(previewDebug?.includedPointCount || 0) >= minimumIncluded
            && Boolean(loadedArtifactPath && state?.loadedPipelineArtifactPaths?.[loadedArtifactPath]),
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          objectRows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.innerText),
          pointCount: loaded?.splat?.pointCount || 0,
          previewKind: loaded?.splat?.previewKind || null,
          previewDebug,
          loadedArtifactPath,
          loadedPipelineArtifactPaths: state?.loadedPipelineArtifactPaths || {},
          viewportRect: viewportRect ? { x: viewportRect.x, y: viewportRect.y, width: viewportRect.width, height: viewportRect.height } : null,
          source: loaded?.source || null,
          statusText: document.querySelector('#pipeline-result-action-status')?.textContent || document.querySelector('#info-bar')?.textContent || '',
        };
      })()`, 'Graph Execute Load Output');
      assertWitness(after.previewKind === 'point-cloud' && after.previewDebug?.includedVisible, 'Loaded pipeline output did not produce point-cloud preview evidence', after);
      await capture(cdp, afterPath);
      screenshotProbe = await screenshotVisibleProbe(afterPath, after.viewportRect);
      const minimumSaturatedPixels = expectsFixture ? 150 : 1500;
      assertWitness(screenshotProbe.saturatedPixels >= minimumSaturatedPixels, 'Loaded pipeline output screenshot did not contain visible colored point-cloud pixels', {
        after,
        screenshotProbe,
        minimumSaturatedPixels,
      });
    } else {
      const openArtifactButton = await evalJson(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === ${JSON.stringify(executed.runId)}) || null;
        const button = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="open-artifact"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
        const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Generated output node Open Artifact button missing');
        return {
          generatedOutputId: outputRecord?.id || null,
          text: button.textContent,
          disabled: button.disabled,
          nodeText: outputNode?.innerText || '',
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      assertWitness(!openArtifactButton.disabled, 'Open Artifact button was disabled', openArtifactButton);
      await click(cdp, openArtifactButton.point);
      after = await waitFor(cdp, `(() => {
        const status = document.querySelector('#pipeline-result-action-status')?.textContent || document.querySelector('#info-bar')?.textContent || '';
        const inspector = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        return {
          ok: status.includes('Open Artifact opened') || status.includes('opened as image') || inspector.includes(${JSON.stringify(expectedArtifactRole)}),
          statusText: status,
          inspectorText: inspector,
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
        };
      })()`, 'Graph Execute Open Artifact');
      loadOutputButton = openArtifactButton;
      await capture(cdp, afterPath);
    }

    let repeated = null;
    let historySelection = null;
    if (scenario === 'graph-execute-sharp-repeat') {
      await click(cdp, pipelineTab);
      await wait(500);
      await click(cdp, imagePaletteTab);
      await wait(500);
      await evalJson(cdp, `(() => {
        document.querySelector('#pipeline-main-browser')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        return true;
      })()`);
      await wait(250);
      const firstImageNode = await evalJson(cdp, `(() => {
        const node = document.querySelector(\`[data-pipeline-graph-image-node-id="${imageHook.graphImageNodeId}"]\`);
        const rect = node?.getBoundingClientRect();
        if (!rect) throw new Error('Existing graph image node missing before second input selection');
        return {
          nodeText: node.innerText,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        };
      })()`);
      await click(cdp, firstImageNode.point);
      await wait(250);
      const secondImageCard = await evalJson(cdp, `(() => {
        const cards = [...document.querySelectorAll('.pipeline-asset-card')];
        const card = cards.find(element => element.innerText.includes(${JSON.stringify(secondAssetNeedle)}));
        if (!card) throw new Error('Requested second visible image asset card missing');
        const rect = card.getBoundingClientRect();
        return {
          cardText: card.innerText,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          visible: rect.width > 20 && rect.height > 20 && rect.bottom > 0 && rect.top < window.innerHeight,
        };
      })()`);
      assertWitness(secondImageCard.visible, 'Second visible image asset card was not clickable', secondImageCard);
      await click(cdp, secondImageCard.point);
      await wait(500);
      const secondImageHook = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const imageNode = (state?.graphImageNodes || []).find(item => item.id === ${JSON.stringify(imageHook.graphImageNodeId)});
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(imageHook.graphImageNodeId)});
        const graphImageNodes = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')];
        const node = document.querySelector(\`[data-pipeline-graph-image-node-id="${imageHook.graphImageNodeId}"]\`);
        const routeInput = document.querySelector(\`[data-pipeline-graph-port-node-id="${routeNode.routeNodeId}"][data-pipeline-graph-port="input"]\`);
        const output = node?.querySelector('[data-pipeline-graph-port="output"]');
        const outputRect = output?.getBoundingClientRect();
        const routeRect = routeInput?.getBoundingClientRect();
        return {
          ok: Boolean(routeInputEdge && imageNode?.source?.includes(${JSON.stringify(secondAssetNeedle)}) && outputRect && routeRect),
          graphImageNodeId: node?.dataset?.pipelineGraphImageNodeId || null,
          nodeText: node?.innerText || '',
          source: imageNode?.source || null,
          routeInputEdge,
          graphImageNodeTexts: graphImageNodes.map(element => element.innerText),
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          outputPoint: outputRect ? { x: outputRect.left + outputRect.width / 2, y: outputRect.top + outputRect.height / 2 } : null,
          routeInputPoint: routeRect ? { x: routeRect.left + routeRect.width / 2, y: routeRect.top + routeRect.height / 2 } : null,
        };
      })()`, 'Existing graph image node source replacement');
      const secondExecuteButton = await evalJson(cdp, `(() => {
        const button = document.querySelector(\`[data-pipeline-graph-node-action="execute"][data-pipeline-graph-node-action-node-id="${routeNode.routeNodeId}"]\`);
        const rect = button?.getBoundingClientRect();
        if (!rect) throw new Error('Second Execute button missing');
        return { point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, disabled: button.disabled };
      })()`);
      assertWitness(!secondExecuteButton.disabled, 'Second Execute button was disabled', secondExecuteButton);
      await click(cdp, secondExecuteButton.point);
      repeated = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const runs = state?.runHistory || [];
        const generatedOutputNodes = state?.generatedOutputNodes || [];
        const routeOutputs = generatedOutputNodes.filter(item => item.routeNodeId === ${JSON.stringify(routeNode.routeNodeId)});
        const distinctGeneratedOutputs = new Set(routeOutputs.map(item => item.id)).size;
        const distinctArtifactPaths = new Set(routeOutputs.map(item => item.artifact?.path).filter(Boolean)).size;
        const latestRun = state?.lastRun || null;
        const latestOutput = routeOutputs.find(item => item.runId === latestRun?.runId) || null;
        return {
          ok: runs.length >= 2
            && routeOutputs.length >= 2
            && distinctGeneratedOutputs >= 2
            && distinctArtifactPaths >= 2
            && routeOutputs.some(item => item.runId === ${JSON.stringify(executed.runId)})
            && routeOutputs.every(item => item.status === 'complete' && item.runTimeline?.length >= 3 && item.routeSnapshot?.schema && item.graphSnapshot?.schema && item.schedulerEvidence?.schema === 'kaminos.pipeline-scheduler-composition.v0')
            && latestOutput?.status === 'complete'
            && latestRun?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(secondImageHook.graphImageNodeId)}
            && latestRun?.graphExecution?.source?.includes(${JSON.stringify(secondAssetNeedle)})
            && latestRun?.graphExecution?.nodeId === ${JSON.stringify(routeNode.routeNodeId)},
          runIds: runs.map(run => run.runId),
          generatedOutputNodes,
          distinctGeneratedOutputs,
          distinctArtifactPaths,
          latestRun: latestRun ? {
            runId: latestRun.runId,
            graphExecution: latestRun.graphExecution,
            source: latestRun.source,
          } : null,
          latestOutput,
          firstGeneratedOutputId: ${JSON.stringify(executed.generatedOutputId)},
          secondImageHook: ${JSON.stringify(secondImageHook)},
        };
      })()`, 'Graph Execute repeated SHARP route');

      await click(cdp, hookedRouteNode.point);
      const historyButtons = await evalJson(cdp, `(() => {
        const routeInputEdge = (window.kaminosPipelineDockDebugState?.()?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        const buttons = [...document.querySelectorAll('[data-pipeline-output-history-id]')].map(button => {
          const rect = button.getBoundingClientRect();
          return {
            id: button.dataset.pipelineOutputHistoryId,
            routeId: button.dataset.pipelineOutputHistoryRouteId,
            text: button.innerText,
            point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          };
        });
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        return {
          ok: Boolean(routeInputEdge && buttons.length >= 2 && inspectorText.includes('produced from current graph') && inspectorText.includes('produced from previous graph state')),
          buttons,
          inspectorText,
          routeInputEdge,
        };
      })()`);
      const olderHistoryButton = historyButtons.buttons.find(button => button.id === executed.generatedOutputId);
      const latestHistoryButton = historyButtons.buttons.find(button => button.id === repeated.latestOutput?.id);
      assertWitness(historyButtons.ok && olderHistoryButton && latestHistoryButton, 'Route inspector output history did not expose both current and prior outputs', historyButtons);
      await capture(cdp, historyPath);
      await click(cdp, olderHistoryButton.point);
      const olderSelection = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        return {
          ok: state?.selectedGraphNodeId === ${JSON.stringify(executed.generatedOutputId)}
            && Boolean(routeInputEdge)
            && inspectorText.includes('produced from previous graph state')
            && !inspectorText.includes('Restore This Run'),
          selectedGraphNodeId: state?.selectedGraphNodeId || null,
          graphEdges: state?.graphEdges || [],
          inspectorText,
          routeInputEdge,
        };
      })()`, 'Output history older selection');
      await click(cdp, hookedRouteNode.point);
      await click(cdp, latestHistoryButton.point);
      const latestSelection = await waitFor(cdp, `(() => {
        const state = window.kaminosPipelineDockDebugState?.();
        const inspectorText = document.querySelector('#pipeline-graph-inspector')?.innerText || '';
        const routeInputEdge = (state?.graphEdges || [])
          .find(edge => edge.to === ${JSON.stringify(routeNode.routeNodeId)} && edge.from === ${JSON.stringify(secondImageHook.graphImageNodeId)});
        return {
          ok: state?.selectedGraphNodeId === ${JSON.stringify(repeated.latestOutput?.id)}
            && Boolean(routeInputEdge)
            && inspectorText.includes('produced from current graph')
            && !inspectorText.includes('Restore This Run'),
          selectedGraphNodeId: state?.selectedGraphNodeId || null,
          graphEdges: state?.graphEdges || [],
          inspectorText,
          routeInputEdge,
        };
      })()`, 'Output history latest selection');
      historySelection = {
        ok: true,
        historyButtons,
        olderSelection,
        latestSelection,
      };
    }

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      historyPath: scenario === 'graph-execute-sharp-repeat' ? historyPath : null,
      imageCard,
      routeNode: hookedRouteNode,
      executeButton,
      pendingGeneratedOutput,
      nativeProgressObserved,
      executed,
      loadOutputButton,
      after,
      repeated,
      historySelection,
      screenshotProbe,
    }, null, 2));
  } else {
  const dragPoints = await evalJson(cdp, `(() => {
    const cards = [...document.querySelectorAll('.pipeline-asset-card')];
    const card = cards.find(element => element.innerText.includes(${JSON.stringify(assetNeedle)}));
    const canvas = document.querySelector('#pipeline-graph-canvas');
    if (!card) throw new Error('Requested visible image asset card missing');
    if (!canvas) throw new Error('Pipeline graph canvas missing');
    const cardRect = card.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      cardText: card.innerText,
      from: { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 },
      to: { x: canvasRect.left + canvasRect.width * 0.78, y: canvasRect.top + canvasRect.height * 0.34 },
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      paletteText: document.querySelector('#pipeline-browser-count')?.textContent || '',
    };
  })()`);
  await drag(cdp, dragPoints.from, dragPoints.to);

  const before = await evalJson(cdp, `(() => {
    const status = document.querySelector('#pipeline-graph-inspector-status');
    const button = [...document.querySelectorAll('#pipeline-graph-inspector-actions button')]
      .find(item => item.textContent.includes('Import Image'));
    const rect = button?.getBoundingClientRect();
    return {
      activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
      graphImageNodes: [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')].length,
      statusText: status?.innerText || '',
      statusVisible: !!status && status.getBoundingClientRect().width > 20 && status.getBoundingClientRect().height > 20,
      importButton: rect ? {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: button.textContent,
        disabled: button.disabled,
      } : null,
    };
  })()`);
  await capture(cdp, beforePath);
  assertWitness(before.activeTab === 'pipeline', 'Pipeline tab was not active before import', before);
  assertWitness(before.graphImageNodes > 0, 'Visible drag did not create an image graph node', before);
  assertWitness(before.statusVisible && before.statusText.includes('ACTION STATUS'), 'Graph action status was not visibly rendered before import', before);
  assertWitness(before.importButton && !before.importButton.disabled, 'Import Image to Scene button was not clickable', before);

  await click(cdp, before.importButton);
  await wait(3500);
  const after = await evalJson(cdp, `(() => ({
    activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
    sceneImportText: document.querySelector('#scene-import-status')?.innerText || '',
    sceneImportHidden: document.querySelector('#scene-import-status')?.hidden ?? null,
    objectRows: [...document.querySelectorAll('[data-scene-object-id]')].map(row => row.innerText),
    infoText: document.querySelector('#info-bar')?.textContent || '',
    debug: window.kaminosPipelineLastImportDebug || null,
  }))()`);
  await capture(cdp, afterPath);

  assertWitness(after.activeTab === 'assets', 'Visible import did not switch to the scene Assets tab', after);
  assertWitness(after.sceneImportHidden === false && after.sceneImportText.includes('SCENE IMPORT'), 'Scene Import receipt was not visible after import', after);
  assertWitness(after.objectRows.some(row => row.includes('reloadable')), 'Reloadable image scene row was not visible after import', after);
  assertWitness(after.debug?.phase === 'visible-scene-row', 'Import did not record visible-scene-row phase', after);

  console.log(JSON.stringify({
    ok: true,
    schema: 'kaminos.pipeline-ui-witness.v0',
    url: appUrl,
    beforePath,
    afterPath,
    drag: {
      cardText: dragPoints.cardText,
      activeTab: dragPoints.activeTab,
      paletteText: dragPoints.paletteText,
    },
    before,
    after,
  }, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    schema: 'kaminos.pipeline-ui-witness.v0',
    url: appUrl,
    beforePath,
    afterPath,
    historyPath: scenario === 'graph-execute-sharp-repeat' ? historyPath : null,
    error: error.message,
    detail: error.detail || null,
  }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) chromeProcess.kill('SIGTERM');
  await new Promise(resolve => {
    if (chromeProcess.exitCode !== null || chromeProcess.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (chromeProcess.exitCode === null && chromeProcess.signalCode === null) chromeProcess.kill('SIGKILL');
      resolve();
    }, 1000);
    chromeProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (stderr) console.error(stderr.split('\n').slice(0, 8).join('\n'));
}
