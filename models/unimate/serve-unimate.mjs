// Serve the UniMate demo page with its weights and skeleton bundle.
// Usage: node serve-unimate.mjs --weights <dir> --bundle <dir> [--t5 <dir>] [--port 18711]
// Then open http://127.0.0.1:<port>/models/unimate/index.html
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../flux2-klein/cdp-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const weights = opt('--weights'), bundle = opt('--bundle'), t5 = opt('--t5');
if (!weights || !bundle) { console.error('need --weights <dir> and --bundle <dir>'); process.exit(2); }
const { origin } = await startServer({ '/weights/': path.resolve(weights), '/demo/': path.resolve(bundle), ...(t5 ? { '/t5/': path.resolve(t5) } : {}), '/': path.resolve(here, '../..') },
  Number(opt('--port', '18711')));
console.log(`${origin}/models/unimate/index.html`);
