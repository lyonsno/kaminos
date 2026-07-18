#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const sourceFieldManifestPath = requiredPath('--source-field-manifest');
const sourceCaptureReportPath = requiredPath('--source-capture-report');
const exactOverlayManifestPath = requiredPath('--exact-overlay-manifest');
const baselineOverlayManifestPath = requiredPath('--baseline-overlay-manifest');
const flowOverlayManifestPath = requiredPath('--flow-overlay-manifest');
const stageBManifestArgument = args.get('--stage-b-manifest');
const stageBManifestSha256 = args.get('--stage-b-manifest-sha256');
assert.equal(Boolean(stageBManifestArgument), Boolean(stageBManifestSha256), '--stage-b-manifest and --stage-b-manifest-sha256 must be provided together');
const stageBManifestPath = stageBManifestArgument ? requiredPath('--stage-b-manifest') : null;
const stageBAcceptanceArgument = args.get('--stage-b-acceptance-receipt');
const stageBAcceptanceSha256 = args.get('--stage-b-acceptance-sha256');
assert.equal(Boolean(stageBAcceptanceArgument), Boolean(stageBAcceptanceSha256), '--stage-b-acceptance-receipt and --stage-b-acceptance-sha256 must be provided together');
assert.ok(!stageBAcceptanceArgument || stageBManifestPath, 'Stage B acceptance requires an explicit Stage B manifest');
const stageBAcceptancePath = stageBAcceptanceArgument ? requiredPath('--stage-b-acceptance-receipt') : null;
const port = normalizePort(args.get('--port') || 18782);
const requestedSource = String(args.get('--source') || 'analytical-exact');
assert.ok(['analytical-exact', 'learned-baseline', 'learned-flow'].includes(requestedSource), `unsupported --source: ${requestedSource}`);

const sourceFieldManifest = readJson(sourceFieldManifestPath);
const sourceCaptureReport = readJson(sourceCaptureReportPath);
assert.equal(sourceFieldManifest.schema, 'kaminos.volume.full-grid-field-export.v0', 'source field manifest schema drifted');
assert.equal(sourceFieldManifest.status, 'captured', 'source field manifest is incomplete');
assert.equal(sourceFieldManifest.completeFieldCoverage, true, 'source field manifest is partial');
assert.equal(sourceFieldManifest.grid, 160, 'source field manifest must be grid 160');

const mountSlug = `full-support-stage-a-${port}`;
const mountRoot = join(repoRoot, 'scratch', mountSlug);
mkdirSync(mountRoot, { recursive: true });
const mounts = {
  state: dirname(sourceFieldManifestPath),
  exact: dirname(exactOverlayManifestPath),
  baseline: dirname(baselineOverlayManifestPath),
  flow: dirname(flowOverlayManifestPath),
};
if (stageBManifestPath) mounts.stageB = dirname(stageBManifestPath);
if (stageBAcceptancePath) mounts.stageBAcceptance = dirname(stageBAcceptancePath);
for (const [name, target] of Object.entries(mounts)) ensureMount(join(mountRoot, name), target);

const origin = `http://127.0.0.1:${port}`;
const requestedRoute = new URL(sourceCaptureReport.requestedRoute);
const route = new URL(`${requestedRoute.pathname}${requestedRoute.search}`, origin);
route.searchParams.set('composition', 'splat-only-v0');
route.searchParams.set('volume_raymarch_smoke', 'off');
route.searchParams.set('full_support_source', requestedSource);
route.searchParams.set('full_support_source_field_manifest', `/scratch/${mountSlug}/state/${basename(sourceFieldManifestPath)}`);
route.searchParams.set('full_support_source_fluid', `/scratch/${mountSlug}/state/${basename(sourceFieldManifest.sidecars.fluid.path)}`);
route.searchParams.set('full_support_source_front', `/scratch/${mountSlug}/state/${basename(sourceFieldManifest.sidecars.front.path)}`);
route.searchParams.set('full_support_exact_manifest', `/scratch/${mountSlug}/exact/${basename(exactOverlayManifestPath)}`);
route.searchParams.set('full_support_baseline_manifest', `/scratch/${mountSlug}/baseline/${basename(baselineOverlayManifestPath)}`);
route.searchParams.set('full_support_flow_manifest', `/scratch/${mountSlug}/flow/${basename(flowOverlayManifestPath)}`);
if (stageBManifestPath) {
  const stageBArtifact = artifact(stageBManifestPath);
  assert.equal(stageBArtifact.sha256, stageBManifestSha256, 'Stage B manifest hash does not match --stage-b-manifest-sha256');
  route.searchParams.set('full_support_stage_b_manifest', `/scratch/${mountSlug}/stageB/${basename(stageBManifestPath)}`);
  route.searchParams.set('full_support_stage_b_manifest_sha256', String(stageBManifestSha256));
}
if (stageBAcceptancePath) {
  const acceptanceArtifact = artifact(stageBAcceptancePath);
  assert.equal(acceptanceArtifact.sha256, stageBAcceptanceSha256, 'Stage B acceptance hash does not match --stage-b-acceptance-sha256');
  route.searchParams.set('full_support_stage_b_acceptance', `/scratch/${mountSlug}/stageBAcceptance/${basename(stageBAcceptancePath)}`);
  route.searchParams.set('full_support_stage_b_acceptance_sha256', String(stageBAcceptanceSha256));
}

const routeReceipt = {
  schema: 'kaminos.pyro.full-support-cockpit-session.v0',
  status: 'starting',
  requestedRoute: sourceCaptureReport.requestedRoute,
  effectiveRoute: route.href,
  requestedSource,
  repoRoot,
  port,
  mounts,
  artifacts: {
    sourceFieldManifest: artifact(sourceFieldManifestPath),
    sourceCaptureReport: artifact(sourceCaptureReportPath),
    exactOverlayManifest: artifact(exactOverlayManifestPath),
    baselineOverlayManifest: artifact(baselineOverlayManifestPath),
    flowOverlayManifest: artifact(flowOverlayManifestPath),
    stageBManifest: stageBManifestPath ? artifact(stageBManifestPath) : null,
    stageBAcceptance: stageBAcceptancePath ? artifact(stageBAcceptancePath) : null,
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
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

await waitForServer(origin, server);
routeReceipt.status = 'serving';
routeReceipt.receiptPath = relative(repoRoot, receiptPath);
writeFileSync(receiptPath, `${JSON.stringify(routeReceipt, null, 2)}\n`);
console.log(JSON.stringify({
  ok: true,
  url: route.href,
  routeReceipt: receiptPath,
  serverPid: server.pid,
}, null, 2));

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

function ensureMount(path, target) {
  const resolvedTarget = resolve(target);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === resolvedTarget) return;
    throw new Error(`mount path already exists with different custody: ${path}`);
  }
  symlinkSync(resolvedTarget, path, 'dir');
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
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
