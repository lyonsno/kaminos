import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [baseInput, reportInput, chromePath, startupTimeoutInput] = process.argv.slice(2);
if (!reportInput) throw new Error('usage: node structural-material-arch-browser-smoke.mjs <local-page-url> <report.json> <chrome-executable> [startup-timeout-ms]');

const root = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(process.cwd(), reportInput);
const outputDirectory = dirname(reportPath);
mkdirSync(outputDirectory, { recursive: true });
const report = {
  schema: 'kaminos.structural-material.arch-browser-smoke.v0',
  status: 'running',
  phase: 'preflight',
  requestedUrl: baseInput || null,
  effectiveRoute: 'not yet observed',
  requestedSolver: 'CPU spring proxy',
  effectiveSolver: 'not yet observed',
  fallback: null,
  lastTrustworthyEvidence: 'request arguments and output destination recorded; no route or browser has been contacted',
  source: {},
  browser: { startupTimeoutMs: startupTimeoutInput === undefined ? 180000 : Number(startupTimeoutInput) },
  profileResponses: [],
  runtimeExceptions: [],
  consoleErrors: [],
  checks: [],
  captures: {},
  processOutput: { stdout: '', stderr: '' },
};
let child;
let socket;
let profileDirectory;
let childExit = null;
let nextId = 0;
const pending = new Map();
const relativeSources = [
  'structural-material-arch.html',
  'structural-material-arch-core.js',
  'structural-material-arch-profile.mjs',
  'structural-material-arch-witness.mjs',
  'structural-material-arch-browser-smoke.mjs',
  'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json',
  'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/outer-notch-profile.json',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function recordCheck(name, passed, observed) {
  report.checks.push({ name, passed, observed });
  if (!passed) throw new Error(`browser smoke check failed: ${name}`);
}

function saveReport() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function evaluate(expression) {
  return send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then(message => {
    if (message.exceptionDetails) throw new Error(message.exceptionDetails.text);
    return message.result.value;
  });
}

function send(method, params = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = ++nextId;
    pending.set(id, { resolvePromise, rejectPromise, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForLoadedPage() {
  while (true) {
    const state = await evaluate('(() => ({ready:document.readyState, title:document.title, state:document.querySelector("#state")?.textContent ?? null, url:location.href}))()');
    if (state.ready === 'complete') {
      if (state.url.startsWith('chrome-error://') || state.state === null) {
        throw new Error(`page did not expose the witness state: ${JSON.stringify(state)}`);
      }
      if (state.state.startsWith('Profile load failed:')) throw new Error(state.state);
      if (state.state.startsWith('Profiles loaded') || state.state.startsWith('Matched load')) return state;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
}

async function navigate(url) {
  const result = await send('Page.navigate', { url });
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  return waitForLoadedPage();
}

async function snapshot() {
  return evaluate(`(() => {
    const text = id => document.getElementById(id)?.textContent ?? null;
    const bounds = selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    };
    const scene = document.querySelector(".scene");
    return {
      url: location.href,
      title: document.title,
      routeLabel: document.querySelector(".provenance")?.textContent ?? null,
      state: text("state"),
      force: document.getElementById("force").value,
      forceOutput: text("force-value"),
      intact: { travel: text("intact-travel"), strain: text("intact-strain"), broken: text("intact-broken"), components: text("intact-components") },
      notched: { travel: text("notched-travel"), strain: text("notched-strain"), broken: text("notched-broken"), components: text("notched-components") },
      svgElementCount: scene.childElementCount,
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
      controls: Object.fromEntries([".force-control", "#solve", "#bind", "#reset", "#state"].map(selector => [selector, bounds(selector)])),
      scene: bounds(".scene"),
      receipt: text("receipt"),
    };
  })()`);
}

async function capture(name) {
  const state = await snapshot();
  const expected = state.force;
  const loadStateMatches = (state.state.includes('Fresh intact-reference trial') && state.state.includes(`Matched load ${Number(expected).toFixed(2)}`)) ||
    (name === 'bind-desktop' && state.state === 'Broken connections rebound');
  recordCheck(`${name}: requested load remains effective`, state.forceOutput === Number(expected).toFixed(2) && loadStateMatches, state);
  recordCheck(`${name}: rendered proxy is populated`, state.svgElementCount > 100, state.svgElementCount);
  recordCheck(`${name}: viewport has no horizontal overflow`, state.viewport.documentWidth <= state.viewport.width, state.viewport);
  recordCheck(`${name}: scene stays inside viewport`, state.scene.x >= 0 && state.scene.right <= state.viewport.width, state.scene);

  const png = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(png.data, 'base64');
  const validPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = validPng ? bytes.readUInt32BE(16) : 0;
  const height = validPng ? bytes.readUInt32BE(20) : 0;
  recordCheck(`${name}: screenshot is nonempty and matches the requested viewport`,
    validPng && bytes.length > 4096 && width === state.viewport.width && height === state.viewport.height,
    { bytes: bytes.length, width, height, viewport: state.viewport });
  const captureFiles = {
    'onset-desktop': 'onset-desktop-chrome.png',
    'separation-desktop': 'separation-desktop-chrome.png',
    'bind-desktop': 'bind-desktop-chrome.png',
    'mobile-onset': 'mobile-emulated-chrome.png',
  };
  const imagePath = resolve(outputDirectory, captureFiles[name]);
  writeFileSync(imagePath, bytes);
  report.captures[name] = {
    path: imagePath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    dimensions: { width, height },
    page: state,
  };
  report.lastTrustworthyEvidence = `${name} screenshot and DOM snapshot captured from ${state.url}`;
}

async function setForceAndSolve(force) {
  await evaluate(`(() => {
    const input=document.getElementById("force");
    input.value=${JSON.stringify(String(force))};
    input.dispatchEvent(new Event("input",{bubbles:true}));
    document.getElementById("solve").click();
  })()`);
  return snapshot();
}

function connectSocket(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    socket = new WebSocket(url);
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') report.runtimeExceptions.push(message.params.exceptionDetails);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        report.consoleErrors.push(message.params.args.map(argument => argument.value ?? argument.description));
      }
      if (message.method === 'Network.responseReceived' && message.params.response.url.includes('profile.json')) {
        report.profileResponses.push({ url: message.params.response.url, status: message.params.response.status });
      }
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.rejectPromise(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolvePromise(message.result || {});
      }
    });
    socket.addEventListener('close', () => {
      for (const entry of pending.values()) entry.rejectPromise(new Error('Chrome DevTools socket closed'));
      pending.clear();
    });
  });
}

async function closeBrowser() {
  if (socket?.readyState === WebSocket.OPEN) {
    await send('Browser.close').catch(() => {});
    socket.close();
  } else if (child?.pid && child.exitCode === null) {
    child.kill('SIGTERM');
  }
  if (child?.pid && childExit === null) {
    childExit = await new Promise(resolvePromise => child.once('exit', (code, signal) => resolvePromise({ code, signal })));
  } else if (child && !child.pid) {
    childExit = { code: child.exitCode, signal: child.signalCode, spawnFailed: true };
  }
  if (profileDirectory) rmSync(profileDirectory, { recursive: true, force: true });
  report.browser.exit = childExit;
}

try {
  if (!baseInput || !chromePath) throw new Error('page URL and Chrome executable are required');
  if (!Number.isSafeInteger(report.browser.startupTimeoutMs) || report.browser.startupTimeoutMs < 1) {
    throw new Error('browser startup timeout must be a positive safe integer in milliseconds');
  }
  const requestedUrl = new URL(baseInput);
  if (!['127.0.0.1', 'localhost'].includes(requestedUrl.hostname) ||
      requestedUrl.pathname !== '/structural-material-arch.html') {
    throw new Error('browser smoke requires the local structural-material-arch.html route');
  }
  requestedUrl.search = '';
  requestedUrl.hash = '';
  report.requestedUrl = requestedUrl.href;
  report.phase = 'source-preflight';
  report.source.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.source.dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).map(line => line.slice(3));
  report.source.sha256 = Object.fromEntries(relativeSources.map(path => [path, sha256(readFileSync(resolve(root, path)))]));
  report.browser.executable = resolve(chromePath);
  report.browser.version = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim();

  report.phase = 'browser-launch';
  profileDirectory = mkdtempSync(join(tmpdir(), 'kaminos-arch-smoke-'));
  child = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profileDirectory}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8').on('data', chunk => { report.processOutput.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { report.processOutput.stderr += chunk; });
  child.once('exit', (code, signal) => { childExit = { code, signal }; });
  await new Promise((resolvePromise, rejectPromise) => {
    child.once('spawn', resolvePromise);
    child.once('error', rejectPromise);
  });
  const browserStartedAt = Date.now();
  report.lastTrustworthyEvidence = `Chrome child spawned (pid ${child.pid}); waiting for DevToolsActivePort`;
  while (!existsSync(join(profileDirectory, 'DevToolsActivePort'))) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools opened: ${childExit?.code}`);
    const elapsedMs = Date.now() - browserStartedAt;
    if (elapsedMs >= report.browser.startupTimeoutMs) {
      report.browser.startupDurationMs = elapsedMs;
      throw new Error(`DevToolsActivePort did not appear within ${report.browser.startupTimeoutMs} ms`);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, Math.min(50, report.browser.startupTimeoutMs - elapsedMs)));
  }
  report.browser.startupDurationMs = Date.now() - browserStartedAt;
  report.lastTrustworthyEvidence = `DevToolsActivePort opened after ${report.browser.startupDurationMs} ms`;
  const [port] = readFileSync(join(profileDirectory, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('Chrome started without a page target');
  await connectSocket(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  report.phase = 'desktop-onset';
  await navigate(new URL('?force=0.75', requestedUrl).href);
  const onset = await setForceAndSolve(0.75);
  recordCheck('onset: Solve names a fresh intact-reference trial', onset.state.includes('Fresh intact-reference trial'), onset.state);
  recordCheck('onset: both profiles use the same selected contact state', onset.state.includes('Matched load 0.75'), onset.state);
  recordCheck('onset: intact and notched counts match the witnessed fracture', onset.intact.broken === '9' && onset.notched.broken === '21', { intact: onset.intact, notched: onset.notched });
  recordCheck('route: visible page identity names the actual CPU proxy consumer',
    onset.routeLabel.includes('TRELLIS silhouette') && onset.routeLabel.includes('CPU spring proxy'), onset.routeLabel);
  report.effectiveRoute = new URL(onset.url).origin + new URL(onset.url).pathname;
  report.effectiveSolver = `local browser JavaScript / ${onset.routeLabel}`;
  report.fallback = false;
  await capture('onset-desktop');

  report.phase = 'desktop-separation';
  const separated = await setForceAndSolve(2);
  recordCheck('separation: only notched proxy splits', separated.intact.components === '1' && separated.notched.components === '2', { intact: separated.intact, notched: separated.notched });
  recordCheck('separation: crack counts match the witnessed graph state', separated.intact.broken === '87' && separated.notched.broken === '198', { intact: separated.intact.broken, notched: separated.notched.broken });
  await capture('separation-desktop');

  report.phase = 'desktop-bind';
  await evaluate('document.getElementById("bind").click()');
  const bound = await snapshot();
  recordCheck('bind: button restores both graphs without resetting force', bound.state === 'Broken connections rebound' && bound.force === '2' && bound.intact.broken === '0' && bound.notched.broken === '0' && bound.intact.components === '1' && bound.notched.components === '1', bound);
  await capture('bind-desktop');

  report.phase = 'mobile-load';
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(new URL('?force=0.5', requestedUrl).href);
  const mobile = await setForceAndSolve(0.5);
  recordCheck('mobile: load slider selects the requested threshold case', mobile.force === '0.5' && mobile.intact.broken === '0' && mobile.notched.broken === '3', { force: mobile.force, intact: mobile.intact, notched: mobile.notched });
  const actionable = Object.entries(mobile.controls);
  for (let left = 0; left < actionable.length; left += 1) {
    for (let right = left + 1; right < actionable.length; right += 1) {
      const a = actionable[left][1];
      const b = actionable[right][1];
      const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      recordCheck(`mobile: ${actionable[left][0]} does not overlap ${actionable[right][0]}`, !overlaps, { a, b });
    }
  }
  await capture('mobile-onset');

  const successfulProfilePaths = new Set(report.profileResponses.filter(response => response.status === 200).map(response => new URL(response.url).pathname));
  recordCheck('profiles: exact intact and notch JSON assets returned HTTP 200',
    [...successfulProfilePaths].some(path => path.endsWith('/intact-profile.json')) &&
    [...successfulProfilePaths].some(path => path.endsWith('/outer-notch-profile.json')),
    report.profileResponses);
  recordCheck('page: no uncaught runtime or console errors', report.runtimeExceptions.length === 0 && report.consoleErrors.length === 0,
    { runtimeExceptions: report.runtimeExceptions, consoleErrors: report.consoleErrors });
  report.phase = 'close-browser';
  await closeBrowser();
  report.status = 'passed';
  report.phase = 'complete';
  saveReport();
  console.log(JSON.stringify({ report: reportPath, status: report.status, effectiveRoute: report.effectiveRoute, effectiveSolver: report.effectiveSolver, captures: Object.keys(report.captures) }, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = { phase: report.phase, message: error.message, stack: error.stack };
  await closeBrowser().catch(closeError => { report.closeError = closeError.message; });
  saveReport();
  console.error(`browser smoke failed during ${report.phase}: ${error.stack || error.message}`);
  console.error(`durable report: ${reportPath}`);
  process.exitCode = 1;
}
