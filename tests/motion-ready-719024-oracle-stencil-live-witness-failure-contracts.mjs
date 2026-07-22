import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(repoRoot, 'motion-ready-719024-stencil-live-witness.mjs');
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scratch = await mkdtemp(join(tmpdir(), 'kaminos-oracle-stencil-failure-'));
const registration = await readFile(join(repoRoot, 'artifacts/motion-ready-719024/registration.json'));

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
      response.end('<!doctype html><title>blank oracle surface</title><p id="status">blank oracle fixture</p>');
      return;
    }
    if (requestUrl.pathname === '/tampered-registration.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(Buffer.concat([registration, Buffer.from(' ')]));
      return;
    }
    const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'motion-ready-719024-stencil.html';
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

async function runFailure(name, commandArgs, parentTimeoutMs = 12_000) {
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
  let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, parentTimeoutMs);
  const result = await new Promise(resolveExit => child.once('exit', code => resolveExit(code)));
  clearTimeout(timer);
  assert.equal(killed, false, `${name} exceeded its bounded failure window\n${stdout}\n${stderr}`);
  assert.notEqual(result, 0, `${name} unexpectedly succeeded`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.ok, false, `${name} did not leave a durable negative receipt`);
  return report;
}

try {
  const base = `http://127.0.0.1:${serverPort}`;
  const blank = await runFailure('blank-route', [
    '--chrome', chrome,
    '--url', `${base}/blank.html`,
    '--debug-port', String(21_000 + (process.pid % 200)),
    '--witness-timeout-ms', '700',
  ]);
  assert.equal(blank.phase, 'loading-blank-rest-space-workbench');
  assert.equal(blank.lastTrustworthyEvidence.status, 'blank oracle fixture');

  const tampered = await runFailure('tampered-registration', [
    '--chrome', chrome,
    '--url', `${base}/motion-ready-719024-stencil.html?registration_url=/tampered-registration.json`,
    '--debug-port', String(21_300 + (process.pid % 200)),
    '--witness-timeout-ms', '4000',
  ]);
  assert.equal(tampered.phase, 'loading-blank-rest-space-workbench');
  assert.match(tampered.error, /registration effective-byte identity mismatch/);

  const atlasSubstitution = await runFailure('contact-atlas-substitution', [
    '--chrome', chrome,
    '--url', `${base}/motion-ready-719024-stencil.html?stencil_url=/artifacts/motion-ready-719024/contact-atlas.json`,
    '--debug-port', String(21_600 + (process.pid % 200)),
    '--witness-timeout-ms', '4000',
  ]);
  assert.equal(atlasSubstitution.phase, 'loading-blank-rest-space-workbench');
  assert.match(atlasSubstitution.error, /oracle stencil schema/);
  assert.equal(atlasSubstitution.requestedStencilSource, '/artifacts/motion-ready-719024/contact-atlas.json');
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(scratch, { recursive: true, force: true });
}

console.log('motion-ready-719024 oracle stencil live witness failure contracts passed');
