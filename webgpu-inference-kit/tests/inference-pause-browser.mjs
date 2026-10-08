import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.PAUSE_REPORT;
if (!output) throw new Error('PAUSE_REPORT must name the caller-owned report');
await fs.mkdir(path.dirname(output), { recursive: true });
const report = { ok: false, phase: 'setup', events: [], served: {}, injectedBypass: process.env.PAUSE_BYPASS === '1' };
let browser, server;
try {
  const chrome = process.env.CHROME_PATH;
  if (!chrome || chrome.includes('/Applications/Google Chrome.app/')) throw new Error('Independent CHROME_PATH required');
  report.browserPath = await fs.realpath(chrome);
  report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.sourceStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  server = http.createServer(async (req, res) => {
    try {
      const relative = new URL(req.url, 'http://localhost').pathname.slice(1);
      if (!relative) { res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Inference pause native contract</title>'); return; }
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}/src/`) || !file.endsWith('.js')) { res.writeHead(404).end(); return; }
      const data = await fs.readFile(file);
      report.served[relative] = createHash('sha256').update(data).digest('hex');
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(data);
    } catch (error) { res.writeHead(500).end(String(error)); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core');
  browser = await puppeteer.launch({ executablePath: report.browserPath, headless: true,
    protocolTimeout: 0, args: ['--enable-unsafe-webgpu'] });
  report.browserVersion = await browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', error => report.events.push(error.message));
  await page.goto(report.requestedUrl);
  report.effectiveUrl = page.url();
  assert.equal(report.effectiveUrl, report.requestedUrl);
  report.phase = 'native-pause';
  report.result = await page.evaluate(async bypass => {
    const { createWebGpuInferenceControl, createWebGpuForegroundService } = await import('/src/core.js');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('native WebGPU adapter unavailable');
    const device = await adapter.requestDevice();
    const errors = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    const model = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const foreground = device.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: {
      module: device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> value: u32; @compute @workgroup_size(1) fn main() { value += 1u; }' }),
      entryPoint: 'main',
    } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: model } }] });
    const service = createWebGpuForegroundService({ routeId: 'native.pause', device });
    const run = await service.beginRun('one-invocation');
    const control = createWebGpuInferenceControl({ queue: device.queue, withForeground: run.withForeground });
    let modelSubmissions = 0, frameSubmissions = 0;
    const increment = () => {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1); pass.end();
      device.queue.submit([encoder.finish()]); modelSubmissions++;
    };
    try {
      await control.runDuty(increment);
      await control.pause();
      const parkedState = control.snapshot();
      const pending = bypass ? Promise.resolve(increment()) : control.runDuty(increment);
      const before = modelSubmissions;
      for (let i = 0; i < 3; i++) {
        await new Promise(requestAnimationFrame);
        const frame = service.request({ requestId: `frame-${i}`, run(ctx) {
          const encoder = device.createCommandEncoder(); encoder.clearBuffer(foreground);
          ctx.submit([encoder.finish()]); frameSubmissions++;
        } });
        await frame.completion;
      }
      const during = modelSubmissions;
      await control.resume();
      await pending;
      await control.runDuty(increment);
      const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(model, 0, readback, 0, 4);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const value = new Uint32Array(readback.getMappedRange())[0]; readback.unmap();
      return { adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device },
        parkedState, before, during, modelSubmissions, frameSubmissions, value, errors };
    } finally {
      await control.close(); await run.finish(); await service.dispose();
      await device.queue.onSubmittedWorkDone();
      model.destroy(); readback.destroy(); foreground.destroy(); device.destroy();
    }
  }, report.injectedBypass);
  assert.equal(report.result.parkedState.status, 'paused');
  assert.equal(report.result.before, 1, 'second model duty must remain parked');
  assert.equal(report.result.during, 1, 'model submission must not advance while foreground runs');
  assert.equal(report.result.frameSubmissions, 3);
  assert.equal(report.result.modelSubmissions, 3);
  assert.equal(report.result.value, 3);
  assert.deepEqual(report.result.errors, []);
  assert.deepEqual(report.events, []);
  for (const [relative, expected] of Object.entries(report.served)) {
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex'), expected);
  }
  assert.ok(report.served['src/inference-control.js']);
  report.ok = true; report.phase = 'complete';
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ ok: report.ok, phase: report.phase, result: report.result, error: report.error?.message, output }));
}
