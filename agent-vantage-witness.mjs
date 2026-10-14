#!/usr/bin/env node
// Live witness for the agent vantage. Drives a served Kaminos page in an
// independent Chromium with the real CLI, and checks that pictures come from
// the sub rather than the operator's view, that the operator's camera comes
// back, that ordinary scene edits move the sub, and that history can undo it.
// The report is written after every phase, including on failure.
//
//   node agent-vantage-witness.mjs --origin http://127.0.0.1:8317 --out DIR \
//     --playwright /path/to/playwright-core/index.mjs --browser /path/to/chrome-for-testing
import {execFile} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {decodeScreenshotPngRgb} from './screenshot-png-rgb.mjs';
import {poseLookingAt} from './agent-vantage-core.mjs';

const repo = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(repo, 'tools/vantage.mjs');
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, i, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return pairs;
}, []));
for (const name of ['origin', 'out', 'playwright', 'browser']) if (!options[name]) throw new Error(`--${name} required`);
if (/Google Chrome\.app\//.test(options.browser)) throw new Error('Use an independent Chrome for Testing or Chromium, never the operator browser');
const out = path.resolve(options.out);
mkdirSync(out, {recursive: true});
const reportPath = path.join(out, 'report.json');
const report = {schema: 'kaminos.agent-vantage-witness.v1', startedAt: new Date().toISOString(), origin: options.origin,
  requested: {browser: options.browser, playwright: options.playwright, headless: options.headed !== true},
  effective: {}, phase: null, status: 'running', checks: [], pageErrors: [], artifacts: []};
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const check = (name, ok, detail = {}) => {
  report.checks.push({name, ok: !!ok, ...detail});
  save();
  if (!ok) throw new Error(`${name} failed: ${JSON.stringify(detail)}`);
};

// Address this run's own page: other tabs may be linked to the same server.
const vantage = (...args) => new Promise(resolve => execFile(process.execPath,
  [cli, '--server', options.origin, '--out', out, '--json', ...(report.effective.pageId ? ['--page', report.effective.pageId] : []), ...args], {maxBuffer: 64 * 1024 * 1024},
  (error, stdout, stderr) => {
    let record = null;
    try { record = JSON.parse(stdout); } catch {}
    resolve({code: error ? error.code : 0, record, stderr: stderr.trim()});
  }));
async function vantageOk(...args) {
  const result = await vantage(...args);
  if (result.code !== 0 || !result.record) throw new Error(`vantage ${args.join(' ')} exited ${result.code}: ${result.stderr}`);
  for (const image of result.record.result?.images ?? []) report.artifacts.push(image.path);
  if (result.record.recordPath) report.artifacts.push(result.record.recordPath);
  return result.record;
}

// Saturated red and blue by channel dominance. "Yellow" is the sub's hull as
// the page's tone mapping renders it: a warm tan, red over green over blue.
function colors(file) {
  const {width, height, channels, pixels} = decodeScreenshotPngRgb(readFileSync(file));
  let red = 0, blue = 0, yellow = 0, first = null, varied = false;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (r > 70 && r > 1.6 * g && r > 1.6 * b) red++;
    if (b > 70 && b > 1.4 * r && b > 1.2 * g) blue++;
    if (r > 120 && g > 80 && b < 0.78 * g && r >= 1.05 * g && r - b > 50) yellow++;
    const value = (r << 16) | (g << 8) | b;
    if (first === null) first = value; else if (value !== first) varied = true;
  }
  const total = width * height;
  return {width, height, red: red / total, blue: blue / total, yellow: yellow / total, varied};
}
const imageOf = (record, name) => record.result.images.find(image => image.name === name)?.path;

