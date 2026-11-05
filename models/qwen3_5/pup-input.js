// BFL pup.py text-to-image policy over the existing Qwen byte-level tokenizer.
// This is the single-user, thinking-disabled text path, not a general Jinja
// interpreter or the vision/bounding-box processor.
export function createPupTextInput(tokenizer, { prompt, systemPrompt } = {}) {
  if (typeof prompt !== 'string' || typeof systemPrompt !== 'string') throw new TypeError('prompt and systemPrompt must be strings');
  if (typeof tokenizer?.encode !== 'function' || !(tokenizer.added instanceof Map)) throw new TypeError('Qwen tokenizer is required');
  const eosTokenIds = ['<|im_end|>', '<|endoftext|>'].map(token => {
    const id = tokenizer.added.get(token);
    if (!Number.isSafeInteger(id) || id < 0) throw new Error(`missing stop token ${token}`);
    return id;
  });
  // Jinja trim uses Python str.strip (which includes the information-separator
  // controls and excludes BOM). Spell that out instead of JS's different trim.
  const trim = text => text.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu, '');
  const text = `<|im_start|>system\n${trim(systemPrompt)}<|im_end|>\n<|im_start|>user\n${trim(prompt)}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
  return { text, inputIds: Uint32Array.from(tokenizer.encode(text)), generation: {
    temperature: 0, topK: 20, topP: .95, minP: 0, presencePenalty: 1.5,
    maxNewTokens: 3584, eosTokenIds,
  } };
}
