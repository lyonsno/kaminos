#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.sam3-mask-island.browser-parity-smoke.v0';
const MASK_DECODER_ISLAND_ROUTE_ID = 'sam3.mask-decoder-island.webgpu-local.v0';
const MASK_TAIL_PHASE_PROGRAM_ROUTE_ID = 'sam3.mask-tail.phase-program.webgpu-local.v0';
const PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.pixel-decoder.phase-program.webgpu-local.v0';
const PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID = 'sam3.prompt-fpn.phase-program.webgpu-local.v0';
const DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-encoder.phase-program.webgpu-local.v0';
const DETR_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.detr-decoder.phase-program.webgpu-local.v0';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const packageRoot = resolve(new URL('..', import.meta.url).pathname);
const out = resolve(args.get('--out') || '/tmp/kaminos-sam-mask-island-browser-parity.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const debugPort = Number(args.get('--debug-port') || 9527);
const serverPort = Number(args.get('--server-port') || 18527);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-sam-mask-island-profile-${debugPort}-${process.pid}`;
const oracleDir = resolve(args.get('--oracle-dir') || `/tmp/kaminos-sam-mask-island-oracle-${process.pid}`);
const packetMode = args.get('--packet-mode') || 'synthetic';
const packetTool = resolve(args.get('--packet-tool') || (
  packetMode === 'mlx-prompt-fpn-export'
    ? join(packageRoot, 'tools/sam-prompt-fpn-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-decoder-export'
    ? join(packageRoot, 'tools/sam-detr-decoder-mlx-packet.py')
    : packetMode === 'mlx-detr-encoder-export'
    ? join(packageRoot, 'tools/sam-detr-encoder-mlx-packet.py')
    : packetMode === 'mlx-pixel-decoder-export'
    ? join(packageRoot, 'tools/sam-pixel-decoder-mlx-packet.py')
    : packetMode === 'mlx-mask-tail-export'
    ? join(packageRoot, 'tools/sam-mask-tail-mlx-packet.py')
    : packetMode === 'mlx-reference-export'
    ? join(packageRoot, 'tools/sam-mask-island-mlx-boundary-packet.py')
    : join(packageRoot, 'tools/sam-mask-island-oracle-packet.mjs')
));
const mlxVlmRoot = resolve(args.get('--mlx-vlm-root') || process.env.KAMINOS_MLX_VLM_ROOT || '/Users/noahlyons/dev/mlx-vlm');
const sourceImage = args.get('--image') || process.env.KAMINOS_SAM3_FIXTURE_IMAGE || '/Users/noahlyons/dev/sam3/assets/images/truck.jpg';
const requestedRouteId = args.get('--route-id') || (
  packetMode === 'mlx-prompt-fpn-export'
    ? PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-export'
    ? DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-decoder-export'
    ? DETR_DECODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-encoder-export'
    ? DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-pixel-decoder-export'
    ? PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-mask-tail-export'
    ? MASK_TAIL_PHASE_PROGRAM_ROUTE_ID
    : MASK_DECODER_ISLAND_ROUTE_ID
);
const prompt = args.get('--prompt') || (packetMode.startsWith('mlx-') ? 'truck' : 'synthetic mask island parity');
const model = args.get('--model') || 'mlx-community/sam3-image';
const resolution = Number(args.get('--resolution') || 224);
const viewportWidth = Number(args.get('--viewport-width') || 1000);
const viewportHeight = Number(args.get('--viewport-height') || 520);
const hookWaitMs = Number(args.get('--hook-wait-ms') || 20000);
const cdpTimeoutMs = Number(args.get('--cdp-timeout-ms') || 20000);
const settleMs = Number(args.get('--settle-ms') || 400);
const headless = args.get('--headless') !== '0';

let phase = 'initializing';
let stderr = '';
let browserVersion = null;
let primaryOutputWritten = false;
let lastState = null;
let server = null;
let chromeProcess = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: REPORT_SCHEMA,
    requestedRouteId,
    effectiveRouteId: lastState?.effectiveRouteId || null,
    requestedUrl: `http://127.0.0.1:${serverPort}/smokes/sam-mask-island-parity.html?manifest=/oracle/tensor-manifest.json`,
    packageRoot,
    oracleDir,
    packetMode,
    packetTool,
    mlxVlmRoot,
    sourceImage: lastState?.sourceImage || lastState?.tensorPacket?.sourceImage || null,
    requestedSourceImage: sourceImage,
    prompt,
    model,
    resolution,
    debugPort,
    serverPort,
    chrome,
    userDataDir,
    viewport: { width: viewportWidth, height: viewportHeight },
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    screenshot: primaryOutputWritten ? out : null,
    browserVersion,
    stderrTail: stderr.slice(-3000),
    consoleEvents,
    lastState,
    backendIdentity: lastState?.backendIdentity || null,
    tensorPacket: lastState?.tensorPacket || null,
    routeReceipt: lastState?.routeReceipt || null,
    midstreamRouteReceipt: lastState?.midstreamRouteReceipt || null,
    downstreamRouteReceipt: lastState?.downstreamRouteReceipt || null,
    compositionRouteReceipts: lastState?.compositionRouteReceipts || null,
    parity: lastState?.parity || null,
    ...extra,
  }, null, 2));
}

