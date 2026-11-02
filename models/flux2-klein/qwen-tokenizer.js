// Qwen2/Qwen3 byte-level BPE tokenizer from a Hugging Face tokenizer.json, plus
// the Flux2KleinPipeline prompt framing (chat template with thinking disabled,
// right padding with <|endoftext|> to 512 tokens, right truncation).
//
// Order matches the tokenizers library: added tokens are split out of the raw
// text first, the rest is NFC-normalized, split with the Qwen2 pre-tokenizer
// regex, byte-mapped (GPT-2 bytes_to_unicode) and merged by BPE rank.

// (?i:'s|'t|'re|'ve|'m|'ll|'d) is spelled out because older engines lack inline flags.
const PRETOKENIZE = /'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

function bytesToUnicode() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const map = new Array(256);
  bs.forEach((b, i) => { map[b] = String.fromCodePoint(cs[i]); });
  return map;
}

export class QwenTokenizer {
  constructor(tokenizerJson) {
    const m = tokenizerJson.model;
    if (m.type !== 'BPE') throw new Error(`expected BPE model, got ${m.type}`);
    this.vocab = new Map(Object.entries(m.vocab));
    this.ranks = new Map();
    m.merges.forEach((merge, i) => this.ranks.set(Array.isArray(merge) ? merge.join(' ') : merge, i));
    this.added = new Map(tokenizerJson.added_tokens.map(a => [a.content, a.id]));
    this.specialIds = new Set(tokenizerJson.added_tokens.filter(a => a.special).map(a => a.id));
    const escaped = [...this.added.keys()].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this.addedRegex = new RegExp(`(${escaped.join('|')})`);
    this.byteMap = bytesToUnicode();
    this.encoder = new TextEncoder();
    this.cache = new Map();
    this.padId = this.added.get('<|endoftext|>');
  }

  bpe(piece) {
    const cached = this.cache.get(piece);
    if (cached) return cached;
    let word = [...piece];
    while (word.length > 1) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const r = this.ranks.get(`${word[i]} ${word[i + 1]}`);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      const a = word[best], b = word[best + 1], merged = [];
      for (let i = 0; i < word.length; i++) {
        if (i < word.length - 1 && word[i] === a && word[i + 1] === b) { merged.push(a + b); i++; } else merged.push(word[i]);
      }
      word = merged;
    }
    const ids = word.map(s => { const id = this.vocab.get(s); if (id === undefined) throw new Error(`unknown BPE symbol ${JSON.stringify(s)}`); return id; });
    this.cache.set(piece, ids);
    return ids;
  }

  encode(text) {
    const ids = [];
    for (const part of text.split(this.addedRegex)) {
      if (!part) continue;
      const special = this.added.get(part);
      if (special !== undefined) { ids.push(special); continue; }
      for (const match of part.normalize('NFC').matchAll(PRETOKENIZE)) {
        const mapped = [...this.encoder.encode(match[0])].map(b => this.byteMap[b]).join('');
        ids.push(...this.bpe(mapped));
      }
    }
    return ids;
  }

  // Decode data is lazy: existing embedding-only consumers retain their
  // current vocabulary/storage cost until they request text generation.
  tokenBytes(id, skipSpecialTokens) {
    if (!this.decodeVocab) {
      this.decodeVocab = new Map([...this.vocab].map(([piece, index]) => [index, piece]));
      this.decodeAdded = new Map([...this.added].map(([piece, index]) => [index, piece]));
      this.decodeByteMap = new Map(this.byteMap.map((piece, byte) => [piece, byte]));
    }
    if (!Number.isSafeInteger(id) || id < 0) throw new RangeError('unknown token ID');
    if (this.decodeAdded.has(id)) {
      if (skipSpecialTokens && this.specialIds.has(id)) return new Uint8Array(0);
      return this.encoder.encode(this.decodeAdded.get(id));
    }
    const piece = this.decodeVocab.get(id);
    if (piece === undefined) throw new RangeError(`unknown token ID ${id}`);
    return Uint8Array.from([...piece].map(char => {
      const byte = this.decodeByteMap.get(char);
      if (byte === undefined) throw new Error('token is not byte-level BPE');
      return byte;
    }));
  }

  createDecoder({ skipSpecialTokens = true } = {}) {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true }), tokenizer = this;
    let ended = false;
    return {
      push(id) {
        if (ended) throw new Error('token decoder has ended');
        return decoder.decode(tokenizer.tokenBytes(id, skipSpecialTokens), { stream: true });
      },
      end() {
        if (ended) throw new Error('token decoder has ended');
        ended = true; return decoder.decode();
      },
    };
  }

  decode(ids, options) {
    const decoder = this.createDecoder(options), chunks = [];
    for (const id of ids) chunks.push(decoder.push(id));
    chunks.push(decoder.end());
    return chunks.join('');
  }

  // Flux2KleinPipeline._get_qwen3_prompt_embeds framing.
  kleinPromptIds(prompt, maxLength = 512) {
    const text = `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
    const ids = this.encode(text).slice(0, maxLength);
    const length = ids.length;
    const inputIds = new Int32Array(maxLength).fill(this.padId);
    inputIds.set(ids);
    const mask = new Int32Array(maxLength); mask.fill(1, 0, length);
    return { text, inputIds, attentionMask: mask, length };
  }
}
