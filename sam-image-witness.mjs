import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { validateSamConsumerInteraction, validateSamFlameComposition } from './sam-image-witness-checks.js';
import { persistSamCaptureObservation, persistSamEvidenceArtifact, persistSamFlameCanvasDiagnostic, writeSamTerminalFailure } from './sam-image-witness-report.mjs';
export { validateSamConsumerInteraction, validateSamConsumerExport } from './sam-image-witness-checks.js';

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

export async function waitForSamFlameComposition(page, checked = promise => promise, timeoutMs = 120_000) {
  const startedAt = Date.now();
  try {
    await checked(page.waitForFunction(() => {
      const bridge = window.__kaminosVolumeMainRendererBridge?.debugState?.();
      const volume = window.__kaminosVolumePrototype?.debugState?.();
      const layer = bridge?.presentationLayer;
      return bridge?.maskOverlay?.visible === true && bridge.maskOverlayCount === 1
        && volume?.active === true && volume.backend?.startsWith('WebGPU:')
        && layer?.enabled === true && layer.sceneCanvasVisible === true && layer.sceneCanvasOpacity > 0
        && layer.sceneCanvasZIndex > layer.volumeCanvasZIndex && layer.volumeCanvasVisible === false
        && layer.volumeCanvasOpacity === 0
        && document.querySelector('.tab.active')?.dataset.tab === 'assets'
        && document.getElementById('sam-image-viewport')?.hidden === true;
    }, null, { timeout: timeoutMs }));
    const before = await checked(page.evaluate(() => {
      const state = window.__kaminosVolumePrototype.debugState();
      return { active: state.active, frameCount: state.frameCount, simStepCount: state.simStepCount,
        observedAtMs: performance.now() };
    }));
    await checked(page.waitForFunction(previous => {
      const state = window.__kaminosVolumePrototype?.debugState?.();
      return state?.active === true && state.frameCount > previous.frameCount
        && state.simStepCount > previous.simStepCount;
    }, before, { timeout: Math.max(1, timeoutMs - (Date.now() - startedAt)) }));
    const after = await checked(page.evaluate(() => {
      const state = window.__kaminosVolumePrototype.debugState();
      return { active: state.active, frameCount: state.frameCount, simStepCount: state.simStepCount,
        observedAtMs: performance.now() };
    }));
    return { before, after, observedMs: after.observedAtMs - before.observedAtMs };
  } catch (error) {
    let compositionDiagnostic;
    try {
      compositionDiagnostic = await checked(page.evaluate(() => {
        const tools = window.kaminosSamImageTools;
        const output = tools?.output?.();
        const volumeState = window.__kaminosVolumePrototype?.debugState?.();
        const sceneObject = window.kaminosSceneObjectDebugState?.().find(row =>
          row.image?.maskProvenance?.invocationId === output?.invocationId);
        return {
          activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          samImageViewportHidden: document.getElementById('sam-image-viewport')?.hidden === true,
          samBusy: tools?.progress?.().busy ?? null,
          samStatus: document.getElementById('sam-image-status')?.textContent || null,
          promptText: output?.promptText || null,
          invocationId: output?.invocationId || null,
          selectedIndices: tools?.selectedIndices?.() || null,
          volume: volumeState ? { active: volumeState.active, backend: volumeState.backend,
            error: volumeState.error, residualStatus: volumeState.volumeResidualStatus,
            residualModelUrl: volumeState.volumeResidualModelUrl, frameCount: volumeState.frameCount,
            simStepCount: volumeState.simStepCount,
            storageBuffersPerShaderStage: volumeState.storageBuffersPerShaderStage || null } : null,
          bridge: window.__kaminosVolumeMainRendererBridge?.debugState?.() || null,
          sceneObject: sceneObject ? { id: sceneObject.id, label: sceneObject.label, type: sceneObject.type,
            dimensions: [sceneObject.image?.width, sceneObject.image?.height],
            indices: sceneObject.image?.maskProvenance?.indices || null,
            compositionStatus: sceneObject.image?.flameComposition?.status || null } : null,
        };
      }));
    } catch (diagnosticError) {
      compositionDiagnostic = { readError: String(diagnosticError.stack || diagnosticError) };
    }
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.compositionDiagnostic = compositionDiagnostic;
    throw failure;
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'out-dir': { type: 'string' }, 'expected-commit': { type: 'string' },
    'model-root': { type: 'string' }, image: { type: 'string' }, 'second-image': { type: 'string' },
    baseline: { type: 'string' }, port: { type: 'string', default: '18622' },
    playwright: { type: 'string' }, chrome: { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    'flame-only': { type: 'boolean', default: false }, 'flame-prompt': { type: 'string', default: 'flame' },
  } });
  const root = fileURLToPath(new URL('.', import.meta.url));
  const out = resolve(values['out-dir']);
  mkdirSync(out, { recursive: true });
  const report = { schema: 'kaminos.sam-image-consumer.v0', status: 'running', sourceRoot: root,
    requestedCommit: values['expected-commit'], failurePhase: 'source-identity', runs: [], captures: [],
    startedAt: new Date().toISOString(), errors: [] };
  const saveReport = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  let server, browser, page;
  let lastTrustedEvidence = null;
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
    const volumeProfile = values['flame-only'] ? '&kaminos_volume_smoke=1' : '';
    const url = `http://127.0.0.1:${values.port}/?sam=1&commit=${report.effectiveCommit}${volumeProfile}`;
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
    await checked(page.evaluate(() => {
      const transfers = new Map();
      window.__samEvidenceTransfers = transfers;
      window.__beginSamEvidenceTransfer = value => {
        const text = JSON.stringify(value) ?? 'null';
        const transferId = crypto.randomUUID();
        transfers.set(transferId, text);
        return { transferId, totalLength: text.length };
      };
    }));
    report.effectiveUrl = page.url();

    async function persistBrowserTransfer(label, descriptor) {
      const reference = await persistSamEvidenceArtifact({ outDir: out, label,
        transferId: descriptor.transferId, totalLength: descriptor.totalLength,
        readChunk: request => checked(page.evaluate(({ transferId, offset, totalLength, length }) => {
          const text = window.__samEvidenceTransfers?.get(transferId);
          if (typeof text !== 'string') throw new Error(`evidence transfer unavailable: ${transferId}`);
          if (text.length !== totalLength) throw new Error('evidence transfer length changed');
          let end = Math.min(offset + length, totalLength);
          if (end < totalLength && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1;
          return { transferId, offset, totalLength, text: text.slice(offset, end) };
        }, request)),
      });
      lastTrustedEvidence = reference;
      await checked(page.evaluate(transferId => window.__samEvidenceTransfers.delete(transferId), descriptor.transferId));
      return reference;
    }

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
        const overflowingElements = [...document.querySelectorAll('*')].filter(element => {
          const elementRect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return elementRect.width > 0 && elementRect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
            && (elementRect.left < -0.5 || elementRect.right > innerWidth + 0.5 || element.scrollWidth > element.clientWidth + 1);
        }).map(element => {
          const elementRect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { tag: element.tagName.toLowerCase(), id: element.id || null,
            className: typeof element.className === 'string' ? element.className : null,
            text: (element.innerText || element.textContent || '').trim(),
            rect: elementRect.toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            overflowX: style.overflowX, minWidth: style.minWidth, whiteSpace: style.whiteSpace };
        });
        return { width: copy.width, height: copy.height, visible, rect: rect.toJSON(), occlusions,
          viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio,
          documentClientWidth: document.documentElement.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          overflowingElements };
      }));
      const path = join(out, `${name}.png`);
      const captureRecord = persistSamCaptureObservation({ report, name, path, pixels, saveReport });
      await checked(page.screenshot({ path, fullPage: true }));
      captureRecord.screenshotCaptured = true;
      saveReport();
      assert.ok(pixels.visible > 0, 'blank image canvas');
      assert.equal(pixels.horizontalOverflow, false,
        `horizontal overflow: viewport=${pixels.viewportWidth}, document=${pixels.documentScrollWidth}, body=${pixels.bodyScrollWidth}, candidates=${JSON.stringify(pixels.overflowingElements)}`);
      assert.deepEqual(pixels.occlusions, [], 'occluded image controls');
      captureRecord.validation = 'passed';
      saveReport();
    }
    async function snapshot(label) {
      const captured = await checked(page.evaluate(() => {
        const o = window.kaminosSamImageTools.output();
        if (!o) return null;
        const imageCache = o.imageCache ? { ...o.imageCache, resources: null } : o.imageCache;
        const cleanOutput = { ...o, imageCache, mask: null, logits: null,
          instances: o.instances.map(i => ({ ...i, mask: null, logits: null })) };
        const resourceTransfer = o.imageCache?.resources == null ? null : window.__beginSamEvidenceTransfer(o.imageCache.resources);
        return { output: cleanOutput, resourceTransfer };
      }));
      if (!captured) throw new Error(await page.locator('#sam-image-status').innerText());
      const { output } = captured;
      if (captured.resourceTransfer) output.imageCache.resources = await persistBrowserTransfer(`${label}-resources`, captured.resourceTransfer);
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
      let moving = true, motionError = null;
      let motion = Promise.resolve();
      const start = performance.now();
      try {
        await checked(page.locator('#sam-image-run').click());
        // The click moves the pointer to the button; restore it before exercising the viewport.
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        motion = (async () => {
          let direction = -1;
          while (moving) { await page.mouse.wheel(0, 40 * direction); direction *= -1; await sleep(80); }
        })().catch(error => { motionError = error; });
        await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      } finally { moving = false; await motion; }
      if (motionError) throw motionError;
      const cadence = await page.evaluate(() => { cancelAnimationFrame(window.samFrameHandle); return window.samFrameTimes; });
      const snapshotResult = await snapshot(label);
      const { output } = snapshotResult;
      validateSamConsumerOutput(output, { prompt, cache, empty, previousId });
      previousId = output.invocationId;
      const evidenceTransfer = await checked(page.evaluate(() => ({
        interaction: window.kaminosSamImageTools.interactionEvidence(),
        archive: window.__beginSamEvidenceTransfer(window.kaminosSamImageTools.evidence()),
      })));
      const interactionEvidence = evidenceTransfer.interaction;
      const interaction = validateSamConsumerInteraction(interactionEvidence, output.invocationId);
      assert.equal(interactionEvidence.source.sha256, report.inputs[inputKey].sha256);
      const evidence = await persistBrowserTransfer(`${label}-runtime`, evidenceTransfer.archive);
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
      const duringInference = cadence.filter(time => time >= interaction.start && time <= interaction.end);
      const boundaries = [interaction.start, ...duringInference, interaction.end];
      const gaps = boundaries.slice(1).map((time, index) => time - boundaries[index]);
      report.runs.push({ label, witnessWallMilliseconds: performance.now() - start,
        inferenceWallMilliseconds: interaction.end - interaction.start, output, evidence, comparison, interaction, cadence,
        longestBrowserCallbackGapMs: Math.max(...gaps),
        cadenceAuthority: 'browser-rAF-and-input-to-GPU-submit-not-physical-display-timing' });
      saveReport(); await capture(label);
    }

    async function saveExport(kind, label, addToScene = false) {
      report.failurePhase = label; saveReport();
      const responsePromise = page.waitForResponse(response => {
        const address = new URL(response.url());
        return address.pathname === '/api/ingest-image' && address.searchParams.get('name')?.endsWith(`-${kind}.png`);
      });
      const downloadPromise = addToScene ? null : page.waitForEvent('download');
      downloadPromise?.catch(() => {});
      await checked(page.locator(addToScene ? '#sam-image-add-cutout' : `#sam-image-save-${kind}`).click());
      const response = await checked(responsePromise);
      const receipt = await response.json();
      assert.equal(response.status(), 200, JSON.stringify(receipt));
      const entry = receipt.entry;
      assert.ok(entry?.source, 'save did not return an asset');
      const binary = await fetch(new URL(entry.source, url));
      assert.equal(binary.status, 200);
      const bytes = Buffer.from(await binary.arrayBuffer());
      const path = join(out, `${label}.png`);
      writeFileSync(path, bytes);
      const sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      assert.equal(sha256, entry.sha256, 'saved bytes do not match ingest receipt');
      let download = null;
      if (downloadPromise) {
        const saved = await checked(downloadPromise);
        const downloadedPath = join(out, `${label}-download.png`);
        await saved.saveAs(downloadedPath);
        assert.deepEqual(readFileSync(downloadedPath), bytes, 'download is not the persisted export');
        download = { path: downloadedPath, filename: saved.suggestedFilename() };
      }
      const inspection = await checked(page.evaluate(async ({ entry, kind }) => {
        const { validateSamConsumerExport } = await import('./sam-image-witness-checks.js');
        const { createSam3SourceMask } = await import('./webgpu-inference-kit/src/sam.js');
        const tools = window.kaminosSamImageTools, output = tools.output(), source = tools.progress().source;
        const selection = document.getElementById('sam-image-instances').value;
        const indices = selection === 'all' ? output.instances.map(row => row.index) : [Number(selection)];
        async function pixels(address) {
          const response = await fetch(address);
          if (!response.ok) throw new Error(`export inspection read failed: ${response.status}`);
          const blob = await response.blob(), bytes = await blob.arrayBuffer();
          const sha256 = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')}`;
          const objectUrl = URL.createObjectURL(blob), image = new Image();
          try { image.src = objectUrl; await image.decode(); } finally { URL.revokeObjectURL(objectUrl); }
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          return { width: canvas.width, height: canvas.height, mimeType: response.headers.get('content-type'), sha256,
            pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
        }
        const sourceImage = await pixels(source.source), exported = await pixels(entry.source);
        if (sourceImage.sha256 !== source.sha256) throw new Error('source changed before export inspection');
        const library = await (await fetch('/api/assets?kind=image')).json();
        const libraryEntry = library.entries.find(row => row.id === entry.id);
        const comparison = validateSamConsumerExport({ ...exported, source: entry.source, name: entry.name }, {
          kind, width: sourceImage.width, height: sourceImage.height, sourcePixels: sourceImage.pixels,
          mask: createSam3SourceMask(output, indices, sourceImage.width, sourceImage.height), libraryEntry,
        });
        return { comparison, indices, invocationId: output.invocationId, promptText: output.promptText,
          sourceImage: source.source, libraryEntry, sha256: exported.sha256 };
      }, { entry, kind }));
      assert.equal(inspection.sha256, sha256);
      report.exports ||= [];
      report.exports.push({ kind, label, path, sha256, entry, download, inspection }); saveReport();
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      if (addToScene) {
        await checked(page.waitForFunction(() => document.querySelector('.tab.active')?.dataset.tab === 'assets'));
        report.sceneObjects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
        const object = report.sceneObjects.find(row => row.type === 'image' && row.source === entry.source);
        assert.ok(object, 'exact persisted cutout is not registered in scene');
        assert.equal(object.image.assetSource, entry.source);
        assert.equal(object.image.width, inspection.comparison.width);
        assert.equal(object.image.height, inspection.comparison.height);
        assert.deepEqual(object.image.maskProvenance, { sourceImage: inspection.sourceImage,
          promptText: inspection.promptText, invocationId: inspection.invocationId, indices: inspection.indices });
        await checked(page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
        const scenePath = join(out, `${label}-scene.png`);
        await checked(page.screenshot({ path: scenePath }));
        report.captures.push({ name: `${label}-scene`, path: scenePath, visualInspection: 'pending-owner-pixel-read' }); saveReport();
      }
    }

    report.failurePhase = 'image-ingress'; saveReport();
    // The accepted source bytes keep numerical parity while the name exercises export persistence.
    await checked(page.locator('#sam-image-file').setInputFiles({ name: values['flame-only'] ? basename(values.image) : `${'a'.repeat(245)}.jpg`,
      mimeType: 'image/jpeg', buffer: readFileSync(values.image) }));
    await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
    await capture('source-desktop');
    if (values['flame-only']) {
      report.failurePhase = 'flame-inference'; saveReport();
      const prompt = values['flame-prompt'];
      await page.locator('#sam-image-prompt').fill(prompt);
      await checked(page.locator('#sam-image-run').click());
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      const snapshotResult = await snapshot('flame-only');
      const output = snapshotResult.output;
      assert.equal(output.promptText, prompt, 'wrong prompt reached SAM');
      assert.equal(output.outputAuthority, 'actual-webgpu-readback', 'flame proposal is not live WebGPU output');
      assert.equal(output.verificationState, 'not-attached', 'SAM proposal authority was overstated');
      assert.equal(output.effectiveRouteId, 'sam3.detr-encoder.phase-program.webgpu-local.v0', 'wrong SAM route');
      assert.ok(output.instances.length > 0, 'SAM returned no flame candidates');
      const selected = output.instances[0];
      assert.equal(selected.mask.length, output.width * output.height, 'selected SAM mask is partial');
      assert.ok(selected.mask.some(value => value === 1), 'selected SAM mask has no foreground');
      assert.ok(selected.mask.every(value => value === 0 || value === 1), 'selected SAM mask is not binary');
      await page.locator('#sam-image-instances').selectOption(String(selected.index));
      report.failurePhase = 'flame-rollback-control'; saveReport();
      await page.evaluate(() => {
        const volume = window.__kaminosVolumePrototype;
        volume.__samWitnessSetActive = volume.setActive.bind(volume);
        volume.setActive = async active => {
          if (active) throw new Error('injected flame activation failure');
          return volume.__samWitnessSetActive(active);
        };
      });
      await checked(page.locator('#sam-image-flame').click());
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      const rollback = await page.evaluate(() => ({
        bridge: window.__kaminosVolumeMainRendererBridge.debugState(),
        activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
        status: document.getElementById('sam-image-status')?.textContent || null,
        sceneMatches: window.kaminosSceneObjectDebugState().filter(row =>
          row.image?.maskProvenance?.invocationId === window.kaminosSamImageTools.output().invocationId).length,
      }));
      assert.equal(rollback.activeTab, 'masks', 'failed activation must not show Assets as a completed composition');
      assert.equal(rollback.bridge.maskOverlayCount, 0, 'failed activation left a live mask overlay');
      assert.equal(rollback.sceneMatches, 0, 'failed activation left a registered scene composition');
      assert.match(rollback.status, /injected flame activation failure/, 'failure status was hidden from the operator');
      report.flameRollback = { status: 'passed', ...rollback };
      report.captures.push({ name: 'flame-composition-rollback', path: join(out, 'flame-composition-rollback.png') });
      await checked(page.screenshot({ path: join(out, 'flame-composition-rollback.png'), fullPage: true }));
      await page.evaluate(() => {
        const volume = window.__kaminosVolumePrototype;
        volume.setActive = volume.__samWitnessSetActive;
        delete volume.__samWitnessSetActive;
      });
      report.failurePhase = 'flame-composition'; saveReport();
      const compositionWaitStartedAt = Date.now();
      await checked(page.locator('#sam-image-flame').click());
      let advanceEvidence;
      try { advanceEvidence = await waitForSamFlameComposition(page, checked); }
      catch (error) {
        report.compositionDiagnostic = { waitMs: Date.now() - compositionWaitStartedAt,
          state: error.compositionDiagnostic || null };
        throw error;
      }
      await checked(page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
      const observed = await page.evaluate(() => ({
        bridge: window.__kaminosVolumeMainRendererBridge.debugState(),
        volume: window.__kaminosVolumePrototype.debugState(),
        selectedIndices: window.kaminosSamImageTools.selectedIndices(),
        presentation: { activeTab: document.querySelector('.tab.active')?.dataset.tab || null,
          samImageViewportHidden: document.getElementById('sam-image-viewport')?.hidden === true,
          compositionLayer: window.__kaminosVolumeMainRendererBridge.debugState().presentationLayer },
        sceneObject: window.kaminosSceneObjectDebugState().find(row =>
          row.image?.maskProvenance?.invocationId === window.kaminosSamImageTools.output().invocationId),
      }));
      const flamePixelScan = await page.evaluate(async sceneObjectId => {
        const { fitSamFlameTextureToMask, getSamFlameMaskBounds } = await import('./sam-image-tools.js');
        const mask = window.kaminosSamImageTools.selectedMask();
        const imageRecord = window.kaminosSceneObjectDebugState().find(row => row.id === sceneObjectId);
        const [width, height] = imageRecord?.image?.maskProvenance?.dimensions || [];
        const fireCanvas = window.__kaminosVolumePrototype.canvasElement();
        if (!mask || mask.length !== width * height || !fireCanvas?.width || !fireCanvas?.height) {
          throw new Error('Pixel witness is missing the selected source mask or live flame canvas');
        }
        const flame = document.createElement('canvas');
        flame.width = fireCanvas.width; flame.height = fireCanvas.height;
        const flameContext = flame.getContext('2d', { willReadFrequently: true });
        flameContext.drawImage(fireCanvas, 0, 0);
        const flamePixels = flameContext.getImageData(0, 0, flame.width, flame.height).data;
        const maskBounds = getSamFlameMaskBounds(mask, width, height);
        const texturePlacement = fitSamFlameTextureToMask(flame.width, flame.height, width, height, maskBounds);
        const isInterior = (x, y, value) => {
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
            const sx = x + dx, sy = y + dy;
            if (sx < 0 || sx >= width || sy < 0 || sy >= height || mask[sy * width + sx] !== value) return false;
          }
          return true;
        };
        let foreground = null, background = null;
        let interiorForegroundSamples = 0, interiorBackgroundSamples = 0;
        let brightSamplesInMaskForeground = 0, brightSamplesInMaskBackground = 0;
        let rgbNonzeroPixels = 0, nontransparentPixels = 0, brightPixels = 0, visibleBrightPixels = 0;
        let maxRgbSum = 0, maxAlpha = 0, brightBounds = null;
        for (let y = 0; y < flame.height; y += 1) for (let x = 0; x < flame.width; x += 1) {
          const pixel = (y * flame.width + x) * 4;
          const red = flamePixels[pixel], green = flamePixels[pixel + 1], blue = flamePixels[pixel + 2];
          const alpha = flamePixels[pixel + 3];
          const intensity = red + green + blue;
          if (red || green || blue) rgbNonzeroPixels += 1;
          if (alpha) nontransparentPixels += 1;
          if (alpha > maxAlpha) maxAlpha = alpha;
          if (intensity > maxRgbSum) maxRgbSum = intensity;
          if (intensity >= 80) {
            brightPixels += 1;
            if (alpha) visibleBrightPixels += 1;
            if (!brightBounds) brightBounds = { left: x, top: y, right: x, bottom: y };
            else {
              brightBounds.left = Math.min(brightBounds.left, x);
              brightBounds.top = Math.min(brightBounds.top, y);
              brightBounds.right = Math.max(brightBounds.right, x);
              brightBounds.bottom = Math.max(brightBounds.bottom, y);
            }
          }
          const sourceX = Math.min(width - 1, Math.floor((texturePlacement.imageRect.left
            + (x + 0.5) / flame.width * texturePlacement.imageRect.width) * width));
          const sourceY = Math.min(height - 1, Math.floor((texturePlacement.imageRect.top
            + (y + 0.5) / flame.height * texturePlacement.imageRect.height) * height));
          const maskValue = mask[sourceY * width + sourceX];
          if ((maskValue !== 0 && maskValue !== 1) || !isInterior(sourceX, sourceY, maskValue)) continue;
          if (maskValue === 1) interiorForegroundSamples += 1;
          else interiorBackgroundSamples += 1;
          if (intensity < 80) continue;
          if (maskValue === 1) brightSamplesInMaskForeground += 1;
          else brightSamplesInMaskBackground += 1;
          const candidate = { u: (sourceX + 0.5) / width, v: (sourceY + 0.5) / height,
            maskValue, intensity, sourceX, sourceY };
          if (maskValue === 1 && (!foreground || intensity > foreground.intensity)) foreground = candidate;
          if (maskValue === 0 && (!background || intensity > background.intensity)) background = candidate;
        }
        return { nativeFlameCanvasPng: flame.toDataURL('image/png'), width: flame.width, height: flame.height,
          texturePlacement: { maskBounds, ...texturePlacement },
          foreground, background, diagnostics: { interiorForegroundSamples, interiorBackgroundSamples,
            brightSamplesInMaskForeground, brightSamplesInMaskBackground, rgbNonzeroPixels,
            nontransparentPixels, brightPixels, visibleBrightPixels, maxRgbSum, maxAlpha, brightBounds } };
      }, observed.sceneObject.id);
      const nativeFlameCanvas = persistSamFlameCanvasDiagnostic({ outDir: out,
        dataUrl: flamePixelScan.nativeFlameCanvasPng, width: flamePixelScan.width, height: flamePixelScan.height,
        diagnostics: flamePixelScan.diagnostics });
      report.compositionDiagnostic = { ...flamePixelScan.diagnostics,
        texturePlacement: flamePixelScan.texturePlacement, nativeFlameCanvas };
      lastTrustedEvidence = nativeFlameCanvas;
      saveReport();
      if (!flamePixelScan.foreground || !flamePixelScan.background) {
        const error = new Error('No bright flame samples overlap both selected-mask foreground and background');
        error.compositionDiagnostic = report.compositionDiagnostic;
        throw error;
      }
      const presentedPixels = await page.evaluate(({ sceneObjectId, foreground, background }) =>
        window.__kaminosSampleSamFlamePixels(sceneObjectId, [foreground, background]), {
        sceneObjectId: observed.sceneObject.id, foreground: flamePixelScan.foreground, background: flamePixelScan.background,
      });
      const compositionCanvasMatch = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(presentedPixels.composedCanvasPng || '');
      assert.ok(compositionCanvasMatch, 'main renderer did not preserve its sampled composition canvas');
      const compositionCanvasBytes = Buffer.from(compositionCanvasMatch[1], 'base64');
      assert.ok(compositionCanvasBytes.length >= 8 && compositionCanvasBytes.subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'main renderer canvas capture is not a PNG');
      const rendererCanvasCapturePath = join(out, 'flame-composition-renderer-canvas.png');
      writeFileSync(rendererCanvasCapturePath, compositionCanvasBytes, { flag: 'wx' });
      const rendererCanvasCapture = { path: rendererCanvasCapturePath,
        width: presentedPixels.backingSize.width, height: presentedPixels.backingSize.height,
        bytes: compositionCanvasBytes.length,
        sha256: `sha256:${createHash('sha256').update(compositionCanvasBytes).digest('hex')}`,
        authority: presentedPixels.authority };
      report.captures.push({ name: 'flame-composition-renderer-canvas', ...rendererCanvasCapture,
        validation: 'diagnostic-only-main-render-pipeline-readback' });
      saveReport();
      const compositionAttemptPath = join(out, 'flame-composition-attempt.png');
      await checked(page.screenshot({ path: compositionAttemptPath, fullPage: true }));
      report.captures.push({ name: 'flame-composition-attempt', path: compositionAttemptPath,
        validation: 'diagnostic-only-pre-assertion' });
      const pixelEvidence = { authority: presentedPixels.authority,
        canvasRect: presentedPixels.canvasRect, backingSize: presentedPixels.backingSize,
        rendererCanvasCapture,
        depthTestAblation: { depthTestWasEnabled: presentedPixels.depthTestAblation.depthTestWasEnabled,
          depthTestDisabledForeground: { sourceRgba: presentedPixels.composed[0].rgba,
            composedRgba: presentedPixels.depthTestAblation.foreground.rgba },
          depthTestDisabledBackground: { sourceRgba: presentedPixels.composed[1].rgba,
            composedRgba: presentedPixels.depthTestAblation.background.rgba } },
        foreground: { maskValue: flamePixelScan.foreground.maskValue,
          uv: [flamePixelScan.foreground.u, flamePixelScan.foreground.v],
          pixel: presentedPixels.composed[0].pixel,
          sourceRgba: presentedPixels.source[0].rgba, composedRgba: presentedPixels.composed[0].rgba },
        background: { maskValue: flamePixelScan.background.maskValue,
          uv: [flamePixelScan.background.u, flamePixelScan.background.v],
          pixel: presentedPixels.composed[1].pixel,
          sourceRgba: presentedPixels.source[1].rgba, composedRgba: presentedPixels.composed[1].rgba } };
      report.compositionDiagnostic.presentationPixelEvidence = pixelEvidence;
      saveReport();
      const composition = validateSamFlameComposition({ output, bridge: observed.bridge,
        sceneObject: observed.sceneObject, sourceSha256: report.inputs.image.sha256,
        expectedPrompt: prompt, presentation: observed.presentation, selectedIndices: observed.selectedIndices,
        volume: observed.volume, advanceEvidence, pixelEvidence });
      const screenshotPath = join(out, 'flame-composition.png');
      await checked(page.screenshot({ path: screenshotPath, fullPage: true }));
      report.flameComposition = { ...composition, selectedScore: selected.score,
        bridge: observed.bridge, volume: { backend: observed.volume.backend, frameCount: observed.volume.frameCount,
          simStepCount: observed.volume.simStepCount, storageBuffersPerShaderStage: observed.volume.storageBuffersPerShaderStage },
        selectedIndices: observed.selectedIndices, texturePlacement: flamePixelScan.texturePlacement,
        pixelEvidence, sceneObjectId: observed.sceneObject.id };
      report.captures.push({ name: 'flame-composition', path: screenshotPath, visualInspection: 'pending-owner-inspection' });
      report.status = 'captured'; report.failurePhase = null;
      report.checks = { actualWebgpuMaskToLiveFlameComposition: 'passed', sourceProvenance: 'passed',
        selectedInstance: 'passed', liveFlameAdvancing: 'passed', foregroundMaskContribution: 'passed',
        backgroundMaskExclusion: 'passed', twoDimensionalMaskContract: 'passed', visualAndInteractionQuality: 'pending-owner-inspection' };
    } else {
    const baseline = values.baseline ? JSON.parse(readFileSync(values.baseline, 'utf8')) : null;
    await run('cold-wheel', 'wheel', 'miss', false, baseline?.visualEvidence.output);
    await run('warm-wheel', 'wheel', 'hit', false, baseline?.warmPositive.visualEvidence.output);
    await run('windows', 'windows', 'hit');
    await page.locator('#sam-image-canvas').dblclick();
    await capture('windows-desktop');
    const firstWindow = await page.evaluate(() => String(window.kaminosSamImageTools.output().instances[0].index));
    await page.locator('#sam-image-instances').selectOption(firstWindow);
    await capture('windows-single');
    await saveExport('mask', 'windows-single-mask');
    assert.ok(Buffer.byteLength(report.exports.at(-1).entry.name) > 255, 'long export name not exercised');
    await page.locator('#sam-image-instances').selectOption('all');
    await saveExport('cutout', 'windows-all-cutout', true);
    await page.locator('[data-tab="masks"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    report.failurePhase = 'windows-mobile'; saveReport();
    await page.locator('#sam-image-unload').scrollIntoViewIfNeeded();
    await capture('windows-mobile');
    await page.setViewportSize({ width: 1440, height: 960 });
    await run('negative', 'a purple submarine with zebra stripes', 'hit', true, baseline?.negativeControl.visualEvidence.output);
    assert.equal(await page.locator('#sam-image-save-mask').isDisabled(), true);
    report.failurePhase = 'webp-ingress'; saveReport();
    const webp = await checked(page.evaluate(async () => {
      const source = window.kaminosSamImageTools.progress().source;
      const image = new Image(); image.src = source.source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp'));
      if (blob?.type !== 'image/webp') throw new Error('browser did not encode WebP');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(text);
    }));
    const webpBytes = Buffer.from(webp, 'base64'), webpPath = join(out, 'source.webp');
    writeFileSync(webpPath, webpBytes);
    report.inputs.webp = { path: webpPath, sha256: `sha256:${createHash('sha256').update(webpBytes).digest('hex')}` }; saveReport();
    await checked(page.locator('#sam-image-file').setInputFiles({ name: 'source.webp', mimeType: 'image/webp', buffer: webpBytes }));
    await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
    await run('webp-wheel', 'wheel', 'miss', false, null, 'webp');
    if (values['second-image']) {
      report.failurePhase = 'drop-image'; saveReport();
      const bytes = readFileSync(values['second-image']).toString('base64');
      const transfer = await page.evaluateHandle(({ bytes, name }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], name, { type: 'image/jpeg' }));
        return transfer;
      }, { bytes, name: basename(values['second-image']) });
      await page.locator('#sam-image-viewport').dispatchEvent('drop', { dataTransfer: transfer });
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      await run('second-image', 'grocery bags', 'miss', false, null, 'second-image');
      report.failurePhase = 'paste-image'; saveReport();
      await page.evaluate(transfer => window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer })), transfer);
      await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
      await run('pasted-image', 'grocery bags', 'hit', false, null, 'second-image');
      await transfer.dispose();
    }
    report.failurePhase = 'failed-image-recovery'; saveReport();
    await page.evaluate(() => window.kaminosOpenImageMasks('/missing-image.png').catch(() => {}));
    assert.equal(await page.locator('#sam-image-canvas').isHidden(), true, 'failed ingress left a stale visible image');
    assert.equal(await page.locator('#sam-image-run').isDisabled(), true);
    await page.locator('#sam-image-file').setInputFiles(values.image);
    await checked(page.waitForFunction(() => !window.kaminosSamImageTools.progress().busy));
    await capture('recovered-source');
    report.status = 'captured'; report.failurePhase = null;
    report.checks = { numericalRegression: baseline ? 'passed' : 'not-requested', inputDuringInference: 'passed',
      persistedExports: 'passed', visualAndInteractionQuality: 'pending-owner-inspection' };
    }
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
    if (error.compositionDiagnostic && !report.compositionDiagnostic) {
      report.compositionDiagnostic = { state: error.compositionDiagnostic };
    }
    const transport = error?.evidenceTransport || null;
    if (transport) lastTrustedEvidence = transport;
    try {
      report.failureReceipt = writeSamTerminalFailure({ outDir: out, phase: report.failurePhase, error,
        lastTrustedEvidence, startedAt: report.startedAt });
    } catch (receiptError) {
      report.failureReceiptError = String(receiptError.stack || receiptError);
    }
    if (page) try { await page.screenshot({ path: join(out, 'failure.png') }); } catch {}
    console.error(report.error);
  } finally {
    report.completedAt = new Date().toISOString();
    try { saveReport(); }
    catch (error) {
      report.status = 'failed';
      process.exitCode = 1;
      console.error(`Could not persist terminal report: ${error.stack || error}`);
      try {
        report.failureReceipt = writeSamTerminalFailure({ outDir: out, phase: 'terminal-report-write', error,
          lastTrustedEvidence, startedAt: report.startedAt });
      } catch (receiptError) { console.error(`Could not persist terminal failure receipt: ${receiptError.stack || receiptError}`); }
    }
    try { await browser?.close(); }
    catch (error) { console.error(`Browser cleanup failed: ${error.stack || error}`); process.exitCode = 1; }
    try {
      if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    } catch (error) { console.error(`Server cleanup failed: ${error.stack || error}`); process.exitCode = 1; }
    try { serverLog.end(); }
    catch (error) { console.error(`Server log close failed: ${error.stack || error}`); process.exitCode = 1; }
  }
  console.log(JSON.stringify({ status: report.status, report: join(out, 'report.json'), failurePhase: report.failurePhase }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
