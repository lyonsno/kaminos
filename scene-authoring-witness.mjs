import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildSceneDocument } from './scene-persistence-core.js';
import { COMPOSITION_SCHEMA, compositionRestoreUrl } from './scene-authoring.mjs';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';

const { values } = parseArgs({ options: {
  origin: { type: 'string', default: 'http://127.0.0.1:8106' },
  out: { type: 'string' }, playwright: { type: 'string' }, greenroom: { type: 'string' },
  preset: { type: 'string' }, mesh: { type: 'string' },
} });
for (const field of ['out', 'playwright', 'greenroom', 'preset', 'mesh']) assert.ok(values[field], `--${field} required`);
const out = path.resolve(values.out);
await fs.mkdir(out, { recursive: true });
const report = { receiver: 'wake-and-bake-pit-boss', requested: values, pid: process.pid,
  startedAt: new Date().toISOString(), phase: 'start', status: 'running', errors: [] };
const reportPath = path.join(out, 'report.json');
const writeReport = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
await writeReport();
let browser, page, lease;
try {
  report.phase = 'serving-identity';
  report.serving = await verifyAuthoringServer({ origin: values.origin, repoRoot: process.cwd() });
  await writeReport();
  report.phase = 'lease';
  const claim = JSON.parse(execFileSync(values.greenroom, ['lease', 'claim', '--owner', 'wake-and-bake-pit-boss',
    '--agent-id', 'stationary-authoring-witness', '--repo-root', process.cwd(), '--pid', String(process.pid),
    '--effective-route', `${values.origin} ordinary stationary flame authoring / Chrome WebGPU`,
    '--backend', 'webgpu', '--device', 'apple-gpu', '--profile', 'browser-smoke', '--supports-checkpoints', '--ttl-seconds', '3600'], { encoding: 'utf8' }));
  lease = claim.lease_id;
  report.lease = claim;
  assert.ok(lease, 'lease claim returned identity');
  report.phase = 'browser';
  const { chromium } = await import(pathToFileURL(values.playwright));
  browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => report.errors.push(e.message));
  const composition = { schema: COMPOSITION_SCHEMA, flame: { presetId: values.preset, label: 'elfinblue-fuckeryyy', stationary: true },
    route: { volume_light_field: '1', volume_light_field_scene_depth: '1', volume_light_field_test_scene: '0' }, lightGainStops: 0 };
  const scene = buildSceneDocument({ composition, objects: [{ id: 'kiln', type: 'glb', source: values.mesh,
    fileName: 'refractory-kiln.glb', label: 'Refractory kiln - cleanup first',
    transform: { position: [-0.2, -0.48, 0], rotation: [0, 0, 0], scale: [3, 3, 3] } }],
    activeObjectId: 'kiln', camera: { position: [3.6, 1.7, 4.8], target: [0, -0.15, 0], fov: 40 },
    environment: { name: 'studio', exposure: 1.2, intensity: 0.3, rotation: 0, showBackground: false, ground: { visible: true, height: -1.72 } }, backdrop: false });
  scene.label = 'Kiln - stationary flame study';
  const save = await fetch(`${values.origin}/api/save-scene`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scene) });
  assert.ok(save.ok);
  report.fixture = await save.json();
  const url = compositionRestoreUrl(composition, report.fixture.saved, values.origin);
  report.requestedUrl = url;
  await writeReport();
  report.phase = 'load';
  await page.goto(url);
  await page.waitForFunction(() => window.kaminosSceneObjectDebugState?.().length === 1 && document.getElementById('composition-status')?.textContent.includes('elfinblue'));
  report.effectiveUrl = page.url();
  report.runtime = await page.evaluate(() => window.__kaminosVolumePrototype.debugState());
  assert.equal(report.runtime.active, true);
  assert.equal(report.runtime.error, null);
  assert.equal(report.runtime.ordinarySceneDepth.effective, true);
  assert.match(report.runtime.backend, /WebGPU/);
  assert.equal(new URL(page.url()).searchParams.get('settings_preset'), values.preset);
  report.phase = 'capture';
  await page.waitForFunction(start => window.__kaminosVolumePrototype.debugState().frameCount > start + 150, report.runtime.frameCount);
  await page.locator('[data-transform-field="position.x"]').fill('-0.25');
  await page.locator('[data-transform-field="position.x"]').dispatchEvent('change');
  await page.locator('#fire-light-gain-stops').fill('0.75');
  await page.locator('#fire-light-gain-stops').dispatchEvent('input');
  assert.equal((await page.evaluate(() => window.kaminosSceneObjectDebugState()))[0].transform.position[0], -0.25);
  report.pixels = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
    const result = {};
    for (const id of ['kaminos-host-renderer-canvas', 'kaminos-volume-canvas']) {
      const source = document.getElementById(id);
      const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonblack = 0, visible = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]) visible++;
        if (pixels[i + 3] && pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) nonblack++;
      }
      result[id] = { width: canvas.width, height: canvas.height, nonblack, visible };
    }
    resolve(result);
  })));
  for (const pixel of Object.values(report.pixels)) assert.ok(pixel.nonblack > 0, 'each rendered layer must contain visible pixels');
  await page.screenshot({ path: path.join(out, 'desktop.png') });
  await page.locator('#composition-label').fill('Kiln captured study');
  const captured = await page.evaluate(() => window.captureComposition());
  report.captureStatus = await page.locator('#composition-status').textContent();
  assert.equal(captured, true, report.captureStatus);
  const listing = await (await fetch(`${values.origin}/api/browse?root=scenes&path=`)).json();
  const shots = await Promise.all(listing.entries.filter(e => e.name.endsWith('.json')).map(async e => ({ name: e.name, scene: await (await fetch(`${values.origin}/api/read?root=scenes&path=${encodeURIComponent(e.name)}`)).json() })));
  const shot = shots.filter(s => s.scene.capture?.label === 'Kiln captured study').sort((a, b) => b.scene.timestamp.localeCompare(a.scene.timestamp))[0];
  assert.ok(shot?.scene.capture);
  assert.equal(shot.scene.composition.lightGainStops, 0.75);
  report.shot = shot.name;
  await fs.writeFile(path.join(out, 'capture.png'), Buffer.from(shot.scene.capture.image.split(',')[1], 'base64'));
  await fs.writeFile(path.join(out, 'scene.json'), JSON.stringify(shot.scene, null, 2));
  report.phase = 'reopen';
  await page.goto(compositionRestoreUrl(shot.scene.composition, shot.name, values.origin));
  await page.waitForFunction(() => document.getElementById('composition-status')?.textContent.includes('Kiln captured study'));
  report.reopenedObjects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
  assert.deepEqual(report.reopenedObjects[0].transform, shot.scene.objects[0].transform);
  assert.equal(await page.locator('#fire-light-gain-stops').inputValue(), '0.75');
  assert.equal(await page.locator('#composition-ground-height').inputValue(), '-1.72');
  await page.screenshot({ path: path.join(out, 'reopened.png') });
  await page.locator('#composition-library').click();
  await page.locator('.saved-scene-picture img').first().waitFor();
  await page.locator('.saved-scene-picture img').first().evaluate(img => img.decode());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: path.join(out, 'library.png') });
  await page.locator('[data-tab="assets"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.getElementById('viewport').clientWidth === 390);
  await page.screenshot({ path: path.join(out, 'mobile.png') });
  report.phase = 'motion-and-layer-separation';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    window.kaminosSetSceneObjectTransform('kiln', { position: [1.6, -0.15, 0], scale: [2, 2, 2] });
    window.__kaminosSetSceneCameraFrame([3.6, 1.7, 4.8], [0.6, -0.25, 0]);
    window.setGizmoMode(null);
  });
  const sampleVolume = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve({
    png: window.__kaminosVolumePrototype.canvasElement().toDataURL('image/png'),
    frame: window.__kaminosVolumePrototype.debugState().frameCount,
  }))));
  const before = await sampleVolume();
  await page.waitForFunction(frame => window.__kaminosVolumePrototype.debugState().frameCount > frame + 12, before.frame);
  const after = await sampleVolume();
  assert.notEqual(before.png, after.png, 'visible flame pixels change between simulation frames');
  report.motionFrames = [before.frame, after.frame];
  await fs.writeFile(path.join(out, 'flame-before.png'), Buffer.from(before.png.split(',')[1], 'base64'));
  await fs.writeFile(path.join(out, 'flame-after.png'), Buffer.from(after.png.split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(out, 'separated-layers.png') });
  report.phase = 'capture-edit-race';
  let releasePreset, sawPreset;
  const presetHeld = new Promise(resolve => { releasePreset = resolve; });
  const presetRequested = new Promise(resolve => { sawPreset = resolve; });
  await page.route('**/api/volume-settings-presets', async route => {
    if (route.request().method() === 'POST') { sawPreset(); await presetHeld; }
    await route.continue();
  });
  const racedCapture = page.evaluate(() => window.captureComposition());
  await presetRequested;
  await page.locator('#fire-light-gain-stops').fill('1.25');
  await page.locator('#fire-light-gain-stops').dispatchEvent('input');
  releasePreset();
  assert.equal(await racedCapture, false, 'an edit during persistence must reject capture');
  report.captureEditRace = await page.locator('#composition-status').textContent();
  assert.match(report.captureEditRace, /settings changed/);
  await page.unroute('**/api/volume-settings-presets');
  report.phase = 'legacy-load';
  const legacy = { ...shot.scene, composition: null, capture: null, label: 'Legacy mesh compatibility' };
  await page.locator('#scene-file-input').setInputFiles({ name: 'legacy.kaminos.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('settings_preset') && document.getElementById('composition-label')?.value === 'Legacy mesh compatibility');
  assert.equal(await page.evaluate(() => window.saveScene()), true, 'legacy mesh save still works after leaving flame composition');
  report.phase = 'first-basin-selection';
  await page.locator('#composition-basins').click();
  await page.locator('#settings-preset-select').selectOption(values.preset);
  await page.locator('#settings-preset-load-here').click();
  await page.waitForFunction(preset => new URL(location.href).searchParams.get('settings_preset') === preset && document.getElementById('composition-status')?.textContent.includes('Legacy mesh compatibility'), values.preset);
  assert.equal((await page.evaluate(() => window.kaminosSceneObjectDebugState()))[0].id, 'kiln');
  assert.equal((await page.evaluate(() => window.__kaminosVolumePrototype.debugState())).active, true);
  report.firstBasinSelection = 'mesh retained; selected immutable basin active';
  report.phase = 'failed-restore';
  await page.locator('#scene-file-input').setInputFiles({ name: 'broken.kaminos.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') });
  await page.waitForFunction(() => document.getElementById('info-bar')?.textContent.includes('Invalid scene file'));
  assert.equal(await page.evaluate(() => window.saveScene()), false, 'invalid restore cannot overwrite prior scene');
  report.phase = 'missing-preset';
  await page.goto(`${values.origin}/volume-settings-preset.html?preset=vsp-${'f'.repeat(64)}`);
  await page.locator('#status.failed').waitFor();
  report.missingPreset = await page.locator('#status').textContent();
  assert.equal(await page.locator('#kaminos-host-renderer-canvas').count(), 0, 'missing basin does not open a fallback renderer');
  assert.deepEqual(report.errors, [], 'no uncaught page errors');
  report.status = 'passed';
  report.phase = 'complete';
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack || String(error);
  if (page) {
    try {
      report.lastRuntime = await page.evaluate(() => ({ volume: window.__kaminosVolumePrototype?.debugState?.(), status: document.getElementById('composition-status')?.textContent }));
      await page.screenshot({ path: path.join(out, 'failed.png') });
    } catch (captureError) { report.failureCaptureError = String(captureError); }
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (lease) {
    try { report.release = JSON.parse(execFileSync(values.greenroom, ['lease', 'release', lease, '--released-by', 'wake-and-bake-pit-boss', '--reason', 'Authoring witness terminal; owned Chrome closed'], { encoding: 'utf8' })); }
    catch (error) { report.releaseError = String(error); process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  await writeReport();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, reportPath, failure: report.failure }, null, 2));
}
