import assert from 'node:assert/strict';
import { slatDecoderChildCountsShader, slatDecoderScatterShader } from '../slat-decoder-ops.js';

// Replay the exact generated admission predicates, not a second implementation
// of the desired law. This is CPU contract evidence, not a native NaN assay.
const countsCode = slatDecoderChildCountsShader(1), scatterCode = slatDecoderScatterShader(1, 16, 8);
const counted = countsCode.match(/if\(([^{}]*logits[^{}]*)\)\{count\+\+;\}/)?.[1];
const skipped = scatterCode.match(/if\(([^{}]*logits[^{}]*)\)\{return;\}/)?.[1];
assert.ok(counted && skipped, 'Both generated kernels must expose their actual child admission.');
const predicate = expression => new Function('logits', 'index', 'row', 'child',
  `return ${expression.replace(/(\d+)u\b/g, '$1')};`);
const countMember = predicate(counted), scatterSkip = predicate(skipped);
for (const logits of [new Float32Array([.25, NaN, .25, 0, 0, 0, 0, 0]),
  new Float32Array([Infinity, -Infinity, NaN, -0, 0, -1, 1, .25])]) {
  const countedChildren = [], writtenChildren = [], destinations = [];
  for (let child = 0; child < 8; child++) {
    if (countMember(logits, 0, 0, child)) countedChildren.push(child);
    if (!scatterSkip(logits, 0, 0, child)) {
      writtenChildren.push(child);
      destinations.push(countedChildren.filter(prior => prior < child).length);
    }
  }
  assert.deepEqual(writtenChildren, countedChildren,
    'Scatter must select the same strict-positive children that allocated its rows, including rejecting NaN.');
  assert.equal(new Set(destinations).size, countedChildren.length,
    'Each allocated child must have one unique destination, with no NaN collision.');
  assert.deepEqual(destinations, countedChildren.map((_, i) => i));
}
console.log('Generated count/scatter predicates agree on strict-positive membership and unique row destinations; CPU replay is not native nonfinite conformance.');
