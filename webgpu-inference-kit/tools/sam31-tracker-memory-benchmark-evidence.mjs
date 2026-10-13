import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function compareSam31TrackerMemoryOutputs(reference, actual) {
  assert(reference instanceof Float32Array && actual instanceof Float32Array && reference.length === actual.length && reference.length > 0, 'comparison requires equal nonempty f32 lengths');
  let maxAbsDiff = 0, maxAbsIndex = 0, sumAbs = 0, sumSquare = 0, referenceSquare = 0;
  let binaryMismatchCount = 0, differentElementCount = 0;
  for (let i = 0; i < reference.length; i += 1) {
    assert(Number.isFinite(reference[i]) && Number.isFinite(actual[i]), 'comparison requires finite output');
    const difference = Math.abs(reference[i] - actual[i]);
    if (difference > maxAbsDiff) { maxAbsDiff = difference; maxAbsIndex = i; }
    sumAbs += difference; sumSquare += difference * difference; referenceSquare += reference[i] * reference[i];
    differentElementCount += reference[i] !== actual[i] ? 1 : 0;
    binaryMismatchCount += (reference[i] > 0) !== (actual[i] > 0) ? 1 : 0;
  }
  const count = reference.length;
  return { elementCount: count, maxAbsDiff, maxAbsIndex, meanAbsDiff: sumAbs / count,
    rootMeanSquareDiff: Math.sqrt(sumSquare / count),
    relativeL2Diff: referenceSquare > 0 ? Math.sqrt(sumSquare / referenceSquare) : sumSquare === 0 ? 0 : null,
    relativeL2Undefined: referenceSquare === 0 && sumSquare > 0,
    relativeDiffAtMaxAbsDiff: reference[maxAbsIndex] !== 0 ? maxAbsDiff / Math.abs(reference[maxAbsIndex]) : maxAbsDiff === 0 ? 0 : null,
    differentElementCount, binaryMismatchCount };
}

// Admission for this fixed two-frame comparison, not a general tracker certificate.
export function validateSam31TrackerMemoryBenchmarkRun(result, outputs, expected) {
  const check = (condition, name) => assert(condition, `tracker benchmark: ${name}`);
  check(result.adapterInfo?.isFallbackAdapter === false, 'native nonfallback adapter');
  check(result.memoryAttentionKernel === expected.mode, 'effective memory kernel');
  check(result.evidence?.passed === true, 'complete runtime evidence');
  const geometry = result.manifest?.executionGeometry;
  for (const key of ['imageHeight', 'imageWidth', 'queryHeight', 'queryWidth', 'queryTokens', 'memoryTokens']) {
    check(geometry?.[key] === expected[key], `effective ${key}`);
  }
  check(geometry.decoderMaskHeight === expected.maskHeight && geometry.decoderMaskWidth === expected.maskWidth, 'decoder mask geometry');
  const packageRuntime = result.packageRuntime;
  check(packageRuntime?.packageId === expected.modelPackageId, 'model package');
  check(packageRuntime.sourceImageSha256?.length === 2 && packageRuntime.sourceImageSha256.every(x => typeof x === 'string' && x.length > 0), 'source image identities');
  check(typeof packageRuntime.initialMaskSha256 === 'string' && packageRuntime.initialMaskSha256.length > 0, 'initial mask identity');
  const routes = result.requestedRouteIds;
  check(routes?.length === 19 && routes.every(id => typeof id === 'string' && id.length > 0), 'complete requested routes');
  check(result.effectiveRouteIds?.length === routes.length && result.effectiveRouteIds.every((id, i) => id === routes[i]), 'effective route chain');
  check(result.receipts?.length === routes.length, 'complete route receipts');
  result.receipts.forEach((receipt, i) => {
    check(receipt.requestedRouteId === routes[i] && receipt.effectiveRouteId === routes[i], `route ${i} identity`);
    check(receipt.status === 'real' && receipt.fallbackReason == null, `route ${i} real execution`);
    check(receipt.kernel?.commit === expected.commit, `route ${i} source`);
    check(receipt.outputs?.length > 0 && receipt.outputs.every(x => x.status === 'real' && typeof x.sha256 === 'string' && x.sha256.length > 0), `route ${i} output identity`);
  });
  const memory = result.receipts.find(x => x.effectiveRouteId === 'sam3.1.memory-attention.phase-program.webgpu-local.v0');
  check(memory, 'memory route');
  const stages = memory.timings?.stages ?? [];
  for (let layer = 0; layer < 4; layer += 1) {
    for (const kind of ['Self', 'Cross']) {
      const name = `layer${layer}${kind}Attention${expected.mode === 'flash' ? 'Flash0' : ''}`;
      check(stages.filter(x => x.metadata?.kernelName === name).length === 1, `effective ${name}`);
    }
  }
  const resident = result.residentRuntime;
  check(resident?.modelPackageId === expected.modelPackageId && typeof resident.residentSessionId === 'string' && resident.residentSessionId.length > 0, 'resident model and session');
  check(resident.resourceCount === 1007 && resident.liveBufferIds?.length === resident.resourceCount && new Set(resident.liveBufferIds).size === resident.resourceCount && resident.truncated === false, 'complete resident buffers');
  check(resident.modelAllocationDelta === 0 && resident.modelUploadDelta === 0, 'resident model reuse');
  const lengths = {
    conditionedFeatures: expected.queryTokens * expected.channels,
    selectedMasks: expected.multiplexCount * expected.maskHeight * expected.maskWidth,
    objectScores: expected.multiplexCount,
    objectPointers: expected.multiplexCount * expected.channels,
  };
  const roles = {
    conditionedFeatures: 'sam31-memory-conditioned-features',
    selectedMasks: 'sam31-multiplex-selected-masks',
    objectScores: 'sam31-multiplex-object-scores',
    objectPointers: 'sam31-multiplex-object-pointers',
  };
  for (const [name, length] of Object.entries(lengths)) {
    const array = outputs[name];
    check(array instanceof Float32Array && array.length === length, `${name} complete f32 output`);
    check(array.every(Number.isFinite), `${name} finite output`);
    const receipt = name === 'conditionedFeatures' ? memory : result.receipts.at(-1);
    const artifacts = receipt.outputs.filter(x => x.role === roles[name]);
    check(artifacts.length === 1, `${name} actual readback artifact`);
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    check(digest === artifacts[0].sha256, `${name} readback identity`);
  }
  check(outputs.conditionedFeatures.some(x => x !== 0), 'nonblank conditioned features');
  const timing = result.timing;
  check(timing?.kind === 'host-wall' && Number.isFinite(timing.episodeWallMs) && timing.episodeWallMs > 0, 'host-wall episode timing');
  const frame = timing.frame1;
  const parts = ['backboneMs', 'temporalBankMs', 'memoryAttentionMs', 'decoderMs'].map(key => frame?.[key]);
  check(parts.every(x => Number.isFinite(x) && x >= 0), 'frame timing components');
  const total = parts.reduce((a, b) => a + b, 0);
  check(total > 0 && Number.isFinite(frame.attributedTotalMs) && Math.abs(frame.attributedTotalMs - total) <= total * 1e-9, 'attributed frame total');
  check(Number.isFinite(frame.memoryAttentionShare) && Math.abs(frame.memoryAttentionShare - frame.memoryAttentionMs / total) <= 1e-9, 'memory share');
  return { passed: true, memoryAttentionMs: frame.memoryAttentionMs, attributedTotalMs: total, memoryAttentionShare: frame.memoryAttentionShare };
}
