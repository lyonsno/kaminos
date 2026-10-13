import assert from 'node:assert/strict';
import * as checks from '../sparse-block-witness-checks.js';
import { buildSparseBlockPlan } from '../sparse-block.js';
assert.equal(typeof checks.validateBlockAttentionPlan, 'function', 'Native block evidence must reject silent kernel substitution.');
const config = { attentionKernel: 'tiled' }, plan = buildSparseBlockPlan(config);
const receipt = checks.validateBlockAttentionPlan(plan, config);
assert.equal(receipt.requestedKernel, 'tiled');
assert.equal(receipt.effectiveKernel, 'tiled');
assert.equal(receipt.scoresBytes, 0);
for (const bad of [undefined, {}, buildSparseBlockPlan(), { ...plan, scoresBytes: 67108864 },
  { ...plan, stages: plan.stages.filter(s => s !== 'self-attention-bf16') }]) {
  assert.throws(() => checks.validateBlockAttentionPlan(bad, config), /attention/);
}
assert.equal(checks.validateBlockAttentionPlan(buildSparseBlockPlan(), {}).effectiveKernel, 'gemm');
assert.equal(checks.validateBlockAttentionPlan({ ...plan, futureField: true }, config).effectiveKernel, 'tiled');
console.log('Current requested/effective block attention and complete BF16 stage evidence reject missing, stale or substituted plans.');
