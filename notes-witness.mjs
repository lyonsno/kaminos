#!/usr/bin/env node
// Live witness for Kaminos notes. Serves this checkout with its own notes log,
// drives the page in an independent Chromium with real keys and clicks, and
// talks back with the real tools/notes.mjs: a note on a selected object wakes a
// waiting agent with its context and picture, the agent's reply reaches the
// page, a copied ref resolves in the terminal, and a ?note= link reopens the
// view. Negative controls: a note for someone else does not wake the agent, a
// tool cannot write as the person, a forged page token is refused, and a note
// whose object was deleted says so. Continuation: a reply being written keeps
// its focus, caret and attach choice through live updates; two follow-ups in a
// row both reach the agent; links into a saved scene, and into a saved flame
// scene that first visits its preset page, open on the note's own view after
// the scene restores. The report is written after every phase.
//
//   node notes-witness.mjs --out DIR --playwright /path/to/playwright-core/index.mjs \
//     --browser /path/to/chrome-for-testing [--port N] [--headed] [--negative-no-picture]
import {execFile, spawn} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {decodeScreenshotPngRgb} from './screenshot-png-rgb.mjs';
import {noteLink} from './notes-core.mjs';

const repo = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(repo, 'tools/notes.mjs');
const AGENT = 'notes-witness-agent', PERSON = 'noah';
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, i, all) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return pairs;
}, []));
for (const name of ['out', 'playwright', 'browser']) if (!options[name]) throw new Error(`--${name} required`);
if (/Google Chrome\.app\//.test(options.browser)) throw new Error('Use an independent Chrome for Testing or Chromium, never the operator browser');
const out = path.resolve(options.out);
mkdirSync(out, {recursive: true});
const notesRoot = path.join(out, 'notes');
const reportPath = path.join(out, 'report.json');
const report = {schema: 'kaminos.notes-witness.v1', startedAt: new Date().toISOString(), notesRoot,
  requested: {browser: options.browser, playwright: options.playwright, headless: options.headed !== true, port: options.port ?? null,
    negativeNoPicture: !!options['negative-no-picture']},
  effective: {}, phase: null, status: 'running', checks: [], pageErrors: [], artifacts: []};
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const check = (name, ok, detail = {}) => {
  report.checks.push({name, ok: !!ok, ...detail});
  save();
  if (!ok) throw new Error(`${name} failed: ${JSON.stringify(detail)}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise(resolve => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});

let origin;
const notes = (args, {timeoutMs = 60000} = {}) => new Promise(resolve => execFile(process.execPath, [cli, '--server', origin, ...args],
  {timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: {...process.env, KAMINOS_NOTES_AS: ''}},
  (error, stdout, stderr) => resolve({code: error ? (error.code ?? 1) : 0, stdout, stderr: stderr.trim()})));
const log = async () => (await (await fetch(`${origin}/api/notes`)).json()).events;

function colors(file) {
  const {width, height, channels, pixels} = decodeScreenshotPngRgb(readFileSync(file));
  let red = 0, first = null, varied = false;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (r > 70 && r > 1.6 * g && r > 1.6 * b) red++;
    const value = (r << 16) | (g << 8) | b;
    if (first === null) first = value; else if (value !== first) varied = true;
  }
  return {width, height, red: red / (width * height), varied};
}

let browser, server;
const savedScenes = [];
const near = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-3);
async function postFromComposer(target, text) {
  if (await target.isHidden('.kn-drawer')) await target.click('.kn-toggle');
  await target.fill('.kn-compose textarea', text);
  await target.click('.kn-compose .kn-btn.primary');
  await target.waitForFunction(() => /^Posted kn-/.test(document.querySelector('.kn-status')?.textContent ?? ''), null, {timeout: 30000});
  return (await target.textContent('.kn-status')).match(/Posted (kn-[0-9a-z]+)/)[1];
}
async function openLink(link, noteId, timeout) {
  const linkPage = await browser.contexts()[0].newPage();
  linkPage.on('pageerror', error => { report.pageErrors.push(`link page: ${error}`); });
  await linkPage.goto(link, {waitUntil: 'load'});
  await linkPage.waitForFunction(id => !!document.querySelector(`.kn-thread[data-focus="true"][data-thread="${id}"]`)
    && /^Opened /.test(document.querySelector('.kn-status')?.textContent ?? ''), noteId, {timeout});
  const state = await linkPage.evaluate(() => ({url: location.href, camera: window.kaminosCameraDebugState(),
    selection: window.kaminosSelection?.read()?.ids ?? [], status: document.querySelector('.kn-status')?.textContent}));
  await linkPage.close();
  return state;
}
try {
  report.phase = 'serve'; save();
  const port = Number(options.port) || await freePort();
  origin = `http://127.0.0.1:${port}`;
  report.effective.origin = origin;
  server = spawn('python3', [path.join(repo, 'serve.py'), String(port)], {cwd: repo, stdio: ['ignore', 'ignore', 'pipe'],
    env: {...process.env, KAMINOS_BIND_HOST: '127.0.0.1', KAMINOS_NOTES_ROOT: notesRoot, KAMINOS_NOTES_PAGE_AUTHOR: PERSON}});
  let serverErrors = '';
  server.stderr.on('data', chunk => { serverErrors = (serverErrors + chunk).slice(-4000); });
  let runtime = null;
  for (const deadline = Date.now() + 30000; !runtime && Date.now() < deadline;) {
    try { runtime = await (await fetch(`${origin}/api/runtime-config`)).json(); } catch { await sleep(150); }
    if (server.exitCode !== null) throw new Error(`serve.py exited: ${serverErrors}`);
  }
  report.effective.server = runtime?.source ?? null;
  check('the served checkout identifies itself', !!runtime?.source?.commit, {source: runtime?.source ?? null});
  const listing = await (await fetch(`${origin}/api/notes`)).json();
  check('the server uses this run\'s own notes log', listing.root === path.resolve(notesRoot) || listing.root.endsWith(path.join(path.basename(out), 'notes')), {root: listing.root});

  report.phase = 'launch-browser'; save();
  const {chromium} = await import(pathToFileURL(path.resolve(options.playwright)));
  browser = await chromium.launch({executablePath: options.browser, headless: options.headed !== true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
  report.effective.browser = {executable: options.browser, version: browser.version()};
  const context = await browser.newContext({viewport: {width: 1440, height: 900}});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin});

  report.phase = 'open-page'; save();
  const page = await context.newPage();
  page.on('pageerror', error => { report.pageErrors.push(String(error)); });
  page.on('console', message => { if (message.type() === 'error') report.pageErrors.push(`console: ${message.text()}`); });
  await page.goto(`${origin}/index.html`, {waitUntil: 'load'});
  await page.waitForFunction(() => window.kaminosNotes && window.kaminosSceneAuthoring && window.kaminosSetCameraDebugPose, null, {timeout: 90000});
  report.effective.pageId = await page.evaluate(() => window.kaminosNotes.pageId);
  report.effective.renderer = await page.evaluate(() => { const state = window.kaminosWorkbenchSceneState?.(); return state ? {backend: state.rendererBackend ?? null, adapter: state.adapter ?? null} : null; });
  let linked = false;
  for (const deadline = Date.now() + 20000; !linked && Date.now() < deadline;) {
    const presence = await (await fetch(`${origin}/api/notes/presence`)).json();
    linked = presence.pages.some(entry => entry.id === report.effective.pageId);
    if (!linked) await sleep(200);
  }
  check('the page holds a notes link to the server', linked, {pageId: report.effective.pageId});

  report.phase = 'arrange'; save();
  const red = await page.evaluate(() => {
    const edit = window.kaminosSceneAuthoring;
    const id = edit.addMesh('box', {width: 1, height: 1, depth: 1});
    edit.setMaterial(id, {color: '#d01818', roughness: 0.6});
    window.kaminosSetSceneObjectTransform(id, {position: [0, 0.5, 0]});
    window.renameSceneObject(id, 'Witness red');
    window.kaminosSetCameraDebugPose({position: [0.6, 1.4, 3.2], target: [0, 0.5, 0]});
    window.kaminosSelection.set([id], id);
    window._kaminosDirty?.();
    return id;
  });
  report.effective.red = red;
  await page.waitForTimeout(800);

  report.phase = 'agent-listens'; save();
  const waiting = notes(['wait', '--as', AGENT], {timeoutMs: 90000});
  let listening = false;
  for (const deadline = Date.now() + 15000; !listening && Date.now() < deadline;) {
    const presence = await (await fetch(`${origin}/api/notes/presence`)).json();
    listening = presence.listeners.some(row => row.name === AGENT && row.waiting);
    if (!listening) await sleep(150);
  }
  check('a waiting agent shows as listening', listening);

  report.phase = 'person-writes'; save();
  // Keys go to the page without a click; a click on empty viewport would clear the selection.
  await page.keyboard.press('Shift+KeyN');
  await page.waitForSelector('.kn-drawer:not([hidden])', {timeout: 5000});
  const anchorLine = await page.textContent('.kn-anchor');
  check('the composer names the selected object', anchorLine.includes('"Witness red"'), {anchorLine});
  // Presence reaches the page on its event stream about once a second.
  const presenceStarted = Date.now();
  await page.waitForFunction(name => document.querySelector('.kn-listening')?.textContent.includes(name), AGENT, {timeout: 6000}).catch(() => {});
  const listeningLine = await page.textContent('.kn-listening');
  check('the drawer says who is listening', listeningLine.includes(AGENT), {listeningLine, waitedMs: Date.now() - presenceStarted});
  await page.fill('.kn-compose textarea', `@${AGENT} why does the red box read this dark on the left?`);
  // Negative control: without the picture the wake check below must fail.
  if (options['negative-no-picture']) await page.uncheck('.kn-compose input[type=checkbox]');
  await page.click('.kn-compose .kn-btn.primary');
  await page.waitForFunction(() => /^Posted kn-/.test(document.querySelector('.kn-status')?.textContent ?? ''), null, {timeout: 20000});
  const posted = await page.textContent('.kn-status');
  check('posting says the listening agent will get it now', posted.includes(`${AGENT} is listening`), {posted});

  report.phase = 'agent-wakes'; save();
  const woke = await waiting;
  writeFileSync(path.join(out, 'wait-output.txt'), woke.stdout);
  report.artifacts.push(path.join(out, 'wait-output.txt'));
  check('the waiting agent wakes with the note', woke.code === 0, {code: woke.code, stderr: woke.stderr});
  const noteId = woke.stdout.match(/Kaminos note (kn-[0-9a-z]+)/)?.[1];
  check('the wake names the object, the person, the served commit and the camera',
    !!noteId && woke.stdout.includes('object "Witness red"') && woke.stdout.includes(`from ${PERSON} (page)`)
      && woke.stdout.includes(`served by ${report.effective.server.branch}@${report.effective.server.commit.slice(0, 7)}`) && /camera: position \[/.test(woke.stdout),
    {noteId, excerpt: woke.stdout.slice(0, 900)});
  const picturePath = woke.stdout.match(/^picture: (\S+\.png) \(/m)?.[1];
  check('the wake points at the picture that came with the note', !!picturePath && existsSync(picturePath), {picturePath});
  const notePicture = path.join(out, 'note-picture.png');
  copyFileSync(picturePath, notePicture);
  report.artifacts.push(notePicture);
  const pictureColors = colors(notePicture);
  report.effective.notePicture = pictureColors;
  check('the picture is what the person saw: the red box, not a blank frame', pictureColors.varied && pictureColors.red > 0.02, pictureColors);
  const posts = (await log()).filter(event => event.type === 'note');
  const stored = posts.find(event => event.id === noteId);
  check('the note is stamped as the person\'s, from the page, on the red box',
    stored?.author === PERSON && stored?.via === 'page' && stored?.anchor?.id === red && stored?.recipients?.includes(AGENT),
    {stored: stored && {author: stored.author, via: stored.via, anchor: stored.anchor, recipients: stored.recipients}});

  report.phase = 'agent-replies'; save();
  // The person goes back to the scene, full screen, before the answer comes.
  await page.click('.kn-close');
  const replied = await notes(['reply', noteId, 'The left side faces away from the key light; the shadow is the light, not the material.', '--as', AGENT, '--picture', notePicture]);
  check('the agent replies from the terminal', replied.code === 0, {stderr: replied.stderr});
  await page.waitForSelector('.kn-toast', {timeout: 15000});
  const toastText = await page.textContent('.kn-toast');
  check('the reply is announced in the page', toastText.includes(`${AGENT} replied on "Witness red"`), {toastText});
  const toastShot = path.join(out, 'toast.png');
  await page.screenshot({path: toastShot});
  report.artifacts.push(toastShot);
  await page.click('.kn-toast');
  await page.waitForFunction(text => [...document.querySelectorAll('.kn-thread .kn-text')].some(node => node.textContent.includes(text)),
    'the shadow is the light', {timeout: 10000});
  await page.waitForSelector('.kn-thread .kn-replies img.kn-pic', {timeout: 10000});
  await page.waitForFunction(() => [...document.querySelectorAll('.kn-thread img.kn-pic')].every(image => image.complete && image.naturalWidth > 0), null, {timeout: 10000});
  const threadShot = path.join(out, 'thread.png');
  await page.screenshot({path: threadShot});
  report.artifacts.push(threadShot);
  let seen = false;
  for (const deadline = Date.now() + 8000; !seen && Date.now() < deadline;) {
    seen = (await log()).some(event => event.type === 'seen' && event.author === PERSON);
    if (!seen) await sleep(150);
  }
  check('opening the thread marks the reply seen in the log', seen);

  report.phase = 'pin'; save();
  await page.click('.kn-close');
  await page.waitForSelector('.kn-pin', {timeout: 5000});
  const pin = await page.evaluate(() => { const rect = document.querySelector('.kn-pin').getBoundingClientRect(); return {x: rect.x, y: rect.y, text: document.querySelector('.kn-pin').textContent}; });
  check('a pin marks the noted object in the viewport', pin.x > 0 && pin.y > 0 && pin.x < 1440 && pin.y < 900 && pin.text === '1', pin);
  const pinShot = path.join(out, 'pin.png');
  await page.screenshot({path: pinShot});
  report.artifacts.push(pinShot);

  report.phase = 'copy-ref'; save();
  await page.click('.kn-toggle');
  await page.waitForSelector('.kn-drawer:not([hidden])');
  await page.click('.kn-compose .kn-btn:not(.primary)');
  await page.waitForFunction(() => /^Copied kn-/.test(document.querySelector('.kn-status')?.textContent ?? ''), null, {timeout: 20000});
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  writeFileSync(path.join(out, 'copied-ref.txt'), copied);
  check('the copied ref tells the agent how to read it', /node tools\/notes\.mjs show kn-[0-9a-z]+/.test(copied) && copied.includes('"Witness red"'), {copied});
  const shown = await notes(['show', copied]);
  check('the pasted ref resolves in the terminal with its picture', shown.code === 0 && shown.stdout.includes('object "Witness red"') && /^picture: /m.test(shown.stdout),
    {code: shown.code, stderr: shown.stderr});

  report.phase = 'negative-controls'; save();
  const notForMe = notes(['wait', '--as', AGENT, '--timeout', '4'], {timeoutMs: 30000});
  await sleep(600);
  await page.fill('.kn-compose textarea', '@someone-else the floor is too glossy');
  await page.click('.kn-compose .kn-btn.primary');
  await page.waitForFunction(() => /^Posted kn-/.test(document.querySelector('.kn-status')?.textContent ?? ''), null, {timeout: 20000});
  const quiet = await notForMe;
  check('a note for someone else does not wake this agent', quiet.code === 4, {code: quiet.code, stdout: quiet.stdout.slice(0, 300)});
  const impostor = await notes(['post', 'land it now', '--as', PERSON]);
  check('a tool cannot write as the person', impostor.code === 1 && /reserved/i.test(impostor.stderr), {code: impostor.code, stderr: impostor.stderr});
  const forged = await fetch(`${origin}/api/notes`, {method: 'POST', headers: {'Content-Type': 'application/json',
    'X-Kaminos-Notes-Page': report.effective.pageId, 'X-Kaminos-Notes-Token': 'guessed-token'},
    body: JSON.stringify({kind: 'note', text: 'from a forged page', anchor: {kind: 'scene'}})});
  check('a forged page token is refused', forged.status === 403 && (await forged.json()).phase === 'page-token', {status: forged.status});

  report.phase = 'deep-link'; save();
  const linkPage = await context.newPage();
  linkPage.on('pageerror', error => { report.pageErrors.push(`link page: ${error}`); });
  await linkPage.goto(`${origin}/index.html?note=${noteId}`, {waitUntil: 'load'});
  await linkPage.waitForFunction(() => window.kaminosNotes && document.querySelector('.kn-thread[data-focus="true"]'), null, {timeout: 90000});
  const restored = await linkPage.evaluate(() => window.kaminosCameraDebugState());
  const view = stored.context.view;
  check('a ?note= link opens the thread and restores the view it was written from',
    view.position.every((value, index) => Math.abs(value - restored.position[index]) < 1e-3), {view: view.position, restored: restored.position});
  await linkPage.close();

  report.phase = 'reply-while-updates'; save();
  // A reply being written keeps its focus, text, caret and attach choice while
  // presence changes and new events arrive (review F3).
  if (await page.isHidden('.kn-drawer')) await page.click('.kn-toggle');
  const card = `.kn-thread[data-thread="${noteId}"]`;
  await page.click(`${card} .kn-actions .kn-btn:nth-child(1)`);
  await page.waitForSelector(`${card} .kn-replybox:not([hidden]) textarea`);
  await page.check(`${card} .kn-replybox input[type=checkbox]`);
  await page.click(`${card} .kn-replybox textarea`);
  await page.keyboard.type('the rim light is too hot');
  await page.evaluate(selector => document.querySelector(selector).setSelectionRange(4, 4), `${card} .kn-replybox textarea`);
  const otherListener = notes(['wait', '--as', 'other-listener', '--timeout', '8'], {timeoutMs: 30000});
  await page.waitForFunction(() => document.querySelector('.kn-listening')?.textContent.includes('other-listener'), null, {timeout: 10000});
  const seenByAgent = await notes(['seen', noteId, '--as', AGENT]);
  await page.waitForTimeout(1500);
  const kept = await page.evaluate(selector => {
    const box = document.querySelector(`${selector} textarea`), attach = document.querySelector(`${selector} input[type=checkbox]`);
    return {focused: document.activeElement === box, value: box.value, caret: box.selectionStart, attach: attach.checked};
  }, `${card} .kn-replybox`);
  check('a reply being written keeps focus, text, caret and attach choice through a presence change and an incoming receipt',
    seenByAgent.code === 0 && kept.focused && kept.value === 'the rim light is too hot' && kept.caret === 4 && kept.attach, {kept, seen: seenByAgent.code});
  await page.keyboard.type('X');
  const continued = await page.inputValue(`${card} .kn-replybox textarea`);
  check('typing carries on at the caret', continued === 'the Xrim light is too hot', {continued});
  await otherListener;

  report.phase = 'follow-ups'; save();
  // Two follow-ups in a row both reach the agent without re-addressing (review F1).
  await page.uncheck(`${card} .kn-replybox input[type=checkbox]`);
  await page.fill(`${card} .kn-replybox textarea`, 'which light did you mean?');
  await page.click(`${card} .kn-replybox .kn-btn.primary`);
  await page.waitForSelector(`${card} .kn-replybox[hidden]`, {state: 'attached', timeout: 15000});
  await page.click(`${card} .kn-actions .kn-btn:nth-child(1)`);
  await page.fill(`${card} .kn-replybox textarea`, 'the rim one, I mean');
  await page.click(`${card} .kn-replybox .kn-btn.primary`);
  await page.waitForSelector(`${card} .kn-replybox[hidden]`, {state: 'attached', timeout: 15000});
  const followUps = await notes(['wait', '--as', AGENT, '--timeout', '10'], {timeoutMs: 40000});
  writeFileSync(path.join(out, 'follow-ups.txt'), followUps.stdout);
  check('two follow-ups in a row both reach the waiting agent', followUps.code === 0 && followUps.stdout.includes('which light did you mean?')
    && followUps.stdout.includes('the rim one, I mean'), {code: followUps.code, excerpt: followUps.stdout.slice(0, 700)});
  check('a reply is described as a reply in its thread', /a reply in thread kn-/.test(followUps.stdout), {excerpt: followUps.stdout.slice(0, 300)});

  report.phase = 'saved-scene-link'; save();
  // A link into a saved scene opens on the note's own view after the scene,
  // with its own saved camera, has been restored (review F2).
  const stamp = Date.now().toString(36);
  await page.evaluate(() => window.kaminosSetCameraDebugPose({position: [3, 2.2, 4], target: [0, 0.5, 0]}));
  const savedScene = await page.evaluate(name => window.saveSceneAs({result: true, name}).then(result => ({ok: result?.ok, filename: result?.filename, error: result?.error})), `notes-witness-${stamp}`);
  check('the scene saves', savedScene.ok === true && !!savedScene.filename, savedScene);
  savedScenes.push(savedScene.filename);
  const savedView = {position: [-2.4, 1.1, 2.6], target: [0, 0.5, 0]};
  await page.evaluate(view => window.kaminosSetCameraDebugPose(view), savedView);
  await page.evaluate(id => window.kaminosSelection.set([id], id), red);
  const savedNoteId = await postFromComposer(page, 'saved scene: the base reads flat from here');
  const savedNote = (await log()).find(event => event.id === savedNoteId);
  check('the note names the saved scene', savedNote?.subject?.scene === savedScene.filename, {subject: savedNote?.subject});
  const savedOpen = await openLink(noteLink(savedNote), savedNoteId, 120000);
  check('a saved-scene link opens after restoration, on the note view, with its object selected',
    near(savedOpen.camera.position, savedView.position) && savedOpen.selection.includes(red) && /restored the view/.test(savedOpen.status),
    {camera: savedOpen.camera.position, selection: savedOpen.selection, status: savedOpen.status});

  report.phase = 'saved-flame-link'; save();
  // A saved flame scene first visits its preset page; the link survives that
  // trip and still opens on the note's view (review F2).
  const flamePage = await context.newPage();
  flamePage.on('pageerror', error => { report.pageErrors.push(`flame page: ${error}`); });
  await flamePage.goto(`${origin}/index.html`, {waitUntil: 'load'});
  await flamePage.waitForFunction(() => window.kaminosNotes && window.kaminosSceneAuthoring && window.kaminosSetCameraDebugPose, null, {timeout: 90000});
  const presetIndex = await (await fetch(`${origin}/api/volume-settings-presets`)).json();
  const candidates = [...presetIndex.entries].sort((a, b) => Number(/immersed/i.test(b.label ?? '')) - Number(/immersed/i.test(a.label ?? ''))).map(entry => entry.presetId);
  const flame = await flamePage.evaluate(async ids => {
    const refused = [];
    for (const id of ids) {
      try { return {ok: true, presetId: id, source: await window.kaminosSceneAuthoring.addFlameEmitter(id), refused}; }
      catch (error) { refused.push(`${id.slice(0, 12)}: ${error.message}`); }
    }
    return {ok: false, refused};
  }, candidates.slice(0, 16));
  report.effective.flame = {presetId: flame.presetId ?? null, source: flame.source ?? null, refusedCount: flame.refused?.length ?? 0};
  check('a flame field from a saved basin joins a fresh scene', flame.ok, {refused: flame.refused?.slice(0, 4)});
  await flamePage.waitForTimeout(1500);
  await flamePage.evaluate(() => window.kaminosSetCameraDebugPose({position: [0, 1.5, 5], target: [0, 0.6, 0]}));
  const flameScene = await flamePage.evaluate(name => window.saveSceneAs({result: true, name}).then(result => ({ok: result?.ok, filename: result?.filename, error: result?.error})), `notes-witness-flame-${stamp}`);
  check('the flame scene saves', flameScene.ok === true && !!flameScene.filename, flameScene);
  savedScenes.push(flameScene.filename);
  const flameView = {position: [1.8, 1.3, 2.9], target: [0, 0.7, 0]};
  await flamePage.evaluate(view => window.kaminosSetCameraDebugPose(view), flameView);
  const flameNoteId = await postFromComposer(flamePage, 'flame scene: the plume leans toward the camera');
  await flamePage.close();
  const flameNote = (await log()).find(event => event.id === flameNoteId);
  const flameOpen = await openLink(noteLink(flameNote), flameNoteId, 180000);
  report.effective.flameLink = {requested: noteLink(flameNote), effective: flameOpen.url};
  check('a saved flame scene link survives the preset redirect and opens on the note view',
    /settings_preset=/.test(flameOpen.url) && near(flameOpen.camera.position, flameView.position) && /^Opened /.test(flameOpen.status),
    {url: flameOpen.url, camera: flameOpen.camera.position, selection: flameOpen.selection, status: flameOpen.status});

  report.phase = 'object-removed'; save();
  const removal = await page.evaluate(id => {
    window.kaminosSelection.set([id], id);
    const result = window.kaminosSelection.remove();
    window._kaminosDirty?.();
    return {result: result ?? null, stillThere: (window.kaminosSceneObjectDebugState?.() ?? []).some(object => object.id === id)};
  }, red);
  const pinGone = await page.waitForFunction(() => !document.querySelector('.kn-pin'), null, {timeout: 5000}).then(() => true, () => false);
  const leftover = await page.evaluate(() => ({pins: [...document.querySelectorAll('.kn-pin')].map(pin => ({id: pin.dataset.pin, text: pin.textContent})),
    objects: (window.kaminosSceneObjectDebugState?.() ?? []).map(object => object.id), active: document.activeElement?.tagName}));
  check('deleting a noted object takes its pin away', pinGone && !removal.stillThere, {removal, leftover});
  if (await page.isHidden('.kn-drawer')) await page.click('.kn-toggle');
  await page.click(`.kn-thread[data-thread="${noteId}"] .kn-actions .kn-btn:nth-child(2)`);
  const goneStatus = await page.textContent('.kn-status');
  check('going to a note whose object was deleted says so and restores only the view', /no longer in this scene/.test(goneStatus), {goneStatus});

  const notesErrors = report.pageErrors.filter(text => /notes|kn-/i.test(text));
  check('no notes errors in the page', notesErrors.length === 0, {notesErrors});
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = {phase: report.phase, error: String(error?.stack || error)};
} finally {
  report.finishedAt = new Date().toISOString();
  for (const name of savedScenes) {
    try { await fetch(`${origin}/api/delete-scene?name=${encodeURIComponent(name)}`); } catch {}
  }
  report.cleanedScenes = savedScenes;
  save();
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(`${report.status}: ${report.checks.filter(item => item.ok).length}/${report.checks.length} checks; report ${reportPath}`);
process.exitCode = report.status === 'passed' ? 0 : 1;
