import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findArchVolumeConstructionContradictions, findArchVolumeContinuationContradictions, findArchVolumeEvidenceContradictions } from './structural-material-arch-volume-evidence.mjs';

const [urlInput, reportInput, browserInput] = process.argv.slice(2);
if (!urlInput || !reportInput || !browserInput) {
  throw new Error('usage: node structural-material-arch-volume-smoke.mjs <local-volume-url> <report.json> <independent-chrome-executable>');
}

const root = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(process.cwd(), reportInput);
const artifactPrefix = basename(reportPath, '.json');
mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  schema: 'kaminos.structural-material.arch-volume-smoke.v1',
  status: 'running',
  phase: 'preflight',
  requestedUrl: urlInput,
  effectiveRoute: 'not observed',
  source: {},
  browser: {},
  profileResponses: [],
  transitions: {},
  captures: {},
  runtimeExceptions: [],
  consoleErrors: [],
  lastTrustworthyEvidence: 'arguments recorded; no browser route contacted',
};
let child;
let socket;
let profile;
let childExit;
let nextId = 0;
const pending = new Map();
const checks = [];

function save() { writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
function check(name, passed, observed) {
  checks.push({ name, passed, observed });
  save();
  if (!passed) throw new Error(`witness predicate failed: ${name}`);
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function send(method, params = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = ++nextId;
    pending.set(id, { resolvePromise, rejectPromise, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function snapshot() {
  return evaluate(`(() => ({
    url: location.href,
    title: document.title,
    status: document.querySelector('#status')?.textContent ?? null,
    receipt: document.querySelector('#receipt')?.textContent ?? null,
    routeWitness: window.__archVolumeWitness?.() ?? null,
    controls: Object.fromEntries(['.force', '#solve', '#release', '#bind', '#reset', '#status'].map(id => {
      const node = document.querySelector(id);
      return [id, node ? { disabled: node.disabled, rect: (() => { const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })() } : null];
    })),
    canvas: (() => { const r=document.querySelector('canvas')?.getBoundingClientRect(); return r ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; })(),
    viewport: {width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth},
  }))()`);
}
async function waitForWitness() {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const state = await snapshot();
    if (state.routeWitness?.phase === 'interactive') return state;
    if (state.status?.startsWith('Startup failed')) throw new Error(state.receipt || state.status);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error('volume route did not reach interactive witness state within 30000 ms');
}
async function capture(name, state) {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 120));
  state = await snapshot();
  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  const valid = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  check(`${name}: screenshot matches viewport`, valid && bytes.length > 4096 && bytes.readUInt32BE(16) === state.viewport.width && bytes.readUInt32BE(20) === state.viewport.height, {bytes: bytes.length, viewport: state.viewport});
  const path = resolve(dirname(reportPath), `${artifactPrefix}-${name}.png`);
  writeFileSync(path, bytes);
  report.captures[name] = {path, sha256: sha(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), state};
  report.lastTrustworthyEvidence = `${name} frame and DOM state captured from ${state.url}`;
  save();
  return state;
}
function connect(endpoint) {
  return new Promise((resolvePromise, rejectPromise) => {
    socket = new WebSocket(endpoint);
    socket.addEventListener('open', resolvePromise, {once: true});
    socket.addEventListener('error', rejectPromise, {once: true});
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') report.runtimeExceptions.push(message.params.exceptionDetails);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map(arg => arg.value ?? arg.description));
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('profile.json')) report.profileResponses.push({url: message.params.response.url, status: message.params.response.status});
      if (message.id && pending.has(message.id)) {
        const item = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) item.rejectPromise(new Error(`${item.method}: ${message.error.message}`));
        else item.resolvePromise(message.result || {});
      }
    });
  });
}
async function close() {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    report.browser.cleanupSignal = child.kill('SIGTERM')
      ? 'SIGTERM sent to the exact owned browser child after evidence capture'
      : 'owned browser child had already exited before cleanup signal';
  }
  if (child?.pid) {
    childExit = child.exitCode !== null || child.signalCode !== null
      ? {code: child.exitCode, signal: child.signalCode}
      : await new Promise(resolvePromise => {
        const onExit = (code, signal) => resolvePromise({code, signal});
        child.once('exit', onExit);
        if (child.exitCode !== null || child.signalCode !== null) {
          child.removeListener('exit', onExit);
          resolvePromise({code: child.exitCode, signal: child.signalCode});
        }
      });
  }
  if (profile) rmSync(profile, {recursive: true, force: true});
  report.browser.exit = childExit || null;
}

