// SAM native serving-output gate against the authenticated MLX packet
// (operator decision 2026-10-11: reference tolerance replaces run-to-run
// WebGPU exactness for the reduction-order change in the ViT projections).
//
// compareSamNativeOutput: geometry from the packet's own shapes (exact plane
// size, lengths, finite values, binary masks); retained set, selection and
// every retained binary mask exact; every retained instance's logit plane and
// the selected output's logits within the envelope; selected output mask and
// score consistent with the selected instance; scores and boxes within bounds.
// admitSamNativeReport: binds a witness report to the authenticated packet
// chain (tensor-manifest -> reference observations / invocation / model
// package hashes), the invocation's prompt and source image, the manifest
// route and actual WebGPU readback authority. Every output (cold, warm,
// negative) must carry execution identity matching the packet: the verified
// model package, the registered commit, and the source image recorded in its
// image-feature cache key, plus a receipt chain containing every SAM 3 composition stage.
// Cold and warm positives are gated numerically; the negative control must be
// the workbench's different-prompt invocation, keep nothing, and report a
// truthful empty selection.
//
// Envelope: the exact selected-logit error of the last accepted native run
// (~/.local/state/sammy-sam31-return-0915/native1008-tiled-linear-r3/
// numerical-comparison.json: maxAbs 0.03934288024902344, relL2
// 0.0013340627487153753), applied to every retained plane. Changing it needs
// an explicit operator amendment.
// Usage: node tools/sam-native-tolerance-gate.mjs --report <witness report.json>
//          --packet <packet dir> --out <gate.json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

export const SAM_NATIVE_TOLERANCE_GATE = Object.freeze({
  logitMaxAbs: 0.03934288024902344, logitRelativeL2: 0.0013340627487153753, scoreAbs: 1e-4, boxAbs: 1e-3,
  source: 'sammy-sam31-return-0915/native1008-tiled-linear-r3/numerical-comparison.json selected.logits (accepted 2026-09-20)',
});

// The workbench's fixed negative-control prompt (smokes/sam-semantic-mask-workbench.js runMask).
export const SAM_WORKBENCH_NEGATIVE_PROMPT = 'a purple submarine with zebra stripes';
// Every stage of the SAM 3 image-to-mask composition (observed identically on cold, cached-warm and negative
// native runs). Completeness is membership of all of them; additive stages and cache-reuse receipts may
// appear beside them, fallback or demo routes may not.
export const SAM3_REQUIRED_COMPOSITION_RECEIPTS = Object.freeze([
  'image-preprocess', 'image-patch-embed', 'image-vit-prefix', 'image-vit-block-stack', 'image-fpn-neck',
  'prompt-text-ingress', 'detr-encoder', 'prompt-fpn', 'pixel-decoder', 'detr-decoder', 'scoring',
  'selection-postprocess', 'mask-tail',
].map(stage => `sam3.${stage}.phase-program.webgpu-local.v0`));
const NON_LIVE_RECEIPT = /fallback|demo/i;
const IMAGE_CACHE_KEY_PREFIX = 'sam3-image-features:';

const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, json: JSON.parse(bytes.toString('utf8')) };
}

// Load the reference packet through its manifest: observations and invocation
// must match the manifest's hashes, and each tensor the observations' hashes.
export function loadSamReferencePacket(packetDir) {
  const manifestFile = readJson(path.join(packetDir, 'tensor-manifest.json'));
  const manifest = manifestFile.json;
  const pinned = (entry, label) => {
    if (!entry?.file || !entry?.sha256) throw new Error(`manifest ${label} entry missing`);
    const file = readJson(path.join(packetDir, entry.file));
    if (sha(file.bytes) !== entry.sha256) throw new Error(`reference ${label} hash does not match the manifest`);
    return file.json;
  };
  const observations = pinned(manifest.referenceObservations, 'observations');
  const invocation = manifest.invocation ? pinned(manifest.invocation, 'invocation') : null;
  const modelPackage = manifest.modelPackage ? pinned(manifest.modelPackage, 'model package') : null;
  const tensor = file => {
    const row = observations.tensors.find(item => item.file === file);
    if (!row) throw new Error(`reference tensor ${file} missing from packet`);
    const bytes = fs.readFileSync(path.join(packetDir, file));
    if (sha(bytes) !== row.sha256) throw new Error(`reference tensor ${file} hash mismatch`);
    const view = row.dtype === 'uint32' ? new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      : new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    if (view.length !== row.shape.reduce((a, b) => a * b, 1)) throw new Error(`reference tensor ${file} length does not match its shape`);
    return { view, shape: row.shape };
  };
  return { manifest, manifestSha256: sha(manifestFile.bytes), observations, invocation, modelPackage, tensor };
}

