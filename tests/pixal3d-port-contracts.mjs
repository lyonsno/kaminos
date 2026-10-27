// kaminos-test: node
// Runs every Pixal3D port contract (models/pixal3d/tests/*.mjs) under the repository runner, each in its
// own process, so the port's contracts (ProjGrid camera/projection, NAF upsampling, Pixal3D block,
// flow model, mesh postprocessing, and 8-model stage-conditioned generation) are enforced by `npm test`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../models/pixal3d/tests/', import.meta.url));
const files = fs.readdirSync(dir).filter(name => name.endsWith('.mjs')).sort();
assert.ok(files.includes('proj-grid-contracts.mjs'), 'Pixal3D contracts found');
const failures = [];
for (const name of files) {
  const child = spawnSync(process.execPath, [path.join(dir, name)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status === 0) console.log(`ok ${name}: ${child.stdout.trim().split('\n').at(-1)}`);
  else failures.push(`${name} exited ${child.status ?? child.signal}\n${(child.stderr || child.stdout).slice(-2000)}`);
}
assert.deepEqual(failures, [], failures.join('\n\n'));
