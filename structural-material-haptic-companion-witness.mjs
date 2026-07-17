import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const route = 'kaminos.structural-material.native-trackpad-haptics.v0';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function childResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function startListener(executable, args) {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const listening = new Promise((resolve, reject) => {
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`listener emitted invalid startup receipt: ${error.message}`));
      }
    });
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`listener exited before startup receipt (${code}): ${stderr}`)));
  });
  return { child, listening, stderr: () => stderr };
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`HTTP ${response.status} returned non-JSON body: ${error.message}`);
  }
  return {
    statusCode: response.status,
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    body,
  };
}

const output = option('--output', join(tmpdir(), 'kaminos-structural-material-haptic-companion-report.json'));
const port = Number(option('--port', '8397'));
const allowedOrigin = option('--allowed-origin', 'http://127.0.0.1:8395');
const work = await mkdtemp(join(tmpdir(), 'kaminos-native-haptic-witness-'));
const executable = join(work, 'structural-material-haptic-companion');
const report = {
  schema: 'kaminos.structural-material.native-haptic-witness.v0',
  status: 'failed',
  requestedRoute: route,
  effectiveRoute: null,
  failurePhase: 'witness-initialization',
  configuration: { port, allowedOrigin, dryRun: true },
  checks: {},
};
let listener = null;

try {
  const compile = await childResult('swiftc', [
    join(root, 'structural-material-haptic-companion.swift'),
    '-o',
    executable,
  ]);
  report.compile = compile;
  assert.equal(compile.code, 0, `companion compilation failed: ${compile.stderr}`);

  const unsafeBind = await childResult(executable, ['--host', '0.0.0.0', '--dry-run']);
  report.unsafeBind = unsafeBind;
  const unsafeReceipt = JSON.parse(unsafeBind.stderr.trim());
  report.checks.unsafeBindRejected = unsafeBind.code === 2
    && unsafeReceipt.status === 'failed'
    && unsafeReceipt.failurePhase === 'configuration-or-listener-initialization';
  assert.equal(report.checks.unsafeBindRejected, true, 'non-loopback bind must fail with a durable receipt');

  listener = startListener(executable, [
    '--dry-run',
    '--port', String(port),
    '--allowed-origin', allowedOrigin,
  ]);
  const startup = await listener.listening;
  report.startup = startup;
  assert.equal(startup.status, 'listening');
  assert.equal(startup.effectiveRoute, route);
  assert.equal(startup.dryRun, true);

  const endpoint = `http://127.0.0.1:${port}`;
  const impulse = {
    schema: 'kaminos.structural-material.causal-haptic-impulse.v0',
    requestedRoute: 'kaminos.structural-material.causal-haptics.v0',
    effectiveRoute: 'kaminos.structural-material.causal-haptics.v0',
    cause: 'accepted-gpu-connectivity-delta',
    sourceRoute: 'kaminos.structural-material.webgpu-sympathetic-tear.v0',
    eventEpoch: 9,
    newlyBrokenBondCount: 4,
    newlyBrokenDepthBondCount: 2,
    componentCountDelta: 1,
    interactionMagnitude: 1.4,
    intensity: 0.72,
    durationMs: 28,
    pattern: 'separation',
  };
  const browserHeaders = { Origin: allowedOrigin, 'Content-Type': 'application/json' };

  report.capabilities = await requestJson(`${endpoint}/v1/capabilities`);
  report.wrongOrigin = await requestJson(`${endpoint}/v1/impulse`, {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:1', 'Content-Type': 'application/json' },
    body: JSON.stringify(impulse),
  });
  report.nonCausal = await requestJson(`${endpoint}/v1/impulse`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({ ...impulse, cause: 'decorative-breakup' }),
  });
  report.forgedSourceRoute = await requestJson(`${endpoint}/v1/impulse`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify({ ...impulse, sourceRoute: 'kaminos.structural-material.decorative-breakup.v0' }),
  });
  report.malformed = await requestJson(`${endpoint}/v1/impulse`, {
    method: 'POST',
    headers: browserHeaders,
    body: '{',
  });
  report.valid = await requestJson(`${endpoint}/v1/impulse`, {
    method: 'POST',
    headers: browserHeaders,
    body: JSON.stringify(impulse),
  });

  report.checks.capabilityIdentity = report.capabilities.statusCode === 200
    && report.capabilities.body?.effectiveRoute === route
    && report.capabilities.body?.loopbackOnly === true
    && report.capabilities.body?.structuralAuthority === false;
  report.checks.wrongOriginRejected = report.wrongOrigin.statusCode === 403
    && report.wrongOrigin.body?.failurePhase === 'origin-validation';
  report.checks.nonCausalRejected = report.nonCausal.statusCode === 422
    && report.nonCausal.body?.failurePhase === 'impulse-validation';
  report.checks.forgedSourceRouteRejected = report.forgedSourceRoute.statusCode === 422
    && report.forgedSourceRoute.body?.failurePhase === 'impulse-validation';
  report.checks.malformedRejected = report.malformed.statusCode === 400
    && report.malformed.body?.failurePhase === 'impulse-decode';
  report.checks.validDryRunAccepted = report.valid.statusCode === 200
    && report.valid.body?.status === 'passed'
    && report.valid.body?.effectiveRoute === route
    && report.valid.body?.cause === impulse.cause
    && report.valid.body?.performed === false
    && report.valid.body?.dryRun === true
    && report.valid.body?.tactileOutputVerified === false;
  report.checks.corsExact = report.valid.accessControlAllowOrigin === allowedOrigin;
  for (const [name, passed] of Object.entries(report.checks)) {
    assert.equal(passed, true, `native haptic witness check failed: ${name}`);
  }

  report.status = 'passed';
  report.effectiveRoute = route;
  report.failurePhase = null;
} catch (error) {
  report.failurePhase = report.failurePhase === 'witness-initialization'
    ? 'companion-compile-start-or-probe'
    : report.failurePhase;
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (listener) {
    listener.child.kill('SIGTERM');
    await new Promise(resolve => listener.child.once('exit', resolve));
    report.listenerStderr = listener.stderr();
  }
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}

console.log(JSON.stringify({ status: report.status, output, effectiveRoute: report.effectiveRoute }));
