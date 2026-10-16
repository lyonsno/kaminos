// kaminos-test: browser route — loads the authoring page in a headless Chrome for Testing
// GUI smoke: serve the repository, load index.html in a headless Chrome for
// Testing over the DevTools protocol, add two meshes, select the first Scene
// Objects row, open every sidebar tab, and fail on any uncaught exception or
// console error that is not allowlisted below with its reason.
//
// The browser comes only from KAMINOS_CHROME (tools/test-runner.mjs sets it
// from KAMINOS_BROWSER). There is no fallback, and a path that resolves into
// the installed Google Chrome is refused.
//
// Nothing the run does reaches the operator's stores: serve.py runs with its
// store flags pointing into a temporary run directory, with HOME, the scenes
// directory and the LERMS preview root there too, and without the KAMINOS_*
// and GPU_GREENROOM_DIR variables of the calling environment; the browser gets
// the same HOME and a profile there. The receipt records every path and the
// stores serve.py reports it uses, and the run fails unless they all sit under
// the run directory, which is removed at the end.
//
// The server and the browser stay in this process's group, so a runner that
// kills the test's group on timeout or interrupt stops them too. The receipt,
// under the OS temp directory, is written when the run starts and at every
// phase, so a killed run leaves one naming the phase it reached.
import { spawn } from 'node:child_process';
import { existsSync, accessSync, constants, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
    reason: "on load the Greenroom panel lists <greenroom root>/done through /api/browse; the smoke's serve.py runs with a temporary HOME and no GPU_GREENROOM_DIR, so that root never exists and the listing answers 404 on every run; the panel shows an empty list",
    matches: e => e.source === 'log.network' && /\b404\b/.test(e.text || '') && /\/api\/browse\?root=greenroom&path=/.test(e.url || ''),
  },
  {
    id: 'juice-frame-lerms-preview-404',
    reason: "the Juice tab frame requests LERMS preview packets through /api/read?root=lerms-preview; the smoke points that root at an empty directory, so they answer 404 on every run, and the frame continues without them",
    matches: e => e.source === 'log.network' && /\b404\b/.test(e.text || '') && /\/api\/read\?root=lerms-preview&/.test(e.url || ''),
  },
];

const startedAt = Date.now();
const receiptPath = path.join(os.tmpdir(), `kaminos-gui-smoke-${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}.json`);
const receipt = {
  schema: SCHEMA, ok: false, phase: 'setup', failurePhase: null, error: null,
  startedAt: new Date(startedAt).toISOString(), finishedAt: null, durationMs: null,
  pid: process.pid, executable: process.env.KAMINOS_CHROME || null, executableRealpath: null, browserVersion: null, browserPid: null,
  python: null, server: null, url: null, isolation: null,
  steps: [], tabs: [], rowsBefore: null, meshesAdded: 0, selectedObjectId: null,
  counts: { exceptions: 0, consoleErrors: 0, allowed: 0, unexpected: 0 },
  errors: [], allowed: [], unexpected: [], unusedAllowlist: [],
};
let phase = 'setup';
let server = null;
let browser = null;
let runDir = null;
let ws = null;
let serverLog = '';

