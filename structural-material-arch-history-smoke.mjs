import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const [urlInput, reportInput, chromeInput, deadlineInput] = process.argv.slice(2);
if (!urlInput || !reportInput || !chromeInput) {
  throw new Error('usage: node structural-material-arch-history-smoke.mjs <local-url> <report.json> <chrome-executable> [deadline-ms]');
}

const root = dirname(fileURLToPath(import.meta.url));
const reportPath = resolve(process.cwd(), reportInput);
mkdirSync(dirname(reportPath), { recursive: true });
const report = {
  schema: 'kaminos.structural-material.arch-history-browser-smoke.v0',
  status: 'running',
  phase: 'preflight',
  requestedUrl: urlInput,
  effectiveRoute: 'not yet observed',
  requestedSolver: 'local browser JavaScript / CPU spring proxy',
  effectiveSolver: 'not yet observed',
  fallback: null,
  deadlineMs: deadlineInput === undefined ? 180000 : Number(deadlineInput),
  lastTrustworthyEvidence: 'arguments recorded; no browser route contacted',
  source: {},
  browser: { executable: resolve(chromeInput) },
  responses: [],
  runtimeExceptions: [],
  consoleErrors: [],
  checks: [],
  captures: {},
};
let child;
let socket;
let profileDirectory;
let exitInfo;
let nextId = 0;
const pending = new Map();

