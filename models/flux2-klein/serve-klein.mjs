// Serve the Klein generator page with weight roots for interactive use.
// Usage: node serve-klein.mjs --port 18709 --te <dir> --dit <dir> --vae <dir>
// Open http://localhost:<port>/generate.html. Range requests are supported for the
// text-encoder embedding table.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const roots = { '/te/': path.resolve(opt('--te')), '/dit/': path.resolve(opt('--dit')), '/vae/': path.resolve(opt('--vae')),
  '/webgpu-inference-kit/': path.resolve(opt('--kit', path.join(here, '../../webgpu-inference-kit'))), '/': here };
const { origin } = await startServer(roots, Number(opt('--port', '18709')));
console.log(JSON.stringify({ origin, page: `${origin}/generate.html`, roots }));
