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
const expectsFixture = args.get('expect-fixture') === '1' || pipelineId.includes('fixture');
const beforePath = args.get('before') || '/tmp/kaminos-pipeline-ui-witness-before.png';
const afterPath = args.get('after') || '/tmp/kaminos-pipeline-ui-witness-after.png';
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

  if (scenario === 'graph-execute-sharp' || scenario === 'graph-execute-sharp-repeat') {
    const generatorCard = await evalJson(cdp, `(() => {
      const element = [...document.querySelectorAll('[data-pipeline-generator-id]')]
        .find(item => item.dataset.pipelineGeneratorId === ${JSON.stringify(generatorId)});
      const canvas = document.querySelector('#pipeline-graph-canvas');
      const rect = element?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      if (!rect) throw new Error('Pipeline generator card missing');
      if (!canvasRect) throw new Error('Pipeline graph canvas missing for generator drop');
      return {
        cardText: element.innerText,
        pipelineGeneratorId: element.dataset.pipelineGeneratorId,
        backendPipelineId: element.dataset.pipelineGeneratorPipelineId || null,
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        drop: { x: canvasRect.left + canvasRect.width * 0.34, y: canvasRect.top + canvasRect.height * 0.40 },
      };
    })()`);
    assertWitness(generatorCard.pipelineGeneratorId === generatorId && generatorCard.backendPipelineId === pipelineId, 'Generator card did not preserve generic id plus backend route binding', generatorCard);
    await drag(cdp, generatorCard.point, generatorCard.drop);
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

    const routeNode = await evalJson(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const routeRecord = state?.graphRouteNodes?.at(-1) || state?.graphRouteNodes?.[0] || null;
      const element = routeRecord ? document.querySelector(\`[data-pipeline-graph-node-id="\${routeRecord.id}"]\`) : [...document.querySelectorAll('[data-pipeline-graph-node-id]')].find(item => item.innerText.includes('SHARP Image -> Splat'));
      const rect = element?.getBoundingClientRect();
      if (!rect) throw new Error('Route graph node missing');
      return {
        routeNodeId: element.dataset.pipelineGraphNodeId,
        nodeText: element.innerText,
        selectedGeneratorId: state?.selectedGeneratorId || null,
        selectedPipelineId: state?.selectedPipelineId || null,
        selectedGraphNodeId: state?.selectedGraphNodeId || null,
        graphEdges: state?.graphEdges || [],
        graphRouteNodes: state?.graphRouteNodes || [],
        point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      };
    })()`);

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
        && ['pending', 'running'].includes(item.status)
        && item.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)}
      ) || null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const statusNode = pendingRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      const statusPill = pendingRecord ? document.querySelector(\`[data-pipeline-route-output-id="\${pendingRecord.id}"][data-pipeline-generated-output-status]\`) : null;
      return {
        ok: Boolean(
          pendingRecord
          && !pendingRecord.artifact?.path
          && pendingRecord.runTimeline?.length >= 1
          && pendingRecord.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0'
          && pendingRecord.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0'
          && outputContainer
          && statusNode
          && statusPill
        ),
        pendingRecord,
        generatedOutputNodes,
        outputContainerText: outputContainer?.innerText || '',
        statusNodeText: statusNode?.innerText || '',
        statusPillText: statusPill?.innerText || '',
      };
    })()`, 'Graph Execute pending generated output', 12000);
    const executed = await waitFor(cdp, `(() => {
      const state = window.kaminosPipelineDockDebugState?.();
      const run = state?.lastRun;
      const splat = run?.report?.document?.artifacts?.splat || null;
      const outputRecord = state?.generatedOutputNodes?.find(item => item.runId === run?.runId) || null;
      const outputNode = outputRecord ? document.querySelector(\`[data-pipeline-generated-output-node-id="\${outputRecord.id}"]\`) : null;
      const outputLoadButton = outputRecord ? document.querySelector(\`[data-pipeline-graph-node-action="load-output"][data-pipeline-graph-node-action-node-id="\${outputRecord.id}"]\`) : null;
      const outputContainer = document.querySelector(\`[data-pipeline-output-container-route-id="${routeNode.routeNodeId}"]\`);
      const outputStatus = outputRecord ? outputNode?.dataset?.pipelineGeneratedOutputStatus || null : null;
      const expectedTruth = ${JSON.stringify(expectsFixture)} ? 'fixture / point-cloud preview' : 'real SHARP / point-cloud preview';
      return {
        ok: Boolean(run?.ok && run?.pipelineId === ${JSON.stringify(pipelineId)} && run?.graphExecution?.nodeId === ${JSON.stringify(routeNode.routeNodeId)} && run?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && run?.source?.graphNodeId === ${JSON.stringify(imageHook.graphImageNodeId)} && state?.selectedGraphNodeId === outputRecord?.id && splat?.path && outputNode && outputNode.innerText.includes(expectedTruth) && outputLoadButton && outputContainer && outputStatus === 'complete' && outputRecord?.status === 'complete' && outputRecord?.runTimeline?.length >= 3 && outputRecord?.routeSnapshot?.schema === 'kaminos.pipeline-route-snapshot.v0' && outputRecord?.graphSnapshot?.schema === 'kaminos.pipeline-graph-run-snapshot.v0' && (${JSON.stringify(expectsFixture)} ? splat?.fixtureSource : splat?.status === 'real' && !splat?.fixtureSource)),
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
        runTimeline: outputRecord?.runTimeline || [],
        outputContainerText: outputContainer?.innerText || '',
        generatedOutputNodeText: outputNode?.innerText || '',
        generatedOutputLoadAction: Boolean(outputLoadButton),
        splat,
      };
    })()`, 'Graph Execute SHARP route');
    if (expectsFixture) {
      assertWitness(executed.resultText.includes('input provenance only; output fixed fixture'), 'Run result did not preserve fixture input truth warning', executed);
    } else {
      assertWitness(!executed.resultText.includes('input provenance only; output fixed fixture'), 'Live SHARP result still looked fixture-backed', executed);
      assertWitness(executed.splat?.status === 'real' && !executed.splat?.fixtureSource, 'Live SHARP result did not expose a real non-fixture splat artifact', executed);
    }
    await capture(cdp, beforePath);

    const loadOutputButton = await evalJson(cdp, `(() => {
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
    const after = await waitFor(cdp, `(() => {
      const scene = window.kaminosSceneObjectDebugState?.() || [];
      const loaded = scene.find(entry => entry.type === 'splat' && entry.splat?.pipelineArtifact?.path && (${JSON.stringify(expectsFixture)} ? entry.splat?.pipelineArtifact?.fixtureSource : !entry.splat?.pipelineArtifact?.fixtureSource));
      const previewDebug = loaded ? window.kaminosSplatPreviewDebugState?.(loaded.id) : null;
      const state = window.kaminosPipelineDockDebugState?.();
      const loadedArtifactPath = loaded?.splat?.pipelineArtifact?.path || null;
      const viewportRect = document.querySelector('#viewport')?.getBoundingClientRect();
      const minimumIncluded = ${JSON.stringify(expectsFixture)} ? 1 : 700;
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
    const screenshotProbe = await screenshotVisibleProbe(afterPath, after.viewportRect);
    const minimumSaturatedPixels = expectsFixture ? 150 : 1500;
    assertWitness(screenshotProbe.saturatedPixels >= minimumSaturatedPixels, 'Loaded pipeline output screenshot did not contain visible colored point-cloud pixels', {
      after,
      screenshotProbe,
      minimumSaturatedPixels,
    });

    let repeated = null;
    if (scenario === 'graph-execute-sharp-repeat') {
      await click(cdp, pipelineTab);
      await wait(500);
      await click(cdp, imagePaletteTab);
      await wait(500);
      const secondImageCard = await evalJson(cdp, `(() => {
        const cards = [...document.querySelectorAll('.pipeline-asset-card')];
        const card = cards.find(element => element.innerText.includes(${JSON.stringify(secondAssetNeedle)}));
        const canvas = document.querySelector('#pipeline-graph-canvas');
        if (!card) throw new Error('Requested second visible image asset card missing');
        if (!canvas) throw new Error('Pipeline graph canvas missing for second image drop');
        const rect = card.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        return {
          cardText: card.innerText,
          point: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          drop: { x: canvasRect.left + canvasRect.width * 0.80, y: canvasRect.top + canvasRect.height * 0.60 },
        };
      })()`);
      await drag(cdp, secondImageCard.point, secondImageCard.drop);
      const secondImageHook = await evalJson(cdp, `(() => {
        const node = [...document.querySelectorAll('[data-pipeline-graph-image-node-id]')]
          .find(element => element.innerText.includes(${JSON.stringify(secondAssetNeedle)}));
        const routeInput = document.querySelector(\`[data-pipeline-graph-port-node-id="${routeNode.routeNodeId}"][data-pipeline-graph-port="input"]\`);
        const output = node?.querySelector('[data-pipeline-graph-port="output"]');
        const outputRect = output?.getBoundingClientRect();
        const routeRect = routeInput?.getBoundingClientRect();
        if (!outputRect || !routeRect) throw new Error('Second graph image hook ports missing');
        return {
          graphImageNodeId: node.dataset.pipelineGraphImageNodeId,
          nodeText: node.innerText,
          outputPoint: { x: outputRect.left + outputRect.width / 2, y: outputRect.top + outputRect.height / 2 },
          routeInputPoint: { x: routeRect.left + routeRect.width / 2, y: routeRect.top + routeRect.height / 2 },
        };
      })()`);
      await drag(cdp, secondImageHook.outputPoint, secondImageHook.routeInputPoint);
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
            && routeOutputs.every(item => item.status === 'complete' && item.runTimeline?.length >= 3 && item.routeSnapshot?.schema && item.graphSnapshot?.schema)
            && latestOutput?.status === 'complete'
            && latestRun?.graphExecution?.sourceGraphNodeId === ${JSON.stringify(secondImageHook.graphImageNodeId)}
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
    }

    console.log(JSON.stringify({
      ok: true,
      schema: 'kaminos.pipeline-ui-witness.v0',
      scenario,
      url: appUrl,
      beforePath,
      afterPath,
      imageCard,
      routeNode: hookedRouteNode,
      executeButton,
      pendingGeneratedOutput,
      executed,
      loadOutputButton,
      after,
      repeated,
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
    error: error.message,
    detail: error.detail || null,
  }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  chromeProcess.kill('SIGTERM');
  setTimeout(() => chromeProcess.kill('SIGKILL'), 1000).unref();
  if (stderr) console.error(stderr.split('\n').slice(0, 8).join('\n'));
}
