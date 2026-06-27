import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const witness = readFileSync(new URL('../motion-panel-live-witness.mjs', import.meta.url), 'utf8');

assert.match(index, /id="motion-attention-target-mode"/, 'Motion UI exposes an attention target mode selector');
assert.match(index, /value="selected-object" selected/, 'selected-object attention is the default motion target mode');
assert.match(index, /function selectedSceneObjectMotionAttentionTarget\(/, 'motion route resolves selected scene object attention targets');
assert.match(index, /new THREE\.Box3\(\)\.setFromObject\(entry\.object\)/, 'selected object attention target uses world-space object bounds');
assert.match(index, /motionAttentionTargetForSample\(/, 'motion frame updates pass through an attention target resolver');
assert.match(index, /window\.kaminosCreateMotionAttentionTargetFixture/, 'browser witnesses can seed a real selected scene object target');
assert.match(index, /attentionTargetMode/, 'motion debug evidence records attention target mode');
assert.match(index, /selectedObjectId/, 'motion debug evidence records selected object id when target-driven');
assert.match(index, /attentionTargetEvidence/, 'motion actor evidence carries target provenance');
assert.match(index, /target:\s*state\.lastAttentionTargetContext/, 'generated behavior state receives selected target context');
assert.match(witness, /attentionTargetEvidence/, 'live witness reports selected-object attention target evidence');
