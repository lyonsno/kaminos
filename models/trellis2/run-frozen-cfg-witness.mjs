// Offline replay of the serving sampler and runtime on recorded model predictions.
// Browser launch/reporting follows the reviewed frozen-STD witness.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { CFG_OUTPUTS, compareFrozenCfgArray } from './frozen-cfg-witness.js';

// Recover the output destination before strict parsing so malformed arguments
// cannot leave an earlier successful observation at this invocation's path.
const rawArgs = process.argv.slice(2);
const outputArg = rawArgs.flatMap((arg, i) => arg.startsWith('--output=') ? [arg.slice(9)]
  : arg === '--output' && rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--') ? [rawArgs[i + 1]] : []).at(-1);
if (!outputArg) throw Error('--output required');
const output = path.resolve(outputArg), report = { status: 'failed', phase: 'admission', rows: [], command: process.argv };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const persist = async () => { await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); };
let server, child, cdp;
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map(); let id = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(Error('CDP connection failed')), { once: true });
    socket.addEventListener('close', () => reject(Error('CDP closed before open')), { once: true });
  });
  socket.addEventListener('message', event => {
    const r = JSON.parse(event.data), p = pending.get(r.id);
    if (!r.id) { const key = `${r.sessionId}:${r.method}`; listeners.get(key)?.resolve(r.params); listeners.delete(key); return; }
    if (!p) return;
    pending.delete(r.id); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
  });
  const fail = () => { for (const p of [...pending.values(), ...listeners.values()]) p.reject(Error('CDP closed')); pending.clear(); listeners.clear(); };
  socket.addEventListener('close', fail); socket.addEventListener('error', fail);
  return { close: () => socket.close(), event(method, sessionId) { return new Promise((resolve, reject) => listeners.set(`${sessionId}:${method}`, { resolve, reject })); }, call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) })); });
  } };
}
try {
  await persist();
  const { values: args } = parseArgs({ options: Object.fromEntries(
    ['repo-root', 'fixture', 'output', 'chrome', 'expected-commit'].map(k => [k, { type: 'string' }])) });
  for (const name of ['repo-root', 'fixture', 'chrome', 'expected-commit']) if (!args[name]) throw Error(`--${name} required`);
  const root = await fs.realpath(args['repo-root']), fixture = await fs.realpath(args.fixture);
  if (await fs.realpath(new URL('../..', import.meta.url)) !== root) throw Error('invoked source root mismatch');
  report.repoRoot = root; report.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (report.commit !== args['expected-commit']) throw Error('source commit changed');
  report.sourceSha256 = {};
  for (const file of ['models/trellis2/sparse-sampler.js', 'models/trellis2/run-frozen-cfg-witness.mjs', 'models/trellis2/frozen-cfg-witness.js']) {
    const bytes = await fs.readFile(path.join(root, file)); report.sourceSha256[file] = sha(bytes);
    if (sha(execFileSync('git', ['show', `${report.commit}:${file}`], { cwd: root })) !== sha(bytes)) throw Error(`uncommitted source: ${file}`);
  }
  const manifestBytes = await fs.readFile(path.join(fixture, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  report.fixtureSha256 = sha(manifestBytes); report.fixture = manifest;
  if (manifest.kind !== 'observed-kiln-cfg-step' || !Number.isSafeInteger(manifest.config?.tokenRows) ||
    manifest.config.tokenRows < 1 || !Number.isSafeInteger(manifest.stepIndex)) throw Error('observed complete CFG step required');
  const files = new Map(), expected = {};
  for (const name of ['sample', ...CFG_OUTPUTS]) {
    const d = manifest.tensors[name];
    if (!d || !/^[\w.-]+$/.test(d.file)) throw Error('missing/unsafe fixture tensor ' + name);
    const bytes = await fs.readFile(path.join(fixture, d.file));
    const size = name === 'stds' ? 8 : manifest.config.tokenRows * 32 * 4;
    if (bytes.length !== size || bytes.length !== d.bytes || sha(bytes) !== d.sha256) throw Error('changed/partial frozen tensor ' + name);
    files.set('/' + d.file, bytes);
    expected[name] = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  report.servedSources = {};
  report.chrome = await fs.realpath(args.chrome);
  if (!/Google Chrome for Testing|chromium|headless_shell/i.test(report.chrome) || report.chrome.includes('/Applications/Google Chrome.app/')) throw Error('independent browser required');
  server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/') return res.end('<!doctype html><title>Frozen kiln CFG/Euler</title>');
      if (files.has(req.url)) return res.end(files.get(req.url));
      const raw = /^\/output\/([0-2])\/(\w+)\.f32$/.exec(req.url);
      if (req.method === 'POST' && raw && CFG_OUTPUTS.includes(raw[2])) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), descriptor = manifest.tensors[raw[2]];
        if (bytes.length !== descriptor.bytes) throw Error('partial raw observation');
        const dir = path.join(output, 'raw', raw[1]); await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, raw[2] + '.f32'), bytes, { flag: 'wx' });
        return res.end('saved');
      }
      if (req.method === 'GET' && /^\/(models\/trellis2|webgpu-inference-kit\/src)\/[\w/-]+\.(m?js)$/.test(req.url)) {
        const file = req.url.slice(1), bytes = await fs.readFile(path.join(root, file));
        if (sha(execFileSync('git', ['show', `${report.commit}:${file}`], { cwd: root })) !== sha(bytes)) throw Error('uncommitted served source ' + file);
        report.servedSources[file] = sha(bytes); res.setHeader('Content-Type', 'text/javascript'); return res.end(bytes);
      }
      res.writeHead(404).end();
    } catch (error) { report.serverErrors ??= []; report.serverErrors.push(error.message); res.writeHead(500).end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  report.profile = await fs.mkdtemp(path.join(output, 'chrome-profile-'));
  report.phase = 'browser-launch'; await persist();
  child = spawn(report.chrome, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', '--use-mock-keychain', '--password-store=basic', '--no-first-run', `--user-data-dir=${report.profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  const ws = await new Promise((resolve, reject) => {
    let stderr = ''; child.stderr.on('data', b => { stderr += b; report.browserStderr = stderr; const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    child.once('error', reject); child.once('exit', (code, signal) => reject(Error(`browser exited ${code}/${signal}`)));
  });
  cdp = await connect(ws); report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  await cdp.call('Page.enable', {}, sessionId);
  const loaded = cdp.event('Page.loadEventFired', sessionId);
  await cdp.call('Page.navigate', { url: report.requestedUrl }, sessionId); await loaded;
  report.phase = 'native-cfg-euler'; await persist();
  const evaluate = async expression => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  report.effectiveUrl = await evaluate('location.href'); if (report.effectiveUrl !== report.requestedUrl) throw Error('wrong page route');
  for (let trial = 0; trial < 3; trial++) {
    const row = await evaluate(`(async()=>{const m=await import('/models/trellis2/frozen-cfg-witness.js');return m.runFrozenCfgCase(${JSON.stringify(manifest)},${trial});})()`);
    if (row.trial !== trial || row.effectiveRoute !== 'trellis2.observed-kiln-cfg.webgpu.v0' ||
      row.backend?.vendor !== 'apple' || !row.backend.architecture.includes('metal') || row.backend.isFallbackAdapter !== false ||
      Object.keys(row.outputs || {}).length !== CFG_OUTPUTS.length) throw Error('incomplete/wrong frozen route observation');
    row.comparisons = {};
    for (const name of CFG_OUTPUTS) {
      const bytes = await fs.readFile(path.join(output, 'raw', String(trial), name + '.f32'));
      if (sha(bytes) !== row.outputs[name]?.sha256 || bytes.length !== row.outputs[name]?.bytes) throw Error('raw observation disagrees with browser ' + name);
      const actual = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      row.comparisons[name] = compareFrozenCfgArray(actual, expected[name]);
    }
    report.rows.push(row); await persist();
  }
  if (report.serverErrors?.length) throw Error(report.serverErrors.join('; '));
  report.comparison = { repeats: report.rows.length,
    repeatedBitsIdentical: CFG_OUTPUTS.every(name => report.rows.every(row => row.outputs[name].sha256 === report.rows[0].outputs[name].sha256)),
    exact: report.rows.every(row => CFG_OUTPUTS.every(name => row.comparisons[name].exact)) };
  report.status = 'measured'; report.phase = 'complete';
  report.claimLimit = 'Observed sample/predictions through serving CFG/Euler and kit runtime. No model-forward, uninterrupted trajectory or image parity claim.';
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  await persist(); cdp?.close();
  if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  if (child) report.browserExit = { code: child.exitCode, signal: child.signalCode };
  if (server) await new Promise(resolve => server.close(resolve));
  await persist(); console.log(JSON.stringify({ status: report.status, phase: report.phase, comparison: report.comparison, error: report.error?.message, output }));
}