function save() {
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function check(name, condition, observed) {
  report.checks.push({ name, passed: Boolean(condition), observed });
  assert.ok(condition, `browser smoke failed: ${name}; observed ${JSON.stringify(observed)}`);
}

function send(method, params = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const id = ++nextId;
    pending.set(id, { resolvePromise, rejectPromise, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const message = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (message.exceptionDetails) throw new Error(message.exceptionDetails.exception?.description || message.exceptionDetails.text);
  return message.result.value;
}

async function waitForLoaded() {
  const started = Date.now();
  while (Date.now() - started < report.deadlineMs) {
    const state = await evaluate(`(() => ({ready:document.readyState,status:document.querySelector('#status')?.textContent??'',url:location.href}))()`);
    if (state.ready === 'complete' && state.status.startsWith('Loaded exact TRELLIS source')) return state;
    if (state.ready === 'complete' && state.status.startsWith('Startup failed')) throw new Error(state.status);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`page did not load the exact TRELLIS source within ${report.deadlineMs} ms`);
}

async function navigate(url) {
  const result = await send('Page.navigate', { url });
  if (result.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  return waitForLoaded();
}

async function snapshot() {
  return evaluate(`(() => {
    const text = id => document.getElementById(id)?.textContent ?? null;
    return {
      url: location.href,
      status: text('status'),
      force: document.getElementById('force').value,
      camera: window.__archHistoryCamera?.() ?? null,
      intactText: text('intact-readout'),
      damagedText: text('damaged-readout'),
      intactPath: text('intact-history-path'),
      damagedPath: text('damaged-history-path'),
      receipt: window.__archHistoryReceipt?.() ?? {},
      receiptText: text('receipt'),
      buttons: Object.fromEntries(['damage-history','apply','unload','reset'].map(id => [id, document.getElementById(id).disabled])),
      controls: Object.fromEntries(['.force','#damage-history','#apply','#unload','#reset','#status'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }];
      })),
      viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
    };
  })()`);
}

async function capture(name) {
  const state = await snapshot();
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(image.data, 'base64');
  check(`${name}: screenshot is a complete PNG`, bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length > 4096, { bytes: bytes.length });
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  check(`${name}: screenshot matches viewport`, width === state.viewport.width && height === state.viewport.height, { width, height, viewport: state.viewport });
  const path = resolve(dirname(reportPath), `${basename(reportPath, '.json')}-${name}.png`);
  writeFileSync(path, bytes);
  report.captures[name] = {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    width,
    height,
    page: state,
  };
  report.lastTrustworthyEvidence = `${name} capture from ${state.url}`;
  save();
  return state;
}

async function click(id) {
  await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  return snapshot();
}

async function connect(wsUrl) {
  await new Promise((resolvePromise, rejectPromise) => {
    socket = new WebSocket(wsUrl);
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') report.runtimeExceptions.push(message.params.exceptionDetails);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        report.consoleErrors.push(message.params.args.map(argument => argument.value ?? argument.description));
      }
      if (message.method === 'Network.responseReceived') {
        const response = message.params.response;
        if (/\.glb(?:\?|$)|\.json(?:\?|$)/.test(response.url)) report.responses.push({ url: response.url, status: response.status });
      }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.rejectPromise(new Error(`${item.method}: ${message.error.message}`));
      else item.resolvePromise(message.result || {});
    });
  });
}

async function close() {
  if (socket?.readyState === WebSocket.OPEN) {
    await send('Browser.close').catch(() => {});
    socket.close();
  } else if (child && child.exitCode === null) child.kill('SIGTERM');
  if (child && !exitInfo) exitInfo = await new Promise(resolvePromise => child.once('exit', (code, signal) => resolvePromise({ code, signal })));
  report.browser.exit = exitInfo || null;
  if (profileDirectory) rmSync(profileDirectory, { recursive: true, force: true });
}

try {
  const requested = new URL(urlInput);
  check('route is the local arch geometry consumer',
    ['127.0.0.1','localhost'].includes(requested.hostname) && requested.pathname === '/structural-material-arch-geometry.html', requested.href);
  check('deadline is an explicit positive safe integer', Number.isSafeInteger(report.deadlineMs) && report.deadlineMs > 0, report.deadlineMs);
  requested.search = '';
  requested.hash = '';
  report.requestedUrl = requested.href;
  report.phase = 'source-preflight';
  report.source.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.source.dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map(line => line.slice(3));
  report.browser.version = execFileSync(chromeInput, ['--version'], { encoding: 'utf8' }).trim();
  report.browser.deadlineMs = report.deadlineMs;
  save();

  report.phase = 'browser-launch';
  profileDirectory = mkdtempSync(resolve(tmpdir(), 'kaminos-arch-history-smoke-'));
  child = spawn(chromeInput, ['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profileDirectory}`,'about:blank'], { stdio: ['ignore','pipe','pipe'] });
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; });
  report.browser.pid = await new Promise((resolvePromise, rejectPromise) => {
    child.once('spawn', () => resolvePromise(child.pid));
    child.once('error', rejectPromise);
  });
  report.lastTrustworthyEvidence = `Chrome spawned with PID ${child.pid}; waiting for DevToolsActivePort`;
  save();
  const started = Date.now();
  while (!existsSync(resolve(profileDirectory, 'DevToolsActivePort'))) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before DevTools opened (${child.exitCode})`);
    if (Date.now() - started >= report.deadlineMs) throw new Error(`DevToolsActivePort did not appear within ${report.deadlineMs} ms`);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  const [port] = readFileSync(resolve(profileDirectory, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  check('Chrome exposes a page target', Boolean(page), targets.map(target => target.type));
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });

  report.phase = 'initial-load';
  const initial = await navigate(requested.href);
  report.effectiveRoute = new URL(initial.url).origin + new URL(initial.url).pathname;
  report.effectiveSolver = 'local browser JavaScript / shear-regularized linear-spring PCG';
  report.fallback = false;
  check('page route is exact and fallback-free', report.effectiveRoute === requested.href && initial.status.includes('CPU structural proxy'), initial);
  const pre = await capture('initial');
  const history = await click('damage-history');
  check('history construction changes only one connectivity graph', history.receipt.priorDamageEvents === 40 && history.receipt.intact.brokenBondCount === 0 && history.receipt.damaged.brokenBondCount === 40 && history.receipt.damaged.componentCount === 1, history.receipt);
  check('history construction preserves camera', JSON.stringify(pre.camera) === JSON.stringify(history.camera), { before: pre.camera, after: history.camera });
  await capture('history-unloaded');

  report.phase = 'matched-load';
  await evaluate(`(() => { const input=document.getElementById('force'); input.value='0.5'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const applied = await click('apply');
  check('same later force and located contact reach both consumers',
    applied.receipt.force === 0.5 && applied.receipt.intact.force === applied.receipt.damaged.force &&
    applied.receipt.intact.contact.column === applied.receipt.damaged.contact.column &&
    applied.receipt.intact.contact.row === applied.receipt.damaged.contact.row, applied.receipt);
  check('damaged history changes the mesh-consumer response',
    applied.receipt.damaged.maxDisplayedVertexDisplacement !== applied.receipt.intact.maxDisplayedVertexDisplacement, applied.receipt);
  check('matched apply preserves camera', JSON.stringify(history.camera) === JSON.stringify(applied.camera), { before: history.camera, after: applied.camera });
  await capture('matched-load');

  await evaluate(`(() => { const input=document.getElementById('force'); input.value='1.5'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const higherLoad = await click('apply');
  check('later slider force is recorded as a new accepted comparison history',
    higherLoad.receipt.acceptedLoadPath?.length === 2 && higherLoad.receipt.acceptedLoadPath.at(-1).force === 1.5 &&
    higherLoad.intactPath.includes('1.50') && higherLoad.damagedPath.includes('1.50'), higherLoad);
  await capture('evolving-load-path');
  await evaluate(`(() => { const input=document.getElementById('force'); input.value='0.5'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const repeatedLoad = await click('apply');
  check('returning to the same force remains visibly distinct from the original fixed-history frame',
    repeatedLoad.receipt.acceptedLoadPath?.length === 3 && repeatedLoad.receipt.acceptedLoadPath.at(-1).force === 0.5 &&
    repeatedLoad.receipt.acceptedLoadPath.at(-1).intactBrokenBondCount >= applied.receipt.intact.brokenBondCount &&
    repeatedLoad.receipt.acceptedLoadPath.at(-1).damagedBrokenBondCount >= applied.receipt.damaged.brokenBondCount &&
    repeatedLoad.receiptText?.includes('load path:'), repeatedLoad);

  await click('reset');
  const resetHistory = await click('damage-history');
  await evaluate(`(() => { const input=document.getElementById('force'); input.value='0.5'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  const fixedReplay = await click('apply');
  check('reset and replay restores the fixed 0.50 matched-history comparison',
    fixedReplay.receipt.acceptedLoadPath?.length === 1 && fixedReplay.receipt.force === 0.5 &&
    fixedReplay.receipt.damaged.brokenBondCount === 40 && fixedReplay.receipt.intact.brokenBondCount === 0,
    { resetHistory, fixedReplay: fixedReplay.receipt });

  report.phase = 'unload';
  const unloaded = await click('unload');
  check('unload removes visible displacement but retains broken connectivity',
    unloaded.receipt.force === 0 && unloaded.receipt.damaged.maxDisplayedVertexDisplacement === 0 && unloaded.receipt.damaged.brokenBondCount === 40, unloaded.receipt);
  check('unload preserves camera', JSON.stringify(applied.camera) === JSON.stringify(unloaded.camera), { before: applied.camera, after: unloaded.camera });
  await capture('unloaded-history-retained');

  report.phase = 'reset';
  const reset = await click('reset');
  check('reset restores intact and damaged proxies and disables history-only actions',
    reset.status.startsWith('Profiles loaded') && reset.intactText === 'No load applied' && reset.damagedText === 'No load applied' &&
    reset.buttons.apply && reset.buttons.unload && !reset.buttons['damage-history'], reset);
  check('page reports no runtime or console errors', report.runtimeExceptions.length === 0 && report.consoleErrors.length === 0,
    { runtimeExceptions: report.runtimeExceptions, consoleErrors: report.consoleErrors });
  check('source profile and mesh were fetched successfully', report.responses.some(item => item.url.includes('arch-history-surface-depth-profile.json') && item.status === 200) && report.responses.some(item => item.url.endsWith('/output.glb') && item.status === 200), report.responses);

  report.phase = 'mobile-layout';
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  const mobile = await snapshot();
  check('mobile: controls stay within viewport width', mobile.viewport.documentWidth <= mobile.viewport.width, mobile.viewport);
  const mobileControls = Object.entries(mobile.controls);
  for (let left = 0; left < mobileControls.length; left += 1) {
    for (let right = left + 1; right < mobileControls.length; right += 1) {
      const a = mobileControls[left][1];
      const b = mobileControls[right][1];
      const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      check(`mobile: ${mobileControls[left][0]} does not overlap ${mobileControls[right][0]}`, !overlaps, { a, b });
    }
  }
  check('mobile resize does not alter the operator camera', JSON.stringify(unloaded.camera) === JSON.stringify(mobile.camera), { before: unloaded.camera, after: mobile.camera });
  await capture('mobile-layout');
  await close();
  report.status = 'passed';
  report.phase = 'complete';
  report.lastTrustworthyEvidence = `matched-history browser witness completed on ${report.effectiveRoute}`;
  save();
  console.log(JSON.stringify({ status: report.status, route: report.effectiveRoute, captures: Object.keys(report.captures), report: reportPath }, null, 2));
} catch (error) {
  report.status = 'failed';
  report.error = { phase: report.phase, name: error.name || 'Error', message: error.message, stack: error.stack };
  await close().catch(closeError => { report.closeError = closeError.message; });
  save();
  console.error(`arch matched-history browser smoke failed during ${report.phase}: ${error.stack || error.message}`);
  console.error(`durable report: ${reportPath}`);
  process.exitCode = 1;
}
