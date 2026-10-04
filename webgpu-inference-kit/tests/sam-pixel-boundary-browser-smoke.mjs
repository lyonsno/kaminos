import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const floats = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
export function authenticate(bytes, descriptor) {
  assert.equal(descriptor.dtype, 'float32', 'float32 required');
  assert.equal(bytes.length, descriptor.shape.reduce((a, b) => a * b, 1) * 4, 'tensor length');
  assert.equal(bytes.length, descriptor.byteLength, 'manifest length');
  assert.equal(hash(bytes), descriptor.sha256, 'tensor hash');
  for (const value of floats(bytes)) assert.ok(Number.isFinite(value), 'nonfinite tensor');
}
export function compare(actual, reference) {
  assert.ok(actual.length > 0, 'empty output');
  assert.equal(actual.length, reference.length, 'output length');
  let maxAbs = 0, maxAbsIndex = 0, absolute = 0, square = 0, signed = 0;
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Number.isFinite(actual[i]) && Number.isFinite(reference[i]), `nonfinite output at ${i}`);
    const delta = actual[i] - reference[i], abs = Math.abs(delta);
    if (abs > maxAbs) { maxAbs = abs; maxAbsIndex = i; }
    absolute += abs; square += delta * delta; signed += delta;
  }
  return { count: actual.length, maxAbs, maxAbsIndex, meanAbs: absolute / actual.length,
    rmse: Math.sqrt(square / actual.length), signedMean: signed / actual.length };
}
export function validateBrowser(executable) {
  assert.ok(!executable.includes('/Google Chrome.app/') &&
    /Chrome for Testing|chrome-headless-shell|chromium|chrome-linux|chrome-mac/.test(executable),
  'explicit independent CfT/Playwright Chromium required');
}

