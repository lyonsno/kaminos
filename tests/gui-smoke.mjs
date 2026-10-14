// kaminos-test: browser — loads the authoring page in a headless Chrome for Testing
// GUI smoke: serve the repository, load index.html in a headless Chrome for
// Testing over the DevTools protocol, add two meshes, select the first Scene
// Objects row, open every sidebar tab, and fail on any uncaught exception or
// console error that is not allowlisted below with its reason.
//
// The browser comes only from KAMINOS_CHROME (tools/test-runner.mjs sets it
// from KAMINOS_BROWSER). There is no fallback: the installed Google Chrome is
// never launched. A receipt is written under the OS temp directory on every
// outcome, naming the failure phase when there is one.
import { spawn } from 'node:child_process';
import { existsSync, accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'kaminos.gui-smoke.v1';

// Errors the page raises on main today that are not this smoke's to fix. Each
// entry needs a reason; an entry that matches nothing is reported as unused.
const ALLOWED = [
  {
    id: 'tint-swizzle-lowering-chrome-153',
    reason: "Chrome for Testing 153's WebGPU shader compiler (Tint, Metal backend) fails to lower some three.js fragment shaders ('swizzle view instruction still has usages after lowering'); every later 'invalid due to a previous error' message is that same failure cascading. A browser compiler defect, not page code",
    // Only for that browser: 155 compiles these shaders, so on any other
    // version the same messages are unexpected.
    matches: (e, { browserVersion }) => /^Chrome\/153\./.test(browserVersion || '')
      && (/swizzle view instruction still has usages after lowering/.test(e.text || '')
        || (/GPUValidationError/.test(e.text || '') && /is invalid due to a previous error/.test(e.text || ''))),
  },
  {
    id: 'greenroom-root-missing-404',
    reason: "on load the Greenroom panel lists <greenroom root>/done through /api/browse; on a machine without a GPU Greenroom state directory (a CI runner) that answers 404, and the panel shows an empty list",
    matches: e => e.source === 'log.network' && /\b404\b/.test(e.text || '') && /\/api\/browse\?root=greenroom&path=/.test(e.url || ''),
  },
  {
    id: 'juice-frame-lerms-preview-404',
    reason: 'the Juice tab frame requests machine-local LERMS preview packets through /api/read?root=lerms-preview; they do not exist on a clean checkout or a CI runner, and the frame continues without them',
    matches: e => e.source === 'log.network' && /\b404\b/.test(e.text || '') && /\/api\/read\?root=lerms-preview&/.test(e.url || ''),
  },
];

const startedAt = Date.now();
const receiptPath = path.join(os.tmpdir(), `kaminos-gui-smoke-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`);
const receipt = {
  schema: SCHEMA, ok: false, failurePhase: null, error: null,
  startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationMs: null,
  executable: process.env.KAMINOS_CHROME || null, browserVersion: null,
  python: null, server: null, url: null,
  steps: [], tabs: [], meshesAdded: 0, selectedObjectId: null,
  counts: { exceptions: 0, consoleErrors: 0, allowed: 0, unexpected: 0 },
  errors: [], allowed: [], unexpected: [], unusedAllowlist: [],
};
let phase = 'setup';
let server = null;
let browser = null;
let userDataDir = null;
let ws = null;
let serverLog = '';

const delay = ms => new Promise(r => setTimeout(r, ms));
const step = (name, detail = {}) => receipt.steps.push({ name, atMs: Date.now() - startedAt, ...detail });

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(what, fn, timeoutMs, intervalMs = 100) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (error) { last = error; }
    await delay(intervalMs);
  }
  throw new Error(`${what} within ${timeoutMs} ms${last ? ` (last error: ${last.message})` : ''}`);
}

