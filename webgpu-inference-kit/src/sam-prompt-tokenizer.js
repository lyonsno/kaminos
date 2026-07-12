const DEFAULT_CONTEXT_LENGTH = 32;
const DEFAULT_BOS_TOKEN = '<|startoftext|>';
const DEFAULT_EOS_TOKEN = '<|endoftext|>';

const TOKEN_PATTERN = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

export function normalizeSam3ClipPrompt(text) {
  if (typeof text !== 'string') throw new TypeError('SAM3 prompt must be a string');
  return text.normalize('NFC').replace(/\s+/gu, ' ').toLowerCase();
}

function bytesToUnicode() {
  const bytes = [];
  for (let value = 33; value <= 126; value += 1) bytes.push(value);
  for (let value = 161; value <= 172; value += 1) bytes.push(value);
  for (let value = 174; value <= 255; value += 1) bytes.push(value);
  const characters = [...bytes];
  let offset = 0;
  for (let value = 0; value < 256; value += 1) {
    if (!bytes.includes(value)) {
      bytes.push(value);
      characters.push(256 + offset);
      offset += 1;
    }
  }
  return new Map(bytes.map((value, index) => [value, String.fromCodePoint(characters[index])]));
}

function pairKey(first, second) {
  return `${first}\u0000${second}`;
}

function getPairs(word) {
  const pairs = new Set();
  for (let index = 1; index < word.length; index += 1) {
    pairs.add(pairKey(word[index - 1], word[index]));
  }
  return pairs;
}

function normalizeMerges(merges) {
  if (!Array.isArray(merges)) throw new TypeError('SAM3 tokenizer merges must be an array');
  return merges.map((merge, index) => {
    const pair = Array.isArray(merge) ? merge : String(merge).trim().split(/\s+/u);
    if (pair.length !== 2 || pair.some(value => !value)) {
      throw new TypeError(`SAM3 tokenizer merge ${index} must contain exactly two symbols`);
    }
    return pair;
  });
}

export function parseSam3ClipMerges(text) {
  if (typeof text !== 'string') throw new TypeError('SAM3 tokenizer merges text must be a string');
  return text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(/\s+/u))
    .filter(pair => pair.length === 2);
}

function normalizeVocabulary(vocab) {
  if (vocab instanceof Map) return new Map(vocab);
  if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab)) {
    throw new TypeError('SAM3 tokenizer vocab must be an object or Map');
  }
  return new Map(Object.entries(vocab));
}

export function createSam3ClipTokenizer({
  vocab,
  merges,
  contextLength = DEFAULT_CONTEXT_LENGTH,
  bosToken = DEFAULT_BOS_TOKEN,
  eosToken = DEFAULT_EOS_TOKEN,
  bosTokenId,
  eosTokenId,
  padTokenId,
} = {}) {
  if (!Number.isInteger(contextLength) || contextLength < 2) {
    throw new RangeError('SAM3 tokenizer contextLength must be at least 2');
  }
  const encoder = normalizeVocabulary(vocab);
  const normalizedMerges = normalizeMerges(merges);
  const resolvedBosTokenId = bosTokenId ?? encoder.get(bosToken);
  const resolvedEosTokenId = eosTokenId ?? encoder.get(eosToken);
  const resolvedPadTokenId = padTokenId ?? resolvedEosTokenId;
  for (const [name, value] of [['bosTokenId', resolvedBosTokenId], ['eosTokenId', resolvedEosTokenId], ['padTokenId', resolvedPadTokenId]]) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`SAM3 tokenizer ${name} must resolve to a non-negative integer`);
  }

  const byteEncoder = bytesToUnicode();
  const mergeRanks = new Map(normalizedMerges.map((pair, index) => [pairKey(pair[0], pair[1]), index]));
  const cache = new Map([[bosToken, bosToken], [eosToken, eosToken]]);
  const utf8 = new TextEncoder();

  function bpe(token) {
    if (cache.has(token)) return cache.get(token);
    const symbols = Array.from(token);
    if (symbols.length === 0) return [];
    symbols[symbols.length - 1] += '</w>';
    let word = symbols;
    let pairs = getPairs(word);
    while (pairs.size > 0) {
      let selected = null;
      let selectedRank = Number.POSITIVE_INFINITY;
      for (const candidate of pairs) {
        const rank = mergeRanks.get(candidate);
        if (rank !== undefined && rank < selectedRank) {
          selected = candidate;
          selectedRank = rank;
        }
      }
      if (selected === null) break;
      const separator = selected.indexOf('\u0000');
      const first = selected.slice(0, separator);
      const second = selected.slice(separator + 1);
      const merged = [];
      for (let index = 0; index < word.length;) {
        if (word[index] === first && word[index + 1] === second) {
          merged.push(first + second);
          index += 2;
        } else {
          merged.push(word[index]);
          index += 1;
        }
      }
      word = merged;
      if (word.length === 1) break;
      pairs = getPairs(word);
    }
    cache.set(token, word);
    return word;
  }

  function encode(normalizedPrompt) {
    const ids = [];
    for (const token of normalizedPrompt.match(TOKEN_PATTERN) || []) {
      if (token === bosToken || token === eosToken) {
        ids.push(encoder.get(token));
        continue;
      }
      const encodedToken = Array.from(utf8.encode(token), byte => byteEncoder.get(byte)).join('');
      for (const piece of bpe(encodedToken)) ids.push(encoder.get(piece) ?? resolvedEosTokenId);
    }
    return ids;
  }

  function tokenize(prompt) {
    const normalizedPrompt = normalizeSam3ClipPrompt(prompt);
    const contentIds = encode(normalizedPrompt);
    const unpadded = [resolvedBosTokenId, ...contentIds, resolvedEosTokenId];
    if (unpadded.length > contextLength) {
      unpadded.length = contextLength;
      unpadded[contextLength - 1] = resolvedEosTokenId;
    }
    const validLength = unpadded.length;
    const inputIds = new Uint32Array(contextLength);
    inputIds.fill(resolvedPadTokenId);
    inputIds.set(unpadded);
    const attentionMask = new Float32Array(contextLength);
    attentionMask.fill(1, 0, validLength);
    return { inputIds, attentionMask, normalizedPrompt, contextLength, validLength };
  }

  function tokenizeBatch(prompts) {
    if (!Array.isArray(prompts) || prompts.length === 0) {
      throw new TypeError('SAM3 tokenizer requires at least one prompt');
    }
    const results = prompts.map(tokenize);
    const inputIds = new Uint32Array(prompts.length * contextLength);
    const attentionMask = new Float32Array(prompts.length * contextLength);
    results.forEach((result, index) => {
      inputIds.set(result.inputIds, index * contextLength);
      attentionMask.set(result.attentionMask, index * contextLength);
    });
    return {
      inputIds,
      attentionMask,
      normalizedPrompts: results.map(result => result.normalizedPrompt),
      validLengths: results.map(result => result.validLength),
      shape: [prompts.length, contextLength],
    };
  }

  return {
    contextLength,
    bosTokenId: resolvedBosTokenId,
    eosTokenId: resolvedEosTokenId,
    padTokenId: resolvedPadTokenId,
    encode,
    tokenize,
    tokenizeBatch,
  };
}
