#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { resolveSf3dRuntimeKitIdentity } from './sf3d-runtime-kit-identity.mjs';

const EXPECTED_REVISION = '10118acbbdd895db7e4eaa7d0a9de252ccaa77af';
const EXPECTED_KIT_VERSION = '0.1.42';
const KAMINOS_ROOT = path.resolve(new URL('..', import.meta.url).pathname);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function git(repo, ...args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

async function openPort(preferred) {
  const canListen = port => new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
  for (let port = preferred; port < preferred + 20; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free local port in ${preferred}-${preferred + 19}`);
}

async function waitFor(url) {
  while (true) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

const sf3dRepoValue = argument('--sf3d-repo', process.env.KAMINOS_SF3D_REPO || '');
if (!sf3dRepoValue) throw new Error('--sf3d-repo is required');
const sf3dRepo = path.resolve(sf3dRepoValue);
const meshDir = path.resolve(argument('--mesh-dir', '/private/tmp/sf3d-arena-worker-shots'));
const meshFile = argument('--mesh-file', 'arena-worker.glb');
if (!existsSync(path.join(meshDir, meshFile))) {
  throw new Error(`accepted SF3D smoke mesh is missing: ${path.join(meshDir, meshFile)}`);
}
const effectiveRevision = git(sf3dRepo, 'rev-parse', 'HEAD');
const dirty = git(sf3dRepo, 'status', '--short');
if (effectiveRevision !== EXPECTED_REVISION) {
  throw new Error(`SF3D effective revision ${effectiveRevision} != accepted ${EXPECTED_REVISION}`);
}
if (dirty) throw new Error(`SF3D source must be clean:\n${dirty}`);
const kitIdentity = resolveSf3dRuntimeKitIdentity(sf3dRepo, EXPECTED_KIT_VERSION);

const sf3dPort = await openPort(Number(argument('--sf3d-port', '5176')));
const kaminosPort = await openPort(Number(argument('--kaminos-port', '8093')));
const sf3dOrigin = `http://127.0.0.1:${sf3dPort}`;
const kaminosOrigin = `http://127.0.0.1:${kaminosPort}`;
const children = [];
const stop = () => {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process already exited.
    }
  }
};
process.once('SIGINT', () => {
  stop();
  process.exit(130);
});
process.once('SIGTERM', () => {
  stop();
  process.exit(143);
});
process.once('exit', stop);

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(sf3dPort), '--strictPort'], {
  cwd: sf3dRepo,
  stdio: ['ignore', 'inherit', 'inherit'],
});
children.push(vite);
const kaminos = spawn('python3', ['serve.py', String(kaminosPort)], {
  cwd: KAMINOS_ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    KAMINOS_SF3D_REPO: sf3dRepo,
    KAMINOS_SF3D_ORIGIN: sf3dOrigin,
    KAMINOS_SF3D_EXPECTED_REVISION: EXPECTED_REVISION,
    KAMINOS_SF3D_EXPECTED_KIT_VERSION: kitIdentity.requestedVersion,
    KAMINOS_SF3D_EFFECTIVE_KIT_VERSION: kitIdentity.effectiveVersion,
    KAMINOS_SF3D_EFFECTIVE_KIT_PACKAGE_PATH: kitIdentity.effectivePackagePath,
    KAMINOS_SPLAT_ASSET_ROOTS: meshDir,
  },
});
children.push(kaminos);
for (const child of children) {
  child.once('exit', (code, signal) => {
    console.error(`Smoke server exited early: code=${code} signal=${signal}`);
    stop();
    process.exit(code || 1);
  });
}

await Promise.all([
  waitFor(`${sf3dOrigin}/demo_chair.png`),
  waitFor(`${kaminosOrigin}/api/sf3d-live-smoke-config`),
]);

const url = new URL(kaminosOrigin);
url.searchParams.set('sf3d_live_smoke', '1');
url.searchParams.set('mesh_root', 'splat-extra-1');
url.searchParams.set('mesh_path', meshFile);
console.log('\nSF3D live contention smoke');
console.log(`  source: ${effectiveRevision}`);
console.log(`  kit:    ${kitIdentity.effectiveVersion}`);
console.log(`  sf3d:   ${sf3dOrigin}`);
console.log(`  open:   ${url.href}`);
console.log('  firing is manual; model load does not start inference\n');

await new Promise(() => {});
