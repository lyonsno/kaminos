import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const exporter = new URL('../tools/sam31-two-frame-tracker-meta-packet.py', import.meta.url);
const outDir = await mkdtemp(join(tmpdir(), 'sam31-two-frame-meta-'));
const python = process.env.SAM31_TORCH_PYTHON || '/Users/noahlyons/dev/sf3d/.venv/bin/python';
const run = spawnSync(python, [exporter.pathname, '--out-dir', outDir], { cwd: root.pathname, encoding: 'utf8', timeout: 240000 });
assert.equal(run.status, 0, run.stderr || run.stdout);

const manifest = JSON.parse(await readFile(join(outDir, 'tensor-manifest.json'), 'utf8'));
const byRole = Object.fromEntries(manifest.tensors.map(entry => [entry.role, entry]));
assert.ok(byRole['frame-0-selected-masks'], 'raw decoder-selected masks must remain available for component parity');
assert.ok(byRole['frame-0-memory-input-masks'], 'the packet must publish the official post-decoder mask consumed by memory');
const floats = async role => {
  const bytes = await readFile(join(outDir, byRole[role].file));
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
};
const scores = await floats('frame-0-object-scores');
const raw = await floats('frame-0-selected-masks');
const memoryInput = await floats('frame-0-memory-input-masks');
assert.equal(scores.length, 16);
assert.equal(raw.length, 16 * 8 * 8);
assert.equal(memoryInput.length, raw.length);
let absent = 0;
let appearing = 0;
for (let object = 0; object < 16; object += 1) {
  const begin = object * 64;
  const end = begin + 64;
  if (scores[object] <= 0) {
    absent += 1;
    assert.equal(memoryInput.slice(begin, end).every(value => value === -1024), true, `absent object ${object} must be hard-suppressed before memory`);
  } else {
    appearing += 1;
    assert.deepEqual(memoryInput.slice(begin, end), raw.slice(begin, end), `appearing object ${object} must preserve its selected decoder mask`);
  }
}
assert.equal(absent, manifest.stateTransition.frame0AbsentObjectCount);
assert.equal(appearing, manifest.stateTransition.frame0AppearingObjectCount);
assert.equal(manifest.stateTransition.frame0SuppressedAbsentMaskCount, absent);
assert.equal(manifest.stateTransition.noObjectMaskScore, -1024);

console.log('sam3.1 two-frame tracker official meta-packet contracts passed');
