#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultStageBControls,
  rebakeAnalyticalStageB,
} from './volume-stage-b-analytical-rebake.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-layer-coefficient-corpus-r4/artifacts/coefficient-state-120-source-field-manifest.json';
const DEFAULT_REPORT = resolve(root, 'scratch/stage-b-rebake-server-report.json');
const COCKPIT_PATH = resolve(root, 'volume-stage-b-rebake-cockpit.html');
const CAMERA_IDENTITY = 'state120-cockpit-fixed-camera-v0';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function stageBMissing(field) {
  return new Error(`stage-b-rebake-missing-input:${field}`);
}

const port = Number(option('--port', '18791'));
const manifestPath = resolve(option('--source-field-manifest', DEFAULT_MANIFEST));
const reportPath = resolve(option('--report', DEFAULT_REPORT));
const width = Number(option('--width', '320'));
const height = Number(option('--height', '320'));

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((accept, reject) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', accept);
  });
  return hash.digest('hex');
}

async function writeReport(report) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function loadState120() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw stageBMissing(`sourceFieldManifest:${error?.code || error?.message || String(error)}`);
  }
  if (manifest.schema !== 'kaminos.volume.full-grid-field-export.v0') throw stageBMissing('sourceFieldManifest.schema');
  if (manifest.status !== 'captured' || manifest.completeFieldCoverage !== true) throw stageBMissing('sourceFieldManifest.completeFieldCoverage');
  if (manifest.grid !== 160 || manifest.cellCount !== 4_096_000 || manifest.fluidComponents !== 16) throw stageBMissing('sourceFieldManifest.state120Shape');
  const fluidDescriptor = manifest.sidecars?.fluid;
  const frontDescriptor = manifest.sidecars?.front;
  if (!fluidDescriptor?.path) throw stageBMissing('fluid.path');
  if (!frontDescriptor?.path) throw stageBMissing('front.path');
  const [fluidStat, frontStat, fluidSha256, frontSha256] = await Promise.all([
    stat(fluidDescriptor.path).catch(() => null),
    stat(frontDescriptor.path).catch(() => null),
    sha256File(fluidDescriptor.path).catch(() => null),
    sha256File(frontDescriptor.path).catch(() => null),
  ]);
  if (!fluidStat || fluidStat.size !== fluidDescriptor.byteLength) throw stageBMissing('fluid.byteLength');
  if (!frontStat || frontStat.size !== frontDescriptor.byteLength) throw stageBMissing('front.byteLength');
  if (fluidSha256 !== fluidDescriptor.sha256) throw new Error('stage-b-rebake-source-hash-mismatch:fluid');
  if (frontSha256 !== frontDescriptor.sha256) throw new Error('stage-b-rebake-source-hash-mismatch:front');
  const [fluidBytes, frontBytes] = await Promise.all([
    readFile(fluidDescriptor.path),
    readFile(frontDescriptor.path),
  ]);
  return {
    grid: manifest.grid,
    fluid: new Float32Array(fluidBytes.buffer, fluidBytes.byteOffset, fluidBytes.byteLength / 4),
    front: new Float32Array(frontBytes.buffer, frontBytes.byteOffset, frontBytes.byteLength / 4),
    source: {
      stateId: 'coefficient-state-120',
      sameStateCaptureId: 'filament-orbit-f120-s120',
      sourceFieldManifestPath: manifestPath,
      sourceFieldManifestSha256: await sha256File(manifestPath),
      fluidSha256,
      frontSha256,
      cameraIdentity: CAMERA_IDENTITY,
      camera: {
        position: [0, 0.6, 3],
        target: [0, 0, 0],
        fovDegrees: 40,
        authority: 'volume-cockpit-default-camera-at-c5367d2a',
      },
    },
  };
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  return bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
}

async function main() {
  const bootStarted = performance.now();
  let state;
  try {
    state = await loadState120();
  } catch (error) {
    const report = {
      schema: 'kaminos.volume.stage-b-rebake-server-report.v0',
      status: 'failed',
      failurePhase: 'source-load',
      error: error?.message || String(error),
      lastTrustworthyEvidence: { requestedManifestPath: manifestPath },
      requestedRoute: `http://127.0.0.1:${port}/volume-stage-b-rebake-cockpit.html`,
      effectiveRoute: null,
      fallback: null,
    };
    await writeReport(report);
    throw error;
  }

  let latest = null;
  let rebakePromise = null;
  let rebakeCount = 0;
  const baseReport = {
    schema: 'kaminos.volume.stage-b-rebake-server-report.v0',
    status: 'serving',
    failurePhase: null,
    requestedRoute: `http://127.0.0.1:${port}/volume-stage-b-rebake-cockpit.html`,
    effectiveRoute: `http://127.0.0.1:${port}/volume-stage-b-rebake-cockpit.html`,
    backend: 'Node analytical CPU producer + browser 2D presentation',
    fallback: null,
    source: state.source,
    output: { width, height, opticalLayers: 16 },
    residency: {
      authority: 'isolated-source-plus-optical-frame-residency-v0',
      simulatorResident: false,
      descriptorCaptureResident: false,
      fluidBytes: state.fluid.byteLength,
      frontBytes: state.front.byteLength,
      browserFrameBytes: width * height * 4,
    },
    rebakeCount,
    latestReceipt: null,
    bootElapsedMs: performance.now() - bootStarted,
  };
  await writeReport(baseReport);

  async function runRebake(controls) {
    if (rebakePromise) await rebakePromise;
    rebakePromise = rebakeAnalyticalStageB({ state, controls, width, height });
    try {
      latest = await rebakePromise;
      rebakeCount += 1;
      await writeReport({ ...baseReport, rebakeCount, latestReceipt: latest.receipt });
      return latest;
    } finally {
      rebakePromise = null;
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    try {
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/volume-stage-b-rebake-cockpit.html')) {
        const body = await readFile(COCKPIT_PATH);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': body.byteLength,
          'cache-control': 'no-store',
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/favicon.ico') {
        response.writeHead(204, { 'cache-control': 'no-store' });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/status') {
        sendJson(response, 200, { ...baseReport, rebakeCount, latestReceipt: latest?.receipt || null });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/rebake') {
        const input = await readJson(request);
        const result = await runRebake(input.controls || defaultStageBControls());
        sendJson(response, 200, {
          receipt: result.receipt,
          pixelsBase64: Buffer.from(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength).toString('base64'),
        });
        return;
      }
      sendJson(response, 404, { status: 'missing', error: `route-not-found:${url.pathname}` });
    } catch (error) {
      const failure = {
        schema: 'kaminos.volume.stage-b-rebake-request-failure.v0',
        status: 'failed',
        failurePhase: url.pathname === '/api/rebake' ? 'analytical-rebake' : 'request-routing',
        error: error?.message || String(error),
        lastTrustworthyEvidence: latest?.receipt || { source: state.source },
        fallback: null,
      };
      await writeReport({ ...baseReport, status: 'failed', ...failure, rebakeCount, latestReceipt: latest?.receipt || null });
      sendJson(response, 500, failure);
    }
  });

  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', accept);
  });
  console.log(JSON.stringify({
    status: 'serving',
    route: `http://127.0.0.1:${port}/volume-stage-b-rebake-cockpit.html`,
    reportPath,
    sourceState: state.source,
  }));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
