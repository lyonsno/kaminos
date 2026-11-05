import { generateTokens, createGenerationSession } from '../../webgpu-inference-kit/src/autoregressive-generation.js';
import { sampleToken } from '../../webgpu-inference-kit/src/token-sampling.js';
import { createPupTextInput } from './pup-input.js';

// Application policy over a caller-owned loaded adapter/tokenizer. The result
// retains finishReason so capacity/length exhaustion stays visible to consumers.
export async function expandPupText({ model, tokenizer, prompt, systemPrompt, capacity,
  maxNewTokens, signal = null, control = null, onText = null } = {}) {
  if (typeof tokenizer?.createDecoder !== 'function') throw new TypeError('incremental text decoder is required');
  if (onText != null && typeof onText !== 'function') throw new TypeError('onText must be a function');
  const input = createPupTextInput(tokenizer, { prompt, systemPrompt }), settings = input.generation;
  const limit = maxNewTokens ?? settings.maxNewTokens, decoder = tokenizer.createDecoder();
  let text = '';
  const publish = async delta => { if (delta) { text += delta; if (onText) await onText(delta, text); } };
  const result = await generateTokens({ model, inputIds: input.inputIds, capacity: capacity ?? input.inputIds.length + limit - 1,
    maxNewTokens: limit, eosTokenIds: settings.eosTokenIds, signal, control,
    sample: (logits, { generatedTokenIds }) => sampleToken(logits, { ...settings, penaltyTokenIds: generatedTokenIds }),
    onToken: async id => publish(decoder.push(id)),
  });
  await publish(decoder.end());
  return { ...result, text };
}

/** Text-only incremental conversation. Keeps the actual sampled token stream,
 * including the empty thinking prefix, across turns. This deliberately does not
 * re-render old assistant messages with Jinja (which removes their thinking
 * prefix). It is an append-only conversation format, not template equivalence
 * for arbitrary chat histories, tools, images, or assistant edits.
 */
export function createQwenTextChat({ model, tokenizer, capacity, systemPrompt = '', control = null } = {}) {
  if (typeof tokenizer?.createDecoder !== 'function') throw new TypeError('incremental text decoder is required');
  const initial = text => createPupTextInput(tokenizer, { prompt: text, systemPrompt });
  const stops = initial('').generation.eosTokenIds;
  const end = tokenizer.added.get('<|im_end|>');
  const session = createGenerationSession({ model, capacity, control });
  let transcript = [], turns = [], busy = false, closed = false;
  async function send({ text, maxNewTokens, signal = null, onText = null, sampling = {} } = {}) {
    if (closed) throw new Error('chat is closed');
    if (busy) throw new Error('chat is busy');
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('message text is required');
    if (onText !== null && typeof onText !== 'function') throw new TypeError('onText must be a function');
    busy = true;
    try {
      // Reuse source single-turn framing for new user/assistant boundaries,
      // removing only the system prefix from the new fragment.
      const input = initial(text);
      const fragment = createPupTextInput(tokenizer, { prompt:text, systemPrompt:'' }).text.slice('<|im_start|>system\n<|im_end|>\n'.length);
      const ids = transcript.length
        ? [...transcript, ...tokenizer.encode('\n' + fragment)] : [...input.inputIds];
      const decoder = tokenizer.createDecoder(); let answer = '';
      const publish = async delta => { if (delta) { answer += delta; if (onText) await onText(delta,answer); } };
      const result = await session.generate({ inputIds: ids,
        maxNewTokens: maxNewTokens ?? Math.max(1, capacity - ids.length + 1), eosTokenIds: stops, signal,
        sample: (logits,{generatedTokenIds}) => sampleToken(logits, { temperature:0, ...sampling, penaltyTokenIds:generatedTokenIds }),
        onToken: async id => publish(decoder.push(id)),
      });
      await publish(decoder.end());
      transcript = [...ids, ...result.tokenIds, result.stopTokenId ?? end];
      const turn = { user:text, assistant:answer, ...result };
      turns.push(turn);
      return { ...result, text:answer };
    } finally { busy = false; }
  }
  return { send,
    async reset({systemPrompt: nextSystemPrompt = systemPrompt} = {}) {
      if (closed) throw new Error('chat is closed');
      if (busy) throw new Error('chat is busy');
      if (typeof nextSystemPrompt !== 'string') throw new TypeError('systemPrompt must be a string');
      busy=true;
      try { await session.reset(); systemPrompt=nextSystemPrompt; transcript=[]; turns=[]; }
      finally { busy=false; }
    },
    async dispose() { closed=true; await session.dispose(); },
    snapshot: () => ({ ...session.snapshot(), busy, closed, systemPrompt, tokenIds:[...transcript], turns:structuredClone(turns) }) };
}
