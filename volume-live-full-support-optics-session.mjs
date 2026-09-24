#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const sourceCaptureReportPath = requiredPath('--source-capture-report');
const port = normalizePort(args.get('--port') || 18790);
const requestedSource = String(args.get('--source') || 'analytical-exact');
assert.ok(['analytical-exact', 'learned-baseline', 'learned-flow'].includes(requestedSource), `unsupported --source: ${requestedSource}`);
assert.equal(requestedSource, 'analytical-exact', 'direct live producer currently supports analytical-exact only');

const sourceCaptureReport = readJson(sourceCaptureReportPath);
const mountSlug = `live-full-support-optics-${port}`;
const mountRoot = join(repoRoot, 'scratch', mountSlug);
mkdirSync(mountRoot, { recursive: true });
const mounts = {};

const origin = `http://127.0.0.1:${port}`;
const requestedRoute = new URL(sourceCaptureReport.requestedRoute);
const route = new URL(`${requestedRoute.pathname}${requestedRoute.search}`, origin);
for (const parameter of [...route.searchParams.keys()]) {
  if (parameter.startsWith('full_support_')) route.searchParams.delete(parameter);
}
route.searchParams.set('kaminos_volume_smoke', '1');
route.searchParams.set('composition', 'splat-only-v0');
route.searchParams.set('volume_raymarch_smoke', 'off');
route.searchParams.set('full_support_live_step', '120');
route.searchParams.set('full_support_source', requestedSource);

const routeReceipt = {
  schema: 'kaminos.pyro.live-full-support-optics-session.v0',
  status: 'starting',
  authority: 'live-simulator-exact-step-v0',
  evidenceAuthority: 'operator-exploration-only',
  requestedRoute: sourceCaptureReport.requestedRoute,
  effectiveRoute: route.href,
  requestedSource,
  requestedSimStepCount: 120,
  sourceFieldImportApplied: false,
  stageBMediaBootstrapApplied: false,
  repoRoot,
  port,
  mounts,
  artifacts: {
    sourceCaptureReport: artifact(sourceCaptureReportPath),
  },
};
const receiptPath = join(mountRoot, 'route-receipt.json');
writeFileSync(receiptPath, `${JSON.stringify(routeReceipt, null, 2)}\n`);

const serverArgs = [join(repoRoot, 'serve.py'), String(port)];
const settingsStore = args.get('--volume-settings-store');
if (settingsStore) serverArgs.push('--volume-settings-store', resolve(String(settingsStore)));
const server = spawn('python3', serverArgs, { cwd: repoRoot, stdio: 'inherit' });
server.once('exit', code => {
  if (code !== 0) process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));

await waitForServer(origin, server);
routeReceipt.status = 'serving';
routeReceipt.receiptPath = relative(repoRoot, receiptPath);
writeFileSync(receiptPath, `${JSON.stringify(routeReceipt, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, url: route.href, routeReceipt: receiptPath, serverPid: server.pid }, null, 2));
await new Promise(resolveExit => server.once('exit', resolveExit));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function requiredPath(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  const path = resolve(String(value));
  if (!existsSync(path)) throw new Error(`missing ${name} file: ${path}`);
  return path;
}

function normalizePort(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1024 || normalized > 65535) throw new Error(`invalid --port: ${value}`);
  return normalized;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function artifact(path) {
  const bytes = readFileSync(path);
  return { path, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function waitForServer(origin, child) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 15_000) {
    if (child.exitCode !== null) throw new Error(`serve.py exited before route admission: ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/volume-selective-head-live.html`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {}
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  child.kill('SIGTERM');
  throw new Error(`serve.py did not admit route at ${origin}`);
}
