import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'fixture', 'chrome', 'report', 'expected-commit', 'receiver'].map(name => [name, { type: 'string' }])) });
for (const name of ['repo-root', 'fixture', 'chrome', 'report', 'expected-commit', 'receiver']) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const root = await fs.realpath(values['repo-root']);
const fixture = await fs.realpath(values.fixture);
const output = path.resolve(values.report);
const evidenceRoot = path.join(path.dirname(output), 'raw');
const report = { schema: 'trellis2.sparse-prefix-browser.v0', status: 'failed', phase: 'source-identity',
  receiver: values.receiver, terminalEvidence: output,
  repoRoot: root, command: process.argv, expectedCommit: values['expected-commit'], servedSources: {} };
const persist = async () => { await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
let server, child, cdp, profile;

// Built-in CDP client: no dependency on an operator Chrome profile or GUI app.
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map();
  let nextId = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.id) {
      const entry = pending.get(row.id); pending.delete(row.id);
      if (row.error) entry?.reject(new Error(JSON.stringify(row.error))); else entry?.resolve(row.result);
    } else {
      const key = `${row.sessionId || ''}:${row.method}`;
      for (const resolve of listeners.get(key) || []) resolve(row.params);
      listeners.delete(key);
    }
  });
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) entry.reject(new Error('browser CDP connection closed'));
  });
  return {
    call(method, params = {}, sessionId) { return new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    }); },
    once(method, sessionId) { return new Promise(resolve => {
      const key = `${sessionId || ''}:${method}`;
      listeners.set(key, [...(listeners.get(key) || []), resolve]);
    }); },
    close() { socket.close(); },
  };
}

try {
  await persist();
  report.commit = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--porcelain']);
  if (report.commit !== report.expectedCommit || report.dirty) throw new Error('source revision must be the exact clean requested commit');
  report.fixtureSha256 = digest(await fs.readFile(path.join(fixture, 'manifest.json')));
  report.chrome = await fs.realpath(values.chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(report.chrome)) throw new Error('GUI Google Chrome is not an isolated headless executable');
  await fs.mkdir(evidenceRoot, { recursive: true });
  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (req.method === 'POST' && /^\/output\/(projected|modulation)$/.test(pathname)) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), name = pathname.split('/').at(-1);
        const target = path.join(evidenceRoot, `${name}.f32`);
        await fs.writeFile(target, bytes);
        report.rawOutputs ||= {}; report.rawOutputs[name] = { path: target, byteLength: bytes.length, sha256: digest(bytes) };
        res.end('saved'); return;
      }
      if (pathname === '/') { res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>TRELLIS sparse prefix numerical witness</title>'); return; }
      const isFixture = pathname.startsWith('/fixture/');
      const base = isFixture ? fixture : root;
      const file = path.resolve(base, `.${isFixture ? pathname.slice(8) : pathname}`);
      if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      const bytes = await fs.readFile(file);
      if (!isFixture && /\.m?js$/.test(file)) {
        const relative = path.relative(root, file);
        const admitted = execFileSync('git', ['show', `${report.commit}:${relative}`], { cwd: root });
        if (digest(bytes) !== digest(admitted)) throw new Error(`served source mismatch: ${relative}`);
        report.servedSources[relative] = digest(bytes);
      }
      res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' :
        file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
    } catch (error) { report.serverErrors ||= []; report.serverErrors.push(error.message); res.writeHead(500).end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;
  report.phase = 'browser-launch'; await persist();
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-sparse-chrome-'));
  report.profilePath = profile;
  child = spawn(report.chrome, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', bytes => { stderr += bytes.toString(); report.browserStderr = stderr;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) resolve(match[1]); });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`browser exited before CDP: ${code}/${signal}`)));
  });
  cdp = await connect(wsUrl);
  report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  await cdp.call('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await cdp.call('Page.navigate', { url: report.requestedUrl }, sessionId);
  await loaded;
  report.phase = 'native-prefix-execution'; await persist();
  const result = await cdp.call('Runtime.evaluate', { expression: `(async () => {
    const { runSparsePrefixWitness } = await import('/models/trellis2/sparse-prefix-witness.js');
    return { url: location.href, result: await runSparsePrefixWitness(${JSON.stringify(report.fixtureSha256)}) };
  })()`, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  const value = result.result.value;
  report.effectiveUrl = value.url; report.result = value.result;
  if (value.url !== report.requestedUrl) throw new Error('effective browser URL differs from requested route');
  if (value.result.status !== 'succeeded') throw new Error(value.result.error?.message || 'browser witness failed');
  if (report.serverErrors?.length) throw new Error(report.serverErrors.join('\n'));
  for (const name of ['projected', 'modulation']) {
    if (!report.rawOutputs?.[name] || report.rawOutputs[name].sha256 !== value.result.outputs?.[name]?.sha256) {
      throw new Error(`missing or mismatched raw evidence: ${name}`);
    }
  }
  report.status = 'succeeded'; report.phase = null;
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  if (cdp) { try { await cdp.call('Browser.close'); } catch {} cdp.close(); }
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (server) await new Promise(resolve => server.close(resolve));
  // Only ephemeral state from the exact owned browser profile is removed.
  if (profile) await fs.rm(profile, { recursive: true, force: true });
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, report: output,
    comparisons: Object.fromEntries(Object.entries(report.result?.outputs || {}).map(([name, row]) => [name, row.comparison])),
    error: report.error?.message }));
}