// Arrays or index-keyed objects (serialized typed arrays) of exactly `length` finite values.
function plane(values, length, label) {
  if (values == null) throw new Error(`${label} missing`);
  let out;
  if (Array.isArray(values)) out = values;
  else if (typeof values === 'object') {
    const keys = Object.keys(values);
    if (keys.length !== length || keys.some((key, i) => key !== String(i))) throw new Error(`${label} is not a dense ${length}-value plane`);
    out = keys.map(key => values[key]);
  } else throw new Error(`${label} is not an array`);
  if (out.length !== length) throw new Error(`${label} has ${out.length} values, expected ${length}`);
  if (!out.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error(`${label} has non-finite values`);
  return out;
}

function stats(actual, expected) {
  let maxAbs = 0, sq = 0, ref = 0, unequal = 0;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    if (d !== 0) unequal++;
    maxAbs = Math.max(maxAbs, d); sq += d * d; ref += expected[i] * expected[i];
  }
  return { count: expected.length, maxAbsDiff: maxAbs, relativeL2: Math.sqrt(sq / (ref || 1)), unequal };
}

export function compareSamNativeOutput(output, packet, gate = SAM_NATIVE_TOLERANCE_GATE) {
  const reference = typeof packet === 'string' ? loadSamReferencePacket(packet) : packet;
  const result = { gate, checks: {}, passed: false };
  try {
    const logitsRef = reference.tensor('expected-mask-logits.f32.bin');
    const [, candidates, height, width] = logitsRef.shape;
    const area = width * height;
    result.checks.geometry = output.width === width && output.height === height;
    if (!result.checks.geometry) throw new Error(`output ${output.width}x${output.height} does not match reference ${width}x${height}`);
    const masks = reference.tensor('expected-binary-mask.u32.bin').view;
    const scores = reference.tensor('expected-selection-scores.f32.bin').view;
    const boxes = reference.tensor('expected-selection-boxes.f32.bin').view;
    const keep = reference.tensor('expected-selection-keep.u32.bin').view;
    const expectedSelected = reference.tensor('expected-selected-index.u32.bin').view[0];
    const expectedIndices = [...keep.keys()].filter(index => keep[index] !== 0);
    if (!Array.isArray(output.instances)) throw new Error('instances missing');
    const actualIndices = output.instances.map(instance => instance.index).sort((a, b) => a - b);
    result.actualIndices = actualIndices; result.expectedIndices = expectedIndices;
    result.checks.sameRetainedSet = JSON.stringify(actualIndices) === JSON.stringify(expectedIndices);
    result.checks.sameSelectedIndex = output.selectedMaskIndex === expectedSelected;
    const within = s => s.maxAbsDiff <= gate.logitMaxAbs && s.relativeL2 <= gate.logitRelativeL2;
    result.instances = output.instances.map(instance => {
      if (!Number.isInteger(instance.index) || instance.index < 0 || instance.index >= candidates) throw new Error(`instance index ${instance.index} out of range`);
      const at = instance.index * area;
      const mask = plane(instance.mask, area, `instance ${instance.index} mask`);
      if (!mask.every(value => value === 0 || value === 1)) throw new Error(`instance ${instance.index} mask is not binary`);
      const logits = stats(plane(instance.logits, area, `instance ${instance.index} logits`), logitsRef.view.subarray(at, at + area));
      const box = stats(plane(instance.box, 4, `instance ${instance.index} box`), boxes.subarray(instance.index * 4, instance.index * 4 + 4));
      return { index: instance.index, maskUnequal: stats(mask, masks.subarray(at, at + area)).unequal, logits,
        scoreAbsDiff: Math.abs(instance.score - scores[instance.index]), boxMaxAbs: box.maxAbsDiff };
    });
    result.checks.masksIdentical = result.instances.every(instance => instance.maskUnequal === 0);
    result.checks.instanceLogits = result.instances.every(instance => within(instance.logits));
    result.checks.scores = result.instances.every(instance => instance.scoreAbsDiff <= gate.scoreAbs);
    result.checks.boxes = result.instances.every(instance => instance.boxMaxAbs <= gate.boxAbs);
    const at = expectedSelected * area;
    const selectedMask = plane(output.mask, area, 'selected mask');
    result.checks.selectedMask = stats(selectedMask, masks.subarray(at, at + area)).unequal === 0;
    result.selectedLogits = stats(plane(output.logits, area, 'selected logits'), logitsRef.view.subarray(at, at + area));
    result.checks.selectedLogits = within(result.selectedLogits);
    const selected = output.instances.find(instance => instance.index === output.selectedMaskIndex);
    result.checks.selectedScoreConsistent = Boolean(selected) && output.selectedScore === selected.score;
    result.maxInstanceLogitAbs = Math.max(0, ...result.instances.map(instance => instance.logits.maxAbsDiff));
  } catch (error) {
    result.error = String(error?.message ?? error);
    result.checks.complete = false;
  }
  result.passed = !result.error && Object.values(result.checks).every(Boolean);
  return result;
}

