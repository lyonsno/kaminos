// kaminos-test: node
// FLUX.3 Klein host-side contracts: sigma schedule, flow-map targets and RoPE position ids,
// against values printed by diffusers main (b800f828f395) FlowMatchEulerDiscreteScheduler(shift=6.93)
// and Flux3 before_denoise._prepare_image_ids / _prepare_text_ids.
import assert from 'node:assert/strict';
import { flux3Schedule } from '../models/flux3-klein/flux3-schedule.js';
import { flux3ImageIds, flux3TextIds } from '../models/flux3-klein/flux3-transformer.js';
import { flux3PromptIds } from '../models/flux3-klein/flux3-prompt.js';

const REF16 = [1.0, 0.9904716610908508, 0.9798020720481873, 0.9677731394767761, 0.954107403755188, 0.9384464025497437,
  0.920318603515625, 0.899091899394989, 0.873896598815918, 0.8435055017471313, 0.8061264157295227, 0.7590360641479492,
  0.6978851556777954, 0.615270733833313, 0.4974874258041382, 0.3160054683685303, 0.0];
const REF4 = [1.0, 0.954107403755188, 0.873896598815918, 0.6978851556777954, 0.0];

for (const [n, ref] of [[16, REF16], [4, REF4]]) {
  const s = flux3Schedule(n);
  assert.equal(s.sigmas.length, n + 1, `${n} steps give n+1 sigmas`);
  s.sigmas.forEach((v, i) => assert.ok(Math.abs(v - ref[i]) <= 1e-7, `sigma ${i} of ${n}: ${v} vs ${ref[i]}`));
  // flow map: each step's target is the next sigma, 0 after the last
  assert.deepEqual(s.targets, s.sigmas.slice(1));
}

// Image tokens: (t=0, h*0.5, w*0.5, l=0), row-major over the latent grid.
const img = flux3ImageIds(2, 3);
assert.deepEqual([...img], [0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, 0.5, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 1, 0]);
// Text tokens advance along the l axis.
assert.deepEqual([...flux3TextIds(3)], [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2]);

// Prompt framing (Flux3TextEncoderStep._get_qwen3_vl_prompt_embeds): Qwen3-VL chat template with the
// generation prompt and no think block, right-padded with the pad id to a multiple of 80 (capped at
// 8192), mask 1 on real tokens, and RoPE position = index for real tokens, 1 for padding.
const stub = { padId: 151643, encode: text => Array.from({ length: text.length }, (_, i) => 1000 + i) };
const framed = flux3PromptIds(stub, 'a red train');
assert.equal(framed.text, '<|im_start|>user\na red train<|im_end|>\n<|im_start|>assistant\n');
assert.equal(framed.length, framed.text.length);
assert.equal(framed.inputIds.length, 80);
assert.equal(framed.inputIds[framed.length], 151643);
assert.deepEqual([...framed.attentionMask.slice(framed.length - 1, framed.length + 1)], [1, 0]);
assert.deepEqual([...framed.positionIds.slice(0, 3)], [0, 1, 2]);
assert.equal(framed.positionIds[framed.length - 1], framed.length - 1);
assert.ok(framed.positionIds.slice(framed.length).every(p => p === 1));
const long = flux3PromptIds(stub, 'x'.repeat(200));
assert.equal(long.inputIds.length % 80, 0);
assert.ok(long.inputIds.length >= long.length && long.inputIds.length - long.length < 80);
assert.equal(flux3PromptIds(stub, 'x'.repeat(9000)).inputIds.length, 8192);

console.log('flux3-klein contracts ok');
