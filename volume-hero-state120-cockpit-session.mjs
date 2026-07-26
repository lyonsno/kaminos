#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  HERO_STATE120_COHORT_SHA256,
  HERO_STATE120_TARGET_SHA256,
  parseHeroState120Route,
  SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY,
} from './volume-sparse-product-cockpit.mjs';

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const port = normalizePort(args.get('--port') || 18831);
const cohortManifestPath = requiredPath(
  args.get('--cohort-manifest')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-persistent-sparse-cohort-r1/cohort-manifest.json',
  '--cohort-manifest',
);
const targetPath = requiredPath(
  args.get('--raymarch-target')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-exact-bilinear-motion-r4/render/images/coefficient-state-120-target.png',
  '--raymarch-target',
);
const sourceCaptureReportPath = requiredPath(
  args.get('--source-capture-report')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-layer-coefficient-corpus-r4/capture-report.json',
  '--source-capture-report',
);

assert.equal(sha256File(cohortManifestPath), HERO_STATE120_COHORT_SHA256, 'authenticated Hero cohort checksum drifted');
assert.equal(sha256File(targetPath), HERO_STATE120_TARGET_SHA256, 'authenticated Hero Raymarch target checksum drifted');

const mountSlug = `hero-state120-cockpit-${port}`;
const mountRoot = join(repoRoot, 'scratch', mountSlug);
const cohortMount = join(mountRoot, 'cohort');
const targetMount = join(mountRoot, 'target');
mkdirSync(mountRoot, { recursive: true });
ensureMount(cohortMount, dirname(cohortManifestPath));
ensureMount(targetMount, dirname(targetPath));

const origin = `http://127.0.0.1:${port}`;
const operatorRoute = `${origin}/scratch/${mountSlug}/open.html`;
const sourceCaptureReport = readJson(sourceCaptureReportPath);
const sourceRoute = new URL(sourceCaptureReport.requestedRoute);
const route = new URL('/volume-selective-head-live.html', origin);
for (const [key, value] of sourceRoute.searchParams) route.searchParams.set(key, value);
route.searchParams.set('volume_hero_pair', 'state120');
route.searchParams.set('kaminos_volume_smoke', '1');
route.searchParams.set('volume_resolution', '160');
route.searchParams.set('volume_render_scale', '1');
route.searchParams.set('volume_boundary_splat_mode', 'learned');
route.searchParams.set('volume_boundary_splat_radius', '0.98');
route.searchParams.set('volume_boundary_splat_sharpness', '12');
route.searchParams.set('volume_optical_unit_mode', 'projected-native-cell-area-integral-normalized-v0');
route.searchParams.set('volume_boundary_splat_presentation_mode', SPARSE_PRODUCT_OPTICAL_PRESENTATION_IDENTITY);
route.searchParams.set('composition', 'splat-only-v0');
route.searchParams.set('volume_raymarch_smoke', 'off');
route.searchParams.set('volume_presentation', 'beauty');
route.searchParams.set('role', 'off');
route.searchParams.set('warmup_steps', '0');
route.searchParams.set(
  'full_support_persistent_cohort_manifest',
  `/scratch/${mountSlug}/cohort/${basename(cohortManifestPath)}`,
);
route.searchParams.set('full_support_persistent_cohort_manifest_sha256', HERO_STATE120_COHORT_SHA256);
route.searchParams.set('full_support_persistent_cohort_state', 'coefficient-state-120');
route.searchParams.set(
  'full_support_hero_target',
  `/scratch/${mountSlug}/target/${basename(targetPath)}`,
);
route.searchParams.set('full_support_hero_target_sha256', HERO_STATE120_TARGET_SHA256);
const request = parseHeroState120Route(route.searchParams);

const routeReceipt = {
  schema: 'kaminos.volume.authenticated-hero-state120-session.v0',
  status: 'starting',
  requestedRoute: route.href,
  effectiveRoute: null,
  operatorRoute,
  repoRoot,
  port,
  request,
  source: {
    cohortManifestPath,
    cohortSha256: sha256File(cohortManifestPath),
    raymarchTargetPath: targetPath,
    raymarchTargetSha256: sha256File(targetPath),
    sourceCaptureReportPath,
    sourceCaptureReportSha256: sha256File(sourceCaptureReportPath),
  },
  mounts: {
    cohort: cohortMount,
    target: targetMount,
  },
  serverPid: null,
  failureReason: null,
};
const receiptPath = join(mountRoot, 'route-receipt.json');
writeOperatorLauncher();
writeReceipt();

const server = spawn('python3', [join(repoRoot, 'serve.py'), String(port)], {
  cwd: repoRoot,
  stdio: 'inherit',
});
routeReceipt.serverPid = server.pid;
server.once('exit', code => {
  if (code !== 0) process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

try {
  await waitForServer(origin, server);
  routeReceipt.status = 'serving';
  routeReceipt.effectiveRoute = route.href;
  writeReceipt();
  console.log(JSON.stringify({
    ok: true,
    url: operatorRoute,
    effectiveRoute: route.href,
    routeReceipt: receiptPath,
    serverPid: server.pid,
  }, null, 2));
} catch (error) {
  routeReceipt.status = 'failed';
  routeReceipt.failureReason = error?.message || String(error);
  writeReceipt();
  server.kill('SIGTERM');
  throw error;
}

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

function normalizePort(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1024 || normalized > 65535) {
    throw new Error(`invalid --port: ${value}`);
  }
  return normalized;
}

function requiredPath(value, name) {
  const path = resolve(String(value));
  if (!existsSync(path)) throw new Error(`missing ${name} file: ${path}`);
  return path;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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

function writeReceipt() {
  writeFileSync(receiptPath, `${JSON.stringify(routeReceipt, null, 2)}\n`);
}

function writeOperatorLauncher() {
  writeFileSync(join(mountRoot, 'open.html'), `<!doctype html>
<meta charset="utf-8">
<title>Authenticated state-120 Hero pair</title>
<body style="margin:0;background:#050708;color:#d8e5e7;font:14px system-ui">
<p style="padding:16px">Loading the checksum-bound state-120 Hero pair...</p>
<script>
fetch('./route-receipt.json', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error('route receipt unavailable');
    return response.json();
  })
  .then(receipt => {
    if (receipt.status !== 'serving' || !receipt.effectiveRoute) {
      throw new Error('authenticated Hero route is not serving');
    }
    location.replace(receipt.effectiveRoute);
  })
  .catch(error => {
    document.body.textContent = 'Authenticated Hero route failed: ' + error.message;
  });
</script>
`);
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
  throw new Error(`serve.py did not admit authenticated Hero route at ${origin}`);
}
