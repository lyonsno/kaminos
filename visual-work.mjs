import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compositionRestoreUrl } from './scene-authoring.mjs';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';
import { decodeScreenshotPngRgb } from './screenshot-png-rgb.mjs';
import { assertCapturePixels } from './capture-pixels.mjs';

export { assertCapturePixels };

export function assertSavedResult(result, persisted) {
  assert.ok(result?.ok === true && result.document && result.filename?.endsWith('.kaminos.json'),
    `Save failed: ${result?.error || 'missing document result'}`);
  assert.equal(result.url, compositionRestoreUrl(result.document.composition, result.filename, new URL(result.url).origin), 'Save URL differs from saved document');
  assert.deepEqual(persisted, result.document, 'Persisted document differs from save result');
  return result;
}

export function assertMountedScene(document, actual) {
  for (const expected of document.objects || []) {
    const mounted = actual.find(item => item.id === expected.id);
    assert.ok(mounted, `Mount missing object ${expected.id}`);
    for (const field of ['type', 'source']) assert.equal(mounted[field], expected[field], `Mount differs: ${expected.id}.${field}`);
    for (const field of ['position', 'rotation', 'scale']) {
      const a = mounted.transform?.[field], b = expected.transform?.[field];
      assert.ok(a?.length === 3 && b?.length === 3 && a.every((n, i) => Number.isFinite(n) && Math.abs(n - b[i]) < 1e-8), `Mount differs: ${expected.id}.${field}`);
    }
  }
  return actual;
}

// The caller supplies a Playwright page and feature operations. All edits and
// persistence still run through the mounted editor's normal public operations.
export async function visualWork({ page, origin, repoRoot, sceneStore, basinStore, sceneFile, out, exercise, configureUrl = url => url }) {
  await fs.mkdir(out, { recursive: true });
  const report = { status: 'running', phase: 'identity', startedAt: new Date().toISOString(),
    requested: { origin, repoRoot, sceneStore, basinStore, sceneFile }, observations: [], errors: [] };
  const reportPath = path.join(out, 'report.json');
  const write = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  const pageError = error => report.errors.push(error.message);
  page.on('pageerror', pageError);
  await write();
  const readScene = async filename => {
    const response = await fetch(new URL(`/api/read?root=scenes&path=${encodeURIComponent(filename)}`, origin), { cache: 'no-store' });
    if (!response.ok) throw Error(`Scene read failed: ${filename}, HTTP ${response.status}`);
    return response.json();
  };
  try {
    report.serving = await verifyAuthoringServer({ origin, repoRoot });
    if (sceneStore) assert.equal(await fs.realpath(sceneStore), await fs.realpath(report.serving.sceneStore), 'Wrong scene store');
    if (basinStore) assert.equal(await fs.realpath(basinStore), await fs.realpath(report.serving.basinStore), 'Wrong basin store');
    const open = async filename => {
      report.phase = 'open'; await write();
      const document = await readScene(filename);
      const url = String(await configureUrl(new URL(compositionRestoreUrl(document.composition, filename, origin))));
      // Leaving the document explicitly also exercises fresh restoration when
      // only the scene hash would otherwise change.
      await page.goto('about:blank');
      await page.goto(url);
      await page.waitForFunction(() => {
        const failure = document.querySelector('#status.failed');
        const status = document.getElementById('info-bar')?.textContent || '';
        if (failure || /Scene load failed|Invalid scene|water host unavailable/i.test(status)) throw Error(failure?.textContent || status);
        return /^(Scene loaded|Volume scene loaded)/.test(status);
      });
      const objects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
      assertMountedScene(document, objects);
      assert.equal(new URL(page.url()).origin, new URL(origin).origin, 'Mount changed origin');
      const route = new URL(page.url());
      const effectiveScene = route.searchParams.get('scene') || new URLSearchParams(route.hash.slice(1)).get('scene');
      assert.equal(effectiveScene, filename, 'Mount changed scene');
      report.opened = { filename, requestedUrl: url, effectiveUrl: page.url() };
      assert.deepEqual(report.errors, [], 'Uncaught browser error');
      await write();
      return document;
    };
    const retain = async ({ name, capture = true, settle = async () => {}, observe = async () => null, verify = async () => {} }) => {
      assert.ok(/^[a-z0-9][a-z0-9_-]*$/i.test(name), 'Observation name must be a path-safe filename');
      report.phase = `observe:${name}`; await write();
      await settle(page);
      const effective = await observe(page);
      const result = await page.evaluate(capture => capture
        ? window.captureComposition({ result: true }) : window.saveSceneAs({ result: true }), capture);
      if (!result?.ok) throw Error(`Save failed: ${result?.error || 'no result'}`);
      const persisted = await readScene(result.filename);
      assertSavedResult(result, persisted);
      assert.deepEqual(report.errors, [], 'Uncaught browser error');
      await fs.writeFile(path.join(out, `${name}.kaminos.json`), JSON.stringify(persisted, null, 2));
      if (capture) {
        assert.ok(persisted.capture?.image?.startsWith('data:image/png;base64,'), 'Capture missing PNG');
        const png = Buffer.from(persisted.capture.image.split(',')[1], 'base64');
        assertCapturePixels(decodeScreenshotPngRgb(png), persisted.capture);
        await fs.writeFile(path.join(out, `${name}.png`), png);
      }
      await verify();
      const observation = { name, filename: result.filename, url: result.url, captured: capture,
        effective, savedAt: new Date().toISOString() };
      report.observations.push(observation); await write();
      return result;
    };
    const document = await open(sceneFile);
    report.phase = 'exercise'; await write();
    report.result = await exercise({ page, document, open, retain });
    assert.deepEqual(report.errors, [], 'Uncaught browser error');
    report.status = 'passed'; report.phase = 'complete';
    return report;
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack || String(error);
    try { await page.screenshot({ path: path.join(out, 'failed.png') }); }
    catch (captureError) { report.failureCaptureError = String(captureError); }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString(); await write();
    page.off('pageerror', pageError);
  }
}
