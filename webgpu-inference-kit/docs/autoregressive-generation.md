# Autoregressive generation primitives

The optional `@kaminos/webgpu-inference-kit/generation` entry point supplies a request-scoped token loop and a CPU reference sampler. It does not load or execute a language model. The first consumer under construction is Qwen3.5-9B's BFL prompt upsampler; its WebGPU adapter is not implemented yet.

```js
import { generateTokens, sampleToken, createSeededRandom }
  from '@kaminos/webgpu-inference-kit/generation';

const random = createSeededRandom(7);
const result = await generateTokens({
  model, // caller's loaded model adapter
  inputIds,
  capacity: 4096,
  maxNewTokens: 512, // application choice, not an engine default
  eosTokenIds,
  signal,
  control, // optional existing kit inference control
  sample: (logits, { generatedTokenIds }) => sampleToken(logits, {
    temperature: .7, topK: 0, topP: .95,
    penaltyTokenIds: generatedTokenIds,
    random,
  }),
  onToken: id => appendText(decoder.push(id)),
});
appendText(decoder.end());
```

The model adapter implements four methods:

- `createState({capacity, signal, control})` allocates independent request state. It owns recovery of any partially created state if allocation throws.
- `prefill(inputIds, state, {signal, control})` consumes the whole prompt and returns logits predicting the first new token.
- `decode(tokenId, state, {signal, control})` consumes one selected token and returns logits predicting the next.
- `disposeState(state)` settles outstanding model work and frees state, including after cancellation or errors. Loaded weights remain owned by the model.

Logits are opaque to the loop. The supplied sampler may operate on GPU buffers and return only one token ID; using `sampleToken` requires a CPU numeric array. This permits a GPU sampler without changing model or generation lifetimes. No GPU-sampling performance claim is made by the CPU implementation.

The loop uses the existing control at token boundaries. The model and sampler must also use that control for leaf GPU duties so long prefill and decode operations can pause internally. The loop does not wrap an entire model call in a second duty or construct a scheduler. A port can execute the loop inside the existing application runner's admitted invocation.

The result contains `tokenIds` (excluding EOS), `finishReason` (`eos`, `length`, or `capacity`), `stopTokenId` (or null), `promptTokenCount`, and `generatedTokenCount` (including a sampled EOS). The last occupied cache position can predict one token without consuming it. The driver avoids decoding an unused last output and reports capacity exhaustion before attempting an overflowing append. Every request starts with independent state; cross-request reuse and textual stop strings are outside this initial interface.

`sampleToken` supports greedy (`temperature: 0`) and categorical selection. Its explicit filter order is repetition/presence/frequency penalties, temperature, top-k, relative min-p, then top-p. Nucleus filtering retains the token crossing the probability threshold. Ties use token ID order. `topK: 0`, `minP: 0` and `topP: 1` preserve the complete vocabulary; no hidden candidate limit is applied. `penaltyTokenIds` chooses the penalty history; the example uses generated tokens only, as BFL's prompt helper does. Seeded output is repeatable on this CPU path; this does not promise cross-backend token identity in the presence of numerical differences.

## Qwen3.5 foundation and existing encoders

The source modules in `models/qwen3_5/` read dense Qwen3.5 geometry and plan full-attention KV plus DeltaNet recurrent/convolution state. Planning is allocation accounting, not model execution or measured browser memory. KV defaults to FP16; recurrent matrices and the planned convolution buffers use FP32. The adapter will still need to honor actual device limits and select buffer layouts.

The text-only PUP input module uses the existing `models/flux2-klein/qwen-tokenizer.js`, with separate BFL system/user framing and task defaults. It passes all encoded input through; the Klein-specific padding/truncation wrapper remains unchanged for its existing consumer. The tokenizer's new incremental decoder retains incomplete UTF-8 across token boundaries, preserves a literal leading BOM and skips only tokens marked special when requested. Decode lookup tables are created lazily.

Reuse survey: Kimodo WebGPU `1de2276f738b152c73725f69256fe40b17d49044` (`tools/embed_server.py`, `src/lib/producer.js`) performs server-side LLM2Vec/Llama3-8B embedding, returning one4096-dimensional vector; its browser kernels serve the motion transformer. The historical project notes also identify Qwen3-8B in HY-Motion. Those boundaries explain the earlier small-server strategy but supply no cached language-generation loop. Klein's Qwen tokenizer and the kit's current application, attention and projection machinery are the direct code reuse points for this slice. No existing server or motion route is changed.

The committed input fixtures were observed with Transformers5.20.2/tokenizers0.23.3 against `mlx-community/flux-3-image-klein-pup-4bit@34abfa0769000d6a542169b0e61a04059697467c`. They record hashes of the actual tokenizer, configuration, chat template and system prompts. Their small decoding vocabulary contains only observed token pieces and is not a deployable tokenizer. Tests cover its observed decode/framing contracts; full encoding conformance additionally uses the actual downloaded tokenizer asset. The model's original source is [BFL's prompt upsampler](https://huggingface.co/black-forest-labs/flux-3-image-klein-pup); task defaults and stop tokens follow [BFL's helper](https://github.com/black-forest-labs/flux-3-image-klein/blob/main/src/flux3/pup.py).

Focused contracts run from the repository root:

```sh
npm test -- --only tests/token-sampling.mjs,tests/autoregressive-generation.mjs,tests/qwen35-input.mjs
```

These tests establish CPU orchestration, input handling and state-accounting behavior. The next implementation boundary is Qwen's actual GPU math: real weight-layout interpretation, full-attention cache append/read, DeltaNet convolution/recurrence, then whole-model logits and generation.