function withFailurePhase(error, failurePhase) {
  if (error && typeof error === 'object') {
    error.failurePhase = failurePhase;
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.failurePhase = failurePhase;
  return wrapped;
}

function contentType(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.bin') return 'application/octet-stream';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

function startServer() {
  server = createServer((request, response) => {
    try {
      const url = new URL(request.url, `http://127.0.0.1:${serverPort}`);
      const root = url.pathname.startsWith('/oracle/') ? oracleDir : packageRoot;
      const relative = url.pathname.startsWith('/oracle/')
        ? url.pathname.slice('/oracle/'.length)
        : url.pathname.slice(1);
      const filePath = resolve(root, relative || 'smokes/sam-mask-island-parity.html');
      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end('forbidden');
        return;
      }
      if (!existsSync(filePath)) {
        response.writeHead(404);
        response.end(`missing ${url.pathname}`);
        return;
      }
      response.writeHead(200, {
        'content-type': contentType(filePath),
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      response.end(readFileSync(filePath));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error?.stack || error));
    }
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(serverPort, '127.0.0.1', resolveListen);
  });
}

function generateOraclePacket() {
  mkdirSync(oracleDir, { recursive: true });
  const isPython = packetTool.endsWith('.py');
  const command = isPython ? 'uv' : process.execPath;
  const packetArgs = isPython
    ? [
        'run',
        '--project', mlxVlmRoot,
        'python',
        packetTool,
        '--out-dir', oracleDir,
        '--image', sourceImage,
        '--prompt', prompt,
        '--model', model,
        '--resolution', String(resolution),
      ]
    : [
        packetTool,
        '--out-dir', oracleDir,
        '--batch', '1',
        '--mask-tokens', '1',
        '--channels', '2',
        '--height', '8',
        '--width', '8',
        '--source-image-artifact-id', 'image:synthetic-sam-browser-parity',
        '--source-image-sha256', 'sha256:synthetic-browser-parity-image',
        '--prompt', prompt,
        '--model', model,
      ];
  const proc = spawnSync(command, packetArgs, {
    cwd: isPython ? mlxVlmRoot : packageRoot,
    encoding: 'utf8',
    timeout: isPython ? 120000 : undefined,
  });
  if (proc.status !== 0) {
    throw new Error(`oracle packet generation failed: ${proc.stderr || proc.stdout}`);
  }
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let i = 0; i < 100; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, cdpTimeoutMs);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          method: msg.method,
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          method: msg.method,
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
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

async function main() {
  try {
    phase = 'generate_oracle_packet';
    generateOraclePacket();

    phase = 'start_server';
    await startServer();

    const url = `http://127.0.0.1:${serverPort}/smokes/sam-mask-island-parity.html?manifest=/oracle/tensor-manifest.json`;
    phase = 'launch_chrome';
    const chromeArgs = [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
      `--window-size=${viewportWidth},${viewportHeight}`,
    ];
    if (headless) chromeArgs.push('--headless=new');
    chromeArgs.push(url);
    chromeProcess = spawn(chrome, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const chromeSpawnError = new Promise((_, rejectSpawn) => {
      chromeProcess.once('error', error => {
        rejectSpawn(withFailurePhase(error, 'launch_chrome'));
      });
    });
    chromeProcess.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    phase = 'connect_cdp';
    browserVersion = await Promise.race([waitForCdp(), chromeSpawnError]);
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page' && candidate.url.includes('sam-mask-island-parity.html')) || pages[0];
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target missing debugger URL');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    phase = 'wait_parity_state';
    const deadline = Date.now() + hookWaitMs;
    while (Date.now() < deadline) {
      lastState = await evaluate(ws, `(() => {
        const read = window.samMaskIslandParitySmokeState;
        return typeof read === 'function' ? read() : null;
      })()`);
      if (lastState?.status === 'passed' || lastState?.status === 'failed') break;
      await delay(250);
    }
    if (!lastState) throw new Error('missing samMaskIslandParitySmokeState');
    if (lastState.status !== 'passed') {
      throw new Error(`SAM browser parity did not pass: ${JSON.stringify(lastState)}`);
    }
    if (lastState.requestedRouteId !== requestedRouteId || lastState.effectiveRouteId !== requestedRouteId) {
      throw new Error(`route identity mismatch: ${lastState.requestedRouteId} -> ${lastState.effectiveRouteId}`);
    }
    if (!lastState.backendIdentity?.adapterName) throw new Error('backendIdentity.adapterName missing');
    if (packetMode === 'mlx-detr-stack-export') {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR stack tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 3) {
        throw new Error('DETR stack composition receipt chain missing');
      }
      const [encoderReceipt, decoderReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (encoderReceipt.effectiveRouteId !== DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack decoder receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack mask-tail receipt identity mismatch');
      const encoderOutput = encoderReceipt.outputs?.find(output => output.role === 'encoder-hidden-states');
      if (
        encoderOutput?.artifactId !== compositionEdge?.detrEncoderOutput?.artifactId
        || encoderOutput?.sha256 !== compositionEdge?.detrEncoderOutput?.sha256
        || JSON.stringify(encoderOutput?.shape) !== JSON.stringify(compositionEdge?.detrEncoderOutput?.shape)
      ) {
        throw new Error('DETR stack encoder output identity does not match composition edge');
      }
      const decoderTensorInput = decoderReceipt.inputs?.find(input => input.role === 'sam3-detr-decoder-tensors');
      if (decoderTensorInput?.sha256 !== compositionEdge?.decoderTensorSha256) throw new Error('DETR stack decoderTensorSha256 does not match decoder receipt input');
      const lastHsOutput = decoderReceipt.outputs?.find(output => output.role === 'last-hs');
      const referenceBoxesOutput = decoderReceipt.outputs?.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderReceipt.outputs?.find(output => output.role === 'presence-logits');
      if (
        lastHsOutput?.artifactId !== compositionEdge?.lastHsOutput?.artifactId
        || lastHsOutput?.sha256 !== compositionEdge?.lastHsOutput?.sha256
        || JSON.stringify(lastHsOutput?.shape) !== JSON.stringify(compositionEdge?.lastHsOutput?.shape)
      ) {
        throw new Error('DETR stack last-hs output identity does not match composition edge');
      }
      if (
        referenceBoxesOutput?.artifactId !== compositionEdge?.referenceBoxesOutput?.artifactId
        || referenceBoxesOutput?.sha256 !== compositionEdge?.referenceBoxesOutput?.sha256
      ) {
        throw new Error('DETR stack reference-boxes output identity does not match composition edge');
      }
      if (
        presenceLogitsOutput?.artifactId !== compositionEdge?.presenceLogitsOutput?.artifactId
        || presenceLogitsOutput?.sha256 !== compositionEdge?.presenceLogitsOutput?.sha256
      ) {
        throw new Error('DETR stack presence-logits output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR stack downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR stack encoder parity exceeds tolerance');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR stack last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR stack reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR stack presence parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR stack binary mask parity exceeds tolerance');
    } else if (requestedRouteId === DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderHiddenStatesSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR decoder tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 2) {
        throw new Error('DETR decoder composition receipt chain missing');
      }
      const [decoderReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR decoder receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR decoder mask-tail receipt identity mismatch');
      const lastHsOutput = decoderReceipt.outputs?.find(output => output.role === 'last-hs');
      const referenceBoxesOutput = decoderReceipt.outputs?.find(output => output.role === 'reference-boxes');
      const presenceLogitsOutput = decoderReceipt.outputs?.find(output => output.role === 'presence-logits');
      if (
        lastHsOutput?.artifactId !== compositionEdge?.lastHsOutput?.artifactId
        || lastHsOutput?.sha256 !== compositionEdge?.lastHsOutput?.sha256
        || JSON.stringify(lastHsOutput?.shape) !== JSON.stringify(compositionEdge?.lastHsOutput?.shape)
      ) {
        throw new Error('DETR decoder last-hs output identity does not match composition edge');
      }
      if (
        referenceBoxesOutput?.artifactId !== compositionEdge?.referenceBoxesOutput?.artifactId
        || referenceBoxesOutput?.sha256 !== compositionEdge?.referenceBoxesOutput?.sha256
      ) {
        throw new Error('DETR decoder reference-boxes output identity does not match composition edge');
      }
      if (
        presenceLogitsOutput?.artifactId !== compositionEdge?.presenceLogitsOutput?.artifactId
        || presenceLogitsOutput?.sha256 !== compositionEdge?.presenceLogitsOutput?.sha256
      ) {
        throw new Error('DETR decoder presence-logits output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR decoder downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR decoder last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR decoder reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR decoder presence parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR decoder binary mask parity exceeds tolerance');
    } else if (requestedRouteId === DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR encoder tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 4) {
        throw new Error('DETR encoder composition receipt chain missing');
      }
      const [detrReceipt, promptReceipt, pixelReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (detrReceipt.effectiveRouteId !== DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR receipt identity mismatch');
      if (promptReceipt.effectiveRouteId !== PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR prompt-FPN receipt identity mismatch');
      if (pixelReceipt.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR pixel receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR mask-tail receipt identity mismatch');
      const encoderOutput = detrReceipt.outputs?.find(output => output.role === 'encoder-hidden-states');
      if (
        encoderOutput?.artifactId !== compositionEdge?.encoderHiddenStatesOutput?.artifactId
        || encoderOutput?.sha256 !== compositionEdge?.encoderHiddenStatesOutput?.sha256
        || JSON.stringify(encoderOutput?.shape) !== JSON.stringify(compositionEdge?.encoderHiddenStatesOutput?.shape)
      ) {
        throw new Error('DETR encoder output identity does not match composition edge');
      }
      const promptTensorInput = promptReceipt.inputs?.find(input => input.role === 'sam3-prompt-fpn-tensors');
      if (promptTensorInput?.sha256 !== compositionEdge?.encoderTensorSha256) throw new Error('DETR encoderTensorSha256 does not match prompt-FPN receipt input');
      const pixelTensorInput = pixelReceipt.inputs?.find(input => input.role === 'sam3-pixel-decoder-tensors');
      if (pixelTensorInput?.sha256 !== compositionEdge?.pixelTensorSha256) throw new Error('DETR pixelTensorSha256 does not match pixel receipt input');
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR encoder parity exceeds tolerance');
      if (lastState.parity?.promptFpnMaxAbsDiff > 0.0003) throw new Error('DETR prompt-FPN parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR binary mask parity exceeds tolerance');
    } else if (requestedRouteId === PROMPT_FPN_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.encoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedPromptFpnFeatureSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('prompt-FPN tensorPacket identity missing');
      }
      const midstreamRouteReceipt = lastState.midstreamRouteReceipt;
      const downstreamRouteReceipt = lastState.downstreamRouteReceipt;
      const compositionEdge = lastState.compositionEdge;
      if (!midstreamRouteReceipt) throw new Error('prompt-FPN midstream pixel route receipt missing');
      if (!downstreamRouteReceipt) throw new Error('prompt-FPN downstream mask-tail route receipt missing');
      if (midstreamRouteReceipt.effectiveRouteId !== PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('prompt-FPN midstream route identity mismatch');
      const pixelTensorInput = midstreamRouteReceipt.inputs?.find(input => input.role === 'sam3-pixel-decoder-tensors');
      if (pixelTensorInput?.sha256 !== compositionEdge?.pixelTensorSha256) throw new Error('prompt-FPN pixelTensorSha256 does not match midstream receipt input');
      const pixelEmbedOutput = midstreamRouteReceipt.outputs?.find(output => output.role === 'pixel-embed');
      if (
        pixelEmbedOutput?.artifactId !== compositionEdge?.pixelEmbedOutput?.artifactId
        || pixelEmbedOutput?.sha256 !== compositionEdge?.pixelEmbedOutput?.sha256
        || JSON.stringify(pixelEmbedOutput?.shape) !== JSON.stringify(compositionEdge?.pixelEmbedOutput?.shape)
      ) {
        throw new Error('prompt-FPN pixel output identity does not match midstream receipt output');
      }
      const downstreamTensorInput = downstreamRouteReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('prompt-FPN downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.promptFpnMaxAbsDiff > 0.0003) throw new Error('prompt-FPN parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('prompt-FPN binary mask parity exceeds tolerance');
    } else if (requestedRouteId === PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.fpnFeatureSha256 || !lastState.tensorPacket?.expectedPixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('pixel-decoder tensorPacket identity missing');
      }
      if (lastState.parity?.pixelEmbedMaxAbsDiff > 0.0002) throw new Error('pixel embed parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 4) throw new Error('pixel decoder binary mask parity exceeds tolerance');
    } else if (requestedRouteId === MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.lastHsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('mask-tail tensorPacket identity missing');
      }
      if (lastState.parity?.binaryMismatchCount !== 0) throw new Error('binary mask parity mismatch');
    } else if (lastState.parity?.binaryMismatchCount !== 0) {
      throw new Error('binary mask parity mismatch');
    } else if (!lastState.tensorPacket?.hyperInputSha256) {
      throw new Error('tensorPacket identity missing');
    }
    if (lastState.parity?.maskLogitsMaxAbsDiff > 0.0001) throw new Error('mask logits parity exceeds tolerance');
    if (lastState.claims?.fullSam3BrowserExecution !== false) throw new Error('smoke overclaimed full SAM3 browser execution');

    phase = 'capture_screenshot';
    await delay(settleMs);
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
    primaryOutputWritten = true;

    phase = 'write_report';
    writeReport({
      ok: true,
      failure_phase: null,
    });
    await ws.close?.();
  } catch (error) {
    const failurePhase = error?.failurePhase || phase;
    phase = failurePhase;
    writeReport({
      ok: false,
      failure_phase: failurePhase,
      error: String(error?.stack || error?.message || error),
    });
    throw error;
  } finally {
    if (chromeProcess) chromeProcess.kill('SIGTERM');
    if (server) server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
