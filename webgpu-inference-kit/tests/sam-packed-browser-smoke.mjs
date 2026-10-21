// kaminos-test: manual - needs prepared native SAM weights and an independent WebGPU browser
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, realpath, copyFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { hashFile } from '../tools/sam-model.mjs';
import { resolveSamWitnessBrowser } from '../../sam-image-witness.mjs';

const { values: args } = parseArgs({ options: { out: { type: 'string' }, model: { type: 'string' },
  image: { type: 'string' }, baseline: { type: 'string' }, chrome: { type: 'string' }, playwright: { type: 'string' } } });
for (const key of ['out', 'model', 'image', 'baseline', 'chrome', 'playwright']) assert.ok(args[key], `--${key} required`);
const output = resolve(args.out), root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(output, { recursive: true });
const report = { schema: 'kaminos.sam-packed-consumer-smoke.v1', status: 'running', phase: 'pack',
  runs: [], errors: [], sourceRoot: root };
const save = () => writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
let server, context;
await save();
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', root, '--ignore-scripts', '--json', '--pack-destination', output],
    { encoding: 'utf8' }))[0];
  const tarball = join(output, packed.filename);
  report.tarball = { path: tarball, sha256: await hashFile(tarball) };
  const consumer = join(output, 'consumer');
  await mkdir(consumer, { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball],
    { cwd: consumer, stdio: 'pipe' });
  const installed = await realpath(join(consumer, 'node_modules/@kaminos/webgpu-inference-kit'));
  const model = await realpath(args.model);
  report.packageRoot = installed;
  report.model = { root: model, manifestSha256: await hashFile(join(model, 'tensor-manifest.json')) };
  await copyFile(args.image, join(output, 'input.jpg'));
  report.input = { path: join(output, 'input.jpg'), sha256: await hashFile(args.image) };
  report.phase = 'serve'; await save();
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (request.method === 'PUT' && /^\/output\/[a-z0-9-]+\.(u8|f32)$/.test(path)) {
        await pipeline(request, createWriteStream(join(output, path.slice('/output/'.length))));
        response.end('stored'); return;
      }
      if (path === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><title>SAM installed consumer</title><style>body{margin:0;background:#111;color:white;font:16px system-ui}h1{font-size:20px;margin:16px}canvas{display:block;max-width:100%;height:auto}</style><h1>SAM installed-package consumer</h1><canvas id="mask"></canvas>'); return;
      }
      let file;
      if (path === '/input.jpg') file = join(output, 'input.jpg');
      else {
        const mount = path.startsWith('/package/') ? ['/package/', installed] : ['/model/', model];
        assert.ok(path.startsWith(mount[0]), 'unknown static mount');
        file = await realpath(resolve(mount[1], decodeURIComponent(path.slice(mount[0].length))));
        assert.ok(file.startsWith(`${mount[1]}${sep}`), 'static mount escape');
      }
      response.setHeader('Content-Type', /\.(mjs|js)$/.test(file) ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      await pipeline(createReadStream(file), response);
    } catch (error) { response.statusCode = 500; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.url = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser'; report.browser = resolveSamWitnessBrowser(args.chrome); await save();
  const { chromium } = await import(pathToFileURL(resolve(args.playwright)).href);
  context = await chromium.launchPersistentContext(join(output, 'profile'), { headless: true, timeout: 0,
    executablePath: report.browser.effective, viewport: { width: 1200, height: 850 }, args: [
      '--enable-unsafe-webgpu', '--use-mock-keychain', '--password-store=basic', '--disable-extensions',
    ] });
  report.browser.version = context.browser()?.version() || 'persistent-context';
  const page = context.pages()[0]; page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.goto(report.url, { waitUntil: 'load' });
  report.phase = 'inference'; await save();
  for (const [label, prompt, cache] of [['wheel', 'wheel', 'miss'], ['negative', 'qzxv_nonexistent_object_918273', 'hit']]) {
    const result = await page.evaluate(async ({ label, prompt }) => {
      const api = await import('/package/src/sam.js');
      if (!window.segmenter) {
        window.segmenter = api.createSam3Segmenter({ manifestUrl: '/model/tensor-manifest.json', services: {
          createRuntime(options) {
            window.runtime = api.createSam3BrowserImageRuntime({ ...options, onExecutionContext(context) {
              window.execution = { fallback: context.adapter.isFallbackAdapter ?? context.adapter.info?.isFallbackAdapter,
                adapter: { vendor: context.adapter.info?.vendor, architecture: context.adapter.info?.architecture,
                  device: context.adapter.info?.device, description: context.adapter.info?.description } };
              context.device.addEventListener('uncapturederror', event => { window.gpuErrors.push(event.error.message); });
            } }); return window.runtime;
          },
        } }); window.gpuErrors = [];
      }
      const image = await (await fetch('/input.jpg')).blob();
      const result = await window.segmenter.segment(image, prompt);
      const mask = result.mask();
      const store = async (name, body) => {
        const response = await fetch(`/output/${name}`, { method: 'PUT', body });
        if (!response.ok) throw new Error(`output store failed ${response.status}`);
      };
      await store(`${label}-source.u8`, mask);
      for (const instance of result.instances) await store(`${label}-${instance.index}.u8`, new Uint8Array(instance.mask));
      const bitmap = await createImageBitmap(image), canvas = document.getElementById('mask');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < mask.length; i += 1) if (mask[i]) {
        pixels.data[i * 4] = Math.round(pixels.data[i * 4] * 0.5);
        pixels.data[i * 4 + 1] = Math.round(pixels.data[i * 4 + 1] * 0.5 + 110);
        pixels.data[i * 4 + 2] = Math.round(pixels.data[i * 4 + 2] * 0.5 + 125);
      }
      ctx.putImageData(pixels, 0, 0);
      return { invocationId: result.invocationId, prompt: result.promptText, source: result.sourceImage,
        sourceSize: result.sourceSize, authority: result.outputAuthority, route: result.effectiveRouteId,
        imageCache: result.imageCache.status, foreground: mask.reduce((a, b) => a + b, 0),
        instances: result.instances.map(({ index, score, box }) => ({ index, score, box })),
        execution: window.execution, errors: window.gpuErrors };
    }, { label, prompt });
    report.runs.push({ label, ...result }); await save();
    assert.equal(result.authority, 'actual-webgpu-readback');
    assert.equal(result.route, 'sam3.detr-encoder.phase-program.webgpu-local.v0');
    assert.equal(result.prompt, prompt); assert.equal(result.source.sha256, report.input.sha256);
    assert.equal(result.imageCache, cache); assert.deepEqual(result.errors, []);
    assert.equal(result.execution.fallback, false, 'hardware fallback status must be observed false');
    assert.deepEqual(result.sourceSize, { width: 1800, height: 1200 });
    const bytes = await readFile(join(output, `${label}-source.u8`));
    assert.equal(bytes.length, 1800 * 1200);
    if (label === 'wheel') {
      assert.ok(result.foreground > 0 && result.instances.length > 0);
      for (const instance of result.instances) {
        assert.deepEqual(await readFile(join(output, `wheel-${instance.index}.u8`)),
          await readFile(join(args.baseline, `cold-wheel-${instance.index}-mask.u8`)), 'native mask drift from accepted baseline');
      }
    } else { assert.equal(result.instances.length, 0); assert.equal(result.foreground, 0); }
    await page.screenshot({ path: join(output, `${label}.png`), fullPage: true });
  }
  report.phase = 'close'; await save();
  await page.evaluate(() => window.segmenter.close());
  assert.deepEqual(report.errors, []);
  report.status = 'passed'; report.phase = 'complete';
} catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  try { await context?.close(); } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await save();
}
console.log(JSON.stringify({ status: report.status, phase: report.phase, report: join(output, 'report.json') }));