function stopGroup(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(r => child.once('exit', r));
  stopGroup(child, 'SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(3000).then(() => false)])) return;
  stopGroup(child, 'SIGKILL');
  await Promise.race([exited, delay(2000)]);
}

// --- DevTools protocol over Node's WebSocket ------------------------------
const pending = new Map();
const listeners = [];
let nextId = 0;
function send(method, params = {}, timeoutMs = 60000) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method}: no DevTools answer within ${timeoutMs} ms`)); }, timeoutMs);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }, method });
  });
}
async function evaluate(expression, timeoutMs = 60000) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

function record(kind, entry) {
  const e = { kind, phase, atMs: Date.now() - startedAt, ...entry };
  receipt.errors.push(e);
  if (kind === 'exception') receipt.counts.exceptions += 1; else receipt.counts.consoleErrors += 1;
}

function onEvent({ method, params }) {
  if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails || {};
    record('exception', { text: d.exception?.description || d.text, url: d.url || null, line: d.lineNumber ?? null, column: d.columnNumber ?? null });
  } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
    const text = (params.args || []).map(a => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' ');
    const frame = params.stackTrace?.callFrames?.[0];
    record('console', { source: `console.${params.type}`, text, url: frame?.url || null, line: frame?.lineNumber ?? null });
  } else if (method === 'Log.entryAdded' && params.entry?.level === 'error') {
    const { entry } = params;
    record('console', { source: `log.${entry.source}`, text: entry.text, url: entry.url || null, line: entry.lineNumber ?? null });
  }
  if (method === 'Page.javascriptDialogOpening') {
    // A dialog blocks the page and every later DevTools evaluation; record it
    // as a page error and dismiss it so the run can report.
    record('dialog', { source: `dialog.${params.type}`, text: params.message, url: params.url || null });
    send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  }
  for (const l of listeners) l(method, params);
}

async function main() {
  phase = 'browser-executable';
  const chrome = process.env.KAMINOS_CHROME;
  if (!chrome) throw new Error('KAMINOS_CHROME is not set. Point it at a Chrome for Testing executable (the runner sets it from KAMINOS_BROWSER); the installed Google Chrome is never used.');
  if (/\/Applications\/Google Chrome\.app\//.test(chrome)) throw new Error(`KAMINOS_CHROME names the installed Google Chrome (${chrome}); use a Chrome for Testing executable`);
  accessSync(chrome, constants.X_OK);

  phase = 'server';
  const venvPython = path.join(root, '.venv', 'bin', 'python3');
  const python = existsSync(venvPython) ? venvPython : 'python3';
  const port = await freePort();
  receipt.python = python;
  receipt.server = { port, command: [python, '-u', 'serve.py', String(port)], bindHost: '127.0.0.1', logTail: null };
  server = spawn(python, ['-u', 'serve.py', String(port)], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, KAMINOS_BIND_HOST: '127.0.0.1' } });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  const base = `http://127.0.0.1:${port}`;
  await waitFor('serve.py answered /api/runtime-config', async () => {
    if (server.exitCode !== null) throw new Error(`serve.py exited ${server.exitCode}: ${serverLog.slice(-800)}`);
    return (await fetch(`${base}/api/runtime-config`, { signal: AbortSignal.timeout(1000) })).ok;
  }, 20000, 200);
  step('server-up');

  phase = 'browser-launch';
  userDataDir = mkdtempSync(path.join(os.tmpdir(), 'kaminos-gui-smoke-profile-'));
  browser = spawn(chrome, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1400,1000', 'about:blank'], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let browserStderr = '';
  browser.stderr.on('data', d => { browserStderr = (browserStderr + d).slice(-4000); });
  const activePort = await waitFor('the browser wrote DevToolsActivePort', () => {
    if (browser.exitCode !== null) throw new Error(`browser exited ${browser.exitCode}: ${browserStderr.slice(-800)}`);
    const file = path.join(userDataDir, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  }, 30000);
  const version = await (await fetch(`http://127.0.0.1:${activePort}/json/version`)).json();
  receipt.browserVersion = version.Browser;
  const targets = await (await fetch(`http://127.0.0.1:${activePort}/json/list`)).json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) throw new Error('the browser has no page target');
  ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools WebSocket did not open')); });
  ws.onmessage = event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
    } else if (msg.method) onEvent(msg);
  };
  await Promise.all([send('Runtime.enable'), send('Log.enable'), send('Page.enable')]);
  step('browser-up', { browserVersion: receipt.browserVersion });

  phase = 'load';
  receipt.url = `${base}/index.html`;
  const loaded = new Promise(resolve => listeners.push(m => { if (m === 'Page.loadEventFired') resolve(); }));
  await send('Page.navigate', { url: receipt.url });
  await Promise.race([loaded, delay(60000).then(() => { throw new Error('index.html did not fire load within 60 s'); })]);
  step('load-event');
  await waitFor('window.kaminosSceneAuthoring appeared', () => evaluate('typeof window.kaminosSceneAuthoring?.addMesh === "function"'), 60000, 200);
  step('authoring-api');

  phase = 'add-meshes';
  for (let i = 0; i < 2; i += 1) {
    await evaluate(`Promise.resolve(window.kaminosSceneAuthoring.addMesh('box')).then(() => true)`, 30000);
    receipt.meshesAdded += 1;
  }
  const rows = await waitFor('two mesh rows rendered in Scene Objects', () => evaluate(`(() => {
    const ids = [...document.querySelectorAll('#scene-object-list [data-scene-object-id]')].map(r => r.dataset.sceneObjectId);
    const objects = window.kaminosSceneAuthoring.read().objects || [];
    return ids.length >= 2 ? { ids, objects: objects.length } : null;
  })()`), 10000);
  step('meshes-added', rows);

  phase = 'select-row';
  const firstId = rows.ids[0];
  await evaluate(`document.querySelector('#scene-object-list [data-scene-object-id]').click(), true`);
  receipt.selectedObjectId = await waitFor('the first Scene Objects row became active', () => evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(`#scene-object-list [data-scene-object-id="${firstId}"]`)});
    return row && row.classList.contains('active') ? row.dataset.sceneObjectId : null;
  })()`), 5000);
  step('row-selected', { id: receipt.selectedObjectId });

  phase = 'tabs';
  const tabs = await evaluate(`[...document.querySelectorAll('.tab[data-tab]')].map(t => t.dataset.tab)`);
  if (!tabs.length) throw new Error('no .tab[data-tab] elements on the page');
  for (const tab of tabs) {
    phase = `tab:${tab}`;
    const before = receipt.errors.length;
    const tabStarted = Date.now();
    // Opening a tab can hold the page's main thread for many seconds (the
    // Juice frame does); the next evaluation waits for it, bounded at 120 s.
    await evaluate(`document.querySelector(${JSON.stringify(`.tab[data-tab="${tab}"]`)}).click(), true`, 120000);
    const active = await waitFor(`tab ${tab} became active`, () => evaluate(`document.querySelector(${JSON.stringify(`.tab[data-tab="${tab}"]`)}).classList.contains('active')`, 120000), 120000);
    await delay(400);
    receipt.tabs.push({ tab, active, ms: Date.now() - tabStarted, errors: receipt.errors.length - before });
  }
  step('tabs-visited', { count: tabs.length });

  phase = 'settle';
  await delay(1000);
  phase = 'verdict';
}

async function cleanup() {
  try { ws?.close(); } catch {}
  await stopChild(browser);
  await stopChild(server);
  if (userDataDir) { try { rmSync(userDataDir, { recursive: true, force: true }); } catch {} }
  if (server) { receipt.server.exitCode = server.exitCode ?? server.signalCode; receipt.server.logTail = serverLog.slice(-4000); }
}

let failure = null;
try { await main(); } catch (error) { failure = error; }
await cleanup();

for (const e of receipt.errors) {
  const rule = ALLOWED.find(a => a.matches(e, { browserVersion: receipt.browserVersion }));
  if (rule) receipt.allowed.push({ ...e, allowlist: rule.id, reason: rule.reason });
  else receipt.unexpected.push(e);
}
receipt.unusedAllowlist = ALLOWED.filter(a => !receipt.allowed.some(e => e.allowlist === a.id)).map(a => a.id);
receipt.counts.allowed = receipt.allowed.length;
receipt.counts.unexpected = receipt.unexpected.length;
if (failure) { receipt.failurePhase = phase; receipt.error = String(failure?.stack || failure); }
else if (receipt.unexpected.length) { receipt.failurePhase = 'verdict'; receipt.error = `${receipt.unexpected.length} unexpected page error(s)`; }
receipt.ok = !failure && receipt.unexpected.length === 0;
receipt.finishedAt = new Date().toISOString();
receipt.durationMs = Date.now() - startedAt;
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

for (const e of receipt.unexpected) console.error(`page error [${e.kind}${e.source ? ` ${e.source}` : ''}] during ${e.phase}: ${e.text}${e.url ? ` (${e.url}${e.line != null ? `:${e.line + 1}` : ''})` : ''}`);
for (const e of receipt.allowed) console.log(`allowed [${e.allowlist}]: ${e.text}`);
if (!failure && receipt.unusedAllowlist.length) console.log(`allowlist entries that matched nothing (remove them once fixed): ${receipt.unusedAllowlist.join(', ')}`);
console.log(`gui smoke receipt: ${receiptPath}`);
if (failure) {
  console.error(`FAIL gui smoke in phase ${receipt.failurePhase}: ${failure.message}`);
  process.exit(1);
}
if (!receipt.ok) {
  console.error(`FAIL gui smoke: ${receipt.unexpected.length} unexpected page error(s)`);
  process.exit(1);
}
console.log(`PASS gui smoke: ${receipt.meshesAdded} meshes, row ${receipt.selectedObjectId} selected, ${receipt.tabs.length} tabs, ${receipt.counts.allowed} allowed error(s), ${receipt.durationMs} ms, ${receipt.browserVersion}`);
process.exit(0);
