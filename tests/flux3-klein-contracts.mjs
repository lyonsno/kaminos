// kaminos-test: node
// FLUX.3 Klein host-side contracts: sigma schedule, flow-map targets and RoPE position ids,
// against values printed by diffusers main (b800f828f395) FlowMatchEulerDiscreteScheduler(shift=6.93)
// and Flux3 before_denoise._prepare_image_ids / _prepare_text_ids.
import assert from 'node:assert/strict';
import { flux3Schedule } from '../models/flux3-klein/flux3-schedule.js';
import { flux3ImageIds, flux3TextIds } from '../models/flux3-klein/flux3-transformer.js';
import { flux3PromptIds } from '../models/flux3-klein/flux3-prompt.js';
import { Flux3Pipeline } from '../models/flux3-klein/flux3-pipeline.js';
import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';
import { KleinTextEncoder } from '../models/flux2-klein/klein-text-encoder.js';

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

// Base model + 4-step distill LoRA: constant shift 3 (ComfyUI ModelSamplingFlux ln 3, simple scheduler).
for (const [n, ref] of [[4, [1.0, 0.8999999761581421, 0.75, 0.5, 0.0]], [2, [1.0, 0.75, 0.0]]]) {
  const s = flux3Schedule(n, 3);
  s.sigmas.forEach((v, i) => assert.ok(Math.abs(v - ref[i]) <= 1e-7, `shift-3 sigma ${i} of ${n}: ${v} vs ${ref[i]}`));
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

// Exercise the model's actual preflight with the same 3072/9216 projection dimensions
// as the mounted Klein package. A device limit remains a limit; FLUX.2's 512-token
// training recipe must not become FLUX.3's model limit through inheritance.
function preflight(prototype, cap) {
  const pipeline = Object.create(prototype);
  pipeline.device = { limits: { maxStorageBufferBindingSize: cap, maxBufferSize: cap } };
  pipeline.transformer = { D: 3072, F: 9216 };
  pipeline.kernels = { vaeActType: 'f16' };
  pipeline.tokenizer = stub;
  pipeline.textEncoder = Object.assign(Object.create(KleinTextEncoder.prototype), {
    device: pipeline.device, D: 2560, F: 9728, QH: 32, KVH: 8,
    cfg: { rope_theta: 5000000 }, weights: {},
  });
  return pipeline;
}
const roomyFlux3 = preflight(Flux3Pipeline.prototype, 2 ** 32 - 4);
assert.equal(roomyFlux3.sizeLimits(512).maxTextTokens, 8192,
  'FLUX.3 admits its existing 8192-token model limit when GPU buffers permit it');
const expanded = 'x'.repeat(700);
const requested = roomyFlux3.requestedTextTokens(expanded);
assert.ok(requested > 512 && requested <= roomyFlux3.sizeLimits(512).maxTextTokens);
assert.equal(roomyFlux3.framePrompt(expanded, requested).length,
  stub.encode(roomyFlux3.framePrompt(expanded).text).length,
  'the expanded prompt survives admission and framing in full');
assert.equal(roomyFlux3.requestedTextTokens('x'.repeat(9000)), 8192,
  'maximum-length framing requests its actual clipped padding, not 8240 tokens');
assert.equal(preflight(KleinPipeline.prototype, 2 ** 32 - 4).sizeLimits(512).maxTextTokens, 512);
assert.equal(preflight(Flux3Pipeline.prototype, 128 * 2 ** 20).sizeLimits(512).maxTextTokens, 189,
  'the real projection buffer limit still constrains a smaller GPU');

// F3LP-01: the actual mounted encoder has four grouped query heads per KV head.
// Its minimum score group exceeds 64 MiB for long prompts and is quadratic in L.
const middle = preflight(Flux3Pipeline.prototype, 768 * 2 ** 20);
const middlePrompt = 'x'.repeat(7050 - roomyFlux3.framePrompt('').length);
const middleLimit = middle.sizeLimits(64);
const admitted = middle.framePrompt(middlePrompt,
  Math.min(middle.requestedTextTokens(middlePrompt), middleLimit.maxTextTokens));
assert.equal(admitted.length, 7050, 'capacity-limited padding retains all real prompt tokens');
assert.ok(4 * admitted.inputIds.length ** 2 * 4 <= middleLimit.cap,
  'the final padded prompt fits the encoder score buffer, not just transformer projection');
globalThis.GPUBufferUsage ??= { STORAGE: 128, COPY_SRC: 4, COPY_DST: 8 };
middle.device.queue = { writeBuffer() {} };
middle.device.createBuffer = ({ size }) => {
  assert.ok(size <= middleLimit.cap, `encoder buffer ${size} exceeds effective cap ${middleLimit.cap}`);
  return { size, destroy() {} };
};
middle.textEncoder.allocate(admitted.inputIds.length, admitted.positionIds);
let allocations = 0;
middle.transformer.allocate = () => { allocations++; throw Error('allocated before admission'); };
const tooLong = 'x'.repeat(7150 - roomyFlux3.framePrompt('').length);
await assert.rejects(middle.generateScheduled({ prompt: tooLong, width: 64, height: 64 }), /prompt is too long/);
assert.equal(allocations, 0, 'an unsupported real prompt fails before transformer activation allocation');

console.log('flux3-klein contracts ok');

// Composition: reference capacity and long-text encoder capacity constrain the
// same admitted request; neither independently reviewed change erases the other.
const withReference = preflight(Flux3Pipeline.prototype, 768 * 2 ** 20);
const referenceLimit = withReference.sizeLimits(64,64,400);
const jointLimit = Math.min(Math.floor(referenceLimit.cap / ((3*3072+2*9216)*4)),Math.floor(Math.sqrt(referenceLimit.cap/4)));
assert.equal(referenceLimit.maxTextTokens,Math.min(8192,jointLimit-16-400));
withReference.textEncoder.assertActivationFits(referenceLimit.maxTextTokens,referenceLimit.cap);
assert.ok(referenceLimit.maxTextTokens < middleLimit.maxTextTokens);
