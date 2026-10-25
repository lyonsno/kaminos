#!/usr/bin/env node
import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { classifySam31MemoryAttentionAdapter } from '../src/sam31-memory-attention-evidence.js';

export function requireNativeStreamAdapter(info) {
  const classification = classifySam31MemoryAttentionAdapter({ vendor: info?.vendor,
    architecture: info?.architecture, explicitFallback: info?.fallback });
  if (classification.isFallbackAdapter !== false) throw new Error(`native stream exercise requires a verified non-fallback adapter: ${JSON.stringify(info)}`);
  return classification;
}

export function validateStreamSmokeFrame(result, expected) {
  if (result.frameIndex !== expected.frameIndex || result.sourceImageSha256 !== expected.sourceImageSha256) throw new Error('frame source identity mismatch');
  if (![result.maskWidth, result.maskHeight].every(n => Number.isSafeInteger(n) && n > 0)
      || result.maskLogits?.length !== 16 * result.maskWidth * result.maskHeight
      || result.objectScores?.length !== 16 || result.maskLogits.some(n => !Number.isFinite(n))
      || result.objectScores.some(n => !Number.isFinite(n))) throw new Error('partial or nonfinite frame output');
  if (!result.receipts?.length || result.receipts.some(r => r.status !== 'real' || r.fallbackReason != null
      || !r.requestedRouteId || r.requestedRouteId !== r.effectiveRouteId || !r.outputs?.length)) throw new Error('frame route evidence is incomplete or fallback');
  if (expected.foreground) {
    const f = result.foreground;
    if (f?.status !== 'succeeded' || !f.runId || !f.routeId || !f.receipts?.length
        || ['pendingRequestCount', 'activeRequestCount', 'activeServiceCount', 'queuedServiceCount'].some(key => f[key] !== 0)
        || f.receipts.some(r => r.status !== 'completed' || r.failure != null || r.runId !== f.runId
          || r.routeId !== f.routeId || !r.boundary?.phase)) throw new Error('foreground frame evidence is missing, stale or failed');
  }
}

