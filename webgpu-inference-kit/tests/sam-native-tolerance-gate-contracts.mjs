// The SAM native tolerance gate must fail on each plausible false pass
// (Sammy's 2026-10-11 counterexamples included): wrong or empty geometry,
// non-finite or surplus values, an unchecked selected mask or non-selected
// instance logits, logits outside the exact sourced envelope, unbound
// report/reference identity, and a tampered reference chain.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareSamNativeOutput, admitSamNativeReport, SAM_NATIVE_TOLERANCE_GATE } from '../tools/sam-native-tolerance-gate.mjs';

// The envelope is the exact accepted September value, not rounded or widened.
assert.equal(SAM_NATIVE_TOLERANCE_GATE.logitMaxAbs, 0.03934288024902344);
assert.equal(SAM_NATIVE_TOLERANCE_GATE.logitRelativeL2, 0.0013340627487153753);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-gate-'));
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const W = 3, H = 2, plane = W * H, candidates = 3;
const tensors = [];
const write = (file, typed, dtype, shape) => {
  const bytes = Buffer.from(typed.buffer);
  fs.writeFileSync(path.join(dir, file), bytes);
  tensors.push({ file, dtype, shape, sha256: sha(bytes) });
};
const logits = new Float32Array(candidates * plane).map((_, i) => (i % 2 ? 1 : -1) * (1 + i / 4));
const masks = new Uint32Array(logits.length).map((_, i) => (logits[i] > 0 ? 1 : 0));
write('expected-mask-logits.f32.bin', logits, 'float32', [1, candidates, H, W]);
write('expected-binary-mask.u32.bin', masks, 'uint32', [1, candidates, H, W]);
write('expected-selection-scores.f32.bin', new Float32Array([0.9, 0.2, 0.8]), 'float32', [1, candidates]);
write('expected-selection-boxes.f32.bin', new Float32Array(candidates * 4).fill(0.5), 'float32', [1, candidates, 4]);
write('expected-selection-keep.u32.bin', new Uint32Array([1, 0, 1]), 'uint32', [1, candidates]);
write('expected-selected-index.u32.bin', new Uint32Array([0]), 'uint32', [1]);
const observations = Buffer.from(JSON.stringify({ tensors }));
fs.writeFileSync(path.join(dir, 'sam3-reference-observations.json'), observations);
const invocation = Buffer.from(JSON.stringify({ prompt: { text: 'wheel' }, sourceImage: { sha256: 'sha256:truck' } }));
fs.writeFileSync(path.join(dir, 'sam3-invocation.json'), invocation);
const manifest = Buffer.from(JSON.stringify({ routeId: 'sam3.route', referenceObservations: { file: 'sam3-reference-observations.json', sha256: sha(observations) },
  invocation: { file: 'sam3-invocation.json', sha256: sha(invocation) } }));
fs.writeFileSync(path.join(dir, 'tensor-manifest.json'), manifest);

const plane0 = index => [...logits.subarray(index * plane, (index + 1) * plane)].map(v => v + 0.001);
const instance = index => ({ index, score: [0.9, 0.2, 0.8][index], box: [0.5, 0.5, 0.5, 0.5],
  mask: [...masks.subarray(index * plane, (index + 1) * plane)], logits: Object.fromEntries(plane0(index).map((v, i) => [String(i), v])) });
const output = () => ({ width: W, height: H, selectedMaskIndex: 0, selectedScore: 0.9, instances: [instance(0), instance(2)],
  logits: plane0(0), mask: [...masks.subarray(0, plane)], promptText: 'wheel', outputAuthority: 'actual-webgpu-readback',
  effectiveRouteId: 'sam3.route', receiptChain: ['a'], invocationId: 'inv' });
const passes = out => compareSamNativeOutput(out, dir).passed;
assert.equal(passes(output()), true, 'good output passes');

