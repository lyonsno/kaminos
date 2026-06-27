#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const value = process.argv[i + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    i++;
  } else {
    args.set(key, '1');
  }
}

const input = args.get('--input') ? resolve(args.get('--input')) : null;
const output = args.get('--output') ? resolve(args.get('--output')) : null;
const report = args.get('--report') ? resolve(args.get('--report')) : null;
const sharpRepo = resolve(process.env.KAMINOS_SHARP_WEBGPU_REPO || '/Users/noahlyons/dev/sharp-webgpu');
const chromePath = process.env.KAMINOS_SHARP_WEBGPU_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const requestedPort = Number(process.env.KAMINOS_SHARP_WEBGPU_PORT || 0);
const port = requestedPort || (54000 + Math.floor(Math.random() * 1000));
const timeoutMs = Number(process.env.KAMINOS_SHARP_WEBGPU_TIMEOUT_MS || 420000);
const outputDir = output ? dirname(output) : null;
const depthPath = outputDir ? join(outputDir, 'sharp-webgpu-depth.png') : null;
const metadataPath = outputDir ? join(outputDir, 'sharp-webgpu-metadata.json') : null;
const downloadDir = outputDir ? join(outputDir, '.sharp-webgpu-download') : null;
const url = `http://127.0.0.1:${port}/`;