export async function main(env = process.env) {
  assert.ok(env.SAM_PIXEL_OUTPUT, 'SAM_PIXEL_OUTPUT must name caller-owned report');
  const output = path.resolve(env.SAM_PIXEL_OUTPUT), outputDir = path.dirname(output);
  const report = { status: 'failed', phase: 'configuration', sources: {}, tensors: {}, runs: [],
    receiver: 'sammy-zuckerfuck', startedAt: new Date().toISOString(), pid: process.pid,
    claim: 'raw native pixel boundary assay; no production admission or full-model interpretation' };
  const persist = async () => { await fs.mkdir(outputDir, { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
  let browser, server;
  try {
    await persist();
    for (const key of ['SAM_PIXEL_REPO_ROOT', 'SAM_PIXEL_COMMIT', 'SAM_PIXEL_BASELINE',
      'SAM_PIXEL_PACKET_DIR', 'SAM_PIXEL_RAW_DIR']) assert.ok(env[key], `${key} required`);
    report.prepareOnly = env.SAM_PIXEL_PREPARE_ONLY === '1';
    report.invocation = Object.fromEntries(['SAM_PIXEL_REPO_ROOT', 'SAM_PIXEL_COMMIT', 'SAM_PIXEL_BASELINE',
      'SAM_PIXEL_PACKET_DIR', 'SAM_PIXEL_RAW_DIR', 'SAM_PIXEL_OUTPUT', 'SAM_PIXEL_PREPARE_ONLY',
      'CHROME_PATH', 'PLAYWRIGHT_MODULE'].map(key => [key, env[key] || null]));
    if (!report.prepareOnly) for (const key of ['CHROME_PATH', 'PLAYWRIGHT_MODULE']) assert.ok(env[key], `${key} required`);
    const root = await fs.realpath(env.SAM_PIXEL_REPO_ROOT);
    const git = args => execFileSync('git', args, { cwd: root });
    assert.equal(git(['rev-parse', '--show-toplevel']).toString().trim(), root, 'explicit repository root');
    report.repoRoot = root;
    report.commit = git(['rev-parse', `${env.SAM_PIXEL_COMMIT}^{commit}`]).toString().trim();
    report.baseline = git(['rev-parse', `${env.SAM_PIXEL_BASELINE}^{commit}`]).toString().trim();
    assert.notEqual(report.commit, report.baseline, 'distinct baseline and candidate');
    report.checkoutHead = git(['rev-parse', 'HEAD']).toString().trim();
    try { git(['merge-base', '--is-ancestor', report.commit, report.checkoutHead]); }
    catch (error) { throw new Error('candidate must be an ancestor of observed checkout HEAD', { cause: error }); }
    report.phase = 'packet-authentication';
    report.packetDir = await fs.realpath(env.SAM_PIXEL_PACKET_DIR);
    report.rawDir = await fs.realpath(env.SAM_PIXEL_RAW_DIR);
    const packetBytes = await fs.readFile(path.join(report.packetDir, 'tensor-manifest.json'));
    const packet = JSON.parse(packetBytes);
    report.manifestSha256 = hash(packetBytes);
    const loadDocument = async descriptor => {
      assert.match(descriptor.sha256, /^sha256:[a-f0-9]{64}$/);
      const bytes = await fs.readFile(path.resolve(report.packetDir, descriptor.file));
      assert.equal(hash(bytes), descriptor.sha256, `document hash ${descriptor.file}`);
      report.sources[descriptor.file] = descriptor;
      return JSON.parse(bytes);
    };
    const model = await loadDocument(packet.modelPackage);
    const reference = await loadDocument(packet.referenceObservations);
    const invocation = await loadDocument(packet.invocation);
    assert.equal(reference.verifiedPackageId, model.packageId, 'reference package binding');
    assert.equal(reference.verifiedInvocationId, invocation.invocationId, 'reference invocation binding');
    assert.equal(reference.reference.weights.sha256, model.staticWeights.sha256, 'reference model weights binding');
    assert.match(reference.reference.framework.sourceCode.commit, /^[a-f0-9]{40}$/);
    report.mlxReference = reference.reference;
    const served = new Map();
    const featureRoles = ['expected-fpn-neck-feature-0', 'expected-fpn-neck-feature-1', 'expected-prompt-fpn-feature'];
    const roles = [...featureRoles, 'expected-pixel-embed'];
    for (let i = 0; i < 2; i++) for (const suffix of ['conv-weight', 'conv-bias', 'norm-weight', 'norm-bias']) roles.push(`pixel-decoder-stage-${i}-${suffix}`);
    for (const role of roles) {
      const descriptors = [...reference.tensors, ...model.weights].filter(entry => entry.role === role);
      assert.equal(descriptors.length, 1, `unique descriptor ${role}`);
      const descriptor = descriptors[0];
      let bytes, effectivePath;
      for (const directory of [report.packetDir, report.rawDir]) {
        const candidate = path.resolve(directory, descriptor.file);
        try { bytes = await fs.readFile(candidate); effectivePath = candidate; break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      assert.ok(bytes, `missing authenticated tensor ${role}`);
      authenticate(bytes, descriptor);
      report.tensors[role] = { ...descriptor, effectivePath };
      served.set(`/tensor/${role}`, bytes);
      await fs.writeFile(path.join(outputDir, `${role}.f32.bin`), bytes);
    }
    for (let i = 0; i < 3; i++) assert.deepEqual(report.tensors[featureRoles[i]].shape, [1, [288, 144, 72][i], [288, 144, 72][i], 256], 'native boundary shape');
    assert.deepEqual(report.tensors['expected-pixel-embed'].shape, [1, 288, 288, 256]);
    for (let i = 0; i < 2; i++) for (const suffix of ['conv-weight', 'conv-bias', 'norm-weight', 'norm-bias'])
      assert.deepEqual(report.tensors[`pixel-decoder-stage-${i}-${suffix}`].shape, suffix === 'conv-weight' ? [256, 3, 3, 256] : [256]);
    report.phase = 'source-snapshot';
    for (const [label, revision] of [['baseline', report.baseline], ['candidate', report.commit]]) {
      report.sources[label] = {};
      const files = git(['ls-tree', '-r', '--name-only', revision, 'webgpu-inference-kit/src']).toString().trim().split('\n');
      for (const file of files) {
        const bytes = git(['show', `${revision}:${file}`]);
        served.set(`/${label}/${file}`, bytes);
        report.sources[label][file] = hash(bytes);
      }
    }
    report.sourceTransformation = 'none; complete production src snapshots served directly from git objects';
    report.witnessSha256 = hash(await fs.readFile(fileURLToPath(import.meta.url)));
    if (report.prepareOnly) {
      report.status = 'prepared-not-executed'; report.phase = null;
      return report;
    }
    const referenceValues = floats(served.get('/tensor/expected-pixel-embed'));
    const arrays = new Map();
    server = http.createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (req.method === 'POST' && ['/output/baseline', '/output/candidate'].includes(pathname)) {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const bytes = Buffer.concat(chunks), label = pathname.split('/').pop();
          await fs.writeFile(path.join(outputDir, `${label}-pixel-embed.f32.bin`), bytes);
          const values = floats(bytes);
          const metrics = compare(values, referenceValues);
          arrays.set(label, values);
          report.runs.push({ label, sha256: hash(bytes), byteLength: bytes.length, metrics });
          await persist(); return res.end('saved');
        }
        if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>SAM native pixel boundary assay</title>'); }
        if (!served.has(pathname)) return res.writeHead(404).end();
        res.setHeader('Content-Type', pathname.includes('/tensor/') ? 'application/octet-stream' : 'text/javascript');
        res.end(served.get(pathname));
      } catch (error) { report.transportError = error.message; await persist(); res.writeHead(500).end(error.message); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    report.phase = 'browser-launch';
    report.browserPath = await fs.realpath(env.CHROME_PATH); validateBrowser(report.browserPath);
    const { chromium } = await import(env.PLAYWRIGHT_MODULE);
    browser = await chromium.launch({ executablePath: report.browserPath, headless: true, args: ['--enable-unsafe-webgpu'], timeout: 0 });
    report.browserVersion = browser.version();
    const page = await browser.newPage(); page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(report.requestedUrl); report.effectiveUrl = page.url();
    report.phase = 'native-execution'; await persist();
    await page.exposeFunction('recordPixelReceipt', async (label, receipt) => {
      const run = report.runs.find(entry => entry.label === label);
      assert.ok(run, 'complete output before receipt');
      assert.equal(receipt.effectiveRouteId, 'sam3.pixel-decoder.phase-program.webgpu-local.v0');
      assert.equal(receipt.kernel?.commit, label === 'baseline' ? report.baseline : report.commit, 'receipt source revision');
      const artifact = receipt.outputs.find(entry => entry.role === 'pixel-embed');
      assert.equal(artifact.sha256, run.sha256, 'output receipt hash');
      assert.deepEqual(artifact.shape, [1, 288, 288, 256]);
      run.receipt = receipt; await persist();
    });
    await page.exposeFunction('recordPixelBackend', async value => { report.backend = value; await persist(); });
    await page.evaluate(async config => {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter || adapter.isFallbackAdapter) throw new Error('native WebGPU adapter required');
      const info = { ...adapter.info.toJSON?.(), vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description, isFallbackAdapter: adapter.isFallbackAdapter };
      if (/swiftshader|llvmpipe|software/i.test(JSON.stringify(info))) throw new Error('software adapter refused');
      const device = await adapter.requestDevice({ requiredLimits: { maxBufferSize: 84934656, maxStorageBufferBindingSize: 84934656 } });
      let deviceFailure; device.lost.then(value => { deviceFailure = value.message; });
      device.addEventListener('uncapturederror', event => { deviceFailure = event.error.message; });
      await window.recordPixelBackend({ info, userAgent: navigator.userAgent, limits: { maxBufferSize: device.limits.maxBufferSize, maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize } });
      try {
        const load = async role => {
          const response = await fetch(`/tensor/${role}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`missing ${role}`);
          const bytes = await response.arrayBuffer();
          const digest = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
          if (digest !== config.tensors[role].sha256) throw new Error(`browser tensor hash ${role}`);
          return new Float32Array(bytes);
        };
        const features = []; for (const role of config.featureRoles) features.push(await load(role));
        const stages = [];
        for (let i = 0; i < 2; i++) { const stage = {}; for (const [key, suffix] of [['convWeight', 'conv-weight'], ['convBias', 'conv-bias'], ['normWeight', 'norm-weight'], ['normBias', 'norm-bias']]) stage[key] = await load(`pixel-decoder-stage-${i}-${suffix}`); stages.push(stage); }
        for (const label of ['baseline', 'candidate']) {
          const prefix = `/${label}/webgpu-inference-kit/src/`;
          const { runSam3PixelDecoderPhaseProgramRoute, createSam3PixelDecoderPhaseProgramRouteDefinition } = await import(prefix + 'sam-pixel-decoder-phase-program.js');
          const { createRouteInvocationRequest } = await import(prefix + 'route-boundary.js');
          const commit = label === 'baseline' ? config.baseline : config.commit;
          const route = createSam3PixelDecoderPhaseProgramRouteDefinition({ stageCount: 2, kernel: { profile: 'sam3-pixel-decoder-phase-program-v0', commit }, model: { revision: config.modelRevision, dtype: 'fp32' } });
          const request = createRouteInvocationRequest(route, {
            requestId: `native-pixel-boundary-${label}`,
            inputs: { 'source-image': config.sourceImage,
              'sam3-pixel-decoder-tensors': { artifactId: 'authenticated-mlx-pixel-boundary-inputs', sha256: config.referenceHash },
              'sam3-pixel-decoder-weights': { artifactId: config.weights.artifactId, sha256: config.weights.sha256 } },
            outputs: { 'pixel-embed': { artifactId: `native-pixel-boundary-${label}`, shape: [1, 288, 288, 256] } },
          });
          const result = await runSam3PixelDecoderPhaseProgramRoute({ request, route, device, queue: device.queue,
            adapterName: info.description || info.device, browser: navigator.userAgent, kernel: route.kernel,
            tensors: { features, weights: { stages }, shape: { batch: 1, channels: 256, groups: 8, levels: [288, 144, 72].map(size => ({ height: size, width: size })) } },
            includeReadback: true, readbackFormat: 'typed-array' });
          if (deviceFailure) throw new Error(deviceFailure);
          const values = result.debugReadback.pixelEmbed;
          const bytes = new Float32Array(values).buffer;
          const saved = await fetch(`/output/${label}`, { method: 'POST', body: bytes });
          if (!saved.ok) throw new Error(await saved.text());
          await window.recordPixelReceipt(label, result.receipt);
        }
      } finally { device.destroy(); }
    }, { tensors: report.tensors, featureRoles, commit: report.commit, baseline: report.baseline,
      modelRevision: reference.reference.model.snapshot, weights: model.staticWeights,
      referenceHash: packet.referenceObservations.sha256, sourceImage: invocation.sourceImage });
    report.phase = 'comparison';
    assert.equal(report.runs.length, 2); assert.ok(report.runs.every(run => run.receipt));
    report.candidateVsBaseline = compare(arrays.get('candidate'), arrays.get('baseline'));
    report.status = 'succeeded'; report.phase = null;
  } catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    await persist(); await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    report.cleanup = { browserClosed: browser ? !browser.isConnected() : null, serverClosed: server ? !server.listening : null };
    await persist();
    console.log(JSON.stringify({ output, status: report.status, phase: report.phase, error: report.error?.message }));
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
