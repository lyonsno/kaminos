import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await copyFile(new URL(import.meta.resolve('@kaminos/supermat/worker')), 'dist/supermat-cpu-worker.js');
const options = { entryPoints: ['app.js'], bundle: true, format: 'esm', loader: { '.webp': 'file' }, outfile: 'dist/app.js' };
if (process.argv.includes('--serve')) {
  const ctx = await context(options);
  await ctx.watch();
  const server = await ctx.serve({ servedir: '.', host: '127.0.0.1', port: Number(process.env.PORT || 5174) });
  console.log(`SuperMat Material Studio: http://127.0.0.1:${server.port}/`);
} else await build(options);
