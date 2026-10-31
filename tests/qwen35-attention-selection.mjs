// kaminos-test: node
import assert from 'node:assert/strict';
import * as profile from '../models/qwen3_5/serving-profile.js';
assert.equal(typeof profile.adjudicateAttentionSelection, 'function');
const good = { decodeAttention: 'single-query', attentionDispatches: { attention: 8, 'attention-single-query': 16 } };
profile.adjudicateAttentionSelection(good, 'single-query');
for (const bad of [ {}, { ...good, decodeAttention: 'tiled' }, { ...good, attentionDispatches: {} },
  { ...good, attentionDispatches: { attention: 8, 'attention-single-query': 0 } },
  { ...good, attentionDispatches: { attention: 8, 'attention-single-query': NaN } } ]) {
  assert.throws(() => profile.adjudicateAttentionSelection(bad, 'single-query'), /attention/);
}
assert.throws(() => profile.adjudicateAttentionSelection(good, 'tiled'), /attention/);
profile.adjudicateAttentionSelection({ decodeAttention: 'tiled', attentionDispatches: { attention: 24, 'attention-single-query': 0 } }, 'tiled');
console.log('attention selection rejects absent, fallback, and missing dispatch evidence');
