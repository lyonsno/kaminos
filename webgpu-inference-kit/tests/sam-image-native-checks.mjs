import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function validateSamImageCases(inputs) {
  assert.ok(Array.isArray(inputs) && inputs.length > 0, 'case list required');
  const names = new Set();
  for (const input of inputs) {
    assert.match(input.name, /^[a-z0-9-]+$/);
    assert.ok(!names.has(input.name), `duplicate case name: ${input.name}`);
    names.add(input.name);
  }
}

export function collectSamImageTrial() {
  const trial = window.samTrial, app = window.samImageExample;
  if (!trial || !app) return null;
  const { output, ...snapshot } = app.snapshot();
  const result = trial.output || output;
  return { startedAt: trial.startedAt, completedAt: trial.completedAt, done: trial.done,
    wallMilliseconds: trial.completedAt - trial.startedAt, frames: trial.frames, phases: trial.phases,
    error: trial.error || snapshot.error, adapter: window.samAdapters.at(-1), snapshot,
    invocationId: result?.invocationId, foreground: snapshot.foreground,
    outputAvailable: Boolean(trial.output),
    outputMetadata: result ? { invocationId: result.invocationId, outputAuthority: result.outputAuthority,
      verificationState: result.verificationState, requestedRouteId: result.requestedRouteId,
      effectiveRouteId: result.effectiveRouteId, width: result.width, height: result.height,
      selectedCandidateCount: result.selectedCandidateCount, instanceCount: result.instances?.length,
      maskLength: result.mask?.length, logitsLength: result.logits?.length,
      receiptCount: result.receiptChain?.length } : null };
}

export async function finalizeSamImageFailure(report, error, collect, persist = async () => {}, transfer = async () => {}) {
  report.error = { message: error.message, stack: error.stack };
  try {
    const collected = await collect();
    if (collected) {
      const existing = report.runs.find(row => row.name === collected.name);
      if (existing) Object.assign(existing, collected);
      else report.runs.push(collected);
    }
  } catch (collectionError) { report.collectionError = collectionError.message; }
  const row = report.runs.find(row => row.name === report.phase);
  if (row) row.validation = { status: 'failed', partial: true, message: error.message };
  try { await persist(); } catch (persistError) { report.persistError = persistError.message; }
  if (row) {
    try { await transfer(row); } catch (artifactError) { row.artifactError = artifactError.message; }
  }
  try { await persist(); } catch (persistError) { report.persistError = persistError.message; }
}

export function validateSamImageRun(row, expected) {
  const { output, adapter } = row;
  assert.equal(adapter?.isFallbackAdapter, false, 'native adapter evidence required');
  assert.equal(adapter?.vendor, 'apple', 'expected Apple native comparison');
  assert.equal(output?.outputAuthority, 'actual-webgpu-readback', 'actual readback required');
  assert.equal(output.verificationState, 'not-attached', 'execution-only route required');
  assert.equal(output.invocationId, expected.invocationId, 'stale invocation');
  assert.equal(output.sourceImage?.sha256, expected.sourceSha256, 'source identity changed');
  assert.equal(output.promptText, expected.prompt, 'prompt changed');
  assert.equal(output.promptSha256, `sha256:${createHash('sha256').update(expected.prompt).digest('hex')}`, 'prompt digest changed');
  assert.equal(output.imageCache?.status, expected.cache, 'wrong cache route');
  assert.equal(output.requestedRouteId, output.effectiveRouteId, 'route fallback');
  assert.ok(output.effectiveRouteId?.includes('.webgpu-local.'), 'missing native route');
  assert.ok(Array.isArray(output.receiptChain) && output.receiptChain.length === 13, 'incomplete route chain');
  assert.equal(new Set(output.receiptChain).size, 13, 'duplicate route chain');
  assert.deepEqual([output.width, output.height], expected.maskSize, 'mask resolution changed');
  assert.ok(Array.isArray(output.instances), 'missing instances');
  assert.equal(output.instances.length, output.selectedCandidateCount, 'partial instances');
  assert.equal(output.instances.length === 0, expected.empty, 'unexpected empty/positive result');
  const count = output.width * output.height;
  const indices = new Set();
  for (const instance of output.instances) {
    assert.ok(Number.isInteger(instance.index) && !indices.has(instance.index), 'duplicate instance');
    indices.add(instance.index);
    assert.ok(Number.isFinite(instance.score) && instance.box.length === 4 && instance.box.every(Number.isFinite), 'invalid score/box');
    assert.equal(instance.logits?.length, count, 'partial logits');
    assert.equal(instance.mask?.length, count, 'partial mask');
    assert.ok(instance.logits.every(Number.isFinite), 'nonfinite logits');
    assert.ok(instance.mask.every((value, i) => value === Number(instance.logits[i] > 0)), 'mask/logit disagreement');
  }
  assert.equal(output.mask?.length, count, 'partial selected mask');
  assert.equal(output.logits?.length, count, 'partial selected logits');
  assert.ok(output.logits.every(Number.isFinite), 'nonfinite selected logits');
  assert.ok(output.mask.every((value, i) => value === Number(output.logits[i] > 0)), 'selected mask/logit disagreement');
  assert.ok(Number.isFinite(row.wallMilliseconds) && row.wallMilliseconds > 0, 'missing timing');
}
