import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(repoRoot, 'motion-ready-719024-live-witness.mjs');
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scratch = await mkdtemp(join(tmpdir(), 'kaminos-motion-ready-719024-failure-'));
const originalRegistration = await readFile(join(repoRoot, 'artifacts/motion-ready-719024/registration.json'));

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
  })[extname(path)] || 'application/octet-stream';
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (requestUrl.pathname === '/blank.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>responsive without witness state</title><p id="status">blank fixture</p>');
      return;
    }
    if (requestUrl.pathname === '/tampered-registration.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(Buffer.concat([originalRegistration, Buffer.from(' ')]));
      return;
    }
    const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'motion-ready-719024-witness.html';
    const path = resolve(repoRoot, relative);
    if (!path.startsWith(`${repoRoot}/`)) throw new Error('path escapes fixture root');
    const bytes = await readFile(path);
    response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store' });
    response.end(bytes);
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error));
  }
});
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const serverPort = server.address().port;

async function runFailure(name, commandArgs, parentTimeoutMs = 10_000) {
  const outDir = join(scratch, name);
  const reportPath = join(outDir, 'report.json');
  const child = spawn(process.execPath, [runner, '--out-dir', outDir, ...commandArgs], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let killedByParent = false;
  const timer = setTimeout(() => {
    killedByParent = true;
    child.kill('SIGKILL');
  }, parentTimeoutMs);
  const result = await new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
  clearTimeout(timer);
  assert.equal(killedByParent, false, `${name} witness exceeded its bounded failure window\n${stdout}\n${stderr}`);
  assert.notEqual(result.code, 0, `${name} witness unexpectedly succeeded`);
  let reportText;
  try {
    reportText = await readFile(reportPath, 'utf8');
  } catch (error) {
    assert.fail(`${name} witness failed before writing its durable report (${error.code || error.message})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  const report = JSON.parse(reportText);
  assert.equal(report.ok, false, `${name} must leave a durable negative receipt`);
  return report;
}

try {
  const inertChrome = join(scratch, 'inert-chrome.sh');
  await writeFile(inertChrome, '#!/bin/sh\nexec sleep 30\n');
  await chmod(inertChrome, 0o755);
  const cdpReport = await runFailure('cdp-stall', [
    '--chrome', inertChrome,
    '--debug-port', String(19_000 + (process.pid % 300)),
    '--cdp-timeout-ms', '500',
  ], 3_000);
  assert.equal(cdpReport.phase, 'connecting-cdp');
  assert.equal(cdpReport.lastTrustworthyEvidence?.phase, 'connecting-cdp');

  const blankReport = await runFailure('blank-page', [
    '--chrome', chrome,
    '--url', `http://127.0.0.1:${serverPort}/blank.html`,
    '--debug-port', String(19_400 + (process.pid % 300)),
    '--cdp-timeout-ms', '5000',
    '--witness-timeout-ms', '700',
  ]);
  assert.equal(blankReport.phase, 'loading-witness');
  assert.equal(blankReport.effectiveUrl, `http://127.0.0.1:${serverPort}/blank.html`);
  assert.equal(blankReport.lastTrustworthyEvidence?.status, 'blank fixture');

  const tamperedReport = await runFailure('tampered-registration', [
    '--chrome', chrome,
    '--url', `http://127.0.0.1:${serverPort}/motion-ready-719024-witness.html?registration_url=/tampered-registration.json`,
    '--debug-port', String(19_800 + (process.pid % 300)),
    '--cdp-timeout-ms', '5000',
    '--witness-timeout-ms', '7000',
  ], 12_000);
  assert.equal(tamperedReport.phase, 'loading-witness');
  assert.match(tamperedReport.error, /registration effective-byte identity mismatch/);
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(scratch, { recursive: true, force: true });
}

console.log('motion-ready-719024 live witness failure contracts passed');
