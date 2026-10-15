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
// The map paints the sub's cone teal and the operator's white over a dark ground.
function mapColors(file) {
  const {channels, pixels} = decodeScreenshotPngRgb(readFileSync(file));
  let teal = 0, white = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (g > 150 && b > 150 && r < 0.6 * g) teal++;
    if (r > 185 && g > 185 && b > 185) white++;
  }
  return {teal, white};
}

// A minimal binary glTF: one quad, positions and indices only.
function minimalGlb() {
  const positions = new Float32Array([-0.4, 0, 0, 0.4, 0, 0, 0.4, 0.8, 0, -0.4, 0.8, 0]), indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1}]}],
    accessors: [{bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-0.4, 0, 0], max: [0.4, 0.8, 0]},
      {bufferView: 1, componentType: 5123, count: 6, type: 'SCALAR'}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 48, target: 34962}, {buffer: 0, byteOffset: 48, byteLength: 12, target: 34963}],
    buffers: [{byteLength: bin.length}]};
  const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, fill)]);
  const text = pad(Buffer.from(JSON.stringify(json)), 0x20), body = pad(bin, 0);
  const chunk = (length, type) => { const head = Buffer.alloc(8); head.writeUInt32LE(length, 0); head.writeUInt32LE(type, 4); return head; };
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + body.length, 8);
  return Buffer.concat([header, chunk(text.length, 0x4e4f534a), text, chunk(body.length, 0x004e4942), body]);
}

