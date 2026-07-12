import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const tokenizerUrl = new URL('../src/sam-prompt-tokenizer.js', import.meta.url);
assert.equal(existsSync(tokenizerUrl), true, 'browser SAM3 prompt tokenizer source must exist');

const {
  createSam3ClipTokenizer,
  normalizeSam3ClipPrompt,
} = await import(tokenizerUrl);

const vocab = {
  '<|startoftext|>': 49406,
  '<|endoftext|>': 49407,
  'c': 66,
  'a': 64,
  't</w>': 339,
  'ca': 1000,
  'cat</w>': 2368,
  '&</w>': 261,
  '!</w>': 256,
};

const tokenizer = createSam3ClipTokenizer({
  vocab,
  merges: [['c', 'a'], ['ca', 't</w>']],
  contextLength: 8,
  bosTokenId: 49406,
  eosTokenId: 49407,
  padTokenId: 49407,
});

assert.equal(
  normalizeSam3ClipPrompt('  CAT\n\t&amp;  cat  '),
  ' cat &amp; cat ',
  'SAM3 CLIP prompt normalization must match the reference NFC, whitespace, and lowercase sequence without HTML decoding',
);

const single = tokenizer.tokenize('  CAT\n\t&  cat  ');
assert.deepEqual(
  Array.from(single.inputIds),
  [49406, 2368, 261, 2368, 49407, 49407, 49407, 49407],
  'browser tokenizer must apply BPE and use CLIP EOS as the SAM3 padding token',
);
assert.deepEqual(
  Array.from(single.attentionMask),
  [1, 1, 1, 1, 1, 0, 0, 0],
  'browser tokenizer mask must distinguish the real EOS token from padded EOS tokens',
);
assert.equal(single.normalizedPrompt, ' cat & cat ');
assert.equal(single.contextLength, 8);

const batch = tokenizer.tokenizeBatch(['cat', 'cat cat cat cat cat cat cat cat']);
assert.deepEqual(batch.shape, [2, 8]);
assert.deepEqual(
  Array.from(batch.inputIds.slice(0, 8)),
  [49406, 2368, 49407, 49407, 49407, 49407, 49407, 49407],
  'batch tokenization must preserve CLIP padding semantics',
);
assert.deepEqual(
  Array.from(batch.attentionMask.slice(0, 8)),
  [1, 1, 1, 0, 0, 0, 0, 0],
  'batch mask must include BOS, content, and the real EOS token',
);
assert.deepEqual(
  Array.from(batch.inputIds.slice(8)),
  [49406, 2368, 2368, 2368, 2368, 2368, 2368, 49407],
  'overlong prompts must truncate content and restore EOS in the final slot',
);
assert.deepEqual(
  Array.from(batch.attentionMask.slice(8)),
  [1, 1, 1, 1, 1, 1, 1, 1],
  'a truncated prompt occupies the full context window',
);

assert.throws(
  () => createSam3ClipTokenizer({ vocab: {}, merges: [], contextLength: 1 }),
  /contextLength must be at least 2/,
  'tokenizer must reject a context that cannot contain BOS and EOS',
);
assert.throws(
  () => tokenizer.tokenizeBatch([]),
  /at least one prompt/,
  'tokenizer must reject empty prompt batches instead of emitting authoritative empty tensors',
);

const exporterSource = readFileSync(new URL('../tools/sam-detr-stack-mlx-packet.py', import.meta.url), 'utf8');
assert.match(exporterSource, /prompt-tokenizer-vocab/, 'packet exporter must expose the CLIP vocabulary as a model-static browser tokenizer asset');
assert.match(exporterSource, /prompt-tokenizer-merges/, 'packet exporter must expose the CLIP BPE merges as a model-static browser tokenizer asset');
assert.match(exporterSource, /"runtimeOwner": "browser"/, 'packet manifest must declare browser ownership of runtime prompt tokenization');
assert.match(exporterSource, /"referenceInputIdsRole": "prompt-input-ids"/, 'packet input IDs must remain explicitly reference-only evidence');
assert.match(exporterSource, /"referenceAttentionMaskRole": "prompt-attention-mask"/, 'packet attention mask must remain explicitly reference-only evidence');
assert.match(exporterSource, /export_prompt_tokenizer_assets\(out_dir, shape\["promptTokens"\]\)/, 'tokenizer context length must bind the exported text-encoder shape');

const browserSmokeSource = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
assert.match(browserSmokeSource, /createSam3ClipTokenizer/, 'browser smoke must instantiate the SAM3 CLIP tokenizer');
assert.match(browserSmokeSource, /manifest\.promptTokenizer/, 'browser smoke must consume the packet tokenizer contract');
assert.match(browserSmokeSource, /browserPromptTokenizerEvidence/, 'browser smoke must expose tokenizer ownership evidence');
assert.match(browserSmokeSource, /promptTokenIdMismatchCount/, 'browser smoke must compare browser token IDs with reference evidence');
assert.match(browserSmokeSource, /promptAttentionMaskMismatchCount/, 'browser smoke must compare browser attention masks with reference evidence');
assert.match(browserSmokeSource, /effectiveVocabSha256/, 'browser smoke must record the hash of vocabulary bytes actually fetched');
assert.match(browserSmokeSource, /effectiveMergesSha256/, 'browser smoke must record the hash of merge bytes actually fetched');
assert.match(browserSmokeSource, /tokenizer asset hash mismatch/, 'browser smoke must reject fetched tokenizer assets that do not match the manifest identity');
assert.match(browserSmokeSource, /tensors: \{ inputIds: browserPromptInputIds, attentionMask: browserPromptAttentionMask/, 'prompt/text WebGPU execution must consume browser-produced IDs and masks');
assert.doesNotMatch(browserSmokeSource, /tensors: \{ inputIds: promptInputIds, attentionMask: promptAttentionMask/, 'prompt/text WebGPU execution must not consume packet-owned runtime IDs and masks');
assert.match(browserSmokeSource, /browserTokenizer: false/, 'downstream evidence must stop non-claiming browser tokenization after Gate S');

const witnessSource = readFileSync(new URL('../tools/sam-mask-island-browser-parity-smoke.mjs', import.meta.url), 'utf8');
assert.match(witnessSource, /browserPromptTokenizerEvidence/, 'terminal witness must preserve browser tokenizer evidence');
assert.match(witnessSource, /promptTokenIdMismatchCount/, 'terminal witness must gate token ID parity');
assert.match(witnessSource, /promptAttentionMaskMismatchCount/, 'terminal witness must gate attention-mask parity');
assert.match(witnessSource, /still non-claims browser tokenizer/, 'terminal witness must reject stale browser-tokenizer non-claims');

console.log('sam prompt tokenizer contracts passed');
