import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

export async function buildSuperMatModule(outDir) {
  if (typeof outDir !== 'string' || !outDir.trim()) throw new Error('SuperMat module output directory is required');
  const root = path.resolve(import.meta.dirname, '..');
  return build({
    entryPoints: {
      'supermat-inference': path.join(root, 'models/supermat/index.js'),
      'supermat-cpu-worker': path.join(root, 'models/supermat/supermat-cpu-worker.js'),
    },
    bundle: true, format: 'esm', platform: 'browser', target: 'esnext',
    outdir: path.resolve(outDir),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  await buildSuperMatModule(values.out);
}
