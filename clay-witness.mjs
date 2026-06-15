#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8098/?kaminos_clay_sim=1&clay_colliders=clay_fixture_hand&clay_steps=6';
const out = resolve(args.get('--out') || '/tmp/kaminos-clay-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9444);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-clay-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1600);
const windowSize = args.get('--window-size') || '1280,900';

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
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
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function screenshotMetricsFromPng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'only 8-bit screenshots are supported');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels, `unsupported screenshot color type ${data[9]}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let p = 0;
  let prev = Buffer.alloc(stride);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  let clayColorPixels = 0;
  let brightOrangePixels = 0;
  let litPixels = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = (r + g + b) / 3;
    if (luma > 18) litPixels += 1;
    if (r > 90 && r < 210 && g > 65 && g < 175 && b > 35 && b < 140 && r >= g && g >= b * 0.75) {
      clayColorPixels += 1;
    }
    if (r > 190 && g > 90 && b < 60) brightOrangePixels += 1;
  }
  return { width, height, clayColorPixels, brightOrangePixels, litPixels };
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  let phase = 'launch';
  const [width, height] = windowSize.split(',').map(v => Number(v.trim()) || 0);
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${width || 1280},${height || 900}`,
    url,
  ], { stdio: 'ignore' });

  try {
    phase = 'cdp';
    await waitForCdp();
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_clay_sim=1')) || targets.find(t => t.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'missing clay page websocket');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'settle';
    await delay(settleMs);

    phase = 'state';
    let state = null;
    for (let i = 0; i < 30; i += 1) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosClayPrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (
        (state?.persistentClayStepCount ?? 0) >= 6
        && (state?.persistentClayDeltaHistory?.length ?? 0) >= 3
        && state?.clayDeformationCount > 0
      ) break;
      await delay(180);
    }
    assert.ok(state, 'missing clay debug state');
    assert.equal(state.effectiveRoute, 'kaminos-clay-sim-route-v0');
    assert.equal(state.prototypeIdentity, 'kaminos-clay-prototype-v0');
    assert.equal(state.solverIdentity, 'webgpu-clay-surface-lattice-scaffold-v0');
    assert.equal(state.effectiveBackend, 'WebGPU');
    assert.equal(state.substrateEvidenceKind, 'webgpu-compute-readback');
    assert.equal(state.runtimeCpuFallback, false);
    assert.equal(state.packagePrimitiveSourceContract, 'kaolin-kpm-001-forward-distance-feature-codes');
    assert.equal(state.packagePrimitiveImportPath, './vendor/webgpu-geometry-primitives/point-triangle.js');
    assert.equal(state.packagePrimitiveCommit, '49dd17c');
    assert.equal(state.pointTriangleJobFloats, 16);
    assert.equal(state.pointTriangleResultBytes, 16);
    assert.equal(state.sharedPrimitiveProbeStatus, 'pass');
    assert.equal(state.sharedPrimitiveProbeFeature, 0);
    assert.equal(state.sharedPrimitiveProbeTriangleIndex, 77);
    assert.ok(
      Math.abs((state.sharedPrimitiveProbeDistanceSq ?? Number.NaN) - 0.25) <= 1e-5,
      `shared primitive probe distance mismatch: ${state.sharedPrimitiveProbeDistanceSq}`,
    );
    assert.equal(state.primitiveContactPassStatus, 'pass');
    assert.ok((state.primitiveContactJobCount ?? 0) >= 5, 'primitive contact pass did not process hand colliders');
    assert.ok((state.primitiveContactActiveCount ?? 0) >= 5, 'primitive contact pass did not report active contacts');
    assert.ok(Number.isFinite(state.primitiveContactMinDistance), 'primitive contact pass did not record a minimum distance');
    assert.ok((state.primitiveContactForceSum ?? 0) > 0, 'primitive contact pass did not derive positive force');
    assert.equal(state.persistentClayStateStatus, 'persistent');
    assert.ok((state.persistentClayStepCount ?? 0) >= 6, 'persistent clay state did not survive the multi-step relaxation route');
    assert.ok((state.persistentClayMaxDelta ?? 0) > 0, 'persistent clay state did not report step delta');
    assert.ok(
      Array.isArray(state.persistentClayDeltaHistory) && state.persistentClayDeltaHistory.length >= 3,
      'persistent clay state did not report a multi-step delta history',
    );
    assert.ok((state.persistentClayInitialDelta ?? 0) > 0, 'persistent clay state did not record initial relaxation delta');
    assert.ok((state.persistentClayLatestDelta ?? 0) > 0, 'persistent clay state did not record latest relaxation delta');
    assert.ok(Number.isFinite(state.persistentClaySettlingRatio), 'persistent clay state did not record settling ratio');
    assert.ok(state.persistentClaySettlingRatio < 1, `persistent clay did not settle: ${state.persistentClaySettlingRatio}`);
    assert.ok((state.clayRelaxationFactor ?? 0) > 0, 'clay relaxation factor missing');
    assert.ok((state.clayPlasticityFactor ?? 0) > 0, 'clay plasticity factor missing');
    assert.ok((state.clayColliderCount ?? 0) >= 5, 'clay fixture did not seed hand colliders');
    assert.ok((state.clayContactCount ?? 0) > 0, 'clay route did not report contact');
    assert.ok((state.clayDeformationCount ?? 0) > 0, 'clay route did not report deformation');

    const earlyScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const screenshotBuffer = Buffer.from(earlyScreenshot.data, 'base64');
    writeFileSync(out, screenshotBuffer);

    phase = 'pixels';
    const metrics = screenshotMetricsFromPng(screenshotBuffer);
    assert.ok(metrics.clayColorPixels > 400, `missing clay-colored visual evidence: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.brightOrangePixels < metrics.clayColorPixels * 0.35, `not fire: output is too orange/fire-like ${JSON.stringify(metrics)}`);

    phase = 'screenshot';
    const report = {
      requestedRoute: url,
      windowSize,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      solverIdentity: state.solverIdentity,
      effectiveBackend: state.effectiveBackend,
      substrateEvidenceKind: state.substrateEvidenceKind,
      runtimeCpuFallback: state.runtimeCpuFallback,
      packagePrimitiveSourceContract: state.packagePrimitiveSourceContract,
      packagePrimitiveImportPath: state.packagePrimitiveImportPath,
      packagePrimitiveCommit: state.packagePrimitiveCommit,
      pointTriangleJobFloats: state.pointTriangleJobFloats,
      pointTriangleResultBytes: state.pointTriangleResultBytes,
      sharedPrimitiveProbeStatus: state.sharedPrimitiveProbeStatus,
      sharedPrimitiveProbeDistanceSq: state.sharedPrimitiveProbeDistanceSq,
      sharedPrimitiveProbeFeature: state.sharedPrimitiveProbeFeature,
      sharedPrimitiveProbeTriangleIndex: state.sharedPrimitiveProbeTriangleIndex,
      primitiveContactPassStatus: state.primitiveContactPassStatus,
      primitiveContactJobCount: state.primitiveContactJobCount,
      primitiveContactActiveCount: state.primitiveContactActiveCount,
      primitiveContactMinDistance: state.primitiveContactMinDistance,
      primitiveContactForceSum: state.primitiveContactForceSum,
      persistentClayStateStatus: state.persistentClayStateStatus,
      persistentClayStepCount: state.persistentClayStepCount,
      persistentClayMaxDelta: state.persistentClayMaxDelta,
      persistentClayDeltaHistory: state.persistentClayDeltaHistory,
      persistentClayInitialDelta: state.persistentClayInitialDelta,
      persistentClayLatestDelta: state.persistentClayLatestDelta,
      persistentClaySettlingRatio: state.persistentClaySettlingRatio,
      clayRelaxationFactor: state.clayRelaxationFactor,
      clayPlasticityFactor: state.clayPlasticityFactor,
      clayColliderCount: state.clayColliderCount,
      clayContactCount: state.clayContactCount,
      clayDeformationCount: state.clayDeformationCount,
      clayDeformationMax: state.clayDeformationMax,
      gpuStepCount: state.gpuStepCount,
      clayColorPixels: metrics.clayColorPixels,
      brightOrangePixels: metrics.brightOrangePixels,
      litPixels: metrics.litPixels,
      visualVerdict: 'webgpu clay surface visible; not fire',
      screenshot: out,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    const report = {
      requestedRoute: url,
      windowSize,
      phase,
      error: err?.message || String(err),
      screenshot: out,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
