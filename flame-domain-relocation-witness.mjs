import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';
import { compositionRestoreUrl } from './scene-authoring.mjs';

const { values: args } = parseArgs({ options: { manifest: { type: 'string' }, out: { type: 'string' } } });
assert.ok(args.manifest && args.out && path.isAbsolute(args.out));
await fs.mkdir(args.out, { recursive: true });
const report = { status: 'running', phase: 'arguments', receiver: 'invoking-agent',
  terminalReport: path.join(args.out, 'report.json'), startedAt: new Date().toISOString(), errors: [], frames: [] };
const save = () => fs.writeFile(path.join(args.out, 'report.json'), JSON.stringify(report, null, 2));
await save();
let browser, context, page;
try {
  const manifest = JSON.parse(await fs.readFile(args.manifest, 'utf8'));
  report.requested = manifest;
  assert.equal(manifest.requestedRoute, 'local-native-chrome-webgpu');
  report.phase = 'source-preflight'; await save();
  report.source = await verifyAuthoringServer({ origin: manifest.origin, repoRoot: process.cwd() });
  assert.equal(report.source.source.commit, manifest.sourceCommit);
  assert.equal(report.source.source.dirty, false);
  assert.equal(report.source.sceneStore, manifest.sceneStore);
  const { chromium } = await import(pathToFileURL(manifest.playwright));
  report.phase = 'browser-start'; await save();
  browser = await chromium.launch({ executablePath: manifest.chrome, headless: false,
    args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.execution = { requestedRoute: manifest.requestedRoute, browserVersion: browser.version(),
    effectiveExecutable: await fs.realpath(manifest.chrome) };
  context = await browser.newContext({ viewport: manifest.viewport, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  const state = () => page.evaluate(() => ({
    volume: window.__kaminosVolumePrototype?.debugState?.(),
    emitter: window.kaminosFlameEmitterState?.(),
    receipt: window.__kaminosVolumeEmitterReceipt,
    history: window.kaminosSceneEdits?.state?.(),
    light: window.__kaminosVolumePrototype?.fireIrradianceLightField?.(),
    sceneObjects: window.kaminosSceneObjectDebugState?.(),
    sceneInfo: document.getElementById('info-bar')?.textContent,
    timeOrigin: performance.timeOrigin,
  })).then(result => { if (result.light) { delete result.light.device; delete result.light.atlasTexture; delete result.light.metaTexture; } return result; });
  const check = (s, { x, domain, suspended = false }) => {
    assert.match(s.volume.backend, /WebGPU/);
    assert.equal(s.volume.active, true);
    assert.equal(s.volume.error, null);
    assert.ok(s.volume.frameCount > 0);
    assert.ok(s.volume.simStepCount > 0);
    assert.equal(s.volume.ordinarySceneDepth.effective, true);
    assert.deepEqual(s.sceneObjects?.map(object => object.id).sort(), ['flame-emitter', 'kiln']);
    assert.ok(Math.abs(s.emitter.pose.position[0] - x) < 1e-8);
    assert.ok(Math.abs(s.emitter.domainTranslation[0] - domain) < 1e-8);
    assert.deepEqual(s.volume.ordinaryDomainTranslation, s.emitter.domainTranslation);
    assert.equal(s.emitter.injectionSuspended, suspended);
    assert.equal(s.receipt.fallbackUsed, false);
    if (suspended) {
      assert.equal(s.emitter.effectiveMode, 'off');
      assert.equal(s.volume.analyticEmitterDispatchActive, false);
    } else {
      assert.equal(s.emitter.effectiveMode, 'analytic-fixed');
      assert.equal(s.volume.analyticEmitterDispatchActive, true);
      assert.ok(Math.abs(s.emitter.source.origin[0] - (x - domain)) < 1e-8);
      assert.equal(s.light.status, 'effective');
      assert.ok(Math.abs(s.light.worldMin[0] - (domain - 1)) < 1e-8);
    }
  };
  const waitSim = async (minimumFrame = 0, requireMounted = false, minimumSteps = 20) => {
    await page.waitForFunction(({ minimumFrame, requireMounted, minimumSteps }) => {
      const v = window.__kaminosVolumePrototype?.debugState?.();
      const mounted = document.getElementById('info-bar')?.textContent === 'Scene loaded: 2 objects'
        && window.kaminosSceneObjectDebugState?.().some(object => object.id === 'kiln');
      return v?.error || ((!requireMounted || mounted) && v?.simStepCount > minimumSteps && v?.frameCount > minimumFrame
        && window.kaminosFlameEmitterState?.().registered);
    }, { minimumFrame, requireMounted, minimumSteps }, { timeout: 120000 });
    return state();
  };
  const shot = async (name, s) => {
    const image = path.join(args.out, `${name}.png`);
    await page.screenshot({ path: image });
    const data = await page.evaluate(() => window.__kaminosVolumePrototype.canvasElement().toDataURL('image/png'));
    const volumeImage = path.join(args.out, `${name}-volume.png`);
    await fs.writeFile(volumeImage, Buffer.from(data.split(',')[1], 'base64'));
    report.frames.push({ name, image, volumeImage, state: s }); await save();
  };
  report.phase = 'mount'; report.url = manifest.sceneUrl; await save();
  await page.goto(manifest.sceneUrl);
  const initial = await waitSim(0, true); check(initial, { x: 0.3, domain: 0 });
  assert.equal(initial.sceneInfo, 'Scene loaded: 2 objects');
  for (const mutate of [
    s => { s.volume.backend = 'WebGL'; },
    s => { s.volume.frameCount = 0; },
    s => { s.volume.ordinarySceneDepth.effective = false; },
    s => { s.emitter.domainTranslation = [2.3, 0, 0]; },
    s => { s.receipt.fallbackUsed = true; },
    s => { s.light.status = 'inactive'; },
    s => { s.sceneObjects = s.sceneObjects.filter(object => object.id !== 'kiln'); },
  ]) {
    const falseClosure = structuredClone(initial);
    mutate(falseClosure);
    assert.throws(() => check(falseClosure, { x: 0.3, domain: 0 }));
  }
  report.execution.rendererBackend = initial.volume.backend;
  await shot('01-before', initial);
  report.phase = 'preview'; await save();
  await page.locator('[data-scene-object-id="flame-emitter"] .scene-object-meta').click();
  const box = await page.locator('#kaminos-host-renderer-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  for (const key of ['g', 'x', '2']) await page.keyboard.press(key);
  const preview = await state();
  assert.ok(Math.abs(preview.emitter.pose.position[0] - 2.3) < 1e-8);
  assert.equal(preview.emitter.injectionSuspended, true);
  assert.deepEqual(preview.emitter.domainTranslation, [0, 0, 0]);
  assert.equal(preview.volume.fluidStateResetCount, initial.volume.fluidStateResetCount);
  await shot('02-preview-outside', preview);
  report.phase = 'release'; await save();
  await page.keyboard.press('Enter');
  const released = await waitSim(preview.volume.frameCount + 8); check(released, { x: 2.3, domain: 2.3 });
  assert.equal(released.volume.fluidStateResetCount, initial.volume.fluidStateResetCount + 1);
  assert.equal(released.volume.fluidStateResetReason, 'authored-flame-domain-relocation');
  await shot('03-released-plume', released);
  report.phase = 'continued-edit'; await save();
  await page.locator('#kaminos-host-renderer-canvas').hover();
  for (const key of ['g', 'x', '0', '.', '1', 'Enter']) await page.keyboard.press(key);
  const adjusted = await waitSim(released.volume.frameCount + 8); check(adjusted, { x: 2.4, domain: 2.3 });
  assert.equal(adjusted.volume.fluidStateResetCount, released.volume.fluidStateResetCount,
    'small accepted move within the relocated grid must keep the evolving field');
  assert.ok(adjusted.volume.simStepCount > released.volume.simStepCount);
  assert.equal(adjusted.sceneInfo, 'Flame source moved within the current grid; the field continues');
  await shot('04-adjusted-inside-relocated-grid', adjusted);
  report.phase = 'history'; await save();
  await page.locator('#kaminos-host-renderer-canvas').hover();
  await page.keyboard.press('Meta+z');
  const firstUndo = await waitSim(adjusted.volume.frameCount + 8); check(firstUndo, { x: 2.3, domain: 2.3 });
  assert.equal(firstUndo.volume.fluidStateResetCount, adjusted.volume.fluidStateResetCount);
  await page.keyboard.press('Meta+z');
  const undone = await waitSim(firstUndo.volume.frameCount + 8); check(undone, { x: 0.3, domain: 0 });
  assert.equal(undone.volume.fluidStateResetCount, firstUndo.volume.fluidStateResetCount + 1);
  await shot('05-undo-outside-move', undone);
  await page.keyboard.press('Meta+Shift+z');
  const redone = await waitSim(undone.volume.frameCount + 8); check(redone, { x: 2.3, domain: 2.3 });
  assert.equal(redone.volume.fluidStateResetCount, undone.volume.fluidStateResetCount + 1);
  await page.keyboard.press('Meta+Shift+z');
  const secondRedo = await waitSim(redone.volume.frameCount + 8); check(secondRedo, { x: 2.4, domain: 2.3 });
  assert.equal(secondRedo.volume.fluidStateResetCount, redone.volume.fluidStateResetCount);
  await shot('06-redo-both-edits', secondRedo);
  for (const key of ['g', 'x', '0', '.', '5', 'Escape']) await page.keyboard.press(key);
  const cancelled = await state();
  assert.ok(Math.abs(cancelled.emitter.pose.position[0] - 2.4) < 1e-8);
  assert.equal(cancelled.volume.fluidStateResetCount, secondRedo.volume.fluidStateResetCount);
  report.phase = 'save-reopen'; await save();
  const response = page.waitForResponse(r => r.url().endsWith('/api/save-scene') && r.request().method() === 'POST');
  assert.equal(await page.evaluate(() => window.saveSceneAs()), true);
  const savedReceipt = await (await response).json();
  const saved = await (await fetch(`${manifest.origin}/api/read?root=scenes&path=${encodeURIComponent(savedReceipt.saved)}`)).json();
  await fs.writeFile(path.join(args.out, 'saved-scene.json'), JSON.stringify(saved, null, 2));
  assert.ok(Math.abs(saved.objects.find(o => o.id === 'flame-emitter').transform.position[0] - 2.4) < 1e-8);
  assert.deepEqual(saved.flameDomainTranslation, [2.3, 0, 0]);
  report.reopenUrl = compositionRestoreUrl(saved.composition, savedReceipt.saved, manifest.origin);
  await page.goto('about:blank'); await page.goto(report.reopenUrl);
  const reopened = await waitSim(0, true, 60); check(reopened, { x: 2.4, domain: 2.3 });
  assert.equal(reopened.sceneInfo, 'Scene loaded: 2 objects');
  assert.notEqual(reopened.timeOrigin, secondRedo.timeOrigin);
  assert.equal(reopened.history.undoCount, 0);
  await shot('07-reopened-adjusted-plume', reopened);
  assert.deepEqual(report.errors, []);
  report.status = 'passed'; report.phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.failurePhase = report.phase;
  report.error = error.stack || String(error); process.exitCode = 1;
  if (page) {
    report.lastObserved = await page.evaluate(() => ({ volume: window.__kaminosVolumePrototype?.debugState?.(),
      emitter: window.kaminosFlameEmitterState?.() })).catch(() => null);
    await page.screenshot({ path: path.join(args.out, 'failed.png') }).catch(() => {});
  }
  console.error(report.error);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString(); await save();
}