let phase = 'initializing';
let server = null;
const serverLogs = { stdout: '', stderr: '' };
const browserLogs = [];
const lastTrustworthyEvidence = {};

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileEvidence(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256File(path),
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function reportBase(extra = {}) {
  return {
    schema: 'kaminos.sharp-webgpu-adapter-report.v0',
    ok: extra.ok ?? false,
    phase,
    input: input ? {
      path: input,
      ...(existsSync(input) ? { sha256: sha256File(input), bytes: statSync(input).size } : {}),
    } : null,
    output: output ? {
      role: 'splat-candidate',
      path: output,
      ...(existsSync(output) ? fileEvidence(output) : {}),
    } : null,
    sideArtifacts: [],
    backend: {
      modelFamily: 'SHARP-WebGPU',
      runtime: 'browser-webgpu',
      repo: sharpRepo,
      appUrl: url,
      chromePath,
      weightsPath: join(sharpRepo, 'public', 'weights.bin'),
    },
    lastTrustworthyEvidence,
    serverLogs: {
      stdoutTail: serverLogs.stdout.slice(-4000),
      stderrTail: serverLogs.stderr.slice(-4000),
    },
    browserLogs: browserLogs.slice(-80),
    ...extra,
  };
}

function writeReport(extra = {}) {
  if (report) writeJson(report, reportBase(extra));
}

function fail(error, extra = {}) {
  writeReport({
    ok: false,
    error: error?.message || String(error),
    ...extra,
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
}

function validateInputs() {
  if (!input || !output || !report) throw new Error('expected --input, --output, and --report');
  if (!existsSync(input)) throw new Error(`input image does not exist: ${input}`);
  if (!existsSync(sharpRepo)) throw new Error(`SHARP-WebGPU repo does not exist: ${sharpRepo}`);
  if (!existsSync(join(sharpRepo, 'package.json'))) throw new Error(`SHARP-WebGPU package.json missing under ${sharpRepo}`);
  if (!existsSync(join(sharpRepo, 'public', 'weights.bin'))) throw new Error(`SHARP-WebGPU weights missing: ${join(sharpRepo, 'public', 'weights.bin')}`);
  if (!existsSync(chromePath)) throw new Error(`Chrome executable not found: ${chromePath}`);
  mkdirSync(outputDir, { recursive: true });
  rmSync(downloadDir, { recursive: true, force: true });
  mkdirSync(downloadDir, { recursive: true });
  lastTrustworthyEvidence.input = fileEvidence(input);
  lastTrustworthyEvidence.weights = fileEvidence(join(sharpRepo, 'public', 'weights.bin'));
}

function appendLog(kind, data) {
  const text = data.toString();
  serverLogs[kind] = `${serverLogs[kind]}${text}`.slice(-12000);
}

function startServer() {
  server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: sharpRepo,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => appendLog('stdout', chunk));
  server.stderr.on('data', chunk => appendLog('stderr', chunk));
  server.on('exit', (code, signal) => {
    if (code !== null) serverLogs.stderr = `${serverLogs.stderr}\n[Vite exited ${code}]`;
    if (signal) serverLogs.stderr = `${serverLogs.stderr}\n[Vite signaled ${signal}]`;
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`SHARP-WebGPU dev server exited before serving ${url}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite binds the port.
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250));
  }
  throw new Error(`timed out waiting for SHARP-WebGPU dev server at ${url}`);
}

async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  const puppeteerPath = require.resolve('puppeteer-core', { paths: [sharpRepo] });
  return import(pathToFileURL(puppeteerPath).href);
}

async function waitForDownload() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const names = readdirSync(downloadDir);
    const complete = names.find(name => name.endsWith('.ply'));
    const partial = names.find(name => name.endsWith('.crdownload'));
    if (complete && !partial) return join(downloadDir, complete);
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 250));
  }
  throw new Error(`timed out waiting for SHARP-WebGPU PLY download under ${downloadDir}`);
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('depth canvas did not produce a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

async function runBrowserInference() {
  const { default: puppeteer } = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: process.env.KAMINOS_SHARP_WEBGPU_HEADED === '1' ? false : 'new',
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      '--disable-gpu-shader-disk-cache',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => browserLogs.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', error => browserLogs.push({ type: 'pageerror', text: error?.message || String(error) }));

    const session = await page.target().createCDPSession();
    await session.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir,
    });

    phase = 'loading-sharp-webgpu-page';
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.$eval('#use-spn', element => {
      element.checked = true;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });

    phase = 'uploading-input-image';
    const fileInput = await page.$('#file-input');
    if (!fileInput) throw new Error('SHARP-WebGPU file input not found');
    await fileInput.uploadFile(input);

    phase = 'running-sharp-webgpu-inference';
    const outcome = await page.waitForFunction(() => {
      const errorEl = document.getElementById('error');
      if (errorEl && errorEl.style.display !== 'none' && errorEl.textContent.trim()) {
        return JSON.stringify({ ok: false, error: errorEl.textContent.trim() });
      }
      const link = document.getElementById('download-ply');
      const validEl = document.getElementById('r-valid');
      if (link?.href?.startsWith('blob:') && validEl?.textContent === 'OK') {
        return JSON.stringify({
          ok: true,
          model: document.getElementById('r-model')?.textContent || null,
          weights: document.getElementById('r-weights')?.textContent || null,
          grid: document.getElementById('r-grid')?.textContent || null,
          features: document.getElementById('r-features')?.textContent || null,
          time: document.getElementById('r-time')?.textContent || null,
          valid: validEl.textContent,
          downloadText: link.textContent || null,
        });
      }
      return false;
    }, { timeout: timeoutMs });
    const result = JSON.parse(await outcome.jsonValue());
    if (!result.ok) throw new Error(result.error || 'SHARP-WebGPU page reported failure');

    phase = 'downloading-ply';
    await page.click('#download-ply');
    const downloadedPly = await waitForDownload();
    renameSync(downloadedPly, output);

    phase = 'capturing-depth-output';
    const depthDataUrl = await page.$eval('#depth-canvas', canvas => canvas.toDataURL('image/png'));
    writeFileSync(depthPath, dataUrlToBuffer(depthDataUrl));

    phase = 'writing-metadata';
    const metadata = {
      schema: 'kaminos.sharp-webgpu-metadata.v0',
      backend: {
        modelFamily: 'SHARP-WebGPU',
        runtime: 'browser-webgpu',
        repo: sharpRepo,
        appUrl: url,
      },
      result,
      input: fileEvidence(input),
      output: fileEvidence(output),
      depthMap: fileEvidence(depthPath),
    };
    writeJson(metadataPath, metadata);
    return { result, metadata };
  } finally {
    await browser.close().catch(() => {});
  }
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  setTimeout(() => {
    if (server && server.exitCode === null) server.kill('SIGKILL');
  }, 1500).unref();
  server.stdout?.destroy();
  server.stderr?.destroy();
}

try {
  phase = 'validating-native-substrate';
  validateInputs();
  phase = 'starting-sharp-webgpu-server';
  startServer();
  await waitForServer();
  const browserResult = await runBrowserInference();
  phase = 'complete';
  const sideArtifacts = [
    { id: 'depthMap', role: 'depth-map', ...fileEvidence(depthPath) },
    { id: 'metadata', role: 'sharp-webgpu-metadata', ...fileEvidence(metadataPath) },
  ];
  writeReport({
    ok: true,
    output: {
      role: 'splat-candidate',
      ...fileEvidence(output),
    },
    outputBytes: statSync(output).size,
    sideArtifacts,
    outputs: {
      splat: { id: 'splat', role: 'splat-candidate', ...fileEvidence(output) },
      depthMap: sideArtifacts[0],
      metadata: sideArtifacts[1],
    },
    inference: browserResult.result,
    metadataPath,
    depthPath,
  });
} catch (error) {
  fail(error);
} finally {
  stopServer();
  if (downloadDir) rmSync(downloadDir, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}
