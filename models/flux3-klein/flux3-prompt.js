// FLUX.3 Klein prompt framing, as Flux3TextEncoderStep._get_qwen3_vl_prompt_embeds does it: the
// Qwen3-VL chat template with the generation prompt (no think block), truncated to maxLength,
// right-padded with the pad id to the next multiple of padMultiple (the transformer attends to the
// padding, so its length matters), and RoPE positions = index for real tokens and 1 for padding (the
// training environment's transformers 4.57 behaviour, which the pipeline reproduces explicitly).
// `tokenizer` needs encode(text) -> ids and padId (QwenTokenizer).

export const FLUX3_PAD_MULTIPLE = 80;
export const FLUX3_MAX_TOKENS = 8192;

export function flux3PromptIds(tokenizer, prompt, { padMultiple = FLUX3_PAD_MULTIPLE, maxLength = FLUX3_MAX_TOKENS } = {}) {
  const text = `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`;
  const ids = tokenizer.encode(text).slice(0, maxLength);
  const length = ids.length;
  const padded = Math.min(Math.ceil(length / padMultiple) * padMultiple, maxLength);
  const inputIds = new Int32Array(padded).fill(tokenizer.padId);
  inputIds.set(ids);
  const attentionMask = new Int32Array(padded); attentionMask.fill(1, 0, length);
  const positionIds = Int32Array.from({ length: padded }, (_, i) => (i < length ? i : 1));
  return { text, inputIds, attentionMask, positionIds, length };
}
