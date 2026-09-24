#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { assertCatMotionSourceIdentity, captureCatMotionSourceIdentity } from './cat-motion-smoke-source-identity.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const repoRoot = resolve(args.get('--repo-root') || process.cwd());
const outputDir = resolve(args.get('--out-dir') || '');
const assetPath = resolve(args.get('--asset-path') || '');
const clipPath = resolve(args.get('--clip-path') || '');
const expectedAssetSha256 = args.get('--asset-sha256') || '';
const expectedMotionClipSha256 = args.get('--clip-sha256') || '';
const expectedSourceSha256 = args.get('--source-sha256') || '';
const meshIndex = Number(args.get('--mesh-index') || 0);
const port = Number(args.get('--port') || 18125);
const phaseArtifacts = {
  primary: join(outputDir, 'report.json'),
  failure: join(outputDir, 'failure.json'),
  serverLog: join(outputDir, 'serve.log'),
  screenshot: join(outputDir, 'cat-motion.png'),
};
let phase = 'validate-inputs';
let lastTrustworthyEvidence = 'none';
let server = null;
let serverStderr = '';
let witnessResult = null;
let sourceIdentity = null;

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitValue(...argv) {
  const result = spawnSync('git', ['-C', repoRoot, ...argv], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : `unavailable:${result.stderr.trim()}`;
}

function writeReport(path, payload) {
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/roots`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return await response.json();
    } catch {}
    if (server?.exitCode !== null) throw new Error(`serve.py exited before health route: ${serverStderr.slice(-1200)}`);
    await delay(100);
  }
  throw new Error(`serve.py did not answer /api/roots on port ${port}: ${serverStderr.slice(-1200)}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolveExit => server.once('exit', resolveExit)),
    delay(2500),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

try {
  mkdirSync(outputDir, { recursive: true });
  assert.ok(/^[a-f0-9]{64}$/.test(expectedAssetSha256), 'exact asset SHA-256 is required');
  assert.ok(/^[a-f0-9]{64}$/.test(expectedMotionClipSha256), 'exact motion clip SHA-256 is required');
  sourceIdentity = captureCatMotionSourceIdentity(repoRoot);
  phase = 'verify-exact-source-identity';
  assertCatMotionSourceIdentity(repoRoot, expectedSourceSha256);
  assert.equal(digest(assetPath), expectedAssetSha256, 'cat carrier bytes do not match requested identity');
  assert.equal(digest(clipPath), expectedMotionClipSha256, 'Kimodo clip bytes do not match requested identity');
  assert.ok([0, 1].includes(meshIndex), 'painted cast index must be 0 or 1');
  const sourceCommit = gitValue('rev-parse', 'HEAD');
  const sourceStatus = gitValue('status', '--porcelain=v1');
  phase = 'launch-source-matched-kaminos-server';
  server = spawn('python3', [join(repoRoot, 'serve.py'), String(port)], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => writeFileSync(phaseArtifacts.serverLog, chunk, { flag: 'a' }));
  server.stderr.on('data', chunk => {
    serverStderr += chunk.toString();
    writeFileSync(phaseArtifacts.serverLog, chunk, { flag: 'a' });
  });
  const roots = await waitForServer();
  lastTrustworthyEvidence = 'Kaminos /api/roots responded from the exact worktree server process';
  phase = 'run-headed-webgpu-cat-motion-witness';
  const assetRelativePath = assetPath.replace(/^\/private\/tmp\//, '');
  assert.ok(assetRelativePath !== assetPath, 'asset path must be under /private/tmp for the lerms-preview asset root');
  const url = new URL(`http://127.0.0.1:${port}/`);
  url.searchParams.set('mesh_root', 'lerms-preview');
  url.searchParams.set('mesh_path', assetRelativePath);
  url.searchParams.set('mesh_sha256', expectedAssetSha256);
  const witnessArgs = [
    join(repoRoot, 'scene-object-witness.mjs'),
    '--scenario', 'cat-motion-retarget',
    '--url', url.href,
    '--expected-server-root', repoRoot,
    '--expected-asset-sha256', expectedAssetSha256,
    '--motion-clip', clipPath,
    '--expected-motion-clip-sha256', expectedMotionClipSha256,
    '--pose-mesh-index', String(meshIndex),
    '--out', phaseArtifacts.screenshot,
    '--report', phaseArtifacts.primary,
    '--debug-port', String(port + 1),
    '--settle-ms', '3500',
  ];
  const witness = spawn(process.execPath, witnessArgs, {
    cwd: repoRoot,
    env: { ...process.env, KAMINOS_WITNESS_HEADLESS: process.env.KAMINOS_WITNESS_HEADLESS || '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let witnessStdout = '';
  let witnessStderr = '';
  witness.stdout.on('data', chunk => { witnessStdout += chunk.toString(); });
  witness.stderr.on('data', chunk => { witnessStderr += chunk.toString(); });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    witness.once('error', rejectExit);
    witness.once('exit', code => resolveExit(code));
  });
  if (witnessStdout) writeFileSync(join(outputDir, 'witness.stdout.log'), witnessStdout);
  if (witnessStderr) writeFileSync(join(outputDir, 'witness.stderr.log'), witnessStderr);
  if (exitCode !== 0) throw new Error(`browser witness exited ${exitCode}: ${witnessStderr.slice(-2500)}`);
  const witnessReport = JSON.parse(readFileSync(phaseArtifacts.primary, 'utf8'));
  if (witnessReport.ok !== true || witnessReport.evidence?.catMotionRetarget?.loadedMotionClipSha256 !== expectedMotionClipSha256) {
    throw new Error('browser witness report is missing a successful exact-clip playback receipt');
  }
  witnessResult = witnessReport.evidence.catMotionRetarget;
  lastTrustworthyEvidence = phaseArtifacts.primary;
  phase = 'stop-server-and-write-terminal-report';
  await stopServer();
  writeReport(join(outputDir, 'runner-report.json'), {
    schema: 'kaminos.cat-motion-retarget-smoke-runner.v0',
    status: 'succeeded',
    phase,
    requestedRoute: 'Kaminos selected-skinned-mesh retarget adapter; retained Kimodo SOMA30 gallop clip; exact painted Mushfinger carrier',
    effectiveRoute: {
      repoRoot,
      sourceCommit,
      sourceDirtyState: sourceStatus ? 'dirty' : 'clean',
      sourceIdentitySha256: sourceIdentity.sha256,
      sourceFilesSha256: sourceIdentity.filesSha256,
      assetPath,
      assetSha256: expectedAssetSha256,
      clipPath,
      clipSha256: expectedMotionClipSha256,
      browserRequestedUrl: url.href,
      effectiveServerRoots: roots,
      browser: 'Chrome WebGPU witness; adapter/backend captured by browser runtime if available',
    },
    artifacts: phaseArtifacts,
    witness: witnessResult,
    serverStderrTail: serverStderr.slice(-1600),
  });
  console.log(JSON.stringify({ status: 'succeeded', report: join(outputDir, 'runner-report.json'), screenshot: phaseArtifacts.screenshot }));
} catch (error) {
  await stopServer();
  writeReport(phaseArtifacts.failure, {
    schema: 'kaminos.cat-motion-retarget-smoke-runner.v0',
    status: 'failed',
    phase,
    error: error instanceof Error ? error.message : String(error),
    lastTrustworthyEvidence,
    repoRoot,
    sourceCommit: gitValue('rev-parse', 'HEAD'),
    expectedSourceSha256,
    sourceIdentity,
    assetPath,
    clipPath,
    artifacts: phaseArtifacts,
    serverStderrTail: serverStderr.slice(-1600),
  });
  console.error(`${phase}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
}
