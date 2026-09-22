import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  KIT_REGISTRY_IDENTITY,
  verifyCanonicalKitSource,
} from '../kimodo-shared-device-source-admission.mjs';

const host = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = process.argv[2];
if (!checkout) throw new Error('Usage: node scripts/build-kimodo-shared-device.mjs /absolute/kimodo-worktree');
const root = await realpath(checkout);
const out = path.join(host, 'artifacts/kimodo-shared-device');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const hostGit = (...args) => execFileSync('git', ['-C', host, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', '--untracked-files=no')) {
  throw new Error('Kimodo tracked source must be clean before producing an admitted composition build');
}
if (hostGit('status', '--porcelain', '--untracked-files=no')) {
  throw new Error('Kaminos tracked source must be clean before producing an admitted composition build');
}
const sourceCommit = git('rev-parse', 'HEAD');
const sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (sourcePackage.devDependencies?.['@kaminos/webgpu-inference-kit'] !== '^0.1.52') {
  throw new Error('Kimodo composition source must consume @kaminos/webgpu-inference-kit ^0.1.52');
}
const kimodoKitPackage = JSON.parse(await readFile(path.join(root, 'node_modules/@kaminos/webgpu-inference-kit/package.json'), 'utf8'));
const hostKitPackage = JSON.parse(await readFile(path.join(host, 'node_modules/@kaminos/webgpu-inference-kit/package.json'), 'utf8'));
const canonicalKit = JSON.parse(await readFile(path.join(host, 'fixtures/webgpu-inference-kit-0.1.52-canonical-source.json'), 'utf8'));
const kimodoLock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const hostLock = JSON.parse(await readFile(path.join(host, 'package-lock.json'), 'utf8'));
const kimodoKitLock = kimodoLock.packages?.['node_modules/@kaminos/webgpu-inference-kit'];
const hostKitLock = hostLock.packages?.['node_modules/@kaminos/webgpu-inference-kit'];
if (kimodoKitPackage.version !== KIT_REGISTRY_IDENTITY.version || hostKitPackage.version !== KIT_REGISTRY_IDENTITY.version) {
  throw new Error(`shared-device build requires exact installed kit 0.1.52 (kimodo=${kimodoKitPackage.version}, host=${hostKitPackage.version})`);
}
for (const [owner, identity] of [['kimodo', kimodoKitLock], ['host', hostKitLock]]) {
  for (const field of ['version', 'resolved', 'integrity']) {
    if (identity?.[field] !== KIT_REGISTRY_IDENTITY[field]) {
      throw new Error(`${owner} lockfile does not bind the reviewed public inference-kit tarball (${field})`);
    }
  }
}
verifyCanonicalKitSource({
  packageRoot: path.join(host, 'node_modules/@kaminos/webgpu-inference-kit'),
  canonicalKit,
  label: 'host inference-kit source',
});
verifyCanonicalKitSource({
  packageRoot: path.join(root, 'node_modules/@kaminos/webgpu-inference-kit'),
  canonicalKit,
  label: 'Kimodo inference-kit source',
});
const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ status: 'building', sourceCommit }));
await build({
  root,
  configFile: false,
  publicDir: false,
  build: {
    outDir: path.join(out, 'lib'),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        producer: path.join(root, 'src/lib/producer.js'),
        telemetry: path.join(root, 'src/lib/frontend-telemetry.js'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
  },
});

await mkdir(path.join(out, 'assets'), { recursive: true });
const assets = {};
for (const name of ['kimodo.bin', 'kimodo.json', 'fk_data.json', 'motion_rep_stats.json']) {
  const source = await realpath(path.join(root, 'public', name));
  const target = path.join(out, 'assets', name);
  try {
    await lstat(target);
    if (await realpath(target) !== source) throw new Error(`Kimodo asset mount conflicts: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await symlink(source, target);
  }
  assets[name] = {
    bytes: (await readFile(source)).byteLength,
    sha256: createHash('sha256').update(await readFile(source)).digest('hex'),
  };
}

const bundles = {};
for (const name of await readdir(path.join(out, 'lib'))) {
  const bytes = await readFile(path.join(out, 'lib', name));
  bundles[name] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const servedFiles = {};
for (const name of [
  'index.html',
  'kimodo-shared-device.html',
  'kimodo-shared-device-host.mjs',
  'kimodo-shared-device-inject.mjs',
  'kimodo-shared-device-route.mjs',
  'fixtures/webgpu-inference-kit-0.1.52-canonical-source.json',
  'volume-core.js',
]) {
  const bytes = await readFile(path.join(host, name));
  servedFiles[name] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const runtimeKit = canonicalKit;
const manifest = {
  status: 'built',
  topology: 'one-host-owned-gpu-device-exact-queue',
  sourceRepo: 'lyonsno/kimodo-webgpu',
  sourceCommit,
  sourceRoot: root,
  hostCommit: hostGit('rev-parse', 'HEAD'),
  kitVersion: '0.1.52',
  installedKitVersions: { kimodo: kimodoKitPackage.version, host: hostKitPackage.version },
  runtimeKit,
  servedFiles,
  assets,
  bundles,
};
await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