// Negative control: the workbench's different-prompt invocation, same geometry,
// nothing kept, a truthful empty selection, empty mask, finite logits.
function checkNegative(output, reference) {
  const result = { checks: {}, passed: false };
  try {
    const [, , height, width] = reference.tensor('expected-mask-logits.f32.bin').shape;
    const area = width * height;
    result.checks.prompt = output.promptText === SAM_WORKBENCH_NEGATIVE_PROMPT && output.promptText !== reference.invocation?.prompt?.text;
    result.checks.geometry = output.width === width && output.height === height;
    result.checks.nothingKept = Array.isArray(output.instances) && output.instances.length === 0;
    result.checks.emptySelection = output.selectedMaskIndex === null && output.selectedCandidateCount === 0
      && output.foregroundPixelCount === 0 && output.selectedScore === 0;
    result.checks.emptyMask = plane(output.mask, area, 'negative mask').every(value => value === 0);
    plane(output.logits, area, 'negative logits');
  } catch (error) { result.error = String(error?.message ?? error); }
  result.passed = !result.error && Object.values(result.checks).every(Boolean);
  return result;
}

function cacheSourceImage(output) {
  const key = output?.imageCache?.key;
  if (typeof key !== 'string' || !key.startsWith(IMAGE_CACHE_KEY_PREFIX)) return null;
  try { return JSON.parse(key.slice(IMAGE_CACHE_KEY_PREFIX.length)).sourceImageSha256 ?? null; } catch { return null; }
}

function checkAuthority(output, reference, registration, label) {
  const chain = output?.receiptChain;
  const resources = output?.imageCache?.resources;
  const packageId = reference.observations.verifiedPackageId;
  return {
    [`${label}.authority`]: output?.outputAuthority === 'actual-webgpu-readback',
    [`${label}.route`]: output?.effectiveRouteId === reference.manifest.routeId,
    [`${label}.receipts`]: Array.isArray(chain) && chain.every(id => typeof id === 'string' && !NON_LIVE_RECEIPT.test(id))
      && new Set(chain).size === chain.length && SAM3_REQUIRED_COMPOSITION_RECEIPTS.every(id => chain.includes(id)),
    [`${label}.invocation`]: typeof output?.invocationId === 'string' && output.invocationId.length > 0,
    [`${label}.modelPackage`]: typeof packageId === 'string' && packageId.length > 0
      && resources?.activeModelPackageId === packageId && resources?.modelSession?.packageId === packageId,
    [`${label}.executionCommit`]: typeof registration.commit === 'string' && resources?.modelSession?.commit === registration.commit,
    [`${label}.sourceImage`]: Boolean(reference.invocation?.sourceImage?.sha256) && cacheSourceImage(output) === reference.invocation.sourceImage.sha256,
  };
}

