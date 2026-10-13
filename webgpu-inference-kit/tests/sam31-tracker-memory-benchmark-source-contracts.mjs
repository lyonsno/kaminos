import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const text = await readFile(resolve(root, 'tools/sam31-tracker-memory-benchmark.mjs'), 'utf8');
const start = text.indexOf('async function sourceSnapshot()');
const end = text.indexOf('async function prepareInputs', start);
assert(start >= 0 && end > start, 'the actual source capture boundary must be present');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
// Replay the reviewed private boundary without changing the live/queued source.
const probe = new AsyncFunction('KIT_ROOT', 'execFileSync', 'readdir', 'resolve', 'readFile', 'hash', `${text.slice(start, end)}; return sourceSnapshot();`);
async function capture({ changed = null, status = '', untracked = false } = {}) {
  return probe(root,
    (command, args, options) => args[0] === 'status' ? status : execFileSync(command, args, options),
    async (directory, options) => {
      const entries = await readdir(directory, options);
      return untracked && directory === resolve(root, 'src')
        ? [...entries, { name: 'untracked-execution.js', isDirectory: () => false }]
        : entries;
    }, resolve,
    async path => {
      if (path === resolve(root, 'src/untracked-execution.js')) return Buffer.from('// synthetic untracked module\n');
      const bytes = await readFile(path);
      return path === resolve(root, changed ?? 'no-change') ? Buffer.concat([bytes, Buffer.from('\n// synthetic changed execution bytes\n')]) : bytes;
    }, hash);
}
const valid = await capture();
assert.equal(valid.source.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
assert(valid.source.files['src/sam31-memory-attention-phase-program.js']);
for (const changed of ['src/sam31-memory-attention-phase-program.js', 'smokes/sam31-tracker-memory-benchmark.html', 'tools/sam31-tracker-memory-benchmark.mjs', 'tools/sam31-tracker-memory-benchmark-evidence.mjs']) {
  await assert.rejects(() => capture({ changed, status: ` M webgpu-inference-kit/${changed}\n` }), /source bytes.*requested commit/, changed);
}
await assert.rejects(() => capture({ untracked: true }), /source bytes.*requested commit/);
const unrelated = await capture({ status: ' M unrelated-concurrent-note.md\n' });
assert.deepEqual(unrelated.source.files, valid.source.files, 'unrelated working changes do not invalidate committed execution bytes');
console.log('SAM3.1 benchmark served-source Git binding contracts passed');