export async function runStreamSmoke(options) {
  const out = resolve(options.out);
  const report = { schema: 'kaminos.sam31-stream-smoke.v1', status: 'running', phase: 'output-initialization', frames: [], browserLaunched: false,
    numericalParity: null, visualAcceptance: null, claim: 'successive-frame execution only' };
  let context, server, page, outputInitialized = false;
  const saveReport = async () => {
    if (outputInitialized) try { await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); }
    catch (error) { report.status = 'failed'; report.outputReportError = String(error); process.exitCode = 1; }
    if (process.env.EPISTAXIS_JOB_PRIMARY_OUTPUT) await writeFile(process.env.EPISTAXIS_JOB_PRIMARY_OUTPUT, JSON.stringify(report, null, 2));
  };
  try {
    await mkdir(out, { recursive: true });
    if ((await readdir(out)).length) throw new Error('output directory contains retained evidence; choose a new output');
    outputInitialized = true; report.phase = 'inputs';
    const kit = await realpath(fileURLToPath(new URL('..', import.meta.url)));
    const modelDir = await realpath(options.model), sequenceDir = await realpath(options.sequence);
    const sequence = JSON.parse(await readFile(resolve(sequenceDir, 'sequence.json'), 'utf8'));
    if (sequence.frames.length < 3 || new Set(sequence.frames.map(f => f.sha256)).size !== sequence.frames.length) throw new Error('at least three distinct recorded frames are required');
    const chrome = await realpath(options.chrome);
    if (/\/Applications\/Google Chrome\.app\//.test(chrome)) throw new Error('installed GUI Chrome is not an automation executable');
    await access(chrome);
    report.source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: kit, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: kit, encoding: 'utf8' }).trim(), sequence };
    report.effective = { chrome, modelDir, sequenceDir, memoryAttentionKernel: options.kernel || 'online', staticBacking: 'memory', foreground: options.foreground === true };
    const mappings = { kit, model: modelDir, sequence: sequenceDir };
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
        if (request.method === 'POST' && /^\/artifact\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
          await pipeline(request, createWriteStream(resolve(out, url.pathname.split('/').at(-1)), { flags: 'wx' }));
          response.end('stored'); return;
        }
        if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>SAM sequential frame exercise</title><style>body{margin:16px;background:#111;color:#eee;font:14px sans-serif}canvas{width:32%;height:auto;display:inline-block}pre{white-space:pre-wrap}</style><h1>SAM sequential frame exercise</h1><pre id="status">Loading</pre><div id="frames"></div>'); return; }
        const [, mount, ...parts] = decodeURIComponent(url.pathname).split('/');
        if (!mappings[mount]) throw new Error('unknown mount');
        const base = mappings[mount], file = await realpath(resolve(base, ...parts));
        if (!file.startsWith(base + sep)) throw new Error('mount escape');
        response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' })[extname(file)] || 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store');
        await pipeline(createReadStream(file), response);
      } catch (error) { response.statusCode = 404; response.end(String(error)); }
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    report.effective.url = url; report.phase = 'browser'; await saveReport();
    const { chromium } = await import(pathToFileURL(resolve(options.playwright)).href);
    context = await chromium.launchPersistentContext(resolve(out, 'browser-profile'), { executablePath: chrome,
      headless: true, viewport: { width: 1280, height: 900 }, timeout: 0,
      args: ['--enable-unsafe-webgpu', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check'] });
    report.browserLaunched = true;
    page = context.pages()[0];
    page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    page.on('console', message => { if (message.type() === 'error') (report.consoleErrors ||= []).push(message.text()); });
    page.on('pageerror', error => (report.pageErrors ||= []).push(String(error)));
    await page.goto(url); report.phase = 'tracking'; await saveReport();
    await page.exposeFunction('checkpoint', async frame => { report.frames.push(frame); report.lastTrustworthyFrame = frame.frameIndex; await saveReport(); });
    await page.exposeFunction('adapterCheckpoint', async info => { report.effective.adapter = info; report.phase = 'adapter-selection'; await saveReport(); });
    report.execution = await page.evaluate(async ({ sequence, kernel, validator, adapterValidator, foreground: useForeground }) => {
      const validate = new Function(`return (${validator})`)();
      const { classifySam31MemoryAttentionAdapter } = await import('/kit/src/sam31-memory-attention-evidence.js');
      const requireNative = new Function('classifySam31MemoryAttentionAdapter', `return (${adapterValidator})`)(classifySam31MemoryAttentionAdapter);
      const { createSam31VideoTracker } = await import('/kit/src/sam.js');
      const { createWebGpuInferenceSession, createWebGpuForegroundService } = await import('/kit/src/core.js');
      const status = document.querySelector('#status');
      window.sam31StreamSmokeProgress = 'model-setup';
      const bytes = async path => { const r = await fetch(path); if (!r.ok) throw new Error(`input fetch failed ${r.status}: ${path}`); return new Uint8Array(await r.arrayBuffer()); };
      const hash = async value => 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), n => n.toString(16).padStart(2, '0')).join('');
      const store = async (name, value) => { const r = await fetch(`/artifact/${name}`, { method: 'POST', body: value }); if (!r.ok) throw new Error(`artifact write failed: ${name}`); };
      const gpu = { async requestAdapter(options) {
        const adapter = await navigator.gpu.requestAdapter(options);
        const info = { fallback: adapter?.isFallbackAdapter ?? adapter?.info?.isFallbackAdapter ?? null,
          vendor: adapter?.info?.vendor ?? '', architecture: adapter?.info?.architecture ?? '',
          device: adapter?.info?.device ?? '', description: adapter?.info?.description ?? '' };
        Object.assign(info, classifySam31MemoryAttentionAdapter({ vendor: info.vendor, architecture: info.architecture, explicitFallback: info.fallback }));
        window.sam31StreamSmokeProgress = 'adapter-selection';
        await window.adapterCheckpoint(info);
        requireNative(info);
        return adapter;
      } };
      let session, foreground, preview, sourceCanvas, sourceContext, pauseCheck, tracker;
      let pauseRequested = false, stopRequested = false, stopping = false;
      if (useForeground) {
        session = await createWebGpuInferenceSession({ sessionId: `sam-stream-host:${crypto.randomUUID()}`, gpu });
        foreground = createWebGpuForegroundService({ device: session.device, routeId: 'sam-stream-host' });
        sourceCanvas = document.createElement('canvas'); sourceCanvas.width = sequence.width; sourceCanvas.height = sequence.height;
        sourceContext = sourceCanvas.getContext('2d');
        const canvas = document.createElement('canvas'); canvas.id = 'live-preview'; document.body.prepend(canvas);
        const { createSamVideoPreview } = await import('/kit/examples/sam-video-preview.mjs');
        preview = await createSamVideoPreview({ canvas, device: session.device, foreground, onError(error) { tracker?.stop(error); } });
      }
      tracker = await createSam31VideoTracker({ modelPackageRoot: '/model/tracker-model-root.json', gpu,
        ...(useForeground ? { inferenceSession: session, foregroundService: foreground } : {}),
        memoryAttentionKernel: kernel, onProgress: phase => {
          status.textContent = phase; window.sam31StreamSmokeProgress = phase;
          if (useForeground && phase === 'frame-1-vit-block-stack' && !pauseRequested) {
            pauseRequested = true;
            pauseCheck = Promise.resolve().then(async () => {
              const control = await tracker.pause();
              if (control?.status !== 'paused') throw new Error('actual tracker did not pause');
              const before = preview.snapshot().submissions;
              try {
                await new Promise(resolve => setTimeout(resolve, 150));
                const after = preview.snapshot().submissions;
                if (after <= before) throw new Error('foreground stopped during tracker Pause');
                return { control, before, after, observationMs: 150 };
              } finally { await tracker.resume(); }
            });
            pauseCheck.catch(() => {});
          }
          if (stopping && !stopRequested) { stopRequested = true; tracker.stop('stop witness'); }
        } });
      const state = { packageId: tracker.packageId, adapterInfo: tracker.adapterInfo, frames: [] };
      try {
        const seed = await bytes('/sequence/' + sequence.seed.file);
        if (await hash(seed) !== sequence.seed.sha256) throw new Error('seed digest mismatch');
        for (const [frameIndex, input] of sequence.frames.entries()) {
          const rgba = await bytes('/sequence/' + input.file);
          if (await hash(rgba) !== input.sha256) throw new Error('source frame digest mismatch');
          if (preview) {
            sourceContext.putImageData(new ImageData(new Uint8ClampedArray(rgba), sequence.width, sequence.height), 0, 0);
            preview.setSource(sourceCanvas);
          }
          const result = await (frameIndex === 0 ? tracker.initialize({ rgba, timestamp: frameIndex, mask: seed }) : tracker.track({ rgba, timestamp: frameIndex }));
          validate(result, { frameIndex, sourceImageSha256: input.sha256, foreground: useForeground });
          if (pauseCheck) state.pause = await pauseCheck;
          const snapshot = tracker.snapshot();
          if (snapshot.completedFrames !== frameIndex + 1) throw new Error('tracker memory did not advance');
          await store(`frame-${frameIndex}.logits.f32`, result.maskLogits);
          await store(`frame-${frameIndex}.scores.f32`, result.objectScores);
          const record = { frameIndex, sourceImageSha256: result.sourceImageSha256, maskWidth: result.maskWidth,
            maskHeight: result.maskHeight, objectScores: [...result.objectScores], timing: result.timing,
            receipts: result.receipts, snapshot, foreground: 0, foregroundRun: result.foreground ?? null };
          const canvas = document.createElement('canvas'); canvas.width = sequence.width; canvas.height = sequence.height;
          const drawing = canvas.getContext('2d'), pixels = new Uint8ClampedArray(rgba);
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            const mx = Math.min(result.maskWidth - 1, Math.floor(x * result.maskWidth / canvas.width));
            const my = Math.min(result.maskHeight - 1, Math.floor(y * result.maskHeight / canvas.height));
            if (result.maskLogits[my * result.maskWidth + mx] > 0) {
              const i = (y * canvas.width + x) * 4; pixels[i] = pixels[i] * 0.45; pixels[i + 1] = pixels[i + 1] * 0.45 + 120; pixels[i + 2] = pixels[i + 2] * 0.45 + 120; record.foreground++;
            }
          }
          drawing.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);
          document.querySelector('#frames').append(canvas);
          await store(`frame-${frameIndex}.png`, await new Promise(done => canvas.toBlob(done)));
          await store(`frame-${frameIndex}.json`, JSON.stringify(record, null, 2));
          await window.checkpoint(record); state.frames.push(frameIndex);
        }
        if (useForeground) {
          if (!state.pause) throw new Error('pause witness was not exercised');
          stopping = true;
          const rgba = await bytes('/sequence/' + sequence.frames.at(-1).file);
          let failure;
          try { await tracker.track({ rgba, timestamp: sequence.frames.length }); } catch (error) { failure = error; }
          if (failure?.name !== 'AbortError' || tracker.snapshot().completedFrames !== sequence.frames.length) {
            throw new Error('Stop failed or committed a cancelled frame');
          }
          state.stop = { name: failure.name, snapshot: tracker.snapshot() };
          state.preview = preview.snapshot();
          if (state.preview.error) throw new Error(state.preview.error);
          const canvas = document.querySelector('#live-preview');
          await store('foreground-preview.png', await new Promise((done, reject) => canvas.toBlob(blob => blob ? done(blob) : reject(new Error('blank foreground capture')))));
        }
      } finally {
        state.teardown = await tracker.close();
        if (useForeground) {
          await preview.close(); await foreground.dispose(); await session.drain();
          state.hostTeardown = session.close();
        }
      }
      status.textContent = 'Sequential execution complete; visual and numerical acceptance remain separate.';
      return state;
    }, { sequence, kernel: report.effective.memoryAttentionKernel, validator: validateStreamSmokeFrame.toString(),
      adapterValidator: requireNativeStreamAdapter.toString(), foreground: report.effective.foreground });
    if (report.frames.length !== sequence.frames.length || report.pageErrors?.length || report.consoleErrors?.length) throw new Error('incomplete or errored sequential execution');
    await page.screenshot({ path: resolve(out, 'sequence.png'), fullPage: true });
    report.status = 'executed'; report.phase = 'complete';
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
    if (page) try { report.lastBrowserPhase = await page.evaluate(() => window.sam31StreamSmokeProgress || null); }
    catch (transport) { report.failureEvidenceReadError = String(transport); }
  }
  finally {
    try { if (context) await context.close(); } catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
    if (server) await new Promise(done => server.close(done));
    await saveReport();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { ...Object.fromEntries(['model', 'sequence', 'out', 'chrome', 'playwright', 'kernel'].map(name => [name, { type: 'string' }])), foreground: { type: 'boolean' } } });
  for (const name of ['model', 'sequence', 'out', 'chrome', 'playwright']) if (!values[name]) throw new Error(`--${name} is required`);
  console.log(JSON.stringify(await runStreamSmoke(values), null, 2));
}
