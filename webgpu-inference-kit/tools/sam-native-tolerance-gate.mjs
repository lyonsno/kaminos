// SAM native serving-output gate against the authenticated MLX packet
// (operator decision 2026-10-11): retained instances, selected index and every
// retained binary mask must match MLX exactly; logits, scores and boxes must
// stay within a tolerance envelope. Thresholds were set before the first run
// they gate, from the last accepted native run (selected-logit maxAbs 0.0393,
// relL2 0.00133; scores ~1e-7; boxes ~1e-4) plus headroom.
// Usage: node tools/sam-native-tolerance-gate.mjs --report <witness report.json>
//          --packet <packet dir> --out <gate.json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export const SAM_NATIVE_TOLERANCE_GATE = Object.freeze({
  selectedLogitMaxAbs: 0.045, selectedLogitRelativeL2: 0.002, scoreAbs: 1e-4, boxAbs: 1e-3,
});

function stats(actual, expected) {
  let maxAbs = 0, sum = 0, sq = 0, ref = 0, unequal = 0;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    if (d !== 0) unequal++;
    maxAbs = Math.max(maxAbs, d); sum += d; sq += d * d; ref += expected[i] * expected[i];
  }
  return { count: expected.length, maxAbsDiff: maxAbs, meanAbsDiff: sum / expected.length, relativeL2: Math.sqrt(sq / (ref || 1)), unequal };
}

export function compareSamNativeOutput(output, packetDir, gate = SAM_NATIVE_TOLERANCE_GATE) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packetDir, 'sam3-reference-observations.json'), 'utf8'));
  const tensor = file => {
    const row = manifest.tensors.find(item => item.file === file);
    if (!row) throw new Error(`reference tensor ${file} missing from packet`);
    const bytes = fs.readFileSync(path.join(packetDir, file));
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== row.sha256) throw new Error(`reference tensor ${file} hash mismatch`);
    const view = row.dtype === 'uint32' ? new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    return { view, shape: row.shape };
  };
  const plane = output.width * output.height;
  const keep = tensor('expected-selection-keep.u32.bin').view;
  const expectedIndices = [...keep.keys()].filter(index => keep[index] !== 0);
  const actualIndices = output.instances.map(instance => instance.index).sort((a, b) => a - b);
  const expectedSelected = tensor('expected-selected-index.u32.bin').view[0];
  const logits = tensor('expected-mask-logits.f32.bin').view;
  const masks = tensor('expected-binary-mask.u32.bin').view;
  const scores = tensor('expected-selection-scores.f32.bin').view;
  const boxes = tensor('expected-selection-boxes.f32.bin').view;
  const selectedLogits = stats(output.logits, logits.subarray(expectedSelected * plane, (expectedSelected + 1) * plane));
  const instances = output.instances.map(instance => {
    const mask = stats(instance.mask, masks.subarray(instance.index * plane, (instance.index + 1) * plane));
    return { index: instance.index, scoreAbsDiff: Math.abs(instance.score - scores[instance.index]),
      box: stats(instance.box, boxes.subarray(instance.index * 4, instance.index * 4 + 4)), maskUnequal: mask.unequal };
  });
  const checks = {
    sameRetainedSet: JSON.stringify(actualIndices) === JSON.stringify(expectedIndices),
    sameSelectedIndex: output.selectedMaskIndex === expectedSelected,
    masksIdentical: instances.every(instance => instance.maskUnequal === 0),
    selectedLogitMaxAbs: selectedLogits.maxAbsDiff <= gate.selectedLogitMaxAbs,
    selectedLogitRelativeL2: selectedLogits.relativeL2 <= gate.selectedLogitRelativeL2,
    scores: instances.every(instance => instance.scoreAbsDiff <= gate.scoreAbs),
    boxes: instances.every(instance => instance.box.maxAbsDiff <= gate.boxAbs),
  };
  return { gate, checks, passed: Object.values(checks).every(Boolean), actualIndices, expectedIndices,
    selectedIndex: output.selectedMaskIndex, expectedSelected, selectedLogits, instances };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { report: { type: 'string' }, packet: { type: 'string' }, out: { type: 'string' } } });
  const result = { schema: 'kaminos.sam-native-tolerance-gate.v0', status: 'failed', report: values.report, packet: values.packet };
  try {
    const report = JSON.parse(fs.readFileSync(values.report, 'utf8'));
    if (report.status !== 'passed') throw new Error(`witness report status ${report.status}`);
    result.reportSha256 = `sha256:${createHash('sha256').update(fs.readFileSync(values.report)).digest('hex')}`;
    result.commit = report.routeRegistration?.commit ?? null;
    result.coldMs = report.coldWallMilliseconds ?? null;
    result.warmMs = report.warmPositive?.wallMilliseconds ?? report.warmPositive?.coldWallMilliseconds ?? null;
    result.comparison = compareSamNativeOutput(report.visualEvidence.output, values.packet);
    result.status = result.comparison.passed ? 'passed' : 'failed-gate';
  } catch (error) {
    result.error = String(error?.stack ?? error);
  }
  if (values.out) fs.writeFileSync(values.out, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ status: result.status, checks: result.comparison?.checks, selectedLogits: result.comparison?.selectedLogits, error: result.error ?? null }));
  if (result.status !== 'passed') process.exitCode = 1;
}
