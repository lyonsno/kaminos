// Run one SuperMat stage witness in an independent headless Chrome for Testing.
// Writes a terminal report on every path; served JS must match the exact
// requested clean commit; fixture and weight roots are digest-bound.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const STAGES = ['vae-encoder', 'vae-decoder', 'unet', 'full'];
const { values } = parseArgs({ options: Object.fromEntries(
  ['repo-root', 'expected-commit', 'fixture', 'weights', 'chrome', 'report', 'stage', 'receiver']
    .map(name => [name, { type: 'string' }])) });
const output = path.resolve(values.report ?? 'supermat-witness-report.json');
const rawRoot = path.join(path.dirname(output), 'raw');
const report = { schema: 'supermat.stage-witness.runner.v0', status: 'failed', phase: 'arguments',
  receiver: values.receiver ?? null, terminalEvidence: output, command: process.argv,
  requested: { repoRoot: values['repo-root'], fixture: values.fixture, weights: values.weights,
    stage: values.stage, expectedCommit: values['expected-commit'], chrome: values.chrome },
  servedSources: {}, rawOutputs: {} };
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let server, child, profile, socket;

async function cdpConnect(url) {
  const ws = new WebSocket(url), pending = new Map();
  let next = 0, failure = null;
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP connection error')), { once: true });
  });
  const fail = message => {
    failure ??= new Error(message);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
  };
  ws.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (!row.id) return;
    const entry = pending.get(row.id);
    pending.delete(row.id);
    if (row.error) entry?.reject(new Error(JSON.stringify(row.error))); else entry?.resolve(row.result);
  });
  ws.addEventListener('close', () => fail('CDP connection closed'));
  return {
    socket: ws,
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (failure) { reject(failure); return; }
        const id = ++next;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

try {
  await persist();
  for (const name of ['repo-root', 'expected-commit', 'fixture', 'weights', 'chrome', 'report', 'stage', 'receiver']) {
    if (!values[name]) throw new Error(`--${name} is required`);
  }
  if (!STAGES.includes(values.stage)) throw new Error(`--stage must be one of ${STAGES.join(', ')}`);

  report.phase = 'source-identity';
  const root = await fs.realpath(values['repo-root']);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  report.repoRoot = root;
  report.commit = git(['rev-parse', 'HEAD']);
  report.dirty = git(['status', '--porcelain', '--', 'models/supermat', 'webgpu-inference-kit/src']);
  if (report.commit !== values['expected-commit'] || report.dirty) {
    throw new Error('served sources must come from the exact clean requested commit');
  }

  report.phase = 'fixture-admission';
  const fixture = await fs.realpath(values.fixture);
  const fixtureManifest = await fs.readFile(path.join(fixture, 'manifest.json'));
  report.fixture = { root: fixture, manifestSha256: digest(fixtureManifest) };
  if (JSON.parse(fixtureManifest).status !== 'succeeded') throw new Error('fixture manifest is not a succeeded reference');
  const weights = await fs.realpath(values.weights);
  const weightManifest = await fs.readFile(path.join(weights, 'package.json'));
  report.weights = { root: weights, packageSha256: digest(weightManifest) };
  if (JSON.parse(weightManifest).status !== 'succeeded') throw new Error('weight package is not a succeeded pack');

  report.phase = 'browser-admission';
  report.chrome = await fs.realpath(values.chrome);
  if (/\/Applications\/Google Chrome\.app\//.test(report.chrome)) throw new Error('GUI Google Chrome is not an isolated headless executable');
  await fs.mkdir(rawRoot, { recursive: true });

  server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (req.method === 'POST' && /^\/output\/[\w.#-]+$/.test(pathname)) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks), name = pathname.slice('/output/'.length);
        const target = path.join(rawRoot, `${name}.f32`);
        await fs.writeFile(target, bytes);
        report.rawOutputs[name] = { path: target, byteLength: bytes.length, sha256: digest(bytes) };
        res.end('saved');
        return;
      }
      if (pathname === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><title>SuperMat stage witness</title>');
        return;
      }
      const [base, relative] = pathname.startsWith('/fixture/') ? [fixture, pathname.slice(9)]
        : pathname.startsWith('/weights/') ? [weights, pathname.slice(9)] : [root, pathname.slice(1)];
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
      if (base === root) {
        if (!/\.m?js$/.test(file)) { res.writeHead(404).end(); return; }
        const repoRelative = path.relative(root, file);
        const admitted = execFileSync('git', ['show', `${report.commit}:${repoRelative}`], { cwd: root });
        const bytes = await fs.readFile(file);
        if (digest(bytes) !== digest(admitted)) throw new Error(`served source mismatch: ${repoRelative}`);
        report.servedSources[repoRelative] = digest(bytes);
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(bytes);
        return;
      }
      const stat = await fs.stat(file);
      res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Cache-Control', 'no-store');
      (await fs.open(file)).createReadStream().pipe(res);
    } catch (error) {
      report.serverErrors ??= [];
      report.serverErrors.push(error.message);
      res.writeHead(500).end(error.message);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.requestedUrl = `http://127.0.0.1:${server.address().port}/`;

  report.phase = 'browser-launch';
  await persist();
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'supermat-witness-chrome-'));
  child = spawn(report.chrome, ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0',
    '--use-mock-keychain', '--password-store=basic', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  report.ownedBrowserPid = child.pid;
  child.once('exit', (code, signal) => { report.ownedBrowserExit = { code, signal, at: new Date().toISOString() }; });
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', bytes => {
      stderr += bytes.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`browser exited before CDP: ${code}/${signal}`)));
  });
  const cdp = await cdpConnect(wsUrl);
  socket = cdp.socket;
  report.browserVersion = await cdp.call('Browser.getVersion');
  const { targetId } = await cdp.call('Target.createTarget', { url: report.requestedUrl });
  const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
  for (let attempt = 0; ; attempt++) {
    const state = await cdp.call('Runtime.evaluate', { expression: '[location.href, document.readyState]', returnByValue: true }, sessionId);
    const [href, readyState] = state.result.value ?? [];
    if (href === report.requestedUrl && readyState === 'complete') break;
    if (attempt > 200) throw new Error(`witness page did not load: ${href} ${readyState}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  report.phase = `native-${values.stage}-witness`;
  await persist();
  const started = Date.now();
  const evaluation = await cdp.call('Runtime.evaluate', {
    expression: `import('/models/supermat/supermat-witness.js').then(m => m.runSuperMatWitness(${JSON.stringify({
      stage: values.stage, fixtureSha256: report.fixture.manifestSha256, weightsSha256: report.weights.packageSha256 })}))`,
    awaitPromise: true, returnByValue: true,
  }, sessionId);
  report.wallMs = Date.now() - started;
  if (evaluation.exceptionDetails) throw new Error(`browser exception: ${JSON.stringify(evaluation.exceptionDetails)}`);
  report.browserResult = evaluation.result.value;
  report.effectiveRoute = { backend: 'webgpu-local', browser: report.browserVersion?.product,
    adapter: report.browserResult?.adapter ?? null };
  report.phase = 'complete';
  report.status = report.browserResult?.status === 'passed' ? 'passed' : (report.browserResult?.status ?? 'failed');
} catch (error) {
  report.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  server?.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error ?? null, report: output }));
}