// P1 geometry/completeness.
assert.equal(passes({ ...output(), width: 0, logits: [], mask: [], instances: output().instances.map(i => ({ ...i, mask: [], logits: {} })) }), false, 'empty planes fail');
assert.equal(passes({ ...output(), width: 2, height: 3 }), false, 'wrong-shaped planes fail');
const nan = output(); nan.logits = [...nan.logits, NaN];
assert.equal(passes(nan), false, 'surplus value fails');
const inf = output(); inf.instances[1].logits['2'] = Infinity;
assert.equal(passes(inf), false, 'non-finite instance logit fails');
// P1 coverage.
assert.equal(passes({ ...output(), mask: [] }), false, 'missing selected mask fails');
const noLogits = output(); noLogits.instances[1].logits = {};
assert.equal(passes(noLogits), false, 'missing non-selected instance logits fail');
const drifted = output(); drifted.instances[1].logits['0'] += 0.05;
assert.equal(passes(drifted), false, 'non-selected instance logits are gated');
const flipped = output(); flipped.instances[1].mask[0] ^= 1;
assert.equal(passes(flipped), false, 'flipped mask pixel fails');
assert.equal(passes({ ...output(), instances: [instance(0)] }), false, 'dropped instance fails');
assert.equal(passes({ ...output(), selectedMaskIndex: 2 }), false, 'wrong selection fails');
assert.equal(passes({ ...output(), selectedScore: 0.5 }), false, 'selected score must match its instance');
// P2 envelope: 0.042 must not pass.
const wide = output(); wide.logits[0] += 0.042; wide.instances[0].logits['0'] += 0.042;
assert.equal(passes(wide), false, 'error above the sourced 0.03934288 envelope fails');

// P2 authority at admission: identity bound to the authenticated packet chain.
const manifestSha = sha(manifest);
const report = mutate => {
  const positive = output();
  const base = { status: 'passed', requestedPrompt: 'wheel', routeRegistration: { commit: 'c', requestedCommit: 'c', manifestSha256: manifestSha, samples: { 'truck.jpg': 'sha256:truck' } },
    coldWallMilliseconds: 1, visualEvidence: { output: positive },
    warmPositive: { wallMilliseconds: 1, visualEvidence: { output: output() } },
    negativeControl: { visualEvidence: { output: { ...output(), promptText: 'none', instances: [], selectedMaskIndex: -1, mask: new Array(plane).fill(0), logits: new Array(plane).fill(-5) } } } };
  mutate?.(base);
  return base;
};
assert.equal(admitSamNativeReport(report(), dir).passed, true, 'good report admitted');
assert.equal(admitSamNativeReport(report(r => { r.visualEvidence.output.promptText = 'wrong'; }), dir).passed, false, 'wrong prompt fails');
assert.equal(admitSamNativeReport(report(r => { r.visualEvidence.output.outputAuthority = 'demo'; }), dir).passed, false, 'non-readback authority fails');
assert.equal(admitSamNativeReport(report(r => { r.visualEvidence.output.receiptChain = []; }), dir).passed, false, 'empty receipt chain fails');
assert.equal(admitSamNativeReport(report(r => { r.routeRegistration.manifestSha256 = 'sha256:other'; }), dir).passed, false, 'report bound to another packet fails');
assert.equal(admitSamNativeReport(report(r => { r.routeRegistration.samples['truck.jpg'] = 'sha256:other'; }), dir).passed, false, 'different source image fails');
assert.equal(admitSamNativeReport(report(r => { r.warmPositive.visualEvidence.output.instances[1].mask[0] ^= 1; }), dir).passed, false, 'warm output is gated too');
assert.equal(admitSamNativeReport(report(r => { r.negativeControl.visualEvidence.output.instances = [instance(0)]; }), dir).passed, false, 'negative control must keep nothing');
fs.writeFileSync(path.join(dir, 'sam3-reference-observations.json'), Buffer.from(JSON.stringify({ tensors: tensors.slice(1) })));
assert.throws(() => compareSamNativeOutput(output(), dir), /reference observations hash/, 'tampered observations rejected through the manifest');
fs.rmSync(dir, { recursive: true, force: true });
console.log('sam native tolerance gate contracts: passed');