const delay = ms => new Promise(r => setTimeout(r, ms));
const step = (name, detail = {}) => { receipt.steps.push({ name, atMs: Date.now() - startedAt, ...detail }); saveReceipt(); };
function saveReceipt() {
  receipt.phase = phase;
  try { writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`); } catch (error) { console.error(`gui smoke: cannot write receipt ${receiptPath}: ${error.message}`); }
}
function setPhase(name) { phase = name; saveReceipt(); }
saveReceipt();
console.log(`gui smoke receipt: ${receiptPath}`);

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

const running = child => child && child.exitCode === null && child.signalCode === null;

async function stopChild(child) {
  if (!running(child)) return;
  const exited = new Promise(r => child.once('exit', r));
  try { child.kill('SIGTERM'); } catch {}
  if (await Promise.race([exited.then(() => true), delay(3000).then(() => false)])) return;
  try { child.kill('SIGKILL'); } catch {}
  await Promise.race([exited, delay(2000)]);
}

// Whether a path lies in the run directory, as given or by its real path.
// Checked without creating anything, so a path that points elsewhere is
// refused before it is touched.
function insideRunDir(target) {
  const resolved = path.resolve(target);
  return [runDir, realpathSync(runDir)].some(base => resolved === base || resolved.startsWith(`${base}${path.sep}`));
}
function assertInside(label, target) {
  if (!insideRunDir(target)) throw new Error(`${label} ${target} is outside the run directory ${runDir}`);
  return target;
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

const INSTALLED_CHROME = /\/Applications\/Google Chrome\.app\//;

async function main() {
  setPhase('browser-executable');
  const chrome = process.env.KAMINOS_CHROME;
  if (!chrome) throw new Error('KAMINOS_CHROME is not set. Point it at a Chrome for Testing executable (the runner sets it from KAMINOS_BROWSER); the installed Google Chrome is never used.');
  let chromeReal;
  // The native real path carries the volume's own spelling, so a link or a
  // differently cased path to the installed app is still recognized.
  try { chromeReal = realpathSync.native(chrome); } catch (error) { throw new Error(`KAMINOS_CHROME=${chrome} cannot be resolved: ${error.message}`); }
  receipt.executableRealpath = chromeReal;
  if (INSTALLED_CHROME.test(chrome) || INSTALLED_CHROME.test(chromeReal)) throw new Error(`KAMINOS_CHROME (${chrome}) resolves to the installed Google Chrome (${chromeReal}); use a Chrome for Testing executable`);
  accessSync(chromeReal, constants.X_OK);

  setPhase('isolation');
  runDir = mkdtempSync(path.join(os.tmpdir(), 'kaminos-gui-smoke-run-'));
  const dirs = {
    home: path.join(runDir, 'home'),
    volumeSettingsStore: path.join(runDir, 'stores', 'volume-settings'),
    volumeBasinSessionStore: path.join(runDir, 'stores', 'volume-basin-sessions'),
    volumeCockpitLayoutStore: path.join(runDir, 'stores', 'volume-cockpit-layouts'),
    scenes: path.join(runDir, 'scenes'),
    lermsPreview: path.join(runDir, 'lerms-preview'),
    browserProfile: path.join(runDir, 'browser-profile'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  // The calling environment's store and root overrides would reach past the
  // flags below, so none of them is passed on.
  const strippedEnv = Object.keys(process.env).filter(key => /^KAMINOS_/.test(key) || key === 'GPU_GREENROOM_DIR').sort();
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !strippedEnv.includes(key)));
  receipt.isolation = { runDir, runDirReal: realpathSync(runDir), ...Object.fromEntries(Object.entries(dirs).map(([key, dir]) => [key, assertInside(key, dir)])),
    strippedEnv, sharedBasinStore: 'disabled (--no-shared-basin-store)', effective: null, removed: false };
  saveReceipt();

  setPhase('server');
  const venvPython = path.join(root, '.venv', 'bin', 'python3');
  const python = existsSync(venvPython) ? venvPython : 'python3';
  const port = await freePort();
  const args = ['-u', 'serve.py', String(port),
    '--volume-settings-store', dirs.volumeSettingsStore,
    '--no-shared-basin-store',
    '--volume-basin-session-store', dirs.volumeBasinSessionStore,
    '--volume-cockpit-layout-store', dirs.volumeCockpitLayoutStore];
  receipt.python = python;
  receipt.server = { port, command: [python, ...args], bindHost: '127.0.0.1', pid: null, logTail: null };
  server = spawn(python, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...baseEnv, HOME: dirs.home, KAMINOS_BIND_HOST: '127.0.0.1', KAMINOS_SCENES_DIR: dirs.scenes, KAMINOS_LERMS_PREVIEW_ROOT: dirs.lermsPreview } });
  receipt.server.pid = server.pid;
  saveReceipt();
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  const base = `http://127.0.0.1:${port}`;
  const runtime = await waitFor('serve.py answered /api/runtime-config', async () => {
    if (server.exitCode !== null) throw new Error(`serve.py exited ${server.exitCode}: ${serverLog.slice(-800)}`);
    const response = await fetch(`${base}/api/runtime-config`, { signal: AbortSignal.timeout(1000) });
    return response.ok && response.json();
  }, 20000, 200);
  // The stores serve.py says it uses, and the writable roots it printed, must
  // all be inside the run directory.
  const printed = Object.fromEntries([...serverLog.matchAll(/^\s+(Greenroom|Splat inbox|Production splats): (.+)$/gm)].map(m => [m[1], m[2].trim()]));
  receipt.isolation.effective = {
    volumeSettingsStore: runtime.volumeSettingsStore, volumeBasinSessionStore: runtime.volumeBasinSessionStore,
    volumeCockpitLayoutStore: runtime.volumeCockpitLayoutStore, sharedBasinStore: runtime.sharedBasinStore, ...printed };
  if (runtime.sharedBasinStore !== null) throw new Error(`serve.py uses a shared basin store (${runtime.sharedBasinStore}) despite --no-shared-basin-store`);
  for (const key of ['volumeSettingsStore', 'volumeBasinSessionStore', 'volumeCockpitLayoutStore']) {
    if (!runtime[key]) throw new Error(`serve.py did not report ${key}`);
    assertInside(`serve.py's ${key}`, runtime[key]);
  }
  for (const [label, dir] of Object.entries(printed)) assertInside(`serve.py's ${label} root`, dir);
  step('server-up', { stores: receipt.isolation.effective });

  setPhase('browser-launch');
  browser = spawn(chromeReal, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--remote-debugging-port=0', `--user-data-dir=${dirs.browserProfile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...baseEnv, HOME: dirs.home } });
  receipt.browserPid = browser.pid;
  saveReceipt();
  let browserStderr = '';
  browser.stderr.on('data', d => { browserStderr = (browserStderr + d).slice(-4000); });
  const activePort = await waitFor('the browser wrote DevToolsActivePort', () => {
    if (browser.exitCode !== null) throw new Error(`browser exited ${browser.exitCode}: ${browserStderr.slice(-800)}`);
    const file = path.join(dirs.browserProfile, 'DevToolsActivePort');
    return existsSync(file) && Number(readFileSync(file, 'utf8').split('\n')[0]);
  }, 30000);
  // Each DevTools request is bounded and retried, so a browser that is slow
  // to answer is waited for and one that never answers fails within a minute.
  const devtools = async route => (await fetch(`http://127.0.0.1:${activePort}${route}`, { signal: AbortSignal.timeout(5000) })).json();
  const version = await waitFor('the browser answered /json/version', () => devtools('/json/version'), 60000, 500);
  receipt.browserVersion = version.Browser;
  const pageTarget = await waitFor('the browser listed a page target', async () => (await devtools('/json/list')).find(t => t.type === 'page'), 60000, 500);
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

  setPhase('load');
  receipt.url = `${base}/index.html`;
  const loaded = new Promise(resolve => listeners.push(m => { if (m === 'Page.loadEventFired') resolve(); }));
  await send('Page.navigate', { url: receipt.url });
  await Promise.race([loaded, delay(60000).then(() => { throw new Error('index.html did not fire load within 60 s'); })]);
  step('load-event');
  await waitFor('window.kaminosSceneAuthoring appeared', () => evaluate('typeof window.kaminosSceneAuthoring?.addMesh === "function"'), 60000, 200);
  step('authoring-api');

  setPhase('add-meshes');
  const rowIds = `[...document.querySelectorAll('#scene-object-list [data-scene-object-id]')].map(r => r.dataset.sceneObjectId)`;
  receipt.rowsBefore = (await evaluate(rowIds)).length;
  for (let i = 0; i < 2; i += 1) {
    await evaluate(`Promise.resolve(window.kaminosSceneAuthoring.addMesh('box')).then(() => true)`, 30000);
    receipt.meshesAdded += 1;
  }
  const rows = await waitFor('two more Scene Objects rows than before', () => evaluate(`(() => {
    const ids = ${rowIds};
    return ids.length >= ${receipt.rowsBefore + 2} ? { ids, objects: (window.kaminosSceneAuthoring.read().objects || []).length } : null;
  })()`), 10000);
  if (rows.ids.length !== receipt.rowsBefore + 2) throw new Error(`expected ${receipt.rowsBefore + 2} Scene Objects rows after adding two meshes to ${receipt.rowsBefore}, found ${rows.ids.length}`);
  step('meshes-added', rows);

  setPhase('select-row');
  const firstId = rows.ids[0];
  await evaluate(`document.querySelector('#scene-object-list [data-scene-object-id]').click(), true`);
  receipt.selectedObjectId = await waitFor('the first Scene Objects row became active', () => evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(`#scene-object-list [data-scene-object-id="${firstId}"]`)});
    return row && row.classList.contains('active') ? row.dataset.sceneObjectId : null;
  })()`), 5000);
  step('row-selected', { id: receipt.selectedObjectId });

  setPhase('tabs');
  const tabs = await evaluate(`[...document.querySelectorAll('.tab[data-tab]')].map(t => t.dataset.tab)`);
  if (!tabs.length) throw new Error('no .tab[data-tab] elements on the page');
  for (const tab of tabs) {
    setPhase(`tab:${tab}`);
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

  setPhase('settle');
  await delay(1000);
  setPhase('verdict');
}

async function cleanup() {
  try { ws?.close(); } catch {}
  await stopChild(browser);
  await stopChild(server);
  if (server) { receipt.server.exitCode = server.exitCode ?? server.signalCode; receipt.server.logTail = serverLog.slice(-4000); }
  if (runDir) { try { rmSync(runDir, { recursive: true, force: true }); receipt.isolation && (receipt.isolation.removed = true); } catch {} }
}

// An interrupt that reaches this process (rather than a kill of the whole
// group) stops both children and records the phase before exiting.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    receipt.failurePhase = phase;
    receipt.error = `interrupted by ${signal}`;
    await cleanup();
    receipt.finishedAt = new Date().toISOString();
    receipt.durationMs = Date.now() - startedAt;
    saveReceipt();
    console.error(`FAIL gui smoke interrupted by ${signal} in phase ${phase}; receipt: ${receiptPath}`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
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
saveReceipt();

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
