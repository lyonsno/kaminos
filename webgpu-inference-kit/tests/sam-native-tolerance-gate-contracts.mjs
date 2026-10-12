// The SAM native tolerance gate must fail on each plausible false pass:
// a flipped mask pixel, a dropped retained instance, a wrong selected index,
// logits outside the envelope, and a tampered reference tensor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareSamNativeOutput } from '../tools/sam-native-tolerance-gate.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-gate-'));
const W = 2, H = 2, plane = W * H, candidates = 3;
const tensors = [];
const write = (file, typed, dtype, shape) => {
  const bytes = Buffer.from(typed.buffer);
  fs.writeFileSync(path.join(dir, file), bytes);
  tensors.push({ file, dtype, shape, sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
};
const logits = new Float32Array(candidates * plane).map((_, i) => (i % 2 ? 1 : -1) * (i + 1));
const masks = new Uint32Array(logits.length).map((_, i) => (logits[i] > 0 ? 1 : 0));
write('expected-mask-logits.f32.bin', logits, 'float32', [1, candidates, H, W]);
write('expected-binary-mask.u32.bin', masks, 'uint32', [1, candidates, H, W]);
write('expected-selection-scores.f32.bin', new Float32Array([0.9, 0.2, 0.8]), 'float32', [1, candidates]);
write('expected-selection-boxes.f32.bin', new Float32Array(candidates * 4).fill(0.5), 'float32', [1, candidates, 4]);
write('expected-selection-keep.u32.bin', new Uint32Array([1, 0, 1]), 'uint32', [1, candidates]);
write('expected-selected-index.u32.bin', new Uint32Array([0]), 'uint32', [1]);
fs.writeFileSync(path.join(dir, 'sam3-reference-observations.json'), JSON.stringify({ tensors }));

const instance = index => ({ index, score: [0.9, 0.2, 0.8][index], box: [0.5, 0.5, 0.5, 0.5], mask: [...masks.subarray(index * plane, (index + 1) * plane)] });
const good = () => ({ width: W, height: H, selectedMaskIndex: 0, instances: [instance(0), instance(2)], logits: [...logits.subarray(0, plane)].map(v => v + 0.001) });
assert.equal(compareSamNativeOutput(good(), dir).passed, true);

const flipped = good(); flipped.instances[1].mask[0] ^= 1;
assert.equal(compareSamNativeOutput(flipped, dir).checks.masksIdentical, false);
const dropped = good(); dropped.instances.pop();
assert.equal(compareSamNativeOutput(dropped, dir).checks.sameRetainedSet, false);
const wrongSelected = good(); wrongSelected.selectedMaskIndex = 2;
assert.equal(compareSamNativeOutput(wrongSelected, dir).checks.sameSelectedIndex, false);
const drifted = good(); drifted.logits[0] += 0.05;
assert.equal(compareSamNativeOutput(drifted, dir).checks.selectedLogitMaxAbs, false);
const scored = good(); scored.instances[0].score += 1e-3;
assert.equal(compareSamNativeOutput(scored, dir).checks.scores, false);
fs.writeFileSync(path.join(dir, 'expected-selection-scores.f32.bin'), Buffer.from(new Float32Array([0.9, 0.2, 0.7]).buffer));
assert.throws(() => compareSamNativeOutput(good(), dir), /hash mismatch/);
fs.rmSync(dir, { recursive: true, force: true });
console.log('sam native tolerance gate contracts: passed');
