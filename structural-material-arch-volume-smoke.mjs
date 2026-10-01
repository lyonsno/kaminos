import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const [urlInput, reportInput, browserInput] = process.argv.slice(2);
if (!urlInput || !reportInput || !browserInput) {
  throw new Error('usage: node structural-material-arch-volume-smoke.mjs <local-volume-url> <report.json> <independent-chrome-executable>');
}

const root = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(process.cwd(), reportInput);
const artifactPrefix = basename(reportPath, '.json');
mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  schema: 'kaminos.structural-material.arch-volume-smoke.v0',
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
  if (socket?.readyState === WebSocket.OPEN) {
    await send('Browser.close').catch(() => {});
    socket.close();
  } else if (child?.pid && child.exitCode === null) child.kill('SIGTERM');
  if (child?.pid && childExit === undefined) childExit = await new Promise(resolvePromise => child.once('exit', (code, signal) => resolvePromise({code, signal})));
  if (profile) rmSync(profile, {recursive: true, force: true});
  report.browser.exit = childExit || null;
}

try {
  const url = new URL(urlInput);
  check('requested route is the local structural-volume consumer', ['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname === '/structural-material-arch-volume.html', url.href);
  report.effectiveRoute = 'local structural-volume consumer pending runtime identity';
  report.source.revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  report.source.dirtyPaths = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean).map(line => line.slice(3));
  const sourcePaths = ['structural-material-arch-volume.html', 'structural-material-arch-volume-view.js', 'structural-material-arch-core.js'];
  report.source.sha256 = Object.fromEntries(sourcePaths.map(path => [path, sha(readFileSync(resolve(root, path)))]));
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
  url.search = '?force=2&load=1';
  await send('Page.navigate', {url: url.href});
  report.phase = 'route-observation';
  let state = await waitForWitness();
  report.effectiveRoute = state.routeWitness.route;
  check('effective route identity matches the arch volume witness', report.effectiveRoute === 'kaminos.structural-material.arch-force-volume.v0', report.effectiveRoute);
  check('both source profiles were fetched successfully', report.profileResponses.length === 2 && report.profileResponses.every(response => response.status === 200), report.profileResponses);
  const hitTargetRects = Object.values(state.controls).map(control => control?.rect).filter(Boolean);
  const hitTargetsContained = hitTargetRects.every(rect => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= state.viewport.width && rect.y + rect.height <= state.viewport.height);
  const hitTargetsSeparated = hitTargetRects.every((rect, index) => hitTargetRects.slice(index + 1).every(other => rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y));
  check('operator controls and status fit without overlap or viewport clipping', hitTargetsContained && hitTargetsSeparated && state.viewport.documentWidth <= state.viewport.width, {controls: state.controls, viewport: state.viewport});
  check('both source profiles loaded as populated three-layer structures on the declared solver', Object.keys(state.routeWitness.cases || {}).length === 2 && Object.values(state.routeWitness.cases).every(item => item.nodes > 0 && item.solverAuthority === 'shear-regularized-linear-spring-pcg-v0' && item.loadedNodeLayers.length === 1 && item.loadedNodeLayers[0] === 2 && item.contactDepthMode === 'camera-facing-surface'), state.routeWitness.cases);
  check('load 2 creates damage without unsupported post-fracture equilibrium', Object.values(state.routeWitness.cases).every(item => item.broken > 0 && item.displayMode === 'fracture-event-pose' && item.displayTravel <= item.travel + 1e-9), state.routeWitness.cases);
  check('Release is available after the loaded fracture witness', state.controls['#release']?.disabled === false, state.controls['#release']);
  const cameraAtLoad = JSON.stringify(state.routeWitness.camera);
  state = await capture('loaded-fracture', state);
  const preRelease = state.routeWitness.cases;
  await evaluate('document.querySelector("#release").click()');
  state = await waitForWitness();
  report.transitions.release = state;
  check('release retains damaged graph while clearing force', Object.values(state.routeWitness.cases).every((item, index) => {
    const prior = Object.values(preRelease)[index];
    return item.broken === prior.broken && item.connectivityEpoch === prior.connectivityEpoch && item.travel === 0 && item.displayMode === 'unloaded-damaged' && item.forceMarkerCount === 0;
  }), state.routeWitness.cases);
  check('release retains the operator camera', JSON.stringify(state.routeWitness.camera) === cameraAtLoad, {before: cameraAtLoad, after: state.routeWitness.camera});
  await capture('released-damage-retained', state);
  const released = state.routeWitness.cases;
  await evaluate('document.querySelector("#bind").click()');
  state = await waitForWitness();
  report.transitions.bind = state;
  check('Bind repairs the released graph at zero force', Object.values(state.routeWitness.cases).every((item, index) => item.broken === 0 && item.components === 1 && item.travel === 0 && item.displayMode === 'repaired-graph-equilibrium' && item.connectivityEpoch > released[Object.keys(state.routeWitness.cases)[index]].connectivityEpoch), state.routeWitness.cases);
  check('Bind retains the operator camera', JSON.stringify(state.routeWitness.camera) === cameraAtLoad, {before: cameraAtLoad, after: state.routeWitness.camera});
  check('browser reported no uncaught runtime or console errors', report.runtimeExceptions.length === 0 && report.consoleErrors.length === 0, {runtimeExceptions: report.runtimeExceptions, consoleErrors: report.consoleErrors});
  await capture('bound-at-zero-load', state);
  report.phase = 'complete';
  report.status = 'passed';
  report.checks = checks;
  report.lastTrustworthyEvidence = 'loaded fracture, damage-preserving release, and zero-load Bind were observed on the identified structural-volume route';
} catch (error) {
  report.status = 'failed';
  report.failure = {phase: report.phase, message: error.message, stack: error.stack};
  report.checks = checks;
} finally {
  await close().catch(error => { report.cleanupError = error.message; report.status = 'failed'; });
  save();
}
if (report.status !== 'passed') process.exitCode = 1;
