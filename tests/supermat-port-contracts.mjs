// kaminos-test: node
// Runs every SuperMat port contract (models/supermat/tests/*.mjs) under the repository runner, each in its
// own process, so the port's contracts (attention kernel default, duty timing, ops options, preprocess,
// source identity) are enforced by `npm test` rather than only by hand.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../models/supermat/tests/', import.meta.url));
const files = fs.readdirSync(dir).filter(name => name.endsWith('.mjs')).sort();
assert.ok(files.includes('kit-attention-contracts.mjs'), 'SuperMat contracts found');
const failures = [];
for (const name of files) {
  const child = spawnSync(process.execPath, [path.join(dir, name)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (child.status === 0) console.log(`ok ${name}: ${child.stdout.trim().split('\n').at(-1)}`);
  else failures.push(`${name} exited ${child.status ?? child.signal}\n${(child.stderr || child.stdout).slice(-2000)}`);
}
assert.deepEqual(failures, [], failures.join('\n\n'));
