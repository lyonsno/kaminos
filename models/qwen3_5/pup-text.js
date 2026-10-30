import { generateTokens } from '../../webgpu-inference-kit/src/autoregressive-generation.js';
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
