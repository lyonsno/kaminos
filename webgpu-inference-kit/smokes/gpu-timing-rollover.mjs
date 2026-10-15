import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// node gpu-timing-rollover.mjs ROOT OUT CHROME PUPPETEER_MODULE EXPECTED_COMMIT
const [root, out, chrome, puppeteerModule, expectedCommit] = process.argv.slice(2);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const report = { schema: 'kaminos.gpu-timing-rollover.v0', status: 'failed', phase: 'preflight',
  root, out, chrome, expectedCommit, argv: process.argv, loaded: {},
  claim: 'native query rollover and deterministic compute conformance, not TRELLIS or frame fairness' };
let browser, server;
await fs.mkdir(out, { recursive: true });
const persist = () => fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
try {
  await persist();
  report.commit = git('rev-parse', 'HEAD');
  assert.equal(report.commit, expectedCommit, 'wrong source revision');
  assert.equal(git('status', '--porcelain'), '', 'source is dirty');
  report.probeSha256 = hash(await fs.readFile(new URL(import.meta.url)));
  const { default: puppeteer } = await import(puppeteerModule);
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>GPU timing conformance</title>'); return; }
      const filename = path.resolve(root, '.' + url.pathname);
      assert.ok(filename.startsWith(root + path.sep));
      const bytes = await fs.readFile(filename);
      report.loaded[url.pathname] = hash(bytes);
      res.setHeader('Content-Type', 'text/javascript'); res.end(bytes);
    } catch (error) { res.statusCode = 404; res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.origin = `http://127.0.0.1:${server.address().port}`;
  report.phase = 'browser-launch'; await persist();
  report.chromeArgs = ['--enable-unsafe-webgpu', '--use-angle=metal', '--use-mock-keychain', '--no-first-run'];
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: report.chromeArgs,
    timeout: 0, protocolTimeout: 0 });
  report.browserVersion = await browser.version(); report.browserPid = browser.process().pid;
  const page = await browser.newPage();
  report.pageErrors = []; page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(report.origin, { timeout: 0 });
  report.phase = 'native-rollover'; await persist();
  report.native = await page.evaluate(async () => {
    const result = { status: 'failed', errors: [], capacity: 2, passes: 100, words: 65536, iterations: 32,
      createdSets: 0, destroyedSets: 0, peakLiveSets: 0, writes: [] };
    let device, runtime;
    const check = (value, message) => { if (!value) throw new Error(message); };
    try {
      const adapter = await navigator.gpu.requestAdapter(); check(adapter, 'native adapter absent');
      result.adapter = { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter };
      check(result.adapter.isFallbackAdapter === false, 'fallback or unidentified adapter');
      check(adapter.features.has('timestamp-query'), 'timestamp-query absent');
      device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
      device.addEventListener('uncapturederror', event => result.errors.push(event.error.message));
      device.pushErrorScope('validation');
      const createQuerySet = device.createQuerySet.bind(device), ids = new WeakMap();
      device.createQuerySet = descriptor => {
        const set = createQuerySet(descriptor), id = ++result.createdSets;
        ids.set(set, id);
        result.peakLiveSets = Math.max(result.peakLiveSets, result.createdSets - result.destroyedSets);
        const destroy = set.destroy.bind(set); let destroyed = false;
        set.destroy = () => { if (!destroyed) { result.destroyedSets++; destroyed = true; } destroy(); };
        return set;
      };
      const { createWebGpuInferenceRuntime } = await import('/webgpu-inference-kit/src/index.js');
      runtime = await createWebGpuInferenceRuntime({ device, queue: device.queue, adapterName: result.adapter.vendor,
        routeId: 'timing-rollover-native', gpuTiming: { capacity: result.capacity } });
      const output = runtime.createTensor({ name: 'output', shape: [result.words], dtype: 'u32' });
      const shader = device.createShaderModule({ code: `
        @group(0) @binding(0) var<storage, read_write> output: array<u32>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
          if (id.x >= arrayLength(&output)) { return; }
          var v = output[id.x];
          for (var j = 0u; j < 32u; j++) { v = v * 1664525u + 1013904223u; }
          output[id.x] = v;
        }` });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: output.buffer } }] });
      const begin = runtime.gpuTimer.begin;
      runtime.gpuTimer.begin = () => {
        const token = begin();
        if (token) result.writes.push({ set: ids.get(token.timestampWrites.querySet), index: token.timestampWrites.beginningOfPassWriteIndex });
        return token;
      };
      for (let i = 0; i < result.passes; i++) {
        await runtime.runKernel({ name: 'lcg', pipeline, bindGroup: group, bindings: [] }, { stage: `pass-${i}`, dispatch: [1024] });
      }
      const bytes = await runtime.readTensor(output); await runtime.settleGpuTiming();
      const values = new Uint32Array(bytes);
      let expected = 0;
      for (let i = 0; i < result.passes * result.iterations; i++) expected = (Math.imul(expected, 1664525) + 1013904223) >>> 0;
      result.output = { length: values.length, expected, first: values[0], last: values[values.length - 1],
        exact: values.length === result.words && values.every(value => value === expected) };
      result.timing = { ...runtime.profile.gpuTiming };
      check(result.output.exact && expected !== 0, 'deterministic compute changed or is blank');
      check(new Set(result.writes.map(write => `${write.set}:${write.index}`)).size === result.passes, 'physical timestamp pair reused or kernels omitted');
      check(result.createdSets === result.passes / result.capacity, 'unexpected query set allocation route');
      check(result.peakLiveSets === 1, 'native query sets accumulated');
      check(result.timing.pendingKernels === 0 && result.timing.untimedKernels === 0, 'incomplete timing');
      check(result.timing.resolvedKernels + result.timing.invalidKernels === result.passes, 'missing timing result');
      // Coarse browser quantization can make tiny valid workloads measure zero. Preserve that status.
      runtime.dispose(); runtime = null;
      check(result.destroyedSets === result.createdSets, 'query set leaked');
      result.validation = (await device.popErrorScope())?.message ?? null;
      check(result.validation === null && result.errors.length === 0, 'native GPU error');
      result.status = 'succeeded';
    } catch (error) { result.error = { message: error.message, stack: error.stack }; }
    finally { runtime?.dispose(); device?.destroy(); result.ownedDeviceDestroyed = !!device; }
    return result;
  });
  assert.equal(report.native.status, 'succeeded', report.native.error?.message);
  assert.deepEqual(report.pageErrors, []);
  for (const [url, digest] of Object.entries(report.loaded)) assert.equal(hash(await fs.readFile(path.resolve(root, '.' + url))), digest);
  assert.ok(report.loaded['/webgpu-inference-kit/src/gpu-timing.js'], 'timer source was not exercised');
  assert.equal(git('rev-parse', 'HEAD'), expectedCommit); assert.equal(git('status', '--porcelain'), '');
  report.status = 'succeeded'; report.phase = 'done';
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  try {
    if (browser) { await browser.close(); report.ownedBrowserClosed = true; }
    if (server) await new Promise(resolve => server.close(resolve));
  } catch (error) { report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
  await persist();
}
console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error, native: report.native,
  report: path.join(out, 'report.json') }));
