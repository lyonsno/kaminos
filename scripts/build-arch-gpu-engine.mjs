import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWebphysicsPatches, applyWebphysicsOwnershipPatch, applyWebphysicsComputeBatchPatch } from './webphysics-patches.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  absWorkingDir: root, entryPoints: ['structural-material-arch-gpu-engine.js'],
  outfile: 'dist/structural-material-arch-gpu-engine.js', bundle: true, format: 'esm',
  target: 'es2022', external: ['three', 'three/webgpu', 'three/tsl'], sourcemap: true,
  plugins: [{ name: 'pinned-joint-repair', setup(builder) {
    builder.onLoad({ filter: /[/\\]physics[/\\]gpu[/\\]avbdState\.ts$/ }, async args => ({ contents: applyWebphysicsComputeBatchPatch(applyWebphysicsPatches(await readFile(args.path, 'utf8'))), loader: 'ts' }));
    builder.onLoad({ filter: /[/\\]physics[/\\]gpu[/\\]broadPhase\.ts$/ }, async args => ({ contents: applyWebphysicsOwnershipPatch(await readFile(args.path, 'utf8')), loader: 'ts' }));
  } }, { name: 'wgsl-source', setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'wgsl-source' }));
    builder.onLoad({ filter: /.*/, namespace: 'wgsl-source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
  } }],
});
