import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

export function validateSamConsumerOutput(output, { prompt, empty, previousId, cache }) {
  assert.ok(output, 'missing live output');
  assert.equal(output.outputAuthority, 'actual-webgpu-readback');
  assert.equal(output.verificationState, 'not-attached');
  assert.equal(output.effectiveRouteId, 'sam3.detr-encoder.phase-program.webgpu-local.v0');
  assert.ok(output.receiptChain.includes('sam3.mask-tail.phase-program.webgpu-local.v0'));
  assert.equal(output.promptText, prompt);
  assert.ok(output.invocationId && output.invocationId !== previousId, 'invocation identity reused');
  assert.equal(output.imageCache.status, cache);
  assert.equal(output.width, 288);
  assert.equal(output.height, 288);
  assert.equal(output.instances.length === 0, empty, 'unexpected empty/nonempty result');
  for (const instance of output.instances) {
    assert.equal(instance.mask.length, output.width * output.height, 'partial mask');
    assert.equal(instance.logits.length, output.width * output.height, 'partial logits');
    assert.ok(instance.logits.every(Number.isFinite), 'nonfinite logits');
    assert.ok(instance.mask.every(value => value === 0 || value === 1), 'nonbinary mask');
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'out-dir': { type: 'string' }, 'expected-commit': { type: 'string' },
    'model-root': { type: 'string' }, image: { type: 'string' }, 'second-image': { type: 'string' },
    baseline: { type: 'string' }, port: { type: 'string', default: '18622' },
    playwright: { type: 'string' }, chrome: { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  } });
  const root = fileURLToPath(new URL('.', import.meta.url));
  const out = resolve(values['out-dir']);
  mkdirSync(out, { recursive: true });
  const report = { schema: 'kaminos.sam-image-consumer.v0', status: 'running', sourceRoot: root,
    requestedCommit: values['expected-commit'], failurePhase: 'source-identity', runs: [], captures: [],
    startedAt: new Date().toISOString(), errors: [] };
  const saveReport = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  let server, browser, page;
  const serverLog = createWriteStream(join(out, 'server.log'));
  let failRuntime;
  const fatal = new Promise((_, reject) => { failRuntime = reject; });
  fatal.catch(() => {});
  const checked = promise => Promise.race([promise, fatal]);
  saveReport();
  try {
    report.effectiveCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(report.effectiveCommit, values['expected-commit'], 'source revision mismatch');
    assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), '', 'uncommitted source changes');
    for (const field of ['model-root', 'image', 'playwright']) assert.ok(values[field], `missing --${field}`);
    report.modelManifestSha256 = createHash('sha256').update(readFileSync(join(values['model-root'], 'tensor-manifest.json'))).digest('hex');
    report.inputs = {};
    for (const field of ['image', 'second-image']) if (values[field]) {
      const bytes = readFileSync(values[field]);
      const path = join(out, `${field}-${basename(values[field])}`);
      copyFileSync(values[field], path);
      report.inputs[field] = { path, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
    }
    report.failurePhase = 'server-start'; saveReport();
    server = spawn('python3', ['-u', 'serve.py', values.port], { cwd: root, env: { ...process.env,
      KAMINOS_SAM3_PACKET_ROOT: resolve(values['model-root']), KAMINOS_ASSETS_DIR: join(out, 'assets'),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.pipe(serverLog, { end: false }); server.stderr.pipe(serverLog, { end: false });
    server.once('error', failRuntime);
    server.once('exit', code => failRuntime(new Error(`server exited: ${code}`)));
    const url = `http://127.0.0.1:${values.port}/?sam=1&commit=${report.effectiveCommit}`;
    const waitServer = async () => {
      for (;;) {
        try { const response = await fetch(new URL('/api/runtime-config', url)); if (response.ok) return response.json(); }
        catch {}
        await sleep(50);
      }
    };
    report.runtimeConfig = await checked(waitServer());
    assert.equal(report.runtimeConfig.sam3?.modelRoot, resolve(values['model-root']), 'wrong mounted model');
    assert.equal(report.runtimeConfig.sam3?.mounted, true, 'model is not mounted');
    report.failurePhase = 'browser-launch'; saveReport();
    const { chromium } = await import(pathToFileURL(resolve(values.playwright)).href);
    browser = await checked(chromium.launch({ executablePath: values.chrome, headless: true, timeout: 0,
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures', '--disable-extensions'],
    }));
    browser.once('disconnected', () => failRuntime(new Error('browser disconnected')));
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    page.on('pageerror', error => { report.errors.push(error.message); failRuntime(error); });
    report.failurePhase = 'host-load'; saveReport();
    await checked(page.goto(url, { waitUntil: 'load' }));
    await checked(page.waitForFunction(() => Boolean(window.kaminosSamImageTools)));
    report.effectiveUrl = page.url();

    async function capture(name) {
      const pixels = await checked(page.evaluate(() => {
        window.kaminosSamImageTools.setActive(true);
        const source = document.getElementById('sam-image-canvas');
        const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
        const context = copy.getContext('2d'); context.drawImage(source, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data;
        let visible = 0;
        for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 40) visible += 1;
        const rect = source.getBoundingClientRect();
        const occlusions = [...document.querySelectorAll('#tab-masks button:not(:disabled), [data-sam-image-view]')].filter(button => {
          const r = button.getBoundingClientRect();
          return r.width && r.height && r.top >= 0 && r.bottom <= innerHeight && !button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }).map(button => button.id || button.textContent);
        return { width: copy.width, height: copy.height, visible, rect: rect.toJSON(), occlusions,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
      }));
      assert.ok(pixels.visible > 0, 'blank image canvas');
      assert.equal(pixels.horizontalOverflow, false, 'horizontal overflow');
      assert.deepEqual(pixels.occlusions, [], 'occluded image controls');
      const path = join(out, `${name}.png`);
      await checked(page.screenshot({ path, fullPage: true }));
      report.captures.push({ name, path, pixels }); saveReport();
    }
    async function snapshot(label) {
      const output = await checked(page.evaluate(() => {
        const o = window.kaminosSamImageTools.output();
        if (!o) return null;
        return { ...o, mask: null, logits: null, instances: o.instances.map(i => ({ ...i, mask: null, logits: null })) };
      }));
      if (!output) throw new Error(await page.locator('#sam-image-status').innerText());
      const files = [];
      for (const index of [null, ...output.instances.map(i => i.index)]) for (const field of ['mask', 'logits']) {
        const encoded = await checked(page.evaluate(({ index, field }) => {
          const o = window.kaminosSamImageTools.output();
          const values = index === null ? o[field] : o.instances.find(row => row.index === index)[field];
          if (!values) return null;
          const typed = field === 'mask' ? new Uint8Array(values) : new Float32Array(values);
          const bytes = new Uint8Array(typed.buffer);
          let text = '';
          for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return btoa(text);
        }, { index, field }));
        if (encoded === null) continue;
        const bytes = Buffer.from(encoded, 'base64');
        const typed = field === 'mask' ? new Uint8Array(bytes) : new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
        const target = index === null ? output : output.instances.find(i => i.index === index);
        target[field] = typed;
        const path = join(out, `${label}-${index ?? 'selected'}-${field}.${field === 'mask' ? 'u8' : 'f32'}`);
        writeFileSync(path, bytes); files.push({ target, field, path, elementCount: typed.length });
      }
      return { output, archive() { for (const row of files) row.target[row.field] = { path: row.path, elementCount: row.elementCount }; } };
    }
    let previousId = null;
    async function run(label, prompt, cache, empty = false, baseline = null, inputKey = 'image') {
      report.failurePhase = label; saveReport();
      await page.locator('#sam-image-prompt').fill(prompt);
      await page.evaluate(() => {
        window.samFrameTimes = [];
        const tick = time => { window.samFrameTimes.push(time); window.samFrameHandle = requestAnimationFrame(tick); };
        window.samFrameHandle = requestAnimationFrame(tick);
      });
      const rect = await page.locator('#sam-image-canvas').boundingBox();
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      let moving = true, motionError = null;
      const motion = (async () => {
        let direction = -1;
        while (moving) { await page.mouse.wheel(0, 40 * direction); direction *= -1; await sleep(80); }
      })().catch(error => { motionError = error; });
      const start = performance.now();
      try {
        await checked(page.locator('#sam-image-run').click());
        await checked(page.waitForFunction(() => !window.kaminosSamImageTools.evidence().busy));
      } finally { moving = false; await motion; }
      if (motionError) throw motionError;
      const cadence = await page.evaluate(() => { cancelAnimationFrame(window.samFrameHandle); return window.samFrameTimes; });
      const snapshotResult = await snapshot(label);
      const { output } = snapshotResult;
      validateSamConsumerOutput(output, { prompt, cache, empty, previousId });
      previousId = output.invocationId;
      const evidence = await page.evaluate(() => window.kaminosSamImageTools.evidence());
      assert.equal(evidence.sameDevice, true, 'inference did not use the host device');
      assert.equal(evidence.foreground.failure, null);
      assert.equal(evidence.source.sha256, report.inputs[inputKey].sha256);
      const comparison = baseline ? { exactMasks: true, exactScoresAndBoxes: true, exactSelectedLogits: true } : null;
      if (baseline) {
        assert.deepEqual(output.instances.map(i => i.index), baseline.instances.map(i => i.index));
        for (let i = 0; i < output.instances.length; i += 1) {
          assert.equal(output.instances[i].score, baseline.instances[i].score);
          assert.deepEqual(output.instances[i].box, baseline.instances[i].box);
          assert.deepEqual(output.instances[i].mask, Uint8Array.from(baseline.instances[i].mask));
        }
        assert.deepEqual(output.logits, Float32Array.from(baseline.logits));
      }
      snapshotResult.archive();
      report.runs.push({ label, wallMilliseconds: performance.now() - start, output, evidence, comparison, cadence,
        cadenceAuthority: 'browser-rAF-and-input-to-GPU-submit-not-physical-display-timing' });
      saveReport(); await capture(label);
    }

    report.failurePhase = 'image-ingress'; saveReport();
    await checked(page.locator('#sam-image-file').setInputFiles(values.image));
    await checked(page.waitForFunction(() => !window.kaminosSamImageTools.evidence().busy));
    await capture('source-desktop');
    const baseline = values.baseline ? JSON.parse(readFileSync(values.baseline, 'utf8')) : null;
    await run('cold-wheel', 'wheel', 'miss', false, baseline?.visualEvidence.output);
    await run('warm-wheel', 'wheel', 'hit', false, baseline?.warmPositive.visualEvidence.output);
    await run('windows', 'windows', 'hit');
    await page.locator('#sam-image-canvas').dblclick();
    await capture('windows-desktop');
    report.failurePhase = 'source-size-export'; saveReport();
    const download = page.waitForEvent('download');
    await page.locator('#sam-image-save-mask').click();
    const saved = await checked(download); await saved.saveAs(join(out, 'windows-mask.png'));
    report.maskExport = { path: join(out, 'windows-mask.png'), filename: saved.suggestedFilename() };
    await checked(page.locator('#sam-image-add-cutout').click());
    await checked(page.waitForFunction(() => document.querySelector('.tab.active')?.dataset.tab === 'assets'));
    report.sceneObjects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
    assert.ok(report.sceneObjects.some(object => object.type === 'image' || object.kind === 'image'), 'cutout not registered in scene');
    await checked(page.screenshot({ path: join(out, 'cutout-scene.png') }));
    await page.locator('[data-tab="masks"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('windows-mobile');
    await page.setViewportSize({ width: 1440, height: 960 });
    await run('negative', 'a purple submarine with zebra stripes', 'hit', true, baseline?.negativeControl.visualEvidence.output);
    assert.equal(await page.locator('#sam-image-save-mask').isDisabled(), true);
    if (values['second-image']) {
      report.failurePhase = 'drop-image'; saveReport();
      const bytes = readFileSync(values['second-image']).toString('base64');
      const transfer = await page.evaluateHandle(({ bytes, name }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], name, { type: 'image/jpeg' }));
        return transfer;
      }, { bytes, name: basename(values['second-image']) });
      await page.locator('#sam-image-viewport').dispatchEvent('drop', { dataTransfer: transfer });
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.evidence().busy));
      await run('second-image', 'grocery bags', 'miss', false, null, 'second-image');
      report.failurePhase = 'paste-image'; saveReport();
      await page.evaluate(transfer => window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer })), transfer);
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.evidence().busy));
      await run('pasted-image', 'grocery bags', 'hit', false, null, 'second-image');
      await transfer.dispose();
    }
    report.failurePhase = 'failed-image-recovery'; saveReport();
    await page.evaluate(() => window.kaminosOpenImageMasks('/missing-image.png').catch(() => {}));
    assert.equal(await page.locator('#sam-image-canvas').isHidden(), true, 'failed ingress left a stale visible image');
    assert.equal(await page.locator('#sam-image-run').isDisabled(), true);
    await page.locator('#sam-image-file').setInputFiles(values.image);
    await checked(page.waitForFunction(() => !window.kaminosSamImageTools.evidence().busy));
    await capture('recovered-source');
    report.status = 'passed'; report.failurePhase = null;
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
    if (page) try { await page.screenshot({ path: join(out, 'failure.png') }); } catch {}
    console.error(report.error);
  } finally {
    report.completedAt = new Date().toISOString(); saveReport();
    await browser?.close();
    if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    serverLog.end();
  }
  console.log(JSON.stringify({ status: report.status, report: join(out, 'report.json'), failurePhase: report.failurePhase }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