export function admitSamNativeReport(report, packetDir, gate = SAM_NATIVE_TOLERANCE_GATE) {
  const reference = loadSamReferencePacket(packetDir);
  const prompt = reference.invocation?.prompt?.text;
  const registration = report.routeRegistration ?? {};
  const cold = report.visualEvidence?.output;
  const warm = report.warmPositive?.visualEvidence?.output;
  const negative = report.negativeControl?.visualEvidence?.output;
  const identity = {
    reportPassed: report.status === 'passed',
    packetBound: registration.manifestSha256 === reference.manifestSha256,
    commitBound: typeof registration.commit === 'string' && registration.commit.length > 0
      && (registration.requestedCommit == null || registration.requestedCommit === registration.commit),
    promptBound: typeof prompt === 'string' && report.requestedPrompt === prompt && cold?.promptText === prompt && warm?.promptText === prompt,
    imageBound: Boolean(reference.invocation?.sourceImage?.sha256) && registration.samples?.['truck.jpg'] === reference.invocation.sourceImage.sha256,
    modelPackageBound: Boolean(reference.modelPackage),
    ...checkAuthority(cold, reference, registration, 'cold'), ...checkAuthority(warm, reference, registration, 'warm'),
    ...checkAuthority(negative, reference, registration, 'negative'),
  };
  const result = {
    gate, identity,
    cold: cold ? compareSamNativeOutput(cold, reference, gate) : { passed: false, error: 'cold output missing' },
    warm: warm ? compareSamNativeOutput(warm, reference, gate) : { passed: false, error: 'warm output missing' },
    negative: negative ? checkNegative(negative, reference) : { passed: false, error: 'negative output missing' },
    timing: { coldMs: report.coldWallMilliseconds ?? null, warmMs: report.warmPositive?.wallMilliseconds ?? null,
      negativeText: report.negativeControl?.workbench?.text ?? null },
    packet: { manifestSha256: reference.manifestSha256, routeId: reference.manifest.routeId, prompt,
      sourceImageSha256: reference.invocation?.sourceImage?.sha256 ?? null, commit: registration.commit ?? null },
  };
  result.passed = Object.values(identity).every(Boolean) && result.cold.passed && result.warm.passed && result.negative.passed;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { report: { type: 'string' }, packet: { type: 'string' }, out: { type: 'string' } } });
  const out = { schema: 'kaminos.sam-native-tolerance-gate.v1', status: 'failed', report: values.report, packet: values.packet };
  try {
    const bytes = fs.readFileSync(values.report);
    out.reportSha256 = sha(bytes);
    out.result = admitSamNativeReport(JSON.parse(bytes.toString('utf8')), values.packet);
    out.status = out.result.passed ? 'passed' : 'failed-gate';
  } catch (error) { out.error = String(error?.stack ?? error); }
  if (values.out) fs.writeFileSync(values.out, JSON.stringify(out, null, 1));
  const r = out.result;
  console.log(JSON.stringify({ status: out.status, error: out.error ?? null, identityFailed: r ? Object.entries(r.identity).filter(([, v]) => !v).map(([k]) => k) : null,
    cold: r && { passed: r.cold.passed, error: r.cold.error, selectedMaxAbs: r.cold.selectedLogits?.maxAbsDiff, maxInstanceLogitAbs: r.cold.maxInstanceLogitAbs },
    warm: r && { passed: r.warm.passed, error: r.warm.error, maxInstanceLogitAbs: r.warm.maxInstanceLogitAbs },
    negative: r && { passed: r.negative.passed, error: r.negative.error }, timing: r?.timing }));
  if (out.status !== 'passed') process.exitCode = 1;
}