try {
  const url = new URL(urlInput);
  report.requestedConstruction = url.searchParams.get('construction') ?? 'sparse-depth';
  report.requestedLayers = url.searchParams.has('layers') ? Number(url.searchParams.get('layers')) : null;
  const initialIntervals = Number(url.searchParams.get('initialIntervals') ?? 1);
  if (!Number.isInteger(initialIntervals) || initialIntervals < 1) throw new Error('initialIntervals must be a positive integer');
  report.initialIntervals = initialIntervals;
  check('requested route is the local structural-volume consumer', ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/structural-material-arch-volume.html', url.href);
  report.effectiveRoute = 'local structural-volume consumer pending runtime identity';
  report.source.revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  report.source.dirtyPaths = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean).map(line => line.slice(3));
  const sourcePaths = ['structural-material-arch-volume.html', 'structural-material-arch-volume-view.js', 'structural-material-arch-core.js'];
  const profilePaths = {
    intact: 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json',
    'outer-notch': 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/outer-notch-profile.json',
  };
  const expectedSources = Object.fromEntries([...sourcePaths, ...Object.values(profilePaths)].map(path => [path, sha(readFileSync(resolve(root, path)))]));
  const expectedProfileSourceHashes = Object.fromEntries(Object.entries(profilePaths).map(([name, path]) => [name, JSON.parse(readFileSync(resolve(root, path), 'utf8')).source.sha256]));
  report.source.expectedSha256 = expectedSources;
  report.source.expectedProfileSourceSha256 = expectedProfileSourceHashes;
  const executable = realpathSync(browserInput);
  report.browser.requestedExecutable = browserInput;
  report.browser.effectiveExecutable = executable;
  check('headless browser is independent from installed GUI Chrome', !executable.includes('/Google Chrome.app/Contents/MacOS/') && /chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable), executable);
  const fd = openSync(executable, 'r');
  const magic = Buffer.alloc(4);
  try { readSync(fd, magic, 0, 4, 0); } finally { closeSync(fd); }
  check('browser executable is a native binary', magic.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) || magic.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe])) || magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), magic.toString('hex'));
  report.browser.version = execFileSync(executable, ['--version'], {encoding: 'utf8'}).trim();
  report.phase = 'browser-launch';
  profile = mkdtempSync(`${tmpdir()}/kaminos-arch-volume-`);
  child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.once('exit', (code, signal) => { childExit = {code, signal}; });
  await new Promise((resolvePromise, rejectPromise) => { child.once('spawn', resolvePromise); child.once('error', rejectPromise); });
  const until = Date.now() + 180000;
  while (!existsSync(`${profile}/DevToolsActivePort`)) {
    if (child.exitCode !== null) throw new Error(`headless browser exited before DevTools opened: ${JSON.stringify(childExit)} ${stderr}`);
    if (Date.now() >= until) throw new Error(`DevTools endpoint not available after 180000ms: ${stderr}`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  const [port] = readFileSync(`${profile}/DevToolsActivePort`, 'utf8').trim().split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('browser exposed no page target');
  await connect(page.webSocketDebuggerUrl);
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false});
  url.searchParams.set('force', '2');
  url.searchParams.set('load', '1');
  await send('Page.navigate', {url: url.href});
  report.phase = 'route-observation';
  let state = await waitForWitness();
  report.transitions.firstInterval = state;
  if (initialIntervals > 1) {
    await capture('first-subcritical-interval', state);
    await evaluate(`for (let interval = 1; interval < ${initialIntervals}; interval += 1) document.querySelector('#solve').click()`);
    state = await waitForWitness();
  }
  report.effectiveRoute = state.routeWitness.route;
  check('effective route identity matches the arch volume witness', report.effectiveRoute === 'kaminos.structural-material.arch-force-volume.v0', report.effectiveRoute);
  check('both source profiles were fetched successfully', report.profileResponses.length >= 2 && report.profileResponses.every(response => response.status === 200), report.profileResponses);
  const servedPaths = [...sourcePaths, ...Object.values(profilePaths)];
  const servedSources = await evaluate(`(async () => {
    const paths = ${JSON.stringify(servedPaths)};
    const entries = await Promise.all(paths.map(async path => {
      const response = await fetch(new URL(path, location.href), {cache: 'no-store'});
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      let profileSourceSha256 = null;
      if (path.endsWith('.json')) profileSourceSha256 = JSON.parse(new TextDecoder().decode(bytes)).source?.sha256 ?? null;
      return [path, {status: response.status, sha256, profileSourceSha256}];
    }));
    return Object.fromEntries(entries);
  })()`);
  report.source.served = servedSources;
  const identityIssues = findArchVolumeEvidenceContradictions({expectedSources, servedSources, expectedProfileSourceHashes, cases: state.routeWitness.cases});
  check('served implementation and profiles match the local witness inputs', identityIssues.length === 0, {identityIssues, expectedSources, servedSources, expectedProfileSourceHashes, cases: state.routeWitness.cases});
  const hitTargetRects = Object.values(state.controls).map(control => control?.rect).filter(Boolean);
  const hitTargetsContained = hitTargetRects.every(rect => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= state.viewport.width && rect.y + rect.height <= state.viewport.height);
  const hitTargetsSeparated = hitTargetRects.every((rect, index) => hitTargetRects.slice(index + 1).every(other => rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y));
  check('operator controls and status fit without overlap or viewport clipping', hitTargetsContained && hitTargetsSeparated && state.viewport.documentWidth <= state.viewport.width, {controls: state.controls, viewport: state.viewport});
  check('both source profiles loaded as populated front-loaded volumes on the declared solver', Object.keys(state.routeWitness.cases || {}).length === 2 && Object.values(state.routeWitness.cases).every(item => item.nodes > 0 && item.renderedInstances === item.nodes && item.solverAuthority === 'shear-regularized-linear-spring-pcg-v0' && item.loadedNodeLayers.length === 1 && item.loadedNodeLayers[0] === item.layers - 1 && item.contactDepthMode === 'camera-facing-surface'), state.routeWitness.cases);
  const constructionIssues = findArchVolumeConstructionContradictions(report.requestedConstruction, state.routeWitness.cases);
  check('effective volume construction and non-tethering history match the request', constructionIssues.length === 0 && state.routeWitness.construction === report.requestedConstruction && Object.values(state.routeWitness.cases).every(item => report.requestedLayers === null || item.layers === report.requestedLayers), {constructionIssues, requestedLayers: report.requestedLayers, cases: state.routeWitness.cases});
  check('load 2 creates damage during the declared finite force intervals', Object.values(state.routeWitness.cases).every(item => item.broken > 0 && item.displayMode === 'evolving-force-pose' && item.displayTravel === item.travel && item.loadApplication?.round === initialIntervals && item.evolution?.kind === 'overdamped-linear-spring-implicit-euler-v0'), state.routeWitness.cases);
  check('Release is available after the loaded fracture witness', state.controls['#release']?.disabled === false, state.controls['#release']);
  const cameraAtLoad = JSON.stringify(state.routeWitness.camera);
  state = await capture('loaded-fracture', state);
  let preRelease = state.routeWitness.cases;
  await evaluate('document.querySelector("#bind").click()');
  state = await waitForWitness();
  check('direct Solve to Bind is unavailable before Release', state.controls['#bind']?.disabled === true && Object.values(state.routeWitness.cases).every((item, index) => {
    const prior = Object.values(preRelease)[index];
    return item.requestedForce === 2 && item.broken === prior.broken && item.connectivityEpoch === prior.connectivityEpoch && item.displayMode === 'evolving-force-pose';
  }), {controls: state.controls['#bind'], cases: state.routeWitness.cases});
  await evaluate('document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.secondApply = state;
  const secondIssues = findArchVolumeContinuationContradictions(preRelease, state.routeWitness.cases);
  check('second Apply adds fractures while retaining the first injury', secondIssues.length === 0, {secondIssues, before: preRelease, after: state.routeWitness.cases});
  await capture('repeated-fracture', state);
  preRelease = state.routeWitness.cases;
  const target = state.routeWitness.cases.intact.pickTargets['left-shoulder'];
  report.operatorInput = [{kind: 'click', contact: 'intact-left-shoulder', target}];
  save();
  await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1});
  state = await waitForWitness();
  check('visible front-face click selects the intended structural cell without changing damage', state.routeWitness.selectedContact?.sourceProfile === 'intact' && state.routeWitness.selectedContact.column === target.column && state.routeWitness.selectedContact.row === target.row && Object.entries(state.routeWitness.cases).every(([name, item]) => item.broken === preRelease[name].broken && item.eventCount === preRelease[name].eventCount && item.loadApplication.round === preRelease[name].loadApplication.round), {target, selectedContact: state.routeWitness.selectedContact, cases: state.routeWitness.cases});
  await evaluate('document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.newContactApply = state;
  const contactIssues = findArchVolumeContinuationContradictions(preRelease, state.routeWitness.cases, { requireNewFracture: false });
  check('new-contact Apply advances the same damaged arch without requiring a subcritical fracture', contactIssues.length === 0 && state.routeWitness.cases.intact.contact.column === target.column && state.routeWitness.cases.intact.contact.row === target.row, {contactIssues, before: preRelease, after: state.routeWitness.cases});
  check('front-only load reaches unloaded depth layers through surviving bonds', Object.values(state.routeWitness.cases).every(item => item.loadedNodeLayers.length === 1 && item.loadedNodeLayers[0] === item.layers - 1 && item.depthMotion.every(layer => layer.maxDisplacement > 0) && item.depthMotion.at(-1).maxDisplacement > item.depthMotion[0].maxDisplacement), state.routeWitness.cases);
  await capture('new-contact-fracture', state);
  const crown = state.routeWitness.cases.intact.pickTargets.crown;
  report.operatorInput.push({kind: 'click', contact: 'injured-crown-for-reload-comparison', target: crown});
  save();
  await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: crown.x, y: crown.y, button: 'left', clickCount: 1});
  await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: crown.x, y: crown.y, button: 'left', clickCount: 1});
  state = await waitForWitness();
  check('reload comparison selects the previously injured crown', state.routeWitness.selectedContact.column === crown.column && state.routeWitness.selectedContact.row === crown.row, {crown, selected: state.routeWitness.selectedContact});
  preRelease = state.routeWitness.cases;
  await evaluate('document.querySelector("#release").click()');
  state = await waitForWitness();
  report.transitions.release = state;
  check('release retains damaged graph while clearing force', Object.values(state.routeWitness.cases).every((item, index) => {
    const prior = Object.values(preRelease)[index];
    return item.broken === prior.broken && item.connectivityEpoch === prior.connectivityEpoch && item.travel === 0 && item.displayMode === 'unloaded-damaged' && item.forceMarkerCount === 0;
  }), state.routeWitness.cases);
  check('release retains the operator camera', JSON.stringify(state.routeWitness.camera) === cameraAtLoad, {before: cameraAtLoad, after: state.routeWitness.camera});
  await capture('released-damage-retained', state);
  await evaluate('document.querySelector("#force").value="0.1"; document.querySelector("#force").dispatchEvent(new Event("input",{bubbles:true}))');
  state = await waitForWitness();
  check('changing requested force leaves injury and Release/Bind state intact', state.controls['#bind'].disabled === false && Object.entries(state.routeWitness.cases).every(([name, item]) => item.broken === preRelease[name].broken && item.connectivityEpoch === preRelease[name].connectivityEpoch && item.requestedForce === 0), state);
  await evaluate('document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.damagedReload = state;
  check('renewed small force uses retained damage', Object.entries(state.routeWitness.cases).every(([name, item]) => item.requestedForce === 0.1 && item.brokenBondIds.every(id => preRelease[name].brokenBondIds.includes(id)) && item.broken === preRelease[name].broken && item.travel > 0), state.routeWitness.cases);
  await capture('damaged-small-reload', state);
  await evaluate('document.querySelector("#release").click()');
  state = await waitForWitness();
  const released = state.routeWitness.cases;
  await evaluate('document.querySelector("#bind").click()');
  state = await waitForWitness();
  report.transitions.bind = state;
  check('Bind repairs the released graph at zero force', Object.values(state.routeWitness.cases).every((item, index) => item.broken === 0 && item.components === 1 && item.travel === 0 && item.maxLiveStrain === 0 && item.displayMode === 'repaired-graph-equilibrium' && item.connectivityEpoch > released[Object.keys(state.routeWitness.cases)[index]].connectivityEpoch), state.routeWitness.cases);
  check('Bind retains the operator camera', JSON.stringify(state.routeWitness.camera) === cameraAtLoad, {before: cameraAtLoad, after: state.routeWitness.camera});
  check('browser reported no uncaught runtime or console errors', report.runtimeExceptions.length === 0 && report.consoleErrors.length === 0, {runtimeExceptions: report.runtimeExceptions, consoleErrors: report.consoleErrors});
  await capture('bound-at-zero-load', state);
  await evaluate('document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.boundReload = state;
  check('Bind restores stiffness under the same renewed force and contact', Object.entries(state.routeWitness.cases).every(([name, item]) => item.requestedForce === 0.1 && item.broken === 0 && item.travel < report.transitions.damagedReload.routeWitness.cases[name].travel), {damaged: report.transitions.damagedReload.routeWitness.cases, bound: state.routeWitness.cases});
  await evaluate('document.querySelector("#reset").click(); document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.intactReload = state;
  check('bound and fresh arches have the same small-force response', Object.entries(state.routeWitness.cases).every(([name, item]) => item.broken === 0 && Math.abs(item.travel - report.transitions.boundReload.routeWitness.cases[name].travel) < 1e-10), {fresh: state.routeWitness.cases, bound: report.transitions.boundReload.routeWitness.cases});
  check('all force, fracture, selection, Release, and Bind transitions retain the camera', JSON.stringify(state.routeWitness.camera) === cameraAtLoad, {before: cameraAtLoad, after: state.routeWitness.camera});
  await send('Page.navigate', {url: url.href});
  state = await waitForWitness();
  report.operatorInput.push({kind: 'repeated-apply', contact: 'default-crown', totalIntervals: 20, force: 2});
  save();
  await evaluate('for (let interval = 1; interval < 20; interval += 1) document.querySelector("#solve").click()');
  state = await waitForWitness();
  report.transitions.continuedCrown = state;
  check('continued crown pull records support state without visual tethers', Object.values(state.routeWitness.cases).every(item => item.loadApplication.round === 20 && typeof item.contactDetached === 'boolean' && (!item.contactDetached || item.components > 1)) && findArchVolumeConstructionContradictions(report.requestedConstruction, state.routeWitness.cases).length === 0, state.routeWitness.cases);
  await capture('continued-crown-response', state);
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await send('Page.navigate', {url: url.href});
  state = await waitForWitness();
  check('mobile controls remain inside the viewport', Object.values(state.controls).every(control => control && control.rect.x >= 0 && control.rect.x + control.rect.width <= state.viewport.width && control.rect.y + control.rect.height <= state.viewport.height) && state.viewport.documentWidth <= state.viewport.width, {controls: state.controls, viewport: state.viewport});
  await capture('mobile-fracture', state);
  check('complete sequence has no uncaught runtime or console errors', report.runtimeExceptions.length === 0 && report.consoleErrors.length === 0, {runtimeExceptions: report.runtimeExceptions, consoleErrors: report.consoleErrors});
  report.phase = 'complete';
  report.status = 'passed';
  report.checks = checks;
  report.lastTrustworthyEvidence = 'requested depth construction, repeated and new-contact injury, zero-load repair, continued crown detachment without history tethers, and mobile frame observed on the identified route';
} catch (error) {
  report.status = 'failed';
  report.failure = {phase: report.phase, message: error.message, stack: error.stack};
  report.checks = checks;
} finally {
  if (report.status === 'running') {
    report.status = 'failed';
    report.failure = {phase: report.phase, message: 'witness ended without reaching a terminal status'};
    report.checks = checks;
  }
  if (report.status === 'passed') report.phase = 'complete';
  save();
  await close().catch(error => { report.cleanupError = error.message; report.status = 'failed'; });
  save();
}
if (report.status !== 'passed') process.exitCode = 1;
