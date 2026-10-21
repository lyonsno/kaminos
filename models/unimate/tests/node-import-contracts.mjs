// Every UniMate runtime module must import without a browser: applications bundle it, render on a
// server, or import it from a worker before WebGPU exists, and only calling into the model needs a
// GPU. Imports each runtime module (the files the npm package ships) in plain Node.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..');
const modules = fs.readdirSync(dir).filter(f => /^unimate-[\w-]+\.js$/.test(f)).sort();
const failed = [];
for (const f of modules) {
  try { await import(path.join(dir, f)); } catch (e) { failed.push(`${f}: ${e.message}`); }
}
if (failed.length) { console.error(`node import contracts: FAIL\n  ${failed.join('\n  ')}`); process.exit(1); }
console.log(`node import contracts: pass (${modules.length} modules)`);
