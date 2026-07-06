#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const REPORT_SCHEMA = 'kaminos.sam3-mask-island.browser-parity-smoke.v0';
const MASK_DECODER_ISLAND_ROUTE_ID = 'sam3.mask-decoder-island.webgpu-local.v0';
const MASK_TAIL_PHASE_PROGRAM_ROUTE_ID = 'sam3.mask-tail.phase-program.webgpu-local.v0';
const PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID = 'sam3.pixel-decoder.phase-program.webgpu-local.v0';

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
  packetMode === 'mlx-pixel-decoder-export'
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
  packetMode === 'mlx-pixel-decoder-export'
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
    if (requestedRouteId === PIXEL_DECODER_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.fpnFeatureSha256 || !lastState.tensorPacket?.expectedPixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('pixel-decoder tensorPacket identity missing');
      }
      if (lastState.parity?.pixelEmbedMaxAbsDiff > 0.0002) throw new Error('pixel embed parity exceeds tolerance');
    } else if (requestedRouteId === MASK_TAIL_PHASE_PROGRAM_ROUTE_ID) {
      if (!lastState.tensorPacket?.lastHsSha256 || !lastState.tensorPacket?.pixelEmbedSha256 || !lastState.tensorPacket?.weightsSha256) {
        throw new Error('mask-tail tensorPacket identity missing');
      }
    } else if (!lastState.tensorPacket?.hyperInputSha256) {
      throw new Error('tensorPacket identity missing');
    }
    if (lastState.parity?.maskLogitsMaxAbsDiff > 0.0001) throw new Error('mask logits parity exceeds tolerance');
    if (lastState.parity?.binaryMismatchCount !== 0) throw new Error('binary mask parity mismatch');
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
