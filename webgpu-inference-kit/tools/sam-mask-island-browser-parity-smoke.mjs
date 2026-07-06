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
const SCORING_PHASE_PROGRAM_ROUTE_ID = 'sam3.scoring.phase-program.webgpu-local.v0';
const SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.selection-postprocess.phase-program.webgpu-local.v0';
const IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-preprocess.phase-program.webgpu-local.v0';
const IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID = 'sam3.image-patch-embed.phase-program.webgpu-local.v0';
const DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID = DETR_ENCODER_PHASE_PROGRAM_ROUTE_ID;
const DETECTOR_STACK_PACKET_MODE = 'mlx-detector-stack-export';
const DETECTOR_STACK_PREPROCESS_PACKET_MODE = 'mlx-detector-stack-preprocess-export';
const DETECTOR_STACK_PATCH_EMBED_PACKET_MODE = 'mlx-detector-stack-patch-embed-export';

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
    : packetMode === 'mlx-scoring-export'
    ? join(packageRoot, 'tools/sam-scoring-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-selection-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
    : packetMode === 'mlx-detr-stack-scoring-export'
    ? join(packageRoot, 'tools/sam-detr-stack-mlx-packet.py')
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
    : packetMode === 'mlx-scoring-export'
    ? SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-selection-export'
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
    : packetMode === 'mlx-detr-stack-scoring-export'
    ? DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID
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
const scoreThreshold = args.get('--score-threshold');
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

function detectorStackReport(state) {
  const detectorStackEvidence = state?.detectorStackEvidence || null;
  if (!detectorStackEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: state.tensorPacket?.boundary || null,
    routeKind: state.tensorPacket?.routeKind || null,
    receiptChain: detectorStackEvidence.receiptChain || [],
    upstreamBoundaries: detectorStackEvidence.upstreamBoundaries || [],
    nonClaims: detectorStackEvidence.nonClaims || {},
    selectionTensorSha256: state.compositionEdge?.selectionTensorSha256 || null,
    selectionOutput: state.compositionEdge?.selectionOutput || null,
    downstreamTensorSha256: state.compositionEdge?.downstreamTensorSha256 || null,
    parity: state.parity || null,
    selectedIndex: detectorStackEvidence.selectedIndex,
    selectedScore: detectorStackEvidence.selectedScore,
    visualSelectedMaskIndex: state.selectedMaskIndex,
    selectedMaskIndexSource: state.selectedMaskIndexSource,
  };
}

function imagePreprocessReport(state) {
  const imagePreprocessEvidence = state?.imagePreprocessEvidence || null;
  if (!imagePreprocessEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imagePreprocessEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imagePreprocessEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imagePreprocessEvidence.receipt || null,
    receiptChain: imagePreprocessEvidence.receiptChain || [],
    source: imagePreprocessEvidence.source || null,
    normalization: imagePreprocessEvidence.normalization || null,
    pixelValuesTensorSha256: imagePreprocessEvidence.pixelValuesTensorSha256 || null,
    pixelValuesOutput: imagePreprocessEvidence.pixelValuesOutput || null,
    parity: imagePreprocessEvidence.parity || null,
    debugReadbackSample: imagePreprocessEvidence.debugReadbackSample || [],
    nonClaims: imagePreprocessEvidence.nonClaims || {},
  };
}

function imagePatchEmbedReport(state) {
  const imagePatchEmbedEvidence = state?.imagePatchEmbedEvidence || null;
  if (!imagePatchEmbedEvidence) return null;
  return {
    schema: state.tensorPacket?.schema || null,
    mode: state.tensorPacket?.mode || null,
    boundary: imagePatchEmbedEvidence.boundary || state.tensorPacket?.boundary || null,
    routeKind: imagePatchEmbedEvidence.routeKind || state.tensorPacket?.routeKind || null,
    receipt: imagePatchEmbedEvidence.receipt || null,
    receiptChain: imagePatchEmbedEvidence.receiptChain || [],
    source: imagePatchEmbedEvidence.source || null,
    projection: imagePatchEmbedEvidence.projection || null,
    patchEmbeddingsTensorSha256: imagePatchEmbedEvidence.patchEmbeddingsTensorSha256 || null,
    patchEmbeddingsOutput: imagePatchEmbedEvidence.patchEmbeddingsOutput || null,
    patchProjectionWeightSha256: imagePatchEmbedEvidence.patchProjectionWeightSha256 || null,
    parity: imagePatchEmbedEvidence.parity || null,
    debugReadbackSample: imagePatchEmbedEvidence.debugReadbackSample || [],
    nonClaims: imagePatchEmbedEvidence.nonClaims || {},
  };
}

function assertDetectorStackEvidence(state) {
  const report = detectorStackReport(state);
  if (!report) throw new Error('canonical detectorStack report missing');
  if (report.mode !== DETECTOR_STACK_PACKET_MODE) throw new Error('canonical detectorStack packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-real-boundary-packet.v0') throw new Error('canonical detectorStack schema mismatch');
  if (report.routeKind !== 'detector-stack-browser-local-composition') throw new Error('canonical detectorStack route kind mismatch');
  const expectedReceipts = [
    DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID,
    DETR_DECODER_PHASE_PROGRAM_ROUTE_ID,
    SCORING_PHASE_PROGRAM_ROUTE_ID,
    SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID,
    MASK_TAIL_PHASE_PROGRAM_ROUTE_ID,
  ];
  if (JSON.stringify(report.receiptChain) !== JSON.stringify(expectedReceipts)) throw new Error('canonical detectorStack receipt chain mismatch');
  if (!report.selectionTensorSha256 || !report.selectionOutput?.sha256 || !report.downstreamTensorSha256) throw new Error('canonical detectorStack composition edge incomplete');
  if (!Array.isArray(report.upstreamBoundaries) || report.upstreamBoundaries.length < 5) throw new Error('canonical detectorStack upstream boundary foothold missing');
  if (report.nonClaims?.fullSam3BrowserExecution !== true || report.nonClaims?.browserLocalVisionEncoder !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.nms !== true) throw new Error('canonical detectorStack bounded non-claims missing');
  const selectionEmptyEvidenceRejected = Number(report.selectedScore || 0) <= 0;
  if (selectionEmptyEvidenceRejected) throw new Error('canonical detectorStack selected-object evidence is empty');
  if (report.visualSelectedMaskIndex !== report.selectedIndex || report.selectedMaskIndexSource !== 'detector-selection') throw new Error('canonical detectorStack visual selected mask drift');
  if (report.parity?.selectionKeepMismatchCount > 0) throw new Error('canonical detectorStack keep mask mismatch');
  if (report.parity?.selectedIndexMaxAbsDiff > 0) throw new Error('canonical detectorStack selected index mismatch');
  return report;
}

function assertImagePreprocessEvidence(state) {
  const report = imagePreprocessReport(state);
  if (!report) throw new Error('imagePreprocess report missing');
  if (report.mode !== DETECTOR_STACK_PREPROCESS_PACKET_MODE) throw new Error('imagePreprocess packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-preprocess-real-boundary-packet.v0') throw new Error('imagePreprocess schema mismatch');
  if (report.routeKind !== 'image-preprocess-detector-stack-composition') throw new Error('imagePreprocess route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 6 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess composition receipt chain mismatch');
  if (!report.pixelValuesTensorSha256 || !report.pixelValuesOutput?.sha256 || !report.pixelValuesOutput?.artifactId) throw new Error('imagePreprocess pixel-values edge identity missing');
  if (report.parity?.pixelValuesMaxAbsDiff > 0.000001 || report.parity?.imagePreprocessCpuMaxAbsDiff > 0.000001) throw new Error('imagePreprocess pixel-values parity mismatch');
  if (report.nonClaims?.originalImageResize !== true || report.nonClaims?.browserLocalVisionEncoder !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imagePreprocess bounded non-claims missing');
  return report;
}

function assertImagePatchEmbedEvidence(state) {
  const report = imagePatchEmbedReport(state);
  if (!report) throw new Error('imagePatchEmbed report missing');
  if (report.mode !== DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) throw new Error('imagePatchEmbed packet mode mismatch');
  if (report.schema !== 'kaminos.sam3-detector-stack-image-patch-embed-real-boundary-packet.v0') throw new Error('imagePatchEmbed schema mismatch');
  if (report.routeKind !== 'image-patch-embed-detector-stack-composition') throw new Error('imagePatchEmbed route kind mismatch');
  if (report.receipt?.effectiveRouteId !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed route receipt identity mismatch');
  if (!Array.isArray(report.receiptChain) || report.receiptChain.length !== 7 || report.receiptChain[0] !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID || report.receiptChain[1] !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed composition receipt chain mismatch');
  if (!report.patchEmbeddingsTensorSha256 || !report.patchEmbeddingsOutput?.sha256 || !report.patchEmbeddingsOutput?.artifactId || !report.patchProjectionWeightSha256) throw new Error('imagePatchEmbed edge identity missing');
  if (report.parity?.patchEmbeddingsMaxAbsDiff > 0.0005 || report.parity?.imagePatchEmbedCpuMaxAbsDiff > 0.000002) throw new Error('imagePatchEmbed parity mismatch');
  if (report.nonClaims?.originalImageResize !== true || report.nonClaims?.browserLocalViTBlocks !== true || report.nonClaims?.browserLocalFpnNeck !== true || report.nonClaims?.browserLocalTextEncoder !== true || report.nonClaims?.fullSam3BrowserExecution !== true) throw new Error('imagePatchEmbed bounded non-claims missing');
  return report;
}

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
    detectorStack: detectorStackReport(lastState),
    imagePreprocess: imagePreprocessReport(lastState),
    imagePatchEmbed: imagePatchEmbedReport(lastState),
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
  if (isPython && packetMode === 'mlx-detr-stack-scoring-export') packetArgs.push('--include-scoring');
  if (isPython && packetMode === DETECTOR_STACK_PACKET_MODE) packetArgs.push('--detector-stack');
  if (isPython && packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE) packetArgs.push('--image-preprocess-ingress');
  if (isPython && packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) packetArgs.push('--image-patch-embed-ingress');
  if (isPython && packetMode === 'mlx-detr-stack-selection-export') packetArgs.push('--include-selection');
  if (isPython && (packetMode === 'mlx-detr-stack-selection-export' || packetMode === DETECTOR_STACK_PACKET_MODE || packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) && scoreThreshold != null) packetArgs.push('--score-threshold', scoreThreshold);
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
    if (requestedRouteId === SCORING_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.hiddenStatesSha256 || !lastState.tensorPacket?.promptFeaturesSha256 || !lastState.tensorPacket?.promptMaskSha256 || !lastState.tensorPacket?.expectedPredLogitsSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('SAM3 scoring tensorPacket identity missing');
      }
      const scoringInput = lastState.routeReceipt?.inputs?.find(input => input.role === 'sam3-scoring-tensors');
      if (!scoringInput?.sha256) throw new Error('SAM3 scoring receipt tensor input missing');
      const predLogitsOutput = lastState.routeReceipt?.outputs?.find(output => output.role === 'pred-logits');
      if (!predLogitsOutput?.sha256 || !predLogitsOutput?.artifactId) throw new Error('SAM3 scoring pred-logits output identity missing');
      if (lastState.parity?.predLogitsMaxAbsDiff > 0.0005) throw new Error('SAM3 scoring pred-logits parity exceeds tolerance');
      if (lastState.parity?.expectedElementCount !== lastState.parity?.gpuElementCount) throw new Error('SAM3 scoring element count mismatch');
    } else if (packetMode === 'mlx-detr-stack-selection-export' || packetMode === DETECTOR_STACK_PACKET_MODE || packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) {
      if (!lastState.tensorPacket?.expectedSelectionScoresSha256 || !lastState.tensorPacket?.expectedSelectionBoxesSha256 || !lastState.tensorPacket?.expectedSelectionKeepSha256 || !lastState.tensorPacket?.expectedSelectedIndexSha256 || !lastState.tensorPacket?.expectedSelectedScoreSha256 || !lastState.tensorPacket?.expectedSelectedBoxSha256) {
        throw new Error('DETR stack selection tensorPacket identity missing');
      }
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && (!lastState.tensorPacket?.expectedPixelValuesSha256 || !lastState.tensorPacket?.expectedPatchEmbeddingsSha256 || !lastState.tensorPacket?.patchProjectionWeightSha256)) {
        throw new Error('imagePatchEmbed detector stack tensorPacket identity missing');
      }
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 7)) {
        throw new Error('imagePatchEmbed detector stack composition receipt chain missing');
      }
      if (packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 6)) {
        throw new Error('imagePreprocess detector stack composition receipt chain missing');
      }
      if (packetMode !== DETECTOR_STACK_PREPROCESS_PACKET_MODE && packetMode !== DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 5)) {
        throw new Error('DETR stack selection composition receipt chain missing');
      }
      const receiptOffset = packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE ? 2 : packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE ? 1 : 0;
      const imagePreprocessReceipt = packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE ? lastState.compositionRouteReceipts[0] : null;
      const imagePatchEmbedReceipt = packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE ? lastState.compositionRouteReceipts[1] : null;
      const [encoderReceipt, decoderReceipt, scoringReceipt, selectionReceipt, tailReceipt] = lastState.compositionRouteReceipts.slice(receiptOffset);
      const compositionEdge = lastState.compositionEdge;
      if ((packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE || packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) && imagePreprocessReceipt.effectiveRouteId !== IMAGE_PREPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePreprocess receipt identity mismatch');
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE && imagePatchEmbedReceipt.effectiveRouteId !== IMAGE_PATCH_EMBED_PHASE_PROGRAM_ROUTE_ID) throw new Error('imagePatchEmbed receipt identity mismatch');
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) {
        const patchInput = imagePatchEmbedReceipt.inputs?.find(input => input.role === 'pixel-values');
        if (patchInput?.sha256 !== compositionEdge?.pixelValuesOutput?.sha256) throw new Error('imagePatchEmbed pixel-values input does not match preprocess output');
        const patchOutput = imagePatchEmbedReceipt.outputs?.find(output => output.role === 'patch-embeddings');
        if (
          patchOutput?.artifactId !== compositionEdge?.patchEmbeddingsOutput?.artifactId
          || patchOutput?.sha256 !== compositionEdge?.patchEmbeddingsOutput?.sha256
          || JSON.stringify(patchOutput?.shape) !== JSON.stringify(compositionEdge?.patchEmbeddingsOutput?.shape)
        ) {
          throw new Error('imagePatchEmbed output identity does not match composition edge');
        }
      }
      if (encoderReceipt.effectiveRouteId !== DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection decoder receipt identity mismatch');
      if (scoringReceipt.effectiveRouteId !== SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection scoring receipt identity mismatch');
      if (selectionReceipt.effectiveRouteId !== SELECTION_POSTPROCESS_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack selection mask-tail receipt identity mismatch');
      const selectionInput = selectionReceipt.inputs?.find(input => input.role === 'sam3-selection-tensors');
      if (selectionInput?.sha256 !== compositionEdge?.selectionTensorSha256) throw new Error('DETR stack selectionTensorSha256 does not match selection receipt input');
      const selectionOutput = selectionReceipt.outputs?.find(output => output.role === 'selected-index');
      if (
        selectionOutput?.artifactId !== compositionEdge?.selectionOutput?.artifactId
        || selectionOutput?.sha256 !== compositionEdge?.selectionOutput?.sha256
        || JSON.stringify(selectionOutput?.shape) !== JSON.stringify(compositionEdge?.selectionOutput?.shape)
      ) {
        throw new Error('DETR stack selection output identity does not match composition edge');
      }
      if (lastState.parity?.predLogitsMaxAbsDiff > 0.0005) throw new Error('DETR stack selection pred-logits parity exceeds tolerance');
      if (lastState.parity?.selectionScoresMaxAbsDiff > 0.00001) throw new Error('DETR stack selection scores parity exceeds tolerance');
      if (lastState.parity?.selectionBoxesMaxAbsDiff > 0.0002) throw new Error('DETR stack selection boxes parity exceeds tolerance');
      if (lastState.parity?.selectionKeepMismatchCount > 0) throw new Error('DETR stack selection keep mask mismatch');
      if (lastState.parity?.selectedIndexMaxAbsDiff > 0) throw new Error('DETR stack selected index parity exceeds tolerance');
      if (lastState.parity?.selectedScoreMaxAbsDiff > 0.00001) throw new Error('DETR stack selected score parity exceeds tolerance');
      if (lastState.parity?.selectedBoxMaxAbsDiff > 0.0001) throw new Error('DETR stack selected box parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR stack selection binary mask parity exceeds tolerance');
      if (packetMode === DETECTOR_STACK_PACKET_MODE) assertDetectorStackEvidence(lastState);
      if (packetMode === DETECTOR_STACK_PREPROCESS_PACKET_MODE) assertImagePreprocessEvidence(lastState);
      if (packetMode === DETECTOR_STACK_PATCH_EMBED_PACKET_MODE) assertImagePatchEmbedEvidence(lastState);
    } else if (packetMode === 'mlx-detr-stack-scoring-export') {
      if (!lastState.tensorPacket?.encoderSrcSha256 || !lastState.tensorPacket?.encoderPosSha256 || !lastState.tensorPacket?.expectedEncoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedDecoderHiddenStatesSha256 || !lastState.tensorPacket?.expectedLastHsSha256 || !lastState.tensorPacket?.expectedReferenceBoxesSha256 || !lastState.tensorPacket?.expectedPresenceLogitsSha256 || !lastState.tensorPacket?.expectedPredLogitsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('DETR stack scoring tensorPacket identity missing');
      }
      if (!Array.isArray(lastState.compositionRouteReceipts) || lastState.compositionRouteReceipts.length !== 4) {
        throw new Error('DETR stack scoring composition receipt chain missing');
      }
      const [encoderReceipt, decoderReceipt, scoringReceipt, tailReceipt] = lastState.compositionRouteReceipts;
      const compositionEdge = lastState.compositionEdge;
      if (encoderReceipt.effectiveRouteId !== DETR_STACK_SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring encoder receipt identity mismatch');
      if (decoderReceipt.effectiveRouteId !== DETR_DECODER_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring decoder receipt identity mismatch');
      if (scoringReceipt.effectiveRouteId !== SCORING_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring receipt identity mismatch');
      if (tailReceipt.effectiveRouteId !== MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) throw new Error('DETR stack scoring mask-tail receipt identity mismatch');
      const decoderHiddenStatesOutput = decoderReceipt.outputs?.find(output => output.role === 'decoder-hidden-states');
      if (
        decoderHiddenStatesOutput?.artifactId !== compositionEdge?.decoderHiddenStatesOutput?.artifactId
        || decoderHiddenStatesOutput?.sha256 !== compositionEdge?.decoderHiddenStatesOutput?.sha256
        || JSON.stringify(decoderHiddenStatesOutput?.shape) !== JSON.stringify(compositionEdge?.decoderHiddenStatesOutput?.shape)
      ) {
        throw new Error('DETR stack scoring decoder-hidden-states output identity does not match composition edge');
      }
      const scoringInput = scoringReceipt.inputs?.find(input => input.role === 'sam3-scoring-tensors');
      if (scoringInput?.sha256 !== compositionEdge?.scoringTensorSha256) throw new Error('DETR stack scoringTensorSha256 does not match scoring receipt input');
      const scoringOutput = scoringReceipt.outputs?.find(output => output.role === 'pred-logits');
      if (
        scoringOutput?.artifactId !== compositionEdge?.scoringOutput?.artifactId
        || scoringOutput?.sha256 !== compositionEdge?.scoringOutput?.sha256
        || JSON.stringify(scoringOutput?.shape) !== JSON.stringify(compositionEdge?.scoringOutput?.shape)
      ) {
        throw new Error('DETR stack scoring output identity does not match composition edge');
      }
      const downstreamTensorInput = tailReceipt.inputs?.find(input => input.role === 'sam3-mask-tail-tensors');
      if (downstreamTensorInput?.sha256 !== compositionEdge?.downstreamTensorSha256) throw new Error('DETR stack scoring downstreamTensorSha256 does not match mask-tail receipt input');
      if (lastState.parity?.encoderHiddenStatesMaxAbsDiff > 0.0003) throw new Error('DETR stack scoring encoder parity exceeds tolerance');
      if (lastState.parity?.decoderHiddenStatesMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring decoder hidden-state parity exceeds tolerance');
      if (lastState.parity?.lastHsMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring last-hs parity exceeds tolerance');
      if (lastState.parity?.referenceBoxesMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring reference-box parity exceeds tolerance');
      if (lastState.parity?.presenceLogitsMaxAbsDiff > 0.0006) throw new Error('DETR stack scoring presence parity exceeds tolerance');
      if (lastState.parity?.predLogitsMaxAbsDiff > 0.0005) throw new Error('DETR stack scoring pred-logits parity exceeds tolerance');
      if (lastState.parity?.binaryMismatchCount > 8) throw new Error('DETR stack scoring binary mask parity exceeds tolerance');
    } else if (packetMode === 'mlx-detr-stack-export') {
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