let browser;
try {
  report.phase = 'launch-browser'; save();
  const {chromium} = await import(pathToFileURL(path.resolve(options.playwright)));
  browser = await chromium.launch({executablePath: options.browser, headless: options.headed !== true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
  report.effective.browser = {executable: options.browser, version: browser.version()};

  report.phase = 'open-page'; save();
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  page.on('pageerror', error => { report.pageErrors.push(String(error)); });
  page.on('console', message => { if (message.type() === 'error') report.pageErrors.push(`console: ${message.text()}`); });
  await page.goto(new URL('/index.html', options.origin).href, {waitUntil: 'load'});
  await page.waitForFunction(() => window.kaminosAgentVantage && window.kaminosSceneAuthoring && window.kaminosSetCameraDebugPose, null, {timeout: 90000});
  report.effective.pageId = await page.evaluate(() => window.kaminosAgentVantage.pageId);
  report.effective.renderer = await page.evaluate(() => { const state = window.kaminosWorkbenchSceneState?.(); return state ? {backend: state.rendererBackend ?? null, adapter: state.adapter ?? null} : null; });

  report.phase = 'link'; save();
  const deadline = Date.now() + 20000;
  let linked = false;
  while (!linked && Date.now() < deadline) {
    const pages = await (await fetch(new URL('/api/vantage/pages', options.origin))).json();
    linked = pages.pages.some(entry => entry.id === report.effective.pageId && entry.connected);
    if (!linked) await new Promise(resolve => setTimeout(resolve, 200));
  }
  check('page links to the server', linked, {pageId: report.effective.pageId});

  report.phase = 'arrange'; save();
  const scene = await page.evaluate(() => {
    const edit = window.kaminosSceneAuthoring;
    const red = edit.addMesh('box', {width: 1, height: 1, depth: 1});
    edit.setMaterial(red, {color: '#d01818', roughness: 0.6});
    window.kaminosSetSceneObjectTransform(red, {position: [0, 0.5, 0]});
    window.renameSceneObject(red, 'Witness red');
    const blue = edit.addMesh('box', {width: 1, height: 1, depth: 1});
    edit.setMaterial(blue, {color: '#1a3ee0', roughness: 0.6});
    window.kaminosSetSceneObjectTransform(blue, {position: [8, 0.5, 0]});
    window.renameSceneObject(blue, 'Witness blue');
    window.selectSceneObject?.(blue);
    window.kaminosSetCameraDebugPose({position: [8, 1.2, 3.5], target: [8, 0.5, 0]});
    window._kaminosDirty?.();
    return {red, blue};
  });
  report.effective.scene = scene;
  await page.waitForTimeout(800);

  report.phase = 'launch-sub'; save();
  const launched = await vantageOk('launch');
  check('launch creates the sub as a camera object', launched.result.created === true && launched.result.sub.id === 'vantage-bebop', {sub: launched.result.sub});
  const debug = await page.evaluate(() => window.kaminosSceneObjectDebugState().find(object => object.id === 'vantage-bebop'));
  check('the sub is an ordinary scene object', debug?.type === 'camera', {debug});

  report.phase = 'snap-red'; save();
  await vantageOk('goto', '0', '1.2', '3', '--look', 'Witness red');
  const before = await page.evaluate(() => window.kaminosCameraDebugState());
  const snapRed = await vantageOk('snap', '--annotate', '--name', 'red');
  const after = await page.evaluate(() => window.kaminosCameraDebugState());
  const redColors = colors(imageOf(snapRed, 'snap'));
  report.effective.snapRed = {route: snapRed.result.route, layers: snapRed.result.layers, colors: redColors, deviation: snapRed.result.viewDeviation};
  check('snap from the sub shows the red box it looks at', redColors.varied && redColors.red > 0.05 && redColors.blue < 0.005, redColors);
  check('snap names the red box in view and not the blue one',
    snapRed.result.objects.inView.some(object => object.id === scene.red) && !snapRed.result.objects.inView.some(object => object.id === scene.blue),
    {inView: snapRed.result.objects.inView.map(object => object.label)});
  check('the operator camera is restored exactly',
    before.position.every((v, i) => Math.abs(v - after.position[i]) < 1e-9) && before.target.every((v, i) => Math.abs(v - after.target[i]) < 1e-9),
    {before: {position: before.position, target: before.target}, after: {position: after.position, target: after.target}});
  check('the sub hides itself from its own picture', redColors.yellow < 0.002, {yellow: redColors.yellow});

  report.phase = 'peek-blue'; save();
  const peek = await vantageOk('peek', '--clean', '--name', 'operator');
  const peekColors = colors(imageOf(peek, 'peek'));
  report.effective.peek = {route: peek.result.route, colors: peekColors};
  check('peek shows the operator view of the blue box', peekColors.blue > 0.05 && peekColors.red < 0.005, peekColors);

  report.phase = 'operator-places-sub'; save();
  const placed = poseLookingAt([8, 1.2, 3], [8, 0.5, 0]);
  await page.evaluate(pose => window.kaminosSetSceneObjectTransform('vantage-bebop', pose), placed);
  const snapBlue = await vantageOk('snap', '--name', 'placed');
  const blueColors = colors(imageOf(snapBlue, 'snap'));
  check('a scene edit of the sub changes what it sees', blueColors.blue > 0.05 && blueColors.red < 0.005, blueColors);

  report.phase = 'undo'; save();
  await page.evaluate(() => window.kaminosSceneEdits.undo());
  const snapUndone = await vantageOk('snap', '--name', 'undone');
  const undoneColors = colors(imageOf(snapUndone, 'snap'));
  check('undo returns the sub to its previous view', undoneColors.red > 0.05 && undoneColors.blue < 0.005, undoneColors);

  report.phase = 'operator-sees-sub'; save();
  const subPose = (await vantageOk('status')).result.subs[0].pose;
  await page.evaluate(([x, y, z]) => window.kaminosSetCameraDebugPose({position: [x + 0.5, y + 0.25, z + 0.6], target: [x, y, z]}), subPose.position);
  await page.waitForTimeout(300);
  const glyph = await vantageOk('peek', '--name', 'sub-in-view');
  const glyphColors = colors(imageOf(glyph, 'peek'));
  check('the operator sees the sub in the scene', glyphColors.yellow > 0.01, {yellow: glyphColors.yellow});

  report.phase = 'burst'; save();
  const burst = await vantageOk('burst', '--count', '4', '--interval', '120', '--name', 'motion');
  check('burst returns a four-frame contact sheet', burst.result.frames.length === 4 && !!imageOf(burst, 'sheet'), {frames: burst.result.frames.length});

  report.phase = 'remove'; save();
  await vantageOk('remove');
  const remaining = await page.evaluate(() => window.kaminosSceneObjectDebugState().some(object => object.id === 'vantage-bebop'));
  check('remove takes the sub out of the scene', !remaining);

  report.phase = 'complete';
  report.status = report.pageErrors.length ? 'passed-with-page-errors' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.stack || String(error);
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  await browser?.close();
  console.log(JSON.stringify({status: report.status, phase: report.phase, report: reportPath, checks: report.checks.map(c => `${c.ok ? 'ok' : 'FAIL'} ${c.name}`)}, null, 2));
  process.exit(report.status === 'failed' ? 1 : 0);
}