let browser;
try {
  report.phase = 'server-identity'; save();
  const runtime = await (await fetch(new URL('/api/runtime-config', options.origin))).json();
  report.effective.server = runtime.source ?? null;
  check('the served checkout identifies itself', !!runtime.source?.commit, {source: runtime.source ?? null});

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
  await page.waitForFunction(() => document.querySelector('#agent-vantage-hud canvas')?.hidden === false, null, {timeout: 10000});
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
  const panelInPicture = mapColors(imageOf(snapRed, 'snap'));
  check("the sub's own map panel is not in its picture", panelInPicture.teal < 20, panelInPicture);

  report.phase = 'peek-blue'; save();
  const peek = await vantageOk('peek', '--clean', '--name', 'operator');
  const peekColors = colors(imageOf(peek, 'peek'));
  report.effective.peek = {route: peek.result.route, colors: peekColors};
  check('peek shows the operator view of the blue box', peekColors.blue > 0.05 && peekColors.red < 0.005, peekColors);

  report.phase = 'map'; save();
  const snapMap = mapColors(imageOf(snapRed, 'map'));
  check('a picture carries a map with both view cones', snapMap.teal > 50 && snapMap.white > 50, snapMap);
  const map = await vantageOk('map', '--size', '320', '--name', 'map');
  check('map paints the scene on request', !!imageOf(map, 'map') && map.result.images[0].width === 640, {width: map.result.images[0].width});
  const sketch = await vantageOk('sketch');
  check('sketch names both boxes and the sub without drawing',
    [scene.red, scene.blue].every(id => sketch.result.objects.some(object => object.id === id)) && sketch.result.subs.some(sub => sub.id === 'vantage-bebop'),
    {objects: sketch.result.objects.map(object => object.label), subs: sketch.result.subs.map(sub => sub.label)});

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

  report.phase = 'camera-view-held'; save();
  // With an ordinary active scene camera, Numpad 0 would enter camera view and
  // save the current (borrowed) view as the operator's. The capture holds it off.
  await page.evaluate(() => window.kaminosSceneCameras.createFromView('Witness hero'));
  await page.evaluate(() => window.kaminosSetCameraDebugPose({position: [3, 1.6, 5], target: [4, 0.5, 0]}));
  const beforeHold = await page.evaluate(() => window.kaminosCameraDebugState());
  const held = vantage('burst', '--count', '6', '--interval', '200', '--name', 'held');
  await page.waitForFunction(() => document.getElementById('composition-capture')?.disabled === true, null, {timeout: 15000});
  const pressed = await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {code: 'Numpad0', key: '0', bubbles: true, cancelable: true}));
    return window.kaminosSceneCameras.state().mode;
  });
  const heldResult = await held;
  check('the held burst completes', heldResult.code === 0, {code: heldResult.code, stderr: heldResult.stderr});
  const afterHold = await page.evaluate(() => ({mode: window.kaminosSceneCameras.state().mode, camera: window.kaminosCameraDebugState()}));
  const sameView = (a, b) => a.position.every((v, i) => Math.abs(v - b.position[i]) < 1e-9) && a.target.every((v, i) => Math.abs(v - b.target[i]) < 1e-9);
  check('Numpad 0 cannot enter camera view while the sub holds the viewport', pressed === 'user' && afterHold.mode === 'user', {pressed, after: afterHold.mode});
  check('the operator view is restored after the held burst', sameView(beforeHold, afterHold.camera), {before: beforeHold.position, after: afterHold.camera.position});
  await page.evaluate(() => { window.kaminosSceneCameras.enter(); window.kaminosSceneCameras.leave(); });
  const afterLeave = await page.evaluate(() => window.kaminosCameraDebugState());
  check('leaving camera view later returns to the operator view, not the sub view', sameView(beforeHold, afterLeave), {before: beforeHold.position, after: afterLeave.position});

  report.phase = 'import-during-capture'; save();
  // An ordinary GLB import must survive a capture that is holding the viewport.
  const importing = vantage('burst', '--count', '8', '--interval', '300', '--name', 'import');
  await page.waitForFunction(() => document.getElementById('composition-capture')?.disabled === true, null, {timeout: 15000});
  const imported = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const file = new File([bytes], 'witness-import.glb', {type: 'model/gltf-binary'});
    try {
      const id = await window.kaminosSceneAuthoring.importMesh(file);
      return {id, heldAtArrival: document.getElementById('composition-capture').disabled};
    } catch (error) { return {error: error.message}; }
  }, minimalGlb().toString('base64'));
  const importBurst = await importing;
  check('the burst around the import completes', importBurst.code === 0, {code: importBurst.code, stderr: importBurst.stderr});
  const registered = await page.evaluate(() => window.kaminosSceneObjectDebugState().filter(object => object.label === 'witness-import').length);
  check('an import that lands during a capture registers exactly once', !imported.error && imported.heldAtArrival === true && registered === 1, {imported, registered});

  report.phase = 'editor-input-held'; save();
  // While the sub borrows the viewport, transform and framing keys and clicks
  // on the canvas wait; afterwards navigation and transforms work as before.
  await page.evaluate(() => window.kaminosSetCameraDebugPose({position: [8, 1.2, 3.5], target: [8, 0.5, 0]}));
  await page.evaluate(id => window.kaminosSelection.set([id], id), scene.blue);
  const centre = await page.evaluate(() => {
    const rect = document.getElementById('kaminos-host-renderer-canvas').getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {x, y, hit: hit ? `${hit.tagName.toLowerCase()}#${hit.id}` : null};
  });
  report.effective.canvasHit = centre.hit;
  await page.mouse.move(centre.x, centre.y);
  const keysHeld = vantage('burst', '--count', '6', '--interval', '200', '--name', 'keys-held');
  await page.waitForFunction(() => document.getElementById('composition-capture')?.disabled === true, null, {timeout: 15000});
  await page.keyboard.press('g');
  await page.keyboard.press('f');
  const duringKeys = await page.evaluate(() => ({held: document.getElementById('composition-capture').disabled,
    modal: window.kaminosPlacementDebugState().modal?.operation ?? null, hud: document.getElementById('scene-edit-hud')?.textContent ?? null}));
  const keysResult = await keysHeld;
  check('a burst with transform and framing keys pressed during it completes', keysResult.code === 0, {code: keysResult.code, stderr: keysResult.stderr});
  check('transform and framing keys wait while the sub holds the viewport', duringKeys.held && duringKeys.modal === null, duringKeys);
  const afterKeys = await page.evaluate(() => window.kaminosPlacementDebugState().controlsEnabled);
  await page.keyboard.press('g');
  const resumed = await page.evaluate(() => window.kaminosPlacementDebugState().modal?.operation ?? null);
  await page.keyboard.press('Escape');
  const settled = await page.evaluate(() => ({modal: window.kaminosPlacementDebugState().modal, controls: window.kaminosPlacementDebugState().controlsEnabled}));
  check('afterwards navigation is on and the same key starts a transform', afterKeys === true && resumed === 'translate' && settled.modal === null && settled.controls === true,
    {afterKeys, resumed, settled});
  await page.evaluate(() => window.kaminosSelection.clear());
  const clickHeld = vantage('burst', '--count', '6', '--interval', '200', '--name', 'click-held');
  await page.waitForFunction(() => document.getElementById('composition-capture')?.disabled === true, null, {timeout: 15000});
  await page.mouse.click(centre.x, centre.y);
  const duringClick = await page.evaluate(() => ({held: document.getElementById('composition-capture').disabled, selection: window.kaminosSelection.read().ids}));
  const clickResult = await clickHeld;
  check('a burst with a canvas click during it completes', clickResult.code === 0, {code: clickResult.code, stderr: clickResult.stderr});
  const heldSelection = await page.evaluate(() => window.kaminosSelection.read().ids);
  check('a click on the canvas waits while the sub holds the viewport', duringClick.held && duringClick.selection.length === 0 && heldSelection.length === 0,
    {duringClick, after: heldSelection});
  await page.mouse.click(centre.x, centre.y);
  const clicked = await page.evaluate(() => window.kaminosSelection.read().ids);
  check('the same click selects the box once the picture is done', clicked.includes(scene.blue), {clicked});

  report.phase = 'box-and-views-held'; save();
  // Box selection, saved camera views and framing act through the camera too.
  // A picture waits for an armed box; during a picture they wait for it.
  const boxAround = async ({x, y}) => {
    await page.mouse.move(x - 90, y - 90);
    await page.mouse.down();
    await page.mouse.move(x + 90, y + 90, {steps: 6});
    await page.mouse.up();
  };
  await page.evaluate(() => window.kaminosSelection.clear());
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.press('b');
  const refusedForBox = await vantage('snap', '--name', 'box-armed');
  check('a picture waits while a box selection is armed', refusedForBox.code === 1 && /box selection/i.test(refusedForBox.stderr),
    {code: refusedForBox.code, stderr: refusedForBox.stderr});
  await page.keyboard.press('Escape');
  const viewsBefore = await page.evaluate(() => window.kaminosCameraViews.read().items.length);
  const operatorBeforeBurst = await page.evaluate(() => window.kaminosCameraDebugState());
  const boxHeld = vantage('burst', '--count', '10', '--interval', '300', '--name', 'box-held');
  await page.waitForFunction(() => document.getElementById('composition-capture')?.disabled === true, null, {timeout: 15000});
  await page.keyboard.press('b');
  const armedDuringHold = await page.evaluate(() => window.kaminosSelection.boxing());
  await boxAround(centre);
  // The sub panel is exempt from the hold; a drag on it must not box-select the scene.
  const panelCentre = await page.evaluate(() => { const r = document.querySelector('#agent-vantage-hud canvas').getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; });
  await page.mouse.move(panelCentre.x - 40, panelCentre.y - 30);
  await page.mouse.down();
  await page.mouse.move(panelCentre.x + 40, panelCentre.y + 30, {steps: 4});
  await page.mouse.up();
  // A dialog over the canvas keeps working, and another tool's Frame button waits.
  const naming = page.evaluate(() => window.saveSceneAs({promptName: true}));
  await page.waitForSelector('[data-file-name-cancel]', {timeout: 5000});
  const cancelAt = await page.evaluate(() => { const r = document.querySelector('[data-file-name-cancel]').getBoundingClientRect(), canvas = document.getElementById('kaminos-host-renderer-canvas').getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2; return {x, y, overCanvas: x >= canvas.left && x <= canvas.right && y >= canvas.top && y <= canvas.bottom}; });
  await page.mouse.click(cancelAt.x, cancelAt.y);
  const dialog = await page.evaluate(() => ({closed: !document.querySelector('.file-name-prompt'), held: document.getElementById('composition-capture').disabled}));
  const named = await naming;
  await page.evaluate(() => document.getElementById('volume-fit-camera').click());
  const duringBox = await page.evaluate(() => {
    let saved = null, framed = null;
    try { window.kaminosCameraViews.save('Saved during a picture'); saved = 'saved'; } catch (error) { saved = error.message; }
    framed = window.kaminosFrameSelected();
    return {held: document.getElementById('composition-capture').disabled, selection: window.kaminosSelection.read().ids, saved, framed};
  });
  const boxResult = await boxHeld;
  await page.keyboard.press('Escape');
  const cameraAfterFrame = await page.evaluate(() => window.kaminosCameraDebugState());
  check('a burst with boxes drawn, a dialog used and a tool Frame button pressed during it completes, so Frame moved nothing', boxResult.code === 0, {code: boxResult.code, stderr: boxResult.stderr});
  const viewsAfter = await page.evaluate(() => window.kaminosCameraViews.read().items.length);
  check('B arms no box during a picture, and boxes on the canvas or the sub panel select nothing',
    armedDuringHold === false && duringBox.held && duringBox.selection.length === 0
    && (await page.evaluate(() => window.kaminosSelection.read().ids)).length === 0, {armedDuringHold, ...duringBox});
  check('a dialog over the canvas keeps working during a picture', cancelAt.overCanvas && dialog.held && dialog.closed && !named,
    {cancelAt, dialog, named});
  check('saving or framing a view waits while the sub holds the viewport',
    duringBox.saved === 'The agent sub is taking a picture' && duringBox.framed === false && viewsAfter === viewsBefore
    && sameView(operatorBeforeBurst, cameraAfterFrame), {...duringBox, viewsBefore, viewsAfter});
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.press('b');
  await boxAround(centre);
  const boxed = await page.evaluate(() => window.kaminosSelection.read().ids);
  const savedAfter = await page.evaluate(() => { window.kaminosCameraViews.save('Saved after the picture'); return window.kaminosCameraViews.read().items.length; });
  check('afterwards the same box selects the box and the view saves', boxed.includes(scene.blue) && savedAfter === viewsBefore + 1, {boxed, savedAfter});

  report.phase = 'scene-camera-map'; save();
  // Looking through the sub with a zoomed camera frame: the operator's
  // effective projection reaches the sketch, and the panel map follows it.
  await page.evaluate(() => { window.kaminosSceneCameras.setActive('vantage-bebop'); window.kaminosSceneCameras.enter(); });
  await page.waitForTimeout(900);
  const panel = () => page.evaluate(() => document.querySelector('#agent-vantage-hud canvas').toDataURL());
  const framedBefore = (await vantageOk('sketch')).result.operator.optics?.projection ?? null;
  const panelBefore = await panel();
  await page.evaluate(() => window.kaminosSceneCameras.zoomFrame(1.6));
  await page.waitForTimeout(900);
  const framedAfter = (await vantageOk('sketch')).result.operator.optics?.projection ?? null;
  const panelAfter = await panel();
  await page.evaluate(() => window.kaminosSceneCameras.leave());
  check('the sketch carries the projection the camera frame renders with',
    !!framedBefore && !!framedAfter && framedBefore.some((value, i) => Math.abs(value - framedAfter[i]) > 1e-6), {framedBefore, framedAfter});
  check('a frame zoom alone repaints the map panel', panelBefore !== panelAfter, {changed: panelBefore !== panelAfter});

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
